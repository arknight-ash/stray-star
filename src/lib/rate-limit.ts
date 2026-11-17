import { RATE_LIMIT } from './constants';

/**
 * 固定窗口限流（按 key 通常是 IP + 端点）。
 *
 * 说明：进程内内存计数。单机 / 单实例部署足够（本项目就是），
 * 多副本部署时应换成 Redis —— 但接口签名不变，替换即可。
 * 之所以非要限流：没有 API key 的环境里每次识别都在真实消耗算力和 token。
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateVerdict {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(key: string, limit: number, windowMs = RATE_LIMIT.windowMs): RateVerdict {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    sweep(now);
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, remaining: 0, retryAfterMs: Math.max(0, bucket.resetAt - now) };
  }
  return { ok: true, remaining: Math.max(0, limit - bucket.count), retryAfterMs: 0 };
}

/** 顺手清理过期桶，避免长期运行内存缓慢增长 */
function sweep(now: number): void {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** 仅供自测清空计数 */
export function resetRateLimits(): void {
  buckets.clear();
}
