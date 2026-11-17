'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { ConfidenceBadge } from '@/components/star/ConfidenceBadge';
import { Disclaimer } from '@/components/star/Disclaimer';
import { HealthStatusBlock } from './HealthStatusBlock';
import { NeedsVetCallout } from './NeedsVetCallout';
import { AdviceList } from './AdviceList';
import type { HealthLevel, Severity } from '@/types/domain';

/**
 * 档案页上的「最近一次 AI 初筛」。
 *
 * 默认折叠成一行的原因是克制的：评估结论可能已经过期（它是某一时刻的照片），
 * 展开才看到细节，能避免把「三天前那张照片的结论」当成它今天的状况。
 * 展开后复用的仍是服务端算好的字段，这里不做任何判断。
 */

export interface LatestHealthVM {
  assessment: string;
  healthStatus: HealthLevel;
  severity: Severity;
  needsVet: boolean;
  advice: string[];
  confidence: number;
  disclaimer: string;
  createdAt: string;
}

export function LatestHealthCard({ report }: { report: LatestHealthVM }) {
  const [open, setOpen] = useState(false);
  const at = new Date(report.createdAt);

  return (
    <section
      className="glass-card p-4"
      aria-label="最近一次 AI 初筛"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-sm font-medium text-hi">最近一次 AI 初筛</span>
        <span className="flex items-center gap-2">
          <span className="data-mono text-xs text-lo">
            {at.getMonth() + 1}/{at.getDate()}
          </span>
          <ChevronRight
            size={16}
            aria-hidden
            className={`text-lo transition-transform duration-star ease-star ${open ? 'rotate-90' : ''}`}
          />
        </span>
      </button>

      {!open && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-3">
            <ConfidenceBadge value={report.confidence} size="sm" />
            <span className="text-xs text-lo">
              {report.needsVet ? '建议尽快就医' : '暂无需就医'}
            </span>
          </div>
          {/* 折叠态也要带免责：这一行已经在说「要不要就医」了，是结论，不是摘要 */}
          <Disclaimer text={report.disclaimer} />
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          <HealthStatusBlock level={report.healthStatus} severity={report.severity} />
          <ConfidenceBadge value={report.confidence} showBar size="sm" />
          <p className="text-sm leading-[1.7] text-hi">{report.assessment}</p>
          <NeedsVetCallout needsVet={report.needsVet} />
          <AdviceList advice={report.advice} />
          <Disclaimer variant="block" text={report.disclaimer} />
        </div>
      )}
    </section>
  );
}
