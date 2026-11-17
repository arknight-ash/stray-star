'use client';

import { useCallback, useState } from 'react';
import { Send } from 'lucide-react';
import { Viewfinder } from '@/components/capture/Viewfinder';
import { ResultSheet } from '@/components/capture/ResultSheet';
import { Disclaimer } from '@/components/star/Disclaimer';
import { useIdentifyMachine } from '@/hooks/useIdentifyMachine';

/**
 * 捕获页容器：独占状态机，串联 取景 → 提交 → 结果 → 建档。
 * 服务端只在这之上给了校园中心，其余全在这棵子树里。
 */
export function CaptureClient() {
  const {
    state,
    dispatch,
    captureAndScan,
    scan,
    createAnimal,
    updateNote,
    updateForm,
    reset,
  } = useIdentifyMachine();
  const [sheetOpen, setSheetOpen] = useState(false);

  const busy = state.phase === 'preparing' || state.phase === 'scanning';

  /** 拍照即识别：选中后立刻进入 scanning */
  const handlePick = useCallback(
    async (file: File) => {
      setSheetOpen(false);
      await captureAndScan(file);
      setSheetOpen(true);
    },
    [captureAndScan],
  );

  const runScan = useCallback(
    async (note?: string) => {
      await scan(note);
      setSheetOpen(true);
    },
    [scan],
  );

  return (
    // 对齐设计稿「星卡捕获」：单列相机造型，取景框居中，快门即识别
    <div className="mx-auto w-full max-w-xl space-y-4">
      <Viewfinder
        previewUrl={state.previewUrl}
        scanning={state.phase === 'scanning'}
        disabled={busy}
        note={state.note}
        onNoteChange={updateNote}
        onPick={handlePick}
      />

      {state.photoUrl && !busy && (
        <button
          type="button"
          onClick={() => void runScan(state.note)}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-btn bg-accent-400/15 px-5 text-sm text-accent-300 ring-1 ring-accent-400/40 transition-colors duration-star ease-star hover:bg-accent-400/25"
        >
          <Send size={16} aria-hidden />
          重新比对星图
        </button>
      )}

      <p className="text-xs leading-relaxed text-lo">
        识别结果由 AI 给出，可能出错。命中不代表一定是同一只，请以实物特征为准；
        认不出来时，也可以选择为它建立一份新档案。
      </p>

      <Disclaimer variant="inline" />

      <ResultSheet
        state={state}
        open={sheetOpen && state.phase !== 'idle' && state.phase !== 'scanning'}
        onClose={() => setSheetOpen(false)}
        onRescan={() => {
          setSheetOpen(false);
          reset();
        }}
        onRerun={(note) => {
          updateNote(note);
          void runScan(note);
        }}
        onCreateNew={() => {
          dispatch({ type: 'CLAIM_NEW' });
          setSheetOpen(true);
        }}
        onNoteChange={updateNote}
        onUpdateForm={updateForm}
        onSubmitForm={() => {
          setSheetOpen(true);
          void createAnimal();
        }}
      />
    </div>
  );
}
