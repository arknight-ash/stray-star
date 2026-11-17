'use client';

import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';
import { ALERT_META, HEALTH_META } from '@/lib/semantic';
import { StarDot } from '@/components/star/StarDot';
import type { MapPinVM } from '@/types/domain';

/**
 * 星点的档案摘要（阶段 7）。
 *
 * 为什么不再直接跳去档案页：在图上巡检时，大多数点击只是想"这颗星怎么了"。
 * 跳走一次要等整页加载，回来还得重新找位置 —— 摘要层先把答案给出来，
 * 真要翻手账再点「去看手账」。
 *
 * 与结果面板一样：只用 Radix Dialog + CSS 过渡（sheet-fade-in），
 * 不引 Framer Motion —— 结论比入场动画重要。
 */
export function StarSummarySheet({
  pin,
  onClose,
}: {
  pin: MapPinVM | null;
  onClose: () => void;
}) {
  if (!pin) return null;

  const health = HEALTH_META[pin.healthLevel];
  const alertMeta = pin.alertLevel ? ALERT_META[pin.alertLevel] : null;

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-space-900/70 backdrop-blur-sm" />
        <Dialog.Content
          className="sheet-fade-in fixed inset-x-0 bottom-0 z-40 max-h-[88vh] overflow-y-auto rounded-t-card bg-space-800 px-4 pb-8 pt-4 ring-1 ring-space-700 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:pb-6"
          aria-describedby="star-summary-body"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <Dialog.Title className="flex items-center gap-2 text-base font-medium text-hi">
              <StarDot
                level={pin.healthLevel}
                variant={pin.alertLevel ? 'alert' : 'idle'}
                shape="star"
                size={16}
              />✦ {pin.name} · {pin.code}
            </Dialog.Title>
            <Dialog.Close className="rounded-btn p-1 text-lo hover:text-hi" aria-label="关闭">
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>

          <div id="star-summary-body" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="data-mono rounded-sticker px-2 py-0.5" style={{ color: health.dot, boxShadow: `inset 0 0 0 1px ${health.dot}` }}>
                {health.starName}
              </span>
              {alertMeta && (
                <span
                  className="data-mono rounded-sticker px-2 py-0.5"
                  style={{ color: alertMeta.dot, boxShadow: `inset 0 0 0 1px ${alertMeta.dot}` }}
                >
                  未处理 · {alertMeta.label}预警
                </span>
              )}
            </div>

            {pin.alertReason && (
              <p className="rounded-btn bg-space-900/60 p-2 text-sm leading-relaxed text-hi">
                {pin.alertReason}
              </p>
            )}

            <div>
              <p className="text-[11px] text-lo">最近一条记录</p>
              <p className="mt-1 text-sm leading-[1.7] text-hi">
                {pin.latestNote ?? '这颗星还没有被记录 —— 拍下第一张，或给它写一句。'}
              </p>
            </div>

            {pin.latestReport && (
              <div>
                <p className="text-[11px] text-lo">最近一次 AI 初筛</p>
                <p className="mt-1 text-sm leading-[1.7] text-hi">{pin.latestReport.assessment}</p>
              </div>
            )}

            <Link
              href={`/animals/${pin.code}`}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-btn bg-accent-400 px-4 text-sm font-medium text-space-900"
            >
              去看手账
              <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
