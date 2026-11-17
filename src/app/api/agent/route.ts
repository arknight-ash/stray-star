import { fail, ok } from '@/lib/http';
import { log } from '@/lib/logger';
import { idempotent } from '@/lib/api/idempotent';
import { AgentDataSchema, traceToTrail } from '@/lib/api/agent-contract';
import { runAgent } from '@/lib/agent/orchestrator';
import { parseAgentRequest } from '@/lib/agent/request';

/** Node runtime：要连库、跑 Prisma、写上传 */
export const runtime = 'nodejs';

/**
 * POST /api/agent —— 星枢的一站式入口（阶段 8）。
 *
 * multipart/form-data：message 必填；file / files 可选（saveUpload 落盘后以
 * photoUrl(s) 进入工具上下文）；clientId 用于 30s 幂等。
 *
 * 2026-10-28 起前端主路径改走 `/api/agent/stream`（逐颗点亮星轨 + 人在回路），
 * 这条非流式入口保留两个用途：① 老客户端 / 自测的稳定契约；② SSE 不可用时的降级。
 * 两者的入参解析与限流共用 lib/agent/request.ts，只有"怎么把结果送回去"不同。
 *
 * 一次 Agent 对话可能串 2-3 次结构化生成 + 写库 + 预警评估，是全站最贵的入口，
 * 限流 RATE_LIMIT.agent 压在每分钟 6 次；内部工具调用不再单独限流（不是用户发起的独立请求）。
 */
export async function POST(req: Request): Promise<Response> {
  const parsed = await parseAgentRequest(req);
  if (!parsed.ok) return parsed.response;

  const { message, clientId, photoUrls, userLocation, ip } = parsed;

  const result = await idempotent(clientId, () =>
    runAgent({
      message,
      photoUrl: photoUrls[0] ?? null,
      photoUrls,
      userLocation: userLocation ?? null,
      ip,
    }),
  );
  const data = {
    answer: result.answer,
    needsHuman: result.needsHuman,
    degraded: result.degraded,
    ...(result.paused ? { paused: true } : {}),
    ...(result.notice ? { notice: result.notice } : {}),
    ...(result.disclaimer ? { disclaimer: result.disclaimer } : {}),
    ...(typeof result.confidence === 'number' ? { confidence: result.confidence } : {}),
    ...(result.photos ? { photos: result.photos } : {}),
    trail: traceToTrail(result.trace),
  };

  // 出口也过一遍 Zod：契约漂移在测试期就炸，不等到前端白屏
  const checked = AgentDataSchema.safeParse(data);
  if (!checked.success) {
    log.error('agent.contract_invalid', {
      issues: checked.error.issues,
      runId: data.trail.runId,
    });
    return fail('INTERNAL', '星枢AI的回复没能通过完整性校验，请稍后再试');
  }

  return ok(checked.data);
}
