import { cn } from '@/lib/utils';

/** 编号铜牌：等宽字体营造观测编号感（No.012） */
export function CodePlate({
  code,
  className,
  tone = 'amber',
}: {
  code: string;
  className?: string;
  tone?: 'amber' | 'muted';
}) {
  return (
    <span
      className={cn(
        'data-mono inline-flex items-center rounded-sticker border px-2 py-0.5 text-xs tracking-wider',
        tone === 'amber'
          ? 'border-accent-400/45 bg-accent-400/10 text-accent-300'
          : 'border-space-700 bg-space-700/40 text-lo',
        className,
      )}
    >
      {code}
    </span>
  );
}
