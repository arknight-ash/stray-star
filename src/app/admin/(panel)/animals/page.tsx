import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/admin/guard';
import { loadAnimalsPage, loadAnimalApplications } from '@/lib/admin/views';
import { AnimalsManager } from '@/components/admin/AnimalsManager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '动物管理 · 管理端',
  robots: { index: false, follow: false },
};

/**
 * 动物管理（2026-10-27 按设计稿二轮改版）。
 * 网格卡片 + 右侧档案面板的交互都在客户端组件里，这里只管门禁与取数。
 *
 * 待审核申请与档案一次取全：管理员点「审核新增申请」是同页切视图，
 * 不再往返数据库，也不再跳去客户端建档。
 */
export default async function AdminAnimalsPage({
  searchParams,
}: {
  searchParams?: { review?: string };
}) {
  requireAdmin();
  const [animals, applications] = await Promise.all([
    loadAnimalsPage(),
    loadAnimalApplications(),
  ]);
  return (
    <AnimalsManager
      animals={animals}
      applications={applications}
      initialMode={searchParams?.review === '1' ? 'review' : 'list'}
    />
  );
}
