import { HEALTH_META } from '@/lib/semantic';
import { CONFIDENCE_FLOOR } from '@/lib/constants';
import { StickerTag } from '@/components/star/StickerTag';
import type { TimelineEntry } from '@/lib/db/timeline';
import type { TimelineIcon } from '@/types/domain';

/**
 * 手账时间线。
 *
 * 刻意与便签墙分开：时间线是「按时间排序的事实」，便签墙是「随手贴的一句情绪」，
 * 两者混在一起会让「这条 STELLAR 更新了健康档」和「今天喂了半碗」分不出轻重。
 *
 * tone 由服务端算好（lib/db/timeline.ts），这里只负责取色，不做任何判断。
 */

const ICON: Record<TimelineIcon, string> = {
  star: '✦',
  feeding: '🍚',
  health: '＋',
  behavior: '◎',
  note: '·',
  report: 'AI',
  alert: '!',
};

export function TimelineList({ entries }: { entries: TimelineEntry[] }) {
  if (!entries.length) {
    return <p className="text-sm text-lo">还没有记录。它的第一笔，可能就是你的。</p>;
  }

  return (
    <ol className="relative space-y-4 border-l border-space-700 pl-4">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span
            className="absolute -left-[27px] top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px]"
            style={{ color: HEALTH_META[entry.tone].dot, boxShadow: `inset 0 0 0 1px ${HEALTH_META[entry.tone].dot}` }}
            aria-hidden
          >
            {ICON[entry.icon]}
          </span>

          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <time className="data-mono text-xs text-lo">{formatAt(entry.at)}</time>
            {entry.kind === 'HEALTH_REPORT' && entry.meta?.needsVet && (
              <StickerTag tone="red" rotate={0}>建议就医</StickerTag>
            )}
            {entry.statusLabel && <StickerTag tone="yellow" rotate={0}>{entry.statusLabel}</StickerTag>}
            {entry.meta?.reviewStatus === 'REJECTED' ? (
              <StickerTag tone="red" rotate={0}>已驳回</StickerTag>
            ) : (
              entry.pendingReview && <span className="text-[11px] text-lo">待核实</span>
            )}
          </div>

          <p className="mt-1 text-sm leading-[1.7] text-hi">{entry.title}</p>

          {entry.body && entry.body !== entry.title && (
            <p className="mt-1 text-xs leading-relaxed text-lo">{entry.body}</p>
          )}

          {/* 有图才占位：没有照片的条目不该为它留一块空白（阶段 4 收尾约定） */}
          {entry.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.imageUrl}
              alt="这条记录的配图"
              loading="lazy"
              className="mt-2 h-24 w-full rounded-[6px] object-cover ring-1 ring-space-700"
            />
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {entry.authorName && <span className="text-[11px] text-lo">— {entry.authorName}</span>}
            {entry.tags.slice(0, 3).map((t, i) => (
              <StickerTag key={t} tone="amber" rotate={(i % 2 === 0 ? -2 : 2) as number} size="sm">
                {t}
              </StickerTag>
            ))}
            {entry.meta?.confidence !== undefined && entry.meta.confidence < CONFIDENCE_FLOOR && (
              // 闸门从 constants 取，不在 UI 里写 0.6：阈值只有一处定义（R7）。
              // 文案沿用 R5 的统一口径，不另造「置信度偏低」这种半句提示。
              <span
                className="text-[11px] font-medium"
                style={{ color: 'color-mix(in srgb, var(--star-yellow) 62%, var(--space-900))' }}
              >
                AI 不确定，建议人工确认
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function formatAt(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays} 天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
