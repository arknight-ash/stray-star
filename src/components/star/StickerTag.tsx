import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'amber' | 'paper' | 'green' | 'yellow' | 'red';

const TONE: Record<Tone, string> = {
  amber: 'bg-star-yellow/25 text-star-yellow ring-1 ring-star-yellow/40',
  paper: 'bg-space-800/90 text-hi ring-1 ring-space-700',
  green: 'bg-star-green/20 text-star-green ring-1 ring-star-green/40',
  yellow: 'bg-star-yellow/20 text-star-yellow ring-1 ring-star-yellow/40',
  red: 'bg-star-red/20 text-star-red ring-1 ring-star-red/40',
};

/**
 * 胶带贴纸：手账内页的标签/胶带元素。
 * 语义色 tone 用于「已投喂 / 需就医」等状态标签；paper 用于米色胶带。
 * 旋转是静态视觉表达，不受 prefers-reduced-motion 影响。
 */
export function StickerTag({
  children,
  tone = 'amber',
  rotate = -2,
  size = 'sm',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  rotate?: number;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const clamped = Math.max(-6, Math.min(6, rotate));
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sticker px-2 font-medium',
        size === 'sm' ? 'py-0.5 text-xs' : 'py-1 text-sm',
        tone === 'amber' && 'tape text-hi',
        tone !== 'amber' && TONE[tone],
        className,
      )}
      style={{ transform: `rotate(${clamped}deg)` }}
    >
      {children}
    </span>
  );
}
