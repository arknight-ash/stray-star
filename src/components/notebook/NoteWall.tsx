'use client';

import { useEffect, useState } from 'react';
import { NoteCard } from '@/components/star/NoteCard';
import { rotateFor } from '@/lib/jitter';
import type { NoteVM } from '@/types/domain';

/**
 * 众包便签墙。
 *
 * 两个重要的技术选择：
 *  1. 用 CSS `columns` 而不是 grid —— 便签高度天然不等，grid 会留下规则空洞，
 *     而 columns 会自然错落地填满；
 *  2. 新便签插入时**不给其它便签做 layout 动画**：几十张便签同时平移在低端安卓直接掉帧，
 *     而且 layout 动画不受 globals.css 的 reduced-motion 规则管辖。
 */

export function NoteWall({
  notes,
  flyInId,
  onOpen,
}: {
  notes: NoteVM[];
  /** 刚提交的那条：给它入场动效（顺时针方向「飞入墙面」） */
  flyInId?: string | null;
  onOpen?: (note: NoteVM) => void;
}) {
  // 服务端渲染时不能算 Date.now()，否则 hydration 两端不一致 —— 交给挂载后再显示相对时间
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!notes.length) {
    return (
      <p className="rounded-card border border-dashed border-space-700 px-4 py-6 text-center text-sm text-lo">
        还没有人给它留过便签。看到它的样子，就记一笔吧。
      </p>
    );
  }

  return (
    <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          rotate={rotateFor(note.id, 3)}
          author={note.authorName}
          tags={note.tags}
          pending={note.pendingReview}
          flyIn={note.id === flyInId}
          imageUrl={note.imageUrl}
          meta={mounted ? relativeTime(note.at) : undefined}
          onOpen={onOpen ? () => onOpen(note) : undefined}
        >
          {note.content}
        </NoteCard>
      ))}
    </div>
  );
}

function relativeTime(iso: string): string {
  const diffDays = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 30) return `${diffDays} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}
