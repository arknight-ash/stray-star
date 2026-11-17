import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MapPin, Microscope, Camera, ClipboardList, Siren } from 'lucide-react';
import { requireAdmin } from '@/lib/admin/guard';
import { loadAnimalDetail } from '@/lib/admin/views';
import { DeleteAnimalButton } from '@/components/animal/DeleteAnimalButton';
import { HEALTH_META, SEVERITY_META, ALERT_META, SPECIES_META } from '@/lib/semantic';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: `档案 ${code} · 管理端`, robots: { index: false, follow: false } };
}

function day(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function time(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const OBS_TYPE_LABEL: Record<string, string> = {
  FEEDING: '投喂',
  HEALTH: '健康',
  BEHAVIOR: '行为',
  OTHER: '其他',
};

/**
 * 动物档案详情（2026-10-27 新增，设计稿动物管理页右侧面板的完整版）。
 *
 * 管理端的档案页与用户端 /animals/[code] 分开：这里不做互动，
 * 只把管理员需要的全部事实（照片、报告、观察、预警）在一页里摊平 ——
 * 处置时来回跳页比滚动更浪费时间。
 */
export default async function AdminAnimalDetailPage({ params }: Props) {
  requireAdmin();
  const { code } = await params;
  const animal = await loadAnimalDetail(decodeURIComponent(code));
  if (!animal) notFound();

  const health = HEALTH_META[animal.healthLevel];

  return (
    <div className="space-y-4">
      {/* 返回 + 标题 */}
      <header className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/animals"
          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-btn border border-space-700 px-3 text-xs text-lo transition-colors duration-star ease-star hover:text-hi"
        >
          <ArrowLeft size={14} aria-hidden />
          返回列表
        </Link>
        <h1 className="font-display text-[17px] text-hi">
          {animal.name}
          <span className="data-mono ml-2 text-xs text-lo">#{animal.code}</span>
        </h1>
        <span
          className="rounded-sticker px-2 py-0.5 text-[11px]"
          style={{ color: health.dot, backgroundColor: health.bg }}
        >
          {health.starName}
          {animal.healthManual && '（人工设定）'}
        </span>
        {animal.pendingReview && (
          <span
            className="rounded-sticker px-2 py-0.5 text-[11px]"
            style={{
              color: 'var(--star-yellow)',
              backgroundColor: 'color-mix(in srgb, var(--star-yellow) 14%, transparent)',
            }}
          >
            待核实档案
          </span>
        )}
        {/* 删除档案只在这里：客户端已无删除入口（2026-10-27），
            下架「已经找不到的小动物」是管理员的活，且必须知道会连坐删掉什么。 */}
        <span className="ml-auto">
          <DeleteAnimalButton
            code={animal.code}
            name={animal.name}
            observationCount={animal.observationCount}
            redirectTo="/admin/animals"
          />
        </span>
      </header>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* 左：照片与基本信息 */}
        <div className="min-w-0 space-y-4">
          <section aria-label="照片墙" className="rounded-card bg-space-800/60 p-3 ring-1 ring-space-700/70">
            <h2 className="mb-2.5 flex items-center gap-1.5 font-display text-[15px] text-hi">
              <Camera size={15} style={{ color: 'var(--accent-300)' }} aria-hidden />
              相关照片
              <span className="ml-auto text-[11px] font-normal text-lo">{animal.photos.length} 张</span>
            </h2>
            {animal.photos.length === 0 ? (
              <p className="rounded-card border border-dashed border-space-700 p-4 text-center text-xs text-lo">
                还没有照片。
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-2">
                {animal.photos.map((p) => (
                  <li key={p.id} className="overflow-hidden rounded-card ring-1 ring-space-700/50">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 缩略小图 */}
                    <img
                      src={p.url}
                      alt={`${animal.name}的照片`}
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="基本信息" className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70">
            <h2 className="mb-3 font-display text-[15px] text-hi">基本信息</h2>
            <dl className="space-y-2 text-xs">
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-lo">种类</dt>
                <dd className="text-hi">{SPECIES_META[animal.species].label}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-lo">常驻位置</dt>
                <dd className="flex items-center gap-1 text-hi">
                  <MapPin size={12} aria-hidden />
                  {animal.spotName ?? '未标注'}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-lo">建档日期</dt>
                <dd className="data-mono text-hi">{day(animal.createdAt)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-lo">更新时间</dt>
                <dd className="data-mono text-hi">{day(animal.updatedAt)}</dd>
              </div>
              {animal.summary && (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-lo">最新状态</dt>
                  <dd className="text-hi">{animal.summary}</dd>
                </div>
              )}
              {animal.features.length > 0 && (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-lo">外观特征</dt>
                  <dd className="flex flex-wrap gap-1">
                    {animal.features.map((f) => (
                      <span
                        key={f}
                        className="rounded-sticker bg-space-900/60 px-1.5 py-0.5 text-[11px] text-lo"
                      >
                        {f}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        </div>

        {/* 右：报告 / 观察 / 预警 */}
        <div className="min-w-0 space-y-4">
          <section aria-label="健康报告" className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70">
            <h2 className="mb-3 flex items-center gap-1.5 font-display text-[15px] text-hi">
              <Microscope size={15} style={{ color: 'var(--accent-300)' }} aria-hidden />
              健康报告
              <span className="ml-auto text-[11px] font-normal text-lo">{animal.reports.length} 条</span>
            </h2>
            {animal.reports.length === 0 ? (
              <p className="rounded-card border border-dashed border-space-700 p-4 text-center text-xs text-lo">
                暂无健康报告。
              </p>
            ) : (
              <ul className="space-y-2">
                {animal.reports.map((r) => {
                  const hm = HEALTH_META[r.healthStatus];
                  return (
                    <li
                      key={r.id}
                      className="rounded-card bg-space-900/40 p-2.5 ring-1 ring-space-700/50"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span
                          className="rounded-sticker px-1.5 py-0.5"
                          style={{ color: hm.dot, backgroundColor: hm.bg }}
                        >
                          {hm.label}档
                        </span>
                        <span className="text-lo">{SEVERITY_META[r.severity].label}</span>
                        <span className="text-lo">置信 {(r.confidence * 100).toFixed(0)}%</span>
                        {r.needsVet && (
                          <span style={{ color: 'var(--star-red)' }}>建议就医</span>
                        )}
                        <span className="data-mono ml-auto text-lo">{time(r.createdAt)}</span>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-lo">{r.assessment}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-label="观察记录" className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70">
            <h2 className="mb-3 flex items-center gap-1.5 font-display text-[15px] text-hi">
              <ClipboardList size={15} style={{ color: 'var(--accent-300)' }} aria-hidden />
              观察记录
              <span className="ml-auto text-[11px] font-normal text-lo">{animal.observations.length} 条</span>
            </h2>
            {animal.observations.length === 0 ? (
              <p className="rounded-card border border-dashed border-space-700 p-4 text-center text-xs text-lo">
                暂无观察记录。
              </p>
            ) : (
              <ul className="space-y-2">
                {animal.observations.map((o) => (
                  <li
                    key={o.id}
                    className="rounded-card bg-space-900/40 p-2.5 ring-1 ring-space-700/50"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-lo">
                      <span className="rounded-sticker bg-space-800 px-1.5 py-0.5">
                        {OBS_TYPE_LABEL[o.type] ?? o.type}
                      </span>
                      <span>{o.authorLabel}</span>
                      {o.spotName && <span>{o.spotName}</span>}
                      {o.pendingReview && (
                        <span style={{ color: 'var(--star-yellow)' }}>待核实</span>
                      )}
                      <span className="data-mono ml-auto">{time(o.createdAt)}</span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-lo">{o.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="预警历史" className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70">
            <h2 className="mb-3 flex items-center gap-1.5 font-display text-[15px] text-hi">
              <Siren size={15} style={{ color: 'var(--accent-300)' }} aria-hidden />
              预警历史
              <span className="ml-auto text-[11px] font-normal text-lo">{animal.alerts.length} 条</span>
            </h2>
            {animal.alerts.length === 0 ? (
              <p className="rounded-card border border-dashed border-space-700 p-4 text-center text-xs text-lo">
                暂无预警记录。
              </p>
            ) : (
              <ul className="space-y-2">
                {animal.alerts.map((a) => {
                  const am = ALERT_META[a.level];
                  return (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center gap-2 rounded-card bg-space-900/40 p-2.5 text-xs ring-1 ring-space-700/50"
                    >
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: am.dot }}
                        aria-hidden
                      />
                      <span style={{ color: am.dot }}>{am.label}</span>
                      <span className="min-w-0 flex-1 truncate text-lo" title={a.reason}>
                        {a.reason}
                      </span>
                      <span className="data-mono text-lo">{time(a.createdAt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
