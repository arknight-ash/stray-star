import { hash32, hashEmbedding } from '../embedding-local';
import { CAMPUS_SPOTS, spotMentionedIn } from '@/lib/map-config';
import {
  allText,
  defineProvider,
  type AIProvider,
  type RawChatRequest,
  type RawProvider,
  type RawVisionRequest,
} from '../provider';
import type { AIIntent } from '../schemas';

/**
 * mock Provider（AI_PROVIDER=mock，默认）
 * ------------------------------------------------------------------
 * 它不是随机假数据：
 *  1. 可预测 —— 同一输入恒定得到同一输出（关键词规则 + 确定性哈希指纹）
 *  2. 有依据 —— 物种、严重度、标签、引用都从真实文本信号推导
 *  3. 有边界 —— 信息不足时给低置信度 + UNKNOWN/MILD，让"不确定"链路可被演示
 *  4. 向量真可用 —— 走确定性词袋向量，余弦检索在种子数据上有效
 */

const CAT_KEYS = ['猫', '喵', 'cat', 'kitten', '狸花', '橘猫', '三花', '奶牛猫'];
const DOG_KEYS = ['狗', '犬', '汪', 'dog', 'puppy', '柴犬', '拉布拉多', '柯基'];

const SEVERE_KEYS = [
  '出血',
  '外伤',
  '伤口',
  '骨折',
  '不吃',
  '呕吐',
  '腹泻',
  '抽搐',
  '流脓',
  '溃烂',
  '呼吸困难',
  '站不起来',
  '拒食',
  '误食',
];
const MODERATE_KEYS = [
  '消瘦',
  '打喷嚏',
  '流泪',
  '咳嗽',
  '掉毛',
  '精神差',
  '食欲下降',
  '跛行',
  '皮肤病',
  '猫癣',
  '眼屎',
  '鼻头干',
  '瘸',
  '拉稀',
];

const TAG_KEYS = [
  '已绝育',
  '耳标',
  '亲人',
  '警惕',
  '投喂',
  '食欲下降',
  '外伤',
  '跛行',
  '咳嗽',
  '腹泻',
  '夜行',
  '定点',
  '接种',
  '应激',
  '皮肤病',
  '消瘦',
  '腿部异常',
  '行动不便',
  '进食正常',
];

/**
 * 大白话 → 标签（mock 专用，2026-10-29）。
 *
 * 真实模型听得懂「一瘸一拐」指的是腿部异常，mock 手里只有一张关键词表。
 * 不补这一层，端到端测试就只能把"腿部异常"四个字原样喂给它 ——
 * 那样测的不是「大白话结构化」，而是"关键词回显"，用例是绿的但没测到东西。
 */
const SPOKEN_TAG_RULES: Array<{ pattern: RegExp; tag: string; level: 'MODERATE' | 'SEVERE' }> = [
  {
    pattern: /一瘸一拐|瘸了?|跛了?|右腿|后腿|前腿|后肢|不敢着地|腿.{0,4}(受伤|有伤|抬不起来)/,
    tag: '腿部异常',
    level: 'MODERATE',
  },
  {
    pattern: /没吃东西|不吃东西|食欲不振|吃得很少|没怎么吃|不进食/,
    tag: '食欲下降',
    level: 'MODERATE',
  },
  { pattern: /流血|出血|伤口流脓|外伤出血/, tag: '外伤', level: 'SEVERE' },
];

const FEATURE_POOL: Record<'CAT' | 'DOG', string[]> = {
  CAT: ['短毛', '狸花纹', '橘色斑块', '白色胸毛', '耳朵缺口', '尾巴短', '绿眼', '圆脸'],
  DOG: ['短毛', '黄色被毛', '垂耳', '卷尾', '中等体型', '黑色口鼻', '白色爪尖', '脖圈痕迹'],
};

interface Doc {
  id: string;
  title: string;
  content: string;
  score?: number;
}

interface ToolResult {
  tool: string;
  summary: string;
}

function hits(text: string, keys: string[]): string[] {
  return keys.filter((k) => text.toLowerCase().includes(k.toLowerCase()));
}

/** 确定性指纹：同一图片 URL 恒定得到同一组特征，保证演示可复现 */
function pickFeatures(species: 'CAT' | 'DOG', seed: number, count = 3): string[] {
  const pool = FEATURE_POOL[species];
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(pool[(seed + i * 7) % pool.length]);
  }
  return [...new Set(out)];
}

export function inferIntent(text: string): AIIntent | undefined {
  if (/怎么|如何|护理|注意|怎么办|知识|问答/.test(text)) return 'RAG';
  if (/健康|伤|病|异常|流血|精神|食欲/.test(text)) return 'HEALTH';
  if (/是谁|哪只|识别|物种|物种判定|猫还是狗/.test(text)) return 'SPECIES';
  if (/标签|记录一下|观察|投喂了|目击/.test(text)) return 'TAGS';
  if (/规划|计划|步骤|工具/.test(text)) return 'AGENT_PLAN';
  if (/下一步|继续|还差什么|该调/.test(text)) return 'AGENT_NEXT_STEP';
  if (/整合|总结回答|最终/.test(text)) return 'AGENT_FINAL';
  return undefined;
}

function speciesFromText(text: string): 'CAT' | 'DOG' | null {
  if (hits(text, CAT_KEYS).length) return 'CAT';
  if (hits(text, DOG_KEYS).length) return 'DOG';
  return null;
}

/** 图片指纹兜底：既无文字提示也无 URL 线索时，用哈希给出稳定但不自信的判定 */
function speciesFromFingerprint(seed: number): {
  species: 'CAT' | 'DOG' | 'UNKNOWN';
  confidence: number;
} {
  const bucket = seed % 10;
  if (bucket < 4) return { species: 'CAT', confidence: 0.63 };
  if (bucket < 8) return { species: 'DOG', confidence: 0.62 };
  return { species: 'UNKNOWN', confidence: 0.35 };
}

function speciesResult(imageUrl: string, prompt: string) {
  const text = `${prompt} ${imageUrl}`.toLowerCase();
  const byText = speciesFromText(text);
  const seed = hash32(imageUrl || prompt || 'empty');
  const byUrl = speciesFromText(imageUrl);
  const fingerprint = speciesFromFingerprint(seed);

  if (byText && byUrl && byText === byUrl) {
    return {
      species: byText,
      confidence: 0.9,
      features: pickFeatures(byText, seed),
      note: '文字描述与图片线索一致，判定较可靠。仍建议以管理员复核为准。',
    };
  }
  if (byText) {
    return {
      species: byText,
      confidence: 0.74,
      features: pickFeatures(byText, seed),
      note: '依据文字描述判定，建议结合清晰照片复核。',
    };
  }
  if (byUrl) {
    return {
      species: byUrl,
      confidence: 0.68,
      features: pickFeatures(byUrl, seed),
      note: '依据图片线索判定，置信度一般。',
    };
  }
  return {
    species: fingerprint.species,
    confidence: fingerprint.confidence,
    features:
      fingerprint.species === 'UNKNOWN'
        ? []
        : pickFeatures(fingerprint.species as 'CAT' | 'DOG', seed, 2),
    note:
      fingerprint.species === 'UNKNOWN'
        ? '信息不足，无法可靠判定物种。请补拍清晰照片或补充文字描述。'
        : '仅有弱特征线索，置信度偏低，结果可能不准确。',
  };
}

function healthResult(text: string) {
  const severe = hits(text, SEVERE_KEYS);
  const moderate = hits(text, MODERATE_KEYS);
  const signals = [...severe, ...moderate];
  const severity: 'MILD' | 'MODERATE' | 'SEVERE' = severe.length
    ? 'SEVERE'
    : moderate.length
      ? 'MODERATE'
      : 'MILD';

  const advice = signals.length
    ? [
        '保持患处干燥清洁，避免二次污染',
        '尽快联系校兽医或当地动保组织面诊',
        '持续记录进食、饮水与精神状态',
      ]
    : ['继续常规观察，保持投喂点卫生', '如出现食欲或精神变化，及时上报'];

  // 与 lib/semantic.ts 的 SEVERITY_HEALTH 同义。这里是 mock，不反向 import UI 模块
  const STATUS: Record<'MILD' | 'MODERATE' | 'SEVERE', 'GREEN' | 'YELLOW' | 'RED'> = {
    MILD: 'GREEN',
    MODERATE: 'YELLOW',
    SEVERE: 'RED',
  };

  return {
    assessment: signals.length
      ? `描述中出现 ${signals.join('、')} 等信号，建议尽快线下核实并就医。本结果仅为初筛，不构成诊断。`
      : '未发现明显异常信号，建议维持常规观察与定点投喂。',
    healthStatus: STATUS[severity],
    severity,
    advice,
    confidence: signals.length ? 0.66 : 0.45,
    needsVet: severity === 'SEVERE',
    signals,
  };
}

/**
 * mock 版的语义解析：与真实模型输出同一份契约（type / tags / severity / sentiment / entities）。
 * 关键词表只是 mock 的实现细节，不是业务规则 —— 生产路径走 GLM 的多模态解析。
 */
function tagsResult(text: string) {
  const severe = hits(text, SEVERE_KEYS);
  const moderate = hits(text, MODERATE_KEYS);
  const spoken = SPOKEN_TAG_RULES.filter((r) => r.pattern.test(text));
  const spokenLevel = spoken.some((r) => r.level === 'SEVERE')
    ? 'SEVERE'
    : spoken.length
      ? 'MODERATE'
      : null;

  const tags = [...new Set([...hits(text, TAG_KEYS), ...spoken.map((r) => r.tag)])].slice(0, 6);

  const severity: 'MILD' | 'MODERATE' | 'SEVERE' =
    severe.length || spokenLevel === 'SEVERE'
      ? 'SEVERE'
      : moderate.length || spokenLevel === 'MODERATE'
        ? 'MODERATE'
        : 'MILD';

  const hunting = /喂|投喂|猫粮|狗粮|罐头|水碗|加了水|换了水/.test(text);
  const healthish = severe.length > 0 || moderate.length > 0 || /伤|病|痛|吐|瘸|跛|不吃/.test(text);
  const behavior = /亲人|警惕|跟着|蹭|躲|夜行|定点|叫|耳朵|绝育|耳标/.test(text);

  const type: 'FEEDING' | 'HEALTH' | 'BEHAVIOR' | 'OTHER' = healthish
    ? 'HEALTH'
    : hunting
      ? 'FEEDING'
      : behavior
        ? 'BEHAVIOR'
        : 'OTHER';

  const finalTags = tags.length
    ? tags
    : type === 'FEEDING'
      ? ['进食正常']
      : type === 'BEHAVIOR'
        ? ['行为观察']
        : type === 'HEALTH'
          ? ['状态异常']
          : ['其他'];

  const sentiment: 'POSITIVE' | 'NEUTRAL' | 'CONCERNED' | 'URGENT' =
    severity === 'SEVERE'
      ? 'URGENT'
      : severity === 'MODERATE'
        ? 'CONCERNED'
        : type === 'FEEDING' && /香|吃完|干净|开心/.test(text)
          ? 'POSITIVE'
          : 'NEUTRAL';

  const entities = finalTags.slice(0, 6).map((t) => ({
    kind: (/腿|耳|眼|口|鼻|尾|爪|后肢|前肢/.test(t)
      ? 'BODY_PART'
      : type === 'FEEDING'
        ? 'FOOD'
        : type === 'BEHAVIOR'
          ? 'ACTION'
          : 'SYMPTOM') as 'BODY_PART' | 'FOOD' | 'ACTION' | 'SYMPTOM',
    text: t,
  }));

  return {
    type,
    tags: finalTags,
    severity,
    sentiment,
    entities,
    summary: `涉及 ${finalTags.join('、')}`,
    confidence: 0.82,
    corrections: [],
  };
}

function ragResult(question: string, docs: Doc[], context?: Record<string, unknown>) {
  // 问「它在哪活动」时，答案在档案里（位置事实由 answerQuestion 从 lib/animals/whereabouts 取），
  // 不在护理知识库里 —— mock 也要照这个口径回答，否则本地演示会答非所问。
  const animalWhere = typeof context?.animalWhere === 'string' ? context.animalWhere : '';
  const animal = context?.animal as { name?: string; code?: string } | undefined;
  if (animalWhere && /在哪|哪里|在哪活动|活动|位置|出没|常去|躲/.test(question)) {
    const who = animal?.name ? `${animal.name}（${animal.code ?? ''}）` : '这只';
    return {
      answer:
        `${who}常出没的位置：${animalWhere}。` +
        '这个口径和图鉴里「常见位置」是同一条算法（档案坐标归到最近的校园角落），不会出现两处说法不一样。' +
        '记录正文里的具体地点（比如某个车棚）只是当时的文字描述，可以和坐标归类不同。',
      citedDocIds: [],
      confidence: 0.86,
      followUp: '要我把这次问到的位置记成一条观察吗？',
    };
  }

  if (!docs.length) {
    return {
      answer: '知识库里没有检索到相关内容，我不做猜测。请换个说法，或联系管理员补充护理资料。',
      citedDocIds: [],
      confidence: 0.2,
      followUp: '需要我帮你提交一条待补充的知识条目吗？',
    };
  }
  const top = docs[0];
  const lead = (top.content ?? '').split('\n').filter(Boolean)[0] ?? top.title;
  const second = docs[1];
  const secondLead = second
    ? ((second.content ?? '').split('\n').filter(Boolean)[0] ?? second.title)
    : '';
  // 答案里必须写 [n]：前端靠它把引用渲染成星图标注。
  // 编号就是 context.docs 的顺序（1 起），与 prompt 里的片段编号一致。
  //
  // 两个坑（都踩过）：片段首行本身带句号，再补一个就成"。。"；
  // 第二篇只写标题不写内容，引用角标会空挂在半句话后面，读者点开也不知道它支持了什么。
  return {
    answer: `根据《${top.title}》[1]：${ensureStop(lead)}${
      second ? `另可参考《${second.title}》[2]：${ensureStop(clipText(secondLead))}` : ''
    }以上为护理常识，不构成兽医诊断。`,
    citedDocIds: docs.slice(0, 2).map((d) => d.id),
    confidence: Math.min(0.92, Math.max(0.35, top.score ?? 0.6)),
    followUp: '需要我把它整理成一条观察记录吗？',
  };
}

/** 收尾补句号：原文已带句末标点就不再补；以逗号分号结尾说明是半句，换掉那个标点 */
function ensureStop(text: string): string {
  const t = text.trim();
  if (!t) return '';
  if (/[。！？!?…]$/.test(t)) return t;
  if (/[；;，,、]$/.test(t)) return `${t.slice(0, -1)}。`;
  return `${t}。`;
}

/** 回答里的引用摘要：一段话截到一句的长度，别把整段抄进回答 */
function clipText(text: string, max = 36): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = Math.max(...['。', '！', '？', '；'].map((p) => cut.lastIndexOf(p)));
  return at >= 8 ? cut.slice(0, at + 1) : `${cut}…`;
}

function planResult(question: string) {
  // 新编排器只用 goal（工具序列由 AGENT_NEXT_STEP 逐步决策），steps 仅为满足契约
  const steps: Array<{ tool: string; args: Record<string, unknown>; why: string }> = [
    { tool: 'queryArchive', args: { keyword: extractKeyword(question) }, why: '先定位到具体个体' },
  ];
  if (/健康|伤|病|异常/.test(question)) {
    steps.push({ tool: 'assessHealth', args: {}, why: '判断是否需要医疗介入' });
  }
  if (/记录|上报/.test(question)) {
    steps.push({
      tool: 'addObservation',
      args: { content: question.slice(0, 500) },
      why: '把情况写进手账',
    });
  }
  return { goal: question.slice(0, 120), steps: steps.slice(0, 5) };
}

/**
 * 白名单地点名的匹配式，由 `CAMPUS_SPOTS` 现算 —— 地点表改了这里自动跟上，
 * 不在 mock 里再手写一份地名（两份迟早不一致）。
 */
const SPOT_RE = new RegExp(
  CAMPUS_SPOTS.flatMap((s) => [s.name, ...((s.aliases ?? []) as string[])])
    .sort((a, b) => b.length - a.length) // 长名优先：「李园食堂」先于「李园」
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'),
);

interface NextStepContext {
  goal?: unknown;
  /** 用户原话（编排层显式传入）—— 关键词匹配只认它，不认拼了工具描述的整个消息体 */
  message?: unknown;
  callsLeft?: unknown;
  /** 本轮是否带了设备定位（编排层只在用户点了「用当前位置」时才放这个键） */
  location?: { available?: unknown };
}

/**
 * ReAct 决策的确定性规则（mock）。
 * 输入是用户原话 + 已完成工具集合，输出恒定 —— 自测靠它断言整条链路的形状。
 * 顺序即优先级：先定位，再识别/评估，再写记录，记录后必查预警，最后才是知识检索。
 */
function nextStepResult(text: string, context?: Record<string, unknown>) {
  const ctx = (context ?? {}) as NextStepContext;
  const callsLeft = typeof ctx.callsLeft === 'number' ? ctx.callsLeft : 0;
  if (callsLeft <= 0) {
    return { action: 'finish' as const, args: {}, why: '步数预算用完，转入整合' };
  }

  const done = new Set(readToolResults(context).map((r) => r.tool));
  const message = typeof ctx.message === 'string' && ctx.message ? ctx.message : text;

  // 闭环规则：addObservation 之后必须确认预警状态，不依赖关键词
  if (done.has('addObservation') && !done.has('checkAlerts')) {
    return {
      action: 'tool' as const,
      tool: 'checkAlerts',
      args: {},
      why: '确认预警是否已触发并通知管理员',
    };
  }

  /*
   * 「用我现在的位置」= 精度最高的一种目击记录，且**不需要用户说地名**。
   * 只有本轮真的带了定位才走这条：没授权时硬塞 useCurrentPosition 会被工具拒掉，
   * 那还不如让下面的地点名规则去要一个角落名。
   * 排在规则表之前，因为这句话里通常一个校园角落名都没有，SPOT_RE 匹配不到。
   */
  if (
    ctx.location?.available === true &&
    !done.has('recordLocation') &&
    // 必须先定位到个体：recordLocation 要 animalCode，没有就只能拿它兜底失败
    (done.has('queryArchive') || done.has('identifyAnimal')) &&
    /当前位置|现在的位置|我就在|就在这|就在这里|我旁边|它旁边|身边|脚下/.test(message)
  ) {
    return {
      action: 'tool' as const,
      tool: 'recordLocation',
      args: { useCurrentPosition: true, note: message.slice(0, 500) },
      why: '用手机定位记录目击位置',
    };
  }

  const rules: Array<{
    tool: string;
    test: RegExp;
    args: () => Record<string, unknown>;
    why: string;
    /** 某个工具跑过后本条规则就让位：queryArchive 已定位到个体，再识别只会误建新档案 */
    skipIf?: string;
    /**
     * 即使 test 命中也不选它：统计/名单类问句里常含"健康""记录""预警"等词，
     * 不加这层排除，本地 mock 会把「本周记录了几条」当成写记录写进库。
     */
    unless?: RegExp;
  }> = [
    {
      tool: 'queryDbStats',
      // 数字必须来自库：这条规则决定问"一共多少只"时本地 mock 是去数库还是瞎编
      test: /多少|几只|几条|几张|几个|一共|总共|共有|统计|概况|分布|最多|最少|占比/,
      unless: /怎么办|如何|护理|喂什么|吃什么|药/,
      args: () => {
        // 角落要排在"记录"前面：「哪个角落记录最多」两个词都有，问的是地理分布
        const section = /猫|狗/.test(message)
          ? 'species'
          : /预警|警报|告警/.test(message)
            ? 'alerts'
            : /角落|区域|片区/.test(message)
              ? 'spots'
              : /健康|三色|状态档/.test(message)
                ? 'health'
                : /记录|观察|手账/.test(message)
                  ? 'observations'
                  : /照片|相片|图片/.test(message)
                    ? 'photos'
                    : 'overview';
        return { section };
      },
      why: '查数据库统计',
    },
    {
      tool: 'listAnimals',
      test: /哪些|哪个|谁|名单|列出|都有/,
      // 「哪个角落最多」问的是分布，不是名单 —— 让它留给 queryDbStats，别连跑三个工具
      unless: /怎么办|如何|护理|喂什么|吃什么|药|在哪|角落|区域|片区|地方|最多|最少/,
      args: () => {
        const levels = /红|危急|严重/.test(message)
          ? ['RED']
          : /关注|异常|预警|黄|观察档/.test(message)
            ? ['RED', 'YELLOW']
            : undefined;
        const spot = message.match(/(东门|南门|一食堂|宿舍区|操场|教学楼后巷)/)?.[0];
        return {
          ...(levels ? { healthLevel: levels } : {}),
          ...(spot ? { spotName: spot } : {}),
          ...(/位置|坐标/.test(message) ? { missingLocation: true } : {}),
        };
      },
      why: '按条件查名单',
    },
    {
      tool: 'queryObservations',
      test: /记录|观察|手账|最近|今天|本周|近七/,
      // "写一条记录"是要写库，不是要查记录 —— 这条让位，否则问"帮我写一条记录"
      // 会先被查记录的规则截走，永远轮不到 addObservation
      unless: /怎么办|如何|护理|哪些|哪个|多少|几条|角落|区域|最多|写一条记录|写个记录|记录一条/,
      args: () => ({
        ...(/今天/.test(message) ? { days: 1 } : { days: 7 }),
        limit: 5,
      }),
      why: '查最近的观察记录',
    },
    {
      tool: 'queryArchive',
      // 「在哪活动 / 常去哪」也必须查档案：位置事实在库里（档案坐标 + 观察坐标），
      // 不查就只能靠模型编。这条规则决定本地 mock 会不会真去读库。
      test: /No\.\d+|档案|情况|状态|这只|那只|在哪|哪里|位置|活动|出没|常去/,
      unless: /多少|几只|几条|哪些|统计|分布|一共|总共/,
      args: () => ({ keyword: extractKeyword(message) }),
      why: '先定位个体档案',
    },
    {
      tool: 'identifyAnimal',
      test: /识别|是谁|哪只|看看|照片|拍的|没见过/,
      skipIf: 'queryArchive',
      // 「照片墙上有多少张」含"照片"但是统计，不是要识别 —— 别跑去建档案
      unless: /多少|几张|几条|哪些|统计|分布|一共|总共/,
      args: () => ({ note: message.slice(0, 200) }),
      why: '识别个体身份',
    },
    {
      tool: 'assessHealth',
      test: /健康|伤|病|异常|流血|跛|精神|食欲|癣/,
      unless: /多少|几只|几条|哪些|统计|分布|一共/,
      args: () => ({ description: message.slice(0, 300) }),
      why: '评估健康状况',
    },
    {
      tool: 'recordLocation',
      /*
       * 「在操场看到它了」= 记位置，不是记一笔普通观察。
       * 必须排在 addObservation 之前：两句话都含「看到它」，而只有前者带得起坐标。
       * 也必须在 queryArchive 之后：先定位到个体，后续步骤才拿得到 animalCode。
       */
      test: SPOT_RE,
      // 问句/统计句里的地点名是在问「那边有谁」，不是要挪点
      unless: /多少|几只|几条|哪些|统计|分布|在哪|哪里|活动|出没|常去|最多|最少/,
      args: () => ({
        place: spotMentionedIn(message)?.name ?? message.slice(0, 40),
        note: message.slice(0, 500),
      }),
      why: '记录目击地点并移动星图点位',
    },
    {
      tool: 'addObservation',
      // 只认"要我写一笔"的说法：「最近有什么新记录」含"记录"但那是查询，不能写库
      test:
        /记一下|记录一下|记录下来|记一笔|记录一笔|帮我记|帮.*记|上报|新增一条|投喂了|喂了|发现它|看到它|写一条记录|写个记录|记录一条/,
      // recordLocation 本身就会写一条观察记录，再走一遍只是把同一句话写两次
      skipIf: 'recordLocation',
      unless: /多少|几条|几只|几张|哪些|统计|分布/,
      args: () => ({
        content: message.slice(0, 500),
        severe: /严重|紧急|流血|大出血|骨折/.test(message),
      }),
      why: '把情况写进手账',
    },
    {
      tool: 'checkAlerts',
      test: /预警|通知|管理员|严重|紧急/,
      unless: /多少|几条|几只|哪些|统计|分布/,
      args: () => ({}),
      why: '查看预警与通知状态',
    },
    {
      tool: 'searchKnowledge',
      test: /怎么|如何|护理|注意|治疗/,
      args: () => ({ question: message.slice(0, 300) }),
      why: '检索护理知识库',
    },
  ];

  for (const rule of rules) {
    if (rule.skipIf && done.has(rule.skipIf)) continue;
    if (rule.unless && rule.unless.test(message)) continue;
    // 关键词只对用户原话匹配：text 里可能拼着工具描述与观察摘要，整包匹配会让每条规则每轮都命中
    if (!done.has(rule.tool) && rule.test.test(message)) {
      return { action: 'tool' as const, tool: rule.tool, args: rule.args(), why: rule.why };
    }
  }
  return { action: 'finish' as const, args: {}, why: '已有信息足够完成任务' };
}

function finalResult(text: string, toolResults: ToolResult[]) {
  return {
    answer: toolResults.length
      ? `已按计划完成 ${toolResults.length} 步：${toolResults.map((r) => r.summary).join('；')}。`
      : '没有可执行的信息，请补充动物编号或更具体的描述。',
    usedTools: toolResults.map((r) => r.tool),
    needsHuman: /严重|SEVERE|紧急|出血/.test(text),
  };
}

/**
 * 「星图观测手记」的 mock 产出（2026-10-28）。
 *
 * 必须真的读 context 里的 facts：mock 会进本地演示与自测，
 * 若这里写死一句话，演示时就成了一块假数据 —— 而这块卡片存在的意义正是"AI 在读真实数据"。
 * 口径与真实模型一致：只复述 facts，给不出值得关注的对象时直说平稳。
 */
function observatoryResult(context?: Record<string, unknown>) {
  const hour = typeof context?.hourLabel === 'string' ? context.hourLabel : '此刻';
  const totals = (context?.totals ?? {}) as {
    total?: number;
    openAlerts?: number;
    last7dObs?: number;
  };
  const candidates = Array.isArray(context?.candidates)
    ? (context.candidates as Array<Record<string, unknown>>)
    : [];
  const top = candidates[0];
  const total = Number(totals.total ?? 0);
  const openAlerts = Number(totals.openAlerts ?? 0);
  const last7dObs = Number(totals.last7dObs ?? 0);

  if (!top) {
    return {
      headline: `AI 观测：${hour}，全场 ${total} 颗星暂无异常信号，近 7 天累计 ${last7dObs} 条记录。`,
      focusCode: null,
      signals: [`全场 ${total} 颗星`, `近 7 天 ${last7dObs} 条记录`],
      confidence: 0.42,
    };
  }

  const code = String(top.code ?? '');
  const name = String(top.name ?? '这只');
  const quietDays = Number(top.quietDays ?? 0);
  const hasAlert = Boolean(top.openAlert);
  return {
    headline:
      `AI 观测：${hour}，${name}（${code}）已 ${quietDays} 天没有新记录` +
      `${hasAlert ? '、还挂着一条未处理预警' : ''}，结合档案，建议安排一次现场核实。`,
    focusCode: code,
    signals: [
      `${code} 已 ${quietDays} 天无记录`,
      `全场未处理预警 ${openAlerts} 条`,
    ],
    confidence: 0.55,
  };
}

function extractKeyword(prompt: string): string {
  const code = prompt.match(/No\.\d{2,3}/i);
  if (code) return code[0];
  // 先摘掉疑问词与位置词，否则「小灰平常在哪活动」会被切成「小灰平常」，
  // 拿这句去匹配名字当然匹配不到 —— 关键词必须是"小灰"。
  // 请求动词与虚词要先摘干净，否则「查一下小橘的档案」会被切成「查一下小」/「小橘的」，
  // 拿去匹配名字当然匹配不到 —— 关键词必须是"小橘"。
  const cleaned = prompt
    .replace(/查一下|看一下|查一查|帮我|请问|我想知道|我要/g, ' ')
    .replace(
      /平常|平时|经常|一般|通常|都在|在哪|哪里|在哪儿|活动|位置|出没|常去|档案|情况|状态|怎么样|吗|呢|[？?，,。.！!\s]/g,
      ' ',
    )
    .replace(/[的并和与或]/g, ' ');
  const words = cleaned.match(/[\u4e00-\u9fa5]{2,4}/g);
  return words?.length ? words[0] : prompt.slice(0, 12);
}

function readDocs(context: Record<string, unknown> | undefined): Doc[] {
  const docs = context?.docs;
  return Array.isArray(docs) ? (docs as Doc[]) : [];
}

function readToolResults(context: Record<string, unknown> | undefined): ToolResult[] {
  const results = context?.toolResults;
  return Array.isArray(results) ? (results as ToolResult[]) : [];
}

/** 按意图产出结构化结果；未知意图返回空对象 —— 会触发 AIValidationError，用于验证兜底链路 */
function answerByIntent(
  intent: AIIntent | undefined,
  text: string,
  context?: Record<string, unknown>,
): unknown {
  switch (intent) {
    case 'SPECIES':
      return speciesResult('', text);
    case 'HEALTH':
      return healthResult(text);
    case 'TAGS':
      return tagsResult(text);
    case 'RAG':
      return ragResult(text, readDocs(context), context);
    case 'AGENT_PLAN':
      return planResult(text);
    case 'AGENT_NEXT_STEP':
      return nextStepResult(text, context);
    case 'AGENT_FINAL':
      return finalResult(text, readToolResults(context));
    case 'OBSERVATORY':
      return observatoryResult(context);
    default:
      return {};
  }
}

const mockRaw: RawProvider = {
  name: 'mock',
  models: { chat: 'mock-chat', vision: 'mock-vision', embed: 'mock-embed' },

  async rawVision(req: RawVisionRequest) {
    const text = `${req.prompt} ${req.imageUrl}`.toLowerCase();
    const intent = req.intent ?? (/健康|伤|病|异常/.test(req.prompt) ? 'HEALTH' : 'SPECIES');
    if (intent === 'SPECIES') return speciesResult(req.imageUrl, req.prompt);
    if (intent === 'HEALTH') return healthResult(text);
    return answerByIntent(intent, text, req.context);
  },

  async rawChat(req: RawChatRequest) {
    const text = allText(req.messages);
    const intent = req.intent ?? inferIntent(text);
    const result = answerByIntent(intent, text, req.context);

    // 纯对话（无意图、无 schema）：返回自然语言字符串，交给上层直接展示
    if (intent === undefined) {
      return 'mock 模式：当前没有可用的结构化意图。请补充动物编号（如 No.003）或更具体的描述，也可以直接拍照识别。';
    }
    return result;
  },

  async rawEmbed(text: string) {
    return hashEmbedding(text);
  },
};

export const mockProvider: AIProvider = defineProvider(mockRaw);
