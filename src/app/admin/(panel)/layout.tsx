import Link from 'next/link';
import { prisma } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { adminAccount } from '@/lib/auth/actor';
import { adminConfigured, requireAdmin } from '@/lib/admin/guard';
import { MANUAL_SEVERE_DEDUPE_PREFIX } from '@/lib/alerts/rules';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AdminTopBar } from '@/components/admin/AdminTopBar';
import { MobileAdminNav } from '@/components/admin/MobileAdminNav';
import { AdminMark } from '@/components/admin/decor';

export const dynamic = 'force-dynamic';

/**
 * 管理端外壳（2026-10-27 按设计稿重做）。
 *
 * 放在 `(panel)` 路由组里，而不是 `admin/layout.tsx`：登录页要全屏独立，
 * 不能被侧栏 + 顶栏包住。路由组不进 URL，所以 /admin、/admin/alerts 地址不变。
 *
 * 刻意不放进 `(site)` 分组：学生端的底部 tab 与叙事头不该出现在管理端里，
 * 而管理端也不需要"拍摄/图鉴/问答"这些入口 —— 两套界面各自完整，互不借用。
 */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  if (!adminConfigured()) return <NotConfigured />;

  // 未登录直接跳登录页（页面自己也会再判一次，见 lib/admin/guard.ts 的注释）
  requireAdmin();

  const [openAlerts, urgentAlerts, logins] = await Promise.all([
    prisma.alert.count({ where: { status: 'OPEN' } }).catch(() => 0),
    // 「同学标记情况紧急」且未处置的条数：顶栏铃铛据此变红，管理员一眼知道有人喊了。
    prisma.alert
      .count({ where: { status: 'OPEN', dedupeKey: { startsWith: MANUAL_SEVERE_DEDUPE_PREFIX } } })
      .catch(() => 0),
    prisma.auditLog
      .findMany({
        where: { action: 'ADMIN_LOGIN' },
        orderBy: { createdAt: 'desc' },
        take: 2,
        select: { createdAt: true },
      })
      .catch(() => []),
  ]);

  // 最近一条是本次登录，所以"上次登录"取第二条；只有一次登录时说"本次为首个会话"
  const lastLoginAt = logins.length > 1 ? formatDate(logins[1]!.createdAt) : null;

  return (
    // 结构对齐设计稿（2026-10-27 二轮）：顶栏通栏压在最上面（含夜景天际线底图），
    // 侧栏从顶栏**下方**开始 —— 不是侧栏自带 logo 头的两栏结构。
    <div className="flex min-h-dvh flex-col bg-space-900">
      <AdminTopBar
        openAlerts={openAlerts}
        urgentAlerts={urgentAlerts}
        account={adminAccount()}
        lastLoginAt={lastLoginAt}
      />
      <div className="flex min-h-0 flex-1">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileAdminNav />
          <main className="mx-auto w-full max-w-[1480px] flex-1 px-3 pb-16 pt-3 lg:px-5 lg:pt-4">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

/** 没配密码时的说明页：门禁关闭，但也要说清楚"怎么开"，而不是给一张白页 */
function NotConfigured() {
  return (
    <div className="grid min-h-dvh place-items-center bg-space-900 px-5">
      <div className="w-full max-w-md rounded-card bg-space-800/70 p-6 ring-1 ring-space-700">
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-9 w-9 place-items-center rounded-lg text-space-900"
            style={{ backgroundColor: 'var(--accent-400)' }}
            aria-hidden
          >
            <AdminMark size={18} />
          </span>
          <h1 className="font-display text-lg text-hi">管理端未启用</h1>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-lo">
          服务端没有配置管理员密码（<span className="data-mono text-hi">ADMIN_PASSWORD</span> 或
          <span className="data-mono text-hi"> ADMIN_TOKEN</span>），管理端保持关闭。
          在 <span className="data-mono text-hi">.env</span> 里补上后重启服务即可启用。
        </p>
        <p className="mt-2 text-xs leading-relaxed text-lo">
          账号默认是 <span className="data-mono text-hi">admin</span>，可用
          <span className="data-mono text-hi"> ADMIN_ACCOUNT</span> 覆盖。
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/"
            className="inline-flex min-h-[40px] items-center rounded-btn px-4 text-sm text-hi ring-1 ring-space-700 transition-colors duration-star ease-star hover:ring-accent-400"
          >
            返回星图
          </Link>
          <Link
            href="/admin/login"
            className="inline-flex min-h-[40px] items-center rounded-btn px-4 text-sm text-space-900 transition-opacity duration-star ease-star hover:opacity-90"
            style={{ backgroundColor: 'var(--accent-400)' }}
          >
            去登录
          </Link>
        </div>
      </div>
    </div>
  );
}
