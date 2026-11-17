'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';

/**
 * 删除一条观察记录（仅管理端）。
 *
 * 客户端不给删除入口：记录是别人写在公共档案上的话，删掉等于抹掉别人的证词。
 * 管理员删之前必须看到**这条记录到底写了什么** —— 编号只是 6 位随机字符，
 * 光看编号按确认，删错了都不知道删的是哪一条，所以弹窗里直接摆原文。
 */
export function DeleteRecordButton({
  id,
  animalName,
  preview,
}: {
  id: string;
  animalName: string;
  /** 记录原文（截断展示即可，弹窗里是给管理员核对用） */
  preview: string;
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
      const res = await fetch(`/api/admin/observations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message ?? '删除失败，请重试');
        return;
      }
      setOpen(false);
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
        if (busy) return;
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <Dialog.Trigger
        className="inline-flex min-h-[28px] items-center gap-1 whitespace-nowrap rounded-sticker px-2 text-xs text-lo transition-colors duration-star ease-star hover:text-hi"
        title="删除这条记录（不可恢复）"
      >
        <Trash2 size={13} aria-hidden />
        删除
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-space-900/80 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-card border-t border-space-700 bg-space-800 p-4 shadow-glow-strong md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:border">
          <header className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="flex items-center gap-1.5 font-display text-lg text-hi">
                <AlertTriangle size={16} style={{ color: 'var(--star-red)' }} aria-hidden />
                删除这条记录
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-lo">
                删除后无法恢复，档案里的这条记录会一并消失。
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

          <div className="rounded-card bg-space-900/60 p-3 ring-1 ring-space-700">
            <p className="text-[11px] text-lo">{animalName} 的档案</p>
            <p className="mt-1.5 line-clamp-4 text-xs text-hi">{preview}</p>
            <p className="data-mono mt-1.5 text-[10px] text-lo">#{id.slice(-6).toUpperCase()}</p>
          </div>

          <p className="mt-3 text-[11px] text-lo">
            只请在确认这条是不实信息、重复提交或误操作时删除。
          </p>

          {error && (
            <p role="alert" className="mt-2 text-center text-xs" style={{ color: 'var(--star-red)' }}>
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
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium text-space-900 transition-opacity duration-star ease-star hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: 'var(--star-red)' }}
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
