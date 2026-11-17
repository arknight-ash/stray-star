'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LIMITS } from '@/lib/constants';
import { compressImage } from '@/lib/image-compress';
import type { HealthAssessData } from '@/lib/api/health-contract';

/**
 * 健康评估状态机（第 5 阶段）。
 *
 * 用它而不是散落的 useState 的理由：一次评估的合法状态组合有限，
 * 写成有限状态可以杜绝「分析过程中还能改描述」这类非法态。
 *
 * 两个刻意的处理：
 *  1. blob 不进 state —— 二进制进 state 只会触发无意义的重渲染，用 ref 存；
 *  2. objectURL 必须显式回收 —— 每选一次图不回收就漏一块内存。
 */

export type AssessPhase = 'idle' | 'ready' | 'assessing' | 'done' | 'error';

export interface AssessFailure {
  code: string;
  message: string;
}

export interface AssessState {
  phase: AssessPhase;
  previewUrl: string | null;
  description: string;
  data: HealthAssessData | null;
  failure: AssessFailure | null;
}

const INITIAL: AssessState = {
  phase: 'idle',
  previewUrl: null,
  description: '',
  data: null,
  failure: null,
};

const MESSAGES: Record<string, string> = {
  RATE_LIMITED: '刚刚评估得太快了，休息几秒再来。',
  MODERATION_BLOCKED: '描述里出现了不合适的内容，改一下再试。',
  BAD_REQUEST: '这张图片可能不被支持，换一张清晰点的试试。',
  AI_UNAVAILABLE: '健康评估服务暂时不可用，可以先手写一句症状，稍后再试。',
  AI_SCHEMA_INVALID: '这次 AI 返回的结果不合格式，没有给出任何健康结论。请重新提交。',
  NOT_FOUND: '这只动物的档案不存在，可能已被合并。',
  INTERNAL: '服务器有点小情绪，请稍后重试。',
  NETWORK: '网络似乎不太稳定，请重试',
};

export function useHealthAssess(animalId?: string) {
  const [state, setState] = useState<AssessState>(INITIAL);
  const pendingBlob = useRef<File | null>(null);
  const lastUrl = useRef<string | null>(null);

  const releasePreview = useCallback(() => {
    if (lastUrl.current) {
      URL.revokeObjectURL(lastUrl.current);
      lastUrl.current = null;
    }
  }, []);

  useEffect(() => releasePreview, [releasePreview]);

  const selectFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      releasePreview();
      const url = URL.createObjectURL(file);
      lastUrl.current = url;
      pendingBlob.current = file;
      setState((s) => ({ ...s, phase: 'ready', previewUrl: url, failure: null, data: null }));
    },
    [releasePreview],
  );

  const setDescription = useCallback((description: string) => {
    setState((s) => ({ ...s, description: description.slice(0, LIMITS.note) }));
  }, []);

  const submit = useCallback(async () => {
    if (!pendingBlob.current) {
      setState((s) => ({ ...s, failure: { code: 'BAD_REQUEST', message: '先选一张它的照片' } }));
      return;
    }
    setState((s) => ({ ...s, phase: 'assessing', failure: null }));

    try {
      const blob = await compressImage(pendingBlob.current);
      const form = new FormData();
      form.set('file', blob, 'health.jpg');
      if (animalId) form.set('animalId', animalId);
      if (state.description.trim()) form.set('description', state.description.trim());

      const res = await fetch('/api/health/assess', { method: 'POST', body: form });
      const body = await res.json();

      if (!res.ok || !body?.ok) {
        const code = body?.error?.code ?? String(res.status);
        setState((s) => ({
          ...s,
          phase: 'error',
          failure: { code, message: MESSAGES[code] ?? body?.error?.message ?? '出了点小状况，请重试' },
        }));
        return;
      }
      setState((s) => ({ ...s, phase: 'done', data: body.data as HealthAssessData, failure: null }));
    } catch {
      setState((s) => ({
        ...s,
        phase: 'error',
        failure: { code: 'NETWORK', message: MESSAGES.NETWORK },
      }));
    }
  }, [animalId, state.description]);

  const reset = useCallback(() => {
    releasePreview();
    pendingBlob.current = null;
    setState(INITIAL);
  }, [releasePreview]);

  return { state, selectFile, setDescription, submit, reset };
}
