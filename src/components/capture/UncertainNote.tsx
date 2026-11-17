'use client';

import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 「不确定」提示条。
 * 出现条件由服务端判定（tier==='candidate' 或 confidence < CONFIDENCE_FLOOR），
 * 这里是强制渲染 —— UI 不允许自行决定是否展示「不确定」。
 */
export function UncertainNote({
  tone = 'candidate',
  children,
  className,
}: {
  tone?: 'candidate' | 'unknown' | 'degraded';
  children?: React.ReactNode;
  className?: string;
}) {
  const copy = children ?? copyFor(tone);

  return (
    <div
      className={cn(
        'animate-dust-in flex items-start gap-2 rounded-sticker bg-star-yellow/12 px-3 py-2 text-xs leading-relaxed text-star-yellow ring-1 ring-star-yellow/45',
        className,
      )}
      role="status"
    >
      <Sparkles size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span>{copy}</span>
    </div>
  );
}

function copyFor(tone: 'candidate' | 'unknown' | 'degraded'): React.ReactNode {
  if (tone === 'unknown') {
    return (
      <>
        <strong className="font-medium">不确定：</strong>
        照片信息不足，没能可靠判定物种。补一张更清晰的正脸照，或写一句它的样子。
      </>
    );
  }
  if (tone === 'degraded') {
    return (
      <>
        <strong className="font-medium">不确定：</strong>
        识别服务这次没能完整返回结果，下面的结论仅供参考，请人工核对。
      </>
    );
  }
  return (
    <>
      <strong className="font-medium">不确定：</strong>
      这颗星有些模糊，没能到足以确认的程度。下面是比较接近的几只，请人工辨认。
    </>
  );
}
