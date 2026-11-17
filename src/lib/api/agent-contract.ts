import { z } from 'zod';
import { LIMITS } from '../constants';
import type { TraceRun } from '../agent/trace';

/**
 * Agent 的前后端共用契约（唯一事实源）。
 * 星轨（StarTrail）是 /agent 页面「星轨可视化」组件的唯一输入形状：
 * 组件不认识 TraceRun，只认这里 —— 中间层映射规则见 traceToTrail。
 */

/** 请求体（HTTP 层由 multipart 手工取出后仍过这里校验，UI 侧不发 JSON） */
export const AgentRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(2, '跟星枢AI说清楚要做什么')
    .max(LIMITS.agentMessage, `消息最多 ${LIMITS.agentMessage} 字`),
  /** 幂等键：同一 clientId 30s 内复用结果 */
  clientId: z.string().trim().max(64).optional(),
  /** 服务端内部字段：saveUpload 落盘之后的站内 URL，客户端不传 */
  photoUrl: z.string().optional(),
});

export type AgentRequest = z.infer<typeof AgentRequestSchema>;

/**
 * 星轨的一步。用户点名的形状 {steps:[{tool,status,summary}]}：
 * - tool：'plan' | 工具名 | 'final'，前端按这三种画不同的星
 * - status：running 只会出现在「进行中」的骨架里；ok/error/fallback 是终态
 * - summary：该步一句话，hover tooltip 的内容
 */
export const AgentStepSchema = z.object({
  tool: z.string(),
  status: z.enum(['running', 'ok', 'error', 'fallback']),
  summary: z.string(),
  durationMs: z.number().int().nonnegative().optional(),
  /** 这一步为什么被调用（模型给的理由），星轨日志里显示成小字，答辩时能讲清"它为什么这么做" */
  why: z.string().optional(),
});

export const StarTrailSchema = z.object({
  runId: z.string(),
  /** plan 步产出的任务目标；规划失败时回落为用户原话截断 */
  goal: z.string(),
  steps: z.array(AgentStepSchema).max(7),
  /** true = 至少一步工具失败，走了 RAG 安全航线 */
  degraded: z.boolean(),
});

export type AgentStep = z.infer<typeof AgentStepSchema>;
export type StarTrail = z.infer<typeof StarTrailSchema>;

/* ────────────────── 流式执行进度（2026-10-28） ──────────────────

 一次任务从「提交」到「完成」，前端要能看见每一颗星被点亮的过程，而不是等最后一个
 JSON 回来再补一段动画（那是演示型 AI，评分里最忌讳的）。所以编排层把进度按快照
 推给前端：每推一次 = 状态机走了一步。

 为什么推「快照」而不是「增量补丁」：
   快照天然幂等 —— 前端 setProgress(快照) 即可，丢一帧不会错位，重连也不会把
   星轨拼错。一步的 payload 只有几百字节，比省这点流量更值得。

   planned vs steps：planned 是 AI 规划出的路线（还没执行，画成暗星），steps 是真实
   执行过的步骤。两者长度不同是常态 —— 计划 3 步，实际走了 2 步就够，或者中途换了
   工具。这不是 bug，正好是答辩时能讲的"规划 vs 实际"。
*/

export const AgentProgressSchema = z.object({
  runId: z.string(),
  goal: z.string(),
  phase: z.enum(['planning', 'running', 'awaiting', 'final']),
  /** AI 规划的路线（cap 5，与 AgentPlanSchema 一致） */
  planned: z
    .array(z.object({ tool: z.string(), why: z.string() }))
    .max(5)
    .default([]),
  /** 真实执行过（或正在收尾）的步骤 */
  steps: z.array(AgentStepSchema).max(7),
  /** 正在执行的那一步；null = 此刻没有工具在跑 */
  running: z.object({ tool: z.string(), why: z.string() }).nullable(),
  /** 人在回路：AI 挂起等你确认的下一步；null = 没在等人 */
  gate: z
    .object({
      index: z.number().int().nonnegative(),
      tool: z.string(),
      why: z.string(),
      /** 模型准备传的入参（脱敏截断），让用户确认"它打算拿什么去写库" */
      preview: z.string(),
      /** 等待截止时间（毫秒时间戳）；超时按「接管」处理，见 lib/agent/gate.ts */
      expiresAt: z.number(),
    })
    .nullable(),
  /** 现场照片张数：前端据此显示「AI 看了 N 张图」 */
  photos: z.number().int().nonnegative().default(0),
  note: z.string().optional(),
});

export type AgentProgress = z.infer<typeof AgentProgressSchema>;

/** POST /api/agent/control 的请求体：两条连接靠 runId 对上 */
export const AgentControlSchema = z.object({
  runId: z.string().min(8).max(64),
  action: z.enum(['pause', 'resume', 'skip', 'abort']),
});
export type AgentControl = z.infer<typeof AgentControlSchema>;

/** POST /api/agent 的响应 data */
export const AgentDataSchema = z.object({
  answer: z.string(),
  needsHuman: z.boolean(),
  degraded: z.boolean(),
  /** addObservation 触发预警时的「已通知管理员」，文案唯一来源是 constants 的 ALERT_NOTICE */
  notice: z.string().optional(),
  /** assessHealth 产出的健康免责声明，有健康结论就必须带 */
  disclaimer: z.string().optional(),
  /** assessHealth 的置信度（0-1）。前端据此显 ConfidenceBadge；低于 CONFIDENCE_FLOOR 显「不确定」 */
  confidence: z.number().min(0).max(1).optional(),
  /** 本次实际交给模型的照片张数（多模态入口，>1 表示用了多角度） */
  photos: z.number().int().nonnegative().optional(),
  /** true = 用户在工具阶段中途接管，answer 只涵盖已完成的步骤 */
  paused: z.boolean().optional(),
  trail: StarTrailSchema,
});

export type AgentData = z.infer<typeof AgentDataSchema>;

/**
 * TraceRun → 星轨步骤（流式与非流式共用同一份映射，避免两条路径画出不同的星轨）。
 * 规则：tool_call(running) 与随后同名的 tool_result 合并为一步（状态取 result），
 * plan/final 各自成步；running 的 tool_call 只贡献「为什么调它」，不单独成星。
 */
export function trailStepsOf(run: TraceRun): { goal: string; steps: AgentStep[] } {
  const steps: AgentStep[] = [];
  let goal = run.prompt.slice(0, 120);
  /** 最近一次 running 的 tool_call 给的调用理由，属于紧随其后的 tool_result */
  const whyOf = new Map<string, string>();

  for (const s of run.steps) {
    switch (s.kind) {
      case 'plan':
        if (s.detail) goal = s.detail;
        steps.push({ tool: 'plan', status: s.status, summary: s.detail });
        break;
      case 'tool_call':
        if (s.status === 'running') {
          whyOf.set(s.label, s.detail);
          break;
        }
        steps.push({
          tool: s.label,
          status: s.status,
          summary: s.detail,
          durationMs: s.durationMs,
          ...(s.detail ? { why: s.detail } : {}),
        });
        break;
      case 'tool_result': {
        const why = whyOf.get(s.label);
        steps.push({
          tool: s.label,
          status: s.status,
          summary: s.detail,
          durationMs: s.durationMs,
          ...(why ? { why } : {}),
        });
        break;
      }
      case 'final':
        steps.push({ tool: 'final', status: s.status, summary: s.detail });
        break;
    }
  }

  return { goal, steps };
}

/** TraceRun → StarTrail（非流式 JSON 响应用；流式路径用 AgentProgress） */
export function traceToTrail(run: TraceRun): StarTrail {
  const { goal, steps } = trailStepsOf(run);
  return {
    runId: run.id,
    goal,
    steps: steps.slice(0, 7),
    degraded: steps.some((s) => s.status === 'error'),
  };
}
