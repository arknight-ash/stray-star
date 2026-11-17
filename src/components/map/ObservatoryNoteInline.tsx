import Link from 'next/link';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import type { MapNote } from '@/lib/api/map-note-contract';

/**
 * 首页 hero 里的「AI 观测」一行（2026-10-28）。
 *
 * 与星图页右栏的完整卡片是同一个数据源（`getObservatoryNote`，同一份缓存），
 * 这里只取一句话 + 时刻：首屏不该被第二张卡占满，但"AI 在看全场"这件事
 * 必须在不滚动的情况下就能被看到。
 *
 * 整块是链接：点进去是星图，那里有完整依据（关注对象、证据、数据口径）。
 */
export function ObservatoryNoteInline({ note, className }: { note: MapNote; className?: string }) {
  const ai = note.source === 'ai';
  return (
    <Link
      href="/map"
      className={`group flex max-w-xl items-start gap-2.5 rounded-card border border-accent-400/25 bg-space-900/45 px-3 py-2.5 backdrop-blur-md transition-colors duration-star ease-star hover:border-accent-400/55 ${className ?? ''}`}
      aria-label="查看 AI 星图观测手记"
    >
      <Sparkles size={14} className="mt-0.5 shrink-0 text-accent-400" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[11px] text-accent-300">
          {/* 不重复报时刻：句子本身就以「23:20，……」开头（服务端 prompt 的句式） */}
          AI 观测
          {!ai && (
            // 降级要诚实：这句是本地规则拼的，不能让首屏读者以为模型写的
            <span className="rounded-full border border-star-yellow/45 px-1.5 py-px text-[10px] leading-none text-star-yellow">
              本地摘要
            </span>
          )}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-hi">{note.text}</span>
      </span>
      <ArrowUpRight
        size={13}
        aria-hidden
        className="mt-1 shrink-0 text-lo transition-colors duration-star ease-star group-hover:text-hi"
      />
    </Link>
  );
}
