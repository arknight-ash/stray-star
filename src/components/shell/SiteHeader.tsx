import { cookies } from 'next/headers';
import Link from 'next/link';
import { Search, UserRound } from 'lucide-react';
import { SITE } from '@/lib/constants';
import { STUDENT_COOKIE, studentFromCookieValue } from '@/lib/auth/student';
import { Avatar } from './Avatar';
import { LogoutButton } from './LogoutButton';

/**
 * 学生端顶栏（2026-10-26 改版，对齐新设计稿）：
 * 全局搜索框（→ /animals?q=）+ 头像。品牌与页签移到左侧 SideNav（桌面端），
 * 移动端左上角保留品牌名（无侧栏）。天气挂件无数据支撑，不做（拍板记录见 PAGE-BLUEPRINT）。
 * 登录后（ss_student cookie 有效）头像位展示昵称 + 退出入口。
 */
export async function SiteHeader() {
  const student = await studentFromCookieValue(cookies().get(STUDENT_COOKIE)?.value);

  return (
    <header className="sticky top-0 z-30 border-b border-space-700/60 bg-space-900/85 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-3 px-4 lg:px-6">
        <Link
          href="/"
          className="shrink-0 font-display text-base text-hi lg:hidden"
          aria-label={`${SITE.name} 首页`}
        >
          {SITE.name}
        </Link>

        <form action="/animals" method="get" className="w-full max-w-md" role="search">
          <label className="relative block">
            <span className="sr-only">搜索动物或关键词</span>
            <Search
              size={15}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lo"
            />
            <input
              name="q"
              placeholder="搜索动物 / 关键词 / 位置"
              className="min-h-[38px] w-full rounded-full bg-space-800/80 pl-9 pr-3 text-sm text-hi ring-1 ring-space-700 outline-none transition-colors duration-star ease-star placeholder:text-lo focus-visible:ring-accent-400"
            />
          </label>
        </form>

        <div className="flex shrink-0 items-center gap-2">
          {student ? (
            <>
              <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full bg-space-800/80 px-3 text-xs text-hi ring-1 ring-space-700">
                <UserRound size={13} className="text-accent-300" aria-hidden />
                {student.name}
              </span>
              <LogoutButton />
            </>
          ) : (
            <Link href="/login" aria-label="登录" title="登录">
              <Avatar />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
