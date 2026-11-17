'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Loader2, MapPin, X } from 'lucide-react';
import { CAMPUS_SPOTS } from '@/lib/map-config';
import type { PickedPoint } from './LocationPickerMap';

const LocationPickerMap = dynamic(() => import('./LocationPickerMap'), {
  ssr: false,
  loading: () => (
    <div className="starfield h-full w-full bg-space-900" role="status">
      <span className="sr-only">正在铺设地图</span>
    </div>
  ),
});

/**
 * 「补充位置」入口（图鉴页，仅对管理员渲染）。
 * 给暂无坐标的星补一个常出没位置：弹窗内点地图选点 → 提交 WGS-84 坐标。
 * 补过之后按钮变成已补充态，卡片刷新后地图上就能看到这颗星。
 */
export function LocationSupplement({
  code,
  name,
  compact = false,
}: {
  code: string;
  name: string;
  /** 图鉴小卡用紧凑态；其他入口可用默认态 */
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedPoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/animals/location', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, lat: picked.lat, lng: picked.lng }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message ?? '没能保存，请重试');
        return;
      }
      setDone(true);
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
        setOpen(next);
        if (next) {
          setPicked(null);
          setError(null);
        }
      }}
    >
      <Dialog.Trigger
        className={
          compact
            ? 'inline-flex min-h-[30px] w-full items-center justify-center gap-1 rounded-sticker bg-space-800/80 text-[11px] text-lo ring-1 ring-space-700 transition-colors duration-star ease-star hover:text-hi hover:ring-accent-400/60'
            : 'inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-space-800 px-3 text-xs text-lo ring-1 ring-space-700 transition-colors duration-star ease-star hover:text-hi hover:ring-accent-400/60'
        }
      >
        {done ? <Check size={12} aria-hidden /> : <MapPin size={compact ? 11 : 13} aria-hidden />}
        {done ? '已补充位置' : '补充位置'}
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-space-900/80 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-card border-t border-space-700 bg-space-800 p-4 shadow-glow-strong md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:border">
          <header className="mb-3 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="font-display text-lg text-accent-300">
                补充位置信息
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-lo">
                给 {name}（{code}）在地图上点一个它常出没的位置，之后它就会出现在星图上。
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="grid h-8 w-8 shrink-0 place-items-center rounded-btn text-lo transition-colors duration-star ease-star hover:text-hi"
              aria-label="关闭"
            >
              <X size={18} aria-hidden />
            </Dialog.Close>
          </header>

          <p className="mt-2 text-[11px] text-lo">
            常出没的角落？一键套用，也可在地图上直接点：
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {CAMPUS_SPOTS.map((spot) => (
              <button
                key={spot.key}
                type="button"
                onClick={() =>
                  setPicked({ lat: spot.lat, lng: spot.lng })
                }
                className="rounded-sticker bg-space-800/80 px-2.5 py-1 text-xs text-lo ring-1 ring-space-700 transition-colors duration-star ease-star hover:text-hi hover:ring-accent-400/60"
              >
                {spot.name}
              </button>
            ))}
          </div>

          <div className="mt-2 h-64 overflow-hidden rounded-card ring-1 ring-space-700">
            <LocationPickerMap picked={picked} onPick={setPicked} />
          </div>

          <p className="data-mono mt-2 text-center text-[11px] text-lo" aria-live="polite">
            {picked
              ? `已选位置：${picked.lat.toFixed(6)}, ${picked.lng.toFixed(6)}`
              : '尚未选择位置'}
          </p>

          {error && (
            <p role="alert" className="mt-2 text-center text-xs" style={{ color: 'var(--star-red)' }}>
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!picked || busy}
            className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full text-sm font-medium text-hi shadow-glow transition-opacity duration-star ease-star hover:opacity-90 disabled:opacity-40"
            style={{ backgroundImage: 'var(--grad-cta)' }}
          >
            {busy ? (
              <>
                <Loader2 size={15} className="animate-spin" aria-hidden />
                保存中…
              </>
            ) : (
              '保存位置'
            )}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
