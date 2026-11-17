/**
 * Agent 自检（第 8 阶段）。
 * 用法：npm run agent:selftest         —— 直连（ReAct 链路 / 步数上限 / 降级 / 事务）
 *       npm run agent:http:selftest    —— 额外起 next dev 跑真实 HTTP（multipart / 幂等 / 契约）
 *
 * 断言清单见 docs/stage-8-agent.md §3.7。
 * 测试数据全部自建自清：观察按 content 前缀、预警按 dedupeKey 前缀 + 本次运行时间窗。
 */
import '../src/lib/load-env';
import type { Prisma } from '@prisma/client';
import { startDev, stopDev, waitFor } from './lib/dev-server';
import { prisma } from '../src/lib/db';
import { runAgent } from '../src/lib/agent/orchestrator';
import { getTool, listTools } from '../src/lib/agent/tools';
import { CAMPUS_SPOTS } from '../src/lib/map-config';
import { resolveCampusSpot } from '../src/lib/animals/location';
import { traceToTrail } from '../src/lib/api/agent-contract';
import type { AgentProgress } from '../src/lib/api/agent-contract';
import { AGENT_LIMITS, ALERT_NOTICE, MANUAL_SEVERE_NOTICE } from '../src/lib/constants';

// 自检必须与 .env 无关：ReAct 决策走真实 Provider 会让断言随网络漂移
process.env.AI_PROVIDER = 'mock';

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

/** 自检专用前缀：观察 content 带上它，清理阶段只认自己建的行 */
const PREFIX = 'TEST:AGENT:';
const RUN_STARTED_AT = new Date();

/** 本轮用到的种子动物编号（queryArchive 要真实档案，不能自建——编号格式由库里的 nextCode 决定） */
const SEED_CODES = ['No.001', 'No.002'];

/**
 * 位置记录自测会真的挪档案点位 —— 跑之前先记下原值，清理阶段无条件还原，
 * 否则种子数据的星图点位会随着每次自测漂移（演示截图就对不上了）。
 */
const ORIGINAL_COORDS = new Map<string, { mapLat: number | null; mapLng: number | null }>();

/** 观察侧预警的 dedupeKey 前缀：清理时只回收本次运行产生的，不碰种子预警 */
const OBS_DEDUPE_PREFIX = 'OBS_';

async function toolNames(trace: { steps: Array<{ kind: string; label: string; status: string }> }) {
  return trace.steps
    .filter((s) => (s.kind === 'tool_result' && s.status === 'ok') || (s.kind === 'tool_call' && s.status === 'error'))
    .map((s) => s.label);
}

async function cleanup() {
  console.log('\n[清理] 观察按 content 前缀，预警按 dedupeKey 前缀 + 运行窗口');
  const obs = await prisma.observation.findMany({
    where: { content: { startsWith: PREFIX } },
    select: { id: true },
  });
  const obsIds = obs.map((o) => o.id);
  const alerts = await prisma.alert.findMany({
    where: { dedupeKey: { startsWith: OBS_DEDUPE_PREFIX }, createdAt: { gte: RUN_STARTED_AT } },
    select: { id: true },
  });

  await prisma.observation.deleteMany({ where: { id: { in: obsIds } } });
  await prisma.alert.deleteMany({ where: { id: { in: alerts.map((a) => a.id) } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { payload: { string_contains: PREFIX } },
        { targetType: 'Observation', targetId: { in: obsIds } },
        { targetType: 'Alert', targetId: { in: alerts.map((a) => a.id) } },
      ],
    },
  });

  // 位置自测挪过的点位必须还原
  for (const [code, coords] of ORIGINAL_COORDS) {
    await prisma.animal.updateMany({ where: { code }, data: { mapLat: coords.mapLat, mapLng: coords.mapLng } });
  }

  const leftObs = await prisma.observation.count({ where: { content: { startsWith: PREFIX } } });
  check('测试观察已清空', leftObs === 0, `残留 ${leftObs}`);
}

async function main() {
  console.log('\n[1] 工具注册表：恰好 10 个，名字与规格一致');
  const names = listTools().map((t) => t.name);
  const expected = [
    'identifyAnimal',
    'assessHealth',
    'queryArchive',
    'addObservation',
    'recordLocation',
    'checkAlerts',
    // 数据库只读三件套（让星枢能答"库里有多少、哪些要关注、最近记了什么"）
    'queryDbStats',
    'listAnimals',
    'queryObservations',
    'searchKnowledge',
  ];
  check('注册表 = 10 工具', names.length === 10, names.join(','));
  check('名字与规格逐一对应', expected.every((n) => names.includes(n)), '');
  check('每个工具都带 JSON Schema 描述', listTools().every((t) => t.schema.includes('properties')), '');

  console.log('\n[2] 示例链路：识别→评估→写观察→查预警（预警同事务落库）');
  const example = await runAgent({
    message: `${PREFIX} No.001 这只猫腿上有伤口流血，帮我看看并记录一下`,
    ip: '127.0.0.1',
  });
  const exampleTools = await toolNames(example.trace);
  check('走完 queryArchive→…→checkAlerts', exampleTools.length >= 4, exampleTools.join(' → '));
  check('addObservation 在链路里', exampleTools.includes('addObservation'), '');
  check('checkAlerts 在链路里（记录后的闭环规则）', exampleTools.includes('checkAlerts'), '');
  check('未降级', example.degraded === false, '');
  // 两种文案都算"有人被通知了"：普通预警走 ALERT_NOTICE，
  // 勾了「情况紧急」（R4）走更具体的 MANUAL_SEVERE_NOTICE（2026-10-27）。
  check(
    '触发预警 → 回传「已通知管理员」',
    example.notice === ALERT_NOTICE || example.notice === MANUAL_SEVERE_NOTICE,
    example.notice ?? 'null',
  );

  const savedObs = await prisma.observation.findFirst({
    where: { content: { startsWith: PREFIX }, animal: { code: 'No.001' } },
    orderBy: { createdAt: 'desc' },
  });
  check('观察真的落库了', Boolean(savedObs), '');
  check('观察严重度被抽成 SEVERE（伤口/流血）', savedObs?.severity === 'SEVERE', savedObs?.severity ?? 'null');
  const raisedAlert = await prisma.alert.findFirst({
    where: { animalId: savedObs?.animalId, dedupeKey: { startsWith: OBS_DEDUPE_PREFIX } },
    orderBy: { createdAt: 'desc' },
  });
  check('预警与观察同库可见', Boolean(raisedAlert), raisedAlert ? `${raisedAlert.level} @ ${String(raisedAlert.dedupeKey).slice(0, 24)}…` : 'null');
  check('预警等级 CRITICAL', raisedAlert?.level === 'CRITICAL', raisedAlert?.level ?? 'null');

  console.log('\n[3] 星轨映射：steps 形状与步数上限');
  const trail = traceToTrail(example.trace);
  check('runId 与 trace 一致', trail.runId === example.trace.id, '');
  check('首步是 plan，末步是 final', trail.steps[0]?.tool === 'plan' && trail.steps[trail.steps.length - 1]?.tool === 'final', '');
  check('每步都有 summary', trail.steps.every((s) => s.summary.length > 0), '');
  check('总步数 ≤ 7（plan + ≤5 工具 + final）', trail.steps.length <= 7, String(trail.steps.length));
  check('映射后没有 running 残留', trail.steps.every((s) => s.status !== 'running'), '');

  console.log('\n[4] 步数上限：6 个意图只执行 5 步，多出的不硬走');
  const capped = await runAgent({
    message: `${PREFIX} No.002 这只狗受伤了，帮我看看它的档案情况，识别一下，再记录一笔，然后告诉我怎么护理`,
    ip: '127.0.0.1',
  });
  const cappedTools = await toolNames(capped.trace);
  check('工具步恰好 5（maxToolCalls）', cappedTools.length === AGENT_LIMITS.maxToolCalls, cappedTools.join(' → '));
  check('星轨总步数 ≤ 7', traceToTrail(capped.trace).steps.length <= 7, String(traceToTrail(capped.trace).steps.length));
  check('没有因为截断而降级', capped.degraded === false, '');
  check('回复仍整合成功', capped.answer.length > 2, capped.answer.slice(0, 40) + '…');

  console.log('\n[5] 降级：工具失败 → 改走安全航线（普通 RAG 回答）');
  const degraded = await runAgent(
    { message: `${PREFIX} No.001 这只猫受伤了，帮我看看`, ip: '127.0.0.1' },
    // 注入：assessHealth 变成"未注册"，模拟工具层故障
    { getTool: (name: string) => (name === 'assessHealth' ? undefined : getTool(name)) },
  );
  const degradedTools = await toolNames(degraded.trace);
  check('标记 degraded', degraded.degraded === true, '');
  check('失败步之后的工具不再执行', degradedTools.includes('assessHealth') === false || degradedTools.indexOf('assessHealth') === degradedTools.length - 1, degradedTools.join(' → '));
  check('回答来自 RAG 航线并说明原因', degraded.answer.includes('安全航线'), degraded.answer.slice(0, 40) + '…');
  const degradedTrail = traceToTrail(degraded.trace);
  check('星轨标 degraded（前端据此显示横幅）', degradedTrail.degraded === true, '');
  const errIdx = degradedTrail.steps.findIndex((s) => s.status === 'error');
  check('error 之后不再有 ok 工具步', degradedTrail.steps.slice(errIdx + 1).every((s) => s.tool === 'final' || s.status !== 'ok' || s.tool === 'final'), '');

  console.log('\n[6] 事务纪律：写到一半失败 → 观察与预警都不残留');
  const before = await prisma.observation.count({ where: { content: { startsWith: PREFIX } } });
  const alertsBeforeRoll = await prisma.alert.count({
    where: { dedupeKey: { startsWith: OBS_DEDUPE_PREFIX }, createdAt: { gte: RUN_STARTED_AT } },
  });
  const rolledBack = await runAgent(
    { message: `${PREFIX} No.001 这只猫受伤了，帮我记录一下`, ip: '127.0.0.1' },
    {
      transact: <T>(_fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
        Promise.reject(new Error('注入：事务失败')),
    },
  );
  check('工具失败被接住并降级', rolledBack.degraded === true, '');
  const after = await prisma.observation.count({ where: { content: { startsWith: PREFIX } } });
  check('观察没有残留', after === before, `before=${before} after=${after}`);
  const alertsAfterRoll = await prisma.alert.count({
    where: { dedupeKey: { startsWith: OBS_DEDUPE_PREFIX }, createdAt: { gte: RUN_STARTED_AT } },
  });
  check('预警也没有残留（只有事务前已存在的那几条）', alertsAfterRoll === alertsBeforeRoll, `before=${alertsBeforeRoll} after=${alertsAfterRoll}`);

  console.log('\n[7] 入参被拒 ≠ 工具失败（2026-10-28 修）：错误回灌给决策器后链路继续');
  // 复刻实测现场：模型把可选字段写成 null、把 keyword 写成数字。
  // 改动前一次校验失败就 degraded + break，把前面已成功的观察全部丢掉，
  // 用户看到「部分工具执行失败，以下回答改走了安全航线」。
  let round = 0;
  const injected = await runAgent(
    { message: `${PREFIX} 查一下 No.001 的档案`, ip: '127.0.0.1' },
    {
      run: (async (req: { intent: string }) => {
        if (req.intent === 'AGENT_PLAN') {
          return { ok: true, provider: 'test', data: { goal: '查档案' } };
        }
        if (req.intent === 'AGENT_FINAL') {
          return {
            ok: true,
            provider: 'test',
            data: { answer: '查到了 No.001 的档案', usedTools: ['queryArchive'], needsHuman: false },
          };
        }
        round += 1;
        // 第 1 轮：keyword 类型写错 → 被 zod 拒；第 2 轮自己改对 → 正常执行
        if (round === 1) {
          return {
            ok: true,
            provider: 'test',
            data: { action: 'tool', tool: 'queryArchive', args: { keyword: 123 } },
          };
        }
        if (round === 2) {
          return {
            ok: true,
            provider: 'test',
            data: { action: 'tool', tool: 'queryArchive', args: { keyword: 'No.001' } },
          };
        }
        return { ok: true, provider: 'test', data: { action: 'finish', args: {}, why: '够了' } };
      }) as never,
    },
  );
  const injectedTrail = traceToTrail(injected.trace);
  const rejectedStep = injectedTrail.steps.find((s) => s.summary.includes('参数不合法'));
  check('参数被拒没有让整条链路降级', injected.degraded === false, '');
  check('回答不是安全航线', injected.answer.includes('安全航线') === false, injected.answer.slice(0, 30));
  check('星轨留下「参数不合法，本步未执行」的一步', Boolean(rejectedStep), '');
  check(
    '被拒的一步用 fallback 而不是 error（前端不会误报降级横幅）',
    rejectedStep?.status === 'fallback' && injectedTrail.degraded === false,
    rejectedStep?.status ?? 'none',
  );
  check(
    '改参之后同一个工具正常执行',
    injectedTrail.steps.some((s) => s.tool === 'queryArchive' && s.status === 'ok'),
    injectedTrail.steps.map((s) => `${s.tool}:${s.status}`).join(' → '),
  );

  console.log('\n[7b] 同参重复调用：跳过而不是重复烧模型（2026-10-28 修）');
  // 实测模型会拿同一工具同一参数连调 4~5 次，把免费档打到 429，
  // 最后表现成「工具执行失败 → 改走安全航线」。
  let dupRound = 0;
  /** 每次决策拿到的观察（用来验证重复调用之后回灌的是真实结果） */
  const fedBack: string[] = [];
  const dup = await runAgent(
    { message: `${PREFIX} 看看 No.001`, ip: '127.0.0.1' },
    {
      run: (async (req: { intent: string; context?: { toolResults?: Array<{ summary: string }> } }) => {
        if (req.intent === 'AGENT_PLAN') {
          return { ok: true, provider: 'test', data: { goal: '看档案' } };
        }
        if (req.intent === 'AGENT_FINAL') {
          return {
            ok: true,
            provider: 'test',
            data: { answer: 'No.001 的档案如下', usedTools: ['queryArchive'], needsHuman: false },
          };
        }
        dupRound += 1;
        for (const r of req.context?.toolResults ?? []) fedBack.push(r.summary);
        // 三轮完全一样的决策
        return {
          ok: true,
          provider: 'test',
          data: { action: 'tool', tool: 'queryArchive', args: { keyword: 'No.001' } },
        };
      }) as never,
    },
  );
  const dupTrail = traceToTrail(dup.trace);
  const executed = dupTrail.steps.filter((s) => s.tool === 'queryArchive' && s.status === 'ok');
  const dupSkipped = dupTrail.steps.filter((s) => s.summary.includes('已经执行过'));
  check('同参调用只真执行一次', executed.length === 1, `${executed.length} 次`);
  check('重复的那次记为跳过', dupSkipped.length >= 1, `${dupSkipped.length} 次`);
  // 第一次重复要「回灌已有结果、催它走下一步」，而不是直接收尾——
  // 否则「评估完还没写档案」的任务会停在半途（2026-10-28 实测）。
  check('第一次重复后仍在继续（没有立刻收尾）', dupSkipped.length === 2, `${dupSkipped.length} 次跳过`);
  check(
    '回灌给决策的是上一步的真实结果',
    fedBack.some((s) => s.includes('这一步刚刚已经执行过') && s.includes('结果：')),
    fedBack.at(-1)?.slice(0, 60) ?? '（无）',
  );
  check('重复调用不降级', dup.degraded === false && dup.answer.includes('安全航线') === false, '');

  console.log('\n[7d] 计划进度回灌：模型能看见「这一步已完成」（2026-10-28）');
  // 实测事故：9 个工具的 JSON Schema 摘要单独就 ~3150 字符，正好把 buildSystem 的
  // 3000 截断预算吃干，排在 tools 之后的 plan / doneTools 被整段截掉。模型看不见
  // "已完成"，就把同一工具再调一遍，一路撞到重复上限收尾 —— 星轨上只亮一颗星、
  // 任务停在"评估完档案没写"的半途。提示词与编排都对，坏在序列化，最难查。
  // 这里守两件事：① 上下文里真的带上了进度；② 进度排在工具清单之前，截断时先保住它。
  const decisionCtx: Array<Record<string, unknown>> = [];
  let planRound = 0;
  await runAgent(
    { message: `${PREFIX} No.001 腿受伤了，帮我看看并记录`, ip: '127.0.0.1' },
    {
      run: (async (req: { intent: string; context?: Record<string, unknown> }) => {
        if (req.intent === 'AGENT_PLAN') {
          return {
            ok: true,
            provider: 'test',
            data: {
              goal: '评估并记录',
              steps: [
                { tool: 'queryArchive', args: {}, why: '先看档案' },
                { tool: 'addObservation', args: {}, why: '写进档案' },
              ],
            },
          };
        }
        if (req.intent === 'AGENT_FINAL') {
          return {
            ok: true,
            provider: 'test',
            data: { answer: '已记录', usedTools: ['queryArchive'], needsHuman: false },
          };
        }
        decisionCtx.push(req.context ?? {});
        planRound += 1;
        return planRound === 1
          ? {
              ok: true,
              provider: 'test',
              data: { action: 'tool', tool: 'queryArchive', args: { keyword: 'No.001' } },
            }
          : { ok: true, provider: 'test', data: { action: 'finish', why: '信息够了' } };
      }) as never,
    },
  );

  const afterFirst = decisionCtx[1] ?? {};
  const progressText = String(afterFirst.progress ?? '');
  check(
    '成功后回灌的上下文带「已完成」进度',
    progressText.includes('已完成') && progressText.includes('queryArchive'),
    progressText.slice(0, 80),
  );
  check(
    'doneTools 里能查到刚跑过的工具',
    Array.isArray(afterFirst.doneTools) && (afterFirst.doneTools as string[]).includes('queryArchive'),
    JSON.stringify(afterFirst.doneTools),
  );
  check(
    'plan 里该步被标成 done（用 AI 自己的计划，不是另立规则）',
    Array.isArray(afterFirst.plan) &&
      (afterFirst.plan as Array<{ tool: string; done: boolean }>).some(
        (s) => s.tool === 'queryArchive' && s.done === true,
      ),
    JSON.stringify(afterFirst.plan),
  );
  const serialized = JSON.stringify(afterFirst);
  check(
    '进度字段落在截断安全区（3k 以内，工具清单之后才可能被截）',
    serialized.indexOf('"progress"') >= 0 && serialized.indexOf('"progress"') < 3000,
    `progress@${serialized.indexOf('"progress"')} / tools@${serialized.indexOf('"tools"')} / 总长 ${serialized.length}`,
  );
  check(
    '工具清单排在最后（截断时先牺牲它，不牺牲进度）',
    serialized.indexOf('"tools"') > serialized.indexOf('"progress"'),
    '',
  );

  console.log('\n[7c] 活星轨：每执行一步都推一个进度快照（2026-10-28）');
  // 断言的核心不是"有事件"，而是"事件就是真实执行"：快照里的 steps 必须与
  // trace 映射出来的 steps 完全同源，否则前端就是另一条假星轨。
  const snapshots: AgentProgress[] = [];
  const streamed = await runAgent(
    { message: `${PREFIX} No.002 这只狗受伤了，帮我评估一下并记录`, ip: '127.0.0.1' },
    { emit: (p) => snapshots.push(p) },
  );
  check('推了 ≥4 个快照', snapshots.length >= 4, String(snapshots.length));
  check('每条快照都带 runId 且与 trace 一致', snapshots.every((s) => s.runId === streamed.trace.id), '');
  check('首条快照已包含规划步', snapshots[0]?.steps.some((s) => s.tool === 'plan') === true, '');
  check(
    '出现过「正在执行某颗星」（running 不为空）',
    snapshots.some((s) => s.running !== null),
    snapshots.map((s) => s.running?.tool ?? '-').join(','),
  );
  check(
    '跑过的工具都先亮 running 再转终态',
    snapshots.some((s) => s.steps.some((x) => x.status === 'ok' && x.tool !== 'plan' && x.tool !== 'final')),
    snapshots.at(-1)?.steps.map((s) => `${s.tool}:${s.status}`).join(' → ') ?? '',
  );
  check('最后一条 phase=final', snapshots.at(-1)?.phase === 'final', snapshots.at(-1)?.phase ?? 'none');
  const liveSteps = snapshots.at(-1)?.steps ?? [];
  const finalSteps = traceToTrail(streamed.trace).steps;
  check(
    '快照步骤与最终 trail 完全一致（同源，不是两条路）',
    JSON.stringify(liveSteps) === JSON.stringify(finalSteps),
    `${liveSteps.length} vs ${finalSteps.length}`,
  );

  console.log('\n[7d] 人在回路：闸门开在执行前，用户能继续/跳过/接管');
  let gates = 0;
  const gateSnaps: AgentProgress[] = [];
  const confirmed = await runAgent(
    {
      message: `${PREFIX} No.001 这只猫腿上有伤口流血，帮我看看并记录一下`,
      confirmEach: true,
      ip: '127.0.0.1',
    },
    {
      emit: (p) => {
        if (p.gate) gateSnaps.push(p);
      },
      awaitGate: async () => {
        gates += 1;
        return 'approve';
      },
    },
  );
  const confirmedOk = traceToTrail(confirmed.trace).steps.filter(
    (s) => s.status === 'ok' && s.tool !== 'plan' && s.tool !== 'final',
  );
  check('逐步确认：每个工具执行前都开过闸门', gates === confirmedOk.length && gates >= 3, `闸门 ${gates} 次 / 工具 ${confirmedOk.length} 步`);
  check('全部批准 → 正常完成，不降级', confirmed.degraded === false && confirmed.paused !== true, '');
  check('闸门快照 phase=awaiting', gateSnaps[0]?.phase === 'awaiting', gateSnaps[0]?.phase ?? 'none');
  check(
    '闸门携带工具名 / 理由 / 入参预览（用户要知道它打算拿什么写库）',
    Boolean(gateSnaps[0]?.gate?.tool && gateSnaps[0]?.gate?.why && gateSnaps[0]?.gate?.preview),
    gateSnaps[0]?.gate?.preview ?? '',
  );

  const takeover = await runAgent(
    { message: `${PREFIX} No.001 这只猫受伤了，帮我看看并记录一下`, confirmEach: true, ip: '127.0.0.1' },
    { awaitGate: async () => 'abort' },
  );
  check('接管 → paused=true', takeover.paused === true, '');
  check('接管后工具一个都没执行（不写库、不发预警）', (await toolNames(takeover.trace)).length === 0, (await toolNames(takeover.trace)).join(','));
  check('接管不是降级（不走安全航线）', takeover.degraded === false && !takeover.answer.includes('安全航线'), takeover.answer.slice(0, 30));
  check('接管后仍给出可读的收尾话术', takeover.answer.length > 2, takeover.answer.slice(0, 40) + '…');

  let gateRound = 0;
  const skipped = await runAgent(
    { message: `${PREFIX} No.001 这只猫受伤了，帮我看看并记录一下`, confirmEach: true, ip: '127.0.0.1' },
    {
      awaitGate: async () => {
        gateRound += 1;
        return gateRound === 1 ? 'skip' : 'abort';
      },
    },
  );
  const skipTrail = traceToTrail(skipped.trace);
  check('跳过的那一步记为 fallback「跳过」', skipTrail.steps.some((s) => s.summary.includes('跳过')), '');
  check('跳过之后按用户要求停下（paused）', skipped.paused === true, '');

  console.log('\n[7e] 多模态：多图去重 + 上限 3 张，照片透传到工具上下文');
  const seenPhotoCounts: number[] = [];
  const multi = await runAgent(
    {
      message: `${PREFIX} No.001 看看它的档案`,
      photoUrl: '/uploads/multi-a.jpg',
      // 第 1 张与主图重复，第 5 张超上限 —— 期望最终是 3 张且不重复
      photoUrls: [
        '/uploads/multi-a.jpg',
        '/uploads/multi-b.jpg',
        '/uploads/multi-c.jpg',
        '/uploads/multi-d.jpg',
      ],
      ip: '127.0.0.1',
    },
    {
      getTool: (name: string) => {
        const tool = getTool(name);
        if (!tool) return undefined;
        return {
          ...tool,
          async run(input: unknown, ctx: Parameters<typeof tool.run>[1]) {
            seenPhotoCounts.push(ctx.photoUrls?.length ?? 0);
            return tool.run(input, ctx);
          },
        };
      },
    },
  );
  check('照片去重后封顶 3 张', multi.photos === 3, String(multi.photos));
  check('每次工具调用都拿到 3 张（主图 + 两个额外视角）', seenPhotoCounts.length > 0 && seenPhotoCounts.every((n) => n === 3), seenPhotoCounts.join(','));

  console.log('\n[8] 位置记录：写记录 + 挪星图点位（坐标只认白名单，不由模型给）');
  const track = CAMPUS_SPOTS.find((s) => s.key === 'track');
  const library = CAMPUS_SPOTS.find((s) => s.key === 'library');
  const orig = await prisma.animal.findUnique({
    where: { code: 'No.001' },
    select: { mapLat: true, mapLng: true },
  });
  if (orig) ORIGINAL_COORDS.set('No.001', orig);
  /*
   * 先把点位摆到**别处**再测。
   * 库里 No.001 本来就是田径运动场，直接测「挪到操场」会得到 moved=false ——
   * 断言「有审计」就会假失败，而那是测试前置条件的问题，不是功能坏了。
   */
  await prisma.animal.update({
    where: { code: 'No.001' },
    data: { mapLat: library?.lat, mapLng: library?.lng },
  });

  const located = await runAgent({
    message: `${PREFIX} No.001 这会儿在操场边上，帮我记一下位置`,
    ip: '127.0.0.1',
  });
  const locatedTools = await toolNames(located.trace);
  check('recordLocation 在链路里', locatedTools.includes('recordLocation'), locatedTools.join(' → '));
  // recordLocation 已经写过一条观察，addObservation 不该再把同一句话写一遍
  check(
    'recordLocation 之后不再重复写观察（同一条内容只落一次）',
    !locatedTools.includes('addObservation'),
    locatedTools.join(' → '),
  );

  const movedAnimal = await prisma.animal.findUnique({
    where: { code: 'No.001' },
    select: { mapLat: true, mapLng: true },
  });
  check(
    '档案点位已挪到田径运动场（「操场」是它的别名）',
    movedAnimal?.mapLat === track?.lat && movedAnimal?.mapLng === track?.lng,
    JSON.stringify(movedAnimal),
  );

  const movedObs = await prisma.observation.findFirst({
    where: {
      content: { startsWith: PREFIX },
      animal: { code: 'No.001' },
      mapLat: track?.lat,
    },
    orderBy: { createdAt: 'desc' },
    select: { mapLat: true, mapLng: true, content: true },
  });
  check(
    '观察记录带上了同一坐标（历史留痕，不只挪点）',
    movedObs?.mapLat === track?.lat && movedObs?.mapLng === track?.lng,
    JSON.stringify(movedObs),
  );

  const locAudit = await prisma.auditLog.findFirst({
    where: { action: 'ANIMAL_LOCATION', createdAt: { gte: RUN_STARTED_AT } },
    orderBy: { createdAt: 'desc' },
  });
  check(
    '留下 ANIMAL_LOCATION 审计（匿名挪点唯一追责依据）',
    Boolean(locAudit) && JSON.stringify(locAudit?.payload ?? {}).includes('track'),
    JSON.stringify(locAudit?.payload ?? null).slice(0, 100),
  );

  // 白名单外：必须拒绝、且一个字节都不许动（护栏失灵最危险的地方是"悄悄退化成最近的点"）
  const locTool = getTool('recordLocation');
  let refusedMessage = '';
  try {
    await locTool!.run({ animalId: 'No.001', place: '南门小吃街' }, {});
  } catch (err) {
    refusedMessage = err instanceof Error ? err.message : '';
  }
  check(
    '白名单外地点被拒绝，并列出可用地点',
    refusedMessage.includes('只认得这些校园角落'),
    refusedMessage.slice(0, 60) || '没有报错（危险）',
  );
  const afterRefuse = await prisma.animal.findUnique({
    where: { code: 'No.001' },
    select: { mapLat: true, mapLng: true },
  });
  check(
    '被拒绝时点位保持不变',
    afterRefuse?.mapLat === track?.lat && afterRefuse?.mapLng === track?.lng,
    JSON.stringify(afterRefuse),
  );

  // 别名/兜底解析：模型说「公寓楼下」「图书馆后门台阶」都得认得出
  check('「公寓楼下」能解析到学生公寓', resolveCampusSpot('公寓楼下')?.key === 'dorm', '');
  check('「图书馆后门台阶」能解析到图书馆', resolveCampusSpot('图书馆后门台阶')?.key === 'library', '');
  check('「武汉大学」这类校外地名不会被误认', resolveCampusSpot('武汉大学') === null, '');

  /* ── [9] 设备定位（2026-10-29）────────────────────────────
     和 [8] 是两条互补的路径：那边靠「说角落名 → 服务端查表」，
     这边靠「用户点授权 → 手机给坐标」。共同点是**模型始终不持有坐标**，
     它只有一个 useCurrentPosition 开关。 */
  console.log('\n[9] 设备定位：坐标由前端授权给出，模型只负责表达意图');
  if (library) {
    // 先把点位摆到图书馆，让「挪了没挪」有明确的前后差
    await prisma.animal.update({
      where: { code: 'No.001' },
      data: { mapLat: library.lat, mapLng: library.lng },
    });
  }
  // 图书馆东北约 25 米，精度 12 米 —— 现实里站在楼门口的样子
  const GPS_FIX = { lat: 30.47062, lng: 114.40495, accuracyM: 12 };

  const gpsRun = await runAgent({
    message: `${PREFIX} No.001 我就在它旁边，帮我记一下位置`,
    ip: '127.0.0.1',
    userLocation: GPS_FIX,
  });
  const gpsTools = await toolNames(gpsRun.trace);
  check('带定位时仍走 recordLocation', gpsTools.includes('recordLocation'), gpsTools.join(' → '));

  const afterGps = await prisma.animal.findUnique({
    where: { code: 'No.001' },
    select: { mapLat: true, mapLng: true },
  });
  // 关键断言：落的是**设备实测点**，不是最近角落的固定坐标
  check(
    '点位落在设备实测坐标（未被吸附到角落坐标）',
    afterGps?.mapLat === GPS_FIX.lat && afterGps?.mapLng === GPS_FIX.lng,
    JSON.stringify(afterGps),
  );

  const gpsAudit = await prisma.auditLog.findFirst({
    where: { action: 'ANIMAL_LOCATION', createdAt: { gte: RUN_STARTED_AT } },
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
  });
  const gpsPayload = JSON.stringify(gpsAudit?.payload ?? {});
  check(
    '审计记下来源与精度（能分清「人说的角落」与「手机测的点」）',
    gpsPayload.includes('"source":"gps"') && gpsPayload.includes('"accuracyM":12'),
    gpsPayload.slice(0, 120),
  );

  const locToolForGps = getTool('recordLocation');
  // 没授权却要用当前位置：必须明确报错并给出退路，不能悄悄拿角落坐标顶上
  let noFixMessage = '';
  try {
    await locToolForGps!.run({ animalId: 'No.001', useCurrentPosition: true }, {});
  } catch (err) {
    noFixMessage = err instanceof Error ? err.message : '';
  }
  check(
    '没拿到定位时明确报错并给退路',
    noFixMessage.includes('没有拿到你的定位') && noFixMessage.includes('图书馆'),
    noFixMessage.slice(0, 70) || '没有报错（危险）',
  );

  // 二选一的契约：两个都不给 / 两个都给，都必须在入参校验这一步被拒
  check(
    'place 与 useCurrentPosition 都不给时入参被拒',
    !locToolForGps!.input.safeParse({ animalId: 'No.001' }).success,
    '',
  );
  check(
    'place 与 useCurrentPosition 同时给时入参被拒',
    !locToolForGps!.input.safeParse({ animalId: 'No.001', place: '图书馆', useCurrentPosition: true })
      .success,
    '',
  );

  await cleanup();

  if (process.argv.includes('--http')) await httpMode();

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

async function httpMode() {
  console.log('\n[8] HTTP 链路（multipart + 幂等 + 契约出口校验）');
  // 3312/3314/3316/3318 已被其它 HTTP 自检占用，这里错开
  const port = 3319;
  const proc = await startDev(port);
  const base = `http://127.0.0.1:${port}`;

  try {
    await waitFor(`${base}/`, 90_000);

    const post = (body: FormData, clientId?: string) => {
      if (clientId) body.set('clientId', clientId);
      return fetch(`${base}/api/agent`, { method: 'POST', body });
    };

    const first = new FormData();
    first.set('message', `${PREFIX} No.001 这只猫腿上有伤口流血，帮我看看并记录一下`);
    const res1 = await post(first, 'agent-selftest-1');
    const body1 = await res1.json();
    check('POST /api/agent → 200', res1.status === 200, String(res1.status));
    check('响应通过 AgentDataSchema（服务端出口校验）', body1?.ok === true && typeof body1?.data?.answer === 'string', '');
    check('trail.steps 非空且首步 plan', body1?.data?.trail?.steps?.[0]?.tool === 'plan', String(body1?.data?.trail?.steps?.length));
    check(
      'notice 一路带回 HTTP',
      body1?.data?.notice === ALERT_NOTICE || body1?.data?.notice === MANUAL_SEVERE_NOTICE,
      body1?.data?.notice ?? 'null',
    );
    check('未降级', body1?.data?.degraded === false, '');

    const again = new FormData();
    again.set('message', `${PREFIX} No.001 这只猫腿上有伤口流血，帮我看看并记录一下`);
    const res2 = await post(again, 'agent-selftest-1');
    const body2 = await res2.json();
    check('同 clientId 30s 内复用结果（幂等）', body2?.data?.trail?.runId === body1?.data?.trail?.runId, String(body2?.data?.trail?.runId ?? 'null'));

    const bad = new FormData();
    bad.set('message', '好');
    const res3 = await post(bad);
    const body3 = await res3.json();
    check('消息太短 → 400 且可读', res3.status === 400, `${res3.status} ${body3?.error?.message ?? ''}`);

    const empty = new FormData();
    const res4 = await post(empty);
    check('缺 message → 400', res4.status === 400, String(res4.status));

    /* ── [9] SSE：逐帧进度 + 闸门 + 控制通道 ─────────────────────
       这是"演示型 AI"与"真执行"的分界线：如果流里没有 running → ok 的逐帧变化，
       前端的星轨就只能靠动画假装。所以这里真的读流、真的在下闸门时发控制指令。 */
    console.log('\n[9] SSE 流式入口：progress 逐帧 + 闸门 + POST /api/agent/control');

    const streamForm = new FormData();
    streamForm.set('message', `${PREFIX} No.001 这只猫腿上有伤口流血，帮我看看并记录一下`);
    streamForm.set('confirmEach', '1');
    const streamRes = await fetch(`${base}/api/agent/stream`, {
      method: 'POST',
      body: streamForm,
      headers: { Accept: 'text/event-stream' },
    });
    check(
      'POST /api/agent/stream → text/event-stream',
      streamRes.ok && (streamRes.headers.get('content-type') ?? '').includes('text/event-stream'),
      `${streamRes.status} ${streamRes.headers.get('content-type') ?? ''}`,
    );

    const frames = await readSse(streamRes, async (event, payload) => {
      // 每到闸门就点一次「继续执行」，验证控制通道能把挂起的运行唤醒
      if (event === 'progress' && (payload as AgentProgress)?.gate) {
        const gateProgress = payload as AgentProgress;
        const controlled = await fetch(`${base}/api/agent/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: gateProgress.runId, action: 'resume' }),
        });
        const ctl = await controlled.json();
        check(`闸门可被「继续」放行（${gateProgress.gate?.tool ?? '?'}）`, controlled.status === 200 && ctl?.ok === true, JSON.stringify(ctl?.data ?? ctl?.error));
      }
    });

    const progressFrames = frames.filter((f) => f.event === 'progress');
    const finalFrame = frames.find((f) => f.event === 'final');
    check('流里有 hello 事件（前端从此拿到 runId）', frames.some((f) => f.event === 'hello'), '');
    check('流里有多个 progress 帧', progressFrames.length >= 3, String(progressFrames.length));
    check(
      'progress 帧覆盖 running → ok 的过渡',
      progressFrames.some((f) => (f.payload as AgentProgress)?.running) &&
        progressFrames.some((f) =>
          (f.payload as AgentProgress)?.steps.some((s) => s.status === 'ok' && s.tool !== 'plan'),
        ),
      '',
    );
    check('流末尾有 final 且通过 AgentDataSchema', Boolean(finalFrame), finalFrame ? '' : 'missing');
    check('流以 end 事件收尾', frames.some((f) => f.event === 'end'), '');

    // 已完成（或不存在）的 runId 控制应得 404，而不是 500 或静默成功
    const stale = await fetch(`${base}/api/agent/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: '00000000-0000-4000-8000-000000000000', action: 'pause' }),
    });
    check('控制已结束的任务 → 404', stale.status === 404, String(stale.status));
  } finally {
    await stopDev(proc);
  }

  await cleanup();
}

/**
 * 读一条 SSE 响应，按帧回调。
 * 故意不用 EventSource：它只能 GET，而 /api/agent/stream 是 multipart POST。
 * 这里做的事与前端 useAgentRun 完全一致（同一套帧解析），所以自测跑通了，
 * 前端那条路至少不会栽在协议上。
 */
async function readSse(
  res: Response,
  onFrame?: (event: string, payload: unknown) => Promise<void> | void,
): Promise<Array<{ event: string; payload: unknown }>> {
  const out: Array<{ event: string; payload: unknown }> = [];
  if (!res.body) return out;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flush = async (frame: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue; // 心跳注释
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    let payload: unknown = null;
    try {
      payload = JSON.parse(dataLines.join('\n'));
    } catch {
      return;
    }
    out.push({ event, payload });
    if (onFrame) await onFrame(event, payload);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf('\n\n');
    while (cut >= 0) {
      await flush(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) await flush(buffer);
  return out;
}

main()
  .catch((err) => {
    console.error('自检意外中断：', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
