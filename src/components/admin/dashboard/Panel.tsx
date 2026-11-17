import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

/**
 * 管理端面板外壳：标题 + 可选右上动作 + 内容。
 *
 * 只做排版、不做数据，所以是服务端组件 —— 9 个面板不必各自变成客户端包。
 */
export function Panel({
  title,
  Icon,
  action,
  children,
  className = '',
  bodyClassName = 'px-4 pb-4',
}: {
  title: string;
  Icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col rounded-card bg-space-800/60 ring-1 ring-space-700/70 ${className}`}
    >
      <header className="flex items-center justify-between gap-2 px-4 pb-2.5 pt-3.5">
        <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-hi">
          {Icon && <Icon size={14} aria-hidden style={{ color: 'var(--accent-300)' }} />}
          <span className="truncate">{title}</span>
        </h2>
        {action}
      </header>
      <div className={`min-w-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** 面板右上角的「查看更多」：所有面板统一这一个样式，避免各写一份 */
export function PanelMore({ href, label = '查看更多' }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      className="shrink-0 text-[11px] text-lo transition-colors duration-star ease-star hover:text-hi"
    >
      {label}
    </Link>
  );
}
