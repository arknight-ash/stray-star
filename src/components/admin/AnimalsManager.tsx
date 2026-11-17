'use client';

import { useMemo, useState } from 'react';
import { Cat, Dog, PawPrint, Search } from 'lucide-react';
import { HEALTH_META, SPECIES_META } from '@/lib/semantic';
import { PageHeader, HeaderButton } from './PageHeader';
import { Pager } from './Pager';
import { AnimalApplications } from './AnimalApplications';
import type { AdminAnimalFull, AnimalApplication } from '@/lib/admin/views';

const PAGE_SIZE = 8;

type StatusFilter = 'ALL' | 'GREEN' | 'YELLOW' | 'RED' | 'PENDING';

const STATUS_OPTIONS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'ALL', label: '全部状态' },
  { key: 'GREEN', label: '健康' },
  { key: 'YELLOW', label: '观察' },
  { key: 'RED', label: '预警' },
  { key: 'PENDING', label: '待核实' },
];

const TYPE_LABEL: Record<string, string> = {
  FEEDING: '投喂',
  HEALTH: '健康',
  BEHAVIOR: '行为',
  OTHER: '其他',
};

function day(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 动物管理（2026-10-27 按设计稿二轮，同日改「新增」为「审核」）。
 *
 * 布局：页头 → 搜索/筛选行 → 卡片网格 + 分页，右侧档案面板（点卡片即切换）。
 * 动物量级小，搜索、筛选、分页、选中全部在客户端做，不往返数据库。
 *
 * 页头动作不再是「+ 新增动物」（原来指向 /scan）：管理端跳去客户端建档案，
 * 等于给管理员开一条绕过识别链路的口子，而且管理员根本回不到自己的工作台。
 * 现在这里只有一个动作 —— 审核同学提交上来的新增申请，在同一屏里看完、按下结论。
 */
export function AnimalsManager({
  animals,
  applications = [],
  initialMode = 'list',
}: {
  animals: AdminAnimalFull[];
  applications?: AnimalApplication[];
  /** 直达审核视图：总览页「申请审核」入口带 ?review=1 进来 */
  initialMode?: 'list' | 'review';
}) {
  const [mode, setMode] = useState<'list' | 'review'>(initialMode);
  const [query, setQuery] = useState('');
  const [species, setSpecies] = useState<'ALL' | 'CAT' | 'DOG'>('ALL');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(animals[0]?.id ?? null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return animals.filter((a) => {
      if (species !== 'ALL' && a.species !== species) return false;
      if (status === 'PENDING' && !a.pendingReview) return false;
      if (status !== 'ALL' && status !== 'PENDING' && a.healthLevel !== status) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.code.toLowerCase().includes(q) ||
        (a.summary ?? '').toLowerCase().includes(q)
      );
    });
  }, [animals, query, species, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const selected = animals.find((a) => a.id === selectedId) ?? pageRows[0] ?? animals[0] ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="动物管理"
        subtitle={
          mode === 'list'
            ? '校园内全部动物档案：健康档位、位置与照片'
            : '同学提交的新增动物申请：核对照片与信息后给出结论'
        }
      >
        <HeaderButton
          onClick={() => setMode(mode === 'list' ? 'review' : 'list')}
          pressed={mode === 'review'}
        >
          {mode === 'list' ? '审核新增申请' : '返回档案列表'}
          {mode === 'list' && applications.length > 0 && `（${applications.length}）`}
        </HeaderButton>
      </PageHeader>

      {mode === 'review' ? (
        <AnimalApplications applications={applications} />
      ) : (
        <>
      {/* 搜索 / 筛选行 */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">搜索动物</span>
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lo"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="搜索动物名字 / 编号 / 位置"
            className="min-h-[36px] w-full rounded-btn bg-space-800/70 pl-8 pr-3 text-xs text-hi ring-1 ring-space-700 outline-none transition-colors duration-star ease-star placeholder:text-lo focus-visible:ring-accent-400"
          />
        </label>
        <select
          value={species}
          onChange={(e) => {
            setSpecies(e.target.value as 'ALL' | 'CAT' | 'DOG');
            setPage(1);
          }}
          aria-label="按种类筛选"
          className="min-h-[36px] rounded-btn bg-space-800/70 px-2.5 text-xs text-lo ring-1 ring-space-700 outline-none focus-visible:ring-accent-400"
        >
          <option value="ALL">全部种类</option>
          <option value="CAT">猫</option>
          <option value="DOG">狗</option>
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as StatusFilter);
            setPage(1);
          }}
          aria-label="按状态筛选"
          className="min-h-[36px] rounded-btn bg-space-800/70 px-2.5 text-xs text-lo ring-1 ring-space-700 outline-none focus-visible:ring-accent-400"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* 卡片网格 */}
        <section aria-label="动物列表" className="min-w-0">
          {pageRows.length === 0 ? (
            <p className="rounded-card border border-dashed border-space-700 p-8 text-center text-sm text-lo">
              没有符合条件的动物。
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {pageRows.map((a) => {
                const health = HEALTH_META[a.healthLevel];
                const active = selected?.id === a.id;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      aria-pressed={active}
                      className={`block w-full overflow-hidden rounded-card text-left ring-1 transition-transform duration-star ease-star hover:scale-[1.02] ${
                        active
                          ? 'ring-accent-400'
                          : 'ring-space-700/60'
                      }`}
                    >
                      <div className="relative aspect-square bg-space-900">
                        {a.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- 缩略小图，next/image 收益为负
                          <img
                            src={a.avatarUrl}
                            alt={`${a.name}的照片`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span
                            className="grid h-full w-full place-items-center text-lo"
                            aria-hidden
                          >
                            <PawPrint size={28} />
                          </span>
                        )}
                        <span
                          className="absolute left-1.5 top-1.5 rounded-sticker px-1.5 py-0.5 text-[10px] backdrop-blur"
                          style={{
                            color: health.dot,
                            backgroundColor:
                              'color-mix(in srgb, var(--space-900) 55%, transparent)',
                          }}
                        >
                          {health.label}
                        </span>
                        {a.openAlerts > 0 && (
                          <span
                            className="absolute right-1.5 top-1.5 rounded-sticker px-1.5 py-0.5 text-[10px]"
                            style={{
                              color: 'var(--star-red)',
                              backgroundColor:
                                'color-mix(in srgb, var(--star-red) 20%, var(--space-900))',
                            }}
                          >
                            预警 {a.openAlerts}
                          </span>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="truncate text-xs font-medium text-hi">
                          {a.name}
                          {a.pendingReview && (
                            <span className="ml-1.5 text-[10px]" style={{ color: 'var(--star-yellow)' }}>
                              待核实
                            </span>
                          )}
                        </p>
                        <p className="data-mono truncate text-[10px] text-lo">{a.code}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <Pager
            page={safePage}
            totalPages={totalPages}
            onChange={setPage}
            total={filtered.length}
            unit="只"
          />
        </section>

        {/* 右侧档案面板 */}
        <aside aria-label="动物档案" className="min-w-0">
          <AnimalPanel animal={selected} />
        </aside>
      </div>
        </>
      )}
    </div>
  );
}

function AnimalPanel({ animal }: { animal: AdminAnimalFull | null }) {
  const [tab, setTab] = useState<'info' | 'health' | 'behavior' | 'photos'>('info');

  if (!animal) {
    return (
      <div className="rounded-card border border-dashed border-space-700 p-8 text-center text-sm text-lo">
        还没有动物档案。
      </div>
    );
  }

  const health = HEALTH_META[animal.healthLevel];
  const SpeciesIcon = animal.species === 'CAT' ? Cat : Dog;

  const TABS = [
    { key: 'info', label: '基本信息' },
    { key: 'health', label: '健康记录' },
    { key: 'behavior', label: '行为记录' },
    { key: 'photos', label: '相关照片' },
  ] as const;

  return (
    <section className="rounded-card bg-space-800/60 ring-1 ring-space-700/70">
      {/* 头部照片 + 名字 */}
      <div className="relative h-40 overflow-hidden rounded-t-card bg-space-900">
        {animal.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 缩略小图
          <img
            src={animal.avatarUrl}
            alt={`${animal.name}的照片`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-lo" aria-hidden>
            <PawPrint size={32} />
          </span>
        )}
        <span
          className="absolute left-3 top-3 rounded-sticker px-2 py-0.5 text-[11px] backdrop-blur"
          style={{
            color: health.dot,
            backgroundColor: 'color-mix(in srgb, var(--space-900) 55%, transparent)',
          }}
        >
          {health.starName}
          {animal.healthManual && '（人工）'}
        </span>
      </div>

      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-lg leading-tight text-hi">{animal.name}</h2>
            <p className="data-mono mt-0.5 text-[11px] text-lo">
              #{animal.code} · {SPECIES_META[animal.species].label}
            </p>
          </div>
          <a
            href={`/admin/animals/${animal.code}`}
            className="shrink-0 rounded-btn border border-space-700 px-2.5 py-1.5 text-[11px] text-lo transition-colors duration-star ease-star hover:text-hi"
          >
            完整档案
          </a>
        </div>

        {animal.summary && <p className="mt-2 text-xs leading-relaxed text-lo">{animal.summary}</p>}

        {/* 页签 */}
        <div className="mt-3 flex gap-1 border-b border-space-700/60" role="tablist" aria-label="档案分区">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-2 pb-1.5 text-xs transition-colors duration-star ease-star ${
                tab === t.key
                  ? 'border-accent-400 text-hi'
                  : 'border-transparent text-lo hover:text-hi'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="pt-3">
          {tab === 'info' && (
            <dl className="space-y-2 text-xs">
              <div className="flex gap-2">
                <dt className="w-14 shrink-0 text-lo">种类</dt>
                <dd className="flex items-center gap-1.5 text-hi">
                  <SpeciesIcon size={13} aria-hidden />
                  {SPECIES_META[animal.species].label}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-14 shrink-0 text-lo">常驻位置</dt>
                <dd className="text-hi">{animal.spotName ?? '未标注'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-14 shrink-0 text-lo">建档日期</dt>
                <dd className="data-mono text-hi">{day(animal.createdAt)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-14 shrink-0 text-lo">统计</dt>
                <dd className="text-hi">
                  照片 {animal.photoCount} · 观察 {animal.observationCount}
                  {animal.openAlerts > 0 && (
                    <span style={{ color: 'var(--star-red)' }}> · 未结预警 {animal.openAlerts}</span>
                  )}
                </dd>
              </div>
              {animal.features.length > 0 && (
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-lo">外观特征</dt>
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
          )}

          {tab === 'health' && (
            <div className="space-y-2">
              {animal.reports.length === 0 ? (
                <p className="text-xs text-lo">暂无健康报告。</p>
              ) : (
                animal.reports.map((r) => {
                  const hm = HEALTH_META[r.healthStatus];
                  return (
                    <article
                      key={r.id}
                      className="rounded-card bg-space-900/40 p-2.5 ring-1 ring-space-700/50"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span style={{ color: hm.dot }}>{hm.label}档 · 置信 {(r.confidence * 100).toFixed(0)}%</span>
                        <span className="data-mono text-lo">{day(r.createdAt)}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-lo" title={r.assessment}>
                        {r.assessment}
                      </p>
                      {r.needsVet && (
                        <p className="mt-1 text-[11px]" style={{ color: 'var(--star-red)' }}>
                          建议就医
                        </p>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          )}

          {tab === 'behavior' && (
            <div className="space-y-2">
              {animal.observations.length === 0 ? (
                <p className="text-xs text-lo">暂无观察记录。</p>
              ) : (
                animal.observations.map((o) => (
                  <article
                    key={o.id}
                    className="rounded-card bg-space-900/40 p-2.5 ring-1 ring-space-700/50"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-lo">
                      <span>
                        {TYPE_LABEL[o.type] ?? o.type} · {o.authorLabel}
                        {o.spotName && ` · ${o.spotName}`}
                      </span>
                      <span className="data-mono">{day(o.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-lo" title={o.content}>
                      {o.content}
                    </p>
                    {o.pendingReview && (
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--star-yellow)' }}>
                        待核实
                      </p>
                    )}
                  </article>
                ))
              )}
            </div>
          )}

          {tab === 'photos' && (
            <div>
              {animal.photos.length === 0 ? (
                <p className="text-xs text-lo">暂无照片。</p>
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
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
