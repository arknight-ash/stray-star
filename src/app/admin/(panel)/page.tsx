import type { Metadata } from 'next';
import { adminAccount } from '@/lib/auth/actor';
import { requireAdmin } from '@/lib/admin/guard';
import { loadOverview } from '@/lib/admin/overview';
import { GreetingBanner } from '@/components/admin/dashboard/GreetingBanner';
import { KpiCards } from '@/components/admin/dashboard/KpiCards';
import { CampusMapPanel } from '@/components/admin/dashboard/CampusMapPanel';
import { AlertFeed } from '@/components/admin/dashboard/AlertFeed';
import { TrendPanel } from '@/components/admin/dashboard/TrendPanel';
import { LevelDonut } from '@/components/admin/dashboard/LevelDonut';
import { QuickActions, MottoCard } from '@/components/admin/dashboard/QuickActions';
import { RecentRecords } from '@/components/admin/dashboard/RecentRecords';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '系统总览 · 管理端',
  robots: { index: false, follow: false },
};

/**
 * 管理端总览（2026-10-27 按设计稿新增，替代原来 /admin → /admin/alerts 的跳转）。
 *
 * 结构对齐设计稿二轮：主列（问候 → KPI → 地图+预警动态 → 趋势+等级分布）+
 * 右栏 300px（快速操作 → 最新记录 → 守护卡）。右栏顶与问候横幅齐平，
 * 所以问候/KPI 不再通栏 —— 它们只占主列宽度。
 * 手机上退化成单列，顺序仍是"先看异常，再看明细"。
 */
export default async function AdminOverviewPage() {
  requireAdmin();
  const data = await loadOverview();

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <GreetingBanner account={adminAccount()} />
        <KpiCards kpi={data.kpi} />

        <div className="grid gap-3 xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
          <CampusMapPanel map={data.map} />
          <AlertFeed alerts={data.alerts} />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
          <TrendPanel trends={data.trends} />
          <LevelDonut levels={data.levels} />
        </div>
      </div>

      <aside
        aria-label="快捷操作与最新记录"
        className="flex w-full min-w-0 flex-col gap-3 xl:w-[300px] xl:shrink-0"
      >
        <QuickActions />
        <RecentRecords records={data.records} />
        <MottoCard />
      </aside>
    </div>
  );
}
