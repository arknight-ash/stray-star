import { HEALTH_META } from '@/lib/semantic';
import { StarGlyph } from '@/components/star/StarGlyph';
import { cn } from '@/lib/utils';
import type { HealthLevel } from '@/types/domain';

const ORDER: HealthLevel[] = ['GREEN', 'YELLOW', 'RED'];

/**
 * 星况图例：颜色 + 文字 + 数字三重编码（R2）。
 * 这里刻意**不用 <HealthChip>**：图例是一排常驻元素，跟着 2.4s 一起呼吸会很吵；
 * 脉冲只留给「有 OPEN 预警」的星点。
 */
export function HealthLegend({
  counts,
  className,
}: {
  counts: Record<HealthLevel, number>;
  className?: string;
}) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {ORDER.map((level) => {
        const meta = HEALTH_META[level];
        return (
          <li
            key={level}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sticker px-2 py-1 ring-1',
              meta.bg,
              meta.ring,
            )}
          >
            <StarGlyph size={11} color={meta.dot} glow={false} />
            <span className={cn('text-xs', meta.text)}>{meta.label}</span>
            <span className="data-mono text-xs text-hi">{counts[level]}</span>
          </li>
        );
      })}
    </ul>
  );
}
