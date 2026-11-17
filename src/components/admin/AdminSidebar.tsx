'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADMIN_NAV, isNavActive } from './nav';
import { CatSilhouette } from './decor';

/**
 * 管理端左侧导航（桌面 ≥1024px；更窄的屏幕走 MobileAdminNav）。
 *
 * logo 头已上移到通栏顶栏（2026-10-27 二轮，对齐设计稿），
 * 这里 sticky 在顶栏下方 —— 顶栏 56px，所以高度要减掉这一段。
 *
 * 选中态刻意做成「深靛蓝实底 + 左缘强调条」而不是直接用主色渐变：
 * 渐变底上的 13px 亮字只有 3.6:1，不满足正文 AA；深底能到 8:1 以上，
 * 而"选中"这件事靠形状（左条 + 实底 + 亮色图标）已经足够清楚。
 */
export function AdminSidebar() {
  const pathname = usePathname() ?? '/admin';

  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-56px)] w-[216px] shrink-0 flex-col border-r border-space-700/60 bg-space-900 lg:flex">
      <div className="starfield pointer-events-none absolute inset-0 opacity-30" aria-hidden />

      <nav aria-label="管理端导航" className="relative mt-3 flex flex-1 flex-col gap-1 px-3">
        {ADMIN_NAV.map(({ href, label, Icon }) => {
          const active = isNavActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={[
                'group relative flex min-h-[42px] items-center gap-2.5 rounded-btn px-3 text-[13px] transition-colors duration-star ease-star',
                active ? 'text-hi' : 'text-lo hover:text-hi',
              ].join(' ')}
              style={
                active
                  ? {
                      backgroundColor: 'color-mix(in srgb, var(--accent-600) 42%, var(--space-900))',
                      boxShadow: 'var(--shadow-glow)',
                    }
                  : undefined
              }
            >
              {active && (
                <span
                  className="absolute inset-y-2 left-0 w-[3px] rounded-full"
                  style={{ backgroundColor: 'var(--accent-300)' }}
                  aria-hidden
                />
              )}
              <Icon
                size={16}
                aria-hidden
                style={active ? { color: 'var(--accent-300)' } : undefined}
                className={active ? '' : 'transition-colors group-hover:text-accent-300'}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="relative mt-4 px-5 pb-5">
        <CatSilhouette className="mb-2 h-9 w-14 text-space-700" />
        <p className="text-[10px] leading-relaxed text-lo">
          守护每一颗
          <br />
          需要被看见的星
        </p>
      </div>
    </aside>
  );
}
