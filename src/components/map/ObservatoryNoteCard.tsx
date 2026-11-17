'use client';

import Link from 'next/link';
import { Activity, ArrowUpRight, Sparkles } from 'lucide-react';
import { StarDot } from '@/components/star/StarDot';
import { HEALTH_META } from '@/lib/semantic';
import type { MapNote } from '@/lib/api/map-note-contract';

/**
 * 「AI 星图观测手记」卡片（2026-10-28）。
 *
 * 它要回答的疑问是「AI 是不是只会被动答问」，所以版面上必须能看出**依据**：
 * 一句话 + 关注对象 + 2-4 条事实 + 数据口径与更新时间。少了最后两行，
 * 这句话就退化成一句好听话，评委无法判断它是不是又在编。
 *
 * 降级态一律明说：`source === 'fallback'` 时徽标写「本地摘要」并用黄星色，
 * 不许把规则拼的句子伪装成模型写的（项目铁律：降级要诚实）。
 */
export function ObservatoryNoteCard({ note, className }: { note: MapNote; className?: string }) {
  const ai = note.source === 'ai';
  const focusMeta = note.focus ? HEALTH_META[note.focus.healthLevel] : null;

  return (
    <section
      aria-label="AI 星图观测手记"
      // 复用首页星枢主卡的 .agent-spotlight：AI 的卡面在全站用同一套视觉语言。
      // 之前试过整块铺 --grad-cta，紫底上正文字号小，读起来费劲（对比度也压不住）。
      className={`agent-spotlight map-card-in rounded-card p-4 ${className ?? ''}`}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-hi">
            <Sparkles size={14} className="text-accent-400" aria-hidden />
            AI 星图观测手记
          </h2>
          <span
            className={
              ai
                ? 'shrink-0 rounded-full border border-accent-400/45 bg-accent-400/10 px-1.5 py-0.5 text-[10px] leading-none text-accent-300'
                : 'shrink-0 rounded-full border border-star-yellow/45 bg-star-yellow/12 px-1.5 py-0.5 text-[10px] leading-none text-star-yellow'
            }
            title={
              ai
                ? '这句话由模型读全局数据后写出，编号与数字均来自档案'
                : 'AI 这次不可用，这句话由本地规则依据同一份数据拼出'
            }
          >
            {ai ? 'AI 生成' : '本地摘要'}
          </span>
        </div>

        <p className="mt-2 text-sm leading-[1.75] text-hi">{note.text}</p>

        {note.focus && focusMeta && (
          <Link
            href={`/animals/${note.focus.code}`}
            className="hover:ring-accent-400/60 group mt-3 flex min-h-[40px] items-center gap-2 rounded-btn bg-space-900/60 px-2.5 py-2 ring-1 ring-space-700 transition-colors duration-star ease-star"
          >
            <StarDot level={note.focus.healthLevel} shape="star" size={14} />
            <span className="min-w-0 flex-1 truncate text-xs text-hi">
              {note.focus.name}
              <span className="data-mono ml-1 text-[11px] text-lo">{note.focus.code}</span>
            </span>
            <span className="shrink-0 text-[10px]" style={{ color: focusMeta.dot }}>
              {focusMeta.label}
            </span>
            <ArrowUpRight
              size={12}
              aria-hidden
              className="shrink-0 text-lo transition-colors duration-star ease-star group-hover:text-hi"
            />
          </Link>
        )}

        {note.signals.length > 0 && (
          <ul className="mt-3 space-y-1">
            {note.signals.map((signal) => (
              <li key={signal} className="flex gap-1.5 text-[11px] leading-relaxed text-lo">
                <span aria-hidden className="text-accent-400">
                  ·
                </span>
                <span className="min-w-0">{signal}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex items-start gap-1.5 border-t border-space-700/60 pt-2 text-[10px] leading-relaxed text-lo">
          <Activity size={11} className="mt-0.5 shrink-0" aria-hidden />
          <p>
            依据 <span className="data-mono text-hi">{note.window.total}</span> 颗星 ·{' '}
            <span className="data-mono text-hi">{note.window.openAlerts}</span> 条未处理预警 ·{' '}
            {note.window.label}
            <br />
            更新于 {formatDateTime(note.generatedAt)} · 数据变化或超过{' '}
            <span className="data-mono">{note.window.ttlMinutes}</span> 分钟时重算
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * MM-DD HH:mm（接收 ISO）。
 * 带日期是刻意的：正文本身就以「23:15，……」开头，这里再只写 HH:mm 会像重复了一遍。
 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
