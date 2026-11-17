'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  BedDouble,
  BookOpen,
  Clock,
  Compass,
  DoorOpen,
  Dumbbell,
  GraduationCap,
  LayoutGrid,
  Star,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { CampusStarMap } from '@/components/map/CampusStarMap';
import { ObservatoryNoteCard } from '@/components/map/ObservatoryNoteCard';
import { StarDot } from '@/components/star/StarDot';
import { HEALTH_META } from '@/lib/semantic';
import { CAMPUS_SPOTS, nearestSpot } from '@/lib/map-config';
import { SITE } from '@/lib/constants';
import type { HealthLevel, MapPinVM, StarPinAlertVM, StarPinAnimalVM } from '@/types/domain';
import type { ObservationType } from '@/lib/api/observation-contract';
import type { MapNote } from '@/lib/api/map-note-contract';
import { cn } from '@/lib/utils';

/** 右栏「最近发现」的一行（服务端查好序列化后传入） */
export interface RecentObsItem {
  id: string;
  type: ObservationType;
  createdAt: string;
  animalCode: string;
  animalName: string;
  avatarUrl: string | null;
}

const TYPE_LABEL: Record<ObservationType, string> = {
  FEEDING: '喂食',
  HEALTH: '健康',
  BEHAVIOR: '行为',
  OTHER: '其他',
};

const HEALTH_ORDER: HealthLevel[] = ['GREEN', 'YELLOW', 'RED'];

/**
 * 角落图标：让「快速跳转」一眼能认出是哪种地方，而不只是文字胶囊。
 * KEY 必须与 lib/map-config 的 CAMPUS_SPOTS 一一对应（2026-10-27 换成真实校园点位后同步改过）。
 */
const SPOT_ICON: Record<string, LucideIcon> = {
  library: BookOpen,
  canteen: UtensilsCrossed,
  dorm: BedDouble,
  track: Dumbbell,
  teaching: GraduationCap,
  'west-gate': DoorOpen,
};

/**
 * 星图探索台（2026-10-26，对齐设计稿 31975891）：
 * 左：大地图卡（标题 overlay + 星星类型筛选 + 区域快速跳转）；
 * 右：选中星详情卡（点星更新）/ 收集进度环 / 最近发现。
 *
 * 设计稿的「普通/稀有/珍贵星」是游戏化 rarity，本项目没有这个数据维度，
 * 映射到真实语义三档：健康（绿）/ 观察（黄）/ 预警（红）—— 与星点着色同一套口径；
 * 「未发现」= 还没有任何观察记录的星（真实存在）。
 */
export function MapExplorer({
  animals,
  alerts,
  recent,
  note,
}: {
  animals: StarPinAnimalVM[];
  alerts: StarPinAlertVM[];
  recent: RecentObsItem[];
  /** AI 主动读全局数据写的一句话（服务端算好，含口径与来源） */
  note: MapNote;
}) {
  // 筛选：默认三档全开（不筛选 = 全部）
  const [hidden, setHidden] = useState<Set<HealthLevel>>(new Set());
  const [onlyUnrecorded, setOnlyUnrecorded] = useState(false);
  // 区域快跳：null = 未触发过（不平移）；key='all' = 收拢全部
  const [focus, setFocus] = useState<{ key: string; lat: number; lng: number } | null>(null);
  // 选中星：默认取记录最多的一只作"封面星"
  const [selected, setSelected] = useState<MapPinVM | null>(null);

  const filtered = useMemo(
    () =>
      animals.filter((a) => {
        if (hidden.has(a.healthLevel)) return false;
        if (onlyUnrecorded && (a.observationCount ?? 0) > 0) return false;
        return true;
      }),
    [animals, hidden, onlyUnrecorded],
  );

  const toggleLevel = useCallback((level: HealthLevel) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }, []);

  // 进度：被记录过的星 / 全部星；分档计数
  const recorded = animals.filter((a) => (a.observationCount ?? 0) > 0).length;
  const unpinned = animals.filter((a) => a.mapLat === null || a.mapLng === null).length;
  const pinned = animals.length - unpinned;
  const levelCounts: Record<HealthLevel, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
  for (const a of animals) levelCounts[a.healthLevel] += 1;

  // 每个角落附近有几颗星：跟着筛选走，所以隐藏某档星星时数字会同步变
  const spotCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of filtered) {
      const spot = nearestSpot(a.mapLat, a.mapLng);
      if (spot) m.set(spot.key, (m.get(spot.key) ?? 0) + 1);
    }
    return m;
  }, [filtered]);

  // 详情卡：选中优先，否则取记录最多的一只当封面
  const featured =
    selected ??
    animals.find((a) => a.mapLat !== null && (a.observationCount ?? 0) > 0) ??
    animals[0] ??
    null;
  const featuredSpot = featured ? nearestSpot(featured.mapLat, featured.mapLng) : null;
  const featuredMeta = featured ? HEALTH_META[featured.healthLevel] : null;

  const handleSelect = useCallback((pin: MapPinVM) => setSelected(pin), []);

  // 进度环：r=34，周长≈213.6
  const ratio = animals.length === 0 ? 0 : recorded / animals.length;
  const C2 = 2 * Math.PI * 34;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      {/* ── 左：大地图卡 + 下方快速跳转 ────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-4">
        <section
          aria-label={`${SITE.name}星图`}
          className="relative overflow-hidden rounded-card p-px shadow-glow-strong"
          style={{ backgroundImage: 'var(--grad-cta)' }}
        >
          <div className="relative overflow-hidden rounded-card bg-space-900">
            <div className="h-[64vh] min-h-[460px]">
              <CampusStarMap
                animals={filtered}
                alerts={alerts}
                onSelect={handleSelect}
                focus={focus}
                // 提示条关掉：地图下方的「快速跳转」条已经写了「可拖动」
                showHint={false}
              />
            </div>

            {/* 边缘晕影：把地图四周压暗，让中心星点更"浮"出来 */}
            <div
              className="pointer-events-none absolute inset-0 z-[560]"
              style={{
                backgroundImage:
                  'radial-gradient(120% 90% at 50% 45%, transparent 45%, color-mix(in srgb, var(--space-900) 55%, transparent) 100%)',
              }}
              aria-hidden
            />

            {/* 标题 overlay（左上） */}
            <div className="pointer-events-none absolute left-4 top-4 z-[600]">
              <h1 className="flex items-center gap-2 font-display text-lg text-hi">
                <Star size={16} className="text-accent-400" aria-hidden />
                星图 · 光谷校区
              </h1>
              <p className="mt-1 text-xs text-lo">在熟悉的校园里，寻找那些被温柔以待的生命。</p>
            </div>

            {/* 统计芯片（右上，避开右上角缩放按钮：按钮组约 72px 高，从 top-20 起） */}
            <div className="bg-space-800/85 ring-space-700/70 absolute right-4 top-20 z-[600] rounded-full px-3 py-1.5 text-[11px] text-lo ring-1 backdrop-blur">
              图上 <span className="data-mono text-hi">{pinned}</span> 颗星
              {unpinned > 0 && (
                <>
                  {' · '}
                  <span className="data-mono text-hi">{unpinned}</span> 颗暂无位置
                </>
              )}
            </div>
          </div>

          {/* 星星类型筛选（左上，标题之下） */}
          <div className="bg-space-800/85 ring-space-700/70 absolute left-4 top-20 z-[600] w-44 rounded-card p-3 ring-1 backdrop-blur-md">
            <p className="text-xs font-medium text-hi">星星类型</p>
            <ul className="mt-2 space-y-0.5">
              {HEALTH_ORDER.map((level) => {
                const meta = HEALTH_META[level];
                const off = hidden.has(level);
                return (
                  <li key={level}>
                    <button
                      type="button"
                      onClick={() => toggleLevel(level)}
                      aria-pressed={!off}
                      className={cn(
                        'flex min-h-[34px] w-full items-center gap-2 rounded-btn px-2 text-xs transition-colors duration-star ease-star',
                        off ? 'text-lo opacity-55' : 'hover:bg-space-700/60 text-hi',
                      )}
                    >
                      <StarDot level={level} shape="star" size={15} />
                      <span className="flex-1 text-left">{meta.label}星</span>
                      <span className="data-mono text-[11px] text-lo">{levelCounts[level]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="border-space-700/60 mt-2 border-t pt-2">
              <button
                type="button"
                role="switch"
                aria-checked={onlyUnrecorded}
                onClick={() => setOnlyUnrecorded((v) => !v)}
                className="hover:bg-space-700/60 flex min-h-[34px] w-full items-center justify-between rounded-btn px-2 text-xs text-hi transition-colors duration-star ease-star"
              >
                只看未被记录
                <span
                  className="relative inline-flex h-5 w-9 shrink-0 rounded-full bg-space-700 transition-colors duration-star ease-star"
                  style={onlyUnrecorded ? { backgroundColor: 'var(--accent-400)' } : undefined}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-4 w-4 rounded-full bg-space-900 shadow-glow transition-all duration-star ease-star',
                      onlyUnrecorded ? 'left-[18px]' : 'left-0.5',
                    )}
                    aria-hidden
                  />
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* ── AI 观测手记（移动端） ─────────────────────────────────
            小屏上右栏会落到地图和快速跳转之后，AI 的那句话就被埋到折叠线以下了 ——
            而它恰恰是本页最该被先看到的内容。所以窄屏把它单独放在地图下方，
            宽屏隐藏、改用右栏里那份（`hidden xl:block`）。 */}
        <div className="xl:hidden">
          <ObservatoryNoteCard note={note} />
        </div>

        {/* ── 区域快速跳转（地图下方） ─────────────────────────────── */}
        <section aria-label="区域快速跳转" className="glass-card p-3 sm:p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-hi">
              <Compass size={14} className="text-accent-400" aria-hidden />
              快速跳转
              <span className="text-[11px] font-normal text-lo">点一下飞到那个角落</span>
            </h2>
            <p className="hidden shrink-0 text-[11px] text-lo sm:block">
              圈越大代表被记录得越多 · 地图可拖动
            </p>
          </div>

          <ul className="ss-scroll-x mt-3 flex gap-2 overflow-x-auto pb-1">
            <li className="shrink-0">
              <SpotChip
                icon={LayoutGrid}
                name="全部区域"
                count={filtered.length}
                // 初次进来没点过任何角落 = 默认就是「全部区域」视角
                active={focus === null || focus?.key === 'all'}
                onClick={() => setFocus({ key: 'all', lat: 0, lng: 0 })}
              />
            </li>
            {CAMPUS_SPOTS.map((spot) => (
              <li key={spot.key} className="shrink-0">
                <SpotChip
                  icon={SPOT_ICON[spot.key] ?? DoorOpen}
                  name={spot.name}
                  count={spotCounts.get(spot.key) ?? 0}
                  active={focus?.key === spot.key}
                  onClick={() => setFocus({ key: spot.key, lat: spot.lat, lng: spot.lng })}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ── 右栏 ─────────────────────────────────────────────────── */}
      <aside aria-label="星图详情" className="flex min-w-0 flex-col gap-4">
        {/* AI 主动观察：放在右栏最上面 —— 它讲的是"全场"，是所有卡的入口。
            窄屏由左栏那份承担（见上），这里只在大屏出现，避免同屏两份 */}
        <div className="hidden xl:block">
          <ObservatoryNoteCard note={note} />
        </div>

        {/* 选中星详情卡（点地图上的星会更新，切星时淡入一次） */}
        <section
          aria-label="选中星星详情"
          key={featured?.id ?? 'empty'}
          className={cn(
            'glass-card map-card-in p-4 transition-shadow duration-star ease-star',
            selected && 'ring-accent-500/50 shadow-glow-strong ring-1',
          )}
        >
          {featured && featuredMeta ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <h2 className="flex min-w-0 items-center gap-2 text-sm font-medium text-hi">
                  <span className="shrink-0">
                    <StarDot level={featured.healthLevel} shape="star" size={17} />
                  </span>
                  <span className="truncate">
                    {featuredSpot ? `${featuredSpot.name} · ` : ''}
                    {featured.name}
                  </span>
                </h2>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px]"
                  style={{
                    color: featuredMeta.dot,
                    backgroundColor: `color-mix(in srgb, ${featuredMeta.dot} 14%, transparent)`,
                  }}
                >
                  {featuredMeta.label}
                </span>
              </div>

              {/* 照片：底部压一层渐变把编号托住，比裸图更像卡片 */}
              <div className="relative mt-3 overflow-hidden rounded-card ring-1 ring-space-700">
                {featured.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 同 Avatar：/animals 本地路径走 next/image 收益为负
                  <img
                    src={featured.avatarUrl}
                    alt={`${featured.name}（${featured.code}）的照片`}
                    className="h-40 w-full object-cover"
                  />
                ) : (
                  <div className="starfield grid h-40 w-full place-items-center" aria-hidden>
                    <Star size={22} className="text-lo" />
                  </div>
                )}
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-3 pb-2 pt-8"
                  style={{
                    backgroundImage:
                      'linear-gradient(to top, color-mix(in srgb, var(--space-900) 88%, transparent), transparent)',
                  }}
                >
                  <span className="data-mono text-[11px] text-hi">{featured.code}</span>
                  <span className="text-[11px] text-lo">
                    被记录 {featured.observationCount ?? 0} 次
                  </span>
                </div>
              </div>

              {!selected && (
                <p className="mt-2 text-[11px] text-lo">
                  当前是记录最多的封面星 · 点地图上的星可切换
                </p>
              )}

              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex gap-2">
                  <dt className="shrink-0 text-lo">档案编号</dt>
                  <dd className="min-w-0 truncate text-hi">{featured.code}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-lo">常见位置</dt>
                  <dd className="min-w-0 truncate text-hi">
                    {featuredSpot ? `${featuredSpot.name}附近` : '位置待补充'}
                  </dd>
                </div>
                <div>
                  <dt className="text-lo">最近记录</dt>
                  <dd className="mt-1 line-clamp-3 text-lo">
                    {featured.latestNote ?? '这颗星还没有被记录，去拍下第一张照片吧。'}
                  </dd>
                </div>
              </dl>

              <Link
                href={`/animals/${featured.code}`}
                className="mt-3 inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-btn text-sm font-medium text-hi transition-transform duration-star ease-star hover:scale-[1.01]"
                style={{ backgroundImage: 'var(--grad-cta)' }}
              >
                查看详情
                <ArrowUpRight size={15} aria-hidden />
              </Link>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-lo">
              星图上还没有星，去「拍摄识别」点亮第一颗。
            </p>
          )}
        </section>

        {/* 收集进度 */}
        <section aria-label="收集进度" className="glass-card p-4">
          <h2 className="text-sm font-medium text-hi">收集进度</h2>
          <div className="mt-3 flex items-center gap-4">
            <div className="relative h-[84px] w-[84px] shrink-0">
              <svg
                viewBox="0 0 84 84"
                className="h-full w-full"
                style={{ filter: 'drop-shadow(0 0 8px rgba(139, 92, 246, 0.35))' }}
                aria-hidden
                focusable="false"
              >
                <defs>
                  <linearGradient id="ss-progress-ring" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="var(--accent-500)" />
                    <stop offset="100%" stopColor="var(--accent-300)" />
                  </linearGradient>
                </defs>
                <circle
                  cx="42"
                  cy="42"
                  r="34"
                  fill="none"
                  strokeWidth="8"
                  stroke="color-mix(in srgb, var(--space-700) 90%, transparent)"
                />
                <circle
                  cx="42"
                  cy="42"
                  r="34"
                  fill="none"
                  strokeWidth="8"
                  strokeLinecap="round"
                  stroke="url(#ss-progress-ring)"
                  strokeDasharray={`${(C2 * ratio).toFixed(1)} ${C2.toFixed(1)}`}
                  transform="rotate(-90 42 42)"
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center text-center">
                <p className="data-mono text-base font-medium text-hi">
                  {recorded}
                  <span className="text-lo"> / {animals.length}</span>
                </p>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-lo">
              已点亮星星
              <br />
              <span className="text-[11px]">被记录过的星 / 图鉴总数</span>
            </p>
          </div>

          <ul className="mt-4 space-y-2">
            {HEALTH_ORDER.map((level) => {
              const meta = HEALTH_META[level];
              const pct = animals.length === 0 ? 0 : (levelCounts[level] / animals.length) * 100;
              return (
                <li key={level} className="flex items-center gap-2 text-xs">
                  <span className="w-4 shrink-0">
                    <StarDot level={level} shape="star" size={14} />
                  </span>
                  <span className="shrink-0 text-lo">{meta.label}星</span>
                  <span
                    className="h-1 min-w-0 flex-1 overflow-hidden rounded-full"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--space-700) 85%, transparent)',
                    }}
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${pct.toFixed(1)}%`, backgroundColor: meta.dot }}
                    />
                  </span>
                  <span className="data-mono w-6 shrink-0 text-right text-hi">
                    {levelCounts[level]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* 最近发现 */}
        <section aria-label="最近发现" className="glass-card p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-medium text-hi">最近发现</h2>
            <Link
              href="/photos"
              className="text-xs text-lo transition-colors duration-star ease-star hover:text-hi"
            >
              查看更多 &gt;
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-xs text-lo">还没有发现记录。</p>
          ) : (
            <ul className="divide-space-700/60 divide-y">
              {recent.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/animals/${o.animalCode}`}
                    className="hover:bg-space-700/50 group -mx-1 flex items-center gap-2.5 rounded-btn px-1 py-2.5 transition-colors duration-star ease-star"
                  >
                    {o.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 同 Avatar：/animals 本地路径走 next/image 收益为负
                      <img
                        src={o.avatarUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-btn object-cover ring-1 ring-space-700"
                      />
                    ) : (
                      <span
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-btn bg-space-800 ring-1 ring-space-700"
                        aria-hidden
                      >
                        <Star size={14} className="text-lo" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-hi">{o.animalName}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-lo">
                        <Clock size={10} aria-hidden />
                        {TYPE_LABEL[o.type]} · {formatShort(o.createdAt)}
                      </p>
                    </div>
                    <ArrowUpRight
                      size={13}
                      aria-hidden
                      className="shrink-0 text-lo transition-colors duration-star ease-star group-hover:text-hi"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

/**
 * 快速跳转的一张角落卡：图标 + 名字 + 该角落的星数。
 * 选中态铺主渐变 + 外发光，未选中是半透明玻璃，hover 轻微抬起。
 */
function SpotChip({
  icon: Icon,
  name,
  count,
  active,
  onClick,
}: {
  icon: LucideIcon;
  name: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-[78px] w-[96px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-card px-2',
        'transition-all duration-star ease-star motion-safe:hover:-translate-y-0.5',
        active ? 'shadow-glow-strong' : 'hover:shadow-glow',
      )}
      style={{
        border: `1px solid ${
          active
            ? 'color-mix(in srgb, var(--accent-300) 45%, transparent)'
            : 'color-mix(in srgb, var(--space-700) 70%, transparent)'
        }`,
        backgroundImage: active ? 'var(--grad-cta)' : undefined,
        backgroundColor: active
          ? undefined
          : 'color-mix(in srgb, var(--space-800) 60%, transparent)',
      }}
    >
      <span
        className="grid h-8 w-8 place-items-center rounded-full"
        style={{
          backgroundColor: active
            ? 'color-mix(in srgb, var(--text-hi) 22%, transparent)'
            : 'color-mix(in srgb, var(--space-700) 65%, transparent)',
        }}
        aria-hidden
      >
        <Icon size={15} className={active ? 'text-hi' : 'text-accent-300'} />
      </span>
      <span className="w-full truncate text-center text-xs text-hi">{name}</span>
      <span className={cn('data-mono text-[10px]', active ? 'text-hi' : 'text-lo')}>
        {count} 颗星
      </span>
    </button>
  );
}

/** MM-DD HH:mm（接收 ISO 字符串） */
function formatShort(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
