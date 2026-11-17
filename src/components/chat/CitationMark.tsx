'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { SourceCard } from './SourceCard';
import { chunkLabel, type Citation } from '@/lib/rag/citations';

/**
 * 「星图标注」：正文里的 [n] 渲染成一颗小星 + 序号，展开后是来源卡片。
 *
 * 三条可访问性要求（缺一条都会有人看不到出处）：
 * 1. 用 <button> 而不是 <span onMouseOver> —— 键盘要能 Tab 到；
 * 2. 桌面 hover **与 focus** 都展开，移动端（pointer: coarse）改为点击；
 *    判定触屏用 `(pointer: coarse)`，不用屏幕宽度猜设备；
 * 3. Esc 关闭、点击外部关闭，卡片 `role="tooltip"` 且 aria-describedby 关联。
 *
 * 动效：hover 时星点呼吸（--dur-pulse）。reduced-motion 下全局降级会把动画停掉，
 * 因此辉光写成**静态内联样式**而不是只存在于 keyframes 里 ——
 * 否则降级后只剩一颗没有光晕的小点（StarDot 那次就是这么变的暗）。
 */
export function CitationMark({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const cardId = useId();

  useEffect(() => {
    setCoarse(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onOutside = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [open]);

  const label =
    citation.kind === 'animal'
      ? `引用 ${citation.seq}：${citation.title} 的档案`
      : citation.kind === 'database'
        ? `引用 ${citation.seq}：本地数据库实时统计`
        : `引用 ${citation.seq}：${citation.title}${
            citation.chunkIndex !== undefined ? ` ${chunkLabel(citation.chunkIndex)}` : ''
          }`;

  return (
    <span ref={wrapRef} className="relative inline-block align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? cardId : undefined}
        onClick={() => setOpen((v) => (coarse ? !v : true))}
        onMouseEnter={() => !coarse && setOpen(true)}
        onMouseLeave={() => !coarse && setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => !coarse && setOpen(false)}
        className="cite-mark ring-star-green/60 mx-0.5 inline-flex min-h-[20px] items-center gap-0.5 rounded-full bg-space-800 px-1.5 align-middle text-[11px] text-star-green ring-1 transition-colors duration-star ease-star hover:text-hi"
      >
        <Star
          size={10}
          className="cite-star"
          style={{ filter: 'drop-shadow(0 0 4px var(--star-green))' }}
          aria-hidden
        />
        <span className="data-mono">{citation.seq}</span>
      </button>

      {open && (
        <span id={cardId} className="absolute bottom-full left-0 z-20 mb-1 block">
          <SourceCard citation={citation} />
        </span>
      )}
    </span>
  );
}
