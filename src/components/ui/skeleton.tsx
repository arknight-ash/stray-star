import { cn } from '@/lib/utils';

/** 骨架屏：识别/检索等待态使用（深空底，不用灰色块闪白） */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-card bg-space-800/80 ring-1 ring-space-700', className)}
      {...props}
    />
  );
}
