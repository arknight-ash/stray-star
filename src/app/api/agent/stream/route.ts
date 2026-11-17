import { randomUUID } from 'node:crypto';
import { log } from '@/lib/logger';
import { AgentDataSchema, AgentProgressSchema, traceToTrail } from '@/lib/api/agent-contract';
import { runAgent } from '@/lib/agent/orchestrator';
import { parseAgentRequest } from '@/lib/agent/request';
import { abortRun } from '@/lib/agent/gate';

/** Node runtime：长连接要跑编排循环、连库、写上传 */
export const runtime = 'nodejs';
/** 绝不能缓存：这是逐帧推送的执行过程 */
export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/stream —— 带执行过程的 Agent 入口（2026-10-28）。
 *
 * 与 /api/agent 的差别只有"怎么把结果送回去"：这里用 Server-Sent Events 边跑边推，
 * 前端因此能看见每一颗星被真正点亮（而不是等结果回来补一段动画）。
 *
 * 事件表：
 *   hello    {runId, photos, confirmEach}  —— 连接建立，前端从此持有控制句柄
 *   progress AgentProgress                 —— 状态快照（phase/steps/running/gate）
 *   final    AgentData                     —— 与 JSON 入口同一个契约
 *   error    {message}
 *   end      {}                            —— 流结束（客户端据此收尾，不必等到 close）
 *
 * 为什么用 SSE 而不是 WebSocket：执行过程是单向推送，用户指令（暂停/接管）走另开
 * 的一条短请求 POST /api/agent/control 更省事 —— 那个请求天然被限流、天然无状态，
 * 不需要为"长连接上的双向控制"再造一套心跳与重连协议。
 *
 * 心跳每 15s 一行注释：既防中间层把空闲连接掐掉（闸门里等人可能等上百秒），
 * 也让浏览器知道连接还活着。
 */
export async function POST(req: Request): Promise<Response> {
  const parsed = await parseAgentRequest(req);
  if (!parsed.ok) return parsed.response;

  const { message, photoUrls, userLocation, confirmEach, ip } = parsed;
  const runId = randomUUID();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // 连接已被客户端掐断：后续写入全部丢弃，但仍要让编排循环跑完 finally
          closed = true;
        }
      };
      const send = (event: string, data: unknown) => {
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const heartbeat = setInterval(() => write(': ping\n\n'), 15_000);
      // 客户端断开（关页面 / 点取消）→ 立刻叫停编排：不要再往下写库、发预警
      const onAbort = () => abortRun(runId);
      req.signal.addEventListener('abort', onAbort);

      send('hello', { runId, photos: photoUrls.length, confirmEach });

      try {
        const result = await runAgent(
          {
            message,
            photoUrl: photoUrls[0] ?? null,
            photoUrls,
            userLocation: userLocation ?? null,
            ip,
            confirmEach,
            runId,
          },
          {
            emit: (progress) => {
              // 出口也过一遍契约：快照字段漂移要在开发期炸掉，而不是让前端静默错位
              const checked = AgentProgressSchema.safeParse(progress);
              if (!checked.success) {
                log.warn('agent.progress_invalid', { issues: checked.error.issues, runId });
                return;
              }
              send('progress', checked.data);
            },
          },
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
        const checked = AgentDataSchema.safeParse(data);
        if (!checked.success) {
          log.error('agent.contract_invalid', { issues: checked.error.issues, runId });
          send('error', { message: '星枢AI的回复没能通过完整性校验，请稍后再试' });
        } else {
          send('final', checked.data);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        log.error('agent.stream_failed', { runId, detail });
        send('error', { message: '星枢AI暂时失联，稍后再试一次。' });
      } finally {
        clearInterval(heartbeat);
        req.signal.removeEventListener('abort', onAbort);
        send('end', {});
        closed = true;
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
      }
    },
    cancel() {
      // 浏览器主动断开流（点「取消」/卸载组件）也视为接管
      abortRun(runId);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx 等反代默认会缓冲响应体，缓冲了这个流就变成"最后一次性吐出来"
      'X-Accel-Buffering': 'no',
    },
  });
}
