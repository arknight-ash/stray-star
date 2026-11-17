'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';

/**
 * 删除档案（**仅管理端使用**；接口侧 canDelete 只放行管理员，这是最终裁决）。
 *
 * 2026-10-27：客户端不再提供删除入口。档案是共享资产，一只动物身上挂着
 * 许多同学的记录，任何人凭一次误触就能把它们连坐清空，代价不可逆。
 * 现在只有管理员能下架「已经找不到的小动物」，入口在管理端档案页。
 *
 * 为什么是弹窗而不是 window.confirm：删除不可逆，必须把**要删掉的东西摊开讲清楚**，
 * 并把编号摆出来让人核对；原生 confirm 说不清「会连带删掉什么」，手一抖就没了。
 */
export function DeleteAnimalButton({
  code,
  name,
  observationCount,
  redirectTo = '/animals',
}: {
  code: string;
  name: string;
  /** 会被连坐删掉的观察条数（弹窗里如实报数；不给就只说"会一并删除"） */
  observationCount?: number;
  /** 删除成功后回哪里。客户端档案页用 /animals，管理端用 /admin/animals */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/animals/${encodeURIComponent(code)}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message ?? '删除失败，请重试');
        return;
      }
      setOpen(false);
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError('网络不太顺，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // 删除请求在飞的时候不许关弹窗：关了也拦不回请求，只会让人以为取消了
        if (busy) return;
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <Dialog.Trigger
        className="btn-danger-ghost inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-space-700 bg-space-800/80 px-3 text-xs transition-colors duration-star ease-star disabled:opacity-40"
        title="删除这只动物的档案（不可恢复）"
      >
        <Trash2 size={13} aria-hidden />
        删除档案
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-space-900/80 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-card border-t border-space-700 bg-space-800 p-4 shadow-glow-strong md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:border">
          <header className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="flex items-center gap-1.5 font-display text-lg text-hi">
                <AlertTriangle size={16} style={{ color: 'var(--star-red)' }} aria-hidden />
                删除档案
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-lo">
                请确认这就是要下架的那一只。删除后无法恢复。
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="grid h-8 w-8 shrink-0 place-items-center rounded-btn text-lo transition-colors duration-star ease-star hover:text-hi"
              aria-label="关闭"
              disabled={busy}
            >
              <X size={18} aria-hidden />
            </Dialog.Close>
          </header>

          {/* 被删对象：名字 + 编号（编号是唯一标识，摆出来才核对得了） */}
          <div className="rounded-card bg-space-900/60 p-3 ring-1 ring-space-700">
            <p className="text-sm text-hi">{name}</p>
            <p className="data-mono mt-0.5 text-xs text-lo">#{code}</p>
          </div>

          {/* 连坐范围：说清楚会一起没掉什么，别让"删档案"听起来只是删一张卡 */}
          <ul className="mt-3 space-y-1.5 text-xs text-lo">
            <li className="flex gap-2">
              <span aria-hidden style={{ color: 'var(--star-red)' }}>
                ·
              </span>
              <span>档案本身（照片、特征、简介）</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden style={{ color: 'var(--star-red)' }}>
                ·
              </span>
              <span>
                {observationCount === undefined
                  ? '它的全部观察记录'
                  : `它的 ${observationCount} 条观察记录`}
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden style={{ color: 'var(--star-red)' }}>
                ·
              </span>
              <span>挂在它名下的预警</span>
            </li>
          </ul>

          <p className="mt-3 text-[11px] text-lo">
            只请在确认这只动物已经彻底找不到时使用。
          </p>

          {error && (
            <p
              role="alert"
              className="mt-2 text-center text-xs"
              style={{ color: 'var(--star-red)' }}
            >
              {error}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <Dialog.Close
              disabled={busy}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-space-800 px-4 text-sm text-lo ring-1 ring-space-700 transition-colors duration-star ease-star hover:text-hi disabled:opacity-40"
            >
              取消
            </Dialog.Close>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              aria-busy={busy}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium transition-opacity duration-star ease-star hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: 'var(--star-red)', color: 'var(--space-900)' }}
            >
              {busy ? (
                <>
                  <Loader2 size={15} className="animate-spin" aria-hidden />
                  删除中…
                </>
              ) : (
                <>
                  <Trash2 size={15} aria-hidden />
                  确认删除
                </>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
