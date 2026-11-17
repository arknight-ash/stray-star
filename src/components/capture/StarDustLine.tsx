'use client';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/utils';

/**
 * 扫描线 + 星尘流。纯 CSS keyframes，不引动画库。
 *
 * reduced-motion：不做位移与粒子，只留一条静态渐变条 —— 进度信息仍在，
 * 但去掉了持续移动。（「静止在最高亮度」而非消失，是本项目统一的降级口径）
 */
const DUST = Array.from({ length: 12 }, (_, i) => i);

export function StarDustLine({
  running,
  tone = 'var(--accent-400)',
  className,
}: {
  running: boolean;
  /** 语义色：健康等级决定的星尘颜色，从 HEALTH_META 取 */
  tone?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <div
      className={cn('pointer-events-none absolute inset-0 z-10 overflow-hidden', className)}
      aria-hidden
    >
      {/* 扫描光束 */}
      <div
        className={cn(
          'absolute left-0 right-0 h-[2px]',
          running && !reduced && 'animate-scan-dust',
          running && reduced && 'top-1/2',
          !running && 'opacity-0',
        )}
        style={{
          background: `linear-gradient(90deg, transparent, ${tone}, transparent)`,
          boxShadow: `0 0 12px ${tone}`,
        }}
      />

      {/* 跟随光束的星尘 */}
      {running && !reduced && (
        <div className={cn('absolute inset-0', 'animate-scan-dust')}>
          {DUST.map((i) => (
            <span
              key={i}
              className="absolute h-1 w-1 rounded-full"
              style={{
                left: `${8 + ((i * 7) % 84)}%`,
                top: `${((i * 13) % 60) + 20}%`,
                backgroundColor: tone,
                opacity: 0.35 + (i % 4) * 0.18,
                filter: 'blur(0.3px)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
