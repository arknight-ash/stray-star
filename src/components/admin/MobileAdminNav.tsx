'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADMIN_NAV, isNavActive } from './nav';

/**
 * 移动端导航条（<1024px）。
 *
 * 用横向滚动条而不是汉堡菜单：管理端只有 6 个入口，抽屉要点两下才能到页面；
 * 横滑一下就能看到全部，也不会遮住正在看的数据。
 */
export function MobileAdminNav() {
  const pathname = usePathname() ?? '/admin';

  return (
    <nav
      aria-label="管理端导航"
      className="sticky top-14 z-20 shrink-0 border-b border-space-700/60 bg-space-900/90 backdrop-blur lg:hidden"
    >
      <div className="ss-scroll-x flex gap-1 overflow-x-auto px-2 py-2">
        {ADMIN_NAV.map(({ href, label, Icon }) => {
          const active = isNavActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={[
                'flex min-h-[52px] min-w-[78px] flex-col items-center justify-center gap-1 whitespace-nowrap rounded-btn px-2.5 text-[11px] transition-colors duration-star ease-star',
                active ? 'text-hi' : 'text-lo',
              ].join(' ')}
              style={
                active
                  ? { backgroundColor: 'color-mix(in srgb, var(--accent-600) 42%, var(--space-900))' }
                  : undefined
              }
            >
              <Icon
                size={17}
                aria-hidden
                style={active ? { color: 'var(--accent-300)' } : undefined}
              />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
