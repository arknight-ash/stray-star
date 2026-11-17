import type { Metadata } from 'next';
import { PageShell } from '@/components/shell/PageShell';
import { readCampusCenter } from '@/lib/geo';
import { CaptureClient } from './CaptureClient';

export const metadata: Metadata = {
  title: '星卡捕获',
  description: '拍下校园里的小家伙，比对星图找到它的档案，或为它点亮一颗新星。',
};

/**
 * Server 组件只做一件事：读出校园中心交给建档表单当默认落点。
 * 地图/取景/状态机全在客户端子树里。
 */
export default function ScanPage() {
  const center = readCampusCenter();

  return (
    <PageShell
      title="星卡捕获"
      subtitle="拍一张照片，看看它是不是星图里那颗星"
    >
      <CaptureClient />
      <p className="sr-only">
        默认位置：校园中心 {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
      </p>
    </PageShell>
  );
}
