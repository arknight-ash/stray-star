import type { LucideIcon } from 'lucide-react';

export interface StatItem {
  label: string;
  value: string | number;
  /** 右下角补充（如「今日 +2」「危急 1」）；不给就不渲染 */
  hint?: string;
  Icon: LucideIcon;
  /** 语义色，只能是 tokens 里的 CSS 变量 */
  color: string;
}

/**
 * 统计卡行（设计稿：预警处置台三张 / 数据统计四张共用这一版式）。
 *
 * 与总览页 KpiCards 的区别：这里的数字来自「当前页的筛选结果」，
 * 所以卡片数量可变（3 或 4），做成传入 list 而不是写死四张。
 */
export function StatCards({ items }: { items: StatItem[] }) {
  const cols =
    items.length >= 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3';

  return (
    <section
      aria-label="状态统计"
      className={`grid gap-3 ${cols}`}
    >
      {items.map(({ label, value, hint, Icon, color }) => (
        <div
          key={label}
          className="flex items-center gap-3 rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70 transition-colors duration-star ease-star hover:ring-space-700"
        >
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-btn"
            style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}
            aria-hidden
          >
            <Icon size={19} style={{ color }} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11px] text-lo">{label}</p>
            <p className="data-mono text-[26px] font-medium leading-tight text-hi">{value}</p>
          </div>
          {hint && (
            <span className="ml-auto shrink-0 self-end pb-1 text-[11px] text-lo">{hint}</span>
          )}
        </div>
      ))}
    </section>
  );
}
