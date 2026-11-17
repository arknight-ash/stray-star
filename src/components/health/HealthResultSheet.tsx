'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { BellRing, ImageOff, RotateCcw, X } from 'lucide-react';
import { ConfidenceBadge } from '@/components/star/ConfidenceBadge';
import { Disclaimer } from '@/components/star/Disclaimer';
import { StickerTag } from '@/components/star/StickerTag';
import { UncertainNote } from '@/components/capture/UncertainNote';
import { UNCERTAIN_NOTE, VISION_FALLBACK_NOTE } from '@/lib/constants';
import { HealthStatusBlock } from './HealthStatusBlock';
import { AdviceList } from './AdviceList';
import { NeedsVetCallout } from './NeedsVetCallout';
import type { HealthAssessData } from '@/lib/api/health-contract';

/**
 * 健康评估结果面板。
 *
 * 移动端从底部升起（拇指可达），桌面端居中弹卡 —— 与识别结果的抽屉同一套体感，
 * 避免学生在一个产品里学两种抽屉。
 *
 * 入场动效用全局的 dust-in（CSS 动画），因此自动继承 prefers-reduced-motion 降级：
 * 不要再包一层 Framer Motion，那套 JS 动画不吃 globals.css 里的降级规则。
 */
export function HealthResultSheet({
  data,
  open,
  onClose,
  onRetry,
  className,
}: {
  data: HealthAssessData | null;
  open: boolean;
  onClose: () => void;
  onRetry: () => void;
  className?: string;
}) {
  if (!data) return null;

  // 视觉链路挂掉后服务端退回「只看文字」时，degraded 里会留下这个前缀。
  // 展不展示不交给 UI 自行判断口径 —— 只认这一个标记（见 constants.VISION_FALLBACK_NOTE）。
  const assessedWithoutImage = data.degraded.some((d) => d.startsWith('visionUnavailable:'));

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-space-900/70 backdrop-blur-sm" />
        <Dialog.Content
          // 入场动画只做透明度（sheet-fade-in），不能用 dust-in：
          // dust-in 的 keyframes 会整条覆盖 transform，把 sm:-translate-x/y-1/2 的居中挤掉，
          // 桌面端会先错位再"跳"回中间。
          className={`sheet-fade-in fixed inset-x-0 bottom-0 z-40 max-h-[88vh] overflow-y-auto rounded-t-card bg-space-800 px-4 pb-8 pt-4 ring-1 ring-space-700 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:pb-6 ${className ?? ''}`}
          aria-describedby="health-result-body"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <Dialog.Title className="text-base font-medium text-hi">AI 健康初筛</Dialog.Title>
            <Dialog.Close className="rounded-btn p-1 text-lo hover:text-hi" aria-label="关闭">
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>

          <div id="health-result-body" className="space-y-3">
            <HealthStatusBlock level={data.healthStatus} severity={data.severity} />

            <ConfidenceBadge value={data.confidence} showBar size="sm" />

            {assessedWithoutImage && (
              // 这句必须显眼：不写清楚，用户会以为 AI 看过照片了 ——
              // 「看过图却漏判」和「没看图只能这么判」是两种完全不同的可信度。
              <div className="flex items-start gap-2 rounded-sticker bg-star-yellow/12 px-3 py-2 text-xs leading-relaxed text-star-yellow ring-1 ring-star-yellow/45">
                <ImageOff size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>{VISION_FALLBACK_NOTE}</span>
              </div>
            )}

            {data.uncertain && (
              // 一定要显式传文案：UncertainNote 的默认文案属于识别链路（"没能可靠判定物种"），
              // 服务端哪天没给 uncertainNote，健康面板就会冒出一句驴唇不对马嘴的话。
              <UncertainNote>{data.uncertainNote ?? UNCERTAIN_NOTE}</UncertainNote>
            )}

            <p className="text-sm leading-[1.7] text-hi">{data.assessment}</p>

            <NeedsVetCallout needsVet={data.needsVet} />

            {data.signals.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.signals.map((s, i) => (
                  <StickerTag key={s} tone="amber" rotate={(i % 3) - 1}>
                    {s}
                  </StickerTag>
                ))}
              </div>
            )}

            <AdviceList advice={data.advice} />

            {data.alert && (
              <div className="flex items-start gap-2 rounded-card bg-star-red/12 px-3 py-2 text-xs leading-relaxed text-star-red ring-1 ring-star-red/45">
                <BellRing size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  已同时向管理员发出 {data.alert.level === 'CRITICAL' ? '紧急' : '关注'}预警，
                  校内的同学会尽快去现场核实。
                </span>
              </div>
            )}

            {!data.persisted && (
              <p className="text-xs text-lo">
                这只是预览结果，没有写进它的档案 —— 从档案页发起评估才会归档。
              </p>
            )}

            {!data.uncertain && data.healthLevelChanged && (
              <p className="text-xs text-lo">
                档案健康等级已更新为{data.healthLevel === 'RED' ? '「预警」' : data.healthLevel === 'YELLOW' ? '「观察」' : '「健康」'}。
              </p>
            )}

            {data.uncertain && (
              <p className="text-xs text-lo">本次结果置信度偏低，未更新档案健康等级。</p>
            )}

            <Disclaimer variant="block" text={data.disclaimer} />

            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-btn border border-space-700 px-3 py-2 text-sm text-lo transition-colors duration-star ease-star hover:text-hi"
            >
              <RotateCcw size={14} aria-hidden />
              再评估一次
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
