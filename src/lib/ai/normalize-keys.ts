/**
 * 模型输出的键名 / 枚举值归一化（2026-10-29）。
 *
 * 为什么需要这一层 —— 一次真实事故：
 *   主视觉模型 `glm-4.6v-flash` 持续过载（日志里每次都是 model_overloaded_next），
 *   请求基本都降级到 `glm-4.5v`；而 4.5v 偶尔会把 JSON 的**键名连同枚举值一起翻成中文**：
 *
 *     {"评估":"…","健康状态":"红色","严重程度":"严重","置信度":0.85,"需要看兽医":true}
 *
 *   契约按 `assessment / healthStatus / severity / confidence / needsVet` 取值，
 *   6 个必填字段全被判「缺失」，整条视觉结果被丢弃 → 退回纯文字 → 界面显示
 *   「照片没能交给 AI（视觉服务不可用）」。用户以为服务挂了，其实模型答得好好的。
 *
 * 只做两件事，绝不猜语义：
 *   1. **键名**：中文别名 → 英文键；同时兼容英文的大小写变体（`Assessment` → `assessment`）。
 *      目标键已存在时**不覆盖**（模型的英文输出优先于中文别名）。
 *   2. **枚举值**：`severity` / `healthStatus` 这类固定档位，把「严重」「红色」折回
 *      `SEVERE` / `RED`；大小写不规范的英文（`severe`）也一并折回。
 *
 * 刻意**不递归**：只处理顶层对象。`args`、`form` 这类业务字段由各自的契约负责，
 * 在这一层瞎猜键名只会把用户数据改坏。
 */

/** 中文键 → 英文键。目标值必须与 zod 契约里的字段名逐字一致 */
const KEY_ALIASES: Record<string, string> = {
  // —— 健康评估 ——
  评估: 'assessment',
  分析: 'assessment',
  评估结果: 'assessment',
  健康评估: 'assessment',
  健康状态: 'healthStatus',
  健康等级: 'healthStatus',
  // 2026-10-29 实测补：模型给的是「健康状况」，而表里只有「健康状态」，
  // 一个字之差就让 healthStatus 判缺失、整份评估作废。
  健康状况: 'healthStatus',
  健康级别: 'healthStatus',
  健康分级: 'healthStatus',
  健康评级: 'healthStatus',
  状态: 'healthStatus',
  严重程度: 'severity',
  严重性: 'severity',
  严重等级: 'severity',
  建议: 'advice',
  建议列表: 'advice',
  处理建议: 'advice',
  置信度: 'confidence',
  可信度: 'confidence',
  信心: 'confidence',
  需要看兽医: 'needsVet',
  需要兽医: 'needsVet',
  是否需要兽医: 'needsVet',
  是否需就医: 'needsVet',
  需就医: 'needsVet',
  要看兽医: 'needsVet',
  看兽医: 'needsVet',
  是否需要就医: 'needsVet',
  需要就医: 'needsVet',
  需要就诊: 'needsVet',
  需要治疗: 'needsVet',
  是否就医: 'needsVet',
  就医: 'needsVet',
  信号: 'signals',
  观察要点: 'signals',
  迹象: 'signals',
  // —— 观察解析 / 问答 / 识别 ——
  标签: 'tags',
  关键词: 'tags',
  类型: 'type',
  分类: 'type',
  摘要: 'summary',
  概述: 'summary',
  总结: 'summary',
  回答: 'answer',
  答案: 'answer',
  引用: 'citations',
  来源: 'citations',
  标题: 'headline',
  关注对象: 'focusCode',
  焦点: 'focusCode',
  物种: 'species',
  种类: 'species',
  品种: 'breed',
  毛色: 'colors',
  颜色: 'colors',
  特征: 'features',
  特点: 'features',
  动作: 'action',
  工具: 'tool',
  参数: 'args',
  理由: 'why',
  原因: 'why',
  步骤: 'steps',
};

/** 别名表能映射到的英文键集合：用来识别「英文但大小写不对」的键，无需反射 zod schema */
const KNOWN_KEYS = new Set(Object.values(KEY_ALIASES));

/** 固定档位的中文说法 → 英文枚举 */
const VALUE_ALIASES: Record<string, Record<string, string>> = {
  severity: {
    严重: 'SEVERE',
    重度: 'SEVERE',
    危重: 'SEVERE',
    危急: 'SEVERE',
    紧急: 'SEVERE',
    中度: 'MODERATE',
    中等: 'MODERATE',
    较重: 'MODERATE',
    一般: 'MODERATE',
    轻度: 'MILD',
    轻微: 'MILD',
    较轻: 'MILD',
  },
  healthStatus: {
    红色: 'RED',
    红: 'RED',
    预警: 'RED',
    危险: 'RED',
    黄色: 'YELLOW',
    黄: 'YELLOW',
    观察: 'YELLOW',
    注意: 'YELLOW',
    绿色: 'GREEN',
    绿: 'GREEN',
    健康: 'GREEN',
    正常: 'GREEN',
  },
};

/** 每个枚举字段允许的英文值，用来回收 `severe` / `Red` 这类大小写不规范 */
const ALLOWED_VALUES: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(VALUE_ALIASES).map(([key, map]) => [key, new Set(Object.values(map))]),
);

/**
 * 「整个结果被套在一个键里」的结构性畸形。
 *
 * 实测（2026-10-29 11:32，glm-4v-flash）模型把本该平铺的对象整个塞进了 assessment：
 *
 *   {"assessment":{"healthStatus":"GREEN","severity":"MILD","advice":[…],"confidence":1}}
 *
 * 这不是语义问题，是层级错了，可以无损拆开 —— 但必须严格设限，否则会把正常嵌套改坏：
 *   ① 顶层只能有一个键；
 *   ② 内层必须是对象；
 *   ③ 内层至少命中 2 个已知字段（一眼就能看出它才是本体）。
 */
const WRAPPER_KEYS = new Set([
  'assessment',
  'result',
  'data',
  'payload',
  'output',
  '健康评估',
  '评估结果',
  '结果',
  '回答',
]);

function unwrapSingleObject(source: Record<string, unknown>): Record<string, unknown> | null {
  const entries = Object.entries(source);
  if (entries.length !== 1) return null;
  const [key, value] = entries[0];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!WRAPPER_KEYS.has(key) && !KNOWN_KEYS.has(canonicalKey(key))) return null;
  const inner = value as Record<string, unknown>;
  const hits = Object.keys(inner).filter((k) => KNOWN_KEYS.has(canonicalKey(k))).length;
  return hits >= 2 ? inner : null;
}

function canonicalKey(rawKey: string): string {
  const key = rawKey.trim();
  if (!key) return rawKey;
  const alias = KEY_ALIASES[key];
  if (alias) return alias;
  // 英文大小写变体：Assessment → assessment、HEALTHSTATUS → healthStatus
  const lower = key.toLowerCase();
  const byLower = Object.keys(KEY_ALIASES).find(
    (k) => KEY_ALIASES[k].toLowerCase() === lower,
  );
  return byLower ? KEY_ALIASES[byLower] : key;
}

function canonicalValue(field: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const map = VALUE_ALIASES[field];
  if (!map) return value;
  const text = value.trim();
  const direct = map[text];
  if (direct) return direct;
  const upper = text.toUpperCase();
  return ALLOWED_VALUES[field]?.has(upper) ? upper : value;
}

/**
 * 归一化一层对象。**没有任何改动时返回原引用**，
 * 便于调用方判断「这次到底动没动」，日志里也好区分。
 */
export function normalizeModelKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

  const source = value as Record<string, unknown>;

  // 先看是不是「整体被套进一个键」的结构性畸形，是就先拆掉再走后续流程
  const unwrapped = unwrapSingleObject(source);
  if (unwrapped) return normalizeModelKeys(unwrapped);

  const out: Record<string, unknown> = {};
  let changed = false;

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = canonicalKey(rawKey);
    if (key !== rawKey) {
      changed = true;
      // 模型同时给了英文键和中文键时，英文那份说了算
      if (key in source) continue;
    }
    out[key] = rawValue;
  }

  for (const field of Object.keys(ALLOWED_VALUES)) {
    if (!(field in out)) continue;
    const before = out[field];
    const after = canonicalValue(field, before);
    if (after !== before) {
      out[field] = after;
      changed = true;
    }
  }

  return changed ? out : value;
}
