'use client';

import { useState } from 'react';
import { Check, CheckCircle } from 'lucide-react';
import type { AdminAlertVM } from '@/lib/api/alert-contract';

/**
 * 一条预警的两个动作：认领跟进（ACK）与标记解决（RESOLVED）。
 * 对齐设计稿图6：行内「✓ 认领 / ✓ 解决」文字动作，权限提示收进 title。
 *
 * 关键约定：被拒时**显示服务端给的原话**。
 * 「CRITICAL 只能由管理员关闭」这类规则写在 lib/permissions.ts 里，
 * 前端另写一句"你没有权限"会让人以为系统出了故障，而不是规则如此。
 */
export function AlertActions({
  alert,
  onDone,
}: {
  alert: AdminAlertVM;
  onDone: (next: AdminAlertVM) => void;
}) {
  const [busy, setBusy] = useState<'ACK' | 'RESOLVED' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'ACK' | 'RESOLVED') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/alerts/${alert.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, clientId: `admin-${alert.id}-${action}` }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message ?? '操作失败，请重试');
        return;
      }
      onDone(body.data.alert as AdminAlertVM);
    } catch {
      setError('网络似乎不太稳定，请重试');
    } finally {
      setBusy(null);
    }
  }

  if (alert.status === 'RESOLVED') {
    return (
      <span className="data-mono whitespace-nowrap text-[11px] text-lo" title={alert.handledBy?.name ? `处置人 ${alert.handledBy.name}` : undefined}>
        ✓ 已解决
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => void act('ACK')}
        disabled={busy !== null || alert.status === 'ACK'}
        aria-busy={busy === 'ACK'}
        className="inline-flex min-h-[32px] items-center gap-1 whitespace-nowrap rounded-sticker px-2 text-xs text-hi transition-colors duration-star ease-star hover:underline disabled:opacity-45"
        title={alert.status === 'ACK' ? `已认领${alert.handledBy?.name ? ` · ${alert.handledBy.name}` : ''}` : '认领这条预警，跟进处理'}
      >
        <CheckCircle size={13} aria-hidden />
        {alert.status === 'ACK' ? '已认领' : '认领'}
      </button>
      <button
        type="button"
        onClick={() => void act('RESOLVED')}
        disabled={busy !== null}
        aria-busy={busy === 'RESOLVED'}
        className="inline-flex min-h-[32px] items-center gap-1 whitespace-nowrap rounded-sticker px-2 text-xs text-hi transition-colors duration-star ease-star hover:underline disabled:opacity-45"
        title={alert.level === 'CRITICAL' ? '紧急预警的关闭只记录管理员' : '标记为已解决'}
      >
        <Check size={13} aria-hidden />
        解决
      </button>
      {error && (
        <p role="alert" className="text-xs text-star-red">
          {error}
        </p>
      )}
    </div>
  );
}

/** 只取月日时分：处置台上"几天前"比"精确时间戳"更难扫 */
function short(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
