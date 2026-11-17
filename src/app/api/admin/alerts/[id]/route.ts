import { fail, ok, parseBody } from '@/lib/http';
import { RATE_LIMIT } from '@/lib/constants';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { resolveActor } from '@/lib/auth/actor';
import { ackAlert, resolveAlert } from '@/lib/admin/alerts';
import { idempotent } from '@/lib/api/idempotent';
import { AlertActionSchema } from '@/lib/api/alert-contract';

export const runtime = 'nodejs';

/**
 * 处置一条预警（阶段 7）。
 *
 * ACK = 我已知悉（匿名可操作）；RESOLVED = 这件事结了（CRITICAL 只给管理员，R8）。
 * 权限裁决的唯一出处是 `lib/permissions.ts`，被拒时把它的原话回给前端 ——
 * 不在这一层改写措辞，否则用户看到的理由和真正的规则会慢慢对不上。
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const ip = clientIpFrom(req.headers);
  const verdict = rateLimit(`adminAct:${ip}`, RATE_LIMIT.adminAction);
  if (!verdict.ok) return fail('RATE_LIMITED', '操作过于频繁，请稍后再试');

  const body = await parseBody(req, AlertActionSchema);
  if (!body.ok) return body.response;

  const actor = await resolveActor(req);
  const { action, note, clientId } = body.data;

  const result = await idempotent(clientId ? `alert:${action}:${params.id}:${clientId}` : undefined, () =>
    action === 'ACK' ? ackAlert(params.id, actor, note) : resolveAlert(params.id, actor, note),
  );

  if (!result.ok) {
    return fail(result.code, result.message);
  }
  return ok(result.data);
}
