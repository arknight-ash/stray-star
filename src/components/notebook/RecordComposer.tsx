'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Camera,
  ChevronRight,
  Crosshair,
  MapPin,
  NotebookPen,
  PenLine,
  Save,
  Upload,
  X,
} from 'lucide-react';
import { LIMITS } from '@/lib/constants';
import { SPECIES_META } from '@/lib/semantic';
import { formatAccuracy } from '@/lib/use-geolocation';
import { AiAnalysisResult, AiAnalyzing } from './AiAnalysisResult';
import { useRecordDraft } from './useRecordDraft';
import type { HealthLevel, Species } from '@/types/domain';

/** 选星列表需要的字段：够认出一只动物，不多带 */
export interface RecordOptionVM {
  code: string;
  name: string;
  species: Species;
  healthLevel: HealthLevel;
  avatarUrl: string | null;
}

/**
 * /report 的整页记录表单。
 *
 * 视觉对齐设计稿（2026-10-26）：顶部「选择动物」卡片行 → 正文（0/500 计数）
 * → 横向上传框 → 渐变「提交记录」。
 *
 * 2026-10-28 改造：**删掉了「记录内容」的四个分类标签页与「情况紧急」勾选框。**
 * 分类与严重程度都是 AI 的判断（`lib/observations/analyze.ts` 的多模态解析），
 * 让人手选一遍等于让 AI 白干，还会出现"人选的"和"模型判的"两套结论打架。
 * 现在提交后进入解析中 → 结果卡展示 AI 提取的标签组与判定依据。
 *
 * 选星从下拉改成头像行列表，点击即选中；已选后点行可返回重选。
 * 提交行为不在本文件：`useRecordDraft` 是它与移动端底部记录条共用的唯一状态机，
 * 「存草稿」的持久化逻辑也在那里（localStorage，按星号分键）。
 */
export function RecordComposer({
  options,
  initialCode,
}: {
  options: RecordOptionVM[];
  /** URL 上带过来的动物编号；库里没有这张时就当没带 */
  initialCode?: string;
}) {
  const [code, setCode] = useState<string | null>(initialCode ?? null);

  const selected = options.find((o) => o.code === code) ?? null;

  // 结果卡片直接消费 draft.result，不需要额外的 onAdded 状态
  const draft = useRecordDraft({ animalCode: selected?.code ?? '' });

  if (options.length === 0) {
    return (
      <section className="glass-card p-6 text-center">
        <p className="text-sm text-hi opacity-80">
          星图上还没有被点亮的星星，先拍一张照片，让第一颗星亮起来。
        </p>
        <Link
          href="/scan"
          className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-5 text-sm font-medium text-hi"
          style={{ backgroundImage: 'var(--grad-cta)' }}
        >
          <Camera size={15} aria-hidden />
          去拍摄
        </Link>
      </section>
    );
  }

  // 提交中：整页切到解析状态，别让用户对着一个灰掉的按钮猜发生了什么
  if (selected && draft.phase === 'analyzing' && !draft.result) {
    return (
      <section className="glass-card p-5 sm:p-6">
        <AiAnalyzing withPhoto={Boolean(draft.photo)} step={draft.analyzeStep} />
      </section>
    );
  }

  if (selected && draft.result) {
    return (
      <section className="space-y-3 glass-card p-5">
        <AiAnalysisResult
          data={draft.result}
          animalName={selected.name}
          onDone={draft.dismissResult}
          onAgain={draft.reset}
        />

        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href={`/animals/${selected.code}`}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full px-4 text-sm font-medium text-hi ring-1 ring-space-700"
          >
            看看 TA 的档案
          </Link>
          <Link
            href="/animals"
            className="inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-sm text-lo ring-1 ring-space-700 transition-opacity duration-star ease-star hover:opacity-100"
          >
            回图鉴
          </Link>
        </div>
      </section>
    );
  }

  /* ── 第一步：选择动物（设计稿的「选择绵角」卡片行形态）── */
  if (!selected) {
    return (
      <section className="glass-card p-5 sm:p-6">
        <h1 className="font-display text-lg text-hi">选择动物</h1>
        <p className="mt-1 text-xs text-lo">
          认不出是哪只也没关系 —— 先拍照让 AI 认一认，认出来再回来补这句话。
        </p>

        <ul className="mt-4 space-y-2">
          {options.map((o) => (
            <li key={o.code}>
              <button
                type="button"
                onClick={() => setCode(o.code)}
                className="flex min-h-[60px] w-full items-center gap-3 rounded-card bg-space-800/60 px-3 text-left ring-1 ring-space-700/70 transition-colors duration-star ease-star hover:ring-accent-400/60"
              >
                {o.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={o.avatarUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-btn object-cover ring-1 ring-space-700"
                  />
                ) : (
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-btn bg-space-700/60 text-hi"
                    aria-hidden
                  >
                    {SPECIES_META[o.species].glyph}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-hi">{o.name}</span>
                  <span className="data-mono block text-[11px] text-lo">
                    #{o.code} · {SPECIES_META[o.species].label}
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-lo" aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        <Link
          href="/scan"
          className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 text-xs text-lo underline underline-offset-2 hover:opacity-100"
        >
          <Camera size={13} aria-hidden />
          还没出现在列表里？去拍一张点亮它
        </Link>
      </section>
    );
  }

  /* ── 第二步：写记录 ── */
  return (
    <section className="glass-card p-5 sm:p-6">
      {/* 选择动物：卡片行，点击可返回重选 */}
      <section aria-label="选择动物">
        <h2 className="flex items-center gap-1.5 text-xs font-medium text-hi">
          <span aria-hidden>✦</span> 选择动物
        </h2>
        <button
          type="button"
          onClick={() => {
            draft.reset();
            setCode(null);
          }}
          aria-label="更换要记录的动物"
          className="mt-2 flex min-h-[60px] w-full items-center gap-3 rounded-card bg-space-800/60 px-3 text-left ring-1 ring-space-700/70 transition-colors duration-star ease-star hover:ring-accent-400/60"
        >
          {selected.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selected.avatarUrl}
              alt=""
              className="h-10 w-10 shrink-0 rounded-btn object-cover ring-1 ring-space-700"
            />
          ) : (
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-btn bg-space-700/60 text-hi"
              aria-hidden
            >
              {SPECIES_META[selected.species].glyph}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-hi">{selected.name}</span>
            <span className="data-mono block text-[11px] text-lo">#{selected.code}</span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-lo" aria-hidden />
        </button>
      </section>

      {/* 记录内容：只写现场。分类/严重度不再由人选 */}
      <section aria-label="记录内容" className="mt-5">
        <h2 className="flex items-center gap-1.5 text-xs font-medium text-hi">
          <span aria-hidden>✦</span> 记录内容
        </h2>
        <p className="mt-1 text-[11px] text-lo">
          写你看到的事实即可 —— 是健康问题、投喂还是行为，以及有多紧急，由 AI 判断。
        </p>

        <label className="mt-3 block">
          <span className="sr-only">记录内容</span>
          <textarea
            value={draft.content}
            onChange={(e) => draft.setContent(e.target.value.slice(0, LIMITS.observation))}
            placeholder="例如：它右后腿好像不太敢着地，叫它也不怎么理人"
            rows={5}
            className="w-full resize-y rounded-btn bg-space-900/70 px-3 py-2 text-sm text-hi ring-1 ring-space-700 outline-none placeholder:text-lo focus-visible:ring-2 focus-visible:ring-accent-400"
          />
          <span className="mt-1 block text-right text-[11px] text-lo" aria-hidden>
            {draft.content.length}/{LIMITS.observation}
          </span>
        </label>
      </section>

      {/* 上传照片（可选）：横向上传框 */}
      <section aria-label="上传照片" className="mt-2">
        <h2 className="flex items-center gap-1.5 text-xs font-medium text-hi">
          <span aria-hidden>✦</span> 上传照片<span className="font-normal text-lo">（可选，AI 会一起看）</span>
        </h2>
        <input
          ref={draft.fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => void draft.pickPhoto(e.target.files?.[0])}
        />
        {draft.photo ? (
          <div className="relative mt-2 flex items-center gap-3 rounded-card bg-space-900/70 p-2 ring-1 ring-space-700">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={draft.photo.previewUrl}
              alt="即将提交的照片预览"
              className="h-16 w-16 rounded-btn object-cover ring-1 ring-space-700"
            />
            <p className="min-w-0 flex-1 text-xs text-lo">
              {draft.photo.degraded ? '已使用原图（本次未能压缩）' : '已压缩，会一起交给 AI 判断'}
            </p>
            <button
              type="button"
              onClick={draft.clearPhoto}
              aria-label="移除照片"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-space-800 text-hi ring-1 ring-space-700"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => draft.fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void draft.pickPhoto(e.dataTransfer.files?.[0]);
            }}
            disabled={draft.compressing || draft.busy}
            aria-label="添加照片（选填，点击或拖拽）"
            aria-busy={draft.compressing}
            className="mt-2 flex min-h-[88px] w-full items-center justify-center gap-3 rounded-card border border-dashed border-space-700 bg-space-900/50 text-hi opacity-80 transition-colors duration-star ease-star hover:border-accent-400 hover:opacity-100 disabled:opacity-40"
          >
            <span className="flex items-center gap-3 text-xs">
              {draft.compressing ? (
                '正在压缩照片…'
              ) : (
                <>
                  <Upload size={22} strokeWidth={1.5} aria-hidden />
                  点击上传或拖拽图片
                </>
              )}
            </span>
          </button>
        )}
      </section>

      {/* 位置（可选）：手机定位。
          用户要的是「记一笔 + 星图上的点跟着动」，而说到位置最省事的方式是
          「我现在就在它旁边」—— 让人手打「图书馆」反而多一步。
          取不到就退回说地点名（星枢那边认白名单），所以这里失败不挡提交。 */}
      <section aria-label="记录位置" className="mt-4">
        <h2 className="flex items-center gap-1.5 text-xs font-medium text-hi">
          <span aria-hidden>✦</span> 记录位置
          <span className="font-normal text-lo">（可选，会让星图上这颗点挪过来）</span>
        </h2>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void draft.geo.locate()}
            disabled={draft.geo.locating || draft.busy}
            aria-busy={draft.geo.locating}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-space-800 px-3.5 text-xs text-hi ring-1 ring-space-700 transition-colors duration-star ease-star hover:ring-accent-400/60 disabled:opacity-50"
          >
            <Crosshair size={13} aria-hidden className={draft.geo.locating ? 'animate-spin' : ''} />
            {draft.geo.locating
              ? '正在定位…'
              : draft.geo.ready
                ? '重新定位'
                : '用当前位置'}
          </button>

          {draft.geo.ready && draft.geo.fix && (
            <>
              <span className="inline-flex min-h-[30px] items-center gap-1 rounded-sticker bg-space-800/80 px-2.5 text-[11px] text-hi ring-1 ring-accent-400/40">
                <MapPin size={11} aria-hidden />
                已定位
                {formatAccuracy(draft.geo.fix.accuracyM)
                  ? ` · 精度 ${formatAccuracy(draft.geo.fix.accuracyM)}`
                  : ''}
              </span>
              <button
                type="button"
                onClick={draft.geo.clear}
                className="min-h-[30px] rounded-sticker px-2 text-[11px] text-lo underline-offset-2 transition-colors duration-star ease-star hover:text-hi hover:underline"
              >
                不带位置
              </button>
            </>
          )}
        </div>

        {draft.geo.ready && (
          <p className="mt-1.5 text-[11px] text-lo">
            保存后这条记录会带上你此刻的位置，星图上这颗点也会挪过来。
          </p>
        )}
        {draft.geo.message && (
          <p
            role="alert"
            className="mt-1.5 text-[11px]"
            style={{ color: 'var(--star-yellow)' }}
          >
            {draft.geo.message}
          </p>
        )}
      </section>

      <input
        value={draft.authorName}
        onChange={(e) => draft.setAuthorName(e.target.value.slice(0, LIMITS.authorName))}
        placeholder="昵称（选填）"
        aria-label="昵称（选填）"
        className="mt-4 min-h-[44px] w-full rounded-btn bg-space-900/70 px-3 text-sm text-hi ring-1 ring-space-700 outline-none placeholder:text-lo focus-visible:ring-2 focus-visible:ring-accent-400"
      />

      {/* 提交：渐变 CTA（设计稿同款）+ 存草稿 */}
      <div className="mt-5 space-y-2">
        <button
          type="button"
          onClick={() => void draft.submit()}
          disabled={!draft.canSubmit}
          aria-busy={draft.busy}
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-full text-sm font-medium text-hi shadow-glow transition-opacity duration-star ease-star hover:opacity-90 disabled:opacity-40"
          style={{ backgroundImage: 'var(--grad-cta)' }}
        >
          {draft.busy ? (
            'AI 解析中…'
          ) : (
            <>
              <NotebookPen size={15} aria-hidden />
              提交，让 AI 归档
            </>
          )}
        </button>
        <button
          type="button"
          onClick={draft.saveDraft}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full bg-space-800 text-sm text-hi ring-1 ring-space-700 transition-colors duration-star ease-star hover:ring-accent-400"
        >
          <Save size={15} aria-hidden />
          存草稿
        </button>
      </div>

      {draft.draftNotice && (
        <p className="mt-2 text-center text-xs text-lo" role="status">
          {draft.draftNotice}
        </p>
      )}

      <p className="mt-3 text-center text-[11px] text-lo">
        草稿会自动保存在本设备，照片不会被保存，恢复草稿后需要重新选图。
      </p>

      {draft.error && (
        <div role="alert" className="mt-2 space-y-1 text-center">
          <p className="text-xs font-medium" style={{ color: 'var(--star-red)' }}>
            {draft.error}
          </p>
          {draft.canRetryTextOnly && (
            <button
              type="button"
              onClick={() => void draft.submit(true)}
              disabled={draft.busy}
              className="text-xs text-lo underline underline-offset-2 disabled:opacity-40"
            >
              这张图不行，只发文字
            </button>
          )}
        </div>
      )}
    </section>
  );
}
