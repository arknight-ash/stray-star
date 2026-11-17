'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CircleSlash,
  Crosshair,
  Hand,
  ImagePlus,
  MapPin,
  MessagesSquare,
  Orbit,
  Pause,
  Play,
  SendHorizontal,
  ShieldCheck,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';
import { StarTrail, StarTrailLive, StarTrailPending } from './StarTrail';
import { useAgentRun, type ControlAction, type Turn } from './useAgentRun';
import { ConfidenceBadge } from '@/components/star/ConfidenceBadge';
import { UncertainNote } from '@/components/capture/UncertainNote';
import { Avatar } from '@/components/shell/Avatar';
import { AGENT_INTRO, AGENT_LIMITS, LIMITS, UNCERTAIN_NOTE } from '@/lib/constants';
import { compressImage } from '@/lib/image-compress';
import { formatAccuracy, useGeolocation } from '@/lib/use-geolocation';
import { trailToolLabel } from '@/lib/semantic';
import { guardConfidence } from '@/lib/safety/guard';
import { cn } from '@/lib/utils';

type View = 'chat' | 'trail';

const SUGGESTIONS = [
  'No.001 这只猫腿好像受伤了，帮我看看并记录一下',
  '校园里现在有哪些未处理的健康预警？',
  '流浪猫呕吐不吃东西该怎么护理？',
];

const MAX_PHOTOS = AGENT_LIMITS.maxPhotos;

/**
 * 星枢AI 工作台（client 状态机）。对齐设计稿图4 的三栏形态：
 * 左栏 = 视图切换（对话 / 轨迹），中栏 = 对话流，右栏（参考证据）无数据支撑已删。
 *
 * 2026-10-28 起它不再"等一个 JSON 回来再补动画"，而是消费 SSE：
 *  1. 提交 → 星轨立刻出现「规划」星，之后每执行一个工具就点亮一颗（StarTrailLive）；
 *  2. 每颗星下面都有执行摘要（✓ 识别为小橘 → ✓ 健康评估：轻微 · MILD → ✓ 已写入档案）；
 *  3. 人在回路：随时「暂停」让 AI 把下一步计划交出来，「接管」则立刻收尾，
 *     已经完成的步骤不会白做，也不会在用户不知情时继续写库。
 * 多模态：一次最多 3 张照片（AGENT_LIMITS.maxPhotos），第一张是主图（档案封面/记录图），
 * 其余作为额外视角一起交给健康评估。
 */
export function AgentConsole() {
  const { turns, busy, send, control, cancel } = useAgentRun();
  const [draft, setDraft] = useState('');
  const [photos, setPhotos] = useState<Array<{ file: File; url: string }>>([]);
  const [confirmEach, setConfirmEach] = useState(false);
  const [view, setView] = useState<View>('chat');
  const listRef = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  /**
   * 设备定位（2026-10-29）。
   *
   * 用途只有一个：让「它现在就在我旁边，记一下」这句话能落到真实坐标上。
   * 取到后随消息一起发，模型那边看到的是「本轮可获取当前位置」这条事实，
   * 坐标本身不经过它 —— 模型只有 useCurrentPosition 这个开关，没有经纬度入参。
   */
  const geo = useGeolocation();

  // 预览用的 object URL 必须自己释放（turns 里那份由 useAgentRun 管）
  useEffect(() => {
    const current = photos;
    return () => {
      for (const p of current) URL.revokeObjectURL(p.url);
    };
    // 只在卸载时清一次；增删时由 removePhoto 单独释放
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  async function addPhotos(list: FileList | null) {
    if (!list) return;
    // 空 MIME 也放行：部分文件选择器 / 剪贴板来源给不出 type，
    // 真正的把关在服务端（saveUpload 校验魔法字节），前端不替它做判断。
    const picked = Array.from(list)
      .filter((f) => !f.type || f.type.startsWith('image/'))
      .slice(0, Math.max(0, MAX_PHOTOS - photos.length));
    if (photoInput.current) photoInput.current.value = '';
    if (!picked.length) return;

    /*
     * 必须先在浏览器里压到长边 1280 再上传。
     * 原图直传的代价是「识别不出来」：实测同一张图长边 1920 用 10.8s，
     * 2048 起必满 40s 预算直接 AI_TIMEOUT（手机照片普遍 3000~4000）。
     * 与识别页 / 健康页共用 compressImage，别再写第二份。
     * 解码失败（HEIC 之类）退回原图，交给服务端体积校验去挡。
     */
    const prepared = await Promise.all(
      picked.map(async (file) => {
        try {
          const blob = await compressImage(file);
          const compressed =
            blob instanceof File
              ? blob
              : new File([blob], file.name, { type: blob.type || 'image/jpeg' });
          return { file: compressed, url: URL.createObjectURL(compressed) };
        } catch {
          return { file, url: URL.createObjectURL(file) };
        }
      }),
    );

    setPhotos((prev) => {
      const next = [...prev];
      for (const item of prepared) {
        if (next.length >= MAX_PHOTOS) {
          URL.revokeObjectURL(item.url);
          break;
        }
        if (next.some((p) => p.file.name === item.file.name && p.file.size === item.file.size)) {
          URL.revokeObjectURL(item.url);
          continue;
        }
        next.push(item);
      }
      return next;
    });
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
  }

  function submit(message: string) {
    const text = message.trim();
    if (!text || busy) return;
    void send({
      message: text,
      files: photos.map((p) => p.file),
      confirmEach,
      userLocation: geo.fix,
    });
    setDraft('');
    setPhotos([]);
    // 位置只对这一轮有效：留着会让下一句话莫名其妙也带着旧坐标
    geo.clear();
  }

  const finishedTrails = turns.filter((t) => t.data?.trail);

  return (
    <div className="flex items-start gap-4">
      {/* 左栏：视图切换（设计稿图4）。移动端隐藏 —— 对话是唯一主视图 */}
      <aside
        aria-label="星枢AI 视图切换"
        className="hidden w-36 shrink-0 flex-col gap-1 rounded-card bg-space-800/60 p-2 ring-1 ring-space-700/70 md:flex"
      >
        <ViewButton active={view === 'chat'} onClick={() => setView('chat')} Icon={MessagesSquare}>
          对话
        </ViewButton>
        <ViewButton active={view === 'trail'} onClick={() => setView('trail')} Icon={Orbit}>
          轨迹
        </ViewButton>
      </aside>

      <div className="min-w-0 flex-1">
        {view === 'chat' ? (
          <div className="flex flex-col gap-4">
            <div
              ref={listRef}
              className="flex max-h-[62vh] min-h-[240px] flex-col gap-4 overflow-y-auto pr-1"
            >
              {/* 开场白常驻：AI 先交代"我是谁、能做什么"，之后才是用户的第一句 */}
              <AgentIntro />

              {turns.map((turn) => (
                <TurnView key={turn.id} turn={turn} onControl={control} />
              ))}
            </div>

            {turns.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => submit(s)}
                    className="rounded-btn border border-space-700 px-3 py-1.5 text-xs text-lo transition-colors hover:border-accent-400/45 hover:text-hi disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* 输入区：照片（可多张）| 描述 | 发送 */}
            <form
              className="star-card p-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                submit(draft);
              }}
            >
              {photos.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {photos.map((photo, i) => (
                    <span key={photo.url} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt={`待发送照片 ${i + 1}：${photo.file.name}`}
                        className="h-14 w-14 rounded-btn object-cover ring-1 ring-space-700"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        aria-label={`移除照片 ${photo.file.name}`}
                        className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-space-900 text-lo ring-1 ring-space-600 hover:text-star-red"
                      >
                        <X size={11} aria-hidden />
                      </button>
                    </span>
                  ))}
                  <span className="text-[11px] text-lo/70">
                    {photos.length}/{MAX_PHOTOS} · 第一张作为主图
                  </span>
                </div>
              )}

              {/* 定位状态必须显性可见：静默失败会让用户以为位置已经带上了 */}
              {(geo.ready || geo.message) && (
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                  {geo.ready && geo.fix && (
                    <span className="inline-flex items-center gap-1 rounded-sticker bg-space-800/80 px-2 py-0.5 text-accent-300 ring-1 ring-accent-400/40">
                      <MapPin size={10} aria-hidden />
                      这句会带上当前位置
                      {formatAccuracy(geo.fix.accuracyM)
                        ? `（精度 ${formatAccuracy(geo.fix.accuracyM)}）`
                        : ''}
                    </span>
                  )}
                  {geo.message && (
                    <span role="alert" style={{ color: 'var(--star-yellow)' }}>
                      {geo.message}
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => photoInput.current?.click()}
                  disabled={photos.length >= MAX_PHOTOS}
                  className={`flex h-11 shrink-0 items-center gap-1.5 rounded-btn border px-3 text-xs transition-colors ${
                    photos.length
                      ? 'border-accent-400/60 text-accent-400'
                      : 'border-space-700 text-lo hover:border-accent-400/45 hover:text-hi'
                  } disabled:opacity-40`}
                  title={`附现场照片（最多 ${MAX_PHOTOS} 张，可多选）`}
                >
                  <ImagePlus size={15} aria-hidden />
                  照片
                </button>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => addPhotos(e.target.files)}
                />

                {/* 「用当前位置」：点了才取（浏览器要求用户手势），取到就随这句话带上。
                    取不到不挡发送 —— 只说一句「它就在我旁边」也照样能聊，只是没有坐标。 */}
                <button
                  type="button"
                  onClick={() => void geo.locate()}
                  disabled={geo.locating || busy}
                  aria-busy={geo.locating}
                  className={`flex h-11 shrink-0 items-center gap-1.5 rounded-btn border px-3 text-xs transition-colors ${
                    geo.ready
                      ? 'border-accent-400/60 text-accent-400'
                      : 'border-space-700 text-lo hover:border-accent-400/45 hover:text-hi'
                  } disabled:opacity-40`}
                  title="用手机当前位置记录目击（例如「它现在就在我旁边」）"
                >
                  <Crosshair size={15} aria-hidden className={geo.locating ? 'animate-spin' : ''} />
                  {geo.locating ? '定位中' : geo.ready ? '已定位' : '位置'}
                </button>

                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submit(draft);
                    }
                  }}
                  rows={1}
                  maxLength={LIMITS.agentMessage}
                  placeholder="描述你看到的情况"
                  aria-label="对星枢AI 说"
                  className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-hi outline-none placeholder:text-lo/60"
                />

                <button
                  type="submit"
                  disabled={busy || !draft.trim()}
                  className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-btn bg-accent-400 px-5 text-sm font-medium text-space-900 transition-opacity disabled:opacity-40"
                >
                  <SendHorizontal size={15} aria-hidden />
                  发送
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-space-700/60 pt-2">
                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-lo">
                  <input
                    type="checkbox"
                    checked={confirmEach}
                    onChange={(e) => setConfirmEach(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--accent-400)]"
                  />
                  <span className="flex items-center gap-1">
                    <Hand size={11} aria-hidden />
                    逐步确认（每个工具执行前先问我）
                  </span>
                </label>
                {busy && (
                  <button
                    type="button"
                    onClick={cancel}
                    className="flex items-center gap-1 text-[11px] text-lo/70 hover:text-star-red"
                  >
                    <CircleSlash size={11} aria-hidden />
                    取消这次请求
                  </button>
                )}
              </div>
            </form>

            <p className="text-center text-[11px] text-lo/70">
              回复由大模型生成，健康结论仅供参考，不构成兽医诊断。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <header className="mb-1">
              <h2 className="font-display text-2xl leading-tight text-hi">轨迹</h2>
              <p className="mt-1 text-sm text-lo">
                每一次任务走的路径：规划 → 工具 → 结论，点星点看每一步做了什么
              </p>
            </header>

            {finishedTrails.length === 0 ? (
              <div className="star-card p-4 text-sm text-lo">
                还没有跑过的任务轨迹。回「对话」交给星枢AI一件事，这里就会留下它的路径。
              </div>
            ) : (
              finishedTrails.map((t) => (
                <div key={t.id}>
                  {t.data?.trail && <StarTrail trail={t.data.trail} />}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────── 开场与身份 ────────────────── */

/** AI 侧的小行星球（品牌头那颗大球的等比缩小版），用来和用户头像区分身份 */
function AgentOrb({ className }: { className?: string }) {
  return (
    <span className={cn('agent-orb grid shrink-0 place-items-center', className)} aria-hidden>
      <Orbit size={13} strokeWidth={1.9} className="relative z-10 text-hi" />
    </span>
  );
}

/**
 * 开场白（常驻的第一条消息）：AI 先交代自己是谁、能做什么、怎么用它。
 *
 * 用户 2026-10-29 的要求。文案在 constants.AGENT_INTRO —— 口径只改一处，
 * 也就不会和 AgentBrand 的品牌介绍各说各话。
 * 常驻而不是「空态才显示」：这是它开口说的第一句话，滚上去还该看得见。
 */
function AgentIntro() {
  return (
    <div className="flex items-start gap-2 self-start" role="group" aria-label="星枢AI 的自我介绍">
      <AgentOrb className="h-7 w-7" />
      <div className="star-card min-w-0 max-w-full rounded-tl-sm px-3.5 py-2.5 text-sm leading-relaxed text-hi md:max-w-[92%]">
        <p className="flex items-start gap-1.5">
          <Sparkles
            size={14}
            className="mt-[3px] shrink-0"
            style={{ color: 'var(--accent-400)' }}
            aria-hidden
          />
          <span className="font-medium">{AGENT_INTRO.hello}</span>
        </p>
        <p className="mt-1.5 text-lo">能做的事：{AGENT_INTRO.abilities.join(' · ')}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-lo/85">{AGENT_INTRO.howTo}</p>
      </div>
    </div>
  );
}

/* ────────────────── 单轮对话 ────────────────── */

function TurnView({
  turn,
  onControl,
}: {
  turn: Turn;
  onControl: (turnId: string, action: ControlAction) => void;
}) {
  const data = turn.data;
  const progress = turn.progress;

  return (
    <div className="flex flex-col gap-2">
      {/* 用户自己的话：右对齐（2026-10-29 起按用户要求翻转为「AI 左 · 我右」）。
          气泡带一点主行动色，和 AI 的深色卡面区分开，扫一眼就知道谁在说。 */}
      <div className="flex max-w-[92%] items-end gap-2 self-end" role="group" aria-label="我说">
        <div className="rounded-card rounded-br-sm bg-accent-400/12 px-3.5 py-2.5 text-sm text-hi ring-1 ring-accent-400/35">
          {turn.images.length > 0 && (
            <span className="mb-2 flex flex-wrap gap-1.5">
              {turn.images.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={src}
                  src={src}
                  alt={`附带的现场照片 ${i + 1}`}
                  className="h-16 w-16 rounded-btn object-cover ring-1 ring-space-600"
                />
              ))}
            </span>
          )}
          {turn.message}
        </div>
        <Avatar className="h-7 w-7" />
      </div>

      {turn.error ? (
        <div
          role="alert"
          className="star-card max-w-[92%] self-start border-star-red/40 p-3 text-sm text-star-red"
        >
          {turn.error}
        </div>
      ) : (
        /* AI 的答复：左对齐。头像用行星球而不是观测员头盔 —— 同一个头像两边都用，
           读者根本分不清哪句是它说的。 */
        <div className="flex w-full items-start gap-2 self-start">
          <AgentOrb className="h-7 w-7" />
          <div className="min-w-0 flex-1">
            {/* 星轨：执行中用活星轨（逐颗点亮），跑完保留最终快照 */}
            {progress ? (
              <StarTrailLive progress={progress} />
            ) : data?.trail ? (
              <StarTrail trail={data.trail} />
            ) : (
              <StarTrailPending />
            )}

            {/* 人在回路控制条：只在还有步骤可能执行时出现 */}
            {!data && progress?.phase !== 'final' && turn.runId && (
              <RunControls turn={turn} onControl={onControl} />
            )}

            {data && <AnswerCard turn={turn} />}
          </div>
        </div>
      )}
    </div>
  );
}

/** 暂停 / 接管 / 闸门确认。三个动作的语义见 lib/agent/gate.ts 的注释 */
function RunControls({
  turn,
  onControl,
}: {
  turn: Turn;
  onControl: (turnId: string, action: ControlAction) => void;
}) {
  const gate = turn.progress?.gate;

  if (gate) {
    return <GatePanel turn={turn} onControl={onControl} />;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-card border border-space-700/70 bg-space-800/40 px-3 py-2">
      <span className="text-[11px] text-lo">
        {turn.pausing ? '已请求暂停：当前这一步跑完就停下来给你看计划' : 'AI 正在自主执行，你随时可以叫停'}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onControl(turn.id, 'pause')}
          disabled={turn.pausing}
          className="inline-flex h-9 items-center gap-1 rounded-btn border border-star-yellow/50 px-2.5 text-[11px] text-star-yellow transition-colors hover:bg-star-yellow/10 disabled:opacity-40"
        >
          <Pause size={12} aria-hidden />
          暂停
        </button>
        <button
          type="button"
          onClick={() => onControl(turn.id, 'abort')}
          className="inline-flex h-9 items-center gap-1 rounded-btn border border-star-red/50 px-2.5 text-[11px] text-star-red transition-colors hover:bg-star-red/10"
        >
          <Hand size={12} aria-hidden />
          接管
        </button>
      </div>
    </div>
  );
}

/**
 * 闸门面板：AI 把「下一步打算做什么、为什么、拿什么参数」摊开，等用户点头。
 * 这是整个页面最能体现 human-in-the-loop 的地方，所以信息要给足：
 * 工具名（中英）、理由、入参预览、倒计时（超时按接管处理）。
 */
function GatePanel({
  turn,
  onControl,
}: {
  turn: Turn;
  onControl: (turnId: string, action: ControlAction) => void;
}) {
  const gate = turn.progress?.gate;
  const [left, setLeft] = useState(() => secondsLeft(gate?.expiresAt));

  useEffect(() => {
    if (!gate) return;
    setLeft(secondsLeft(gate.expiresAt));
    const timer = setInterval(() => setLeft(secondsLeft(gate.expiresAt)), 1_000);
    return () => clearInterval(timer);
  }, [gate?.expiresAt, gate]);

  if (!gate) return null;

  return (
    <section
      aria-label="AI 下一步计划待确认"
      className="star-trail-gate mt-2 rounded-card border border-star-yellow/50 bg-star-yellow/8 p-3"
    >
      <p className="flex items-center gap-1.5 text-xs text-star-yellow">
        <Hand size={13} aria-hidden />
        已暂停 · AI 的下一步计划等你确认
      </p>

      <div className="mt-2 rounded-btn bg-space-900/50 px-3 py-2">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-hi">
          <span className="font-medium">{trailToolLabel(gate.tool)}</span>
          <span className="data-mono text-[10px] text-lo">{gate.tool}</span>
        </p>
        <p className="mt-1 text-xs leading-relaxed text-lo">为什么：{gate.why}</p>
        <p className="data-mono mt-1 break-all text-[10px] leading-relaxed text-lo/80">
          参数：{gate.preview}
        </p>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onControl(turn.id, 'resume')}
          className="inline-flex h-10 items-center gap-1.5 rounded-btn bg-accent-400 px-3 text-xs font-medium text-space-900"
        >
          <Play size={13} aria-hidden />
          继续执行
        </button>
        <button
          type="button"
          onClick={() => onControl(turn.id, 'skip')}
          className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-space-600 px-3 text-xs text-lo transition-colors hover:text-hi"
        >
          <SkipForward size={13} aria-hidden />
          跳过这一步
        </button>
        <button
          type="button"
          onClick={() => onControl(turn.id, 'abort')}
          className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-star-red/50 px-3 text-xs text-star-red transition-colors hover:bg-star-red/10"
        >
          <Hand size={13} aria-hidden />
          我来接管
        </button>
        <span className="ml-auto text-[10px] text-lo/70">
          {left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} 后自动接管` : '即将自动接管'}
        </span>
      </div>
    </section>
  );
}

function AnswerCard({ turn }: { turn: Turn }) {
  const data = turn.data;
  if (!data) return null;

  return (
    <div className="star-card mt-3 p-3.5 text-sm leading-relaxed text-hi">
      {/* 保留模型自己的分行（否则 1./2./3. 会挤成一坨），并把 **加粗** 渲染掉 */}
      <p className="whitespace-pre-line">{renderEmphasis(data.answer)}</p>

      {/* 阶段 9：健康结论必须带置信度与免责；低置信度显式提示，不把猜测包装成结论。
          「低于可信下限」不再单独加一句 —— badge 自己已经带了这个提示，
          两句并排会让读者以为是两个不同的警告。 */}
      {typeof data.confidence === 'number' && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <ConfidenceBadge value={data.confidence} size="sm" />
          {data.needsHuman && (
            <span className="inline-flex items-center gap-1 rounded-sticker border border-accent-400/45 bg-accent-400/10 px-2 py-0.5 text-[11px] text-accent-300">
              <ShieldCheck size={12} aria-hidden />
              建议复核
            </span>
          )}
        </div>
      )}
      {typeof data.confidence === 'number' && guardConfidence(data.confidence).uncertain && (
        <div className="mt-2">
          <UncertainNote tone="unknown">{UNCERTAIN_NOTE}</UncertainNote>
        </div>
      )}
      {data.paused && (
        <p className="mt-2 flex items-center gap-1 text-xs text-star-yellow">
          <Hand size={12} aria-hidden />
          你已接管这次任务，后续步骤没有执行。
        </p>
      )}
      {data.notice && (
        <p role="status" className="mt-2 flex items-center gap-1 text-xs text-star-green">
          <span aria-hidden>✦</span> {data.notice}
        </p>
      )}
      {data.disclaimer && <p className="mt-2 text-xs leading-relaxed text-lo">{data.disclaimer}</p>}
      {data.needsHuman && (
        <p className="mt-1.5 text-xs text-star-yellow">这条建议转给校兽医或管理员跟进。</p>
      )}
    </div>
  );
}

/**
 * 模型偶尔把 markdown 加粗原样吐出来（`**No.005 小灰**`），在页面上就是一串星号。
 *
 * 只认 `**…**` 这一种标记：答案里没有表格/代码块，为它引一个 markdown 渲染器不划算；
 * 用 dangerouslySetInnerHTML 又得自己防注入 —— 切成文本段渲染最省事也最安全。
 */
function renderEmphasis(text: string) {
  const parts = text.split(/(\*\*[^*\n]{1,80}\*\*)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.length > 4 && part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function ViewButton({
  active,
  onClick,
  Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  Icon: typeof MessagesSquare;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-[44px] items-center gap-2 rounded-btn px-3 text-sm transition-colors duration-star ease-star ${
        active ? 'bg-space-700 text-hi' : 'text-lo hover:text-hi'
      }`}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden />
      {children}
    </button>
  );
}

function secondsLeft(expiresAt?: number): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
}
