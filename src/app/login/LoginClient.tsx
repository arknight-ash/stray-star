'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Eye,
  EyeOff,
  GraduationCap,
  Heart,
  Lock,
  ShieldCheck,
  User,
} from 'lucide-react';

/**
 * 登录页（对齐 2026-10-26 设计稿）：
 * 全屏星空夜景底图 + 左上品牌 + 左中手写体标语 + 右侧玻璃登录卡。
 * 卡内双页签：学生登录（学号/用户名 + 密码）、管理员登录（账号 + 密码，初始账号 admin）。
 * 设计稿中的「扫码登录」无后端支撑，按拍板不做；「忘记密码」点击给出提示语而非死链。
 */

const REMEMBER_KEY = 'ss_remember_account';

type Tab = 'student' | 'admin';

/** 设计稿左上角的四角星 logo（内联 SVG，不引外链） */
function StarMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <path
        d="M12 1.6c1 5.9 4.5 9.4 10.4 10.4-5.9 1-9.4 4.5-10.4 10.4C11 16.5 7.5 13 1.6 12 7.5 11 11 7.5 12 1.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function LoginClient() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('student');

  const [account, setAccount] = useState('');
  // 管理员账号单独存一份，默认 admin —— 和学生学号共用一个 input 会在切页签时串值
  const [adminAccount, setAdminAccount] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 已登录就直接进首页；记住账号则预填上次用的账号
  useEffect(() => {
    void fetch('/api/auth/session')
      .then((r) => r.json())
      .then((b) => {
        if (b?.data?.signedIn) router.replace('/');
      })
      .catch(() => undefined);
    const saved = window.localStorage.getItem(REMEMBER_KEY);
    if (saved) {
      setAccount(saved);
      setRemember(true);
    }
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const res =
        tab === 'student'
          ? await fetch('/api/auth/session', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                studentId: account.trim(),
                password,
                remember,
              }),
            })
          : await fetch('/api/admin/session', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ account: adminAccount.trim(), password }),
            });

      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message ?? '登录失败，请重试');
        return;
      }

      if (tab === 'student') {
        if (remember && account.trim()) {
          window.localStorage.setItem(REMEMBER_KEY, account.trim());
        } else {
          window.localStorage.removeItem(REMEMBER_KEY);
        }
        router.replace('/');
      } else {
        router.replace('/admin');
      }
      router.refresh();
    } catch {
      setError('网络似乎不太稳定，请重试');
    } finally {
      setBusy(false);
    }
  }

  function switchTab(next: Tab) {
    setTab(next);
    setError(null);
    setHint(null);
    setShowPwd(false);
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-space-900">
      {/* 全屏夜景底图 */}
      <Image
        src="/images/login-bg.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      {/* 右侧轻微压暗，保证玻璃卡上的文字对比度 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(100deg, rgba(10,14,35,0.18) 40%, rgba(10,14,35,0.5) 100%)',
        }}
        aria-hidden
      />

      {/* 顶部品牌 */}
      <header className="relative z-10 flex items-center gap-3 px-6 py-6 md:px-10">
        <span
          className="grid h-11 w-11 place-items-center rounded-2xl text-white shadow-glow"
          style={{ backgroundImage: 'var(--grad-cta)' }}
          aria-hidden
        >
          <StarMark className="h-6 w-6" />
        </span>
        <div>
          <p className="font-display text-lg leading-tight text-hi">{SITE_NAME}</p>
          <p className="mt-0.5 text-[11px] tracking-wide text-lo">— 让每一颗星星都被温柔以待 —</p>
        </div>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center gap-16 px-6 pb-16 lg:justify-between lg:px-16">
        {/* 左侧手写体标语（桌面端） */}
        <div className="hidden max-w-md lg:block">
          <p
            className="font-display text-3xl leading-relaxed text-white"
            style={{ textShadow: '0 2px 18px rgba(10,14,35,0.65)' }}
          >
            在城市的角落
            <br />
            也有需要被看见的生命
          </p>
          {/* 星轨弧线 + 小星（设计稿同款装饰） */}
          <svg viewBox="0 0 220 40" className="mt-2 h-8 w-56 text-white" aria-hidden>
            <path
              d="M4 30 C60 14 130 10 196 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.9"
            />
            <path
              d="M210 8c.5 3.2 2.3 5 5.5 5.5-3.2.5-5 2.3-5.5 5.5-.5-3.2-2.3-5-5.5-5.5 3.2-.5 5-2.3 5.5-5.5Z"
              fill="currentColor"
            />
          </svg>
        </div>

        {/* 玻璃登录卡 */}
        <section
          aria-label="登录"
          className="w-full max-w-md rounded-3xl bg-space-900/60 p-7 shadow-glow backdrop-blur-xl ring-1 ring-white/10 md:p-8"
        >
          {/* 卡右上角流星装饰 */}
          <svg
            viewBox="0 0 120 44"
            className="pointer-events-none absolute right-4 top-4 h-9 w-28 text-accent-300"
            aria-hidden
          >
            <path
              d="M4 38 C34 20 70 10 104 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              opacity="0.55"
            />
            <path
              d="M112 4c.4 2.6 2 4.2 4.6 4.6-2.6.4-4.2 2-4.6 4.6-.4-2.6-2-4.2-4.6-4.6 2.6-.4 4.2-2 4.6-4.6Z"
              fill="currentColor"
            />
          </svg>

          <h1 className="font-display text-2xl text-hi">欢迎回来</h1>
          <p className="mt-1.5 text-sm text-lo">登录后开启你的星辰守护之旅</p>

          {/* 身份页签 */}
          <div
            role="tablist"
            aria-label="登录身份"
            className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-space-800/70 p-1 ring-1 ring-space-700/70"
          >
            {(
              [
                { key: 'student', label: '学生登录', Icon: GraduationCap },
                { key: 'admin', label: '管理员登录', Icon: ShieldCheck },
              ] as const
            ).map(({ key, label, Icon }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => switchTab(key)}
                  className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg text-sm transition-colors duration-star ease-star"
                  style={
                    active
                      ? { backgroundImage: 'var(--grad-cta)', color: 'var(--text-hi)' }
                      : undefined
                  }
                >
                  <Icon size={15} aria-hidden className={active ? '' : 'text-lo'} />
                  <span className={active ? '' : 'text-lo'}>{label}</span>
                </button>
              );
            })}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-3" aria-busy={busy}>
            <label className="relative block">
              <span className="sr-only">{tab === 'student' ? '学号 / 用户名' : '管理员账号'}</span>
              <User
                size={15}
                aria-hidden
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lo"
              />
              <input
                type="text"
                value={tab === 'student' ? account : adminAccount}
                onChange={(e) =>
                  tab === 'student' ? setAccount(e.target.value) : setAdminAccount(e.target.value)
                }
                autoComplete="username"
                spellCheck={false}
                placeholder={tab === 'student' ? '请输入学号 / 用户名' : '请输入管理员账号'}
                className="min-h-[46px] w-full rounded-xl bg-space-800/80 pl-10 pr-3 text-sm text-hi ring-1 ring-space-700 outline-none transition-colors duration-star ease-star placeholder:text-lo focus-visible:ring-accent-400"
              />
            </label>

            <label className="relative block">
              <span className="sr-only">密码</span>
              <Lock
                size={15}
                aria-hidden
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lo"
              />
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={tab === 'student' ? 'current-password' : 'off'}
                placeholder="请输入密码"
                className="min-h-[46px] w-full rounded-xl bg-space-800/80 pl-10 pr-10 text-sm text-hi ring-1 ring-space-700 outline-none transition-colors duration-star ease-star placeholder:text-lo focus-visible:ring-accent-400"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                aria-label={showPwd ? '隐藏密码' : '显示密码'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-lo transition-colors duration-star ease-star hover:text-hi"
              >
                {showPwd ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
              </button>
            </label>

            {tab === 'student' && (
              <div className="flex items-center justify-between pt-0.5">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-lo">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--accent-400)]"
                  />
                  记住账号
                </label>
                <button
                  type="button"
                  onClick={() => setHint('请联系管理员在后台重置密码')}
                  className="text-xs text-lo transition-colors duration-star ease-star hover:text-hi"
                >
                  忘记密码?
                </button>
              </div>
            )}

            {error && (
              <p role="alert" className="text-xs" style={{ color: 'var(--star-red)' }}>
                {error}
              </p>
            )}
            {hint && (
              <p role="status" className="text-xs" style={{ color: 'var(--star-yellow)' }}>
                {hint}
              </p>
            )}

            <button
              type="submit"
              disabled={
                busy ||
                !password ||
                (tab === 'student' ? !account.trim() : !adminAccount.trim())
              }
              className="mt-1 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full text-sm font-medium text-white transition-opacity duration-star ease-star hover:opacity-90 disabled:opacity-40"
              style={{ backgroundImage: 'var(--grad-cta)' }}
            >
              {busy ? '正在登录…' : '登录'}
              {!busy && <ArrowRight size={16} aria-hidden />}
            </button>
          </form>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-lo">
            <Heart size={11} className="text-accent-300" aria-hidden />
            {SITE_NAME} · 守护校园里的每一个小生命
          </p>
        </section>
      </div>
    </div>
  );
}

const SITE_NAME = '智护流浪星';
