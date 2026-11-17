import { fail, ok, parseBody } from '@/lib/http';
import { RATE_LIMIT } from '@/lib/constants';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { resolveActor } from '@/lib/auth/actor';
import { setAnimalLocation } from '@/lib/admin/animals';
import { AnimalLocationSchema } from '@/lib/api/animal-contract';
import { isValidLatLng, isWithinFence, readCampusCenter, readCampusRadiusM } from '@/lib/geo';

export const runtime = 'nodejs';

/**
 * 为暂无位置的档案补充经纬度（图鉴页入口）。
 * 匿名一律拒绝（canEditAnimal）；待审核档案学生也不可改，实际入口是管理员。
 */
export async function POST(req: Request): Promise<Response> {
  const ip = clientIpFrom(req.headers);
  const verdict = rateLimit(`animalLoc:${ip}`, RATE_LIMIT.adminAction);
  if (!verdict.ok) return fail('RATE_LIMITED', '操作过于频繁，请稍后再试');

  const body = await parseBody(req, AnimalLocationSchema);
  if (!body.ok) return body.response;

  const { code, lat, lng } = body.data;
  if (!isValidLatLng(lat, lng)) return fail('BAD_REQUEST', '定位坐标不合法');
  if (!isWithinFence({ lat, lng }, readCampusCenter(), readCampusRadiusM())) {
    return fail('BAD_REQUEST', '定位超出校园范围，请选择校园内的位置');
  }

  const actor = await resolveActor(req);
  const result = await setAnimalLocation(code, lat, lng, actor);
  if (!result.ok) return fail(result.code, result.message);
  return ok(result.data);
}
