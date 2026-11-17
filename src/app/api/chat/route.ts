import { fail, ok, parseBody } from '@/lib/http';
import { RATE_LIMIT } from '@/lib/constants';
import { log } from '@/lib/logger';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { ChatRequestSchema } from '@/lib/api/chat-contract';
import { answerQuestion } from '@/lib/rag/answer';
import type { ChatData } from '@/lib/api/chat-contract';

/** Node runtime：检索要连库、要跑 Prisma */
export const runtime = 'nodejs';

/**
 * 幂等窗口：同一 clientId 30s 内复用结果。
 * 与 health/assess 同样的理由 —— 前端重试与双击不该烧两次检索 + 两次生成。
 */
const IDEMPOTENT_WINDOW_MS = 30_000;
const recent = new Map<string, { at: number; data: ChatData }>();

export async function POST(req: Request): Promise<Response> {
  const ip = clientIpFrom(req.headers);

  const verdict = rateLimit(`chat:${ip}`, RATE_LIMIT.chat);
  if (!verdict.ok) {
    return fail('RATE_LIMITED', `问得太快了，请 ${Math.ceil(verdict.retryAfterMs / 1000)} 秒后再试`);
  }

  const parsed = await parseBody(req, ChatRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { question, animalId, clientId } = parsed.data;

  if (clientId) {
    const hit = recent.get(clientId);
    if (hit && Date.now() - hit.at < IDEMPOTENT_WINDOW_MS) {
      return ok(hit.data);
    }
  }

  const result = await answerQuestion({ question, animalId, clientId });
  if (!result.ok) {
    // 内容安全属于"用户改一下就能继续"，不该记成服务端错误
    if (result.code !== 'MODERATION_BLOCKED') {
      log.warn('chat.failed', { code: result.code });
    }
    return fail(result.code, result.message);
  }

  if (clientId) {
    recent.set(clientId, { at: Date.now(), data: result.data });
    if (recent.size > 200) {
      for (const [key, value] of recent) {
        if (Date.now() - value.at > IDEMPOTENT_WINDOW_MS) recent.delete(key);
      }
    }
  }

  return ok(result.data);
}
