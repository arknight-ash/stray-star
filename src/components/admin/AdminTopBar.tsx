'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, LayoutGrid, LogOut, Settings } from 'lucide-react';
import { navLabelFor } from './nav';
import { AdminMark } from './decor';

/**
 * 管理端通栏顶栏：左 = 站点 logo + 当前栏目，右 = 预警铃铛 + 管理员菜单。
 * 底图用站内那张夜景天际线（压暗到正文对比度达标），与总览页问候横幅同一张图。
 *
 * 退出登录走 `router.replace('/admin/login')`：只 refresh 不够，
 * 客户端路由缓存里还留着上一页的 RSC 结果，会出现"退出了但还能看到旧内容"。
 */
export function AdminTopBar({
  openAlerts,
  urgentAlerts = 0,
  account,
  lastLoginAt,
}: {
  openAlerts: number;
  /** 未处置的「同学标记情况紧急」条数。>0 时铃铛变红 —— 有人替动物喊了救命 */
  urgentAlerts?: number;
  account: string;
  lastLoginAt: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '/admin';
  const label = navLabelFor(pathname) ?? '管理端';

  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点外面 / 按 Esc 收起：下拉不收起的话，用户在手机上点第二下会先关菜单、白点一次
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/admin/session', { method: 'DELETE' });
      router.replace('/admin/login');
      router.refresh();
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  }

  return (
    // 通栏顶栏（设计稿 2026-10-27 二轮）：夜景天际线压暗做底，左 = 站点 logo（对齐侧栏宽度），
    // 中 = 当前栏目面包屑，右 = 预警铃铛 + 管理员菜单。sticky 只对内容区生效，
    // 侧栏在自己的列里另做 sticky。
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-space-700/60 px-4 lg:px-5">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/images/hero-city.jpg)' }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(180deg, color-mix(in srgb, var(--space-900) 86%, transparent) 0%, color-mix(in srgb, var(--space-900) 70%, transparent) 100%)',
          }}
        />
      </div>

      <div className="relative flex min-w-0 items-center gap-3">
        {/* logo 区与侧栏同宽对齐（216px - 侧栏内边距），窄屏收成只留图标 */}
        <Link
          href="/admin"
          aria-label="智护流浪星 管理端首页"
          className="flex w-[184px] shrink-0 items-center gap-2.5 lg:w-[184px]"
        >
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-space-900"
            style={{ backgroundColor: 'var(--accent-400)' }}
            aria-hidden
          >
            <AdminMark size={17} />
          </span>
          <span className="hidden min-w-0 md:block">
            <span className="block truncate font-display text-[13px] leading-tight text-hi">
              智护流浪星 · 管理端
            </span>
            <span className="mt-0.5 block truncate text-[10px] leading-tight text-lo">
              校园流浪动物智能管理平台
            </span>
          </span>
        </Link>

        <span className="hidden h-5 w-px bg-space-700 sm:block" aria-hidden />
        <p className="relative truncate text-sm font-medium text-hi">{label}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Link
          href="/admin/alerts"
          aria-label={
            openAlerts > 0
              ? `预警处置台，${openAlerts} 条待处置${urgentAlerts > 0 ? `，其中 ${urgentAlerts} 条同学标记紧急` : ''}`
              : '预警处置台'
          }
          className="relative grid h-9 w-9 place-items-center rounded-btn text-lo transition-colors duration-star ease-star hover:bg-space-800 hover:text-hi"
        >
          {/* 有同学标记紧急时铃铛变红：数字只说"有几条"，颜色说"其中有人喊救命" */}
          <Bell size={17} aria-hidden style={urgentAlerts > 0 ? { color: 'var(--star-red)' } : undefined} />
          {openAlerts > 0 && (
            <span
              className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-medium text-space-900"
              style={{ backgroundColor: 'var(--star-red)' }}
              aria-hidden
            >
              {openAlerts > 9 ? '9+' : openAlerts}
            </span>
          )}
        </Link>

        <span className="mx-1 h-5 w-px bg-space-700" aria-hidden />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex min-h-[36px] items-center gap-2 rounded-btn px-1.5 text-xs text-lo transition-colors duration-star ease-star hover:text-hi"
          >
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-medium text-space-900"
              style={{ backgroundColor: 'var(--accent-300)' }}
              aria-hidden
            >
              管
            </span>
            {/* 设计稿：昵称下再挂一行「上次登录 …」，让管理员一眼知道最近有没有别人登过 */}
            <span className="hidden leading-tight sm:block">
              <span className="block text-xs text-hi">管理员</span>
              <span className="block text-[10px] text-lo">
                {lastLoginAt ? `上次登录 ${lastLoginAt}` : '本次为首个会话'}
              </span>
            </span>
            <ChevronDown
              size={13}
              aria-hidden
              className={`transition-transform duration-star ease-star ${menuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {menuOpen && (
            <div
              role="menu"
              aria-label="管理员菜单"
              className="absolute right-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-card bg-space-800 p-1.5 ring-1 ring-space-700"
              style={{ boxShadow: 'var(--shadow-glow-strong)' }}
            >
              <div className="px-2.5 py-2">
                <p className="text-xs text-hi">管理员 · {account}</p>
                <p className="mt-1 text-[11px] text-lo">
                  {lastLoginAt ? `上次登录 ${lastLoginAt}` : '本次为首个会话'}
                </p>
              </div>
              <span className="my-1 block h-px bg-space-700" aria-hidden />
              <Link
                href="/admin/settings"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-[36px] items-center gap-2 rounded-btn px-2.5 text-xs text-lo transition-colors duration-star ease-star hover:bg-space-700 hover:text-hi"
              >
                <Settings size={14} aria-hidden />
                系统设置
              </Link>
              <Link
                href="/"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-[36px] items-center gap-2 rounded-btn px-2.5 text-xs text-lo transition-colors duration-star ease-star hover:bg-space-700 hover:text-hi"
              >
                <LayoutGrid size={14} aria-hidden />
                返回星图
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => void logout()}
                disabled={busy}
                className="flex min-h-[36px] w-full items-center gap-2 rounded-btn px-2.5 text-xs text-lo transition-colors duration-star ease-star hover:bg-space-700 hover:text-hi disabled:opacity-50"
              >
                <LogOut size={14} aria-hidden />
                {busy ? '正在退出…' : '退出登录'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
