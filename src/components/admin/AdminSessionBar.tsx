'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * 退出登录。只在登录态下渲染（由服务端判断），
 * 退出后整页 refresh —— 服务端会重新走门禁，把未登录的界面换上来。
 */
export function AdminSessionBar() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/admin/session', { method: 'DELETE' });
      router.refresh();
      router.push('/admin/login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void logout()}
      disabled={busy}
      aria-busy={busy}
      className="min-h-[32px] rounded-sticker border border-space-700 px-2 text-xs text-lo transition-colors duration-star ease-star hover:text-hi disabled:opacity-50"
    >
      退出
    </button>
  );
}
