'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LIMITS } from '@/lib/constants';
import { compressImage } from '@/lib/image-compress';
import { useGeolocation } from '@/lib/use-geolocation';
import type { ObservationData } from '@/lib/api/observation-contract';
import type { NoteVM } from '@/types/domain';

/**
 * 「记录一笔」的提交状态机 —— 移动端底部记录条与 /report 页面表单共用。
 *
 * 为什么必须只有这一份：众包提交有五条不能各写各的规则
 *  （docs/stage-4-profile.md §7.7），任何一处单独实现都会悄悄漂移：
 *   1. 压缩一律走 `lib/image-compress.ts`，失败退原图并把 degraded 报给 UI；
 *   2. 服务端拒图（400）必须给「只发文字」出口，不能逼用户重写一遍正文；
 *   3. 网络失败保留正文与预览，不清空草稿；
 *   4. 每次成功提交后必须换幂等键，否则第二条会被当重放吞掉；
 *   5. 成功提示用服务端原文（含阶段 7 的预警 notice），前端不自己拼措辞。
 *
 * 2026-10-28 改造：**用户不再选分类，也不选严重程度**。
 * 提交后进入 `analyzing` 阶段，界面展示"AI 正在解析"；服务端返回的
 * `ObservationData.analysis`（type / tags / severity / sentiment / entities）
 * 才是这条记录的全部归类信息，UI 只负责把它显示出来。
 *
 * hook 不带 DOM：渲染形状由调用方决定（底部条 / 整页表单），
 * 它只负责「这份草稿现在是什么状态、能不能提交、提交结果如何」。
 */

export interface PickedPhoto {
  file: File;
  previewUrl: string;
  /** 压缩失败、退回原图时置 true：界面要说实话，而不是假装压过了 */
  degraded: boolean;
}

/** idle = 填表/空闲；analyzing = 已提交、等 AI 返回结构化结果 */
export type RecordPhase = 'idle' | 'analyzing';

/** 解析中提示的轮播间隔：慢一点像"真在读"，快一点会闪得人心慌 */
const ANALYZE_STEP_MS = 1100;

export function useRecordDraft({
  animalCode,
  onAdded,
}: {
  /** 这条记录挂到哪一颗星；换星时由调用方更新，hook 不持有"当前星"这件事 */
  animalCode: string;
  onAdded?: (note: NoteVM, toast: string) => void;
}) {
  const [content, setContent] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 服务端拒图时置 true：给用户「只发文字」的出路 */
  const [canRetryTextOnly, setCanRetryTextOnly] = useState(false);

  /** 提交后进入「AI 解析中」；结果回来才回 idle */
  const [phase, setPhase] = useState<RecordPhase>('idle');
  /** 解析提示的轮播下标（只会单调增，调用方按自己的文案长度取模） */
  const [analyzeStep, setAnalyzeStep] = useState(0);
  /** 服务端解析完成的结构化结果：只有它非空时界面才展示标签组 */
  const [result, setResult] = useState<ObservationData | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  /**
   * 设备定位（2026-10-29）：用户点「用当前位置」才取，取到就随这条记录提交。
   *
   * 为什么不自动取：浏览器要求定位必须有用户手势，自动调用会被静默拒绝，
   * 而"静默失败"在这里代价很大 —— 用户会以为位置已经带上了，实际记录里没有坐标。
   */
  const geo = useGeolocation();
  // 幂等键惰性生成：SSR 阶段不碰 Date.now()，两端 HTML 才对得上
  const clientIdRef = useRef<string | null>(null);
  const stepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── 存草稿（设计稿图5 的「存草稿」按钮）──
     正文/署名进 localStorage，按星号分键；照片不持久化（File 无法序列化），
     恢复草稿后需要重新选图 —— UI 上要说清楚这一点。
     分类与严重度不存：它们是 AI 每次重新判的，缓存上次的判定只会误导用户。 */
  const draftKey = animalCode ? `ss:record-draft:${animalCode}` : null;
  const restoredKeyRef = useRef<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);

  const clearStoredDraft = useCallback(() => {
    if (!draftKey) return;
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* 隐私模式等场景静默：存不进去不该影响提交主链路 */
    }
  }, [draftKey]);

  // 换到某颗星第一次渲染表单时，把上次的草稿接回来
  useEffect(() => {
    if (!draftKey || restoredKeyRef.current === draftKey) return;
    restoredKeyRef.current = draftKey;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as { content?: unknown; authorName?: unknown };
      if (typeof saved.content === 'string' && saved.content.trim()) {
        setContent(saved.content.slice(0, LIMITS.observation));
      }
      if (typeof saved.authorName === 'string') {
        setAuthorName(saved.authorName.slice(0, LIMITS.authorName));
      }
    } catch {
      /* 坏数据当没有草稿 */
    }
  }, [draftKey]);

  // 内容变化即自动保存：手动按钮只是给一个「已保存」的确认，不承担唯一保存职责
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (content.trim() || authorName.trim()) {
        localStorage.setItem(draftKey, JSON.stringify({ content, authorName }));
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch {
      /* 同上，静默 */
    }
  }, [content, authorName, draftKey]);

  const saveDraft = useCallback(() => {
    if (!content.trim()) {
      setDraftNotice('先写一句话，才有东西可存');
      return;
    }
    // 自动保存已经落盘，这里只负责把结果告诉用户
    setDraftNotice(`已为 ${animalCode} 存下草稿${photo ? '（照片需要重新选）' : ''}，下次写记录时会自动带出`);
  }, [content, animalCode, photo]);

  // 预览 URL 必须回收：选十次图就是十份 blob 常驻内存
  useEffect(() => {
    return () => {
      if (photo) URL.revokeObjectURL(photo.previewUrl);
    };
  }, [photo]);

  // 解析提示的计时器必须在卸载时停掉，否则 setState 会打到已卸载组件上
  useEffect(() => {
    return () => {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
    };
  }, []);

  const clearPhoto = useCallback(() => {
    setPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setCanRetryTextOnly(false);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const pickPhoto = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('只能选图片文件');
      return;
    }

    setCompressing(true);
    setError(null);
    setCanRetryTextOnly(false);

    let blob: Blob = file;
    let degraded = false;
    try {
      blob = await compressImage(file);
    } catch {
      // createImageBitmap 不支持 HEIC / 老浏览器：退回原图，别让用户白选一次
      blob = file;
      degraded = true;
    }

    if (blob.size > LIMITS.imageBytes) {
      setError(
        `这张照片压缩后仍有 ${(blob.size / 1024 / 1024).toFixed(1)}MB，超过 ${Math.round(
          LIMITS.imageBytes / 1024 / 1024,
        )}MB 上限，请换一张`,
      );
      setCompressing(false);
      return;
    }

    setPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return {
        file: new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' }),
        previewUrl: URL.createObjectURL(blob),
        degraded,
      };
    });
    setCompressing(false);
  }, []);

  const stopStepTimer = useCallback(() => {
    if (stepTimerRef.current) {
      clearInterval(stepTimerRef.current);
      stepTimerRef.current = null;
    }
  }, []);

  /** 清空草稿：内容/照片/解析结果全部归零，并换一个幂等键给下一条用 */
  const reset = useCallback(() => {
    stopStepTimer();
    setContent('');
    setError(null);
    setCanRetryTextOnly(false);
    setDraftNotice(null);
    setPhase('idle');
    setAnalyzeStep(0);
    setResult(null);
    clearPhoto();
    clearStoredDraft();
    geo.clear();
    clientIdRef.current = null;
  }, [clearPhoto, clearStoredDraft, stopStepTimer, geo]);

  /** 只清错误：收起面板再用同样草稿重试时，旧报错不该跟着回来 */
  const clearError = useCallback(() => {
    setError(null);
    setCanRetryTextOnly(false);
  }, []);

  /** 结果卡上的「完成」：把结果收掉，回到可填表状态 */
  const dismissResult = useCallback(() => {
    setResult(null);
    setPhase('idle');
  }, []);

  async function submit(withoutPhoto = false) {
    if (content.trim().length < 1 || busy || !animalCode) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setAnalyzeStep(0);
    setPhase('analyzing');

    // 解析耗时不可控（实测 2-8s），界面需要一句会变的提示来证明它真的在动
    stopStepTimer();
    stepTimerRef.current = setInterval(() => {
      setAnalyzeStep((s) => s + 1);
    }, ANALYZE_STEP_MS);

    if (!clientIdRef.current) clientIdRef.current = `record-${Date.now()}`;

    const form = new FormData();
    form.set('animalCode', animalCode);
    form.set('content', content.trim());
    if (authorName.trim()) form.set('authorName', authorName.trim());
    form.set('clientId', clientIdRef.current);
    /* 定位随记录一起提交（2026-10-29）。服务端还会过一遍校园围栏 ——
       前端只负责「问用户要权限、把坐标读上来」，判合不合法不归它管。
       acc 只是精度参考，服务端拿它做审计与文案，不参与是否入库的判断。 */
    if (geo.fix) {
      form.set('lat', String(geo.fix.lat));
      form.set('lng', String(geo.fix.lng));
      if (geo.fix.accuracyM !== null) form.set('acc', String(geo.fix.accuracyM));
    }
    if (photo && !withoutPhoto) form.set('photo', photo.file, 'photo.jpg');
    // 分类与严重度不上传：它们由服务端 AI 解析判定（ObservationAnalysis）

    try {
      const res = await fetch('/api/observations', { method: 'POST', body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message ?? '提交失败，请重试');
        // 400 且带图：大概率是图片本身的问题（格式/大小），给文字通道
        if (photo && !withoutPhoto && res.status === 400) setCanRetryTextOnly(true);
        return;
      }

      const data = body.data as ObservationData;
      setResult(data);

      onAdded?.(
        {
          id: data.observation.id,
          content: data.observation.content,
          tags: data.observation.tags,
          type: data.observation.type,
          severity: data.observation.severity,
          imageUrl: data.observation.imageUrl,
          authorName: data.observation.authorName,
          at: data.observation.createdAt,
          pendingReview: data.observation.pendingReview,
        },
        // notice 由服务端给原文（阶段 7）：命中预警时告诉同学"有人被通知了"，
        // 措辞只有服务端那一处，前端不自己拼。
        data.notice ? `${data.toast} · ${data.notice}` : data.toast,
      );

      setContent('');
      clearPhoto();
      clearStoredDraft();
      // 位置也跟着这条记录用掉了：留着会让下一条记录莫名其妙带上旧坐标
      geo.clear();
      clientIdRef.current = null;
    } catch {
      // 网络失败：草稿与预览都留着，用户不需要重新拍一遍
      setError('网络似乎不太稳定，请重试（内容已保留）');
    } finally {
      stopStepTimer();
      setBusy(false);
      setPhase('idle');
    }
  }

  return {
    content,
    setContent,
    authorName,
    setAuthorName,
    photo,
    compressing,
    busy,
    error,
    canRetryTextOnly,
    fileRef,
    pickPhoto,
    clearPhoto,
    clearError,
    submit,
    reset,
    /** 草稿持久化：手动「存草稿」按钮的确认文案（自动保存始终在后台进行） */
    saveDraft,
    draftNotice,
    /** AI 解析中的阶段标记与轮播下标 */
    phase,
    analyzeStep,
    /** 服务端返回的结构化解析结果；非空即"已归档" */
    result,
    dismissResult,
    /**
     * 设备定位：`locate()` 只能在点击回调里调（浏览器要求用户手势），
     * `status/message` 用来渲染「定位中 / 精度 ±12 米 / 权限被拒」这三类反馈。
     */
    geo,
    /** 正文够长且没在忙碌时可以提交 */
    canSubmit: content.trim().length >= 1 && !busy && !compressing && animalCode.length > 0,
  };
}
