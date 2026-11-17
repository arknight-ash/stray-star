'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

/**
 * 返回上一页。
 *
 * 用 history.back() 而不是硬跳某个路径：档案页既能从图鉴进、也能从星图/首页进，
 * 写死 /animals 会把从星图点进来的人送错地方。
 * 但直接打开（新标签页、分享链接）时 history 里没有上一页，back() 会离开站点 ——
 * 那种情况退回 fallback。
 */
export function BackButton({
  fallback = '/animals',
  className,
}: {
  fallback?: string;
  className?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.replace(fallback);
      }}
      aria-label="返回上一页"
      className={
        className ??
        'inline-flex min-h-[34px] items-center gap-1.5 rounded-full bg-space-800/80 px-3 text-xs text-lo ring-1 ring-space-700 transition-colors duration-star ease-star hover:text-hi hover:ring-accent-400/60'
      }
    >
      <ArrowLeft size={13} aria-hidden />
      返回
    </button>
  );
}
