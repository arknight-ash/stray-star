import { getEmbedding } from '../ai/embeddings';

/**
 * 视觉指纹：把「AI 从照片里看到的的东西」变成可检索的向量。
 *
 * 这里是全站唯一的检索向量出口（阶段 3 修正的重点）：
 * seed / 识别 / 建档三侧都必须调用 embedForRetrieval，谁绕过谁引入 bug ——
 * 曾经 seed 直写 hashEmbedding、运行时用 provider.embed，
 * 两边不在同一向量空间，切到真实 Provider 后所有分数归零、全部误判为「未登记星」且不报错。
 *
 * note 的作用域：只用于关键词路（keywordQueryText），不进 fingerprintText。
 * 理由见 docs/stage-3-identify.md 决策 2 —— 用户自由文本不应污染语义向量空间。
 */

export interface FingerprintInput {
  /** 视觉判定出的物种中文名（猫 / 狗）；UNKNOWN 时留空 */
  speciesLabel?: string;
  /** vision 给出的外观特征 */
  features: string[];
}

/** 参与向量检索的文本：只有视觉侧产出（物种 + 特征） */
export function fingerprintText(input: FingerprintInput): string {
  return dedupe([input.speciesLabel ?? '', ...input.features]).join(' ');
}

/** 参与关键词匹配的文本：视觉特征 + 用户补充描述 */
export function keywordQueryText(input: FingerprintInput, note?: string): string {
  return dedupe([...(input.speciesLabel ? [input.speciesLabel] : []), ...input.features, note ?? '']).join(
    ' ',
  );
}

/**
 * 唯一向量出口。内部走 getEmbedding：
 * 真实 Provider 失败时自动降级到本地确定性向量，因此调用方无需处理失败。
 */
export async function embedForRetrieval(text: string): Promise<number[]> {
  return getEmbedding(text);
}

export async function embedFingerprint(input: FingerprintInput): Promise<number[]> {
  return embedForRetrieval(fingerprintText(input));
}

function dedupe(parts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const text = part.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}
