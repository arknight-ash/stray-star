import { ok, fail } from '@/lib/http';
import { RATE_LIMIT } from '@/lib/constants';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { resolveActor } from '@/lib/auth/actor';
import { loadAlertBoard } from '@/lib/admin/alerts';
import { AlertLevelSchema, AlertStatusFilterSchema } from '@/lib/api/alert-contract';

export const runtime = 'nodejs';

/**
 * 预警待办列表（阶段 7）。
 *
 * 只读接口也要求通过门禁解析 actor：前端要据它决定按钮能不能点，
 * 而这个判断必须和服务端的裁决同源（不然又是一处"前端以为可以、后端拒绝"）。
 */
export async function GET(req: Request): Promise<Response> {
  const ip = clientIpFrom(req.headers);
  const verdict = rateLimit(`adminList:${ip}`, RATE_LIMIT.adminAction);
  if (!verdict.ok) return fail('RATE_LIMITED', '请求过于频繁，请稍后再试');

  const url = new URL(req.url);
  const status = AlertStatusFilterSchema.safeParse(url.searchParams.get('status') ?? 'ALL');
  if (!status.success) return fail('BAD_REQUEST', 'status 只支持 ALL / OPEN / ACK / RESOLVED');

  const levelRaw = url.searchParams.get('level');
  const level = levelRaw ? AlertLevelSchema.safeParse(levelRaw) : null;
  if (level && !level.success) return fail('BAD_REQUEST', 'level 只支持 INFO / WARN / CRITICAL');

  const actor = await resolveActor(req);
  const board = await loadAlertBoard({
    status: status.data,
    ...(level?.success ? { level: level.data } : {}),
  });

  return ok({
    ...board,
    actor: { kind: actor.kind, role: actor.kind === 'anonymous' ? null : actor.role },
  });
}
