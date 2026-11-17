import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/admin/guard';
import { loadAlertsPage } from '@/lib/admin/alerts';
import { AlertBoard } from '@/components/admin/AlertBoard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '预警处置台 · 管理端',
  robots: { index: false, follow: false },
};

/**
 * 预警待办台（阶段 7，2026-10-27 并入新外壳）。
 *
 * 门禁在 `requireAdmin()` 里做，且放在查库之前：未登录时不查一行数据，
 * 客户端组件也就拿不到它无权看的内容。外壳（侧栏/顶栏）由 (panel)/layout 提供，
 * 所以这一页不再自带页头与"去登录"提示块。
 */
export default async function AdminAlertsPage() {
  requireAdmin();
  const board = await loadAlertsPage();
  return <AlertBoard board={board} />;
}
