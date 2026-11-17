'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/utils';

interface Dust {
  x: number;
  y: number;
  r: number;
  a: number;
  delay: number;
}

/** 深空背景：Canvas 星尘 + CSS 静态星点。reduced-motion 下只渲染静态层。 */
export function StarFieldBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();

  const dust = useMemo<Dust[]>(() => {
    // 固定伪随机，避免 SSR/CSR 不一致
    const seed = [0.12, 0.87, 0.34, 0.61, 0.05, 0.72, 0.48, 0.93, 0.26, 0.58, 0.81, 0.17];
    return seed.map((s, i) => ({
      x: s,
      y: ((s * 7.3 + i * 0.19) % 1 + 1) % 1,
      r: 1 + (i % 3) * 0.6,
      a: 0.18 + (i % 4) * 0.14,
      delay: i * 0.18,
    }));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    if (reduced) {
      // 静态绘制一次即可
      dust.forEach((d) => {
        ctx.beginPath();
        ctx.fillStyle = `rgba(237,239,247,${d.a})`;
        ctx.arc(d.x * canvas.clientWidth, d.y * canvas.clientHeight, d.r, 0, Math.PI * 2);
        ctx.fill();
      });
      return () => window.removeEventListener('resize', resize);
    }

    let raf = 0;
    let start = performance.now();
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      dust.forEach((d) => {
        const phase = (t + d.delay) % 2.4;
        const opacity = d.a * (0.45 + 0.55 * Math.sin((phase / 2.4) * Math.PI * 2));
        ctx.beginPath();
        ctx.fillStyle = `rgba(237,239,247,${Math.max(0, opacity)})`;
        ctx.arc(d.x * canvas.clientWidth, d.y * canvas.clientHeight, d.r, 0, Math.PI * 2);
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [dust, reduced]);

  return (
    <div className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)} aria-hidden>
      <div className="absolute inset-0 bg-space-900" />
      <div className="starfield absolute inset-0 opacity-70" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 50% 0%, rgba(245,185,66,0.07), transparent 60%)',
        }}
      />
    </div>
  );
}
