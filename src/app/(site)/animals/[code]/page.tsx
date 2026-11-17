import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Heart, PenLine } from 'lucide-react';
import { prisma } from '@/lib/db';
import { BackButton } from '@/components/shell/BackButton';
import { loadTimeline, displayAuthor } from '@/lib/db/timeline';
import { SPECIES_META, HEALTH_META } from '@/lib/semantic';
import { HealthSpectrum } from '@/components/star/HealthSpectrum';
import { AssessHealthPanel } from '@/components/health/AssessHealthPanel';
import { LatestHealthCard } from '@/components/health/LatestHealthCard';
import { Disclaimer } from '@/components/star/Disclaimer';
import { TimelineList } from '@/components/notebook/TimelineList';
import { NoteWallHost } from '@/components/notebook/NoteWallHost';
import type { NoteVM } from '@/types/domain';

export const dynamic = 'force-dynamic';

interface Props {
  params: { code: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const animal = await prisma.animal.findUnique({
    where: { code: params.code },
    select: { name: true, code: true, summary: true },
  });
  if (!animal) return { title: '没有找到这颗星' };
  return {
    title: `${animal.name} · ${animal.code}`,
    description: animal.summary ?? `${animal.code} ${animal.name} 的救助手账`,
  };
}

/**
 * 档案页 = 档案手账（2026-10-26 对齐设计稿双栏形态）：
 * 左栏：身份卡（照片 + 名字/标签 + 编号/发现时间 + 特征 chips + 简介 + 近期照片 + 记录一笔）；
 * 右栏：健康记录（最近一次 AI 初筛）+ 观察记录（众包便签墙）；
 * 通栏：手账时间线。
 *
 * 数据全在这里取：这是一棵树唯一的 Server Component，
 * 客户端子树（评估面板、便签墙、记录条）只拿它渲染好的 props，
 * 不再各自 fetch —— 否则「千人配置为王口径的数据」会在不同子树里长出两个版本。
 */
export default async function AnimalProfilePage({ params }: Props) {
  const animal = await prisma.animal.findUnique({
    where: { code: params.code },
    select: {
      id: true,
      code: true,
      name: true,
      species: true,
      avatarUrl: true,
      summary: true,
      features: true,
      healthLevel: true,
      healthManual: true,
      mapLat: true,
      mapLng: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!animal) notFound();

  const [observations, timeline, latestReport] = await Promise.all([
    prisma.observation.findMany({
      where: { animalId: animal.id },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        id: true,
        content: true,
        tags: true,
        type: true,
        severity: true,
        imageUrl: true,
        createdAt: true,
        pendingReview: true,
        authorName: true,
        user: { select: { name: true } },
      },
    }),
    loadTimeline(animal.id, { createdAt: animal.createdAt, features: animal.features }),
    prisma.healthReport.findFirst({
      where: { animalId: animal.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        assessment: true,
        severity: true,
        healthStatus: true,
        needsVet: true,
        advice: true,
        confidence: true,
        disclaimer: true,
        createdAt: true,
      },
    }),
  ]);

  const notes: NoteVM[] = observations.map((o) => ({
    id: o.id,
    content: o.content,
    tags: o.tags,
    type: o.type,
    severity: o.severity,
    imageUrl: o.imageUrl,
    authorName: displayAuthor(o.user?.name, o.authorName),
    at: o.createdAt.toISOString(),
    pendingReview: o.pendingReview,
  }));

  const pendingCount = notes.filter((n) => n.pendingReview).length;
  // 近期照片：只取带图的三张（设计稿的「近期照片」缩略图行）
  const recentPhotos = observations.filter((o) => o.imageUrl).slice(0, 3);

  // 时间线四类事件的图例 —— 只做图例，不虚构进度
  const TIMELINE_LEGEND: Array<{ label: string; glyph: string; color: string }> = [
    { label: '档案点亮', glyph: '✦', color: 'var(--accent-400)' },
    { label: '健康报告', glyph: '＋', color: 'var(--star-green)' },
    { label: '群众记录', glyph: '·', color: 'var(--text-lo)' },
    { label: '预警核实', glyph: '!', color: 'var(--star-red)' },
  ];

  const health = HEALTH_META[animal.healthLevel];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 md:pb-16">
      {/* 顶栏：返回上一页。
          删除入口不放在客户端：档案是共享资产，下架「已经找不到的小动物」统一由管理员
          在管理端执行（canDelete 也只放行管理员），避免一次误触清掉所有人的记录。 */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <BackButton fallback="/animals" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        {/* ── 左栏：身份卡 + AI 评估 ── */}
        <div className="space-y-5">
          <section className="glass-card p-4" aria-label="身份卡">
            <div className="flex items-start gap-4">
              {animal.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={animal.avatarUrl}
                  alt={`${animal.name}（${animal.code}）`}
                  className="h-28 w-28 shrink-0 rounded-card object-cover ring-1 ring-space-700"
                />
              ) : (
                <span
                  className="grid h-28 w-28 shrink-0 place-items-center rounded-card bg-space-700/50 font-display text-3xl text-hi"
                  aria-hidden
                >
                  {SPECIES_META[animal.species].glyph}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-2xl leading-tight text-hi">{animal.name}</h1>
                  <span
                    className="rounded-sticker px-2 py-0.5 text-[11px]"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--accent-500) 22%, transparent)',
                      color: 'var(--accent-300)',
                    }}
                  >
                    {SPECIES_META[animal.species].label}
                  </span>
                  {animal.healthManual && (
                    <span
                      className="rounded-sticker px-2 py-0.5 text-[11px]"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--star-yellow) 20%, transparent)',
                        color: 'var(--star-yellow)',
                      }}
                    >
                      管理员手动设定
                    </span>
                  )}
                </div>

                <dl className="mt-2 space-y-1 text-xs text-lo">
                  <div className="flex gap-2">
                    <dt className="shrink-0">编号：</dt>
                    <dd className="data-mono text-hi">#{animal.code}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0">发现时间：</dt>
                    <dd className="data-mono text-hi">
                      {new Date(animal.createdAt).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </dd>
                  </div>
                </dl>

                {/* 健康档 + 特征 chips（设计稿的「健康 / 活跃 / 已绝育」行） */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span
                    className="chip-glass inline-flex items-center gap-1 px-2 py-0.5 text-[11px]"
                    style={{ color: health.text }}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: health.dot }}
                      aria-hidden
                    />
                    {health.label}
                  </span>
                  {animal.features.slice(0, 3).map((f) => (
                    <span key={f} className="chip-glass inline-flex items-center px-2 py-0.5 text-[11px]">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <HealthSpectrum level={animal.healthLevel} size="md" />
            </div>

            {animal.summary && (
              <div className="mt-3 border-t border-space-700/60 pt-3">
                <h2 className="text-xs font-medium text-hi">动物简介</h2>
                <p className="mt-1 text-xs leading-relaxed text-lo">{animal.summary}</p>
              </div>
            )}

            {recentPhotos.length > 0 && (
              <div className="mt-3">
                <h2 className="text-xs font-medium text-hi">近期照片</h2>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {recentPhotos.map((o) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={o.id}
                      src={o.imageUrl as string}
                      alt={`${animal.name}的近期照片`}
                      className="aspect-square w-full rounded-btn object-cover ring-1 ring-space-700"
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2">
              <Link
                href={`/report?animal=${animal.code}`}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-medium text-hi shadow-glow transition-opacity duration-star ease-star hover:opacity-90"
                style={{ backgroundImage: 'var(--grad-cta)' }}
              >
                <PenLine size={15} aria-hidden />
                记录一笔
              </Link>
              <span
                className="grid h-11 w-11 place-items-center rounded-full bg-space-800 text-lo ring-1 ring-space-700"
                title="喜欢功能暂未开放"
                aria-hidden
              >
                <Heart size={16} />
              </span>
            </div>
          </section>

          <AssessHealthPanel animalId={animal.id} animalName={animal.name} />

          {pendingCount > 0 && (
            <p className="rounded-card border border-dashed border-space-700 px-4 py-2 text-xs text-lo">
              有 {pendingCount} 条记录待管理员核实，核实后会正式计入它的档案。
            </p>
          )}
        </div>

        {/* ── 右栏：健康记录 + 观察记录 ── */}
        <div className="space-y-5">
          <section aria-label="健康记录" className="space-y-3">
            <h2 className="flex items-center gap-1.5 px-1 text-xs font-medium text-hi">
              <span aria-hidden>✦</span> 健康记录
            </h2>
            {latestReport ? (
              <LatestHealthCard
                report={{
                  assessment: latestReport.assessment,
                  healthStatus: latestReport.healthStatus,
                  severity: latestReport.severity,
                  needsVet: latestReport.needsVet,
                  advice: latestReport.advice,
                  confidence: latestReport.confidence,
                  disclaimer: latestReport.disclaimer,
                  createdAt: latestReport.createdAt.toISOString(),
                }}
              />
            ) : (
              <p className="rounded-card border border-dashed border-space-700 p-4 text-center text-xs text-lo">
                还没有健康记录，拍一张照片做一次 AI 初筛就有了。
              </p>
            )}
          </section>

          <NoteWallHost notes={notes} animalCode={animal.code} animalName={animal.name} />
        </div>
      </div>

      {/* ── 通栏：手账时间线（四类事件图例条）── */}
      <section className="glass-card mt-5 p-4" aria-label="手账时间线">
        <h2 className="font-display text-base text-hi">手账时间线</h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-space-700/60 pb-3">
          {TIMELINE_LEGEND.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1 text-[11px] text-lo">
              <span className="font-bold" style={{ color: item.color }} aria-hidden>
                {item.glyph}
              </span>
              {item.label}
            </span>
          ))}
        </div>
        <div className="pt-4">
          <TimelineList entries={timeline} />
        </div>
      </section>

      {/* 页面级免责声明：没有 AI 报告时，档案上的健康档依然来自规则派生，
          一样是「关于这只动物的健康结论」，同样需要护栏（R5） */}
      <Disclaimer className="mt-6" />

      {/* 移动端固定「记录一笔」压在便签墙底部，留出它的高度避免遮住最后一条内容 */}
      <div className="h-24 md:h-0" aria-hidden />
    </main>
  );
}
