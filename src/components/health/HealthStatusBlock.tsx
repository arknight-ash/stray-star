import { HEALTH_META } from '@/lib/semantic';
import type { HealthLevel, Severity } from '@/types/domain';
import { cn } from '@/lib/utils';

/**
 * 健康状态色块：结论的第一眼。
 *
 * 三条不可商量的规矩：
 *  1. 颜色取 semantic.ts 的 HEALTH_META，不许在这里写十六进制（令牌单一事实源）；
 *  2. 颜色之外必须同屏给出文字 —— 色盲用户靠文字，所有人靠文字确认自己没看错；
 *  3. 光谱条只标当前档，其余两格降透明度，而不是隐藏 —— 图例的作用是把读数的尺子给人。
 */

const ORDER: HealthLevel[] = ['GREEN', 'YELLOW', 'RED'];

const SEVERITY_LABEL: Record<Severity, string> = {
  MILD: '暂未见异常',
  MODERATE: '中度异常',
  SEVERE: '重度异常',
};

export function HealthStatusBlock({
  level,
  severity,
  className,
}: {
  level: HealthLevel;
  severity: Severity;
  className?: string;
}) {
  const meta = HEALTH_META[level];

  return (
    <div className={cn('w-full', className)}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-sticker bg-space-700"
        role="img"
        aria-label={`AI 判定：${meta.label}`}
      >
        {ORDER.map((lv) => (
          <div
            key={lv}
            className="h-full flex-1"
            // 色值走 semantic.ts 的 CSS 变量字符串，不在这里写十六进制
            style={{ background: HEALTH_META[lv].dot, opacity: lv === level ? 1 : 0.22 }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn('text-base font-medium', meta.text)}>{meta.label}</span>
        <span className="text-xs text-lo">· {SEVERITY_LABEL[severity]}</span>
      </div>
    </div>
  );
}
