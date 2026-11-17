import type { HealthLevel } from '@/types/domain';
import { HEALTH_META } from '@/lib/semantic';
import { cn } from '@/lib/utils';
import { StarDot } from './StarDot';

/** 语义色徽标：颜色 + 文字双重编码，不靠颜色单独表意（WCAG） */
export function HealthChip({
  level,
  size = 'md',
  className,
}: {
  level: HealthLevel;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const meta = HEALTH_META[level];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-sticker ring-1',
        meta.bg,
        meta.ring,
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        className,
      )}
    >
      <StarDot level={level} size={size === 'sm' ? 8 : 10} variant="pulse" />
      <span className={cn('font-medium', meta.text)}>{meta.label}</span>
    </span>
  );
}
