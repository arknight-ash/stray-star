'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Heart, Map as MapIcon, PawPrint, ClipboardList, Siren } from 'lucide-react';
import { CampusStarMap } from '@/components/map/CampusStarMap';
import { HEALTH_META } from '@/lib/semantic';
import { PageHeader } from './PageHeader';
import { StatCards } from './StatCards';
import type { StatsData } from '@/lib/admin/views';

type Range = 7 | 30;

const RANGE_OPTIONS: Array<{ key: Range; label: string }> = [
  { key: 7, label: '近7天' },
  { key: 30, label: '近30天' },
];

/** 环形图的分段取色：物种/角落不是健康语义，不占用绿黄红三色 */
const SLICE_COLORS = [
  'var(--accent-400)',
  'var(--violet-400)',
  'var(--accent-300)',
  'var(--accent-500)',
  'var(--accent-600)',
  'var(--violet-300)',
];

function pctOf(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100);
}

/**
 * 数据统计（2026-10-27 按设计稿二轮）。
 *
 * 四块：物种分布（环形）、活动趋势（面积图）、校园分布（环形 + 条形）、
 * 热门出现区域（星图 + 排行）。时间范围切换在客户端切片 ——
 * 数据层一次算好 30 天，切 7 天不需要再查一次库。
 */
export function StatsView({ stats }: { stats: StatsData }) {
  const [range, setRange] = useState<Range>(7);
  const trend = useMemo(
    () => (range === 7 ? stats.trend.slice(-7) : stats.trend),
    [range, stats.trend],
  );

  const speciesTotal = stats.species.reduce((s, x) => s + x.count, 0);
  const campusTotal = stats.campus.reduce((s, x) => s + x.count, 0);

  return (
    <div className="space-y-4">
      <PageHeader title="数据统计" subtitle="动物、记录与健康预警的整体走势">
        <div className="flex gap-1" role="group" aria-label="时间范围">
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setRange(o.key)}
              aria-pressed={range === o.key}
              className={
                range === o.key
                  ? 'min-h-[30px] rounded-sticker bg-accent-400 px-2.5 text-xs font-medium text-space-900'
                  : 'min-h-[30px] rounded-sticker border border-space-700 px-2.5 text-xs text-lo transition-colors duration-star ease-star hover:text-hi'
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </PageHeader>

      <StatCards
        items={[
          { label: '总动物数', value: stats.kpi.animals, Icon: PawPrint, color: 'var(--accent-400)' },
          { label: '近30天新记录', value: stats.kpi.records30d, Icon: ClipboardList, color: 'var(--violet-400)' },
          { label: '健康率', value: `${stats.kpi.healthRate}%`, hint: '非预警档案占比', Icon: Heart, color: 'var(--star-green)' },
          { label: '预警事件总数', value: stats.kpi.alertsTotal, Icon: Siren, color: 'var(--star-red)' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <DonutPanel
          title="物种分布"
          Icon={PawPrint}
          center={speciesTotal}
          centerLabel="只动物"
          slices={stats.species.map((s) => ({ label: s.label, count: s.count, pct: pctOf(s.count, speciesTotal) }))}
        />

        <TrendPanel trend={trend} />

        <CampusPanel campus={stats.campus} total={campusTotal} />

        <HotspotPanel stats={stats} />
      </div>
    </div>
  );
}

/** 环形图面板：SVG stroke-dasharray 分段，中心放总数 */
function DonutPanel({
  title,
  Icon,
  center,
  centerLabel,
  slices,
}: {
  title: string;
  Icon: typeof PawPrint;
  center: number;
  centerLabel: string;
  slices: Array<{ label: string; count: number; pct: number }>;
}) {
  const R = 15.9155; // 周长恰好 100，dasharray 直接用百分比
  const C = 2 * Math.PI * R;
  let offset = 25; // 从 12 点方向开始

  return (
    <section
      aria-label={title}
      className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70"
    >
      <h2 className="mb-3 flex items-center gap-1.5 font-display text-[15px] text-hi">
        <Icon size={15} style={{ color: 'var(--accent-300)' }} aria-hidden />
        {title}
      </h2>
      <div className="flex items-center gap-5">
        <div className="relative h-32 w-32 shrink-0" role="img" aria-label={`${title}环形图`}>
          <svg viewBox="0 0 42 42" className="h-full w-full -rotate-0">
            <circle cx="21" cy="21" r={R} fill="none" stroke="var(--space-700)" strokeWidth="5" />
            {slices.map((s, i) => {
              const len = (s.pct / 100) * C;
              const el = (
                <circle
                  key={s.label}
                  cx="21"
                  cy="21"
                  r={R}
                  fill="none"
                  stroke={SLICE_COLORS[i % SLICE_COLORS.length]}
                  strokeWidth="5"
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={offset}
                  strokeLinecap="butt"
                />
              );
              offset -= len;
              return el;
            })}
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <p className="data-mono text-xl font-medium leading-none text-hi">{center}</p>
              <p className="mt-0.5 text-[10px] text-lo">{centerLabel}</p>
            </div>
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
          {slices.length === 0 && <li className="text-lo">暂无数据。</li>}
          {slices.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-lo">{s.label}</span>
              <span className="data-mono text-hi">{s.count}</span>
              <span className="data-mono w-10 text-right text-lo">({s.pct}%)</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** 活动趋势：观察（紫面积）与预警（红虚线）两条线，范围跟随页头切换 */
function TrendPanel({ trend }: { trend: StatsData['trend'] }) {
  const max = Math.max(1, ...trend.map((t) => Math.max(t.observations, t.alerts)));
  const W = 100;
  const H = 42;
  const x = (i: number) => (trend.length === 1 ? W / 2 : (i / (trend.length - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 6) - 2;
  const line = (pick: (t: StatsData['trend'][number]) => number) =>
    trend.map((t, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(pick(t)).toFixed(2)}`).join(' ');
  const area = `${line((t) => t.observations)} L${W},${H} L0,${H} Z`;
  const xTickEvery = trend.length > 10 ? 5 : 1;

  return (
    <section
      aria-label="活动趋势"
      className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70"
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-display text-[15px] text-hi">
          <BarChart3 size={15} style={{ color: 'var(--accent-300)' }} aria-hidden />
          活动趋势
        </h2>
        <div className="flex items-center gap-2.5 text-[11px] text-lo">
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-3 rounded-full"
              style={{ backgroundColor: 'var(--accent-400)' }}
              aria-hidden
            />
            新增记录
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-3 rounded-full"
              style={{ backgroundColor: 'var(--star-red)' }}
              aria-hidden
            />
            新增预警
          </span>
        </div>
      </header>

      <svg
        className="block h-[132px] w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`活动趋势图，观察 ${trend.reduce((s, t) => s + t.observations, 0)} 条、预警 ${trend.reduce((s, t) => s + t.alerts, 0)} 条`}
      >
        <defs>
          <linearGradient id="stats-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-400)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--accent-400)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="var(--space-700)"
            strokeWidth="0.3"
            strokeDasharray="1.5 1.5"
          />
        ))}
        <path d={area} fill="url(#stats-trend-fill)" />
        <path
          d={line((t) => t.observations)}
          fill="none"
          stroke="var(--accent-400)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={line((t) => t.alerts)}
          fill="none"
          stroke="var(--star-red)"
          strokeWidth="2"
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1.5 flex justify-between px-0.5 text-[10px] text-lo" aria-hidden>
        {trend.map((t, i) =>
          i % xTickEvery === 0 || i === trend.length - 1 ? (
            <span key={t.date} className="data-mono">
              {t.label.slice(3)}
            </span>
          ) : null,
        )}
      </div>
    </section>
  );
}

/** 校园分布：环形 + 横向条形（同一份数据的两种读法，对齐设计稿左下块） */
function CampusPanel({ campus, total }: { campus: StatsData['campus']; total: number }) {
  const slices = campus.map((c) => ({ label: c.label, count: c.count, pct: c.pct }));
  const max = Math.max(1, ...campus.map((c) => c.count));

  return (
    <section
      aria-label="校园分布"
      className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70"
    >
      <h2 className="mb-3 flex items-center gap-1.5 font-display text-[15px] text-hi">
        <MapIcon size={15} style={{ color: 'var(--accent-300)' }} aria-hidden />
        校园分布
      </h2>
      <div className="grid items-center gap-4 sm:grid-cols-[128px_minmax(0,1fr)]">
        <MiniDonut total={total} slices={slices} label="校园分布环形图" />
        <ul className="space-y-2">
          {campus.length === 0 && <li className="text-xs text-lo">暂无带坐标的档案。</li>}
          {campus.slice(0, 6).map((c, i) => (
            <li key={c.key} className="flex items-center gap-2 text-[11px]">
              <span className="w-14 shrink-0 truncate text-lo">{c.label}</span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-space-700/60">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${(c.count / max) * 100}%`,
                    backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length],
                  }}
                />
              </span>
              <span className="data-mono w-14 shrink-0 text-right text-lo">
                {c.count} ({c.pct}%)
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function MiniDonut({
  total,
  slices,
  label,
}: {
  total: number;
  slices: Array<{ label: string; count: number; pct: number }>;
  label: string;
}) {
  const R = 15.9155;
  const C = 2 * Math.PI * R;
  let offset = 25;
  return (
    <div className="relative h-28 w-28" role="img" aria-label={label}>
      <svg viewBox="0 0 42 42" className="h-full w-full">
        <circle cx="21" cy="21" r={R} fill="none" stroke="var(--space-700)" strokeWidth="5" />
        {slices.map((s, i) => {
          const len = (s.pct / 100) * C;
          const el = (
            <circle
              key={s.label}
              cx="21"
              cy="21"
              r={R}
              fill="none"
              stroke={SLICE_COLORS[i % SLICE_COLORS.length]}
              strokeWidth="5"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={offset}
            />
          );
          offset -= len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="data-mono text-lg font-medium leading-none text-hi">{total}</p>
          <p className="mt-0.5 text-[10px] text-lo">颗星在图</p>
        </div>
      </div>
    </div>
  );
}

/** 热门出现区域：星图 + 角落排行（排行直接来自档案点位最近的角落） */
function HotspotPanel({ stats }: { stats: StatsData }) {
  return (
    <section
      aria-label="热门出现区域"
      className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70"
    >
      <h2 className="mb-3 flex items-center gap-1.5 font-display text-[15px] text-hi">
        <MapIcon size={15} style={{ color: 'var(--accent-300)' }} aria-hidden />
        热门出现区域
      </h2>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
        <div className="h-[220px] overflow-hidden rounded-btn ring-1 ring-space-700/60">
          <CampusStarMap
            animals={stats.map}
            alerts={[]}
            showHint={false}
          />
        </div>
        <ol className="space-y-1.5 self-start text-xs">
          {stats.hotspots.length === 0 && <li className="text-lo">暂无数据。</li>}
          {stats.hotspots.map((h, i) => (
            <li key={h.label} className="flex items-center gap-2">
              <span
                className="data-mono grid h-5 w-5 shrink-0 place-items-center rounded-sticker text-[10px]"
                style={{
                  color: i === 0 ? 'var(--space-900)' : 'var(--accent-300)',
                  backgroundColor:
                    i === 0 ? 'var(--accent-400)' : 'color-mix(in srgb, var(--accent-400) 14%, transparent)',
                }}
                aria-hidden
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-lo">{h.label}</span>
              <span className="data-mono text-hi">{h.count}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-2.5 px-1 text-[11px] text-lo">
        统计口径：档案点位最近的校园角落 · 共 {stats.map.length} 颗星上图 ·{' '}
        <Link href="/admin" className="underline-offset-2 hover:underline">
          回总览看分布地图
        </Link>
      </p>
      <ul className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-lo">
        {(['GREEN', 'YELLOW', 'RED'] as const).map((level) => (
          <li key={level} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: HEALTH_META[level].dot }}
              aria-hidden
            />
            {HEALTH_META[level].label}
          </li>
        ))}
      </ul>
    </section>
  );
}
