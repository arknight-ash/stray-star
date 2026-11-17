import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { StickerTag } from './StickerTag';

type Tone = 'paper' | 'amber' | 'mint';

const TONE: Record<Tone, string> = {
  paper: 'bg-space-800/90 text-hi ring-1 ring-space-700',
  amber: 'bg-accent-500/20 text-hi ring-1 ring-accent-500/40',
  mint: 'bg-star-green/15 text-hi ring-1 ring-star-green/30',
};

/**
 * 可旋转便签：承载众包记录的一句话状态、同学留言、护理提醒。
 *
 * rotate 是静态排版表达（贴歪的便签），不是动效，因此不受 reduced-motion 约束；
 * 但必须由 id 确定性给出（lib/jitter.ts），否则 SSR 与 hydration 两端算不出同一个角度。
 *
 * 向后兼容：早期只有 children/rotate/tone/pin/author，档案页（第 4 阶段）起
 * 追加了 meta/tags/pending/flyIn/onOpen。传了 onOpen 时根节点从 <figure>
 * 变成 <button> ——卡片整体可键盘聚焦，而不是在卡片里再塞一个看不见的按钮。
 */
export function NoteCard({
  children,
  rotate = 0,
  tone = 'paper',
  pin = false,
  author,
  meta,
  tags,
  pending = false,
  flyIn = false,
  imageUrl,
  onOpen,
  className,
}: {
  children: ReactNode;
  rotate?: number;
  tone?: Tone;
  pin?: boolean;
  author?: string;
  /** 右下角的次要信息（相对时间、来源等） */
  meta?: string;
  /** 胶带贴纸标签 */
  tags?: string[];
  /** 待管理员核实：加一圈虚线提示，不抢主内容的注意力 */
  pending?: boolean;
  /** 刚提交进墙时使用入场动效（CSS 实现，天然吃 reduced-motion 降级） */
  flyIn?: boolean;
  /** 众包照片。null/undefined 时**不渲染任何图片位** —— 不留空框（阶段 4 收尾约定） */
  imageUrl?: string | null;
  onOpen?: () => void;
  className?: string;
}) {
  const clamped = Math.max(-3, Math.min(3, rotate));
  const interactive = typeof onOpen === 'function';
  const body = (
    <>
      {pin && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2">
          <StickerTag tone="amber" rotate={0}>
            {''}
          </StickerTag>
        </span>
      )}
      {imageUrl && (
        // 便签是纸质的，图片按"贴在纸上的一张小照"处理：小圆角、不要投影。
        // 用 <img> 而不是 next/image：上传件已在客户端压到 ≤1280，本地静态目录再走一遍优化没有收益。
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={`${author ? `${author} 的` : ''}记录配图`}
          loading="lazy"
          className="mb-2 max-h-40 w-full rounded-[6px] object-cover ring-1 ring-space-700"
        />
      )}
      <blockquote className="text-sm leading-[1.7]">{children}</blockquote>
      {(author || meta) && (
        <figcaption className="data-mono mt-2 flex items-baseline justify-between gap-2 text-xs opacity-70">
          <span>{meta}</span>
          <span>{author ? `— ${author}` : ''}</span>
        </figcaption>
      )}
      {tags && tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.slice(0, 3).map((t, i) => (
            <StickerTag key={t} tone="paper" rotate={(i % 2 === 0 ? -2 : 2) as number} size="sm">
              {t}
            </StickerTag>
          ))}
        </div>
      )}
    </>
  );

  const shell = cn(
    'relative w-full rounded-sticker px-4 py-3 text-left shadow-glow',
    TONE[tone],
    pending && 'border border-dashed border-accent-400/60',
    flyIn && 'animate-note-fly',
    'transition-shadow duration-star ease-star',
    interactive && 'hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400',
    className,
  );

  if (interactive) {
    return (
      <button type="button" onClick={onOpen} className={shell} style={{ transform: `rotate(${clamped}deg)` }}>
        {body}
      </button>
    );
  }

  return (
    <figure className={shell} style={{ transform: `rotate(${clamped}deg)` }}>
      {body}
    </figure>
  );
}
