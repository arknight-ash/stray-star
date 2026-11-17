'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Eye } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { Pager } from './Pager';
import { DeleteRecordButton } from './DeleteRecordButton';
import type { AdminRecordRow } from '@/lib/admin/views';

const PAGE_SIZE = 10;

type TypeFilter = 'ALL' | 'HEALTH' | 'FEEDING' | 'BEHAVIOR' | 'OTHER';

const TYPE_FILTERS: Array<{ key: TypeFilter; label: string }> = [
  { key: 'ALL', label: '全部' },
  { key: 'HEALTH', label: '健康记录' },
  { key: 'FEEDING', label: '投喂记录' },
  { key: 'BEHAVIOR', label: '观察记录' },
  { key: 'OTHER', label: '其他' },
];

const TYPE_META: Record<string, { label: string; color: string }> = {
  HEALTH: { label: '健康', color: 'var(--star-red)' },
  FEEDING: { label: '投喂', color: 'var(--star-green)' },
  BEHAVIOR: { label: '行为', color: 'var(--accent-300)' },
  OTHER: { label: '其他', color: 'var(--star-yellow)' },
};

function time(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 记录管理（2026-10-27 按设计稿二轮）。
 *
 * 页头 + 类型 chips + 表格（编号/动物/类型/时间/记录人/操作）+ 分页。
 * 筛选与分页在客户端做：观察记录在校园级体量（几百条）以内，
 * 真到几千条时再把筛选下推到服务端，交互不变。
 */
export function RecordsManager({ records }: { records: AdminRecordRow[] }) {
  const [type, setType] = useState<TypeFilter>('ALL');
  const [page, setPage] = useState(1);

  const filtered = useMemo(
    () => (type === 'ALL' ? records : records.filter((r) => r.type === type)),
    [records, type],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* 页头不再放「+ 新增记录」：那个按钮原来跳 /report，等于把管理员甩回客户端。
          记录是同学在现场写下的，管理端只做查看与清理（删除记录），不代填。 */}
      <PageHeader
        title="记录管理"
        subtitle="同学的投喂、健康与行为观察，全部落在这张表里"
      />

      {/* 类型筛选 chips */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="按类型筛选">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setType(f.key);
              setPage(1);
            }}
            aria-pressed={type === f.key}
            className={
              type === f.key
                ? 'min-h-[30px] rounded-sticker bg-accent-400 px-3 text-xs font-medium text-space-900'
                : 'min-h-[30px] rounded-sticker border border-space-700 px-3 text-xs text-lo transition-colors duration-star ease-star hover:text-hi'
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <section aria-label="记录列表" className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70">
        <header className="mb-3 flex items-center gap-1.5">
          <ClipboardList size={15} style={{ color: 'var(--accent-300)' }} aria-hidden />
          <h2 className="font-display text-[15px] text-hi">记录列表</h2>
        </header>

        {pageRows.length === 0 ? (
          <p className="rounded-card border border-dashed border-space-700 p-8 text-center text-sm text-lo">
            这个类型下还没有记录。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[11px] text-lo">
                  <th scope="col" className="px-2 pb-2 font-normal">编号</th>
                  <th scope="col" className="px-2 pb-2 font-normal">动物信息</th>
                  <th scope="col" className="px-2 pb-2 font-normal">记录类型</th>
                  <th scope="col" className="px-2 pb-2 font-normal">记录时间</th>
                  <th scope="col" className="px-2 pb-2 font-normal">记录人</th>
                  <th scope="col" className="px-2 pb-2 font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const tm = TYPE_META[r.type] ?? TYPE_META.OTHER!;
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-space-700/50 transition-colors duration-star ease-star hover:bg-space-900/40"
                    >
                      <td className="px-2 py-2.5">
                        <span className="data-mono text-[11px] text-lo" title={r.content}>
                          {r.id.slice(-6).toUpperCase()}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          {r.animalAvatar ? (
                            // eslint-disable-next-line @next/next/no-img-element -- 20px 头像，next/image 收益为负
                            <img
                              src={r.animalAvatar}
                              alt=""
                              className="h-6 w-6 shrink-0 rounded-full object-cover"
                              loading="lazy"
                            />
                          ) : null}
                          <span className="whitespace-nowrap">
                            <Link
                              href={`/admin/animals/${r.animalCode}`}
                              className="text-hi underline-offset-2 hover:underline"
                            >
                              {r.animalName}
                            </Link>
                            <span className="data-mono ml-1.5 text-[11px] text-lo">
                              {r.animalCode}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5">
                        <span
                          className="inline-block rounded-sticker px-1.5 py-0.5 text-[11px]"
                          style={{
                            color: tm.color,
                            backgroundColor: `color-mix(in srgb, ${tm.color} 14%, transparent)`,
                          }}
                        >
                          {tm.label}
                          {r.manualSevere && (
                            <span className="ml-1" style={{ color: 'var(--star-red)' }}>
                              ·紧急
                            </span>
                          )}
                        </span>
                        {r.pendingReview && (
                          <span
                            className="ml-1.5 text-[10px]"
                            style={{ color: 'var(--star-yellow)' }}
                          >
                            待核实
                          </span>
                        )}
                      </td>
                      <td className="data-mono whitespace-nowrap px-2 py-2.5 text-lo">
                        {time(r.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-lo">{r.authorLabel}</td>
                      <td className="whitespace-nowrap px-2 py-2.5">
                        <Link
                          href={`/admin/animals/${r.animalCode}`}
                          className="inline-flex min-h-[28px] items-center gap-1 rounded-sticker px-2 text-xs text-hi transition-colors duration-star ease-star hover:underline"
                          title="查看动物档案中的完整记录"
                        >
                          <Eye size={13} aria-hidden />
                          查看
                        </Link>
                        {/* 删除只给管理端：客户端不提供删除入口，避免同学随手抹掉别人的记录 */}
                        <DeleteRecordButton
                          id={r.id}
                          animalName={`${r.animalName} · ${r.animalCode}`}
                          preview={r.content}
                        />
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
          total={filtered.length}
          unit="条"
        />
      </section>
    </div>
  );
}
