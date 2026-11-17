'use client';

import { useRef, useState } from 'react';
import { SendHorizontal, Sparkles } from 'lucide-react';
import { AnswerBubble } from './AnswerBubble';
import { LIMITS } from '@/lib/constants';
import type { ChatData } from '@/lib/api/chat-contract';

type Turn = {
  id: string;
  question: string;
  /** null = 还在等 */
  data: ChatData | null;
  error?: string;
};

type Status = 'idle' | 'sending' | 'done' | 'error';

/**
 * 对话面板（client 状态机）。
 *
 * 本阶段**不做流式**：`runStructured` 一次返回完整 JSON，
 * 因此中间态用「思考中」骨架 + aria-busy，不假装有 token 在往外冒。
 * 流式留到与 Agent 一起考虑（那时才有逐步产出的必要）。
 *
 * 幂等键 clientId 每次提问后轮换：不复用的话，
 * 30s 内的第二个问题会被服务端的幂等窗口吞掉（观察表单踩过同一个坑）。
 */
export function ChatPanel({
  animalId,
  animalLabel,
  suggestions,
}: {
  animalId?: string | null;
  animalLabel?: string | null;
  suggestions: string[];
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const listRef = useRef<HTMLDivElement>(null);

  const busy = status === 'sending';

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTurns((prev) => [...prev, { id, question: q, data: null }]);
    setDraft('');
    setStatus('sending');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: q,
          ...(animalId ? { animalId } : {}),
          clientId: id,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        const message = json?.error?.message ?? '没能回答，稍后再试一次。';
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, error: message } : t)));
        setStatus('error');
        return;
      }

      const data = json.data as ChatData;
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, data } : t)));
      setStatus('done');
    } catch {
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, error: '网络不太顺，检查连接后再试一次。' } : t)),
      );
      setStatus('error');
    } finally {
      // 新内容进来后把视口跟到底部：不滚的话用户会以为没回答
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
  }

  return (
    // 对齐设计稿（2026-10-26）：左栏「推荐问题」常驻，右栏对话流 + 底部输入条
    <div className="grid gap-4 lg:grid-cols-[minmax(0,230px)_minmax(0,1fr)]">
      {suggestions.length > 0 && (
        <aside aria-label="推荐问题" className="star-card h-fit p-4">
          <p className="font-display text-sm text-hi">推荐问题</p>
          <div className="mt-3 flex flex-col gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                className="rounded-sticker bg-space-800/80 px-3 py-2 text-left text-xs leading-relaxed text-lo ring-1 ring-space-700 transition-colors duration-star ease-star hover:text-hi hover:ring-accent-400/60"
              >
                {s}
              </button>
            ))}
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-col gap-4">
        {turns.length === 0 && (
          <div className="star-card p-5">
            <p className="font-display text-base text-hi">随便问一颗星的事</p>
            <p className="mt-1.5 text-sm leading-relaxed text-lo">
              喂养、外伤、绝育护理、抓捕安全 —— 答得上来的都挂着出处，答不上来的会明确说不知道，不会编。
            </p>
          </div>
        )}

        {turns.length > 0 && (
          <div ref={listRef} className="flex flex-col gap-4" aria-live="polite" aria-busy={busy}>
            {turns.map((turn) => (
              <div key={turn.id} className="flex flex-col gap-2">
                <p className="self-end rounded-card bg-accent-400/12 px-3 py-2 text-sm text-hi ring-1 ring-accent-400/30">
                  {turn.question}
                </p>

                {turn.error && (
                  <p role="alert" className="text-sm text-star-red">
                    {turn.error}
                  </p>
                )}

                {!turn.error && !turn.data && (
                  <div className="rounded-card bg-space-800/60 px-4 py-3 ring-1 ring-space-700">
                    <p className="flex items-center gap-2 text-sm text-lo">
                      <Sparkles size={14} className="text-accent-300" aria-hidden />
                      正在翻档案和护理手册…
                    </p>
                  </div>
                )}

                {turn.data && (
                  <AnswerBubble
                    answer={turn.data.answer}
                    citations={turn.data.citations}
                    uncertain={turn.data.uncertain}
                    uncertainNote={turn.data.uncertainNote}
                    disclaimer={turn.data.disclaimer}
                    fallback={turn.data.fallback}
                    animalHref={turn.data.animal ? `/animals/${turn.data.animal.code}` : null}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor="chat-input" className="sr-only">
              想问什么
            </label>
            <textarea
              id="chat-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, LIMITS.question))}
              onKeyDown={(e) => {
                // Enter 发送、Shift+Enter 换行：多行问题也要能写
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(draft);
                }
              }}
              rows={1}
              disabled={busy}
              placeholder={animalLabel ? `问问${animalLabel}` : '请输入你的问题'}
              aria-label="问题"
              className="w-full resize-none rounded-btn bg-space-800 px-3 py-2.5 text-sm text-hi ring-1 ring-space-700 placeholder:text-lo disabled:opacity-50"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="发送"
            className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full text-hi shadow-glow transition-opacity duration-star ease-star disabled:opacity-40"
            style={{ backgroundImage: 'var(--grad-cta)' }}
          >
            <SendHorizontal size={18} aria-hidden />
          </button>
        </form>

        {animalLabel && (
          <p className="text-xs text-lo">
            当前限定在 <span className="text-hi">{animalLabel}</span> 的档案内提问
          </p>
        )}
      </div>
    </div>
  );
}
