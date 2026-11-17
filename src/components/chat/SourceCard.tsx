'use client';

import Link from 'next/link';
import { ArrowUpRight, Database, Star } from 'lucide-react';
import { chunkLabel, type Citation } from '@/lib/rag/citations';
import { cn } from '@/lib/utils';

/**
 * 来源卡片：引用标注展开后的内容。
 *
 * 并列（tied）必须显式写出来：检索器分不出高下时，
 * 假装其中一条更权威是最容易骗到用户的做法。
 *
 * 数据库引用单独标出来（图标 + 口径说明）：统计数字是本机算的，
 * 把它和"手册第几段"混成一种来源，等于给数字伪造了一个书面出处。
 */
export function SourceCard({ citation, className }: { citation: Citation; className?: string }) {
  const isAnimal = citation.kind === 'animal';
  const isDb = citation.kind === 'database';

  return (
    <div
      role="tooltip"
      className={cn(
        'w-64 rounded-sticker bg-space-800 p-3 text-left ring-1 ring-space-700',
        'sheet-fade-in',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        {isDb ? (
          <Database size={12} className="mt-0.5 shrink-0 text-accent-300" aria-hidden />
        ) : (
          <Star size={12} className="mt-0.5 shrink-0 text-star-green" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium text-hi">
            {citation.title}
            {citation.chunkIndex !== undefined && (
              <span className="ml-1 font-normal text-lo">· {chunkLabel(citation.chunkIndex)}</span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-lo">
            {isAnimal ? `档案 ${citation.source}` : citation.source}
          </p>
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-lo">{citation.snippet}</p>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="data-mono text-[11px] text-lo">
          {citation.tied
            ? '两条资料都相关'
            : isDb
              ? '实时统计'
              : `相关度 ${citation.score.toFixed(2)}`}
        </span>
        {citation.href && (
          <Link
            href={citation.href}
            className="inline-flex items-center gap-0.5 text-[11px] text-accent-300 hover:text-hi"
          >
            看档案
            <ArrowUpRight size={11} aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}
