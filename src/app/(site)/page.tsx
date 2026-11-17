import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowUpRight,
  BookMarked,
  Camera,
  Clock,
  Flame,
  Map,
  MapPin,
  Megaphone,
  MessagesSquare,
  NotebookPen,
  PenLine,
  Star,
  Zap,
} from 'lucide-react';
import { prisma } from '@/lib/db';
import { Disclaimer } from '@/components/star/Disclaimer';
import { AgentSpotlight } from '@/components/home/AgentSpotlight';
import { AgentStarFab } from '@/components/home/AgentStarFab';
import { StarDustIntro } from '@/components/home/StarDustIntro';
import { nearestSpot } from '@/lib/map-config';
import { DAILY_QUOTE, HOME_ANNOUNCEMENTS } from '@/lib/announcements';
import type { ObservationType } from '@/lib/api/observation-contract';
import { ObservatoryNoteInline } from '@/components/map/ObservatoryNoteInline';
import { getObservatoryNote } from '@/lib/insight/observatory';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '智护流浪星 · 在城市的角落，也有需要被看见的生命',
  description:
    '每只校园流浪动物都是星空里的一颗星：拍一张照片就能认出它是谁，看一眼颜色就知道它今天怎么样。',
};

/** 观察类型 → 中文标签 + 角标色（与照片墙一致的三色语义） */
const TYPE_META: Record<ObservationType, { label: string; color: string }> = {
  FEEDING: { label: '喂食', color: 'var(--star-green)' },
  HEALTH: { label: '健康', color: 'var(--star-red)' },
  BEHAVIOR: { label: '行为', color: 'var(--star-yellow)' },
  OTHER: { label: '其他', color: 'var(--accent-400)' },
};

/** MM-DD HH:mm（服务端本地时区，与库里的写入口径一致） */
function formatTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 首页 = 星辰守护仪表盘（2026-10-26 三次改版，对齐设计稿 cb4bc116）：
 * ① hero 问候横幅：夜景插画底图 + 问候语 + 「已点亮 N 颗星」胶囊（**不再放地图**）；
 * ② 星枢AI 主卡（2026-10-27 新增：独占一行的光斑卡，从四等分卡里提出来）；
 * ③ 三张彩色功能卡（拍摄识别/图鉴/记录一笔）；
 * ④ 左下「最近记录」+「快捷入口」双卡；右栏「星枢AI公告/今日寄语/今日星光/校园热门」。
 *
 * 地图撤到 /map 正式页（侧栏「星图」进入），首页不再 import 任何地图组件；
 * 2026-10-28 只新增了 `ObservatoryNoteInline`（AI 观测的一句话，不是地图）。
 */
export default async function HomePage() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [animals, recentObs, todayFeeding, todayCount, photoCount, note] = await Promise.all([
      prisma.animal.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          avatarUrl: true,
          healthLevel: true,
          _count: { select: { observations: true } },
        },
      }),
      prisma.observation.findMany({
        orderBy: { createdAt: 'desc' },
        take: 4,
        select: {
          id: true,
          type: true,
          createdAt: true,
          mapLat: true,
          mapLng: true,
          animal: { select: { code: true, name: true, avatarUrl: true } },
        },
      }),
      prisma.observation.count({ where: { type: 'FEEDING', createdAt: { gte: startOfToday } } }),
      prisma.observation.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.observation.count({ where: { imageUrl: { not: null } } }),
      // AI 主动看全局写的那句话：与星图页共用同一份缓存，不会多烧一次调用
      getObservatoryNote({ db: prisma }),
    ]);

  // 问候语：不带昵称，登录与否都显示同一句
  const greeting = '很高兴再次见到你';

  const hotAnimals = [...animals]
    .sort((a, b) => b._count.observations - a._count.observations)
    .slice(0, 3);

  // 功能卡只剩三张：星枢AI 已提到独立主卡（AgentSpotlight），不再和它们并列
  const FEATURES = [
    {
      href: '/scan',
      title: '拍摄识别',
      desc: '发现身边的流浪动物\n记录它们的故事',
      Icon: Camera,
      tint: 'var(--accent-400)',
    },
    {
      href: '/animals',
      title: '图鉴',
      desc: '认识更多动物\n了解它们的故事',
      Icon: BookMarked,
      tint: 'var(--star-green)',
    },
    {
      href: '/report',
      title: '记录一笔',
      desc: '记录它们的生活\n也记录你的善意',
      Icon: PenLine,
      tint: 'var(--star-yellow)',
    },
  ] as const;

  const QUICK_ENTRIES = [
    { href: '/animals', title: '我的图鉴', desc: '查看已认识的动物', Icon: BookMarked },
    { href: '/report', title: '我的记录', desc: '查看历史记录', Icon: NotebookPen },
    { href: '/chat', title: '常见问题', desc: 'AI 智能解答', Icon: MessagesSquare },
    { href: '/map', title: '校园星图', desc: '看看它们在哪', Icon: Map },
  ] as const;

  return (
    // 仪表盘布局：左主列（hero + 功能卡 + 最近记录/快捷入口）+ 右栏（公告/寄语/星光/热门）
    <main className="w-full px-3 pb-32 pt-3 md:pb-16 lg:px-4 lg:pt-4">
      <StarDustIntro />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── 左主列 ─────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* ① hero 问候横幅：夜景插画 + 问候语 + 已点亮胶囊 */}
          <section
            aria-label="智护流浪星"
            className="relative min-h-[300px] overflow-hidden rounded-card border border-space-700/60 md:min-h-[360px]"
          >
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: 'url(/images/hero-city.jpg)' }}
              aria-hidden
            />
            {/* 左侧压暗渐变保证文字对比度 */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  'linear-gradient(90deg, color-mix(in srgb, var(--space-900) 86%, transparent) 0%, color-mix(in srgb, var(--space-900) 52%, transparent) 48%, color-mix(in srgb, var(--space-900) 12%, transparent) 100%)',
              }}
              aria-hidden
            />

            <div className="relative z-10 flex min-h-[300px] flex-col justify-center px-6 py-10 md:min-h-[360px] md:px-10">
              <div className="max-w-xl">
                <h1 className="font-display text-3xl leading-snug text-hi md:text-4xl">
                  你好，
                  <br />
                  {greeting}
                  <Star size={18} className="ml-2 inline text-accent-300" aria-hidden />
                </h1>
                <p className="mt-3 text-sm text-lo md:text-base">
                  每一颗被发现的星星，都是生命的温度。
                </p>
                <Link
                  href="/map"
                  className="mt-7 inline-flex min-h-[44px] items-center gap-2 rounded-full px-5 text-sm font-medium text-hi shadow-glow transition-transform duration-star ease-star hover:scale-[1.03]"
                  style={{ backgroundImage: 'var(--grad-cta)' }}
                >
                  <Star size={15} aria-hidden />
                  已点亮 <span className="data-mono">{animals.length}</span> 颗星
                  <ArrowUpRight size={15} aria-hidden />
                </Link>

                {/* AI 主动观测：首屏就要能看出"它不只在被动回答" */}
                <ObservatoryNoteInline note={note} className="mt-5" />
              </div>
            </div>
          </section>

          {/* ② 星枢AI 主卡：独占一行，是首页除 hero 之外唯一带光斑的块 */}
          <AgentSpotlight />

          {/* ③ 三张彩色功能卡（星枢AI 已提为上方主卡） */}
          <section aria-label="功能入口" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ href, title, desc, Icon, tint }) => (
              <Link
                key={href}
                href={href}
                className="glass-card group relative p-4 transition-colors duration-star ease-star hover:border-accent-500/60"
              >
                <span
                  className="inline-flex h-11 w-11 items-center justify-center rounded-btn"
                  style={{ backgroundColor: `color-mix(in srgb, ${tint} 20%, transparent)` }}
                  aria-hidden
                >
                  <Icon size={20} strokeWidth={1.75} style={{ color: tint }} />
                </span>
                <ArrowUpRight
                  size={15}
                  aria-hidden
                  className="absolute right-4 top-4 text-lo transition-colors duration-star ease-star group-hover:text-hi"
                />
                <h2 className="mt-3 text-sm font-medium text-hi">{title}</h2>
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-lo">{desc}</p>
              </Link>
            ))}
          </section>

          {/* ④ 最近记录 + 快捷入口 */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
            {/* 最近记录 */}
            <section aria-label="最近记录" className="glass-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-medium text-hi">
                  <Clock size={15} className="text-accent-400" aria-hidden />
                  最近记录
                </h2>
                <Link
                  href="/photos"
                  className="text-xs text-lo transition-colors duration-star ease-star hover:text-hi"
                >
                  查看更多 &gt;
                </Link>
              </div>

              {recentObs.length === 0 ? (
                <p className="py-8 text-center text-sm text-lo">
                  还没有记录，去「记录一笔」写下第一条吧。
                </p>
              ) : (
                <ul className="divide-y divide-space-700/60">
                  {recentObs.map((o) => {
                    const spot = nearestSpot(o.mapLat, o.mapLng);
                    const typeMeta = TYPE_META[o.type];
                    return (
                      <li key={o.id}>
                        <Link
                          href={`/animals/${o.animal.code}`}
                          className="group flex items-center gap-3 py-3"
                          title={`${o.animal.name}（${o.animal.code}）的${typeMeta.label}记录`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- 同 Avatar：/animals 本地路径走 next/image 收益为负 */}
                          {o.animal.avatarUrl ? (
                            <img
                              src={o.animal.avatarUrl}
                              alt=""
                              className="h-11 w-11 shrink-0 rounded-btn object-cover ring-1 ring-space-700"
                            />
                          ) : (
                            <span
                              className="grid h-11 w-11 shrink-0 place-items-center rounded-btn bg-space-800 ring-1 ring-space-700"
                              aria-hidden
                            >
                              <Star size={16} className="text-lo" />
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 text-sm text-hi">
                              <span className="truncate">{o.animal.name}</span>
                              <span
                                className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
                                style={{
                                  color: typeMeta.color,
                                  backgroundColor: `color-mix(in srgb, ${typeMeta.color} 14%, transparent)`,
                                }}
                              >
                                {typeMeta.label}
                              </span>
                            </p>
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-lo">
                              <MapPin size={11} aria-hidden />
                              {spot ? `${spot.name}附近` : '位置待补充'}
                            </p>
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-lo">
                              <Clock size={11} aria-hidden />
                              {formatTime(o.createdAt)}
                            </p>
                          </div>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <Star size={13} className="text-accent-300" aria-hidden />
                            <ArrowUpRight
                              size={14}
                              aria-hidden
                              className="text-lo transition-colors duration-star ease-star group-hover:text-hi"
                            />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* 快捷入口 */}
            <section aria-label="快捷入口" className="glass-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-hi">
                <Zap size={15} className="text-accent-400" aria-hidden />
                快捷入口
              </h2>
              <div className="grid grid-cols-2 gap-2.5">
                {QUICK_ENTRIES.map(({ href, title, desc, Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className="group rounded-card bg-space-800/70 p-3 ring-1 ring-space-700/70 transition-colors duration-star ease-star hover:ring-accent-500/60"
                  >
                    <span
                      className="inline-flex h-9 w-9 items-center justify-center rounded-btn"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--accent-400) 16%, transparent)',
                      }}
                      aria-hidden
                    >
                      <Icon
                        size={17}
                        strokeWidth={1.75}
                        style={{ color: 'var(--accent-400)' }}
                      />
                    </span>
                    <p className="mt-2 text-sm text-hi">{title}</p>
                    <p className="mt-0.5 text-[11px] text-lo">{desc}</p>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* ── 右栏 ───────────────────────────────────────────────── */}
        <aside aria-label="星枢AI公告与统计" className="flex min-w-0 flex-col gap-4">
          {/* 星枢AI公告（内容在 src/lib/announcements.ts 维护） */}
          <section aria-label="星枢AI公告" className="glass-card p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-hi">
              <Megaphone size={15} className="text-accent-400" aria-hidden />
              星枢AI公告
            </h2>
            <ul className="divide-y divide-space-700/60">
              {HOME_ANNOUNCEMENTS.map((a) => (
                <li key={`${a.date}-${a.title}`}>
                  {a.href ? (
                    <Link
                      href={a.href}
                      className="group flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-xs text-lo transition-colors duration-star ease-star group-hover:text-hi">
                        <span
                          className="h-1 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: 'var(--accent-400)' }}
                          aria-hidden
                        />
                        <span className="truncate">{a.title}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-lo">{a.date}</span>
                    </Link>
                  ) : (
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-2 text-xs text-lo">
                        <span
                          className="h-1 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: 'var(--accent-400)' }}
                          aria-hidden
                        />
                        <span className="truncate">{a.title}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-lo">{a.date}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* 今日寄语 */}
          <section
            aria-label="今日寄语"
            className="glass-card relative overflow-hidden p-4"
          >
            <h2 className="flex items-center gap-2 text-sm font-medium text-hi">
              <Star size={15} className="text-accent-400" aria-hidden />
              今日寄语
            </h2>
            <blockquote className="mt-3">
              <p className="text-sm leading-relaxed text-lo">“ {DAILY_QUOTE.text} ”</p>
              <footer className="mt-2 text-right text-xs text-lo">—— {DAILY_QUOTE.from}</footer>
            </blockquote>
          </section>

          {/* 今日星光：只放真实可算的数 */}
          <section aria-label="今日星光" className="glass-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-medium text-hi">
                <Zap size={15} className="text-accent-400" aria-hidden />
                今日星光
              </h2>
              <Link
                href="/data"
                className="text-xs text-lo transition-colors duration-star ease-star hover:text-hi"
              >
                更多 &gt;
              </Link>
            </div>

            <div className="flex items-center gap-4">
              <div
                className="grid h-20 w-20 shrink-0 place-items-center rounded-full shadow-glow"
                style={{ backgroundImage: 'var(--grad-cta)' }}
              >
                <div className="text-center">
                  <Star size={14} className="mx-auto text-hi" aria-hidden />
                  <p className="data-mono text-xl font-medium leading-tight text-hi">
                    {animals.length}
                  </p>
                </div>
              </div>
              <p className="text-xs text-lo">
                已点亮星星
                <br />
                <span className="mt-1 inline-block text-[11px]">
                  校园里被认识的小家伙
                </span>
              </p>

              <dl className="ml-auto space-y-2 text-right">
                <div>
                  <dt className="sr-only">今日投喂</dt>
                  <dd className="data-mono text-lg leading-tight" style={{ color: 'var(--star-green)' }}>
                    {todayFeeding}
                  </dd>
                  <dd className="text-[11px] text-lo">今日投喂</dd>
                </div>
                <div>
                  <dt className="sr-only">照片记录</dt>
                  <dd className="data-mono text-lg leading-tight text-accent-300">{photoCount}</dd>
                  <dd className="text-[11px] text-lo">照片记录</dd>
                </div>
                <div>
                  <dt className="sr-only">今日记录</dt>
                  <dd className="data-mono text-lg leading-tight" style={{ color: 'var(--star-yellow)' }}>
                    {todayCount}
                  </dd>
                  <dd className="text-[11px] text-lo">今日记录</dd>
                </div>
              </dl>
            </div>
          </section>

          {/* 校园热门：按记录数排序的真实热度 */}
          {hotAnimals.length > 0 && (
            <section aria-label="校园热门" className="glass-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-hi">
                <Flame size={15} style={{ color: 'var(--star-red)' }} aria-hidden />
                校园热门
              </h2>
              <div className="grid grid-cols-3 gap-2">
                {hotAnimals.map((a) => (
                  <Link
                    key={a.id}
                    href={`/animals/${a.code}`}
                    className="group relative overflow-hidden rounded-btn ring-1 ring-space-700 transition-colors duration-star ease-star hover:ring-accent-500/60"
                    title={`${a.name}（${a.code}），被记录 ${a._count.observations} 次`}
                  >
                    {a.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 同 Avatar：/animals 本地路径走 next/image 收益为负
                      <img src={a.avatarUrl} alt="" className="h-20 w-full object-cover" />
                    ) : (
                      <span
                        className="grid h-20 w-full place-items-center bg-space-800"
                        aria-hidden
                      >
                        <Star size={18} className="text-lo" />
                      </span>
                    )}
                    <div className="absolute inset-x-0 bottom-0 p-1.5" style={{ backgroundColor: 'color-mix(in srgb, var(--space-900) 72%, transparent)' }}>
                      <p className="truncate text-[11px] text-hi">{a.name}</p>
                      <p className="text-[10px] text-lo">热度 {a._count.observations}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>

      <div className="mt-5">
        <Disclaimer />
      </div>

      <AgentStarFab />
    </main>
  );
}
