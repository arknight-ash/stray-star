'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  AnimalSummary,
  CreateAnimalData,
  IdentifyData,
} from '@/lib/api/identify-contract';
import { LIMITS } from '@/lib/constants';
import { compressImage } from '@/lib/image-compress';

/**
 * 星卡捕获状态机（文档 6 节）。
 *
 * idle → preparing → scanning → { matched | low-confidence | new }
 *                                    ↓            ↓          ↓
 *                                  OPEN       ADD_NOTE    OPEN_FORM
 *                                           （回 scanning） creating → matched
 * 任意状态都可 RESET 回 idle； error 是兜底出口。
 *
 * 这里刻意用 useReducer 而不是若干 useState：
 * 「一次捕获」的合法状态组合有限，写成状态机能把 illegal transition 变成不可能，
 * 例如 scanning 态不能编辑表单、matched 态不允许继续改 note。
 */

export type Phase =
  | 'idle'
  | 'preparing'
  | 'scanning'
  | 'matched'
  | 'low-confidence'
  | 'new'
  | 'creating'
  | 'error';

export interface AnimalForm {
  name: string;
  species: 'CAT' | 'DOG' | 'UNKNOWN';
  summary: string;
  features: string;
  lat?: number | null;
  lng?: number | null;
}

export interface MachineState {
  phase: Phase;
  /** 本地预览（objectURL），RESET 时必须 revoke 防内存泄漏 */
  previewUrl: string | null;
  /** 压缩后待上传的图片 */
  blob: Blob | null;
  /** 服务端落盘后的站内地址，重跑与建档复用它，不再重复传图 */
  photoUrl: string | null;
  note: string;
  data: IdentifyData | null;
  createdAnimal: AnimalSummary | null;
  form: AnimalForm;
  error: { code: string; message: string } | null;
  scanStartedAt: number;
}

export type Event =
  | { type: 'SELECT_FILE'; previewUrl: string; blob: Blob }
  | { type: 'SCAN_START'; note?: string }
  | { type: 'SCAN_DONE'; data: IdentifyData }
  | { type: 'CLAIM_NEW' }
  | { type: 'CREATE_START' }
  | { type: 'UPDATE_NOTE'; note: string }
  | { type: 'UPDATE_FORM'; patch: Partial<AnimalForm> }
  | { type: 'CREATE_DONE'; data: CreateAnimalData }
  | { type: 'FAIL'; code: string; message: string }
  | { type: 'RESET' };

const INITIAL_FORM: AnimalForm = {
  name: '',
  species: 'UNKNOWN',
  summary: '',
  features: '',
  lat: null,
  lng: null,
};

export const initialState: MachineState = {
  phase: 'idle',
  previewUrl: null,
  blob: null,
  photoUrl: null,
  note: '',
  data: null,
  createdAnimal: null,
  form: INITIAL_FORM,
  error: null,
  scanStartedAt: 0,
};

function reducer(state: MachineState, event: Event): MachineState {
  switch (event.type) {
    case 'SELECT_FILE':
      return {
        ...initialState,
        phase: 'preparing',
        previewUrl: event.previewUrl,
        blob: event.blob,
      };

    case 'SCAN_START':
      return {
        ...state,
        phase: 'scanning',
        note: event.note ?? state.note,
        error: null,
        scanStartedAt: Date.now(),
      };

    case 'SCAN_DONE': {
      // 「补充一句」重跑时必须保留已上传的照片，避免二次传图
      const photoUrl = event.data.photoUrl ?? state.photoUrl;
      const phase: Phase =
        event.data.tier === 'matched'
          ? 'matched'
          : event.data.tier === 'candidate'
            ? 'low-confidence'
            : 'new';
      return {
        ...state,
        phase,
        photoUrl,
        data: event.data,
        form: {
          ...state.form,
          species: event.data.matched
            ? event.data.animal.species
            : event.data.suggestedSpecies,
        },
      };
    }

    case 'CLAIM_NEW':
      return { ...state, phase: 'new' };

    case 'CREATE_START':
      return { ...state, phase: 'creating', error: null };

    case 'UPDATE_NOTE':
      return { ...state, note: event.note.slice(0, LIMITS.note) };

    case 'UPDATE_FORM':
      return { ...state, form: { ...state.form, ...event.patch } };

    case 'CREATE_DONE':
      // 新建档案落成 = 新星星卡点亮，直接回到 matched，而不是跳去别处
      return { ...state, phase: 'matched', createdAnimal: event.data.animal };

    case 'FAIL':
      return { ...state, phase: 'error', error: { code: event.code, message: event.message } };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

/** 最短 scanning 展示时长：提前返回也补足，避免结果一闪而过 */
const MIN_SCAN_MS = 1200;
/** 前端超时：服务端有 AI 超时，这里兜底防止请求无限挂起 */
const SCAN_TIMEOUT_MS = 20_000;

export function useIdentifyMachine() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (stateRef.current.previewUrl) URL.revokeObjectURL(stateRef.current.previewUrl);
      abortRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    if (stateRef.current.previewUrl) URL.revokeObjectURL(stateRef.current.previewUrl);
    dispatch({ type: 'RESET' });
  }, []);

  /** 发起识别的核心实现：显式接收资源，绝不依赖 ref 的时序 */
  const sendScan = useCallback(
    async (params: { blob: Blob | null; photoUrl: string | null; note?: string }) => {
      const { blob, photoUrl, note } = params;
      if (!blob && !photoUrl) return;

      dispatch({ type: 'SCAN_START', note });
      const form = new FormData();
      if (photoUrl) form.append('fromPhotoUrl', photoUrl);
      else if (blob) form.append('file', blob, 'capture.jpg');
      if (note) form.append('note', note.slice(0, LIMITS.note));

      const controller = new AbortController();
      abortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

      try {
        const startedAt = Date.now();
        const [res] = await Promise.all([
          fetch('/api/identify', { method: 'POST', body: form, signal: controller.signal }),
          new Promise((r) => setTimeout(r, MIN_SCAN_MS)),
        ]);
        const body = await res.json();

        if (!res.ok || !body?.ok) {
          dispatch({
            type: 'FAIL',
            code: body?.error?.code ?? String(res.status),
            message: friendlyError(body?.error?.code, body?.error?.message),
          });
          return;
        }
        // 结果最快也要占满 MIN_SCAN_MS，防止「加载一闪而过」看不清发生了什么
        await holdUntil(startedAt + MIN_SCAN_MS);
        dispatch({ type: 'SCAN_DONE', data: body.data as IdentifyData });
      } catch (err) {
        const aborted = err instanceof Error && err.name === 'AbortError';
        dispatch({
          type: 'FAIL',
          code: aborted ? 'TIMEOUT' : 'NETWORK',
          message: aborted ? '识别超时了，换个角度再拍一张试试' : '网络似乎不太稳定，请重试',
        });
      } finally {
        clearTimeout(timeout);
      }
    },
    [],
  );

  /** 选中文件 → Canvas 压缩到长边 1280 / JPEG 0.82 → preparing done */
  const selectFile = useCallback(async (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    try {
      const blob = await compressImage(file);
      dispatch({ type: 'SELECT_FILE', previewUrl, blob });
    } catch {
      dispatch({ type: 'SELECT_FILE', previewUrl, blob: file });
    }
  }, []);

  /**
   * 选中后立刻扫描（拍照即识别的主路径）。
   * 压缩好的 blob 必须显式往下传：stateRef 要到下一次渲染才更新，
   * 这里若再读 ref 会拿到还是 null 的旧 state。
   */
  const captureAndScan = useCallback(async (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    let blob: Blob = file;
    try {
      blob = await compressImage(file);
    } catch {
      /* 压缩失败就用原图，压缩只是优化不是必需步骤 */
    }
    dispatch({ type: 'SELECT_FILE', previewUrl, blob });
    await sendScan({ blob, photoUrl: null, note: undefined });
  }, [sendScan]);

  /** 手动重跑：优先复用已上传的站内照片，避免二次传图 */
  const scan = useCallback(
    async (note?: string) => {
      await sendScan({
        blob: stateRef.current.blob,
        photoUrl: stateRef.current.photoUrl,
        note,
      });
    },
    [sendScan],
  );

  const updateNote = useCallback((note: string) => {
    dispatch({ type: 'UPDATE_NOTE', note });
  }, []);

  const updateForm = useCallback((patch: Partial<AnimalForm>) => {
    dispatch({ type: 'UPDATE_FORM', patch });
  }, []);

  /** 建档：复用已上传照片，从不二次传图 */
  const createAnimal = useCallback(async () => {
    const current = stateRef.current;
    dispatch({ type: 'CREATE_START' });

    const form = new FormData();
    if (current.blob) form.append('file', current.blob, 'capture.jpg');
    else if (current.photoUrl) form.append('fromPhotoUrl', current.photoUrl);
    form.append('name', current.form.name.trim());
    if (current.form.species !== 'UNKNOWN') form.append('species', current.form.species);
    if (current.form.summary.trim()) form.append('summary', current.form.summary.trim());
    if (current.form.features.trim()) form.append('featuresCsv', current.form.features.trim());
    if (current.form.lat != null && current.form.lng != null) {
      form.append('lat', String(current.form.lat));
      form.append('lng', String(current.form.lng));
    }

    try {
      const res = await fetch('/api/animals', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok || !body?.ok) {
        dispatch({
          type: 'FAIL',
          code: body?.error?.code ?? String(res.status),
          message: friendlyError(body?.error?.code, body?.error?.message),
        });
        return;
      }
      dispatch({ type: 'CREATE_DONE', data: body.data as CreateAnimalData });
    } catch {
      dispatch({ type: 'FAIL', code: 'NETWORK', message: '建档请求失败，请检查网络后重试' });
    }
  }, []);

  return {
    state,
    dispatch,
    selectFile,
    captureAndScan,
    scan,
    createAnimal,
    updateNote,
    updateForm,
    reset,
  };
}

/*
 * 压缩逻辑已提取到 lib/image-compress.ts。
 * 原先是本文件里的私有函数，但第 5 阶段的健康评估同样需要它 ——
 * 两份实现里必定有一个会漏掉压缩，而漏掉的那份会默默把 8MB 原图发给 AI。
 */

function holdUntil(deadline: number): Promise<void> {
  const wait = Math.max(0, deadline - Date.now());
  return new Promise((r) => setTimeout(r, wait));
}

const MESSAGES: Record<string, string> = {
  RATE_LIMITED: '刚刚识别得太快了，休息几秒再来。',
  MODERATION_BLOCKED: '描述里出现了不合适的内容，改一下再试。',
  BAD_REQUEST: '这张图片可能不被支持，换一张清晰点的试试。',
  AI_UNAVAILABLE: '识别服务暂时不可用，可以先手动描述再试一次。',
  INTERNAL: '服务器有点小情绪，请稍后重试。',
  NETWORK: '网络似乎不太稳定，请重试',
  TIMEOUT: '识别超时了，换个角度再拍一张试试',
};

function friendlyError(code?: string, fallback?: string): string {
  if (code && MESSAGES[code]) return MESSAGES[code];
  return fallback ?? '出了点小状况，请重试';
}
