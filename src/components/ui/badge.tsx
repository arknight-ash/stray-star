import * as React from 'react';
import { cn } from '@/lib/utils';

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sticker border border-space-700 bg-space-700/40 px-2 py-1 text-xs text-lo',
        className,
      )}
      {...props}
    />
  );
}
