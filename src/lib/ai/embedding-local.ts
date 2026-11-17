import { EMBEDDING_DIM } from '../constants';

/**
 * 本地确定性词袋向量（mock Provider 与降级路径共用）。
 * 特点：同一文本恒定得到同一向量；含相同关键词的文本余弦相似度显著更高。
 * 因此种子数据下的「向量检索」是真实有效的，不是随机占位。
 */
export function hashEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = tokenize(text);

  for (const token of tokens) {
    // 两个独立哈希降低碰撞；权重按词长给一点区分度
    for (const seed of [1, 2]) {
      const h = hash32(`${seed}:${token}`);
      vec[h % EMBEDDING_DIM] += 1 + Math.min(3, token.length / 4);
    }
  }

  return vec;
}

export function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!cleaned) return [];

  const tokens: string[] = [];

  // 中文按 2-gram 切分（无需分词器也能得到可用的重叠特征）
  for (const chunk of cleaned.match(/[\p{Script=Han}]+/gu) ?? []) {
    if (chunk.length === 1) {
      tokens.push(chunk);
      continue;
    }
    for (let i = 0; i < chunk.length - 1; i += 1) tokens.push(chunk.slice(i, i + 2));
  }

  for (const word of cleaned.match(/[a-z0-9]+/g) ?? []) tokens.push(word);
  return tokens;
}

export function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
