import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { MapExplorer, type RecentObsItem } from '@/components/map/MapExplorer';
import { getObservatoryNote } from '@/lib/insight/observatory';
import { Disclaimer } from '@/components/star/Disclaimer';
import type { HealthLevel, StarPinAlertVM, StarPinAnimalVM } from '@/types/domain';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '校园星图 · 智护流浪星',
  description: '在熟悉的校园里，寻找那些被温柔以待的生命。',
};

/**
 * 星图页（2026-10-26 对齐设计稿 31975891）：左大地图卡（类型筛选 + 区域快跳）
 * + 右栏（选中星详情 / 收集进度 / 最近发现）。地图从首页撤到这里后按探索式布局重做。
 * 本页只查库 + 组装 VM，交互全部在 `<MapExplorer>`（client）里。
 */
export default async function MapPage() {
  const [animals, alerts, recentObs, note] = await Promise.all([
    prisma.animal.findMany({
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        id: true,
        code: true,
        name: true,
        species: true,
        healthLevel: true,
        avatarUrl: true,
        mapLat: true,
        mapLng: true,
        observations: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true },
        },
        _count: { select: { observations: true } },
        healthReports: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { assessment: true, healthStatus: true },
        },
      },
    }),
    prisma.alert.findMany({
      where: { status: 'OPEN' },
      select: { animalId: true, status: true, level: true, reason: true },
    }),
    prisma.observation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: {
        id: true,
        type: true,
        createdAt: true,
        animal: { select: { code: true, name: true, avatarUrl: true } },
      },
    }),
    // AI 主动观察的那句话：内部有指纹缓存，命中时不烧模型调用
    getObservatoryNote({ db: prisma }),
  ]);

  const counts: Record<HealthLevel, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
  const mapAnimals: StarPinAnimalVM[] = animals.map((animal) => {
    counts[animal.healthLevel] += 1;
    return {
      id: animal.id,
      code: animal.code,
      name: animal.name,
      species: animal.species,
      healthLevel: animal.healthLevel,
      avatarUrl: animal.avatarUrl,
      mapLat: animal.mapLat,
      mapLng: animal.mapLng,
      latestNote: animal.observations[0]?.content ?? null,
      latestReport: animal.healthReports[0] ?? null,
      observationCount: animal._count.observations,
    };
  });
  const mapAlerts: StarPinAlertVM[] = alerts;

  const recent: RecentObsItem[] = recentObs.map((o) => ({
    id: o.id,
    type: o.type,
    createdAt: o.createdAt.toISOString(),
    animalCode: o.animal.code,
    animalName: o.animal.name,
    avatarUrl: o.animal.avatarUrl,
  }));

  return (
    <main className="relative mx-auto w-full max-w-7xl px-3 pb-28 pt-4 md:pb-16 lg:px-4">
      {/* 背景氛围光：两团蓝紫径向渐变，让整页"浮"在夜空里（纯装饰，不吃交互） */}
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage:
            'radial-gradient(60% 45% at 18% 8%, color-mix(in srgb, var(--accent-600) 22%, transparent), transparent), radial-gradient(55% 40% at 88% 82%, color-mix(in srgb, var(--accent-500) 16%, transparent), transparent)',
        }}
        aria-hidden
      />

      <MapExplorer animals={mapAnimals} alerts={mapAlerts} recent={recent} note={note} />

      {/* 设计稿底部的手写体点题句：两侧星轨，中间渐变标题 */}
      <div className="mt-7 flex items-center justify-center gap-3">
        <span
          className="h-px w-16"
          style={{
            backgroundImage:
              'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent-400) 70%, transparent))',
          }}
          aria-hidden
        />
        <p className="text-center font-display text-sm text-accent-300">
          ✦ 每一颗星，都是生命的痕迹
        </p>
        <span
          className="h-px w-16"
          style={{
            backgroundImage:
              'linear-gradient(90deg, color-mix(in srgb, var(--accent-400) 70%, transparent), transparent)',
          }}
          aria-hidden
        />
      </div>

      <div className="mt-4">
        <Disclaimer />
      </div>
    </main>
  );
}
