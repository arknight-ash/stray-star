import { fail, ok } from '@/lib/http';
import { RATE_LIMIT } from '@/lib/constants';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { resolveActor } from '@/lib/auth/actor';
import { deleteObservation } from '@/lib/admin/observations';

export const runtime = 'nodejs';

/**
 * 删除一条观察记录（管理端专用）。
 * 裁决在 lib/admin/observations.ts 的 canDeleteObservation：只有管理员能删，
 * 客户端没有也不该有这个入口。
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const ip = clientIpFrom(req.headers);
  const verdict = rateLimit(`obsDel:${ip}`, RATE_LIMIT.adminAction);
  if (!verdict.ok) return fail('RATE_LIMITED', '操作过于频繁，请稍后再试');

  const actor = await resolveActor(req);
  const result = await deleteObservation(params.id, actor);
  if (!result.ok) return fail(result.code, result.message);
  return ok(result.data);
}
