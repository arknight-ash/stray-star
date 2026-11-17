import { PieChart } from 'lucide-react';
import { ALERT_META } from '@/lib/semantic';
import { Panel } from './Panel';
import type { LevelSlice } from '@/lib/admin/overview';

/**
 * 预警等级分布（设计稿中栏底部环形图）。
 *
 * 设计稿画的是「受伤/生病/食物短缺…」这类**原因**分类，本项目没有这类字段，
 * 硬编一套标签就等于把假数据画进统计图。这里改成真实存在的维度：预警等级。
 * 三个扇区的颜色沿用 ALERT_META，和学生端星点、徽标同一套语义。
 *
 * 半径与周长都在 132 的 viewBox 里算好，尺寸固定不缩放 —— 环上的文字不会被压扁。
 */
const SIZE = 132;
const RADIUS = 52;
const STROKE = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function LevelDonut({ levels }: { levels: LevelSlice[] }) {
  const total = levels.reduce((sum, s) => sum + s.count, 0);

  let offset = 0;
  const arcs = levels.map((slice) => {
    const length = total === 0 ? 0 : (slice.count / total) * CIRCUMFERENCE;
    const arc = { ...slice, length, offset };
    offset += length;
    return arc;
  });

  return (
    <Panel title="预警等级分布" Icon={PieChart} bodyClassName="px-4 pb-4">
      <div className="flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} aria-hidden>
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--space-700)"
              strokeWidth={STROKE}
              opacity="0.55"
            />
            <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
              {arcs.map((arc) => (
                <circle
                  key={arc.level}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke={ALERT_META[arc.level].dot}
                  strokeWidth={STROKE}
                  strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
                  strokeDashoffset={-arc.offset}
                  strokeLinecap="butt"
                />
              ))}
            </g>
          </svg>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="data-mono text-2xl leading-none text-hi">{total}</p>
              <p className="mt-1 text-[10px] text-lo">预警总数</p>
            </div>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-2">
          {total === 0 ? (
            <li className="text-xs text-lo">还没有产生过预警。</li>
          ) : (
            levels.map((slice) => (
              <li key={slice.level} className="flex items-center gap-2 text-[11px]">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: ALERT_META[slice.level].dot }}
                  aria-hidden
                />
                <span className="text-lo">{ALERT_META[slice.level].label}</span>
                <span className="ml-auto data-mono text-hi">{slice.count}</span>
                <span className="w-8 text-right data-mono text-lo">
                  {Math.round((slice.count / total) * 100)}%
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </Panel>
  );
}
