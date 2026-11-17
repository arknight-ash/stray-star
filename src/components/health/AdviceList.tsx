import { cn } from '@/lib/utils';

/**
 * 建议列表。
 * 有序编号而非无序圆点：这些建议有执行优先级，AI 也是按紧急程度排的。
 * 纸感底色沿用便签墙的 --paper，让 AI 的建议在视觉上属于「手账里的一页」，
 * 而不是系统弹窗。
 */
export function AdviceList({ advice, className }: { advice: string[]; className?: string }) {
  if (!advice.length) return null;

  return (
    <div className={cn('glass-card px-4 py-3 text-hi', className)}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wider opacity-60">建议</p>
      <ol className="space-y-1.5">
        {advice.map((item, i) => (
          <li key={item} className="flex gap-2 text-sm leading-[1.7]">
            <span className="data-mono mt-0.5 shrink-0 opacity-60">{i + 1}.</span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
