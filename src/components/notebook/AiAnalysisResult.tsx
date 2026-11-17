'use client';

import { Check, RotateCcw, Sparkles } from 'lucide-react';
import { CONFIDENCE_FLOOR } from '@/lib/constants';
import {
  ENTITY_KIND_META,
  OBS_TYPE_META,
  SENTIMENT_META,
  SEVERITY_META,
} from '@/lib/semantic';
import { cn } from '@/lib/utils';
import type { ObservationData } from '@/lib/api/observation-contract';

/**
 * 「AI 解析中」状态 —— 提交后到结果返回之间必须有这一段。
 *
 * 为什么不是一句静态的"提交中"：这条链路上真正发生的事是模型在读这句话、
 * 看这张图、判断类型与严重度。界面要把这件事说出来，用户才知道
 * 「分类和紧急程度不是我选的，是它判的」。
 *
 * 文案按 step 轮播而不是绑死后端阶段：服务端只有一次请求，
 * 但前端可以用"读文字 → 看图 → 判断 → 归档"四步表达它内部真的做了什么。
 */
export function AiAnalyzing({ withPhoto, step }: { withPhoto: boolean; step: number }) {
  const steps = withPhoto
    ? ['正在读这句话…', '正在看照片里的细节…', '正在判断类型与严重程度…', '正在写进档案…']
    : ['正在读这句话…', '正在判断类型与严重程度…', '正在抽取标签…', '正在写进档案…'];
  const index = Math.min(Math.max(step, 0), steps.length - 1);

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-card bg-space-800/70 p-3 ring-1 ring-accent-400/30"
    >
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="animate-pulse text-accent-300" aria-hidden />
        <span className="text-sm font-medium text-hi">AI 正在解析这条记录</span>
      </div>
      <p className="mt-1 text-[11px] text-lo">{steps[index]}</p>

      {/* 四格进度：每格对应一句提示，走到第几步一眼可见 */}
      <div className="mt-2 flex gap-1" aria-hidden>
        {steps.map((s, i) => (
          <span
            key={s}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-star ease-star',
              i <= index ? 'bg-accent-400' : 'bg-space-700',
            )}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-lo">
        分类、标签与严重程度由 AI 判定，你不需要自己选。
      </p>
    </div>
  );
}

/**
 * 解析结果的展示卡：AI 抽出的标签组 + 分类 / 严重度 / 情感 / 实体。
 *
 * 这是「AI 结论必须驱动 UI」的可见证据（CLAUDE.md ★2）：
 * 用户提交完不该只看到一句"已提交"，而要看到系统到底读懂了什么。
 * 标签用 # 前缀，是因为手账语境里标签就是贴纸 —— 与便签墙上的呈现一致。
 */
export function AiAnalysisResult({
  data,
  animalName,
  onDone,
  onAgain,
}: {
  data: ObservationData;
  animalName: string;
  onDone: () => void;
  onAgain?: () => void;
}) {
  const { analysis } = data;
  const typeMeta = OBS_TYPE_META[analysis.type];
  const severityMeta = SEVERITY_META[analysis.severity];
  const sentimentMeta = SENTIMENT_META[analysis.sentiment];
  const lowConfidence = analysis.source === 'ai' && analysis.confidence < CONFIDENCE_FLOOR;

  return (
    <section aria-label="AI 解析结果" className="space-y-2">
      <div className="flex items-start gap-2">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-star-green/15 text-star-green"
          aria-hidden
        >
          <Check size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-hi">AI 已为你归档</p>
          <p className="text-[11px] text-lo">
            已贴到 <span className="text-hi">{animalName}</span> 的档案 · {typeMeta.label}记录
          </p>
        </div>
      </div>

      {/* AI 提取的标签组：这一块是用户要求"看得见的 AI 产出" */}
      <div>
        <p className="text-[11px] text-lo">AI 提取的标签</p>
        <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="AI 提取的标签">
          {analysis.tags.map((tag) => (
            <li key={tag}>
              <span className="inline-flex items-center rounded-full bg-accent-500/20 px-2.5 py-1 text-xs text-accent-200 ring-1 ring-accent-400/40">
                #{tag}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={severityMeta.level === 'CRITICAL' ? 'red' : severityMeta.level === 'WARN' ? 'yellow' : 'green'}>
          严重程度 · {severityMeta.label}
        </Chip>
        <Chip tone={sentimentMeta.tone}>{sentimentMeta.label}</Chip>
        {analysis.withImage && <Chip tone="paper">已结合照片</Chip>}
        {analysis.visionAttempted && !analysis.withImage && <Chip tone="paper">照片没看清，仅按文字</Chip>}
      </div>

      {analysis.summary && (
        <p className="text-[11px] text-lo">
          AI 读到的：<span className="text-hi">{analysis.summary}</span>
        </p>
      )}

      {analysis.entities.length > 0 && (
        <p className="text-[11px] text-lo">
          识别到：
          {analysis.entities
            .map((e) => `${e.text}（${ENTITY_KIND_META[e.kind] ?? '实体'}）`)
            .join('、')}
        </p>
      )}

      {analysis.source === 'fallback' && (
        <p className="text-[11px] text-star-yellow">
          AI 这次没读懂这条记录，已按原文归档，管理员会人工核实。
        </p>
      )}
      {lowConfidence && (
        <p className="text-[11px] text-star-yellow">AI 对这次分类不太确定，管理员会复核。</p>
      )}
      {data.notice && <p className="text-[11px] text-star-red">{data.notice}</p>}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onDone}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full px-4 text-sm font-medium text-hi"
          style={{ backgroundImage: 'var(--grad-cta)' }}
        >
          完成
        </button>
        {onAgain && (
          <button
            type="button"
            onClick={onAgain}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full bg-space-800 px-4 text-sm text-hi ring-1 ring-space-700"
          >
            <RotateCcw size={14} aria-hidden />
            再记一笔
          </button>
        )}
      </div>
    </section>
  );
}

const CHIP_TONE = {
  green: 'bg-star-green/15 text-star-green ring-star-green/40',
  yellow: 'bg-star-yellow/15 text-star-yellow ring-star-yellow/40',
  red: 'bg-star-red/15 text-star-red ring-star-red/40',
  paper: 'bg-space-800 text-lo ring-space-700',
} as const;

function Chip({
  children,
  tone = 'paper',
}: {
  children: React.ReactNode;
  tone?: keyof typeof CHIP_TONE;
}) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ring-1', CHIP_TONE[tone])}>
      {children}
    </span>
  );
}
