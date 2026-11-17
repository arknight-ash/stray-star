import { CONFIDENCE_FLOOR } from '@/lib/constants';
import { formatConfidence } from '@/lib/format';
import { cn } from '@/lib/utils';

const TONE = {
  high: 'var(--star-green)',
  mid: 'var(--star-yellow)',
  // 低置信度曾经用 var(--star-red)。那会让「AI 没把握」读成「这只动物病危」——
  // 红在本产品里是健康预警的专属语义（R2），不能借给"置信度"这条轴。
  // 改用暖金：表示"需要人看一眼"，与预警红区分开。
  low: 'var(--accent-400)',
} as const;

/**
 * 等宽置信度徽标：数字用 JetBrains Mono + tabular-nums，营造观测数据感。
 * 低于 CONFIDENCE_FLOOR 时强制给出「不确定」提示 —— AI 安全可控的硬性要求。
 */
export function ConfidenceBadge({
  value,
  label = '置信度',
  size = 'md',
  showBar = false,
  className,
}: {
  value: number;
  label?: string;
  size?: 'sm' | 'md';
  showBar?: boolean;
  className?: string;
}) {
  const clamped = Math.min(1, Math.max(0, value));
  const tone = clamped >= 0.86 ? TONE.high : clamped >= CONFIDENCE_FLOOR ? TONE.mid : TONE.low;
  const low = clamped < CONFIDENCE_FLOOR;

  return (
    <div className={cn('inline-flex flex-col', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-sticker px-2 py-0.5 ring-1',
          size === 'sm' ? 'text-xs' : 'text-sm',
        )}
        style={{ color: tone, boxShadow: `inset 0 0 0 1px ${tone}` }}
        aria-label={`${label} ${formatConfidence(clamped)}${low ? '，AI 不确定，建议人工确认' : ''}`}
      >
        <span className="text-lo">{label}</span>
        <span className="data-mono font-medium">{formatConfidence(clamped)}</span>
      </span>

      {showBar && (
        <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-space-700">
          <span
            className="block h-full rounded-full transition-[width] duration-star ease-star"
            style={{ width: `${Math.max(4, Math.round(clamped * 100))}%`, backgroundColor: tone }}
          />
        </span>
      )}

      {low && (
        // R5 的措辞是固定的：必须出现「不确定」三个字。原文只写「置信度偏低」，
        // 读起来像一个技术参数，而不是一个需要人接手的状态。
        <span className="mt-1 text-xs text-accent-300">
          AI 不确定：置信度偏低，建议补拍或人工核对。
        </span>
      )}
    </div>
  );
}
