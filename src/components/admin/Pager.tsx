'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * 分页条（设计稿表格底部那一排 ‹ 1 2 3 ›）。
 *
 * 页码窗口最多 5 个：页数再多也只显示当前附近 5 个 + 首尾省略，
 * 一口气渲染 20 个页码会把表格底部撑成一条数字带。
 */
function pageWindow(page: number, total: number): Array<number | '…'> {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const start = Math.max(1, Math.min(page - 2, total - 4));
  const win = Array.from({ length: 5 }, (_, i) => start + i);
  const out: Array<number | '…'> = [];
  if (win[0]! > 1) out.push(1, '…');
  out.push(...win);
  if (win[4]! < total) out.push('…', total);
  return out;
}

export function Pager({
  page,
  totalPages,
  onChange,
  total,
  unit = '条',
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
  total: number;
  unit?: string;
}) {
  if (totalPages <= 1) {
    return (
      <p className="px-1 pt-2 text-[11px] text-lo">
        共 <span className="data-mono text-hi">{total}</span> {unit}
      </p>
    );
  }

  return (
    <nav
      aria-label="分页"
      className="flex flex-wrap items-center justify-between gap-2 px-1 pt-3"
    >
      <p className="text-[11px] text-lo">
        共 <span className="data-mono text-hi">{total}</span> {unit} · 第{' '}
        <span className="data-mono text-hi">{page}</span>/{totalPages} 页
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label="上一页"
          className="grid h-7 w-7 place-items-center rounded-btn border border-space-700 text-lo transition-colors duration-star ease-star hover:text-hi disabled:opacity-40"
        >
          <ChevronLeft size={13} aria-hidden />
        </button>
        {pageWindow(page, totalPages).map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="px-0.5 text-[11px] text-lo">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className={
                p === page
                  ? 'h-7 min-w-7 rounded-btn px-2 text-[11px] font-medium text-space-900'
                  : 'h-7 min-w-7 rounded-btn px-2 text-[11px] text-lo transition-colors duration-star ease-star hover:text-hi'
              }
              style={p === page ? { backgroundColor: 'var(--accent-400)' } : undefined}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="下一页"
          className="grid h-7 w-7 place-items-center rounded-btn border border-space-700 text-lo transition-colors duration-star ease-star hover:text-hi disabled:opacity-40"
        >
          <ChevronRight size={13} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
