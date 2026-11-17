'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  BookMarked,
  Map,
  PenLine,
  MessagesSquare,
  Camera,
  Sparkles,
  Orbit,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SITE } from '@/lib/constants';
import { StarCount } from './StarCount';

/**
 * 桌面端左侧竖排导航（2026-10-26 改版，对齐新设计稿 / 2026-10-27 加星枢AI）：
 * logo + 竖排页签（当前项蓝紫高亮胶囊）+ 底部「已点亮」统计。
 * 页签：首页 / 星枢AI / 拍摄 / 图鉴 / 星图 / 记录 / 问答。
 *
 * 星枢AI（/agent）此前只作为首页功能卡出现，侧栏根本点不到 —— 2026-10-27 起
 * 它拿到一个常驻页签，并且**未选中时也是蓝紫底**：它是「会干活的助手」，
 * 不是普通的一个栏目，视觉上要和 拍摄/图鉴 这些分得开。
 */
type SideTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
  emphasis?: boolean;
};

const SIDE_TABS: SideTab[] = [
  { href: '/', label: '首页', Icon: Home },
  { href: '/agent', label: '星枢AI', Icon: Orbit, emphasis: true },
  { href: '/scan', label: '拍摄', Icon: Camera },
  { href: '/animals', label: '图鉴', Icon: BookMarked },
  { href: '/map', label: '星图', Icon: Map },
  { href: '/report', label: '记录', Icon: PenLine },
  { href: '/chat', label: '问答', Icon: MessagesSquare },
];

/** 「首页」页签指向 / ，不能用 startsWith 否则永远高亮 */
function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function SideNav() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-space-700/60 bg-space-900/80 backdrop-blur lg:flex"
      aria-label="侧边导航"
    >
      <Link
        href="/"
        className="flex items-center gap-2 px-5 pb-4 pt-5"
        aria-label={`${SITE.name} 首页`}
      >
        <Sparkles size={20} className="text-accent-400" aria-hidden />
        <span className="font-display text-lg text-hi">{SITE.name}</span>
      </Link>

      <nav className="flex-1 px-3">
        <ul className="space-y-1">
          {SIDE_TABS.map(({ href, label, Icon, emphasis }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    'flex min-h-[44px] items-center gap-3 rounded-btn px-3 text-sm transition-colors duration-star ease-star',
                    active ? 'text-hi ring-1 ring-accent-500/60' : 'text-lo hover:text-hi',
                    !active && emphasis && 'text-accent-300',
                  )}
                  style={
                    active
                      ? { backgroundColor: 'color-mix(in srgb, var(--accent-500) 22%, transparent)' }
                      : emphasis
                        ? { backgroundColor: 'color-mix(in srgb, var(--accent-500) 12%, transparent)' }
                        : undefined
                  }
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon
                    size={17}
                    strokeWidth={1.75}
                    aria-hidden
                    className={active || emphasis ? 'text-accent-400' : undefined}
                  />
                  <span>{label}</span>
                  {emphasis && (
                    <span
                      className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: 'var(--accent-400)' }}
                      aria-hidden
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-5 pb-5">
        <p className="text-xs text-lo">已点亮</p>
        <p className="data-mono text-lg text-accent-300">
          <StarCount />
        </p>
      </div>
    </aside>
  );
}
