import { AlertOctagon, HeartPulse } from 'lucide-react';
import { HEALTH_META } from '@/lib/semantic';
import { cn } from '@/lib/utils';

/**
 * 「是否需要就医」的显式结论块。
 *
 * 两种结论都要显式呈现 —— 「暂无需就医」不能因为听起来平淡就省略：
 * 一个空白区域会被读成「没说」，而「没说」和「说不用去」是两回事。
 */
export function NeedsVetCallout({
  needsVet,
  className,
}: {
  needsVet: boolean;
  className?: string;
}) {
  const Icon = needsVet ? AlertOctagon : HeartPulse;

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-card px-3 py-2 text-sm ring-1',
        needsVet ? `${HEALTH_META.RED.bg} ${HEALTH_META.RED.ring} ${HEALTH_META.RED.text}` : 'bg-space-700/40 ring-space-700 text-lo',
        className,
      )}
      role="status"
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">{needsVet ? '建议尽快线下就医' : '暂无需就医'}</p>
        <p className="mt-0.5 text-xs leading-relaxed opacity-80">
          {needsVet
            ? '请联系校兽医或当地动保组织，带上本次评估结果。'
            : '保持常规观察，出现变化随时来记一笔。'}
        </p>
      </div>
    </div>
  );
}
