import { ArrowUpRight, BellRing, ClipboardList, PawPrint, Star, type LucideIcon } from 'lucide-react';
import type { OverviewKpi } from '@/lib/admin/overview';

/**
 * 四张 KPI 卡（对齐设计稿第一行）。
 *
 * 第四张刻意叫「累计观察」而不是设计稿的「已点亮星星」：
 * 本项目里「已点亮 N 颗星」= 动物数（首页徽章、星图都是这个口径），
 * 和第二张「已登记动物」是同一个数字，并排放两遍只会让人以为有一个是错的。
 */
export function KpiCards({ kpi }: { kpi: OverviewKpi }) {
  const delta = kpi.todayObservations - kpi.yesterdayObservations;

  const cards: Array<{
    label: string;
    value: number;
    hint: string;
    Icon: LucideIcon;
    color: string;
  }> = [
    {
      label: '待处置预警',
      value: kpi.openAlerts,
      hint: kpi.criticalAlerts > 0 ? `危急 ${kpi.criticalAlerts}` : '暂无危急',
      Icon: BellRing,
      color: 'var(--star-red)',
    },
    {
      label: '已登记动物',
      value: kpi.animals,
      hint: kpi.pendingAnimals > 0 ? `待核实 ${kpi.pendingAnimals}` : '近 7 天 ' + kpi.animalsNew7d,
      Icon: PawPrint,
      color: 'var(--accent-400)',
    },
    {
      label: '今日新增记录',
      value: kpi.todayObservations,
      hint: delta === 0 ? '与昨日持平' : `较昨日 ${delta > 0 ? '+' : ''}${delta}`,
      Icon: ClipboardList,
      color: 'var(--star-green)',
    },
    {
      label: '累计观察',
      value: kpi.totalObservations,
      hint: `照片 ${kpi.photos} 张`,
      Icon: Star,
      color: 'var(--violet-400)',
    },
  ];

  return (
    <section aria-label="关键指标" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ label, value, hint, Icon, color }) => (
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
          <span className="ml-auto flex shrink-0 items-center gap-0.5 self-end pb-1 text-[11px] text-lo">
            <ArrowUpRight size={11} aria-hidden style={{ color }} />
            {hint}
          </span>
        </div>
      ))}
    </section>
  );
}
