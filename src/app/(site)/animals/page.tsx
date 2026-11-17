import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { BarChart3, Camera, Search } from 'lucide-react';
import { prisma } from '@/lib/db';
import { PageShell } from '@/components/shell/PageShell';
import { StarCard } from '@/components/star/StarCard';
import { Disclaimer } from '@/components/star/Disclaimer';
import { LocationSupplement } from '@/components/animal/LocationSupplement';
import { ADMIN_COOKIE, adminToken, isAdminCookieValue } from '@/lib/auth/actor';
import { HEALTH_META } from '@/lib/semantic';
import type { HealthLevel, Species } from '@/types/domain';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '星图图鉴',
  description: '校园里已被点亮的每一颗星，按健康状态筛选，找到你想关心的小家伙。',
};

const HEALTH_FILTERS: Array<{ key: 'ALL' | HealthLevel; label: string }> = [
  { key: 'ALL', label: '全部' },
  { key: 'GREEN', label: HEALTH_META.GREEN.label },
  { key: 'YELLOW', label: HEALTH_META.YELLOW.label },
  { key: 'RED', label: HEALTH_META.RED.label },
];

/**
 * 图鉴列表（第 4 阶段欠账）。
 *
 * 与 /map 的分工写在这里，避免以后两个入口长成同一件事：
 *  - 这里是**按档案属性**（健康档、物种、编号/名字）检索，结果是卡片网格；
 *  - /map 是按**地理位置**浏览，结果是地图上的星点。
 * 因此本页刻意不引地图，也刻意不做复杂排序 —— 它要回答的是「有没有一只 X」。
 */
export default async function AnimalsPage({
  searchParams,
}: {
  searchParams: { q?: string; level?: string; species?: string };
}) {
  const q = typeof searchParams.q === 'string' ? searchParams.q.trim() : '';
  const level = (['GREEN', 'YELLOW', 'RED'] as HealthLevel[]).includes(searchParams.level as HealthLevel)
    ? (searchParams.level as HealthLevel)
    : undefined;
  const species = (['CAT', 'DOG'] as Species[]).includes(searchParams.species as Species)
    ? (searchParams.species as Species)
    : undefined;

  const animals = await prisma.animal.findMany({
    where: {
      ...(level ? { healthLevel: level } : {}),
      ...(species ? { species } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { code: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ healthLevel: 'desc' }, { code: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      species: true,
      avatarUrl: true,
      healthLevel: true,
      summary: true,
      mapLat: true,
      mapLng: true,
      createdAt: true,
      _count: { select: { observations: true } },
    },
  });

  // 补充位置入口只给管理员（匿名/学生改位置会被 canEditAnimal 拒绝，界面就不亮出来）
  const cookie = cookies().get(ADMIN_COOKIE)?.value;
  const canSupplementLocation = Boolean(adminToken() && isAdminCookieValue(cookie));

  return (
    <PageShell title="星图图鉴" subtitle="每一颗星都对应校园里的一个小家伙">
      {/* 入口：照片墙 / 数据统计（2026-10-26 需求 #2 #4） */}
      <nav aria-label="图鉴相关页面" className="mb-3 flex gap-2">
        <Link
          href="/photos"
          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full bg-space-800/80 px-3 text-xs text-lo ring-1 ring-space-700 transition-colors duration-star ease-star hover:text-hi hover:ring-accent-400/60"
        >
          <Camera size={13} aria-hidden />
          照片墙
        </Link>
        <Link
          href="/data"
          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full bg-space-800/80 px-3 text-xs text-lo ring-1 ring-space-700 transition-colors duration-star ease-star hover:text-hi hover:ring-accent-400/60"
        >
          <BarChart3 size={13} aria-hidden />
          数据统计
        </Link>
      </nav>

      {/* 夜色玻璃搜索框（旧设计残留的 bg-paper/--ink 已失效，一并修正） */}
      <form className="mb-3 flex max-w-xl items-center gap-2" action="/animals" method="get">
        <div className="flex min-h-[44px] flex-1 items-center gap-2 rounded-full bg-space-800/80 px-4 ring-1 ring-space-700">
          <Search size={15} className="shrink-0 text-lo" aria-hidden />
          <input
            name="q"
            defaultValue={q}
            placeholder="搜索星号、名字或特征"
            aria-label="搜索星号、名字或特征"
            className="min-w-0 flex-1 bg-transparent text-sm text-hi outline-none placeholder:text-lo"
          />
        </div>
        {level && <input type="hidden" name="level" value={level} />}
        {species && <input type="hidden" name="species" value={species} />}
        <button
          type="submit"
          className="min-h-[44px] shrink-0 rounded-full bg-space-800 px-5 text-sm text-hi ring-1 ring-space-700 transition-colors duration-star ease-star hover:bg-space-700"
        >
          搜索
        </button>
      </form>

      <div className="mb-4 flex flex-wrap gap-2">
        {HEALTH_FILTERS.map((f) => {
          const active = f.key === (level ?? 'ALL');
          const params = new URLSearchParams();
          if (q) params.set('q', q);
          if (species) params.set('species', species);
          if (f.key !== 'ALL') params.set('level', f.key);
          const href = params.toString() ? `/animals?${params}` : '/animals';
          return (
            <Link
              key={f.key}
              href={href}
              className={cn(
                'inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-xs transition-colors duration-star ease-star',
                active
                  ? `bg-space-700 ${f.key === 'ALL' ? 'text-hi' : HEALTH_META[f.key].text}`
                  : 'text-lo ring-1 ring-space-700 hover:text-hi',
              )}
            >
              {/* 选中/未选中都有小圆点做颜色冗余编码，不只靠底色区分 */}
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    f.key === 'ALL' ? 'var(--accent-400)' : `var(--star-${f.key.toLowerCase()})`,
                }}
                aria-hidden
              />
              {f.label}
            </Link>
          );
        })}
      </div>

      {animals.length === 0 ? (
        <p className="rounded-card bg-space-800 px-4 py-10 text-center text-sm text-lo">
          没有符合条件的星星。换个筛选，或者去扫描页点亮一颗新的。
        </p>
      ) : (
        // 对齐设计稿图2：桌面端 7 列小卡（PAGE-BLUEPRINT §3.2 的 3 列约定按新设计稿作废）
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
          {animals.map((a) => {
            const unpinned = a.mapLat === null || a.mapLng === null;
            return (
              <div key={a.id} className="flex flex-col gap-1">
                <StarCard
                  animal={{
                    id: a.id,
                    code: a.code,
                    name: a.name,
                    species: a.species,
                    avatarUrl: a.avatarUrl,
                    healthLevel: a.healthLevel,
                    mapLat: a.mapLat,
                    mapLng: a.mapLng,
                    createdAt: a.createdAt.toISOString(),
                    lastSeenAt: null,
                    observationCount: a._count.observations,
                  }}
                />
                {/* 暂无位置的星：管理员可在图鉴里就地补充坐标，补完星图上就能看到 */}
                {canSupplementLocation && unpinned && (
                  <LocationSupplement code={a.code} name={a.name} compact />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 每张星卡上都有一枚健康档徽标 —— 这是健康结论，页面必须带免责声明（R5）。
          之前这一页漏了，图鉴是学生最常翻的一页，漏在这里等于最常见的入口没有护栏。 */}
      <Disclaimer className="mt-6" />
    </PageShell>
  );
}
