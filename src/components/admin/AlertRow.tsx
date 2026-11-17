'use client';

import Link from 'next/link';
import { ALERT_META } from '@/lib/semantic';
import { HEALTH_META } from '@/lib/semantic';
import { AlertActions } from './AlertActions';
import type { AdminAlertVM } from '@/lib/api/alert-contract';

const STATUS_LABEL: Record<AdminAlertVM['status'], string> = {
  OPEN: '未处理',
  ACK: '已认领',
  RESOLVED: '已解决',
};

const SOURCE_LABEL: Record<string, string> = {
  OBSERVATION: '同学上报',
  HEALTH_REPORT: 'AI 初筛',
};

/**
 * 待办清单里的一行。
 *
 * 颜色之外必须有文字冗余编码（R2）：等级写「紧急/提醒/通知」，状态写「未处理/已认领/已解决」。
 * 来源单独标出来 —— 管理员要一眼分清"这条是人看见的"还是"模型猜的"。
 */
export function AlertRow({
  alert,
  onDone,
}: {
  alert: AdminAlertVM;
  onDone: (next: AdminAlertVM) => void;
}) {
  const meta = ALERT_META[alert.level];
  const health = HEALTH_META[alert.animal.healthLevel];

  return (
    // 对齐设计稿图6：紧凑行 = 状态点 + 编号 + 摘要 + 级别 + 时间 + 动作；
    // 颜色之外保留文字冗余编码（R2）：级别写「紧急/提醒/通知」，状态写「未处理/已认领/已解决」。
    <article
      className="rounded-card bg-space-900/40 p-2.5 ring-1 ring-space-700/60"
      aria-label={`${meta.label}预警 · ${alert.animal.name} · ${STATUS_LABEL[alert.status]}`}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: meta.dot, boxShadow: `0 0 6px ${meta.dot}` }}
          aria-hidden
        />
        <Link
          href={`/admin/animals/${alert.animal.code}`}
          className="data-mono shrink-0 text-xs text-hi underline-offset-2 hover:underline"
        >
          {alert.animal.code}
        </Link>
        <Link
          href={`/admin/animals/${alert.animal.code}`}
          className="min-w-0 flex-1 truncate text-sm text-hi underline-offset-2 hover:underline"
          title={alert.reason}
        >
          {alert.manualSevere && (
            <span
              className="mr-1.5 rounded-sticker px-1.5 py-0.5 text-[10px]"
              style={{
                color: 'var(--star-red)',
                backgroundColor: 'color-mix(in srgb, var(--star-red) 16%, transparent)',
              }}
            >
              同学标记紧急
            </span>
          )}
          {alert.reason}
        </Link>
        <span
          className="data-mono shrink-0 text-xs"
          style={{ color: alert.level === 'CRITICAL' ? 'var(--star-red)' : 'var(--star-yellow)' }}
        >
          {meta.label}
        </span>
        <span className="data-mono shrink-0 text-[11px] text-lo">{short(alert.createdAt)}</span>
        <span className="shrink-0">
          <AlertActions alert={alert} onDone={onDone} />
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-[18px] text-[11px] text-lo">
        <span>✦ {alert.animal.name}</span>
        <span>当前档案 {health.label}</span>
        <span>{SOURCE_LABEL[alert.source ?? ''] ?? '未记录来源'} · {STATUS_LABEL[alert.status]}</span>
        {alert.ackAt && <span className="data-mono">{short(alert.ackAt)} 认领</span>}
        {alert.handledBy?.name && <span>处置人 {alert.handledBy.name}</span>}
        {!alert.handledBy?.name && alert.ackAt && <span>匿名同学认领</span>}
      </div>
    </article>
  );
}

function short(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
