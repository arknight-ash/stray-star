import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 页面外壳：统一最大宽度、移动端底部安全区（底部 tab 56px）、叙事标题区。
 * 标题用霞鹜文楷，正文用 Inter —— 叙事与数据的字体分工在此固定。
 */
export function PageShell({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={cn('mx-auto max-w-5xl px-4 pb-28 pt-6 md:pb-16', className)}>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl leading-tight text-accent-300">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-lo">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </main>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="font-display text-lg text-accent-300">{children}</h2>
      {hint && <span className="text-xs text-lo">{hint}</span>}
    </div>
  );
}
