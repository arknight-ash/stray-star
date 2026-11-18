'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, LineChart as LineChartIcon, Loader, Siren } from 'lucide-react';
import { nearestSpot } from '@/lib/map-config';
import { AlertActions } from './AlertActions';
import { ReportReviewCard } from './ReportReviewCard';
import { PageHeader } from './PageHeader';
import { StatCards } from './StatCards';
import { Pager } from './Pager';
import type {
  AlertsPageData as Board,
  AdminAlertVM,
  AdminReportVM,
  AlertStatus,
  AlertTrendDay,
  AlertPhotoCard,
} from './types';

type Filter = 'ALL' | AlertStatus | 'MANUAL';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: '全部' },
  { key: 'OPEN', label: '未处理' },
  { key: 'ACK', label: '处理中' },
  { key: 'RESOLVED', label: '已处理' },
  // 同学手动标记「情况紧急」的那几条（规则 R4）。人喊紧急比 AI 初筛稀罕得多，
  // 值得单占一个筛选位，而不是淹在「未处理」里靠人自己读 reason 认出来。
  { key: 'MANUAL', label: '同学标记紧急' },
];

const STATUS_LABEL: Record<AlertStatus, string> = {
  OPEN: '未处理',
  ACK: '处理中',
  RESOLVED: '已解决',
};

const STATUS_STYLE: Record<AlertStatus, { color: string; bg: string }> = {
  OPEN: { color: 'var(--star-red)', bg: 'color-mix(in srgb, var(--star-red) 14%, transparent)' },
  ACK: { color: 'var(--star-yellow)', bg: 'color-mix(in srgb, var(--star-yellow) 14%, transparent)' },
  RESOLVED: { color: 'var(--star-green)', bg: 'color-mix(in srgb, var(--star-green) 14%, transparent)' },
};

const SOURCE_LABEL: Record<string, string> = {
  OBSERVATION: '同学上报',
  HEALTH_REPORT: 'AI 初筛',
};

const PAGE_SIZE = 8;

function short(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 位置列：离哪个校园角落最近；没坐标就「未标注」（口径与星图一致） */
function spotOf(a: AdminAlertVM): string {
  if (a.animal.mapLat === null || a.animal.mapLng === null) return '未标注';
  return nearestSpot(a.animal.mapLat, a.animal.mapLng)?.name ?? '未标注';
}

/**
 * 处置台主体（2026-10-27 按设计稿二轮改版）。
 *
 * 布局：页头 + 三张状态卡 → 左（预警表格 + 报告审核）右（7 天趋势 + 预警照片）。
 * 数据一次性取全、筛选和分页都在客户端做：待办量在几十条量级，
 * 为切一次 chips 往返一次数据库不划算。
 */
export function AlertBoard({ board: initial }: { board: Board }) {
  const [items, setItems] = useState<AdminAlertVM[]>(initial.items);
  const [reports, setReports] = useState<AdminReportVM[]>(initial.reports);
  const [counts, setCounts] = useState(initial.counts);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [page, setPage] = useState(1);

  const visible = useMemo(() => {
    if (filter === 'ALL') return items;
    if (filter === 'MANUAL') return items.filter((a) => a.manualSevere);
    return items.filter((a) => a.status === filter);
  }, [items, filter]);

  // 顶部提醒条只列「还没结掉」的：已解决的紧急件留在表格里可查，不该继续占首屏。
  const urgent = useMemo(
    () => items.filter((a) => a.manualSevere && a.status !== 'RESOLVED'),
    [items],
  );
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function onAlertDone(next: AdminAlertVM) {
    // updater 必须是纯函数：React 18 StrictMode 会调两次，计数不能写在 updater 里
    const before = items.find((a) => a.id === next.id);
    setItems((prev) => prev.map((a) => (a.id === next.id ? next : a)));

    if (before && before.status !== next.status) {
      setCounts((c) => {
        const copy = { ...c };
        copy[before.status] = Math.max(0, copy[before.status] - 1);
        copy[next.status] += 1;
        return copy;
      });
    }
  }

  function onReportDone(next: AdminReportVM) {
    setReports((prev) => prev.map((r) => (r.id === next.id ? next : r)));
  }

  return (
    <div className="space-y-4">
      <PageHeader title="预警处置台" subtitle="同学上报与 AI 初筛的预警在这里认领、跟进、关闭" />

      <StatCards
        items={[
          {
            label: '待处置预警',
            value: counts.OPEN,
            hint: '需要认领',
            Icon: AlertTriangle,
            color: 'var(--star-red)',
          },
          {
            label: '处理中',
            value: counts.ACK,
            hint: '已认领跟进',
            Icon: Loader,
            color: 'var(--star-yellow)',
          },
          {
            label: '已处理',
            value: counts.RESOLVED,
            hint: '已关闭',
            Icon: CheckCircle2,
            color: 'var(--star-green)',
          },
        ]}
      />

      {/* 同学标记「情况紧急」的提醒条：AI 初筛是常事，人在现场喊紧急不是。
          这几条必须出现在首屏、带动物名与原因，而不是让管理员自己读 reason 去认。 */}
      {urgent.length > 0 && (
        <section
          aria-label="同学标记紧急的提醒"
          className="rounded-card p-3.5 ring-1"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--star-red) 10%, var(--space-800))',
            borderColor: 'color-mix(in srgb, var(--star-red) 40%, transparent)',
          }}
        >
          <header className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 font-display text-[15px] text-hi">
              <Siren size={15} style={{ color: 'var(--star-red)' }} aria-hidden />
              同学标记紧急
            </span>
            <span
              className="rounded-sticker px-1.5 py-0.5 text-[11px]"
              style={{
                color: 'var(--star-red)',
                backgroundColor: 'color-mix(in srgb, var(--star-red) 16%, transparent)',
              }}
            >
              {urgent.length} 条待处置
            </span>
            <button
              type="button"
              onClick={() => {
                setFilter('MANUAL');
                setPage(1);
              }}
              className="ml-auto inline-flex min-h-[28px] items-center rounded-sticker border border-space-700 px-2.5 text-[11px] text-lo transition-colors duration-star ease-star hover:text-hi"
            >
              只看这些
            </button>
          </header>
          <ul className="space-y-1.5">
            {urgent.slice(0, 4).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <a
                  href={`/admin/animals/${a.animal.code}`}
                  className="text-hi underline-offset-2 hover:underline"
                >
                  {a.animal.name}
                  <span className="data-mono ml-1.5 text-[10px] text-lo">{a.animal.code}</span>
                </a>
                <span className="data-mono text-[11px] text-lo">{short(a.createdAt)}</span>
                <span className="text-lo">
                  {STATUS_LABEL[a.status]} · {SOURCE_LABEL[a.source ?? ''] ?? '同学上报'}
                </span>
              </li>
            ))}
          </ul>
          {urgent.length > 4 && (
            <p className="mt-1.5 text-[11px] text-lo">另有 {urgent.length - 4} 条，见下方列表。</p>
          )}
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* 左栏：预警表格 + 关键报告审核 */}
        <div className="min-w-0 space-y-4">
          <section
            aria-label="最近预警"
            className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70"
          >
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-[15px] text-hi">最近预警</h2>
              <div className="flex flex-wrap gap-1" role="group" aria-label="按状态筛选">
                {FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setFilter(key);
                      setPage(1);
                    }}
                    aria-pressed={filter === key}
                    className={
                      filter === key
                        ? 'min-h-[30px] rounded-sticker bg-accent-400 px-2.5 text-xs font-medium text-space-900'
                        : 'min-h-[30px] rounded-sticker border border-space-700 px-2.5 text-xs text-lo transition-colors duration-star ease-star hover:text-hi'
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </header>

            {pageRows.length === 0 ? (
              <p className="rounded-card border border-dashed border-space-700 p-6 text-center text-sm text-lo">
                {filter === 'ALL' ? '今晚没有待处理的预警。' : '这个状态下没有记录。'}
              </p>
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="text-[11px] text-lo">
                      <th scope="col" className="px-2 pb-2 font-normal">编号</th>
                      <th scope="col" className="px-2 pb-2 font-normal">预警动物</th>
                      <th scope="col" className="px-2 pb-2 font-normal">预警类型</th>
                      <th scope="col" className="px-2 pb-2 font-normal">发现时间</th>
                      <th scope="col" className="px-2 pb-2 font-normal">位置</th>
                      <th scope="col" className="px-2 pb-2 font-normal">状态</th>
                      <th scope="col" className="px-2 pb-2 font-normal">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((alert) => {
                      const st = STATUS_STYLE[alert.status];
                      return (
                        <tr
                          key={alert.id}
                          className="border-t border-space-700/50 transition-colors duration-star ease-star hover:bg-space-900/40"
                        >
                          <td className="px-2 py-2.5">
                            <span className="data-mono text-[11px] text-lo" title={alert.reason}>
                              {alert.id.slice(-6).toUpperCase()}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5">
                            <a
                              href={`/admin/animals/${alert.animal.code}`}
                              className="text-hi underline-offset-2 hover:underline"
                            >
                              {alert.animal.name}
                              <span className="data-mono ml-1.5 text-[11px] text-lo">
                                {alert.animal.code}
                              </span>
                            </a>
                          </td>
                          <td className="max-w-[220px] truncate px-2 py-2.5 text-lo" title={alert.reason}>
                            {alert.manualSevere && (
                              <span
                                className="mr-1.5 rounded-sticker px-1.5 py-0.5 text-[10px]"
                                style={{
                                  color: 'var(--star-red)',
                                  backgroundColor:
                                    'color-mix(in srgb, var(--star-red) 16%, transparent)',
                                }}
                              >
                                同学标记紧急
                              </span>
                            )}
                            {alert.reason}
                            <span className="ml-1.5 whitespace-nowrap text-[10px] text-lo/80">
                              {SOURCE_LABEL[alert.source ?? ''] ?? '未记录来源'}
                            </span>
                          </td>
                          <td className="data-mono whitespace-nowrap px-2 py-2.5 text-lo">
                            {short(alert.createdAt)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-lo">{spotOf(alert)}</td>
                          <td className="px-2 py-2.5">
                            <span
                              className="inline-block whitespace-nowrap rounded-sticker px-1.5 py-0.5 text-[11px]"
                              style={{ color: st.color, backgroundColor: st.bg }}
                            >
                              {STATUS_LABEL[alert.status]}
                            </span>
                          </td>
                          <td className="px-2 py-2.5">
                            <AlertActions alert={alert} onDone={onAlertDone} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <Pager
              page={safePage}
              totalPages={totalPages}
              onChange={setPage}
              total={visible.length}
              unit="条"
            />
          </section>

          <section
            aria-label="关键报告审核"
            className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70"
          >
            <h2 className="mb-1 font-display text-[15px] text-hi">关键报告审核</h2>
            <p className="mb-3 text-xs text-lo">
              只列 AI 判为重度异常或建议就医的报告。通过后计入正式档案；驳回会打红标并留理由；修改会再做一次安全校正。
            </p>
            {reports.length === 0 ? (
              <p className="rounded-card border border-dashed border-space-700 p-4 text-center text-sm text-lo">
                暂时没有需要审核的关键报告。
              </p>
            ) : (
              <ul className="space-y-2">
                {reports.map((r) => (
                  <li key={r.id}>
                    <ReportReviewCard report={r} onDone={onReportDone} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* 右栏：7 天趋势 + 预警照片 */}
        <aside className="min-w-0 space-y-4" aria-label="趋势与照片">
          <AlertTrendPanel trend={initial.trend} />
          <AlertPhotoWall cards={initial.photoCards} />
        </aside>
      </div>
    </div>
  );
}

/** 近 7 天预警趋势：新增（紫）与已解决（绿虚线）两条线，纯 SVG 不引图表库 */
function AlertTrendPanel({ trend }: { trend: AlertTrendDay[] }) {
  const max = Math.max(1, ...trend.map((t) => Math.max(t.total, t.resolved)));
  const W = 100;
  const H = 42;
  const x = (i: number) => (trend.length === 1 ? W / 2 : (i / (trend.length - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 6) - 2;
  const line = (pick: (t: AlertTrendDay) => number) =>
    trend.map((t, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(pick(t)).toFixed(2)}`).join(' ');
  const area = `${line((t) => t.total)} L${W},${H} L0,${H} Z`;

  return (
    <section
      aria-label="近7天预警趋势"
      className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70"
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-display text-[15px] text-hi">
          <LineChartIcon size={15} style={{ color: 'var(--accent-300)' }} aria-hidden />
          近7天预警趋势
        </h2>
        <div className="flex items-center gap-2.5 text-[11px] text-lo">
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-3 rounded-full"
              style={{ backgroundColor: 'var(--accent-400)' }}
              aria-hidden
            />
            新增预警
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-3 rounded-full"
              style={{ backgroundColor: 'var(--star-green)' }}
              aria-hidden
            />
            已解决
          </span>
        </div>
      </header>

      <div>
        <svg
          className="block h-[132px] w-full"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`近7天预警趋势折线图，共 ${trend.reduce((s, t) => s + t.total, 0)} 条新增`}
        >
          <defs>
            <linearGradient id="alert-trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-400)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--accent-400)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="0"
              x2={W}
              y1={H * f}
              y2={H * f}
              stroke="var(--space-700)"
              strokeWidth="0.3"
              strokeDasharray="1.5 1.5"
            />
          ))}
          <path d={area} fill="url(#alert-trend-fill)" />
          <path
            d={line((t) => t.total)}
            fill="none"
            stroke="var(--accent-400)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={line((t) => t.resolved)}
            fill="none"
            stroke="var(--star-green)"
            strokeWidth="2"
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
          {trend.map((t, i) => (
            <circle key={t.date} cx={x(i)} cy={y(t.total)} r="1.4" fill="var(--accent-300)" />
          ))}
        </svg>
        <div className="mt-1.5 flex justify-between px-0.5 text-[10px] text-lo" aria-hidden>
          {trend.map((t) => (
            <span key={t.date} className="data-mono">
              {t.label.slice(3)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * 照片墙缩略图。加载失败（上传目录被清过 / 文件丢失）时退回首字母，
 * 不让 404 在墙上留一个碎图标 —— 服务端已经筛过一遍存在性，这是第二道保险。
 */
function AlertPhotoThumb({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return (
      <span
        className="grid h-full w-full place-items-center font-display text-xl text-lo"
        aria-hidden
      >
        {name.slice(0, 1)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- 缩略小图，next/image 收益为负（同首页）
    <img
      src={src}
      alt={`${name}的照片`}
      className="h-full w-full object-cover"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/** 预警照片墙：最近 8 条预警对应动物的第一张照片，无照片画首字母 */
function AlertPhotoWall({ cards }: { cards: AlertPhotoCard[] }) {
  return (
    <section
      aria-label="预警照片"
      className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70"
    >
      <h2 className="mb-3 font-display text-[15px] text-hi">预警照片</h2>
      {cards.length === 0 ? (
        <p className="rounded-card border border-dashed border-space-700 p-4 text-center text-sm text-lo">
          还没有预警记录。
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2.5">
          {cards.map((c) => {
            const st = STATUS_STYLE[c.status];
            return (
              <li key={c.id}>
                <a
                  href={`/admin/animals/${c.animalCode}`}
                  className="block overflow-hidden rounded-card ring-1 ring-space-700/60 transition-transform duration-star ease-star hover:scale-[1.02]"
                >
                  <div className="relative aspect-[4/3] bg-space-900">
                    <AlertPhotoThumb src={c.photo} name={c.animalName} />
                    <span
                      className="absolute right-1.5 top-1.5 rounded-sticker px-1.5 py-0.5 text-[10px] backdrop-blur"
                      style={{
                        color: st.color,
                        backgroundColor: 'color-mix(in srgb, var(--space-900) 55%, transparent)',
                      }}
                    >
                      {STATUS_LABEL[c.status]}
                    </span>
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs text-hi">{c.animalName}</p>
                    <p className="data-mono truncate text-[10px] text-lo" title={c.reason}>
                      {c.animalCode} · {c.reason}
                    </p>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
