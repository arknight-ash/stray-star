'use client';

import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { Panel } from './Panel';
import type { TrendPoint } from '@/lib/admin/overview';

/**
 * 数据统计折线图（设计稿中栏底部那张）。
 *
 * 为什么手搓 SVG 而不再装一个图表库：只需要「两条折线 + 网格 + 三档区间」，
 * 引 recharts 会往首屏多塞 100KB+，而这里 60 行就能画完，还能直接用设计令牌取色。
 *
 * 画法：viewBox 固定 100×100 + `preserveAspectRatio="none"` 铺满容器，
 * 折线用 `vector-effect="non-scaling-stroke"` 保持 2px 不被拉扁；
 * 所有文字（Y 轴刻度、X 轴日期）放在 HTML 层，避免被非等比缩放压成扁字。
 * 因此容器宽度怎么变，线都贴边、字都不变形。
 */

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

const RANGE_LABEL: Record<Range, string> = { 7: '近 7 天', 30: '近 30 天', 90: '近 90 天' };

/** 折线在容器里的位置（百分比），点少时也要铺满整宽 */
function toPoints(values: number[], max: number): string {
  const n = values.length;
  if (n === 0) return '';
  return values
    .map((v, i) => {
      const x = n === 1 ? 50 : (i / (n - 1)) * 100;
      const y = 100 - (v / max) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

/** Y 轴上界：向上取整到「好看」的刻度，且至少 4，避免全 0 时线贴着顶 */
function niceMax(rawMax: number): number {
  const floor = Math.max(4, rawMax);
  if (floor <= 6) return Math.ceil(floor / 2) * 2;
  if (floor <= 20) return Math.ceil(floor / 5) * 5;
  return Math.ceil(floor / 10) * 10;
}

/** X 轴只画 4–5 个刻度：90 天全画会糊成一团 */
function pickTicks(n: number, count: number): number[] {
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(i * step));
}

export function TrendPanel({ trends }: { trends: Record<Range, TrendPoint[]> }) {
  const [range, setRange] = useState<Range>(7);
  const points = trends[range];

  const maxObs = Math.max(1, ...points.map((p) => p.observations));
  const maxAlert = Math.max(1, ...points.map((p) => p.alerts));
  const max = niceMax(Math.max(maxObs, maxAlert));

  const totalObs = points.reduce((sum, p) => sum + p.observations, 0);
  const totalAlert = points.reduce((sum, p) => sum + p.alerts, 0);
  const ticks = pickTicks(points.length, 5);

  return (
    <Panel
      title="数据统计"
      Icon={TrendingUp}
      bodyClassName="px-4 pb-3"
      action={
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="统计区间">
          {RANGES.map((item) => {
            const active = item === range;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setRange(item)}
                aria-pressed={active}
                className={`min-h-[26px] rounded-full px-2.5 text-[11px] transition-colors duration-star ease-star ${
                  active ? 'text-space-900' : 'text-lo hover:text-hi'
                }`}
                style={active ? { backgroundColor: 'var(--accent-300)' } : undefined}
              >
                {RANGE_LABEL[item]}
              </button>
            );
          })}
        </div>
      }
    >
      {/* 图例 + 区间小计：数字和图必须对得上，所以都从同一份 points 里算 */}
      <ul className="mb-1 flex items-center gap-4 text-[11px] text-lo">
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-3 rounded-full"
            style={{ backgroundColor: 'var(--accent-400)' }}
            aria-hidden
          />
          新增记录 <span className="data-mono text-hi">{totalObs}</span>
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-3 rounded-full"
            style={{ backgroundColor: 'var(--star-red)' }}
            aria-hidden
          />
          新增预警 <span className="data-mono text-hi">{totalAlert}</span>
        </li>
      </ul>

      <div
        className="relative h-[168px] pl-7 pb-5"
        role="img"
        aria-label={`${RANGE_LABEL[range]}：新增记录 ${totalObs} 条，新增预警 ${totalAlert} 条`}
      >
        {/* Y 轴刻度（HTML 层，不被非等比缩放压扁） */}
        <div
          className="absolute bottom-5 left-0 top-0 flex w-6 flex-col justify-between text-right text-[10px] text-lo"
          aria-hidden
        >
          {[max, Math.round((max * 2) / 3), Math.round(max / 3), 0].map((v, i) => (
            <span key={i} className="data-mono leading-none">
              {v}
            </span>
          ))}
        </div>

        <div className="absolute bottom-5 left-7 right-0 top-0">
          <svg
            className="h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
          <defs>
            <linearGradient id="ss-trend-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-400)" stopOpacity="0.34" />
              <stop offset="100%" stopColor="var(--accent-400)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* 网格：0 / 1/3 / 2/3 / 1 */}
          {[0, 33.33, 66.66, 100].map((y) => (
            <line
              key={y}
              x1="0"
              x2="100"
              y1={y}
              y2={y}
              stroke="var(--space-700)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* 面积：折线下方渐变，让"新增记录"成为视觉主角 */}
          <polygon
            points={`0,100 ${toPoints(
              points.map((p) => p.observations),
              max,
            )} 100,100`}
            fill="url(#ss-trend-area)"
          />
          <polyline
            points={toPoints(
              points.map((p) => p.observations),
              max,
            )}
            fill="none"
            stroke="var(--accent-400)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={toPoints(
              points.map((p) => p.alerts),
              max,
            )}
            fill="none"
            stroke="var(--star-red)"
            strokeWidth="1.6"
            strokeDasharray="4 4"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          </svg>
        </div>

        {/* X 轴刻度 */}
        <div className="pointer-events-none absolute bottom-0 left-7 right-0 h-5" aria-hidden>
          {ticks.map((index) => {
            const point = points[index];
            if (!point) return null;
            const pct = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
            return (
              <span
                key={point.date}
                className="absolute top-1 whitespace-nowrap text-[10px] text-lo data-mono"
                style={{
                  left: `${pct}%`,
                  transform:
                    index === 0
                      ? 'none'
                      : index === points.length - 1
                        ? 'translateX(-100%)'
                        : 'translateX(-50%)',
                }}
              >
                {point.label}
              </span>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
