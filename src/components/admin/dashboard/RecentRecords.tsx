import Link from 'next/link';
import { ClipboardList, Star } from 'lucide-react';
import { firstSentence, formatShortTime } from '@/lib/format';
import { Panel, PanelMore } from './Panel';
import type { RecordBrief } from '@/lib/admin/overview';
import type { ObservationType } from '@/types/domain';

const TYPE_LABEL: Record<ObservationType, string> = {
  FEEDING: '喂食',
  HEALTH: '健康',
  BEHAVIOR: '行为',
  OTHER: '其他',
};

/**
 * 最新记录（设计稿右下那张列表）。
 *
 * 右侧标签只说「待核实 / 已确认」：这两个词是众包数据的真实状态，
 * 而「已处理」在记录语境里没有对应动作 —— 记录不需要被处理，只需要被核实。
 */
export function RecentRecords({ records }: { records: RecordBrief[] }) {
  return (
    <Panel
      title="最新记录"
      Icon={ClipboardList}
      action={<PanelMore href="/admin/records" />}
      bodyClassName="px-3 pb-3"
    >
      {records.length === 0 ? (
        <p className="rounded-btn border border-dashed border-space-700 px-3 py-6 text-center text-xs text-lo">
          还没有人提交观察记录。
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {records.map((record) => (
            <li key={record.id}>
              <Link
                href={`/admin/animals/${record.animalCode}`}
                className="flex items-center gap-2.5 rounded-btn px-1.5 py-2 transition-colors duration-star ease-star hover:bg-space-700/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 本地小图，next/image 收益为负（同首页） */}
                {record.animalAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 同上
                  <img
                    src={record.animalAvatar}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-btn object-cover ring-1 ring-space-700"
                  />
                ) : (
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-btn bg-space-900 ring-1 ring-space-700"
                    aria-hidden
                  >
                    <Star size={13} className="text-lo" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-hi">
                    {firstSentence(record.content, 16)}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-lo">
                    {TYPE_LABEL[record.type]} · {record.animalName} ·{' '}
                    {record.spotName ?? '位置未标注'}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className="rounded-sticker px-1.5 py-0.5 text-[10px]"
                    style={{
                      color: record.pendingReview ? 'var(--star-yellow)' : 'var(--star-green)',
                      backgroundColor: record.pendingReview
                        ? 'color-mix(in srgb, var(--star-yellow) 14%, transparent)'
                        : 'color-mix(in srgb, var(--star-green) 14%, transparent)',
                    }}
                  >
                    {record.pendingReview ? '待核实' : '已确认'}
                  </span>
                  <span className="data-mono text-[10px] text-lo">
                    {formatShortTime(record.createdAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
