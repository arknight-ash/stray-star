'use client';

import { useMemo } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/utils';

/**
 * 取景框四角星形描边。
 * 纯装饰：不承载任何数据，因此 SVG 里全是常量，没有插值。
 * 顺时针 stagger 60ms 出场；reduced-motion 下直接呈现，不动画。
 */
const CORNERS = [
  { pos: 'left-3 top-3', rotate: 0, cross: 'left' },
  { pos: 'right-3 top-3', rotate: 90, cross: 'right' },
  { pos: 'right-3 bottom-3', rotate: 180, cross: 'right' },
  { pos: 'left-3 bottom-3', rotate: 270, cross: 'left' },
] as const;

export function CornerStars({
  active = false,
  className,
}: {
  /** scanning 态：四角加亮，静止举着 */
  active?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();

  const delays = useMemo(() => CORNERS.map((_, i) => (reduced ? 0 : i * 60)), [reduced]);

  return (
    <div className={cn('pointer-events-none absolute inset-0 z-10', className)} aria-hidden>
      {CORNERS.map((corner, i) => (
        <span
          key={corner.pos}
          className={cn(
            'absolute h-9 w-9',
            corner.pos,
            !reduced && 'animate-corner-in',
          )}
          style={!reduced ? { animationDelay: `${delays[i]}ms` } : undefined}
        >
          <svg viewBox="0 0 36 36" className={cn('h-full w-full transition-opacity duration-star ease-star', active ? 'opacity-100' : 'opacity-70')}>
            <g
              transform={`rotate(${corner.rotate} 18 18)`}
              stroke={active ? 'var(--accent-400)' : 'var(--accent-300)'}
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            >
              <path d="M2 12 L2 2 L12 2" opacity="0.9" />
              <Star cx={7} cy={7} r={2.6} opacity={active ? 1 : 0.65} />
            </g>
          </svg>
        </span>
      ))}
    </div>
  );
}

/** 五角星路径（固定坐标，无外部数据） */
function Star({ cx, cy, r, opacity }: { cx: number; cy: number; r: number; opacity: number }) {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const rad = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.45;
    points.push(`${(cx + Math.cos(rad) * radius).toFixed(2)},${(cy + Math.sin(rad) * radius).toFixed(2)}`);
  }
  return <polygon points={points.join(' ')} opacity={opacity} />;
}
