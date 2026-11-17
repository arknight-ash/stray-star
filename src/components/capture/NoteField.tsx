'use client';

import { LIMITS } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * 现场补充描述输入。
 * 选填，但它是 mock/弱线索场景下唯一的个体级证据来源 —— 所以放在显眼但不强制的位置。
 * 上传 locale = 上限 200 字，超出即截断提示，不报错。
 */
export function NoteField({
  value,
  onChange,
  max = LIMITS.note,
  rows = 3,
  label = '再补一句它的样子（选填）',
  placeholder = '比如：黑色短毛，左耳有缺口，常在图书馆北侧花坛',
  disabled,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  max?: number;
  rows?: number;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const remaining = max - value.length;

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-baseline justify-between">
        <label className="text-xs text-lo" htmlFor="capture-note">
          {label}
        </label>
        <span className="data-mono text-xs text-lo" aria-live="polite">
          {value.length}/{max}
        </span>
      </div>
      <textarea
        id="capture-note"
        rows={rows}
        value={value}
        disabled={disabled}
        maxLength={max}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        placeholder={placeholder}
        className="w-full resize-none rounded-btn border border-space-700 bg-space-800 px-3 py-2 text-sm text-hi placeholder:text-lo/70 focus:border-accent-400/60 focus:outline-none"
      />
      {remaining === 0 && <p className="text-xs text-star-yellow">已经写满了，精炼一点更好认。</p>}
    </div>
  );
}
