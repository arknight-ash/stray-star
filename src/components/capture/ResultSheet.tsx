'use client';

import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { MatchedPanel } from './MatchedPanel';
import { CandidatePanel } from './CandidatePanel';
import { NewStarPanel } from './NewStarPanel';
import { UncertainNote } from './UncertainNote';
import { CAMPUS } from '@/lib/constants';
import type { MachineState } from '@/hooks/useIdentifyMachine';
import type { IdentifyData } from '@/lib/api/identify-contract';
import { cn } from '@/lib/utils';

/**
 * 结果抽屉：按 tier 切换三块面板。
 * 移动端从底部升起（拇指可达），桌面端居中弹卡。
 * creating 态不换面板 —— 表单必须留在原地，让用户看到自己填的内容。
 */
export function ResultSheet({
  state,
  open,
  onClose,
  onRescan,
  onRerun,
  onCreateNew,
  onNoteChange,
  onUpdateForm,
  onSubmitForm,
  className,
}: {
  state: MachineState;
  open: boolean;
  onClose: () => void;
  onRescan: () => void;
  onRerun: (note: string) => void;
  onCreateNew: () => void;
  onNoteChange: (note: string) => void;
  onUpdateForm: (patch: Partial<MachineState['form']>) => void;
  onSubmitForm: () => void;
  className?: string;
}) {
  const { phase, data, createdAnimal } = state;
  const unmatched: IdentifyData | null = data && !data.matched ? data : null;
  const matched = data?.matched ? data : null;
  const submitting = phase === 'creating';

  // 建档成功 = 一颗新星升空：放一次流星划过（一次性动画，不放第二次）
  const [meteor, setMeteor] = useState(false);
  const celebratedRef = useRef(false);
  useEffect(() => {
    if (phase === 'matched' && createdAnimal && !celebratedRef.current) {
      celebratedRef.current = true;
      setMeteor(true);
      const timer = setTimeout(() => setMeteor(false), 1900);
      return () => clearTimeout(timer);
    }
    if (phase !== 'matched') celebratedRef.current = false;
  }, [phase, createdAnimal]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && !submitting && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-space-900/80 backdrop-blur-sm" />

        {/* 流星：只在新建档案成功的瞬间放一次，纯装饰（reduced-motion 下由 CSS 关掉） */}
        {meteor && (
          <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden>
            <span className="meteor-streak" style={{ top: '16%', left: '-12%' }} />
            <span
              className="meteor-streak meteor-streak-sm"
              style={{ top: '44%', left: '-18%', animationDelay: '380ms' }}
            />
            <span
              className="meteor-streak meteor-streak-sm"
              style={{ top: '6%', left: '2%', animationDelay: '760ms' }}
            />
          </div>
        )}

        <Dialog.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-card border-t border-space-700 bg-space-800 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-glow-strong',
            'md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:border',
            className,
          )}
        >
          <header className="mb-3 flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-lg leading-tight text-accent-300">
              {titleFor(phase)}
            </Dialog.Title>
            <Dialog.Close
              className="grid h-8 w-8 shrink-0 place-items-center rounded-btn text-lo transition-colors duration-star ease-star hover:text-hi"
              aria-label="关闭"
            >
              <X size={18} aria-hidden />
            </Dialog.Close>
          </header>

          {phase === 'matched' && (createdAnimal || matched?.animal) && (
            <MatchedPanel
              animal={createdAnimal ?? matched!.animal}
              confidence={createdAnimal ? 1 : (matched?.confidence ?? 0)}
              features={data?.features ?? []}
              pendingReview={Boolean(createdAnimal?.pendingReview ?? matched?.animal.pendingReview)}
              onRescan={onRescan}
            />
          )}

          {phase === 'low-confidence' && unmatched && (
            <CandidatePanel
              data={unmatched}
              note={state.note}
              onNoteChange={onNoteChange}
              onRerun={onRerun}
              onCreateNew={onCreateNew}
              rerunning={false}
            />
          )}

          {(phase === 'new' || submitting) && (
            <NewStarPanel
              data={unmatched}
              form={state.form}
              submitting={submitting}
              center={{ lat: CAMPUS.lat, lng: CAMPUS.lng }}
              onUpdateForm={onUpdateForm}
              onSubmit={onSubmitForm}
            />
          )}

          {phase === 'error' && state.error && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-sticker bg-star-red/12 px-3 py-2 text-xs leading-relaxed text-star-red ring-1 ring-star-red/45">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>{state.error.message}</span>
              </div>
              {state.data?.degraded.vision && <UncertainNote tone="degraded" />}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onRescan}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-btn bg-accent-400/20 px-4 text-sm text-accent-300 ring-1 ring-accent-400/40 transition-colors duration-star ease-star hover:bg-accent-400/30"
                >
                  <RotateCcw size={15} aria-hidden />
                  再试一次
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-btn bg-space-800 px-4 text-sm text-lo ring-1 ring-space-700 transition-colors duration-star ease-star hover:text-hi"
                >
                  知道了
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function titleFor(phase: MachineState['phase']): string {
  switch (phase) {
    case 'matched':
      return '星卡点亮';
    case 'low-confidence':
      return '这颗星有些模糊';
    case 'new':
      return '一颗未登记的星';
    case 'creating':
      return '正在点亮…';
    case 'error':
      return '没能识别出来';
    default:
      return '识别结果';
  }
}
