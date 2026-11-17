'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';

/**
 * 顶栏退出登录：清掉学生 cookie 后跳回 /login。
 * replace 之后必须再 refresh —— 否则客户端路由缓存里还留着带身份的服务端渲染结果，
 * 下次点回首页会看到"还是登录着"的旧页面。
 */
export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void fetch('/api/auth/session', { method: 'DELETE' })
          .catch(() => undefined)
          .finally(() => {
            router.replace('/login');
            router.refresh();
          });
      }}
      className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-space-800/80 px-2.5 text-xs text-lo ring-1 ring-space-700 transition-colors duration-star ease-star hover:text-hi disabled:opacity-50"
      title="退出登录"
    >
      <LogOut size={13} aria-hidden />
      退出
    </button>
  );
}
