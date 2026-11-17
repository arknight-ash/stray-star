import { z } from 'zod';
import { fail, ok } from '@/lib/http';
import { RATE_LIMIT } from '@/lib/constants';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { resolveActor } from '@/lib/auth/actor';
import { reviewAnimal } from '@/lib/admin/animals';

export const runtime = 'nodejs';

/**
 * 审核「同学提交的新增动物申请」（管理端）。
 *
 * 通过 = 这只动物确实存在，档案与照片一起转为正式（进图鉴、进识别库）；
 * 驳回 = 申请不成立，档案连同它的照片一起清掉。
 * 两个方向都不可逆，所以裁决在 lib/admin/animals.ts 的 canReviewAnimal，
 * 这里只做解析与限流。
 */
const BodySchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(200).optional(),
  /** 管理员勾选「情况紧急」等场景下的备注也走这里，先留字段不另开接口 */
});

export async function POST(
  req: Request,
  { params }: { params: { code: string } },
): Promise<Response> {
  const ip = clientIpFrom(req.headers);
  const verdict = rateLimit(`animalReview:${ip}`, RATE_LIMIT.adminAction);
  if (!verdict.ok) return fail('RATE_LIMITED', '操作过于频繁，请稍后再试');

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', '审核结论不正确');

  const actor = await resolveActor(req);
  const result = await reviewAnimal(
    decodeURIComponent(params.code),
    parsed.data.decision,
    actor,
    parsed.data.note,
  );
  if (!result.ok) return fail(result.code, result.message);
  return ok(result.data);
}
