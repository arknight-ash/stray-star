'use client';

import { useState } from 'react';
import { ChevronRight, Eye, ShieldAlert, Sparkles } from 'lucide-react';
import { TRAIL_SPECIAL_META, TRAIL_STEP_META, trailToolLabel } from '@/lib/semantic';
import type { AgentProgress, AgentStep, StarTrail } from '@/lib/api/agent-contract';

/**
 * 星轨可视化（阶段 8 的招牌组件；2026-10-28 加了「活星轨」）。
 *
 * 同一套视觉语言，两个入口：
 *  - `<StarTrail trail>`：任务跑完后的回放（轨迹视图 / 非流式降级）。按 120ms stagger
 *    依次入场，让读者看清顺序；
 *  - `<StarTrailLive progress>`：执行中。**不**做假动画 —— 节点出现即服务端推来的
 *    真实步骤，running 的那颗在闪，完成后换成 ✓ 并重放一次点亮光环。所以
 *    「星被点亮」这件事本身就是工具真的执行了的证据，而不是计时器。
 *
 * 组件不认识 TraceRun，只认 lib/api/agent-contract 里的 VM（StarTrail / AgentProgress）。
 * 所有动效走 globals.css 的 keyframes + tokens，组件内不写死毫秒与颜色。
 */

const STAGGER_MS = 120;

type RailStatus = 'pending' | 'running' | 'ok' | 'error' | 'fallback';

interface RailNode {
  key: string;
  tool: string;
  label: string;
  glyph: string;
  status: RailStatus;
  summary: string;
  durationMs?: number;
  why?: string;
  /** 规划出来但还没执行的步骤：星轨上画成暗星，与已执行的一眼可分 */
  pending?: boolean;
}

const PENDING_META = {
  label: '待执行',
  dot: 'var(--space-700)',
  text: 'text-lo/60',
} as const;

function statusMeta(status: RailStatus) {
  return status === 'pending' ? PENDING_META : TRAIL_STEP_META[status];
}

/** 状态前缀：日志行一眼能看出成功/失败/跳过，不只靠颜色 */
const STATUS_GLYPH: Record<RailStatus, string> = {
  ok: '✓',
  running: '◌',
  error: '✕',
  fallback: '↷',
  pending: '·',
};

function visualOf(tool: string, status: RailStatus) {
  if (tool === 'plan' || tool === 'final') {
    const special = TRAIL_SPECIAL_META[tool];
    return { glyph: special.glyph, label: special.label };
  }
  // 星点下方只有 56px：英文工具名会被截成 queryArc…，用中文短名（原文见 tooltip）
  return { glyph: '●', label: trailToolLabel(tool) };
}

/** AgentStep → 星轨节点 */
function nodesOfSteps(steps: AgentStep[], stagger: boolean): Array<RailNode & { delay?: number }> {
  return steps.map((step, i) => {
    const visual = visualOf(step.tool, step.status);
    return {
      key: `${step.tool}-${i}`,
      tool: step.tool,
      label: visual.label,
      glyph: visual.glyph,
      status: step.status,
      summary: step.summary,
      ...(step.durationMs != null ? { durationMs: step.durationMs } : {}),
      ...(step.why ? { why: step.why } : {}),
      ...(stagger ? { delay: i * STAGGER_MS } : {}),
    };
  });
}

/**
 * 进度快照 → 星轨节点。
 * 顺序：规划 → 已执行的步骤 → 正在执行的那颗 → 还没轮到但已规划出来的暗星。
 * running 只出现一次（编排层保证同一时刻只有一个工具在跑）。
 */
function nodesOfProgress(progress: AgentProgress): RailNode[] {
  const nodes: RailNode[] = [];

  const planStep = progress.steps.find((s) => s.tool === 'plan');
  if (planStep) {
    nodes.push({
      key: 'plan',
      tool: 'plan',
      label: TRAIL_SPECIAL_META.plan.label,
      glyph: TRAIL_SPECIAL_META.plan.glyph,
      status: planStep.status,
      summary: progress.goal,
    });
  }

  for (const step of progress.steps) {
    if (step.tool === 'plan') continue;
    const visual = visualOf(step.tool, step.status);
    nodes.push({
      key: `${step.tool}-${nodes.length}`,
      tool: step.tool,
      label: visual.label,
      glyph: visual.glyph,
      status: step.status,
      summary: step.summary,
      ...(step.durationMs != null ? { durationMs: step.durationMs } : {}),
      ...(step.why ? { why: step.why } : {}),
    });
  }

  if (progress.running) {
    const visual = visualOf(progress.running.tool, 'running');
    nodes.push({
      key: `running-${progress.running.tool}`,
      tool: progress.running.tool,
      label: visual.label,
      glyph: visual.glyph,
      status: 'running',
      summary: progress.running.why,
      why: progress.running.why,
    });
  }

  // 规划里还没执行的步骤：暗星。已经执行过的同名工具不再重复画
  const done = new Set(nodes.map((n) => n.tool));
  for (const [i, step] of progress.planned.entries()) {
    if (done.has(step.tool) || step.tool === 'plan' || step.tool === 'final') continue;
    const visual = visualOf(step.tool, 'pending');
    nodes.push({
      key: `planned-${step.tool}-${i}`,
      tool: step.tool,
      label: visual.label,
      glyph: visual.glyph,
      status: 'pending',
      summary: step.why,
      why: step.why,
      pending: true,
    });
  }

  return nodes.slice(0, 9);
}

export function StarTrail({ trail }: { trail: StarTrail }) {
  return (
    <section aria-label="本次任务执行轨迹" className="star-card mt-3 p-4">
      <TrailHeader goal={trail.goal} />
      {trail.degraded && <DegradedBanner />}
      <TrailRail nodes={nodesOfSteps(trail.steps, true)} animated />
      <StepLog nodes={nodesOfSteps(trail.steps, false)} />
    </section>
  );
}

/**
 * 活星轨：执行中逐颗点亮。
 * `steps` 来自服务端快照，组件不做任何本地"假装执行"的计时器 —— 见文件头。
 */
export function StarTrailLive({ progress }: { progress: AgentProgress }) {
  const nodes = nodesOfProgress(progress);
  const executed = nodes.filter((n) => n.status !== 'pending' && n.status !== 'running');

  return (
    <section
      aria-label="星枢AI执行轨迹"
      aria-busy={progress.phase !== 'final'}
      className="star-card mt-3 p-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <TrailHeader goal={progress.goal} inline />
        {progress.photos > 0 && (
          <span className="inline-flex items-center gap-1 rounded-sticker border border-space-700 px-2 py-0.5 text-[11px] text-accent-300">
            <Eye size={11} aria-hidden />
            看了 {progress.photos} 张照片
          </span>
        )}
        <PhaseBadge phase={progress.phase} running={progress.running} />
      </div>

      <TrailRail nodes={nodes} />

      {progress.note && (
        <p role="status" className="mt-3 flex items-center gap-1.5 text-xs text-star-yellow">
          <span aria-hidden>❙❙</span>
          {progress.note}
        </p>
      )}

      <StepLog nodes={nodes} />

      {executed.length === 0 && progress.phase !== 'final' && (
        <p className="mt-2 text-xs text-lo/70">正在把任务拆成工具调用…</p>
      )}
    </section>
  );
}

/** 请求发出后的占位轨迹：只有规划星在脉冲，配「正在规划路径…」 */
export function StarTrailPending({ label = '正在规划路径…' }: { label?: string }) {
  return (
    <section aria-label="星枢AI正在执行任务" aria-busy="true" className="star-card mt-3 p-4">
      <div className="flex items-center gap-3">
        <span className="relative grid h-9 w-9 place-items-center rounded-full border border-accent-400">
          <span aria-hidden className="trail-halo absolute inset-0 rounded-full bg-accent-400" />
          <span aria-hidden className="h-4 w-4 rounded-full bg-accent-400" />
        </span>
        <span className="text-sm text-lo" role="status">
          {label}
        </span>
      </div>
    </section>
  );
}

/* ────────────────── 内部件 ────────────────── */

function TrailHeader({ goal, inline = false }: { goal: string; inline?: boolean }) {
  return (
    <p className={`text-xs text-lo ${inline ? '' : 'mb-3'}`}>
      <span className="text-accent-400" aria-hidden>
        ✦{' '}
      </span>
      <span className="data-mono">任务目标：</span>
      {goal}
    </p>
  );
}

function PhaseBadge({ phase, running }: { phase: AgentProgress['phase']; running: AgentProgress['running'] }) {
  const text =
    phase === 'planning'
      ? '规划中'
      : phase === 'awaiting'
        ? '等待你确认'
        : phase === 'final'
          ? '已完成'
          : running
            ? `执行 ${trailToolLabel(running.tool)}`
            : '思考下一步';

  const tone =
    phase === 'awaiting'
      ? 'border-star-yellow/50 text-star-yellow'
      : phase === 'final'
        ? 'border-star-green/40 text-star-green'
        : 'border-accent-400/40 text-accent-300';

  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1 rounded-sticker border px-2 py-0.5 text-[11px] ${tone}`}
    >
      {phase !== 'final' && (
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current trail-halo" />
      )}
      {text}
    </span>
  );
}

function DegradedBanner() {
  return (
    <p
      role="status"
      className="trail-degraded mb-3 flex items-center gap-1.5 rounded-card border border-star-red/40 bg-star-red/12 px-3 py-1.5 text-xs text-star-red"
    >
      <ShieldAlert size={14} aria-hidden />
      改走安全航线：部分工具执行失败，以下回答来自普通问答
    </p>
  );
}

/** 星轨主轨道：星点 + 生长连线。animated = 入场 stagger（回放用；执行中不推迟） */
function TrailRail({
  nodes,
  animated = false,
}: {
  nodes: Array<RailNode & { delay?: number }>;
  animated?: boolean;
}) {
  const [pinned, setPinned] = useState<string | null>(null);
  const firstError = nodes.findIndex((n) => n.status === 'error');

  return (
    <div className="overflow-x-auto pb-1">
      <ol className="flex items-start gap-0">
        {nodes.map((node, i) => {
          const meta = statusMeta(node.status);
          const dimmed = firstError >= 0 && i > firstError;
          const isLast = i === nodes.length - 1;
          const showTip = pinned === node.key;
          const delay = animated ? (node.delay ?? 0) : 0;

          return (
            <li
              key={`${node.key}-${node.status}`}
              className="flex min-w-0 flex-1 items-start last:flex-none"
            >
              <div className="group relative flex w-14 shrink-0 flex-col items-center">
                <button
                  type="button"
                  className={`trail-star-in relative grid h-9 w-9 place-items-center rounded-full border transition-transform hover:scale-110 ${
                    dimmed ? 'opacity-40' : ''
                  } ${node.pending ? 'trail-star-pending' : ''}`}
                  style={{
                    animationDelay: `${delay}ms`,
                    borderColor: meta.dot,
                    transitionDuration: 'var(--dur)',
                    transitionTimingFunction: 'var(--ease)',
                  }}
                  aria-label={`${node.label}：${meta.label}。${node.summary}`}
                  onClick={() => setPinned((prev) => (prev === node.key ? null : node.key))}
                >
                  {node.status === 'running' && (
                    <span
                      aria-hidden
                      className="trail-halo absolute inset-0 rounded-full"
                      style={{ backgroundColor: meta.dot }}
                    />
                  )}
                  {/* 刚点亮的那颗闪一次（状态变化会重挂载，动画自然重放） */}
                  {(node.status === 'ok' || node.status === 'error') && !animated && (
                    <span
                      aria-hidden
                      className="trail-lit absolute inset-0 rounded-full border"
                      style={{ borderColor: meta.dot }}
                    />
                  )}
                  <span
                    aria-hidden
                    className="grid h-4 w-4 place-items-center rounded-full text-[9px]"
                    style={{
                      backgroundColor: node.pending ? 'transparent' : meta.dot,
                      border: node.pending ? `1px dashed ${meta.dot}` : undefined,
                      color: 'var(--space-900)',
                    }}
                  >
                    {node.pending ? '' : node.glyph}
                  </span>

                  {/* tooltip：hover / focus / 触屏点击 */}
                  <span
                    role="tooltip"
                    className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-52 -translate-x-1/2 rounded-card border border-space-700 bg-space-800 p-2.5 text-left text-xs leading-relaxed text-hi shadow-lg ${
                      showTip ? 'block' : 'hidden group-hover:block group-focus-within:block'
                    }`}
                  >
                    <span className={`mb-0.5 block text-[10px] ${meta.text}`}>
                      {node.label}
                      {/* 中文短名之外也给原文，排查问题时能对上 trace 里的 tool 名 */}
                      {node.tool !== 'plan' && node.tool !== 'final' && (
                        <span className="data-mono ml-1.5 text-lo">{node.tool}</span>
                      )}
                      {' · '}
                      {meta.label}
                      {node.durationMs != null ? ` · ${node.durationMs}ms` : ''}
                    </span>
                    {node.why && node.why !== node.summary && (
                      <span className="mb-0.5 block text-[10px] text-lo">为什么：{node.why}</span>
                    )}
                    {node.summary}
                  </span>
                </button>

                <span
                  className={`mt-1.5 w-full truncate text-center text-[10px] leading-tight ${
                    dimmed ? 'text-lo/50' : 'text-lo'
                  }`}
                  title={node.label}
                >
                  {node.label}
                </span>
              </div>

              {/* 轨迹连线：错误星之后变虚线。
                  注意 `from-accent-400/80` 这种写法在 CSS 变量色板上拿不到透明度修饰符，
                  Tailwind 会生成一条没有色标的渐变，最终 backgroundImage 是 none —— 线根本不存在。
                  所以这里直接写 inline 渐变（仍然只用 tokens 里的变量，不出现十六进制）。 */}
              {!isLast && (
                <span
                  aria-hidden
                  className={`trail-link mt-[17px] h-[2px] min-w-[10px] flex-1 ${
                    dimmed ? 'border-t border-dashed border-lo/40' : ''
                  }`}
                  style={{
                    animationDelay: `${delay + 60}ms`,
                    ...(dimmed || node.pending
                      ? { background: 'none' }
                      : {
                          background:
                            'linear-gradient(90deg, var(--accent-400) 0%, color-mix(in srgb, var(--accent-400) 28%, transparent) 100%)',
                        }),
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * 执行摘要日志 —— 用户点名要的「✓ 识别为小橘 → ✓ 评估为轻伤 → ✓ 已写入档案」。
 * 星轨负责「看见过程」，这行文字负责「读懂结果」：星点只有 36px，放不下摘要。
 * 只列工具步（plan/final 在星轨上有专属星形，不必重复）。
 */
function StepLog({ nodes }: { nodes: RailNode[] }) {
  const rows = nodes.filter((n) => n.tool !== 'plan' && n.tool !== 'final');
  if (!rows.length) return null;

  return (
    <ol aria-label="执行摘要" className="mt-3 flex flex-col gap-1.5 border-t border-space-700/60 pt-3">
      {rows.map((node) => {
        const meta = statusMeta(node.status);
        return (
          <li
            key={`log-${node.key}-${node.status}`}
            className="flex items-start gap-2 text-xs leading-relaxed"
          >
            <span
              aria-hidden
              className={`mt-[1px] w-3 shrink-0 text-center ${meta.text} ${
                node.status === 'running' ? 'trail-halo' : ''
              }`}
            >
              {STATUS_GLYPH[node.status]}
            </span>
            <span className="min-w-0 flex-1 text-lo">
              <span className={`${meta.text}`}>{node.label}</span>
              <span className="mx-1 text-lo/40" aria-hidden>
                ·
              </span>
              <span className="text-hi/90">{node.summary}</span>
              {node.durationMs != null && node.status !== 'running' && (
                <span className="data-mono ml-1.5 text-[10px] text-lo/60">{node.durationMs}ms</span>
              )}
            </span>
            {node.status === 'running' && (
              <span className="flex items-center gap-1 text-[10px] text-accent-400">
                <Sparkles size={10} aria-hidden />
                执行中
              </span>
            )}
            {node.pending && (
              <span className="flex items-center gap-0.5 text-[10px] text-lo/50">
                计划中
                <ChevronRight size={10} aria-hidden />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
