'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Camera, BookMarked, Map, PenLine, MessagesSquare, Orbit } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 移动端底部导航（2026-10-27 加入星枢AI）。
 *
 * 星枢AI 用「抬起的渐变圆」呈现：底栏其余五格是线图标，它是一颗实心球 ——
 * 不靠颜色深浅区分，靠形状区分，在小屏上一眼就能找到。
 * 图鉴/拍摄 等仍是原样的线图标，避免整条栏都在发光反而没有重点。
 */
type MobileTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
  emphasis?: boolean;
};

const MOBILE_TABS: MobileTab[] = [
  { href: '/scan', label: '拍摄', Icon: Camera },
  { href: '/animals', label: '图鉴', Icon: BookMarked },
  { href: '/agent', label: '星枢AI', Icon: Orbit, emphasis: true },
  { href: '/', label: '星图', Icon: Map },
  { href: '/report', label: '记录', Icon: PenLine },
  // 问答页是 /chat（它是对话不是搜索）；问答此前一直是死链 /ask，阶段 6 改到 /chat。
  { href: '/chat', label: '问答', Icon: MessagesSquare },
];

/** 「星图」页签指向 / ，不能用 startsWith 否则永远高亮 */
function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** 移动端底部导航；桌面端导航在左侧 SideNav（2026-10-26 改版后） */
export function BottomTabBar({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 z-30 border-t border-space-700/70 bg-space-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden',
        className,
      )}
      aria-label="主导航"
    >
      <ul className="mx-auto flex max-w-5xl">
        {MOBILE_TABS.map(({ href, label, Icon, emphasis }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] transition-colors duration-star ease-star',
                  active || emphasis ? 'text-accent-300' : 'text-lo',
                )}
                aria-current={active ? 'page' : undefined}
              >
                {emphasis ? (
                  <span
                    className={cn(
                      '-mt-3 grid h-10 w-10 place-items-center rounded-full shadow-glow ring-1',
                      active ? 'ring-accent-300/80' : 'ring-accent-400/40',
                    )}
                    style={{ backgroundImage: 'var(--grad-cta)' }}
                    aria-hidden
                  >
                    <Icon size={19} strokeWidth={1.75} className="text-hi" />
                  </span>
                ) : (
                  <Icon size={20} strokeWidth={1.75} aria-hidden />
                )}
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
