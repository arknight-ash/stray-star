'use client';

import Link from 'next/link';
import { Loader2, RefreshCw } from 'lucide-react';
import { NoteField } from './NoteField';
import type { IdentifyData } from '@/lib/api/identify-contract';
import { UncertainNote } from './UncertainNote';
import { StarDot } from '@/components/star/StarDot';
import { CodePlate } from '@/components/star/CodePlate';

/**
 * 灰区：有一定线索但不足以确认。
 * 出口有三：认领某个候选 / 补充描述后重跑 / 我就是新的（转建档）。
 * 补充描述走「复用已上传照片」，不二次传图。
 */
export function CandidatePanel({
  data,
  note,
  onNoteChange,
  onRerun,
  onCreateNew,
  rerunning,
}: {
  data: Extract<IdentifyData, { matched: false }>;
  note: string;
  onNoteChange: (next: string) => void;
  onRerun: (note: string) => void;
  onCreateNew: () => void;
  rerunning: boolean;
}) {
  const candidates = data.candidates;

  return (
    <div className="space-y-4">
      <UncertainNote />

      {candidates.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-lo">这颗星有些模糊，可能是：</p>
          <ul className="space-y-2">
            {candidates.map((c, i) => (
              <li
                key={c.animalId}
                className="animate-dust-in"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <Link
                  href={`/animals/${c.code}`}
                  className="star-card star-card-interactive flex items-center gap-3 p-3"
                >
                  <StarDot level="GREEN" size={10} variant="idle" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <CodePlate code={c.code} tone="muted" />
                      <span className="truncate text-sm text-hi">{c.name}</span>
                    </div>
                    <p className="data-mono mt-0.5 text-xs text-lo">
                      相似度 {Math.round(c.score * 100)}%
                      {c.pendingReview && ' · 待核实'}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <NoteField
        value={note}
        onChange={onNoteChange}
        rows={2}
        label="再描述得具体一点，我再认一次"
        placeholder="毛色、耳朵缺口、尾巴特征、常出现的位置…"
        disabled={rerunning}
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onRerun(note)}
          disabled={rerunning || note.trim().length < 4}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-btn bg-accent-400/20 px-4 text-sm text-accent-300 ring-1 ring-accent-400/40 transition-colors duration-star ease-star hover:bg-accent-400/30 disabled:opacity-40"
        >
          {rerunning ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />}
          {rerunning ? '重新比对中…' : '用这句再认一次'}
        </button>
        <button
          type="button"
          onClick={onCreateNew}
          disabled={rerunning}
          className="inline-flex min-h-[44px] items-center justify-center rounded-btn bg-space-800 px-4 text-sm text-lo ring-1 ring-space-700 transition-colors duration-star ease-star hover:text-hi disabled:opacity-40"
        >
          都不是，是新星
        </button>
      </div>

      {note.trim().length > 0 && note.trim().length < 4 && (
        <p className="text-xs text-lo">再多写几个字，至少 {4 - note.trim().length} 个。</p>
      )}
    </div>
  );
}
