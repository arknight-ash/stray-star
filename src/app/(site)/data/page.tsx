import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { PageShell } from '@/components/shell/PageShell';
import { Disclaimer } from '@/components/star/Disclaimer';
import { BarChart, LineChart, PieChart } from '@/components/charts/Charts';
import { HEALTH_META } from '@/lib/semantic';
import type { HealthLevel } from '@/types/domain';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '数据统计',
};

/**
 * 数据小站（2026-10-26 需求 #4「条形图、饼图、折线统计图」）：
 * 全部数据来自真实库表聚合，无假指标 ——
 *  - 条形图：每颗星被记录了多少次（观察最活跃的排名）；
 *  - 环形图：健康档分布（绿/黄/红与全站语义一致）；
 *  - 折线图：近 30 天每日记录趋势。
 */
export default async function DataPage() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [animals, obsGroup, healthGroup, recentObs, openAlerts] = await Promise.all([
    prisma.animal.findMany({
      orderBy: [{ observations: { _count: 'desc' } }],
      select: { code: true, name: true, healthLevel: true, _count: { select: { observations: true } } },
    }),
    prisma.observation.groupBy({ by: ['animalId'], _count: { _all: true } }),
    prisma.animal.groupBy({ by: ['healthLevel'], _count: { _all: true } }),
    prisma.observation.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.alert.count({ where: { status: 'OPEN' } }),
  ]);

  // 条形图：记录数 TOP 8（总数放在 data-mono 里，不挤标签）
  const topAnimals = animals.slice(0, 8).map((a) => ({
    label: `${a.name} · ${a.code}`,
    value: a._count.observations,
    color: HEALTH_META[a.healthLevel].dot,
  }));

  // 环形图：健康档分布（三色顺序固定 绿/黄/红）
  const healthCounts: Record<HealthLevel, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
  for (const g of healthGroup) healthCounts[g.healthLevel] = g._count._all;
  const healthSlices = (['GREEN', 'YELLOW', 'RED'] as const).map((lv) => ({
    label: HEALTH_META[lv].label,
    value: healthCounts[lv],
    color: HEALTH_META[lv].dot,
  }));

  // 折线图：近 30 天每日记录数（按本地日期分桶）
  const buckets = new Map<string, number>();
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    buckets.set(d.toLocaleDateString('zh-CN'), 0);
  }
  for (const o of recentObs) {
    const key = o.createdAt.toLocaleDateString('zh-CN');
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const trend = [...buckets.entries()].map(([label, value]) => ({ label, value }));

  const totalObs = obsGroup.reduce((s, g) => s + g._count._all, 0);

  return (
    <PageShell title="数据统计" subtitle="星图背后，正在发生什么">
      {/* 概览数字 */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '已点亮', value: animals.length },
          { label: '累计记录', value: totalObs },
          { label: '未处理预警', value: openAlerts },
        ].map((s) => (
          <div key={s.label} className="glass-card p-4 text-center">
            <p className="text-xs text-lo">{s.label}</p>
            <p className="data-mono mt-1.5 text-2xl font-medium text-hi">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="glass-card p-5" aria-label="各星观察记录数">
          <h2 className="font-display text-base text-hi">谁最活跃</h2>
          <p className="mb-3 mt-0.5 text-xs text-lo">每颗星被记录的次数（颜色 = 当前健康档）</p>
          {topAnimals.length === 0 ? (
            <EmptyHint text="还没有动物档案" />
          ) : (
            <BarChart items={topAnimals} ariaLabel="各星观察记录数条形图" />
          )}
        </section>

        <section className="glass-card p-5" aria-label="健康档分布">
          <h2 className="font-display text-base text-hi">星况分布</h2>
          <p className="mb-3 mt-0.5 text-xs text-lo">全体星的健康档占比</p>
          {animals.length === 0 ? (
            <EmptyHint text="还没有动物档案" />
          ) : (
            <PieChart slices={healthSlices} ariaLabel="健康档分布环形图" />
          )}
        </section>

        <section className="glass-card p-5 lg:col-span-2" aria-label="近 30 天记录趋势">
          <h2 className="font-display text-base text-hi">近 30 天记录趋势</h2>
          <p className="mb-3 mt-0.5 text-xs text-lo">每天的观察记录条数</p>
          {totalObs === 0 ? (
            <EmptyHint text="近 30 天还没有记录" />
          ) : (
            <LineChart points={trend} ariaLabel="近 30 天每日记录数折线图" />
          )}
        </section>
      </div>

      <p className="mt-4 text-xs text-lo">
        想添一条数据？去
        <Link href="/report" className="text-accent-300 underline underline-offset-2">
          记录一笔
        </Link>
        ，这里的折线就会动起来。
      </p>

      <div className="mt-4">
        <Disclaimer />
      </div>
    </PageShell>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-lo">{text}</p>;
}
