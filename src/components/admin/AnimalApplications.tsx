'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, ClipboardCheck, Loader2, MapPin, X } from 'lucide-react';
import { SPECIES_META } from '@/lib/semantic';
import type { AnimalApplication } from '@/lib/admin/views';

function time(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 新增动物申请审核（2026-10-27）。
 *
 * 取代原来的「+ 新增动物」按钮：建档的正式入口在客户端（拍摄识别），
 * 管理端不该把自己变成一个绕过识别链路的建路口子，也不该为了建个档跳去客户端 ——
 * 管理员的职责是**看同学提交上来的申请并给出结论**。
 *
 * 通过 = 这只动物确实存在，档案与照片一起转正式（进图鉴、进识别库）；
 * 驳回 = 申请不成立，档案连同照片一起清掉。驳回必须给理由：
 * 一句「不像校园里的动物」能挡住同学第二天再拍一次同样的照片提交上来。
 */
export function AnimalApplications({ applications }: { applications: AnimalApplication[] }) {
  const router = useRouter();
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AnimalApplication | null>(null);
  const [note, setNote] = useState('');

  async function decide(code: string, decision: 'approve' | 'reject', reason?: string) {
    if (busyCode) return;
    setBusyCode(code);
    setError(null);
    try {
      const res = await fetch(`/api/admin/animals/${encodeURIComponent(code)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, note: reason }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message ?? '操作失败，请重试');
        return;
      }
      setRejecting(null);
      setNote('');
      router.refresh();
    } catch {
      setError('网络不太顺，请重试');
    } finally {
      setBusyCode(null);
    }
  }

  if (applications.length === 0) {
    return (
      <section
        aria-label="新增动物申请"
        className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70"
      >
        <header className="mb-3 flex items-center gap-1.5">
          <ClipboardCheck size={15} style={{ color: 'var(--accent-300)' }} aria-hidden />
          <h2 className="font-display text-[15px] text-hi">新增动物申请</h2>
        </header>
        <p className="rounded-card border border-dashed border-space-700 p-8 text-center text-sm text-lo">
          暂时没有待审核的申请。同学在客户端拍照建档后，申请会出现在这里。
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="新增动物申请"
      className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70"
    >
      <header className="mb-3 flex items-center gap-1.5">
        <ClipboardCheck size={15} style={{ color: 'var(--accent-300)' }} aria-hidden />
        <h2 className="font-display text-[15px] text-hi">新增动物申请</h2>
        <span className="ml-auto text-[11px] text-lo">共 {applications.length} 条待审核</span>
      </header>

      {error && (
        <p role="alert" className="mb-2 text-xs" style={{ color: 'var(--star-red)' }}>
          {error}
        </p>
      )}

      <ul className="space-y-2.5">
        {applications.map((a) => {
          const cover = a.avatarUrl ?? a.photos[0]?.url ?? null;
          const busy = busyCode === a.code;
          return (
            <li
              key={a.id}
              className="flex flex-wrap items-start gap-3 rounded-card bg-space-900/50 p-3 ring-1 ring-space-700/60"
            >
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element -- 64px 缩略图，next/image 收益为负
                <img
                  src={cover}
                  alt={`${a.name}的申请照片`}
                  className="h-16 w-16 shrink-0 rounded-card object-cover ring-1 ring-space-700"
                  loading="lazy"
                />
              ) : (
                <span
                  className="grid h-16 w-16 shrink-0 place-items-center rounded-card bg-space-700/50 text-xl text-hi"
                  aria-hidden
                >
                  {SPECIES_META[a.species].glyph}
                </span>
              )}

              <div className="min-w-[180px] flex-1">
                <p className="text-sm text-hi">
                  {a.name}
                  <span className="data-mono ml-2 text-[11px] text-lo">#{a.code}</span>
                  <span
                    className="ml-2 rounded-sticker px-1.5 py-0.5 text-[10px]"
                    style={{
                      color: 'var(--accent-300)',
                      backgroundColor: 'color-mix(in srgb, var(--accent-500) 22%, transparent)',
                    }}
                  >
                    {SPECIES_META[a.species].label}
                  </span>
                </p>
                <p className="mt-1 text-[11px] text-lo">
                  {a.submitter} 提交于 {time(a.createdAt)} · {a.photoCount} 张照片
                </p>
                {a.spotName && (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-lo">
                    <MapPin size={11} aria-hidden />
                    {a.spotName}附近
                  </p>
                )}
                {a.features.length > 0 && (
                  <p className="mt-1 truncate text-[11px] text-lo" title={a.features.join('、')}>
                    特征：{a.features.join('、')}
                  </p>
                )}
                {a.summary && <p className="mt-1 truncate text-[11px] text-lo">{a.summary}</p>}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(a.code, 'approve')}
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-btn px-3 text-xs font-medium text-space-900 transition-opacity duration-star ease-star hover:opacity-90 disabled:opacity-40"
                  style={{ backgroundColor: 'var(--star-green)' }}
                >
                  {busy ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <Check size={13} aria-hidden />
                  )}
                  通过
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setNote('');
                    setError(null);
                    setRejecting(a);
                  }}
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-btn border border-space-700 px-3 text-xs text-lo transition-colors duration-star ease-star hover:text-hi disabled:opacity-40"
                >
                  驳回
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog.Root open={rejecting !== null} onOpenChange={(next) => !next && setRejecting(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-space-900/80 backdrop-blur-sm" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-card border-t border-space-700 bg-space-800 p-4 shadow-glow-strong md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:border">
            <header className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Dialog.Title className="font-display text-lg text-hi">驳回这条申请</Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-lo">
                  {rejecting?.name}（#{rejecting?.code}）的档案与照片会被删除，不可恢复。
                </Dialog.Description>
              </div>
              <Dialog.Close
                className="grid h-8 w-8 shrink-0 place-items-center rounded-btn text-lo transition-colors duration-star ease-star hover:text-hi"
                aria-label="关闭"
              >
                <X size={18} aria-hidden />
              </Dialog.Close>
            </header>

            <label className="block text-[11px] text-lo">
              驳回理由（选填，会记进审计）
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 200))}
                rows={3}
                placeholder="例如：照片里不是校园内的动物 / 与已有档案重复"
                className="mt-1 w-full rounded-btn bg-space-900/60 px-3 py-2 text-xs text-hi ring-1 ring-space-700 outline-none focus-visible:ring-accent-400"
              />
            </label>

            {error && (
              <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--star-red)' }}>
                {error}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <Dialog.Close className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-space-800 px-4 text-sm text-lo ring-1 ring-space-700 transition-colors duration-star ease-star hover:text-hi">
                取消
              </Dialog.Close>
              <button
                type="button"
                disabled={busyCode !== null}
                onClick={() => rejecting && void decide(rejecting.code, 'reject', note)}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium text-space-900 transition-opacity duration-star ease-star hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: 'var(--star-red)' }}
              >
                {busyCode ? (
                  <Loader2 size={15} className="animate-spin" aria-hidden />
                ) : (
                  <X size={15} aria-hidden />
                )}
                确认驳回
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
