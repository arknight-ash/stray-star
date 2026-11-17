'use client';

import { Loader2, MapPin, Sparkles } from 'lucide-react';
import { UncertainNote } from './UncertainNote';
import { LIMITS } from '@/lib/constants';
import type { IdentifyData } from '@/lib/api/identify-contract';
import type { AnimalForm } from '@/hooks/useIdentifyMachine';
import { SPECIES_META } from '@/lib/semantic';
import { cn } from '@/lib/utils';

/**
 * 未登记星：引导点亮建档。
 *
 * 重要约束：匿名建档写入后是 pendingReview=true 的待审核档案，
 * 这一点在提交前就必须说清楚，而不是提交完才告知。
 */
export function NewStarPanel({
  data,
  form,
  submitting,
  center,
  onUpdateForm,
  onSubmit,
}: {
  data: IdentifyData | null;
  form: AnimalForm;
  submitting: boolean;
  center: { lat: number; lng: number };
  onUpdateForm: (patch: Partial<AnimalForm>) => void;
  onSubmit: () => void;
}) {
  const unmatched = data && !data.matched ? data : null;
  const unknownSpecies = unmatched?.suggestedSpecies === 'UNKNOWN';
  const nameValid = form.name.trim().length > 0 && form.name.length <= LIMITS.name;
  const canSubmit = nameValid && !submitting;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <div className="flex items-start gap-2 rounded-sticker bg-space-700/50 px-3 py-2 ring-1 ring-space-700">
        <Sparkles size={14} className="mt-0.5 shrink-0 text-accent-300" aria-hidden />
        <div className="text-xs text-hi">
          <p className="font-medium text-accent-300">这是一颗未登记的星</p>
          <p className="mt-0.5 text-lo">
            给它一个名字和几句描述，就能被点亮。之后同学们再拍到它，就能自动认出来了。
          </p>
        </div>
      </div>

      {unknownSpecies && <UncertainNote tone="unknown" />}

      <div className="space-y-1">
        <label className="text-xs text-lo" htmlFor="new-name">
          名字 <span className="text-star-red">*</span>
        </label>
        <input
          id="new-name"
          value={form.name}
          maxLength={LIMITS.name}
          disabled={submitting}
          onChange={(e) => onUpdateForm({ name: e.target.value })}
          placeholder="比如：煤球 / 李园食堂的长毛橘"
          className="w-full rounded-btn border border-space-700 bg-space-800 px-3 py-2 text-sm text-hi placeholder:text-lo/70 focus:border-accent-400/60 focus:outline-none"
        />
      </div>

      <fieldset className="space-y-1" disabled={submitting}>
        <legend className="text-xs text-lo">物种</legend>
        <div className="flex gap-2">
          {(['CAT', 'DOG', 'UNKNOWN'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onUpdateForm({ species: s })}
              className={cn(
                'min-h-[44px] flex-1 rounded-btn px-3 text-sm ring-1 transition-colors duration-star ease-star',
                form.species === s
                  ? 'bg-accent-400/20 text-accent-300 ring-accent-400/40'
                  : 'bg-space-800 text-lo ring-space-700 hover:text-hi',
              )}
            >
              {s === 'UNKNOWN' ? '看不出来' : SPECIES_META[s === 'CAT' ? 'CAT' : 'DOG'].label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label className="text-xs text-lo" htmlFor="new-summary">
          一句话状态（选填）
        </label>
        <input
          id="new-summary"
          value={form.summary}
          maxLength={LIMITS.summary}
          disabled={submitting}
          onChange={(e) => onUpdateForm({ summary: e.target.value })}
          placeholder="近期食欲下降，需要观察"
          className="w-full rounded-btn border border-space-700 bg-space-800 px-3 py-2 text-sm text-hi placeholder:text-lo/70 focus:border-accent-400/60 focus:outline-none"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-lo" htmlFor="new-features">
          外观特征（选填，用逗号分隔，最多 {LIMITS.featureCount} 条）
        </label>
        <textarea
          id="new-features"
          rows={2}
          value={form.features}
          disabled={submitting}
          onChange={(e) => onUpdateForm({ features: e.target.value })}
          placeholder="黑色短毛，左耳有缺口，尾巴尖白毛"
          className="w-full resize-none rounded-btn border border-space-700 bg-space-800 px-3 py-2 text-sm text-hi placeholder:text-lo/70 focus:border-accent-400/60 focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-2 text-xs text-lo">
        <MapPin size={13} aria-hidden />
        {form.lat != null && form.lng != null ? (
          <button
            type="button"
            onClick={() => onUpdateForm({ lat: null, lng: null })}
            className="rounded-sticker bg-space-700/60 px-2 py-0.5 ring-1 ring-space-700"
          >
            记录拍摄位置（不打印精确坐标）· 点此取消
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onUpdateForm({ lat: center.lat, lng: center.lng })}
            className="rounded-sticker bg-space-700/60 px-2 py-0.5 ring-1 ring-space-700"
          >
            使用校园中心作为大致位置（可在地图上微调）
          </button>
        )}
      </div>

      <p className="rounded-sticker bg-star-yellow/12 px-3 py-2 text-xs leading-relaxed text-star-yellow ring-1 ring-star-yellow/45">
        匿名提交的档案会先进入「待核实」状态，管理员确认后才会成为正式档案。这也是为了防止误登记或重复登记。
      </p>

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-btn px-4 text-sm font-medium text-hi shadow-glow transition-colors duration-star ease-star disabled:opacity-40"
        style={{ backgroundImage: 'var(--grad-cta)' }}
      >
        {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
        {submitting ? '正在点亮…' : '点亮这颗星'}
      </button>
    </form>
  );
}
