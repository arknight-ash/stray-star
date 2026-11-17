import { fail, ok, parseBody } from '@/lib/http';
import { RATE_LIMIT } from '@/lib/constants';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { resolveActor } from '@/lib/auth/actor';
import { reviewReport } from '@/lib/admin/reports';
import { idempotent } from '@/lib/api/idempotent';
import { ReportReviewSchema } from '@/lib/api/alert-contract';

export const runtime = 'nodejs';

/**
 * PATCH /api/admin/reports/:id —— 报告审核三动作（阶段 9）。
 *
 * verdict=APPROVED：升格为已确认事实，可携带 edits 直接修改原字段（过 reconcile）；
 * verdict=REJECTED：判定 AI 误判，必须带 note。
 * 只有管理员能按：无论哪个方向都是在替所有人改"健康事实"，
 * 匿名无权拍这个板（R8 的同款理由）。diff 原样进 AuditLog。
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const ip = clientIpFrom(req.headers);
  const verdict = rateLimit(`adminAct:${ip}`, RATE_LIMIT.adminAction);
  if (!verdict.ok) return fail('RATE_LIMITED', '操作过于频繁，请稍后再试');

  const body = await parseBody(req, ReportReviewSchema);
  if (!body.ok) return body.response;

  const actor = await resolveActor(req);
  const { verdict: action, edits, note, clientId } = body.data;

  const result = await idempotent(
    clientId ? `report:${action}:${params.id}:${clientId}` : undefined,
    () => reviewReport(params.id, { verdict: action, edits, note }, actor),
  );

  if (!result.ok) return fail(result.code, result.message);
  return ok(result.data);
}
