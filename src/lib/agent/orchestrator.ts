import { z } from 'zod';
import { AGENT_LIMITS, DISCLAIMER } from '@/lib/constants';
import { log } from '@/lib/logger';
import { runStructured } from '@/lib/ai/registry';
import {
  AgentFinalSchema,
  AgentNextStepSchema,
  AgentPlanSchema,
} from '@/lib/ai/schemas';
import { answerQuestion } from '@/lib/rag/answer';
import { trailStepsOf, type AgentProgress } from '@/lib/api/agent-contract';
import type { Prisma } from '@prisma/client';
import {
  awaitGate,
  closeRun,
  isAborted,
  isPaused,
  openRun,
  type GateDecision,
} from './gate';
import { createTrace, pushStep, finishTrace, type TraceRun } from './trace';
import { getTool, listTools, type ToolContext } from './tools';

/**
 * ReAct 编排（阶段 8；2026-10-28 补齐流式进度 + 人在回路 + 多图）。
 *
 * plan → [决策 → （闸门）→ 调工具 → 观察]* → 整合。
 *
 * 与 S6 的"规划一次顺序执行"的差别：每执行完一个工具，把结果摘要喂回
 * AGENT_NEXT_STEP，让下一步决策建立在已有观察之上（ctx 里的 animalId/animalCode
 * 也是这条反馈链的一部分 —— 识别到谁，后面的评估/记录就落在谁身上）。
 *
 * 硬约束：
 * - 工具执行 ≤ AGENT_LIMITS.maxToolCalls（5）次，加上 plan 与 final 总步数 ≤ 7；
 * - 单步超时 8s；决策轮失败不抛异常，直接结束工具阶段；
 * - **工具跑到一半出错 → 立即中断 → 降级为普通 RAG 回答（degraded）**。
 *   失败硬走会产生"半份档案"，比没有更糟。
 * - **入参被 zod 拒掉 → 不算失败**（2026-10-28 修）：那一轮工具一次都没执行，
 *   没有任何副作用可挽回，错误回灌给决策模型让它自己改参数或换工具；
 *   连续 maxRejectedArgs 次被拒才降级。改动前这里是"任一 error 立即降级"，
 *   实测导致"模型把 description 写成 null → 一条参数错就把前面 5 步已成功的观察全丢掉"。
 *
 * 2026-10-28 新增两条：
 * - **进度可观察**（`deps.emit`）：每变一次状态推一个 AgentProgress 快照，前端的星
 *   因此是"被真正点亮"而不是等结果回来补一段动画。快照统一从 trace 派生
 *   （trailStepsOf），所以流式看到的步骤与最终 trail 不可能不一致。
 * - **人在回路**（`input.confirmEach` + lib/agent/gate.ts）：每个工具真正执行前可以
 *   挂起，把"打算调哪个工具、为什么、拿什么参数"交给用户确认；用户也可以随时接管。
 *   闸门只挂在**执行前**：工具已经跑完再暂停没有意义（副作用已经发生）。
 */

export interface AgentRunInput {
  message: string;
  /** 主照片（档案封面 / 观察记录图） */
  photoUrl?: string | null;
  /** 本次请求附带的全部照片（多模态，最多 3 张；第一张与 photoUrl 相同也去重） */
  photoUrls?: string[];
  /**
   * 用户本轮授权的设备定位（2026-10-29，WGS-84）。
   * 只有用户在输入区点了「用当前位置」才会带上来，服务端仍会过一遍校园围栏。
   */
  userLocation?: { lat: number; lng: number; accuracyM?: number | null } | null;
  ip?: string | null;
  /** true = 每个工具执行前都要用户点「继续」（答辩演示 human-in-the-loop 用） */
  confirmEach?: boolean;
  /** 外部指定 runId（流式入口用它让前端从第一条事件起就能暂停/接管） */
  runId?: string;
}

export interface AgentDeps {
  /** 自测注入：替换结构化 AI 入口 */
  run?: typeof runStructured;
  /** 自测注入：替换工具查找（模拟工具未注册 / 工具抛错） */
  getTool?: typeof getTool;
  /** 自测注入：事务包装（验证观察与预警同事务回滚） */
  transact?: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
  /** 进度回调（SSE 用）。不传 = 老的非流式路径，行为与改动前一致 */
  emit?: (progress: AgentProgress) => void;
  /** 自测注入：闸门等待（模拟用户点「继续 / 跳过 / 接管」） */
  awaitGate?: (runId: string, ttlMs: number) => Promise<GateDecision>;
}

export interface AgentRunResult {
  trace: TraceRun;
  answer: string;
  needsHuman: boolean;
  degraded: boolean;
  /** true = 用户在工具阶段中途暂停/接管，回答只基于已完成的步骤 */
  paused?: boolean;
  notice?: string;
  disclaimer?: string;
  /** assessHealth 工具的置信度（0-1）。没跑健康评估时为 undefined */
  confidence?: number;
  /** 本次交给模型的照片张数 */
  photos: number;
}

export async function runAgent(
  input: AgentRunInput,
  deps: AgentDeps = {},
): Promise<AgentRunResult> {
  const run = deps.run ?? runStructured;
  const findTool = deps.getTool ?? getTool;
  const waitGate = deps.awaitGate ?? awaitGate;
  const trace = createTrace(input.message, input.runId);
  const runId = trace.id;
  const photos = dedupePhotos(input);

  openRun(runId);
  try {
    return await execute();
  } finally {
    // 无论成功、失败、超时都收尾：漏一次就会留下一个永远"等待中"的 run
    closeRun(runId);
  }

  async function execute(): Promise<AgentRunResult> {
    const ctx: ToolContext = {
      ...(photos.length ? { photoUrl: photos[0], photoUrls: photos } : {}),
      ...(input.userLocation ? { userLocation: input.userLocation } : {}),
      ip: input.ip ?? undefined,
      ...(deps.transact ? { transact: deps.transact } : {}),
    };

    /* ── 进度快照：唯一的状态出口 ─────────────────────────────── */
    let phase: AgentProgress['phase'] = 'planning';
    let planned: AgentProgress['planned'] = [];
    let running: AgentProgress['running'] = null;
    let gate: AgentProgress['gate'] = null;
    let note: string | undefined;

    const emitProgress = () => {
      if (!deps.emit) return;
      const snapshot = trailStepsOf(trace);
      deps.emit({
        runId,
        goal: snapshot.goal,
        phase,
        planned,
        steps: snapshot.steps.slice(0, 7),
        running,
        gate,
        photos: photos.length,
        ...(note ? { note } : {}),
      });
    };

    /* ── plan：产出 goal + 规划路线（路线只用于展示，实际序列交给逐步决策）── */
    const plan = await run(
      {
        intent: 'AGENT_PLAN',
        prompt: input.message,
        // 把真实工具清单交给规划器：不给它清单，它会自己发明 `check_animal_injury`
        // 这种"看起来很合理"的工具名（实测），星轨上的规划暗星就全是假的
        context: { tools: listTools() },
      },
      AgentPlanSchema,
    );
    // 自测会注入不完整 plan（只给 goal），所以这里不假设 steps 一定存在：
    // 规划只是"展示用路线"，缺了不影响逐步决策，缺了就别画暗星。
    const planSteps = plan.ok && Array.isArray(plan.data.steps) ? plan.data.steps : [];
    const goal =
      plan.ok && typeof plan.data.goal === 'string' && plan.data.goal
        ? plan.data.goal
        : input.message.slice(0, 120);
    pushStep(trace, {
      kind: 'plan',
      label: '规划',
      detail: goal,
      status: plan.ok ? 'ok' : 'fallback',
    });
    planned = planSteps
      .filter((s) => typeof s?.tool === 'string' && s.tool.length > 0 && findTool(s.tool))
      .map((s) => ({ tool: s.tool, why: s.why ?? '规划步骤' }))
      .slice(0, 5);
    phase = 'running';
    emitProgress();

    const toolResults: Array<{ tool: string; summary: string }> = [];
    /** 已执行过的「工具 + 参数」指纹，用来拦同参重复调用（见循环里的说明） */
    const callSignatures = new Set<string>();
    /** 指纹 → 被请求次数；指纹 → 上次的结果摘要（重复请求时回灌给模型） */
    const repeats = new Map<string, number>();
    const lastSummaries = new Map<string, string>();
    /** 已经真正执行成功的工具名（用来给决策器算「自己那份计划推进到哪了」） */
    const doneTools = new Set<string>();

    /**
     * 把「AI 自己规划的那条路线」连同完成情况回灌给决策器（2026-10-28）。
     *
     * 实测问题：`assessHealth` 成功写库之后，模型会再调同一个工具、同一组参数，
     * 一路撞到重复上限就收尾 —— 任务停在「评估完、档案没写」的半途，星轨上
     * 只亮一颗真星。补的不是关键词硬规则（那会把判断权从 AI 手里拿走），
     * 而是它自己的计划进度：已完成的步骤标 done，下一步就是第一个没 done 的。
     * 计划本身是 AI 产的，提醒它按自己的计划走，属于编排层的事实回灌。
     */
    const planProgress = () =>
      planned.map((p, idx) => ({
        step: idx + 1,
        tool: p.tool,
        why: p.why,
        done: doneTools.has(p.tool),
      }));

    /**
     * 同一份进度的一行中文摘要。
     * 结构化数组要模型自己比对 done 标记，实测它经常不看；一句直白的
     * 「已完成 X，尚未执行 Y，下一步别重调 X」更容易被遵守。
     */
    const planProgressText = () => {
      const done = [...new Set([...doneTools])];
      const pending = [...new Set(planned.filter((p) => !doneTools.has(p.tool)).map((p) => p.tool))];
      const parts: string[] = [];
      if (done.length) parts.push(`已完成并已有结果（不要重调）：${done.join('、')}`);
      if (pending.length) parts.push(`计划里还没做：${pending.join('、')}`);
      parts.push(
        done.length
          ? '下一步请从「还没做」里挑一个真正必要的工具执行，或输出 finish 收尾。'
          : '还没有任何工具执行成功，请从计划的第一步开始。',
      );
      return parts.join('；');
    };
    let degraded = false;
    let interrupted = false;
    let rejectedArgs = 0;
    /** 模型编造工具名的次数（与入参被拒分开计：两件事的补救方式不一样） */
    let invented = 0;
    let notice: string | undefined;
    let disclaimer: string | undefined;
    let confidence: number | undefined;

    /* ── ReAct 循环：决策 → （闸门）→ 执行 → 观察 ─────────────── */
    for (let i = 0; i < AGENT_LIMITS.maxToolCalls; i += 1) {
      // 用户上一轮就点了接管：不再让模型花一次调用去"决定下一步"
      if (isAborted(runId)) {
        interrupted = true;
        break;
      }

      const decision = await run(
        {
          intent: 'AGENT_NEXT_STEP',
          prompt: input.message,
          /**
           * 键的顺序是有意的（2026-10-28）：上下文序列化后会被截断，
           * 必须把「决定下一步」真正要用的状态排在最前面，把最大的工具清单放最后 ——
           * 否则 tools 一占满预算，plan 与 doneTools 就被整段截掉，模型只会原地重调。
           */
          context: {
            goal,
            message: input.message,
            /* 有定位就要明说（2026-10-29）：模型看不见手机的位置，
               不告诉它「这一轮可以取当前位置」，它只会照旧要用户说地点名。
               排在 message 之后、tools 之前 —— 只有几十个字符，被截断也不会丢。 */
            ...(input.userLocation
              ? {
                  location: {
                    available: true,
                    accuracyM: input.userLocation.accuracyM ?? null,
                    hint: '用户本轮已授权设备定位：说「就在这儿/我旁边」时用 recordLocation 的 useCurrentPosition=true，不要传 place',
                  },
                }
              : {}),
            progress: planProgressText(),
            plan: planProgress(),
            doneTools: [...doneTools],
            toolResults,
            callsLeft: AGENT_LIMITS.maxToolCalls - i,
            tools: listTools(),
          },
        },
        AgentNextStepSchema,
      );

      if (!decision.ok) {
        log.warn('agent.decision_failed', { code: decision.error, message: decision.message, round: i });
        pushStep(trace, {
          kind: 'tool_call',
          label: 'decide',
          detail: '决策不可用，结束工具阶段',
          status: 'fallback',
        });
        break;
      }
      if (decision.data.action !== 'tool' || !decision.data.tool) break;

      const tool = findTool(decision.data.tool);
      const why = decision.data.why || '执行工具';
      const startedAt = Date.now();

      if (!tool) {
        /**
         * 两种"工具不可用"，处理必须分开（2026-10-28 实测）：
         *  a) 名字在注册表里、但取不到实例 → 运行时故障，按原规矩立即降级；
         *  b) 名字根本不在注册表 → 模型自己编了个工具名（实测 GLM 会造
         *     `check_animal_injury` / `record_injury` 这种"看起来很合理"的名字）。
         *     b 是决策错误，不是系统故障：把可用工具清单回灌给它，让它换一个。
         *     一次就降级会让演示在第一步崩掉，而且用户什么都没做错。
         */
        const known = listTools().some((t) => t.name === decision.data.tool);
        if (known) {
          pushStep(trace, {
            kind: 'tool_call',
            label: decision.data.tool,
            detail: `工具未注册：${decision.data.tool}`,
            status: 'error',
            durationMs: 0,
          });
          degraded = true;
          break;
        }

        invented += 1;
        log.warn('agent.invented_tool', { tool: decision.data.tool, round: i, invented });
        pushStep(trace, {
          kind: 'tool_result',
          label: decision.data.tool,
          detail: `没有这个工具，已让决策器改用现有工具（${decision.data.tool}）`,
          status: 'fallback',
          durationMs: Date.now() - startedAt,
        });
        toolResults.push({
          tool: decision.data.tool,
          summary: `不存在名为 ${decision.data.tool} 的工具，本步未执行。可用工具只有：${listTools()
            .map((t) => t.name)
            .join('、')}。请从中选一个，或直接 finish`,
        });
        emitProgress();
        if (invented >= AGENT_LIMITS.maxRejectedArgs) {
          degraded = true;
          break;
        }
        continue;
      }

      /* ── 入参校验：被拒 ≠ 失败 ────────────────────────────────
         工具还没执行，写库、发预警、改档位一件都没发生，没有"半份档案"的风险。
         所以把错误当成一次观察回灌给模型，让它自己改参数或换工具 ——
         这正是 ReAct 的纠错回路。连续被拒 maxRejectedArgs 次才认定它不会用工具。 */
      const args = stripNullDeep(decision.data.args ?? {});
      const parsedInput = tool.input.safeParse(args);
      if (!parsedInput.success) {
        // 报出具体是哪个字段错：「Invalid input」这种裸文案回灌给模型等于没说
        const issue = parsedInput.error.issues[0];
        const reason = issue
          ? `${issue.path.join('.') || '入参'}：${issue.message}`
          : '请检查工具入参';
        rejectedArgs += 1;
        log.warn('agent.args_rejected', {
          tool: tool.name,
          reason,
          round: i,
          rejectedArgs,
          args: JSON.stringify(args).slice(0, 300),
        });
        pushStep(trace, {
          kind: 'tool_result',
          label: tool.name,
          detail: `参数不合法，本步未执行：${reason}`,
          status: 'fallback',
          durationMs: Date.now() - startedAt,
        });
        toolResults.push({
          tool: tool.name,
          summary: `调用被拒（参数不合法：${reason}），本步未执行。请修正参数后重试，或改用其它工具`,
        });
        emitProgress();
        if (rejectedArgs >= AGENT_LIMITS.maxRejectedArgs) {
          degraded = true;
          break;
        }
        continue;
      }

      /**
       * 同参重复调用拦在这里（2026-10-28）。
       * 实测模型会拿同一个工具、同一组参数连调 4~5 次（"再看一眼"），每次都是一次
       * 真模型调用，最后把免费档打到 429 —— 表现成"工具执行失败 → 改走安全航线"。
       * 参数一样结果就一定一样，所以**不重复执行**。
       *
       * 但不能直接结束工具阶段：实测「评估为预览模式（缺照片未落库）」之后模型会
       * 再要一次评估，若此时直接收尾，任务就停在"评估完、档案没写"的半途。
       * 所以第一次重复把已有结果当观察回灌，催它走下一步；累计到 maxRepeatedCalls
       * 说明它真的在原地打转，才收尾。
       */
      const signature = `${tool.name}:${JSON.stringify(parsedInput.data)}`;
      if (callSignatures.has(signature)) {
        repeats.set(signature, (repeats.get(signature) ?? 0) + 1);
        const times = repeats.get(signature)!;
        const previous = lastSummaries.get(signature) ?? '（上一步已执行）';
        pushStep(trace, {
          kind: 'tool_result',
          label: tool.name,
          detail: `同一调用已经执行过，跳过重复执行（用已有结果）`,
          status: 'fallback',
          durationMs: Date.now() - startedAt,
        });
        log.warn('agent.duplicate_call_skipped', { tool: tool.name, round: i, times });
        toolResults.push({
          tool: tool.name,
          summary: `这一步刚刚已经执行过，结果：${previous}。不要用同样的参数再调一次，请根据这个结果继续下一步，或直接结束`,
        });
        emitProgress();
        if (times >= AGENT_LIMITS.maxRepeatedCalls) break;
        continue;
      }
      callSignatures.add(signature);

      /* ── 闸门（人在回路）：执行前把"打算做什么"交给用户 ──────
         顺序很重要：校验与去重都在闸门之前。让用户去确认一次注定会被 zod 拒掉的
         调用毫无意义，只会白等 30 秒。 */
      if (input.confirmEach || isPaused(runId)) {
        phase = 'awaiting';
        gate = {
          index: trailStepsOf(trace).steps.length,
          tool: tool.name,
          why,
          preview: previewArgs(args),
          expiresAt: Date.now() + AGENT_LIMITS.gateTimeoutMs,
        };
        note = input.confirmEach
          ? '每一步执行前都需要你确认（人在回路）'
          : '已暂停：下一步还没执行，等你决定';
        emitProgress();

        const decisionFromUser = await waitGate(runId, AGENT_LIMITS.gateTimeoutMs);
        gate = null;
        note = undefined;
        phase = 'running';
        emitProgress();

        if (decisionFromUser === 'abort') {
          interrupted = true;
          log.info('agent.human_takeover', { runId, round: i, tool: tool.name });
          break;
        }
        if (decisionFromUser === 'skip') {
          pushStep(trace, {
            kind: 'tool_result',
            label: tool.name,
            detail: '按你的要求跳过这一步，未执行',
            status: 'fallback',
            durationMs: 0,
          });
          toolResults.push({
            tool: tool.name,
            summary: '用户跳过了这一步（未执行）。不要重试，继续用已有观察完成任务',
          });
          emitProgress();
          continue;
        }
      }

      pushStep(trace, {
        kind: 'tool_call',
        label: tool.name,
        detail: why,
        status: 'running',
      });
      running = { tool: tool.name, why };
      emitProgress();

      try {
        const output = await withTimeout(
          tool.run(parsedInput.data, ctx),
          AGENT_LIMITS.timeoutMs,
        );
        tool.harvest?.(output, ctx);
        const meta = tool.meta?.(output);
        if (meta?.notice) notice = meta.notice;
        if (meta?.disclaimer) disclaimer = meta.disclaimer;
        if (typeof meta?.confidence === 'number') confidence = meta.confidence;

        const summary = tool.summarize(output);
        lastSummaries.set(signature, summary);
        toolResults.push({ tool: tool.name, summary });
        doneTools.add(tool.name);
        pushStep(trace, {
          kind: 'tool_result',
          label: tool.name,
          detail: summary,
          status: 'ok',
          durationMs: Date.now() - startedAt,
        });
        running = null;
        emitProgress();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn('agent.tool_failed', { tool: tool.name, error: message });
        pushStep(trace, {
          kind: 'tool_result',
          label: tool.name,
          detail: `调用失败：${message}`,
          status: 'error',
          durationMs: Date.now() - startedAt,
        });
        running = null;
        emitProgress();
        degraded = true;
        break;
      }
    }

    /* ── 用户接管/暂停：不降级、不装作做完，只交代已经完成的部分 ── */
    if (interrupted) {
      phase = 'final';
      const done = trailStepsOf(trace).steps.filter((s) => s.status === 'ok' && s.tool !== 'plan');
      const partial = await run(
        {
          intent: 'AGENT_FINAL',
          prompt: input.message,
          context: { goal, toolResults, interrupted: true },
        },
        AgentFinalSchema,
      );
      // 0 步就接管时不要再找模型：它只会回一句「没有可执行的信息」，
      // 而用户需要知道的是"我停下了、什么都没做"—— 这是状态，不是结论。
      // 有已完成的步骤才让模型总结（它手里有真实观察，红线要求结论由 AI 给）。
      const head = done.length
        ? `已按你的要求停下（完成 ${done.length} 步）。`
        : '已按你的要求停下，这次没有执行任何工具，档案没有被改动。';
      const answer = done.length
        ? `${head}${partial.ok ? partial.data.answer : done.map((s) => s.summary).join('；') + '。'}`
        : head;
      pushStep(trace, {
        kind: 'final',
        label: '整合回复',
        detail: `用户接管，已停止后续步骤（完成 ${done.length} 步）`,
        status: 'fallback',
      });
      emitProgress();
      finishTrace(trace);
      return {
        trace,
        answer,
        needsHuman: false,
        degraded: false,
        paused: true,
        notice,
        disclaimer,
        confidence,
        photos: photos.length,
      };
    }

    /* ── 降级：任一工具失败 → 普通 RAG 回答（"改走安全航线"） ──── */
    if (degraded) {
      const rag = await answerQuestion({ question: input.message });
      const ragAnswer = rag.ok
        ? rag.data.answer
        : '知识库暂时也帮不上忙，请补充动物编号或换种说法再试。';
      phase = 'final';
      pushStep(trace, {
        kind: 'final',
        label: '整合回复',
        detail: `工具链路出了问题，已改走安全航线（普通问答）。${ragAnswer}`,
        status: 'fallback',
      });
      emitProgress();
      finishTrace(trace);
      return {
        trace,
        answer: `（部分工具执行失败，以下回答改走了安全航线）${ragAnswer}`,
        needsHuman: false,
        degraded: true,
        notice,
        disclaimer,
        confidence,
        photos: photos.length,
      };
    }

    /* ── final：整合工具观察 ─────────────────────────────────── */
    const final = await run(
      {
        intent: 'AGENT_FINAL',
        prompt: input.message,
        context: { goal, toolResults },
      },
      AgentFinalSchema,
    );

    const answer = final.ok
      ? final.data.answer
      : toolResults.length
        ? `${toolResults.map((r) => r.summary).join('；')}。${DISCLAIMER}`
        : '没有可执行的信息，请补充动物编号或更具体的描述。';
    const needsHuman = final.ok
      ? final.data.needsHuman === true
      : /严重|SEVERE|紧急|出血/.test(input.message);

    phase = 'final';
    pushStep(trace, {
      kind: 'final',
      label: '整合回复',
      detail: final.ok ? final.data.answer : '模型整合失败，已返回已确认的工具结果摘要。',
      status: final.ok ? 'ok' : 'fallback',
    });
    emitProgress();

    finishTrace(trace);
    return { trace, answer, needsHuman, degraded: false, notice, disclaimer, confidence, photos: photos.length };
  }
}

/**
 * 照片去重 + 收敛。
 * 第一张是主图（与 toolContext.photoUrl 同源），所以 photoUrl 与 photoUrls 里
 * 重复的那张必须只留一份 —— 否则健康评估会把同一张照片当两个视角再算一遍。
 * 上限 3 张：更多视角的边际信息已经很小，token 与延迟却线性上涨。
 */
function dedupePhotos(input: AgentRunInput): string[] {
  const all = [input.photoUrl ?? '', ...(input.photoUrls ?? [])].filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  return [...new Set(all)].slice(0, 3);
}

/** 闸门里给用户看的入参预览：截断 + 去掉换行，太长会把确认面板撑爆 */
function previewArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (!keys.length) return '（无参数）';
  const text = JSON.stringify(args).replace(/\s+/g, ' ');
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

/**
 * 模型给的入参里，`null` 一律当「没提供」。
 *
 * 实测 GLM 在「这个字段确实无从填起」时习惯写 `null`（不是省略），而每个工具的
 * 可选字段都是 `z.string().optional()` —— zod 的 optional 只放行 undefined，
 * `null` 会被判 `Expected string, received null`，一次参数错就把整条链路打成降级。
 * 语义上 null 与 undefined 在这里等价（都是"没给"），所以在校验前统一抹平。
 * 只处理对象/数组内部的 null，不碰字符串里的 "null" 字样。
 */
function stripNullDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripNullDeep(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      out[k] = stripNullDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`工具执行超时（${ms}ms）`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
