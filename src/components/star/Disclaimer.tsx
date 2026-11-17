import { AlertTriangle } from 'lucide-react';
import { DISCLAIMER } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * 免责声明：任何 AI 健康结论的渲染处都必须挂载（评估结论用 variant="block"）。
 * 文案唯一来源是 lib/constants.ts 的 DISCLAIMER，避免各处措辞不一致。
 */
export function Disclaimer({
  variant = 'inline',
  text = DISCLAIMER,
  className,
}: {
  variant?: 'inline' | 'block' | 'toast';
  text?: string;
  className?: string;
}) {
  if (variant === 'inline') {
    return <p className={cn('text-xs leading-relaxed text-lo', className)}>{text}</p>;
  }

  if (variant === 'toast') {
    return (
      <div
        className={cn(
          'flex items-start gap-2 rounded-btn bg-space-800 px-3 py-2 text-xs text-hi ring-1 ring-accent-400/30',
          className,
        )}
        role="status"
      >
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-accent-400" aria-hidden />
        <span>{text}</span>
      </div>
    );
  }

  return (
    <aside
      className={cn(
        'glass-card px-4 py-3 text-xs leading-relaxed text-hi',
        className,
      )}
      aria-label="免责声明"
    >
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        <AlertTriangle size={13} aria-hidden />
        免责声明
      </div>
      <p>{text}</p>
    </aside>
  );
}
