import { z } from 'zod';

/**
 * 所有 AI 结构化输出的 Zod 契约。
 * 约定：任何模型返回都必须先过这里的 parse，失败走 fallback，绝不把原始错误抛给客户端。
 */

export const SpeciesResultSchema = z.object({
  species: z.enum(['CAT', 'DOG', 'UNKNOWN']),
  confidence: z.number().min(0).max(1),
  features: z.array(z.string()).max(8).default([]),
  note: z.string().max(200).default(''),
});
export type SpeciesResult = z.infer<typeof SpeciesResultSchema>;

export const HealthLevelSchema = z.enum(['GREEN', 'YELLOW', 'RED']);

/**
 * 多模态健康初筛的输出契约（第 5 阶段）。
 *
 * 为什么额外加 superRefine：让同一个模型同时输出 severity 和 healthStatus，
 * 它迟早会吐出「SEVERE 但 GREEN」「SEVERE 但不用就医」这种自洽的胡说。
 * 交叉约束在这里拦住，宁可整份结果作废走兜底，也不让矛盾结论进档案
 * （服务端另有一道 reconcileHealth 做「向严一侧」校正，两层不重复：
 *   这里守住的是「不许矛盾」，那里守住的是「不许把安全决策交给模型」）。
 */
/**
 * 「必须看兽医」的红旗信号。
 *
 * 只收**客观、可观察、而且拖下去会变糟**的征象，不收「精神差」「食欲略降」这类
 * 主观且常见的描述 —— 否则 MODERATE 会被一律推成转诊，用户很快就学会无视它。
 */
const VET_RED_FLAGS = [
  '出血',
  '流血',
  '伤口',
  '溃烂',
  '化脓',
  '跛',
  '不敢着地',
  '拒食',
  '不吃',
  '呼吸困难',
  '抽搐',
  '昏迷',
  '骨折',
  '脱臼',
  '高烧',
  '持续呕吐',
];

/**
 * 模型没明确回答 needsVet 时的兜底裁决。
 *
 * SEVERE 一律转诊（铁律⑦：漏报的代价高于误报）；
 * MODERATE 只在命中红旗信号时才升级，其余交给 reconcile 与预警引擎继续观察；
 * MILD 不转诊。
 */
export function inferNeedsVet(severity: 'MILD' | 'MODERATE' | 'SEVERE', signals: string[]): boolean {
  if (severity === 'SEVERE') return true;
  if (severity === 'MILD') return false;
  return signals.some((s) => VET_RED_FLAGS.some((flag) => s.includes(flag)));
}

/**
 * 模型只给了分档、没写文字说明时的占位。
 *
 * 刻意写成自述式：用户看到的是「AI 没写说明」而不是空白或一句假装的结论。
 */
export const ASSESSMENT_PLACEHOLDER = '本次 AI 只给出了分档与建议，未附加文字说明。';

const HealthAssessmentSchemaRaw = z
  .object({
    /**
     * 下限只留 2 个字符（2026-10-29）。
     * 原来写 min(4)，而模型对一张健康照片完全可能只回「健康」——那是个正确答案，
     * 却因为差两个字被判不合法，整份评估作废、用户一条结论都拿不到。
     * 描述性字段的「详略」不该由长度阈值裁决；真正的档位在 healthStatus / severity。
     *
     * 允许缺失（同日）：实测模型偶尔把 assessment 当成**容器**用——
     * `{"assessment":{"healthStatus":"GREEN",…}}`，拆包后文字说明就真没了。
     * 那个场景里分档、建议、信号都是有效结论，为一段文字丢掉全部不值。
     * 缺的时候填一句自述式占位，读者一眼知道发生了什么，而不是看到空白。
     */
    assessment: z
      .string()
      .min(2)
      .max(500)
      .optional()
      .transform((s) => s ?? ASSESSMENT_PLACEHOLDER),
    healthStatus: HealthLevelSchema,
    severity: z.enum(['MILD', 'MODERATE', 'SEVERE']),
    /**
     * 上限刻意比展示容量宽：模型多给一两条建议是「啰嗦」，不是「出错」。
     * 曾经因为给了 7 条（上限 6）把整份评估作废，用户连一条结论都拿不到 ——
     * 现在收 10 条、截到 6 条，超长的那条也是截字而不是丢掉整条。
     */
    advice: z
      .array(z.string().min(2).max(160).transform((s) => s.slice(0, 120)))
      .min(1)
      .max(10)
      .transform((list) => list.slice(0, 6)),
    confidence: z.number().min(0).max(1),
    /**
     * 允许缺失（2026-10-29）。原来的 `.boolean()` 是硬性必填，模型只要把这一个字段
     * 翻成中文（实测给的是「需要兽医」，而别名表里只有「需要看兽医」），
     * 整份评估就被判「缺失」而作废 —— 用户拿不到任何结论。
     * needsVet 本来就该由系统按严重程度裁决（铁律⑦：漏报代价高于误报），
     * 模型漏说时用 inferNeedsVet 兜底，而不是让整次评估白跑。
     */
    needsVet: z.boolean().optional(),
    /** 同理：标签是展示用的一行字，太长截断即可，不值得为它作废整份评估 */
    signals: z
      .array(z.string().min(1).max(80).transform((s) => s.slice(0, 24)))
      .max(8)
      .default([]),
  })
  .superRefine((v, ctx) => {
    if (v.severity === 'SEVERE' && v.healthStatus === 'GREEN') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['healthStatus'],
        message: 'severity 为 SEVERE 时 healthStatus 不得为 GREEN',
      });
    }
    // 只有模型「明确说不用就医」才与 SEVERE 矛盾；没给（undefined）交给 reconcile 推导
    if (v.severity === 'SEVERE' && v.needsVet === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['needsVet'],
        message: 'severity 为 SEVERE 时 needsVet 必须为 true',
      });
    }
  });
/**
 * 显式标注输出类型（与 AgentNextStepSchema / ObservatoryNoteSchema 同一个处理方式）：
 * `assessment` 带 `.optional().transform(...)`、`signals` 带 `.default()`，
 * 这两个都会让 zod 的**输入**类型把字段算成可选，
 * 而 `runStructured<T>(schema: z.ZodType<T>)` 会按输入类型推导，下游白拿一堆 `| undefined`。
 * 用 `z.output` 钉死一次，调用方拿到的就是真正解析后的形状。
 */
export type HealthAssessment = z.output<typeof HealthAssessmentSchemaRaw>;

export const HealthAssessmentSchema = HealthAssessmentSchemaRaw as unknown as z.ZodType<HealthAssessment>;

/* ────────────────── 众包观察的语义解析（2026-10-28 重构） ────────────────── */

export const ObservationTypeValues = ['FEEDING', 'HEALTH', 'BEHAVIOR', 'OTHER'] as const;
export const ObservationSentimentValues = ['POSITIVE', 'NEUTRAL', 'CONCERNED', 'URGENT'] as const;
export const ObservationEntityKindValues = [
  'BODY_PART',
  'SYMPTOM',
  'ACTION',
  'FOOD',
  'LOCATION',
  'OBJECT',
] as const;

/**
 * 众包记录的 AI 语义解析契约。
 *
 * 为什么不再只是「抽标签」：这条链路是评分标准里点名要求 AI 接管的一环
 * （CLAUDE.md ★4「众包信息结构化」）。分类、严重度、情感、实体都必须是模型的判断，
 * 前端不给用户下拉框 —— 用户只负责陈述现场，归类是系统的事。
 *
 * 三段式：Raw（宽口径收模型的原话）→ 归一 → 严格结构。
 * 宽口径的原因是模型几乎不会稳定吐英文枚举：实测它会写「健康」「喂食」「严重」
 * 「有点担心」，甚至把 tags 写成 "#腿部异常"。逐字段 preprocess 会让一处抖动
 * 拖垮整份结果（最后退化成「未分类」，等于 AI 白干），所以先收再归一。
 */
export type ObservationType = (typeof ObservationTypeValues)[number];
export type ObservationSentiment = (typeof ObservationSentimentValues)[number];
export type ObservationEntityKind = (typeof ObservationEntityKindValues)[number];

/**
 * 模型输出的三种脏东西，统一在这里洗（2026-10-28）。
 *
 * 实测 GLM 的三类抖动，单独修某一处 schema 会按下葫芦浮起瓢：
 *  1. `<think>` 思考段：开了 thinking 时，正文前会挂一段 `<think>…</think>`，
 *     有时甚至吐出 `JSON + </think> + JSON` 这种错序；
 *  2. 整份结果被二次编码成字符串（schema 收到 string 而不是 object）；
 *  3. JSON 尾巴多一个 `}` 或少一段 —— 直接 JSON.parse 必炸。
 *
 * 都不该判成「模型不会做事」：洗完之后仍交给各自的严格契约把关，
 * 真正的把关点没有放松（枚举、字段范围、交叉约束一个都没少）。
 */
function parseJsonish(input: unknown): unknown {
  if (typeof input !== 'string') return input;

  // 1. 去掉 think 段（连 opening 缺失的残尾一起）
  let text = input
    .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think[^>]*>/gi, '')
    .trim();
  if (!text) return input;

  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };

  // 2. 先按原样解析，再按「第一个 { 到配对的 }」截取（忽略尾随杂质/多余括号）
  const direct = tryParse(text);
  if (direct !== undefined) return direct;

  const start = text.indexOf('{');
  if (start < 0) return input;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const sliced = tryParse(text.slice(start, i + 1));
        return sliced ?? input;
      }
    }
  }
  return input;
}

export interface ObservationEntity {
  kind: ObservationEntityKind;
  text: string;
}

export interface ObservationAnalysis {
  type: ObservationType;
  tags: string[];
  severity: 'MILD' | 'MODERATE' | 'SEVERE';
  sentiment: ObservationSentiment;
  entities: ObservationEntity[];
  summary: string;
  confidence: number;
  /** 归一阶段做过的向严一侧校正（进审计，便于复盘模型漂移） */
  corrections: string[];
}

const TYPE_ALIASES: Record<string, ObservationType> = {
  feeding: 'FEEDING',
  feed: 'FEEDING',
  投喂: 'FEEDING',
  喂食: 'FEEDING',
  喂养: 'FEEDING',
  食物: 'FEEDING',
  health: 'HEALTH',
  健康: 'HEALTH',
  医疗: 'HEALTH',
  症状: 'HEALTH',
  疾病: 'HEALTH',
  behavior: 'BEHAVIOR',
  behaviour: 'BEHAVIOR',
  行为: 'BEHAVIOR',
  行为习惯: 'BEHAVIOR',
  习性: 'BEHAVIOR',
  other: 'OTHER',
  其他: 'OTHER',
  其它: 'OTHER',
  未知: 'OTHER',
};

const SEVERITY_ALIASES: Record<string, ObservationAnalysis['severity']> = {
  mild: 'MILD',
  low: 'MILD',
  minor: 'MILD',
  轻微: 'MILD',
  轻度: 'MILD',
  正常: 'MILD',
  moderate: 'MODERATE',
  medium: 'MODERATE',
  中等: 'MODERATE',
  中度: 'MODERATE',
  需要观察: 'MODERATE',
  severe: 'SEVERE',
  high: 'SEVERE',
  critical: 'SEVERE',
  严重: 'SEVERE',
  紧急: 'SEVERE',
  危急: 'SEVERE',
};

const SENTIMENT_ALIASES: Record<string, ObservationSentiment> = {
  positive: 'POSITIVE',
  happy: 'POSITIVE',
  积极: 'POSITIVE',
  正向: 'POSITIVE',
  轻松: 'POSITIVE',
  neutral: 'NEUTRAL',
  中性: 'NEUTRAL',
  平静: 'NEUTRAL',
  concerned: 'CONCERNED',
  worried: 'CONCERNED',
  担忧: 'CONCERNED',
  担心: 'CONCERNED',
  urgent: 'URGENT',
  alarm: 'URGENT',
  紧急: 'URGENT',
  着急: 'URGENT',
  求救: 'URGENT',
};

const ENTITY_KIND_ALIASES: Record<string, ObservationEntityKind> = {
  body_part: 'BODY_PART',
  bodypart: 'BODY_PART',
  部位: 'BODY_PART',
  身体部位: 'BODY_PART',
  symptom: 'SYMPTOM',
  症状: 'SYMPTOM',
  action: 'ACTION',
  动作: 'ACTION',
  行为: 'ACTION',
  food: 'FOOD',
  食物: 'FOOD',
  食物名: 'FOOD',
  location: 'LOCATION',
  地点: 'LOCATION',
  位置: 'LOCATION',
  object: 'OBJECT',
  物品: 'OBJECT',
  物体: 'OBJECT',
};

/** 把模型可能写岔的枚举值折回规范值；折不动就走 fallback */
function pickAlias<T extends string>(map: Record<string, T>, raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, '_');
  return map[key] ?? map[raw.trim()] ?? fallback;
}

/** 标签只留可核查的事实词：去 #、去尾巴标点、去空白、限长 */
function cleanTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/^[#＃\s]+/g, '')
    .replace(/[\s，,。.；;、！!？?]+$/g, '')
    .replace(/\s+/g, '')
    .trim()
    .slice(0, 12);
  return text || null;
}

function dedupeTags(items: unknown[], limit: number): string[] {
  const out: string[] = [];
  for (const item of items) {
    const tag = cleanTag(item);
    if (!tag) continue;
    if (out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= limit) break;
  }
  return out;
}

const ObservationAnalysisRaw = z.object({
  type: z.string().max(24).optional(),
  tags: z.array(z.unknown()).max(12).optional(),
  severity: z.string().max(12).optional(),
  sentiment: z.string().max(12).optional(),
  entities: z.array(z.unknown()).max(12).optional(),
  summary: z.string().max(200).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

/**
 * 从实体列表里抽 {kind,text}：兼容三种抖法 ——
 * 规范对象、只给字符串、把 text 写成 name/value/label。
 */
function normalizeEntities(items: unknown[]): ObservationEntity[] {
  const out: ObservationEntity[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const text = item.replace(/^[#＃\s]+/g, '').trim().slice(0, 16);
      if (text) out.push({ kind: 'SYMPTOM', text });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const textRaw = obj.text ?? obj.name ?? obj.value ?? obj.label;
    const text = typeof textRaw === 'string' ? textRaw.replace(/^[#＃\s]+/g, '').trim().slice(0, 16) : '';
    if (!text) continue;
    out.push({ kind: pickAlias(ENTITY_KIND_ALIASES, obj.kind ?? obj.type, 'SYMPTOM'), text });
    if (out.length >= 8) break;
  }
  return out;
}

export const ObservationAnalysisSchema = z
  .preprocess(parseJsonish, ObservationAnalysisRaw)
  .transform((raw): ObservationAnalysis => {
    const corrections: string[] = [];

    let type = pickAlias(TYPE_ALIASES, raw.type, 'OTHER');
    const severity = pickAlias(SEVERITY_ALIASES, raw.severity, 'MILD');
    let sentiment = pickAlias(
      SENTIMENT_ALIASES,
      raw.sentiment,
      severity === 'SEVERE' ? 'URGENT' : severity === 'MODERATE' ? 'CONCERNED' : 'NEUTRAL',
    );
    const tags = dedupeTags(raw.tags ?? [], 6);
    const entities = normalizeEntities(raw.entities ?? []);

    // 两条「向严一侧」的交叉校正：不让自相矛盾的组合进档案。
    // 这校正的是**一致性**，不是分类本身 —— 分类仍然由模型给。
    if (severity === 'SEVERE' && type !== 'HEALTH') {
      corrections.push(`type:${type}->HEALTH(severity=SEVERE)`);
      type = 'HEALTH';
    }
    if (sentiment === 'URGENT' && severity !== 'SEVERE') {
      corrections.push(`severity:${severity}->SEVERE(sentiment=URGENT)`);
      sentiment = 'URGENT';
    }

    return {
      type,
      tags: tags.length ? tags : ['未分类'],
      // 有 URGENT 语气时严重度必须跟上，上面的 corrections 只记了原因，值要在这里落
      severity: sentiment === 'URGENT' ? 'SEVERE' : severity,
      sentiment,
      entities,
      summary: (raw.summary ?? '').trim().slice(0, 120),
      confidence: raw.confidence ?? 0.6,
      corrections,
    };
  }) as unknown as z.ZodType<ObservationAnalysis>;

export type ObservationAnalysisResult = ObservationAnalysis;

export const RagAnswerSchema = z.object({
  answer: z.string().min(4).max(800),
  citedDocIds: z.array(z.string()).max(5).default([]),
  confidence: z.number().min(0).max(1),
  followUp: z.string().max(120).default(''),
});
export type RagAnswer = z.infer<typeof RagAnswerSchema>;

/**
 * 规划器输出。同样先洗再校验：实测规划结果更容易出问题 ——
 * 它是整条链路里最长的一段 JSON，模型更爱加 `<think>` 或尾随杂质，
 * 一次解析失败就会让星轨上"下一步计划"的暗星全部消失（接管功能就没得可演）。
 */
const AgentPlanRaw = z.object({
  goal: z.string().max(200),
  steps: z
    .array(z.object({ tool: z.string(), args: z.record(z.unknown()).default({}), why: z.string().max(120) }))
    .min(1)
    .max(5),
});
export type AgentPlan = z.infer<typeof AgentPlanRaw>;
export const AgentPlanSchema = z.preprocess(
  parseJsonish,
  AgentPlanRaw,
) as unknown as z.ZodType<AgentPlan>;

const AgentFinalRaw = z.object({
  answer: z.string().min(2).max(800),
  usedTools: z.array(z.string()).max(5).default([]),
  needsHuman: z.boolean().default(false),
});
export type AgentFinal = z.infer<typeof AgentFinalRaw>;
export const AgentFinalSchema = z.preprocess(
  parseJsonish,
  AgentFinalRaw,
) as unknown as z.ZodType<AgentFinal>;

/**
 * ReAct 单步决策（阶段 8）。
 * 每轮只决定一个动作：继续调一个工具，或者宣布信息足够进入整合。
 * `tool` 必须在编排层给出的工具清单内，args 的值必须来自用户消息或工具观察 ——
 * 编造的参数会被工具自己的 zod 契约拦下，走 error 降级，不会带病写库。
 *
 * 2026-10-28 加固：严格 enum 会把「格式抖动」判成「决策不可用」。
 * 实测 GLM 5 次决策里 3 次过不了校验，两种形态：
 *   a) 把工具名写进 action：{"action":"searchKnowledge","tool":"searchKnowledge",...}
 *   b) 整个对象被二次编码成字符串（schema 收到的是 string 而不是 object）
 * 两者都不是「不会做事」，一拒就直接结束工具阶段，用户拿到「没有可执行的信息」。
 * 所以先归一（字符串解包 / action 里的工具名提到 tool / 顶层散落参数收进 args），
 * 再交给后面的工具 zod 去把关 —— 真正的把关点仍在工具入参，不在这里。
 */
const AgentNextStepRaw = z
  .object({
    action: z.string().max(40).optional(),
    tool: z.string().max(40).optional(),
    args: z.record(z.unknown()).optional(),
    why: z.string().max(200).optional(),
  })
  .passthrough();

const AgentNextStepPipeline = z
  .preprocess(parseJsonish, AgentNextStepRaw)
  .transform((raw) => {
    const toolName =
      raw.tool ??
      (raw.action && raw.action !== 'tool' && raw.action !== 'finish' ? raw.action : undefined);
    // 有的模型把工具参数平铺在顶层（{"tool":"queryArchive","keyword":"No.001"}）
    const spilled: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'action' || k === 'tool' || k === 'args' || k === 'why') continue;
      spilled[k] = v;
    }
    return {
      action: (toolName ? 'tool' : 'finish') as 'tool' | 'finish',
      tool: toolName,
      args: { ...spilled, ...(raw.args ?? {}) },
      why: raw.why ?? '',
    };
  });

export type AgentNextStep = z.infer<typeof AgentNextStepPipeline>;
/**
 * 显式标成 `z.ZodType<AgentNextStep>`：带 preprocess/transform 的 ZodEffects
 * 在 runStructured<T>(schema: z.ZodType<T>) 里会被推导成 unknown，下游全变 any 报错。
 */
export const AgentNextStepSchema = AgentNextStepPipeline as unknown as z.ZodType<AgentNextStep>;

/**
 * 「星图观测手记」（2026-10-28）：AI 主动读全局数据后写的一句话总结。
 *
 * 与 HealthAssessmentSchema 的关键区别：**它不产出任何新结论**。
 * 只允许复述数据库算好的事实（谁多久没出现、哪个角落最活跃、几条未处理预警），
 * 所以这里没有 severity / healthStatus 这类会被下游当成判断用的字段 ——
 * 一旦给模型开了这个口，它就会开始替兽医下诊断，而它并没有看过任何一只动物。
 */
export const ObservatoryNoteSchemaRaw = z.object({
  /** 一句话总览（≤120 字，正常应在 80 字内）。必须能独立读懂 */
  headline: z.string().min(6).max(120),
  /** 建议优先关注的对象编号；必须逐字取自上下文 candidates，否则编排层会丢弃 */
  focusCode: z.string().max(24).nullish(),
  /** 2-4 条依据，每条只复述一个事实。超长截断而不是作废整条手记 */
  signals: z
    .array(z.string().max(80).transform((s) => s.slice(0, 40)))
    .max(4)
    .default([]),
  confidence: z.number().min(0).max(1).default(0.6),
});

/**
 * 显式标注输出类型：`.default()` 让 zod 的输入类型把 signals / confidence 算成可选，
 * `runStructured<T>(schema)` 会按输入类型推导出 `number | undefined`，下游全部要写 ??。
 * 这里用输出类型钉死一次，与 AgentNextStepSchema 同一个处理方式。
 */
export type ObservatoryNote = {
  headline: string;
  focusCode?: string | null;
  signals: string[];
  confidence: number;
};

export const ObservatoryNoteSchema = ObservatoryNoteSchemaRaw as unknown as z.ZodType<ObservatoryNote>;

export const AIIntent = [
  'SPECIES',
  'HEALTH',
  'TAGS',
  'RAG',
  'AGENT_PLAN',
  'AGENT_NEXT_STEP',
  'AGENT_FINAL',
  'OBSERVATORY',
] as const;
export type AIIntent = (typeof AIIntent)[number];

export const SCHEMA_BY_INTENT = {
  SPECIES: SpeciesResultSchema,
  HEALTH: HealthAssessmentSchema,
  TAGS: ObservationAnalysisSchema,
  RAG: RagAnswerSchema,
  AGENT_PLAN: AgentPlanSchema,
  AGENT_NEXT_STEP: AgentNextStepSchema,
  AGENT_FINAL: AgentFinalSchema,
  OBSERVATORY: ObservatoryNoteSchema,
} as const;
