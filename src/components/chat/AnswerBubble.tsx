'use client';

import type { ReactNode } from 'react';
import { CitationMark } from './CitationMark';
import { UncertainNote } from '@/components/capture/UncertainNote';
import { Disclaimer } from '@/components/star/Disclaimer';
import type { Citation } from '@/lib/rag/citations';

/** 正文里的引用记号：[1] [2] */
const MARK_RE = /\[(\d+)\]/g;

/**
 * 把答案正文里的 [n] 换成星图标注。
 *
 * 答案里一个 [n] 都没有时**不硬塞标注**：模型没写引用号，
 * 说明它没打算指向某条来源，此时只在下方列出来源清单，避免编造对应关系。
 */
function renderWithMarks(answer: string, citations: Citation[]): ReactNode[] {
  const bySeq = new Map(citations.map((c) => [c.seq, c]));
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of answer.matchAll(MARK_RE)) {
    const at = match.index ?? 0;
    if (at > last) out.push(answer.slice(last, at));

    const seq = Number(match[1]);
    const citation = bySeq.get(seq);
    out.push(citation ? <CitationMark key={`c${key++}`} citation={citation} /> : match[0]);
    last = at + match[0].length;
  }

  if (last < answer.length) out.push(answer.slice(last));
  return out;
}

export function AnswerBubble({
  answer,
  citations,
  uncertain,
  uncertainNote,
  disclaimer,
  fallback,
  animalHref,
}: {
  answer: string;
  citations: Citation[];
  uncertain: boolean;
  uncertainNote?: string;
  disclaimer: string;
  fallback: string | null;
  /** 走了「档案里没有这条记录」时给的落点 */
  animalHref?: string | null;
}) {
  const body = renderWithMarks(answer, citations);
  const hasMarks = citations.length > 0;

  return (
    <div className="rounded-card bg-space-800/80 px-4 py-3 ring-1 ring-space-700">
      <p className="text-sm leading-[1.75] text-hi">{body}</p>

      {uncertain && (
        <div className="mt-3">
          <UncertainNote tone="unknown">{uncertainNote ?? 'AI 不确定，建议人工确认'}</UncertainNote>
        </div>
      )}

      {/* 来源清单：即便正文没有 [n]，也要让用户知道答案是从哪来的 */}
      {hasMarks && (
        <div className="mt-3 border-t border-space-700 pt-2">
          <p className="mb-1.5 text-[11px] text-lo">来源</p>
          <ul className="flex flex-wrap gap-1.5">
            {citations.map((c) => (
              <li key={`${c.kind}-${c.seq}`}>
                <CitationMark citation={c} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {fallback === 'no_animal_record' && animalHref && (
        <a
          href={`${animalHref}#record`}
          className="mt-3 inline-flex min-h-[36px] items-center rounded-btn bg-accent-400 px-3 text-xs font-medium text-space-900"
        >
          去记录一笔
        </a>
      )}

      <div className="mt-3">
        <Disclaimer text={disclaimer} />
      </div>
    </div>
  );
}
