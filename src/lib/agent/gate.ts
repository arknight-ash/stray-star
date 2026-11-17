/**
 * Agent 运行控制台（2026-10-28，Human-in-the-loop）。
 *
 * 要解决的问题：SSE 是一次「客户端 → 服务端」的单向长连接，编排循环跑到一半时
 * 用户点「暂停 / 接管」，这个意图没法从同一根连接回传。所以另开一条控制通道
 * （POST /api/agent/control），用 runId 把两条连接对上：
 *
 *   流式连接：orch 每执行一步 → 若用户要求暂停 → awaitGate() 挂起
 *   控制连接：用户点「继续 / 跳过 / 接管」→ decideGate() 唤醒上面的 Promise
 *
 * 存储用进程内 Map（与 trace.ts 同一套取舍：单实例部署足够，重启即失散）。
 * 失散的后果是可控的 —— awaitGate 有 TTL，超时按「接管」处理，最坏情况是
 * 用户看到「已暂停」而不是永远转圈。
 *
 * 这里只存**控制信号**，不存业务数据；一次 run 的生命周期 = openRun → closeRun，
 * 无论成功、失败、超时都会走到 closeRun（orchestrator 的 finally）。
 */

export type GateDecision = 'approve' | 'skip' | 'abort';

interface PendingGate {
  resolve(decision: GateDecision): void;
}

interface RunState {
  /** 用户点了暂停：下一个工具执行前挂起，先给计划再等指令 */
  paused: boolean;
  /** 用户点了接管/取消：不再执行任何工具，用已完成的观察收尾 */
  aborted: boolean;
  pausedAt?: string;
  pending?: PendingGate;
  openedAt: number;
}

/** 一次 run 最多在内存里活 10 分钟，防止异常路径漏掉 closeRun 攒出僵尸条目 */
const MAX_AGE_MS = 10 * 60 * 1000;

const runs = new Map<string, RunState>();

function prune(): void {
  const now = Date.now();
  for (const [id, state] of runs) {
    if (now - state.openedAt > MAX_AGE_MS) {
      state.pending?.resolve('abort');
      runs.delete(id);
    }
  }
}

export function openRun(runId: string): void {
  prune();
  runs.set(runId, { paused: false, aborted: false, openedAt: Date.now() });
}

/** 收尾：还挂着的等待一律按「接管」放行，绝不让调用方永久挂住 */
export function closeRun(runId: string): void {
  const state = runs.get(runId);
  if (state?.pending) state.pending.resolve('abort');
  runs.delete(runId);
}

export function pauseRun(runId: string): boolean {
  const state = runs.get(runId);
  if (!state || state.aborted) return false;
  state.paused = true;
  state.pausedAt = new Date().toISOString();
  return true;
}

export function abortRun(runId: string): boolean {
  const state = runs.get(runId);
  if (!state) return false;
  state.aborted = true;
  // 正在等人时立刻放行，让编排循环马上收尾
  state.pending?.resolve('abort');
  return true;
}

export function isAborted(runId: string): boolean {
  return runs.get(runId)?.aborted === true;
}

/** 是否在「用户要求暂停、还没放行」的状态 —— 编排层据此决定要不要开闸门 */
export function isPaused(runId: string): boolean {
  const state = runs.get(runId);
  return state?.paused === true && state.aborted === false;
}

export function hasPendingGate(runId: string): boolean {
  return Boolean(runs.get(runId)?.pending);
}

/**
 * 挂起等待用户决定。TTL 到了按「接管」处理：
 * 用户可能只是关掉了页面，此时继续执行工具（写库、发预警）比停下来更危险。
 */
export function awaitGate(runId: string, ttlMs: number): Promise<GateDecision> {
  const state = runs.get(runId);
  if (!state) return Promise.resolve('abort');
  if (state.aborted) return Promise.resolve('abort');

  return new Promise<GateDecision>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (decision: GateDecision) => {
      if (timer) clearTimeout(timer);
      if (state.pending?.resolve === resolve) state.pending = undefined;
      resolve(decision);
    };
    state.pending = { resolve: finish };
    timer = setTimeout(() => finish('abort'), Math.max(1_000, ttlMs));
  });
}

export function decideGate(runId: string, decision: GateDecision): boolean {
  const state = runs.get(runId);
  if (!state?.pending) return false;
  // 放行后清掉暂停标记：这次暂停已经兑现成一次确认，下一轮重新开始
  if (decision === 'approve' || decision === 'skip') state.paused = false;
  state.pending.resolve(decision);
  return true;
}

export interface RunStatus {
  exists: boolean;
  paused: boolean;
  aborted: boolean;
  awaiting: boolean;
  pausedAt?: string;
}

export function runStatus(runId: string): RunStatus {
  const state = runs.get(runId);
  if (!state) return { exists: false, paused: false, aborted: false, awaiting: false };
  return {
    exists: true,
    paused: state.paused,
    aborted: state.aborted,
    awaiting: Boolean(state.pending),
    ...(state.pausedAt ? { pausedAt: state.pausedAt } : {}),
  };
}
