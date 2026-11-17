import Link from 'next/link';
import { BarChart3, BellRing, ClipboardList, PawPrint, Zap, type LucideIcon } from 'lucide-react';
import { Panel } from './Panel';
import { CatSilhouette } from '../decor';

/**
 * 快速操作 + 底部标语卡（设计稿右栏上下两块）。
 *
 * 四个入口都指向真实存在的**管理端**页面：设计稿上的「发布预警」「数据导出」在本项目里
 * 没有对应动作（预警由规则引擎自动生成，导出还没做），放上去点了没反应比不做更糟。
 * 原来第二格是「动物登记 → /scan」，会把管理员甩出管理端到客户端建档；
 * 2026-10-27 起改指管理端的申请审核页 —— 管理员该做的是给同学的申请下结论。
 */
const ACTIONS: Array<{ href: string; label: string; Icon: LucideIcon; color: string }> = [
  { href: '/admin/alerts', label: '处置预警', Icon: BellRing, color: 'var(--star-red)' },
  { href: '/admin/animals?review=1', label: '申请审核', Icon: PawPrint, color: 'var(--accent-400)' },
  { href: '/admin/records', label: '记录管理', Icon: ClipboardList, color: 'var(--star-green)' },
  { href: '/admin/stats', label: '数据统计', Icon: BarChart3, color: 'var(--violet-400)' },
];

export function QuickActions() {
  return (
    <Panel title="快速操作" Icon={Zap} bodyClassName="px-3 pb-3">
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map(({ href, label, Icon, color }) => (
          <Link
            key={href}
            href={href}
            className="group flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-btn bg-space-900/60 px-2 py-3 text-center ring-1 ring-space-700/70 transition-colors duration-star ease-star hover:ring-accent-400"
          >
            <span
              className="grid h-8 w-8 place-items-center rounded-btn transition-transform duration-star ease-star group-hover:scale-[1.06]"
              style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}
              aria-hidden
            >
              <Icon size={16} style={{ color }} />
            </span>
            <span className="text-[11px] text-lo transition-colors duration-star ease-star group-hover:text-hi">
              {label}
            </span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

/** 右栏底部的标语卡：纯装饰，但给了首页一个不指向任何按钮的落点，视觉上收住整列 */
export function MottoCard() {
  return (
    <div
      className="relative overflow-hidden rounded-card p-4 ring-1 ring-space-700/60"
      style={{
        backgroundImage:
          'linear-gradient(140deg, color-mix(in srgb, var(--accent-600) 30%, var(--space-900)) 0%, color-mix(in srgb, var(--space-900) 92%, transparent) 70%)',
      }}
    >
      <div className="starfield pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="relative">
        <p className="text-[13px] leading-relaxed text-hi">
          用科技守护生命
          <br />
          让校园更温暖
        </p>
        <CatSilhouette className="mt-3 h-10 w-16 text-accent-300 opacity-60" />
      </div>
    </div>
  );
}
