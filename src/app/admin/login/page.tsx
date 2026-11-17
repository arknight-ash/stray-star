'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';

/**
 * 管理端登录（2026-10-27：口令 → 账号 + 密码）。
 *
 * 初始账号 `admin`，密码与原来的管理口令一致，所以老用户不需要记新密码。
 * 账号框默认预填 admin —— 单管理员场景下这能省掉一次输入，也顺手告诉人"账号就是它"。
 *
 * 失败时把服务端的话原样显示：服务端刻意不区分"账号错 / 密码错 / 没配置"，
 * 前端也不猜，避免把配置情况泄露给探测者。
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [account, setAccount] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 已经登录了就别让人再输一次
  useEffect(() => {
    void fetch('/api/admin/session')
      .then((r) => r.json())
      .then((b) => {
        if (b?.data?.signedIn) router.replace('/admin');
      })
      .catch(() => undefined);
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !account.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account: account.trim(), password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message ?? '登录失败，请重试');
        return;
      }
      router.replace('/admin');
      router.refresh();
    } catch {
      setError('网络似乎不太稳定，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-space-900">
      {/* 夜景底图 + 压暗：保证卡面文字对比度 */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/images/login-bg.jpg)' }}
        aria-hidden
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(160deg, color-mix(in srgb, var(--space-900) 72%, transparent) 0%, color-mix(in srgb, var(--space-900) 92%, transparent) 100%)',
        }}
        aria-hidden
      />
      <div className="starfield absolute inset-0 opacity-40" aria-hidden />

      <header className="relative z-10 flex items-center gap-3 px-6 py-6 md:px-10">
        <span
          className="grid h-10 w-10 place-items-center rounded-xl text-space-900 shadow-glow"
          style={{ backgroundColor: 'var(--accent-400)' }}
          aria-hidden
        >
          <ShieldCheck size={20} />
        </span>
        <div>
          <p className="font-display text-base leading-tight text-hi">智护流浪星 · 管理端</p>
          <p className="mt-0.5 text-[11px] tracking-wide text-lo">校园流浪动物智能管理平台</p>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 pb-16">
        <section
          aria-label="管理员登录"
          className="w-full max-w-[420px] rounded-card bg-space-800/80 p-6 ring-1 ring-space-700 backdrop-blur-xl md:p-8"
          style={{ boxShadow: 'var(--shadow-glow-strong)' }}
        >
          <h1 className="font-display text-2xl leading-tight text-hi">管理员登录</h1>
          <p className="mt-1.5 text-sm text-lo">处置预警、复核报告与数据导出需要管理员身份。</p>

          <form onSubmit={submit} className="mt-6 space-y-3" aria-busy={busy}>
            <label className="relative block">
              <span className="mb-1.5 block text-xs text-lo">管理员账号</span>
              <User
                size={15}
                aria-hidden
                className="pointer-events-none absolute bottom-3.5 left-3.5 text-lo"
              />
              <input
                type="text"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                autoComplete="username"
                spellCheck={false}
                placeholder="请输入管理员账号"
                className="min-h-[46px] w-full rounded-btn bg-space-900/80 pl-10 pr-3 text-sm text-hi ring-1 ring-space-700 outline-none transition-colors duration-star ease-star placeholder:text-lo focus-visible:ring-2 focus-visible:ring-accent-400"
              />
            </label>

            <label className="relative block">
              <span className="mb-1.5 block text-xs text-lo">密码</span>
              <Lock
                size={15}
                aria-hidden
                className="pointer-events-none absolute bottom-3.5 left-3.5 text-lo"
              />
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="请输入密码"
                autoFocus
                className="min-h-[46px] w-full rounded-btn bg-space-900/80 pl-10 pr-11 text-sm text-hi ring-1 ring-space-700 outline-none transition-colors duration-star ease-star placeholder:text-lo focus-visible:ring-2 focus-visible:ring-accent-400"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                aria-label={showPwd ? '隐藏密码' : '显示密码'}
                className="absolute bottom-3 right-3 grid h-7 w-7 place-items-center rounded text-lo transition-colors duration-star ease-star hover:text-hi"
              >
                {showPwd ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
              </button>
            </label>

            {error && (
              <p role="alert" className="text-xs" style={{ color: 'var(--star-red)' }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !account.trim() || !password}
              className="mt-1 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-btn text-sm font-medium text-space-900 transition-opacity duration-star ease-star hover:opacity-90 disabled:opacity-45"
              style={{ backgroundColor: 'var(--accent-400)' }}
            >
              {busy ? '正在验证…' : '登录'}
              {!busy && <ArrowRight size={16} aria-hidden />}
            </button>
          </form>

          <p className="mt-5 rounded-btn border border-space-700/70 px-3 py-2.5 text-[11px] leading-relaxed text-lo">
            初次使用：账号 <span className="data-mono text-hi">admin</span>，密码为部署时配置的管理口令。
          </p>
        </section>
      </main>
    </div>
  );
}
