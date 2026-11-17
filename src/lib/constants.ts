/** 站点级常量：叙事文案 + 阈值。阈值统一在这里，规则引擎与 UI 共用一份。 */

/**
 * 非 CSS 场景（viewport.themeColor / Canvas 绘制）需要的原始色值。
 * 必须与 src/styles/tokens.css 的 --space-900 保持一致，改色时两处同步。
 */
const TOKEN_RAW = {
  space900: '#0B1026',
} as const;

export const SITE = {
  name: '智护流浪星',
  tagline: '让每只校园流浪动物被认识、被了解、被持续关注',
  campus: '武汉华夏理工学院 · 光谷校区',
  /** 浏览器地址栏/状态栏着色，对应 --space-900 */
  themeColor: TOKEN_RAW.space900,
} as const;

/** 向量检索阈值：>= MATCH 直接命中；[CANDIDATE, MATCH) 进入灰区候选；< CANDIDATE 视为新个体 */
export const MATCH_THRESHOLD = 0.86;
export const CANDIDATE_THRESHOLD = 0.72;

/**
 * 个体识别（/api/identify）专属阈值。
 *
 * 为什么不与上面的 RAG 阈值共用：两者分数空间不同。
 * RAG 面对的是「噪声混淆也很像」的长文本（0.86 才敢用），
 * 而个体识别面对的是「描述一两个词就会误命中」的短语，
 * 这套值是拿种子数据实测出来的（见 docs/stage-3-identify.md 第 1 节），别随手改。
 */
export const IDENTIFY_MATCH = 0.7;
export const IDENTIFY_CANDIDATE = 0.45;
/**
 * 打分的两路权重（向量 / 关键词）。
 *
 * 不用 max：语义向量对毛色这类视觉差异不敏感，同物种个体的余弦会挤在一起
 * （实测黑猫 0.746 与白猫 0.777 只差 0.03，排序会颠倒）；关键词路则对
 * 「左耳绝育耳标」「异瞳」这类独有词很敏感。留 0.2 的权重正好能把排序纠回来，
 * 又不会让「猫 短毛」这类泛化描述单独决定结果（那部分是 max 时代踩过的坑）。
 */
export const IDENTIFY_VEC_WEIGHT = 0.8;
export const IDENTIFY_KW_WEIGHT = 0.2;
/** top1 与 top2 的差距不足此值 → 撞脸，降级为 candidate，不替用户拍板 */
export const SCORE_MARGIN_MIN = 0.08;
/** 查询侧实词（去虚词后的 token）不足此数 → 描述太短，不允许 matched */
export const QUERY_TOKEN_MIN = 4;
/** 视觉物种与候选档案物种冲突时的打折系数 */
export const SPECIES_MISMATCH_MUL = 0.6;
/**
 * 「模型说了算」的置信度门槛（>= 0.75）。
 * 低于此值时视觉判定不自信任：它的泛化特征不进检索查询，
 * 它的物种结论也不参与否决候选 —— 模型自己都没把握时不该拥有否决权。
 */
export const VISION_TRUST_FLOOR = 0.75;

/** 置信度闸门：低于该值一律展示「不确定」提示，并要求人工复核 */
export const CONFIDENCE_FLOOR = 0.6;

/**
 * 视觉链路挂掉后退回「只看文字」的门槛：描述至少这么长，重试才有意义。
 *
 * 为什么要有下限：一句「有点不对」撑不起一份健康结论，
 * 拿它去烧第二次模型调用只会换回一份更像真的胡猜。
 */
export const TEXT_ONLY_MIN_CHARS = 6;

/**
 * 「这次没看到照片」的提示文案（唯一事实源）。
 *
 * 出现在健康面板、Agent 执行摘要两处 —— 两处各自拼一句话，迟早一处说「没看照片」、
 * 另一处说「已看照片」。degraded 里记的是 `visionUnavailable:CODE`，人话在这里。
 */
export const VISION_FALLBACK_NOTE =
  '这次照片没能交给 AI（视觉服务不可用），结论只依据你的文字描述，建议补拍一张清晰照片再评估一次。';

/** 文本输入长度（与 Zod 契约保持一致） */
export const LIMITS = {
  note: 200,
  observation: 500,
  question: 300,
  imageBytes: 8 * 1024 * 1024,
  name: 24,
  summary: 200,
  featureLen: 40,
  featureCount: 8,
  /** 昵称：够表达身份即可，长了会挤爆便签的 figcaption */
  authorName: 16,
  /** Agent 对话消息：一句话任务描述，长了 ReAct 决策会漂 */
  agentMessage: 500,
} as const;

/** 固定窗口限流（按 IP + 端点）：无 key 环境下每次识别都在烧钱/算力 */
export const RATE_LIMIT = {
  windowMs: 60_000,
  identify: 10,
  animalCreate: 3,
  /** 众包提交比识别宽松一个数量级：它便宜，而且是我们要鼓励的行为 */
  observationCreate: 20,
  /**
   * 健康评估比识别更贵（图 + 长输出），但比众包提交更需要克制：
   * 它是唯一会改变健康档位、进而可能推动预警的入口，频率必须压得住。
   */
  healthAssess: 8,
  /** 问答比识别便宜（只有文本），但一次问两会烧两次检索 + 两次生成，给个中间值 */
  chat: 12,
  /**
   * Agent 是全站最贵的入口：一次对话可能串 2-3 次结构化生成 + 写库 + 预警评估。
   * 每分钟 6 次足够真人连续演示，又压得住刷接口烧 Provider 配额。
   */
  agent: 6,
  /**
   * Agent 控制（暂停/继续/跳过/接管，2026-10-28）。
   * 它不烧 AI、不写库，只翻一个内存标志位；但用户在闸门前会连点几下，
   * 给到 60 次/分既不会被误伤，也挡住把控制通道当探测接口刷的行为。
   */
  agentControl: 60,
  /** 管理端登录：口令猜测必须压住，一分钟五次足够真人输错 */
  adminLogin: 5,
  /** 管理端处置动作：比登录宽松两个数量级，管理员一天要点几十次 */
  adminAction: 120,
} as const;

/**
 * RAG 检索闸门（阶段 6 实测标定，见 docs/stage-6-rag.md §0② 与 §4）。
 *
 * 背景：原来只有一个 MIN_SCORE = 0.25，实测 4 个「库里确实有答案」的问题漏掉 2 个
 * （「捡到受伤的猫怎么止血」top1 只有 0.125）。根因是关键词覆盖率对
 * 「短问题 + 长文档」天然偏低 —— query 里 4 个 token 只中 1 个，分母还是 4。
 *
 * 双轨：
 * - ABS_MIN 挡「完全无关」（"今天天气不错" 0.059 进不来，"止血" 0.125 能进）
 * - REL_MIN 判「并列」：top1 没比 top2 高出这么多就说明检索器分不清，
 *   此时两条都保留并标注 tied，由前端如实展示"两条资料都相关"，
 *   而不是假装其中一条更权威。
 *
 * 接真实 Provider 后必须重测：真实余弦分普遍 0.7+，两套分数空间不能共用
 * （MATCH_THRESHOLD 与 IDENTIFY_MATCH 分开定义已经踩过这个坑）。
 */
export const RAG_ABS_MIN = 0.12;
export const RAG_REL_MIN = 0.05;
/** 命中【小标题】或标题的查询 token 的权重倍数 */
export const RAG_EMPHASIS_MUL = 1.5;
/** 检索条数：引太多会稀释 prompt，也会让引用列表长得没人看 */
export const RAG_TOP_K = 4;
/** 同一篇最多贡献几段：否则一篇长文会占满全部引用位 */
export const RAG_PER_DOC_MAX = 2;

/**
 * 问答兜底文案（唯一事实源）。
 *
 * 两种「空」必须分开：知识库空是"没有这类知识"，档案空是"没有这条记录"。
 * 前者不该引导用户去记录一笔 —— 记了也进不了知识库。
 */
export const FALLBACK_TEXT = {
  no_knowledge: '知识库里暂时没有这方面的资料，我不敢瞎猜。换个说法，或联系管理员补充护理资料。',
  /** 用户指定的原话，逐字不得改动 */
  no_animal_record: '档案里暂时没有这条记录，要不要记录一笔？',
  ai_unavailable: 'AI 暂时不可用，以下是检索到的原文。',
  /**
   * 敏感内容阻断（阶段 9 收口）：此前 health/assess 与 observations/create 各抄一份、
   * safety/fallback.ts 又存一份死代码 —— 全站阻断话术只许从这里取。
   */
  moderation_blocked: '内容包含不合适的描述，已阻止提交。请修改后再试。',
} as const;

/**
 * 预警规则的可调参数（阶段 7）。
 *
 * 为什么单独拎出来：R7 要求阈值集中一处，而规则真正会被质疑的永远是"几天/几条"。
 * 调这里比改 rules.ts 里的字面量安全 —— selftest 直接读同一份配置做边界断言。
 */
export const ALERT_RULE_CONFIG = {
  /** 回溯窗口（天）：负面标签爆发与中度爆发共用 */
  windowDays: 7,
  /** R5：窗口内几条「带负面标签的记录」才发 WARN */
  negativeCount: 2,
  /** R2：窗口内几次 MODERATE/SEVERE 报告才发 WARN */
  moderateCount: 3,
  /**
   * R5 的计数口径：'records' = 按记录条数（同一条里写两个负面标签只算一次）。
   * 之所以默认按记录：一个人写一条「外伤、出血、站不起来」就能触发按标签口径的告警，
   * 待办列表会被一次情绪化的长文刷满，而按记录数至少要求两个人在两天里分别看见。
   */
  negativeMode: 'records' as 'records' | 'tags',
} as const;

/**
 * 触发预警后给提交者的提示（阶段 7）。
 * 措辞只留这一处：它出现在 toast、手账、自测断言三处，任何一处自己拼都会慢慢走样。
 */
export const ALERT_NOTICE = '已通知管理员';

/**
 * 同学手动勾了「情况紧急」时的提示（2026-10-27）。
 * 与 ALERT_NOTICE 分开：那一句只说"传达到了"，这一句要说清"有人在赶来" ——
 * 勾紧急的人正盯着手机等回应，含糊的话等于没回应。
 */
export const MANUAL_SEVERE_NOTICE = '已提醒管理员尽快前往处理';

/**
 * 健康等级派生窗口（天）。
 * 超过窗口的旧记录不再证明任何当下的事 —— 三个月前的一次打喷嚏
 * 不该让今天这只动物继续挂着「观察」档。
 */
export const HEALTH_WINDOW_DAYS = 14;

/**
 * 校园围栏。地图初始视野与建档落点校验共用同一份。
 * 备注：这里给的是兜底默认值，运行时优先读 CAMPUS_CENTER_* 环境变量（见 lib/map-config.ts）。
 *
 * 坐标口径：**必须是 WGS-84**。本项目的所有坐标（seed / 识别落库 / 围栏校验）都按 WGS-84 存，
 * 由 lib/map-config.ts 的 toTileLatLng() 在画到 GCJ-02 瓦片前统一纠偏。
 * 直接把国内地图 POI 查到的数值抄进来会整片偏 500 米 —— 那些是 GCJ-02，
 * 抄之前先用 geo.ts 的 gcj02ToWgs84() 反解。
 *
 * 当前值反解自腾讯 POI「武汉华夏理工学院(光谷校区)」的 GCJ-02 中心 (30.467068, 114.411298)。
 */
export const CAMPUS = {
  lat: 30.469384,
  lng: 114.405764,
  zoom: 17,
  radiusM: 2000,
} as const;

export const EMBEDDING_DIM = 1536;

/**
 * 星枢AI 的开场自我介绍（2026-10-29）。
 *
 * 用户要求「每次使用星枢 AI 时，它先说一句我是谁、能做什么」。
 * 做成**常驻的第一条消息**而不是空态卡片：空态卡片一开口就消失，
 * 而这句话本身就是开场白，滚上去还应该看得见。
 *
 * abilities 必须与工具注册表对得上 —— 它写的是 AI 真做得到的事，
 * 不是营销词。改工具集时同步改这里，否则就是当众承诺做不到的事。
 */
export const AGENT_INTRO = {
  hello: '我是星枢AI —— 校园流浪动物的智能助手。',
  abilities: [
    '看图认出是哪一只',
    '评估健康状况',
    '把观察写进档案',
    '记住它在哪出现',
    '查未处理的预警',
    '答护理知识',
  ],
  howTo:
    '一句话说清要办的事，我规划路径、逐个调工具，每一步都在星轨上看得见；你随时可以暂停看我的下一步，或直接接管。',
} as const;

/**
 * Agent 编排上限。
 *
 * timeoutMs 是「单个工具执行」的上限。mock 时代 8s 绰绰有余，
 * 但接真模型后工具本身要等一次 AI 调用（看图实测 11s+），
 * 所以允许用 AGENT_TOOL_TIMEOUT_MS 覆盖；默认仍保持 8s 不变。
 */
export const AGENT_LIMITS = {
  maxSteps: 6,
  maxToolCalls: 5,
  timeoutMs: Number(process.env.AGENT_TOOL_TIMEOUT_MS) || 8000,
  /**
   * 入参被 zod 拒掉的最多次数（2026-10-28）。
   * 被拒 = 工具**一次都没执行**，没有副作用可挽回，所以不按「工具失败」立即降级：
   * 把错误回灌给决策模型让它自己改参数/换工具（这才是 ReAct 的本意）。
   * 连续被拒到这个数才认定模型不会用工具，退回 RAG 安全航线。
   */
  maxRejectedArgs: 2,
  /**
   * 同一个「工具 + 参数」被重复请求的最多次数（2026-10-28）。
   * 参数一样结果就一定一样，第二次执行纯属浪费一次模型调用；但直接结束工具阶段
   * 又会让「评估完还没写档案」的任务半途而废。所以第一次重复把已有结果当观察回灌，
   * 催它往下走；累计到这个数说明它真的在原地打转，才收尾。
   */
  maxRepeatedCalls: 2,
  /**
   * 人在回路的闸门等待上限（2026-10-28）。
   * 到点按「接管」处理：用户可能只是关了页面，此时继续执行工具（写库、发预警）
   * 比停下来更危险。3 分钟足够一个答辩现场讲完"AI 打算做什么"。
   */
  gateTimeoutMs: Number(process.env.AGENT_GATE_TIMEOUT_MS) || 180_000,
  /** 一次 Agent 请求最多附带的照片数（多模态）：伤口特写 + 全身 + 环境，三张足够 */
  maxPhotos: 3,
} as const;

export const DISCLAIMER =
  '本平台的健康评估由 AI 基于照片与描述生成，仅供参考，不构成兽医诊断。如动物出现明显异常，请联系校兽医或当地动保组织处理。';

/**
 * 「AI 星图观测手记」的参数（2026-10-28）。
 *
 * 这张卡片展示的是 AI **主动**读全局数据写的一句话，不是被动问答 —— 它每次生成都要烧一次
 * 模型调用，所以必须缓存；但缓存太久又会变成"上一批数据的化石"，让评委看到一句解释不了
 * 当前页面的话。折中：指纹（数据一变就重算）+ 10 分钟上限。
 *
 * 数字全在这里，`insight:selftest` 直接读同一份配置做边界断言 —— 不要在代码里写字面量。
 */
export const OBSERVATORY = {
  /** 同一份数据的缓存上限 */
  ttlMs: 10 * 60 * 1000,
  /**
   * AI 失败后的缓存上限。
   * 比成功短得多：一次上游抖动不该把整晚的卡片钉在「本地摘要」上 ——
   * 但也不能每来一个人就重试一次，那会在上游过载时把它压得更死。
   */
  failTtlMs: 60 * 1000,
  /** 活跃度对照窗口（天）：最近 3 天 vs 之前 7 天 */
  recentDays: 3,
  /** 对照参照窗口（天） */
  baselineDays: 10,
  /** 参与决策的候选星上限：给模型 6 只，再多它只会挑第一只 */
  maxCandidates: 6,
  /** 多久没有新记录算「安静」，进入候选 */
  quietDays: 5,
  /**
   * 单次生成的上限（毫秒）。
   *
   * 为什么必须卡这么死：这句话是**页面渲染时同步算的**，上游一慢，
   * 整张星图就跟着卡住（实测 GLM 抖动时首屏 20s+）。超过这个时间就认输，
   * 用本地摘要先把页面交出去，60 秒后再试 —— 用户不该为一句锦上添花的话等 20 秒。
   */
  aiTimeoutMs: 6000,
  /**
   * 首屏愿意为这句话等多久（毫秒），比 `aiTimeoutMs` 更短。
   *
   * 6 秒的上限只保证"不会等十几秒"，可只要上游在过载，它就会稳定地慢满 6 秒 ——
   * 首屏白白多等 6 秒只为一行摘要，答辩现场很难看。所以渲染只等这么久：
   * 等不到先交本地摘要，AI 的结果落地后自己进缓存，下一次进页面看到的就是模型那句。
   */
  renderBudgetMs: 2500,
} as const;

/**
 * 低置信度的统一提示（R5）。
 * 服务端把它塞进 `HealthAssessData.uncertainNote`，前端在拿不到时也用它兜底 ——
 * 之前前端直接用识别链路的 `UncertainNote` 默认文案，会冒出「没能可靠判定物种」这种
 * 跟健康毫无关系的句子。措辞只留这一处。
 */
export const UNCERTAIN_NOTE = 'AI 不确定，建议人工确认';

/**
 * JS 侧的动效参数（R3 的例外出口）。
 * Framer Motion 只吃数字，读不到 CSS 变量，所以星点脉冲以前在组件里直接写 `2.4`。
 * 现在统一从这里取：**必须与 tokens.css 的 `--dur-pulse` 保持一致**，改一边要同时改另一边
 * （`health:selftest` 不校验这条，靠 review 时对一眼）。
 */
export const MOTION = {
  /** 秒。对应 --dur-pulse: 2400ms */
  pulseSec: 2.4,
} as const;
