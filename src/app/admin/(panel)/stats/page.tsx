import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/admin/guard';
import { loadStatsPage } from '@/lib/admin/views';
import { StatsView } from '@/components/admin/StatsView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '数据统计 · 管理端',
  robots: { index: false, follow: false },
};

/** 数据统计（2026-10-27 按设计稿二轮改版）：KPI + 四块图表，范围切换在客户端。 */
export default async function AdminStatsPage() {
  requireAdmin();
  const stats = await loadStatsPage();
  return <StatsView stats={stats} />;
}
