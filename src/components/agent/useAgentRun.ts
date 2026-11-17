'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentData, AgentProgress } from '@/lib/api/agent-contract';

/**
 * 星枢执行流的前端状态机（2026-10-28）。
 *
 * 三件事必须放在同一个 hook 里，否则状态会分叉：
 *  1. SSE 读取：`POST /api/agent/stream` 逐帧解析 hello / progress / final / error / end；
 *  2. 控制回传：`POST /api/agent/control` 的 pause / resume / skip / abort —— 它作用在
 *     **另一条连接**上，只带 runId，所以 runId 必须在这里维护；
 *  3. 降级：SSE 不可用时不留死路 —— 退成普通请求 `/api/agent`，前端仍然拿得到完整
 *     结果，只是星轨一次性铺开（而不是逐颗点亮）。
 *
 * 为什么不用 EventSource：EventSource 只能 GET，带不了 multipart（多图 + 限流键），
 * 也没法在流没结束时插话（暂停/接管）。用 fetch + ReadableStream 读，控制走另一条
 * 短请求，两边靠 runId 对上 —— 这是真实产品里 agent 前端的常见形态。
 */

export type TurnStatus = 'streaming' | 'done' | 'error';

export interface Turn {
  id: string;
  message: string;
  /** 本次附带的照片（object URL，仅用于展示；真正的文件已随请求发出） */
  images: string[];
  /** hello 事件给的运行句柄，暂停/接管都靠它 */
  runId?: string;
  /** 最新执行快照。undefined = 还没收到第一条 progress（正在规划） */
  progress?: AgentProgress;
  data?: AgentData;
  error?: string;
  status: TurnStatus;
  /** 用户点了「暂停」，但当前这一步还在跑（闸门还没打开） */
  pausing?: boolean;
}

export type ControlAction = 'pause' | 'resume' | 'skip' | 'abort';

export interface SendInput {
  message: string;
  files: File[];
  /** 每一步执行前都要确认（人在回路模式） */
  confirmEach: boolean;
  /**
   * 用户本轮授权的设备定位（2026-10-29）。
   * 只在用户点了「用当前位置」时才有；带上之后模型才能用 `useCurrentPosition`，
   * 否则它只能要用户说地点名。坐标不经过模型，直接由服务端取用。
   */
  userLocation?: { lat: number; lng: number; accuracyM?: number | null } | null;
}

const GENERIC_REFUSAL = '星枢AI暂时失联，稍后再试一次。';

export function useAgentRun() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  /** 服务端不支持流式就记住，别每条消息都白试一遍 */
  const streamable = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  /** 与 turns 同步的镜像：control() 需要在事件回调里读最新值，state 闭包拿不到 */
  const turnsRef = useRef<Turn[]>([]);
  /** 挂载期间创建的 object URL，卸载时统一释放 */
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.length = 0;
    };
  }, []);

  const apply = useCallback((updater: (prev: Turn[]) => Turn[]) => {
    setTurns((prev) => {
      const next = updater(prev);
      turnsRef.current = next;
      return next;
    });
  }, []);

  const patch = useCallback(
    (id: string, next: Partial<Turn>) => {
      apply((prev) => prev.map((t) => (t.id === id ? { ...t, ...next } : t)));
    },
    [apply],
  );

  const send = useCallback(
    async ({ message, files, confirmEach, userLocation }: SendInput) => {
      const text = message.trim();
      if (!text || busy) return;

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const images = files.map((f) => {
        const url = URL.createObjectURL(f);
        objectUrls.current.push(url);
        return url;
      });

      apply((prev) => [...prev, { id, message: text, images, status: 'streaming' as const }]);
      setBusy(true);

      const form = new FormData();
      form.set('message', text);
      form.set('clientId', id);
      if (confirmEach) form.set('confirmEach', '1');
      /* 定位随消息一起发（2026-10-29）：服务端会再过一遍校园围栏。
         这里只把「用户点了授权」这个事实送上去，坐标本身不经过模型。 */
      if (userLocation) {
        form.set('lat', String(userLocation.lat));
        form.set('lng', String(userLocation.lng));
        if (typeof userLocation.accuracyM === 'number') {
          form.set('acc', String(userLocation.accuracyM));
        }
      }
      for (const file of files) form.append('files', file);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        let handled = false;
        if (streamable.current) {
          const outcome = await readStream(form, controller.signal, {
            onHello: (runId) => patch(id, { runId }),
            onProgress: (progress) => patch(id, { progress }),
            onFinal: (data) => patch(id, { data, status: 'done' }),
            onError: (msg) => patch(id, { error: msg, status: 'error' }),
          });
          if (outcome === 'streamed') handled = true;
          // 服务端（或中间层）不支持流：记住，然后退回普通请求
          else streamable.current = false;
        }

        if (!handled) {
          const data = await readPlain(form, controller.signal);
          patch(id, { data, status: 'done' });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // 用户主动取消：保留已经点亮的部分，只把状态收干净
          patch(id, { status: 'done' });
        } else {
          const msg = err instanceof Error && err.message ? err.message : GENERIC_REFUSAL;
          patch(id, { error: msg, status: 'error' });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
      }
    },
    [apply, busy, patch],
  );

  /**
   * 发一条控制指令。
   * 失败只记日志、不弹错：用户点的是「暂停」，此时冒出一个红字报错反而更慌，
   * 而真实状态马上会被下一次 progress 快照纠正（星轨仍然准确）。
   */
  const control = useCallback(
    async (turnId: string, action: ControlAction) => {
      const turn = turnsRef.current.find((t) => t.id === turnId);
      if (!turn?.runId) return;
      if (action === 'pause') patch(turnId, { pausing: true });

      try {
        const res = await fetch('/api/agent/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: turn.runId, action }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          console.warn('agent.control_failed', action, json?.error?.message);
          patch(turnId, { pausing: false });
          return;
        }
        if (action !== 'pause') patch(turnId, { pausing: false });
      } catch {
        patch(turnId, { pausing: false });
      }
    },
    [patch],
  );

  /** 硬取消：直接断流。服务端把「断连」也当接管（见 /api/agent/stream 的 cancel） */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
  }, []);

  return { turns, busy, send, control, cancel };
}

/* ────────────────── 传输层 ────────────────── */

type StreamHandlers = {
  onHello: (runId: string, photos: number) => void;
  onProgress: (progress: AgentProgress) => void;
  onFinal: (data: AgentData) => void;
  onError: (message: string) => void;
};

/** 读 SSE。返回 'streamed' = 这轮已经处理完；'unsupported' = 该退回普通请求 */
async function readStream(
  form: FormData,
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<'streamed' | 'unsupported'> {
  const res = await fetch('/api/agent/stream', {
    method: 'POST',
    body: form,
    signal,
    headers: { Accept: 'text/event-stream' },
  });

  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) throw new Error(await errorMessage(res));
  // 反代把流缓冲成 JSON、或服务端降级 —— 都说明这条路现在不通
  if (!res.body || !type.includes('text/event-stream')) return 'unsupported';

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleFrame = (frame: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue; // 心跳注释
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;

    let payload: unknown;
    try {
      payload = JSON.parse(dataLines.join('\n'));
    } catch {
      return;
    }

    switch (event) {
      case 'hello': {
        const hello = payload as { runId?: string; photos?: number };
        if (hello?.runId) handlers.onHello(hello.runId, hello.photos ?? 0);
        break;
      }
      case 'progress':
        handlers.onProgress(payload as AgentProgress);
        break;
      case 'final':
        handlers.onFinal(payload as AgentData);
        break;
      case 'error': {
        const e = payload as { message?: string };
        handlers.onError(e?.message ?? '星枢AI暂时失联，稍后再试一次。');
        break;
      }
      default:
        break;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf('\n\n');
    while (cut >= 0) {
      handleFrame(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf('\n\n');
    }
  }
  // 流结束时可能还剩最后一帧没被 \n\n 收尾
  if (buffer.trim()) handleFrame(buffer);

  return 'streamed';
}

/** 普通 JSON 入口（流式不可用时的降级路径，契约与以前完全一致） */
async function readPlain(form: FormData, signal: AbortSignal): Promise<AgentData> {
  const res = await fetch('/api/agent', { method: 'POST', body: form, signal });
  if (!res.ok) throw new Error(await errorMessage(res));

  const json = (await res.json()) as { ok?: boolean; data?: AgentData; error?: { message?: string } };
  if (!json?.ok || !json.data) {
    throw new Error(json?.error?.message ?? GENERIC_REFUSAL);
  }
  return json.data;
}

/** 从失败响应里取服务端话术（限流 / 内容安全 / 校验失败都走这一条） */
async function errorMessage(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json?.error?.message ?? GENERIC_REFUSAL;
  } catch {
    return GENERIC_REFUSAL;
  }
}
