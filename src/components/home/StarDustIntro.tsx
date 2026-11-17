'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

const KEY = 'ss:starmap-intro';

/**
 * 首屏星尘淡入：600ms，**整个会话只播一次**。
 * - reduced-motion 下直接不渲染（不做"动画变成 0.01ms"的假降级）；
 * - 只在挂载时判断一次，不监听滚动、不做 IntersectionObserver —— 首页只有一屏，重复触发没有意义。
 */
export function StarDustIntro() {
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (reduced) return;
    try {
      if (window.sessionStorage.getItem(KEY)) return;
      window.sessionStorage.setItem(KEY, '1');
    } catch {
      // 隐私模式下 sessionStorage 可能抛错：宁可少播一次动画，也不要让首页崩掉
      return;
    }
    setPlaying(true);
    const timer = window.setTimeout(() => setPlaying(false), 700);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  if (!playing) return null;

  return (
    <div
      className="dust-intro starfield pointer-events-none fixed inset-0 z-50"
      aria-hidden
    />
  );
}
