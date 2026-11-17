'use client';

import { useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2 } from 'lucide-react';
import { CornerStars } from './CornerStars';
import { StarDustLine } from './StarDustLine';
import { NoteField } from './NoteField';
import { cn } from '@/lib/utils';

/**
 * 取景框：拖放 / 点击选择 / 手机直拍（capture=environment）。
 * 它只负责「把图片交给上层」，不做任何判定 —— 状态机在 CaptureClient 里。
 */
export function Viewfinder({
  previewUrl,
  scanning,
  disabled,
  note,
  onNoteChange,
  onPick,
  className,
}: {
  previewUrl: string | null;
  scanning: boolean;
  disabled?: boolean;
  note: string;
  onNoteChange: (next: string) => void;
  onPick: (file: File) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className={cn('space-y-4', className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (disabled) return;
          const file = e.dataTransfer.files?.[0];
          if (file) onPick(file);
        }}
        className={cn(
          'star-card relative isolate aspect-[3/4] w-full overflow-hidden transition-colors duration-star ease-star sm:aspect-[4/3]',
          dragging && 'border-accent-400/60',
        )}
      >
        {/* 预览图层：淡入 240ms */}
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={previewUrl}
            src={previewUrl}
            alt="待识别的照片预览"
            className="animate-dust-in absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 starfield grid place-items-center bg-space-800">
            <div className="flex flex-col items-center gap-2 text-center">
              <Camera size={28} className="text-accent-300" aria-hidden />
              <p className="font-display text-lg text-accent-300">对准它，捕获一颗星</p>
              <p className="max-w-[16rem] text-xs text-lo">
                把照片拖进来，或直接用手机拍一张。只有在校园里生活的小家伙才在星图里。
              </p>
            </div>
          </div>
        )}

        <StarDustLine running={scanning} />
        <CornerStars active={scanning} />

        {scanning && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-space-900/70 py-3 backdrop-blur">
            <Loader2 size={15} className="animate-spin text-accent-300" aria-hidden />
            <span className="text-sm text-accent-300" role="status">
              正在比对星图…
            </span>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = '';
        }}
      />

      {/* 相机造型控制条（设计稿：相册 | 快门），快门 = 拍一张并自动识别 */}
      <p className="text-center text-xs text-lo" aria-hidden>
        对准动物，自动识别
      </p>
      <div className="flex items-center justify-between px-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="flex min-h-[52px] min-w-[64px] flex-col items-center justify-center gap-1 rounded-btn bg-space-800/80 px-3 text-[11px] text-hi ring-1 ring-space-700 transition-colors duration-star ease-star hover:ring-accent-400/50 disabled:opacity-50"
        >
          <ImagePlus size={18} strokeWidth={1.75} aria-hidden />
          相册
        </button>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          aria-label={previewUrl ? '再拍一张并自动识别' : '拍一张并自动识别'}
          className="grid h-16 w-16 place-items-center rounded-full text-space-900 shadow-glow ring-4 ring-space-700/60 transition-transform duration-star ease-star hover:scale-105 disabled:opacity-50"
          style={{ backgroundImage: 'var(--grad-cta)' }}
        >
          <Camera size={24} aria-hidden />
        </button>

        {/* 右侧占位：与左侧等宽，保持快门居中 */}
        <span className="min-w-[64px]" aria-hidden />
      </div>

      <NoteField value={note} onChange={onNoteChange} disabled={disabled} />
    </div>
  );
}
