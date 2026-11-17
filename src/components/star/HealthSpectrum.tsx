'use client';

import { HEALTH_META } from '@/lib/semantic';
import type { HealthLevel } from '@/types/domain';
import { cn } from '@/lib/utils';

const ORDER: HealthLevel[] = ['GREEN', 'YELLOW', 'RED'];

/**
 * 绿黄红光谱条：全站语义色的「图例 + 选择器」。
 * - 不传 onChange → 只读图例（role="img"）
 * - 传 onChange → 可点击切换（role="radiogroup"，供管理员改档），点击目标 ≥44px
 * 颜色 + 文字双重编码，不靠颜色单独表意。
 */
export function HealthSpectrum({
  level,
  value,
  showLabels = true,
  size = 'md',
  onChange,
  className,
}: {
  level: HealthLevel;
  value?: number;
  showLabels?: boolean;
  size?: 'sm' | 'md';
  onChange?: (next: HealthLevel) => void;
  className?: string;
}) {
  const interactive = typeof onChange === 'function';
  const barHeight = size === 'sm' ? 'h-1.5' : 'h-2';
  const labelTone = { active: 'text-hi', idle: 'text-lo' };

  return (
    <div className={cn('w-full', className)}>
      <div
        className={cn('flex w-full overflow-hidden rounded-sticker bg-space-700', barHeight)}
        role={interactive ? 'radiogroup' : 'img'}
        aria-label={interactive ? '健康等级' : `当前健康等级：${HEALTH_META[level].label}`}
      >
        {ORDER.map((lv) => {
          const active = lv === level;
          const meta = HEALTH_META[lv];
          const content = (
            <>
              <span
                className="block h-full w-full transition-opacity duration-star ease-star"
                style={{
                  backgroundColor: meta.dot,
                  opacity: active ? 1 : 0.32,
                }}
              />
              {active && (
                <span
                  className="pointer-events-none absolute inset-0 ring-1 ring-inset"
                  style={{ boxShadow: `inset 0 0 0 1px ${meta.dot}` }}
                />
              )}
            </>
          );

          if (!interactive) {
            return (
              <span key={lv} className="relative flex-1" title={meta.label}>
                {content}
              </span>
            );
          }

          return (
            <button
              key={lv}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={meta.label}
              onClick={() => onChange?.(lv)}
              className="relative flex-1 cursor-pointer"
            >
              {content}
            </button>
          );
        })}
      </div>

      {typeof value === 'number' && (
        <div className="relative mt-1 h-3">
          <span
            className="absolute -translate-x-1/2 text-[10px] text-lo"
            style={{ left: `${Math.min(100, Math.max(0, value * 100))}%` }}
          >
            ▲
          </span>
        </div>
      )}

      {showLabels && (
        <div className="mt-1.5 flex justify-between">
          {ORDER.map((lv) => (
            <span
              key={lv}
              className={cn(
                'text-xs transition-colors duration-star ease-star',
                lv === level ? labelTone.active : labelTone.idle,
              )}
            >
              {HEALTH_META[lv].label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
