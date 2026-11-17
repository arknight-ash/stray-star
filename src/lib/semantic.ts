import type { AlertLevel, HealthLevel, ObservationType, Severity, Species } from '@/types/domain';

/**
 * 语义色唯一映射源。
 * 规则：全站绿/黄/红只允许从这里取色，禁止组件内硬编码十六进制
 * （由 .eslintrc.json 的 no-restricted-syntax 兜底拦截）。
 * 取值统一用 CSS 变量字符串，保证 tailwind 类与 inline style 两条路径一致。
 */

export const HEALTH_META: Record<
  HealthLevel,
  {
    /** 短标签，用于徽标/光谱条（颜色之外必须有文字冗余编码） */
    label: string;
    /** 叙事全名，用于 aria-label 与档案页 */
    starName: string;
    dot: string;
    text: string;
    bg: string;
    ring: string;
    glow: string;
  }
> = {
  GREEN: {
    label: '健康',
    starName: '健康 · 稳定星',
    dot: 'var(--star-green)',
    text: 'text-star-green',
    bg: 'bg-star-green/12',
    ring: 'ring-star-green/45',
    glow: '0 0 12px rgba(91,228,155,.35)',
  },
  YELLOW: {
    label: '观察',
    starName: '观察 · 闪烁星',
    dot: 'var(--star-yellow)',
    text: 'text-star-yellow',
    bg: 'bg-star-yellow/12',
    ring: 'ring-star-yellow/45',
    glow: '0 0 12px rgba(255,209,102,.35)',
  },
  RED: {
    label: '预警',
    starName: '预警 · 告警星',
    dot: 'var(--star-red)',
    text: 'text-star-red',
    bg: 'bg-star-red/12',
    ring: 'ring-star-red/45',
    glow: '0 0 12px rgba(255,107,107,.35)',
  },
};

export const ALERT_META: Record<
  AlertLevel,
  { label: string; dot: string; text: string; bg: string; ring: string }
> = {
  INFO: {
    label: '通知',
    dot: 'var(--star-green)',
    text: 'text-star-green',
    bg: 'bg-star-green/12',
    ring: 'ring-star-green/40',
  },
  WARN: {
    label: '提醒',
    dot: 'var(--star-yellow)',
    text: 'text-star-yellow',
    bg: 'bg-star-yellow/12',
    ring: 'ring-star-yellow/40',
  },
  CRITICAL: {
    label: '紧急',
    dot: 'var(--star-red)',
    text: 'text-star-red',
    bg: 'bg-star-red/12',
    ring: 'ring-star-red/40',
  },
};

export const SEVERITY_META: Record<Severity, { label: string; level: AlertLevel }> = {
  MILD: { label: '轻微', level: 'INFO' },
  MODERATE: { label: '中等', level: 'WARN' },
  SEVERE: { label: '严重', level: 'CRITICAL' },
};

/* ────────────────── 观察记录的 AI 解析结果（2026-10-28） ────────────────── */

/**
 * 记录分类的展示名。
 * 分类由 AI 判定（`lib/observations/analyze.ts`），界面只做翻译 ——
 * 不给用户「改分类」的入口，否则等于让人替模型重做一遍判断。
 */
export const OBS_TYPE_META: Record<ObservationType, { label: string; hint: string }> = {
  FEEDING: { label: '投喂', hint: '食物与水' },
  HEALTH: { label: '健康', hint: '症状与状态' },
  BEHAVIOR: { label: '行为', hint: '习性与互动' },
  OTHER: { label: '其他', hint: '暂未归类' },
};

export type ObservationSentiment = 'POSITIVE' | 'NEUTRAL' | 'CONCERNED' | 'URGENT';

/** 情感是「记录者语气」的判定，不是对动物的诊断 */
export const SENTIMENT_META: Record<
  ObservationSentiment,
  { label: string; tone: 'green' | 'paper' | 'yellow' | 'red' }
> = {
  POSITIVE: { label: '语气轻松', tone: 'green' },
  NEUTRAL: { label: '语气平静', tone: 'paper' },
  CONCERNED: { label: '语气担心', tone: 'yellow' },
  URGENT: { label: '语气急迫', tone: 'red' },
};

/** 实体类别 → 中文（展示 AI 到底抽出了什么） */
export const ENTITY_KIND_META: Record<string, string> = {
  BODY_PART: '部位',
  SYMPTOM: '症状',
  ACTION: '动作',
  FOOD: '食物',
  LOCATION: '地点',
  OBJECT: '物品',
};

export const SPECIES_META: Record<Species, { label: string; glyph: string }> = {
  CAT: { label: '猫', glyph: '猫' },
  DOG: { label: '狗', glyph: '犬' },
};

/** 健康等级 → 预警等级（规则引擎与地图红星脉冲共用同一套升级逻辑） */
export function healthToAlertLevel(level: HealthLevel): AlertLevel {
  if (level === 'RED') return 'CRITICAL';
  if (level === 'YELLOW') return 'WARN';
  return 'INFO';
}

/* ────────────────── 阶段 4：手账时间线 / 健康派生 的映射 ────────────────── */

/** 观察严重度 → 健康档。派生与时间线共用，避免两处各写一份后漂移 */
export const SEVERITY_HEALTH: Record<Severity, HealthLevel> = {
  MILD: 'GREEN',
  MODERATE: 'YELLOW',
  SEVERE: 'RED',
};

/** 预警等级 → 健康档 */
export const ALERT_TO_HEALTH: Record<AlertLevel, HealthLevel> = {
  INFO: 'GREEN',
  WARN: 'YELLOW',
  CRITICAL: 'RED',
};

/** 健康档的全序，用于比较「谁更严重」（派生规则里到处要用） */
export const HEALTH_ORDER: Record<HealthLevel, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

export function isHealthier(a: HealthLevel, b: HealthLevel): boolean {
  return HEALTH_ORDER[a] < HEALTH_ORDER[b];
}

/** 取两者中更严重的那一档 */
export function worseHealth(a: HealthLevel, b: HealthLevel): HealthLevel {
  return HEALTH_ORDER[a] >= HEALTH_ORDER[b] ? a : b;
}

/** 光谱条指针位置：三档均分，落在各自格子的中心 */
export const healthBarValue = (level: HealthLevel): number =>
  ({ GREEN: 0.17, YELLOW: 0.5, RED: 0.83 } as const)[level];

/**
 * 标签取色白名单。
 * 标签是 AI 与同学自由输入的，不可能穷举 —— 所以策略是「认得的给语义色，
 * 不认得的一律落到 amber（米色胶带）」，保证墙面上出现的每种颜色都有依据，
 * 而不是现场 hash 出一个随机的语义暗示。
 */
export const HEALTH_TAG_TONES: Record<string, 'green' | 'yellow' | 'red'> = {
  // 需要尽快处理
  外伤: 'red',
  出血: 'red',
  骨折: 'red',
  抽搐: 'red',
  呼吸困难: 'red',
  站不起来: 'red',
  // 需要留意
  食欲下降: 'yellow',
  消瘦: 'yellow',
  皮肤病: 'yellow',
  跛行: 'yellow',
  咳嗽: 'yellow',
  精神差: 'yellow',
  应激: 'yellow',
  流涕: 'yellow',
  // 正面 / 已处置
  投喂: 'green',
  已绝育: 'green',
  接种: 'green',
  驱虫: 'green',
  亲人: 'green',
  定点: 'green',
  精神好: 'green',
};

export function tagTone(tag: string): 'amber' | 'green' | 'yellow' | 'red' {
  return HEALTH_TAG_TONES[tag] ?? 'amber';
}

/**
 * 星轨步骤语义（阶段 8）。
 * /agent 的星轨可视化与 trace 是两套形状，但颜色必须同源：
 * running=暖金（星枢思考中，与呼吸星同色）、ok=绿、error=红、fallback=黄（改道警示）。
 * 组件里禁止直接写这些变量字符串，一律从这里取。
 */
export const TRAIL_STEP_META: Record<
  'running' | 'ok' | 'error' | 'fallback',
  { label: string; dot: string; text: string }
> = {
  running: { label: '进行中', dot: 'var(--accent-400)', text: 'text-accent-400' },
  ok: { label: '完成', dot: 'var(--star-green)', text: 'text-star-green' },
  error: { label: '失败', dot: 'var(--star-red)', text: 'text-star-red' },
  fallback: { label: '降级', dot: 'var(--star-yellow)', text: 'text-star-yellow' },
};

/** 星轨里 plan / final 两个特殊步的星形与文案 */
export const TRAIL_SPECIAL_META: Record<'plan' | 'final', { label: string; glyph: string }> = {
  plan: { label: '规划路径', glyph: '✦' },
  final: { label: '整合回复', glyph: '✧' },
};

/**
 * 工具的中文短名（阶段 9 补）。
 *
 * 星点下方只有 56px 宽，`queryArchive` 这种英文名会被截成 `queryArc…`，
 * 读者看不出这颗星干了什么。中文短名两到四个字正好放得下；
 * 英文原名仍保留在 tooltip 里，排查问题时对得上 trace。
 */
export const TRAIL_TOOL_LABEL: Record<string, string> = {
  identifyAnimal: '识别个体',
  assessHealth: '健康评估',
  queryArchive: '查档案',
  addObservation: '记一笔',
  checkAlerts: '查预警',
  searchKnowledge: '搜知识',
};

/** 取星轨标签用的短名：认得的走中文，认不得的原样显示（新工具不会被藏起来） */
export function trailToolLabel(tool: string): string {
  return TRAIL_TOOL_LABEL[tool] ?? tool;
}
