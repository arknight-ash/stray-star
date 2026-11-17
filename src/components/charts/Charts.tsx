/**
 * 数据可视化（2026-10-26 需求 #4）：纯 SVG / CSS 自绘，零图表依赖。
 *
 * 为什么不引 recharts：三张图的数据量都很小（≤8 根条、3 个扇区、30 个点），
 * 自绘的包体是 0，且颜色直接吃 tokens.css 变量，与夜色主题天然同源。
 * 所有图表都带 sr-only 的文字摘要 —— 数据不只靠图形一种编码（R2）。
 */

/** 条形图：横向条，适合"各星记录数"这类带长标签的排名 */
export function BarChart({
  items,
  ariaLabel,
}: {
  items: Array<{ label: string; value: number; color?: string }>;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <figure>
      <ul className="space-y-2.5" role="img" aria-label={ariaLabel}>
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2.5">
            <span className="w-24 shrink-0 truncate text-xs text-lo" title={it.label}>
              {it.label}
            </span>
            <span className="h-4 flex-1 overflow-hidden rounded-full bg-space-800" aria-hidden>
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(it.value > 0 ? 4 : 0, (it.value / max) * 100)}%`,
                  backgroundColor: it.color ?? 'var(--accent-400)',
                  boxShadow: it.value > 0 ? '0 0 10px color-mix(in srgb, var(--accent-400) 30%, transparent)' : undefined,
                }}
              />
            </span>
            <span className="data-mono w-8 shrink-0 text-right text-xs text-hi">{it.value}</span>
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">
        {items.map((it) => `${it.label}：${it.value}`).join('，')}
      </figcaption>
    </figure>
  );
}

/** 环形图：占比一目了然；total 为 0 时由调用方渲染空态 */
export function PieChart({
  slices,
  ariaLabel,
  size = 170,
}: {
  slices: Array<{ label: string; value: number; color: string }>;
  ariaLabel: string;
  size?: number;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 62;
  const c = 2 * Math.PI * r;
  let acc = 0;

  return (
    <figure className="flex items-center gap-5">
      <svg
        viewBox="0 0 160 160"
        width={size}
        height={size}
        role="img"
        aria-label={`${ariaLabel}，共 ${total}`}
        className="shrink-0"
      >
        {/* 底环 */}
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--space-800)" strokeWidth="18" />
        {slices.map((s) => {
          const len = total > 0 ? (s.value / total) * c : 0;
          const dash = `${len} ${c - len}`;
          const el = (
            <circle
              key={s.label}
              cx="80"
              cy="80"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="18"
              strokeDasharray={dash}
              // 从 12 点方向起画
              strokeDashoffset={-acc}
              transform="rotate(-90 80 80)"
              strokeLinecap="butt"
            />
          );
          acc += len;
          return el;
        })}
        <text
          x="80"
          y="76"
          textAnchor="middle"
          fill="var(--text-hi)"
          fontSize="26"
          fontWeight="500"
        >
          {total}
        </text>
        <text x="80" y="96" textAnchor="middle" fill="var(--text-lo)" fontSize="10">
          颗星
        </text>
      </svg>

      <figcaption>
        <ul className="space-y-2">
          {slices.map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-xs">
              <StarSwatch color={s.color} />
              <span className="text-lo">{s.label}</span>
              <span className="data-mono text-hi">{s.value}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

function StarSwatch({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden focusable="false">
      {/* 与星图同形：图例也是五角星 */}
      <path
        d="M12 2 L14.47 8.6 L21.51 8.91 L15.99 13.3 L17.88 20.09 L12 16.2 L6.12 20.09 L8.01 13.3 L2.49 8.91 L9.53 8.6 Z"
        fill={color}
      />
    </svg>
  );
}

/** 折线图：近 N 天的记录趋势；点稀疏时自动显示日期刻度 */
export function LineChart({
  points,
  ariaLabel,
}: {
  points: Array<{ label: string; value: number }>;
  ariaLabel: string;
}) {
  const w = 560;
  const h = 190;
  const padX = 30;
  const padY = 26;
  const max = Math.max(1, ...points.map((p) => p.value));
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padX + i * stepX,
    y: h - padY - (p.value / max) * innerH,
    ...p,
  }));
  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const area = coords.length > 1 ? `${path} L${coords[coords.length - 1]!.x.toFixed(1)} ${h - padY} L${padX} ${h - padY} Z` : '';
  const total = points.reduce((s, p) => s + p.value, 0);

  return (
    <figure role="img" aria-label={`${ariaLabel}，共 ${total} 条`}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" aria-hidden focusable="false">
        <defs>
          <linearGradient id="lc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-400)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent-400)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 网格：两条参考线就够，别画成坐标纸 */}
        {[0.5, 1].map((f) => (
          <line
            key={f}
            x1={padX}
            x2={w - padX}
            y1={h - padY - innerH * f}
            y2={h - padY - innerH * f}
            stroke="var(--space-700)"
            strokeWidth="1"
            strokeDasharray="3 5"
          />
        ))}

        {area && <path d={area} fill="url(#lc-fill)" />}
        {coords.length > 1 && (
          <path d={path} fill="none" stroke="var(--accent-400)" strokeWidth="2" strokeLinecap="round" />
        )}

        {coords.map((c, i) => (
          <g key={c.label}>
            {c.value > 0 && (
              <circle cx={c.x} cy={c.y} r="3" fill="var(--accent-300)">
                <title>{`${c.label}：${c.value} 条`}</title>
              </circle>
            )}
            {/* 日期刻度：约每 7 天一个，避免挤成一排 */
            (points.length <= 8 || i % 7 === 0 || i === points.length - 1) && (
              <text x={c.x} y={h - 8} textAnchor="middle" fill="var(--text-lo)" fontSize="10">
                {c.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">
        近 {points.length} 天共 {total} 条记录；最高一天{' '}
        {Math.max(...points.map((p) => p.value))} 条。
      </figcaption>
    </figure>
  );
}
