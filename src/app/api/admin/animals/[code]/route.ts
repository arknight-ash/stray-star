import { fail, ok } from '@/lib/http';
import { RATE_LIMIT } from '@/lib/constants';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { resolveActor } from '@/lib/auth/actor';
import { deleteAnimal } from '@/lib/admin/animals';

export const runtime = 'nodejs';

/**
 * 删除档案（管理端）：下架「已经找不到的小动物」。
 * 删除不可逆，canDelete 只放行管理员；审计里留档（谁、何时、删了谁）。
 */
export async function DELETE(
  req: Request,
  { params }: { params: { code: string } },
): Promise<Response> {
  const ip = clientIpFrom(req.headers);
  const verdict = rateLimit(`animalDel:${ip}`, RATE_LIMIT.adminAction);
  if (!verdict.ok) return fail('RATE_LIMITED', '操作过于频繁，请稍后再试');

  const actor = await resolveActor(req);
  const result = await deleteAnimal(decodeURIComponent(params.code), actor);
  if (!result.ok) return fail(result.code, result.message);
  return ok(result.data);
}
