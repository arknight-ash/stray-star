'use client';

import { useCallback, useRef, useState } from 'react';
import { Camera, ImagePlus, PenLine, X } from 'lucide-react';
import { LIMITS } from '@/lib/constants';
import { AiAnalysisResult, AiAnalyzing } from './AiAnalysisResult';
import { useRecordDraft } from './useRecordDraft';
import type { NoteVM } from '@/types/domain';

/**
 * 底部固定的「记录一笔」—— 众包表单（阶段 4 收尾；2026-10-28 改为 AI 解析主导）。
 *
 * 这里只负责**移动端那条记录条的形态**（收起一个按钮、展开是面板、贴着 tab bar 上方），
 * 提交行为本身在 `useRecordDraft`：/report 页面与本组件共用同一台状态机，
 * 压缩 / 降级 / 只发文字 / 幂等键五条规则不会各处漂移。
 *
 * 这一段刻意没有「分类」和「严重程度」控件：用户只写现场，
 * 其余交给 AI（`/api/observations` → `lib/observations/analyze.ts`）。
 * 提交后面板不会立刻消失，而是切到解析中 → 展示 AI 提取的标签组，
 * 让人看见系统读懂了什么，再决定"完成 / 再记一笔"。
 *
 * 可访问性：每个控件都有可读名字（label/aria-label），错误 role="alert"，
 * 解析中 aria-busy / role="status"，关闭后焦点回到触发按钮。
 *
 * z-index 抬到 tab bar（z-30）之上，并让出安全区高度 ——
 * 否则 iPhone 上它会压住原生指示条，而 tab bar 又压住它。
 */

export function RecordBar({
  animalCode,
  animalName,
  onAdded,
}: {
  animalCode: string;
  animalName: string;
  onAdded: (note: NoteVM, toast: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const draft = useRecordDraft({ animalCode, onAdded });
  const { content, setContent, authorName, setAuthorName } = draft;

  /** 收起面板并把焦点还给触发按钮：面板是从这个按钮展开的 */
  const close = useCallback(() => {
    setOpen(false);
    draft.dismissResult();
    draft.clearError();
    triggerRef.current?.focus();
  }, [draft]);

  /** 「再记一笔」：清空上一条，面板留在原地 */
  const again = useCallback(() => {
    draft.reset();
  }, [draft]);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-space-700 bg-space-900/95 px-4 py-3 backdrop-blur md:hidden"
      style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))', bottom: 'calc(56px + env(safe-area-inset-bottom))' }}
    >
      {open ? (
        <div className="space-y-2">
          {draft.result ? (
            <AiAnalysisResult
              data={draft.result}
              animalName={animalName}
              onDone={close}
              onAgain={again}
            />
          ) : draft.phase === 'analyzing' ? (
            <AiAnalyzing withPhoto={Boolean(draft.photo)} step={draft.analyzeStep} />
          ) : (
            <>
              <label htmlFor="record-content" className="sr-only">
                记录内容
              </label>
              <textarea
                id="record-content"
                value={content}
                onChange={(e) => setContent(e.target.value.slice(0, LIMITS.observation))}
                placeholder={`今天 ${animalName} 怎么样？写一句就行，AI 会帮你归类`}
                rows={3}
                autoFocus
                className="w-full resize-none rounded-btn bg-space-800 px-3 py-2 text-sm text-hi ring-1 ring-space-700 outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
              />

              {/* 无图时这一块完全不渲染任何图片框 —— 空的占位框会让人以为"必须传图" */}
              {draft.photo && (
                <div className="flex items-center gap-2">
                  {/* blob: 预览只能是 <img>，next/image 不接受 blob URL */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={draft.photo.previewUrl}
                    alt="即将提交的照片预览"
                    className="h-14 w-14 shrink-0 rounded-btn object-cover ring-1 ring-space-700"
                  />
                  <span className="min-w-0 flex-1 text-[11px] text-lo">
                    {draft.photo.degraded ? '已使用原图（本次未能压缩）' : '已压缩，随记录一起交给 AI 判断'}
                  </span>
                  <button
                    type="button"
                    onClick={draft.clearPhoto}
                    aria-label="移除照片"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-btn text-lo hover:text-hi"
                  >
                    <X size={16} aria-hidden />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2">
                {/* 选图按钮：input 隐藏但可键盘触发（label 包住，Enter/Space 都行） */}
                <button
                  type="button"
                  onClick={() => draft.fileRef.current?.click()}
                  disabled={draft.compressing || draft.busy}
                  aria-label={draft.photo ? '换一张照片' : '添加照片（选填）'}
                  aria-busy={draft.compressing}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-btn bg-space-800 text-lo ring-1 ring-space-700 disabled:opacity-40"
                >
                  {draft.photo ? <Camera size={16} aria-hidden /> : <ImagePlus size={16} aria-hidden />}
                </button>
                <input
                  ref={draft.fileRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => void draft.pickPhoto(e.target.files?.[0])}
                />

                <input
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value.slice(0, LIMITS.authorName))}
                  placeholder="昵称（选填）"
                  aria-label="昵称（选填）"
                  className="min-w-0 flex-1 rounded-btn bg-space-800 px-3 py-2 text-sm text-hi ring-1 ring-space-700 outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                />
                <button
                  type="button"
                  onClick={() => void draft.submit()}
                  disabled={!draft.canSubmit}
                  aria-busy={draft.busy}
                  className="min-h-[44px] shrink-0 rounded-btn bg-accent-400 px-4 text-sm font-medium text-space-900 disabled:opacity-40"
                >
                  {draft.busy ? '解析中…' : '交给 AI'}
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="min-h-[44px] shrink-0 rounded-btn px-2 text-sm text-lo"
                >
                  取消
                </button>
              </div>

              <p className="text-[11px] text-lo">
                分类、标签与严重程度由 AI 判定，你只需要写清楚看到了什么。
              </p>

              {draft.compressing && <p className="text-xs text-lo">正在压缩照片…</p>}

              {draft.error && (
                <div role="alert" className="space-y-1">
                  <p className="text-xs text-star-red">{draft.error}</p>
                  {draft.canRetryTextOnly && (
                    <button
                      type="button"
                      onClick={() => void draft.submit(true)}
                      disabled={draft.busy}
                      className="text-xs text-accent-300 underline underline-offset-2 disabled:opacity-40"
                    >
                      这张图不行，只发文字
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-btn border border-accent-400/50 px-4 text-sm text-accent-300"
        >
          <PenLine size={15} aria-hidden />
          记录一笔
        </button>
      )}
    </div>
  );
}
