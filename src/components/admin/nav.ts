import {
  BarChart3,
  BellRing,
  ClipboardList,
  LayoutDashboard,
  PawPrint,
  Settings,
  type LucideIcon,
} from 'lucide-react';

/**
 * 管理端导航的唯一事实源：侧栏、移动端导航条、顶栏面包屑都从这里取。
 * 新增页面只改这一处，三处入口同时生效（少改一处就会出现"侧栏有、手机上没"）。
 */
export interface AdminNavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { href: '/admin', label: '首页', Icon: LayoutDashboard },
  { href: '/admin/alerts', label: '预警处置台', Icon: BellRing },
  { href: '/admin/animals', label: '动物管理', Icon: PawPrint },
  { href: '/admin/records', label: '记录管理', Icon: ClipboardList },
  { href: '/admin/stats', label: '数据统计', Icon: BarChart3 },
  { href: '/admin/settings', label: '系统设置', Icon: Settings },
];

/**
 * 当前路径是否命中某个导航项。
 * `/admin` 必须精确匹配 —— 否则它会把自己下面所有子页都点亮。
 */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 当前路径对应的页面名（顶栏标题用）；未命中返回 null，由调用方兜底 */
export function navLabelFor(pathname: string): string | null {
  return ADMIN_NAV.find((item) => isNavActive(pathname, item.href))?.label ?? null;
}
