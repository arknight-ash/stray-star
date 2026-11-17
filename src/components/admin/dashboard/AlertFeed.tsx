import Link from 'next/link';
import { AlertTriangle, BellRing } from 'lucide-react';
import { formatShortTime } from '@/lib/format';
import { Panel, PanelMore } from './Panel';
import type { AlertBrief } from '@/lib/admin/overview';
import type { AlertStatus } from '@/types/domain';

/**
 * 预警动态（设计稿中栏列表）。
 *
 * 状态文字用中文而不是枚举名：这里不是调试面板，管理员看到的是"待处理"三个字，
 * 颜色只是冗余编码（红=待处理/黄=处理中/绿=已处置），色盲用户靠文字也能读。
 */
const STATUS_META: Record<AlertStatus, { label: string; color: string }> = {
  OPEN: { label: '待处理', color: 'var(--star-red)' },
  ACK: { label: '处理中', color: 'var(--star-yellow)' },
  RESOLVED: { label: '已处置', color: 'var(--star-green)' },
};

const LEVEL_COLOR: Record<AlertBrief['level'], string> = {
  CRITICAL: 'var(--star-red)',
  WARN: 'var(--star-yellow)',
  INFO: 'var(--star-green)',
};

export function AlertFeed({ alerts }: { alerts: AlertBrief[] }) {
  return (
    <Panel
      title="预警动态"
      Icon={BellRing}
      action={<PanelMore href="/admin/alerts" />}
      bodyClassName="px-3 pb-3"
    >
      {alerts.length === 0 ? (
        <p className="rounded-btn border border-dashed border-space-700 px-3 py-8 text-center text-xs text-lo">
          暂时没有预警，校园一切正常。
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {alerts.map((alert) => {
            const status = STATUS_META[alert.status];
            return (
              <li key={alert.id}>
                <Link
                  href="/admin/alerts"
                  className="flex items-start gap-2.5 rounded-btn px-1.5 py-2 transition-colors duration-star ease-star hover:bg-space-700/40"
                >
                  <span
                    className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full"
                    style={{ backgroundColor: `color-mix(in srgb, ${LEVEL_COLOR[alert.level]} 16%, transparent)` }}
                    aria-hidden
                  >
                    <AlertTriangle size={13} style={{ color: LEVEL_COLOR[alert.level] }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {alert.manualSevere && (
                        <span
                          className="shrink-0 rounded-sticker px-1.5 py-0.5 text-[10px]"
                          style={{
                            color: 'var(--star-red)',
                            backgroundColor: 'color-mix(in srgb, var(--star-red) 16%, transparent)',
                          }}
                        >
                          同学标记紧急
                        </span>
                      )}
                      <span className="block truncate text-xs text-hi">{alert.reason}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-lo">
                      {alert.animalName} · {alert.animalCode}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="data-mono text-[11px] text-lo">
                      {formatShortTime(alert.createdAt)}
                    </span>
                    <span
                      className="rounded-sticker px-1.5 py-0.5 text-[10px]"
                      style={{
                        color: status.color,
                        backgroundColor: `color-mix(in srgb, ${status.color} 14%, transparent)`,
                      }}
                    >
                      {status.label}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
