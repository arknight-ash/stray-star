import type { LucideIcon } from 'lucide-react';

/**
 * 管理端内页页头（设计稿 2026-10-27 二轮）。
 *
 * 每个子页顶上都是这一条：左侧图标块 + 标题 + 一行说明，右侧留动作位
 * （新增 / 导出 / 返回）。刻意不做大字号大留白 —— 管理端一屏要塞得下
 * 表格和图表，页头不该吃掉 100px。
 */
export function PageHeader({
  title,
  subtitle,
  Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  Icon?: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && (
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-btn"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--accent-400) 18%, transparent)',
              color: 'var(--accent-300)',
            }}
            aria-hidden
          >
            <Icon size={17} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="font-display text-[17px] leading-tight text-hi">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-[11px] text-lo">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

/** 页头右侧的实心主按钮（「+ 新增动物」这类） */
export function HeaderAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-btn px-3 text-xs font-medium text-space-900 transition-opacity duration-star ease-star hover:opacity-90"
      style={{ backgroundColor: 'var(--accent-400)' }}
    >
      {children}
    </a>
  );
}

/** 页头右侧的实心主按钮（按钮版，用于「审核新增申请」这类切换视图的动作） */
export function HeaderButton({
  onClick,
  children,
  pressed,
}: {
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-btn px-3 text-xs font-medium text-space-900 transition-opacity duration-star ease-star hover:opacity-90"
      style={{ backgroundColor: 'var(--accent-400)' }}
    >
      {children}
    </button>
  );
}

/** 页头右侧的描边次按钮（「返回总览」「导出」这类） */
export function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-btn border border-space-700 px-3 text-xs text-lo transition-colors duration-star ease-star hover:text-hi"
    >
      {children}
    </a>
  );
}
