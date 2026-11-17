'use client';

import { Camera, Loader2, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useHealthAssess } from '@/hooks/useHealthAssess';
import { HealthResultSheet } from './HealthResultSheet';
import { LIMITS } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * 档案页的「AI 健康初筛」入口。
 *
 * 两件事不能省：
 *  1. 提交按钮有三种态（可选 → 分析中禁用+spinner → 完成），
 *     不给禁用态就会被人连点三次，每一次都在真烧 vision 调用；
 *  2. 失败必须显示服务端给的原文案（UI 不重新编写错误信息），
 *     否则「图片太大」和「内容不合适」在用户看来都一样。
 */
export function AssessHealthPanel({
  animalId,
  animalName,
  className,
}: {
  animalId: string;
  animalName: string;
  className?: string;
}) {
  const { state, selectFile, setDescription, submit, reset } = useHealthAssess(animalId);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const assessing = state.phase === 'assessing';

  return (
    <section
      className={cn('glass-card p-4', className)}
      aria-label="AI 健康初筛"
    >
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-hi">
        <Sparkles size={14} style={{ color: 'var(--accent-400)' }} aria-hidden />
        AI 健康初筛
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-lo">
        拍一张 {animalName} 现在的样子，写一句你看到的症状，AI 会给出初筛结论。
        照片会在浏览器里先压缩，上传更快。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            selectFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={assessing}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-btn bg-space-900/70 px-3 text-sm text-hi ring-1 ring-space-700 transition-colors duration-star ease-star hover:ring-accent-400 disabled:opacity-50"
        >
          <Camera size={15} aria-hidden />
          {state.previewUrl ? '换一张' : '拍照 / 选图'}
        </button>

        {state.previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={state.previewUrl}
            alt={`待评估的${animalName}照片`}
            className="h-14 w-14 rounded-sticker object-cover ring-1 ring-space-700"
          />
        )}
      </div>

      <label className="mt-3 block">
        <span className="text-xs text-lo">现场描述（选填）</span>
        <textarea
          value={state.description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="比如：右后腿不敢着地，一直舔伤口"
          rows={2}
          disabled={assessing}
          className="mt-1 w-full resize-none rounded-btn bg-space-900/70 px-3 py-2 text-sm text-hi ring-1 ring-space-700 outline-none placeholder:text-lo disabled:opacity-60"
        />
        <span className="text-[11px] text-lo">
          {state.description.length}/{LIMITS.note} 字
        </span>
      </label>

      <button
        type="button"
        onClick={submit}
        disabled={assessing || !state.previewUrl}
        className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-btn bg-accent-400 px-4 text-sm font-medium text-space-900 transition-opacity duration-star ease-star disabled:opacity-40"
      >
        {assessing ? (
          <>
            <Loader2 size={15} className="animate-spin" aria-hidden />
            正在分析…
          </>
        ) : (
          <>
            <Sparkles size={15} aria-hidden />
            开始初筛
          </>
        )}
      </button>

      {state.failure && (
        // 红星色在纸面上太亮（对比度不足），压深后再用 —— 走 color-mix 不引入第二份色值
        <p
          className="mt-2 text-xs font-medium leading-relaxed"
          style={{ color: 'color-mix(in srgb, var(--star-red) 78%, var(--space-900))' }}
          role="alert"
        >
          {state.failure.message}
        </p>
      )}

      {state.phase === 'done' && state.data && (
        <HealthResultSheet
          data={state.data}
          open={open || state.phase === 'done'}
          onClose={() => {
            setOpen(false);
            reset();
            // 评估结果会改变健康档位与时间线，回来时让服务端重新取数
            router.refresh();
          }}
          onRetry={reset}
        />
      )}
    </section>
  );
}
