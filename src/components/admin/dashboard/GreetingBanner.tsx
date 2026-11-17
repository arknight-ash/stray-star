import { Bell } from 'lucide-react';

/**
 * 总览页顶部问候横幅（设计稿第一块）。
 *
 * 背景沿用站内那张夜景插画，靠左侧压暗渐变保证文字对比度 ——
 * 不做"随机问候语"：管理端看的是状态，不是氛围。
 * 时间在服务端渲染，页面本来就是 force-dynamic，不存在水合不一致。
 */
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

export function GreetingBanner({ account }: { account: string }) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `今天是 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 星期${
    WEEKDAY[now.getDay()]
  } ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  return (
    <section
      aria-label="问候"
      className="relative overflow-hidden rounded-card border border-space-700/60"
    >
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/images/hero-city.jpg)' }}
        aria-hidden
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(90deg, color-mix(in srgb, var(--space-900) 90%, transparent) 0%, color-mix(in srgb, var(--space-900) 62%, transparent) 52%, color-mix(in srgb, var(--space-900) 22%, transparent) 100%)',
        }}
        aria-hidden
      />

      <div className="relative z-10 px-5 py-5 md:px-7 md:py-6">
        <h1 className="flex items-center gap-2.5 font-display text-[22px] leading-tight text-hi md:text-2xl">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--accent-400) 26%, transparent)',
              color: 'var(--accent-300)',
            }}
            aria-hidden
          >
            <Bell size={16} />
          </span>
          你好，{account === 'admin' ? '管理员' : account}
        </h1>
        <p className="mt-2 text-[11px] tracking-wide text-lo data-mono">{stamp}</p>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-lo">
          让校园的每一只流浪动物，都被温柔以待。
        </p>
      </div>
    </section>
  );
}
