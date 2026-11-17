import { SiteHeader } from '@/components/shell/SiteHeader';
import { SideNav } from '@/components/shell/SideNav';
import { BottomTabBar } from '@/components/shell/BottomTabBar';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      {/* 桌面端左侧竖排导航（对齐 2026-10-26 设计稿），内容区整体让出侧栏宽度 */}
      <SideNav />
      <div className="flex min-h-dvh flex-col lg:pl-56">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <BottomTabBar />
      </div>
    </div>
  );
}
