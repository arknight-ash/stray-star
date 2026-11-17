'use client';

import { motion } from 'framer-motion';
import type { HealthLevel } from '@/types/domain';
import { HEALTH_META } from '@/lib/semantic';
import { MOTION } from '@/lib/constants';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/utils';
import { StarGlyph } from './StarGlyph';

export type StarDotVariant = 'idle' | 'pulse' | 'alert';

/**
 * 形状：默认圆点（徽标、芯片等小尺寸场景），星图上的星点改用五角星。
 * 五角星的表观面积比同直径的圆小约 40%，所以地图调用点会把 size 放大补偿，
 * 否则同一个 14px 换成星之后"看起来变小、也变暗了"。
 */
export type StarDotShape = 'dot' | 'star';

/**
 * 星点：一只动物在界面上的最小视觉单元。
 * - idle  静态发光点
 * - pulse 2.4s 循环脉冲（透明度 .55→1 + 缩放 1→1.18）
 * - alert 脉冲之外多一圈扩散光环（地图红星 / 预警列表）
 * 全部动效在 prefers-reduced-motion 下降级为静态。
 */
export function StarDot({
  level,
  variant = 'idle',
  size = 12,
  shape = 'dot',
  className,
}: {
  level: HealthLevel;
  variant?: StarDotVariant;
  size?: number;
  shape?: StarDotShape;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const meta = HEALTH_META[level];
  const animated = !reduced && variant !== 'idle';

  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={meta.starName}
    >
      {animated && variant === 'alert' && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ border: `1px solid ${meta.dot}` }}
          animate={{ opacity: [0.7, 0], scale: [0.6, 2.2] }}
          transition={{ duration: MOTION.pulseSec, ease: 'easeInOut', repeat: Infinity }}
        />
      )}

      <motion.span
        className="block"
        style={{
          width: size,
          height: size,
          // 圆点：背景色 + 光晕；星形：填充色 + drop-shadow 光晕（box-shadow 对 SVG 路径无效）
          ...(shape === 'star'
            ? {
                // 颜色变量不可直接给 alpha，用 color-mix 派生半透明辉光（与 Tailwind 的 /opacity 同思路）
                filter: `drop-shadow(0 0 ${Math.max(3, Math.round(size / 3))}px color-mix(in srgb, ${meta.dot} 55%, transparent))`,
              }
            : {
                backgroundColor: meta.dot,
                boxShadow: meta.glow,
              }),
        }}
        animate={animated ? { opacity: [0.55, 1, 0.55], scale: [1, 1.18, 1] } : undefined}
        transition={
          animated ? { duration: MOTION.pulseSec, ease: 'easeInOut', repeat: Infinity } : undefined
        }
      >
        {shape === 'star' && <StarGlyph size={size} color={meta.dot} glow={false} />}
      </motion.span>
    </span>
  );
}
