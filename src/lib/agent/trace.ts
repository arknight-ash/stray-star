import { randomUUID } from 'node:crypto';

export type StepKind = 'plan' | 'tool_call' | 'tool_result' | 'final';
export type StepStatus = 'running' | 'ok' | 'error' | 'fallback';

export interface TraceStep {
  id: string;
  kind: StepKind;
  label: string;
  detail: string;
  status: StepStatus;
  at: string;
  durationMs?: number;
}

export interface TraceRun {
  id: string;
  prompt: string;
  steps: TraceStep[];
  startedAt: string;
  finishedAt?: string;
}

/**
 * Trace 存储：内存 Map（单实例足够演示与开发）。
 * 生产可换成 Redis / 数据库，接口保持不变。
 */
const store = new Map<string, TraceRun>();

export function createTrace(prompt: string, id?: string): TraceRun {
  const run: TraceRun = {
    // 允许外部指定 id：流式入口要先把 runId 发给前端（第一条 SSE 事件），
    // 前端才能从提交那一刻起就能「暂停/接管」，而不是等规划跑完才拿得到句柄。
    id: id ?? randomUUID(),
    prompt,
    steps: [],
    startedAt: new Date().toISOString(),
  };
  store.set(run.id, run);
  return run;
}

export function pushStep(
  run: TraceRun,
  step: Omit<TraceStep, 'id' | 'at'> & { status: StepStatus },
): TraceStep {
  const full: TraceStep = { ...step, id: randomUUID(), at: new Date().toISOString() };
  run.steps.push(full);
  store.set(run.id, run);
  return full;
}

export function finishTrace(run: TraceRun): TraceRun {
  run.finishedAt = new Date().toISOString();
  store.set(run.id, run);
  return run;
}

export function getTrace(id: string): TraceRun | undefined {
  return store.get(id);
}
