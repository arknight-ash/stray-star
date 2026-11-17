import { EMBEDDING_DIM } from '../constants';
import { log } from '../logger';
import { getProvider } from './registry';
import { normalize } from '../db/vector';
import { hashEmbedding } from './embedding-local';

export { hashEmbedding, tokenize } from './embedding-local';

/**
 * 统一 embedding 入口。
 * 真实 Provider 不可用时（无 key / 超时 / 维度不符）自动降级到本地确定性向量，
 * 保证检索链路永远可用，而不是直接 500。
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const provider = getProvider();
  try {
    const vec = await provider.embed(text);
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
      throw new Error(`embedding 维度异常：${Array.isArray(vec) ? vec.length : '非数组'}`);
    }
    return normalize(vec);
  } catch (err) {
    log.warn('ai.embed_fallback', {
      provider: provider.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return normalize(hashEmbedding(text));
  }
}
