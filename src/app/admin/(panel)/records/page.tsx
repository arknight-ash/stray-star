import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/admin/guard';
import { loadRecordRows } from '@/lib/admin/views';
import { RecordsManager } from '@/components/admin/RecordsManager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '记录管理 · 管理端',
  robots: { index: false, follow: false },
};

/** 记录管理（2026-10-27 按设计稿二轮改版）：类型 chips + 表格 + 分页，交互在客户端。 */
export default async function AdminRecordsPage() {
  requireAdmin();
  const records = await loadRecordRows();
  return <RecordsManager records={records} />;
}
