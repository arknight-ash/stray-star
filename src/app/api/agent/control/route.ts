import { fail, ok } from '@/lib/http';
import { RATE_LIMIT } from '@/lib/constants';
import { log } from '@/lib/logger';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { AgentControlSchema } from '@/lib/api/agent-contract';
import { abortRun, decideGate, pauseRun, runStatus } from '@/lib/agent/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/control —— 人在回路的控制通道（2026-10-28）。
 *
 * 四个动作，语义严格区分（答辩时这三个词必须能讲清楚）：
 *   pause  —— 我不要它继续自作主张了：下一个工具执行前停下，把计划交给我看
 *   resume —— 看过了，这一步可以执行（继续）
 *   skip   —— 这一步不要做，直接跳到下一步（AI 会知道"这一步被跳过"）
 *   abort  —— 我来接管：不再执行任何工具，用已经完成的观察收尾
 *
 * 鉴权：没有会话。安全性来自 runId 本身 —— 128 位随机 UUID，只在开启这次运行的
 * 那个浏览器的 SSE 流里出现过，猜不到也扫不到；且它只能操作一个**已经在跑**的内存
 * 对象，不读写任何持久数据。这也是不用 cookie 的原因：同一个页面开两条并行任务时
 * cookie 反而分不清是哪一条。
 *
 * 限流用较宽松的 agentControl：用户可能连点几下，但没必要给它和"跑一次 Agent"
 * 同等的成本上限。
 */
export async function POST(req: Request): Promise<Response> {
  const ip = clientIpFrom(req.headers);
  const verdict = rateLimit(`agent-control:${ip}`, RATE_LIMIT.agentControl);
  if (!verdict.ok) {
    return fail('RATE_LIMITED', '操作太频繁了，稍等一下再点');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('BAD_REQUEST', '请用 JSON 提交 {runId, action}');
  }

  const parsed = AgentControlSchema.safeParse(body);
  if (!parsed.success) {
    return fail('BAD_REQUEST', parsed.error.issues[0]?.message ?? '控制指令不合法');
  }
  const { runId, action } = parsed.data;

  const status = runStatus(runId);
  if (!status.exists) {
    // 任务已经跑完或服务重启过：不是错误，告诉前端"没有可控制的对象"
    return fail('NOT_FOUND', '这个任务已经结束，没有可接管的执行');
  }

  let accepted = false;
  switch (action) {
    case 'pause':
      accepted = pauseRun(runId);
      break;
    case 'resume':
      accepted = decideGate(runId, 'approve');
      break;
    case 'skip':
      accepted = decideGate(runId, 'skip');
      break;
    case 'abort':
      accepted = abortRun(runId);
      break;
  }

  log.info('agent.control', { runId, action, accepted, ip });
  return ok({
    runId,
    action,
    accepted,
    awaiting: runStatus(runId).awaiting,
  });
}
