'use client';

import Link from 'next/link';
import { Camera, NotebookPen, Sparkles } from 'lucide-react';
import { StarCard } from '@/components/star/StarCard';
import { StarDot } from '@/components/star/StarDot';
import { CodePlate } from '@/components/star/CodePlate';
import { HealthChip } from '@/components/star/HealthChip';
import { ConfidenceBadge } from '@/components/star/ConfidenceBadge';
import { Disclaimer } from '@/components/star/Disclaimer';
import type { AnimalSummary } from '@/lib/api/identify-contract';
import { HEALTH_META } from '@/lib/semantic';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * 命中态：星点点亮 → 星卡弹出。
 * 即便命中也必须带 Disclaimer —— 不能让用户以为 AI 的识别结论就是板上钉钉的事实。
 */
export function MatchedPanel({
  animal,
  confidence,
  features,
  pendingReview,
  onRescan,
}: {
  animal: AnimalSummary;
  confidence: number;
  features: string[];
  pendingReview: boolean;
  onRescan: () => void;
}) {
  const reduced = useReducedMotion();
  const meta = HEALTH_META[animal.healthLevel];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span
          className={reduced ? '' : 'animate-star-burst'}
          style={{ display: 'inline-flex' }}
        >
          <StarDot level={animal.healthLevel} size={14} variant="alert" />
        </span>
        <div>
          <p className="font-display text-base text-accent-300">认出来了 {meta.starName}</p>
          <p className="text-xs text-lo">它在星图里已经有了自己的位置</p>
        </div>
      </div>

      <StarCard animal={{ ...animal, lastSeenAt: animal.lastSeenAt ?? null }} variant="hero" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <CodePlate code={animal.code} />
        <HealthChip level={animal.healthLevel} size="sm" />
        <ConfidenceBadge value={confidence} size="sm" showBar />
      </div>

      {features.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-xs text-lo">
            <Sparkles size={12} aria-hidden />
            AI 从照片里读到
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {features.map((f) => (
              <li
                key={f}
                className="rounded-sticker bg-space-700/60 px-2 py-0.5 text-xs text-hi ring-1 ring-space-700"
              >
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pendingReview && (
        <p className="rounded-sticker bg-star-yellow/12 px-3 py-2 text-xs text-star-yellow ring-1 ring-star-yellow/45">
          这颗星刚刚由匿名同学点亮，正等待管理员核实，暂时不会进入正式图鉴的高置信点位。
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/animals/${animal.code}`}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-btn bg-accent-400/20 px-4 text-sm text-accent-300 ring-1 ring-accent-400/40 transition-colors duration-star ease-star hover:bg-accent-400/30"
        >
          看看 TA 的档案
        </Link>
        <Link
          href={`/report?animal=${animal.code}`}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-btn bg-space-700/60 px-4 text-sm text-hi ring-1 ring-space-700 transition-colors duration-star ease-star hover:border-accent-400/40"
        >
          <NotebookPen size={15} aria-hidden />
          记录一次
        </Link>
        <button
          type="button"
          onClick={onRescan}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-btn bg-space-800 px-4 text-sm text-lo ring-1 ring-space-700 transition-colors duration-star ease-star hover:text-hi"
        >
          <Camera size={15} aria-hidden />
          再拍一张
        </button>
      </div>

      <Disclaimer text="识别结论由模型生成，可能出错。如与实物不符，请通过「记录一次」补充说明或联系管理员更正。" />
    </div>
  );
}
