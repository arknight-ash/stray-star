'use client';

import { useEffect, useState } from 'react';

/**
 * 页头「已点亮 N 颗」。
 *
 * SSR 时渲染占位符「—」，挂载后再补真实数字 —— 这样静态页可以继续静态预渲染，
 * 也不会出现"服务端 0 / 客户端 5"的 hydration 不一致。
 * 取不到就一直是「—」：宁可显示未知，也不要显示一个错的 0。
 */
export function StarCount() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        const n = body?.ok ? body.data?.animals : null;
        if (typeof n === 'number') setCount(n);
      })
      .catch(() => {
        /* 静默：徽章取不到数不值得打扰任何人 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <>已点亮 {count ?? '—'} 颗</>;
}
