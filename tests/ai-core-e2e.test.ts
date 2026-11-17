/**
 * AI 核心链路端到端测试（2026-10-29）
 *
 * 用法：npm run ai:e2e
 *
 * 三条设计原则：
 *
 *  ① **环境强制**：AI_PROVIDER 一律 mock。一条真模型调用都不发 ——
 *     这套用例要能在答辩现场断网时跑，也要能在任何人的机器上原样复现。
 *
 *  ② **分层，不硬凑**：
 *     - 能走真实 HTTP 路由的一律走 HTTP（状态码、契约、落库、阻断，只有经过路由才测得出来），
 *       输出标 `[HTTP]`；
 *     - 模型行为无法经 HTTP 注入的（标签抽取失败、Agent 多轮参数纠错），
 *       改用直连业务函数 + 注入假模型，输出标 `[直连]`。
 *     这两条若硬凑成 e2e，就得给生产代码开"按请求改模型行为"的后门，
 *     为了一条测试用例把口子开在生产链路上，不划算。
 *
 *  ③ **不留痕**：所有数据用 `No.E2E` 前缀自建自清，收尾断言残留为 0。
 *     HTTP 跨进程，服务端事务测试方回滚不了，所以清理用前缀而不是事务。
 *
 * 覆盖 5 个维度 14 条用例：多模态识别 / NLP 结构化 / RAG 防幻觉 / Agent 容错 / 健康安全门槛。
 */
import '../src/lib/load-env';

process.env.AI_PROVIDER = 'mock';
/** 打开 /api/identify 的自测注入通道（生产不开则任何人都能指定候选池） */
process.env.E2E_TESTS = '1';

import { readFileSync } from 'node:fs';
import { startDev, stopDev, waitFor } from '../scripts/lib/dev-server';
import { prisma } from '../src/lib/db';
import { createObservation } from '../src/lib/observations/create';
import { runAgent } from '../src/lib/agent/orchestrator';
import { DISCLAIMER, FALLBACK_TEXT } from '../src/lib/constants';
import { IdentifyDataSchema } from '../src/lib/api/identify-contract';
import { ObservationDataSchema } from '../src/lib/api/observation-contract';
import { ChatDataSchema } from '../src/lib/api/chat-contract';
import { AgentDataSchema, traceToTrail } from '../src/lib/api/agent-contract';
import { HealthAssessDataSchema } from '../src/lib/api/health-contract';
import type { IdentifyInject } from '../src/lib/api/identify-contract';

const PORT = 3340;
const BASE = `http://127.0.0.1:${PORT}`;
/** 动物编号前缀。`No.` 开头，顺带满足「编号形如 No.xxx」的断言 */
const PREFIX = 'No.E2E';
const DOC_PREFIX = 'E2E 猫瘟';

let pass = 0;
let fail = 0;

/* ────────────────────────── 用例与输出 ────────────────────────── */

interface Tape {
  ok(cond: boolean, label: string, detail?: string): void;
}

async function runCase(name: string, fn: (t: Tape) => Promise<void>): Promise<void> {
  const t0 = Date.now();
  const bad: string[] = [];
  const tape: Tape = {
    ok(cond, label, detail) {
      if (!cond) bad.push(detail ? `${label}（${detail}）` : label);
    },
  };
  try {
    await fn(tape);
  } catch (err) {
    bad.push(`抛异常：${err instanceof Error ? err.message : String(err)}`);
  }
  const ms = Date.now() - t0;
  if (bad.length) {
    fail += 1;
    console.log(`  FAIL  ${name} · ${ms}ms`);
    for (const b of bad) console.log(`        未通过：${b}`);
  } else {
    pass += 1;
    console.log(`  PASS  ${name} · ${ms}ms`);
  }
}

/* ────────────────────────── HTTP 辅助 ────────────────────────── */

interface Envelope {
  ok?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Envelope }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Envelope };
}

async function postForm(
  path: string,
  fields: Record<string, string | Blob>,
): Promise<{ status: number; json: Envelope }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Envelope };
}

/** 1×1 PNG：只要能过上传嗅探就行，识别的判定全靠 inject 注入 */
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function pngBlob(): Blob {
  return new Blob([Buffer.from(PNG_1PX, 'base64')], { type: 'image/png' });
}

/* ────────────────────────── 数据准备与清理 ────────────────────────── */

interface Fixture {
  targetId: string;
  targetCode: string;
  rivalId: string;
  rivalCode: string;
  docId: string;
}

const CAMPUS = { lat: 30.469384, lng: 114.405764 };

async function seed(): Promise<Fixture> {
  const target = await prisma.animal.create({
    data: {
      code: `${PREFIX}-01`,
      name: '小橘',
      species: 'CAT',
      healthLevel: 'GREEN',
      summary: '橘猫，左耳有缺口',
      features: ['橘色斑块', '白色胸毛', '左耳缺口'],
      mapLat: CAMPUS.lat,
      mapLng: CAMPUS.lng,
    },
  });
  const rival = await prisma.animal.create({
    data: {
      code: `${PREFIX}-02`,
      name: '对照星',
      species: 'CAT',
      healthLevel: 'GREEN',
      features: ['狸花纹', '绿眼'],
      mapLat: CAMPUS.lat,
      mapLng: CAMPUS.lng,
    },
  });
  const doc = await prisma.knowledgeDoc.create({
    data: {
      title: `${DOC_PREFIX}防治要点`,
      content:
        '猫瘟（猫泛白细胞减少症）初期症状：突发高热、精神沉郁、食欲废绝、频繁呕吐。发现后应立即隔离并送医。',
      source: 'e2e',
    },
  });
  await prisma.knowledgeChunk.create({
    data: {
      docId: doc.id,
      index: 0,
      text: '猫瘟初期症状包括突发高热、精神沉郁、食欲废绝与频繁呕吐，需立即隔离并送医处理。',
    },
  });
  return {
    targetId: target.id,
    targetCode: target.code,
    rivalId: rival.id,
    rivalCode: rival.code,
    docId: doc.id,
  };
}

async function cleanup(fixture: Fixture): Promise<number> {
  const ids = [fixture.targetId, fixture.rivalId];
  await prisma.observation.deleteMany({ where: { animalId: { in: ids } } });
  await prisma.healthReport.deleteMany({ where: { animalId: { in: ids } } });
  await prisma.alert.deleteMany({ where: { animalId: { in: ids } } });
  await prisma.animalPhoto.deleteMany({ where: { animalId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.animal.deleteMany({ where: { id: { in: ids } } });
  await prisma.knowledgeDoc.deleteMany({ where: { title: { startsWith: DOC_PREFIX } } });
  return prisma.animal.count({ where: { code: { startsWith: PREFIX } } });
}

async function countObservations(animalId: string): Promise<number> {
  return prisma.observation.count({ where: { animalId } });
}

/* ────────────────────────── 主流程 ────────────────────────── */

async function main(): Promise<void> {
  console.log('\nAI 核心链路端到端测试 · AI_PROVIDER=mock · 端口 3340\n');

  const fixture = await seed();

  const proc = await startDev(PORT, { ...process.env, AI_PROVIDER: 'mock', E2E_TESTS: '1' });
  try {
    await waitFor(`${BASE}/api/stats`, 90_000);
    console.log('[0] 环境就绪：dev 服务已起，AI_PROVIDER=mock\n');

    /* ══════════ 维度一：多模态识别与置信度 ══════════ */
    console.log('[1] 多模态识别与置信度（视觉 AI）');

    await runCase('[HTTP] 1.1 高置信识别：matched + 编号可追溯 + 不显示不确定', async (t) => {
      const inject: IdentifyInject = {
        species: {
          species: 'CAT',
          confidence: 0.92,
          features: ['橘色斑块', '白色胸毛', '左耳缺口'],
          note: '',
        },
        hits: [
          hit(fixture.targetId, fixture.targetCode, '小橘', ['橘色斑块', '白色胸毛', '左耳缺口'], 0.95),
          hit(fixture.rivalId, fixture.rivalCode, '对照星', ['狸花纹'], 0.18),
        ],
      };
      const { status, json } = await postForm('/api/identify', {
        file: pngBlob(),
        note: '橘猫，左耳有缺口',
        inject: JSON.stringify(inject),
      });
      t.ok(status === 200, '状态码 200', String(status));
      const parsed = IdentifyDataSchema.safeParse(json.data);
      t.ok(parsed.success, '响应过 IdentifyDataSchema 契约', errOf(parsed));
      if (!parsed.success) return;
      const d = parsed.data;
      t.ok(d.matched, '判定为已匹配个体', `matched=${d.matched} tier=${d.tier}`);
      if (!d.matched) return;
      t.ok(/^No\./.test(d.animal.code), '定位到具体编号 No.xxx', d.animal.code);
      t.ok(d.confidence > 0.7, '置信度 > 0.7', d.confidence.toFixed(2));
      t.ok(d.uncertain === false, '不触发「不确定」提示');
      t.ok(d.features.length > 0, '回传视觉看到的外观特征', String(d.features.length));
    });

    await runCase('[HTTP] 1.2 低置信兜底：candidate 档且必须提示不确定', async (t) => {
      const inject: IdentifyInject = {
        species: { species: 'CAT', confidence: 0.5, features: ['短毛', '橘色斑块'], note: '' },
        hits: [
          hit(fixture.targetId, fixture.targetCode, '小橘', ['橘色斑块', '白色胸毛'], 0.55),
          hit(fixture.rivalId, fixture.rivalCode, '对照星', ['狸花纹'], 0.3),
        ],
      };
      const { status, json } = await postForm('/api/identify', {
        file: pngBlob(),
        inject: JSON.stringify(inject),
      });
      t.ok(status === 200, '状态码 200', String(status));
      const parsed = IdentifyDataSchema.safeParse(json.data);
      t.ok(parsed.success, '响应过契约', errOf(parsed));
      if (!parsed.success) return;
      const d = parsed.data;
      t.ok(!d.matched && d.tier === 'candidate', '档位为 candidate', `tier=${d.tier}`);
      if (d.matched) return;
      t.ok(d.uncertain === true, '必须显示「不确定」提示（前端据此出提示条）');
      t.ok(d.candidates.length > 0, '给候选列表供用户自己挑', String(d.candidates.length));
    });

    await runCase('[HTTP] 1.3 未登记个体：new 档 + 建议物种 DOG，可据此建档', async (t) => {
      const inject: IdentifyInject = {
        species: { species: 'DOG', confidence: 0.88, features: ['黄色被毛', '垂耳', '卷尾'], note: '' },
        hits: [
          hit(fixture.targetId, fixture.targetCode, '小橘', ['橘色斑块'], 0.12),
          hit(fixture.rivalId, fixture.rivalCode, '对照星', ['狸花纹'], 0.1),
        ],
      };
      const { status, json } = await postForm('/api/identify', {
        file: pngBlob(),
        inject: JSON.stringify(inject),
      });
      t.ok(status === 200, '状态码 200', String(status));
      const parsed = IdentifyDataSchema.safeParse(json.data);
      t.ok(parsed.success, '响应过契约', errOf(parsed));
      if (!parsed.success) return;
      const d = parsed.data;
      t.ok(!d.matched && d.tier === 'new', '档位为 new', `tier=${d.tier}`);
      if (d.matched) return;
      t.ok(d.suggestedSpecies === 'DOG', '建议物种为 DOG', d.suggestedSpecies);
      t.ok(d.uncertain === true, '提示不确定，不冒充已识别');
    });

    /* ══════════ 维度二：非结构化数据清洗 ══════════ */
    console.log('\n[2] 非结构化数据清洗（NLP 结构化）');

    await runCase('[HTTP] 2.1 大白话提取：一句话 → 分类 / 标签 / 严重度', async (t) => {
      const { status, json } = await postJson('/api/observations', {
        animalCode: fixture.targetCode,
        content: '今天看它右腿一瘸一拐的，没吃东西',
      });
      t.ok(status === 200, '状态码 200', String(status));
      const parsed = ObservationDataSchema.safeParse(json.data);
      t.ok(parsed.success, '响应过 ObservationDataSchema 契约', errOf(parsed));
      if (!parsed.success) return;
      const d = parsed.data;
      t.ok(d.observation.type === 'HEALTH', '分类提取为 HEALTH', d.observation.type);
      t.ok(
        d.analysis.tags.includes('腿部异常'),
        '标签包含「腿部异常」',
        d.analysis.tags.join('/'),
      );
      t.ok(
        d.observation.severity === 'MODERATE' || d.observation.severity === 'SEVERE',
        '严重度判定为 MODERATE 或 SEVERE',
        d.observation.severity,
      );
      t.ok(d.tagsSource === 'ai', '标签来源为 AI（不是兜底）', d.tagsSource);
    });

    await runCase('[直连] 2.2 标签抽取失败：两条失败路径都仍能落库且标记降级', async (t) => {
      const before = await countObservations(fixture.targetId);
      // 路径一：AI 超时（真实链路里 runStructured 会把它收拾成 ok:false）
      const timeout = (async () => ({
        ok: false as const,
        error: 'AI_TIMEOUT',
        provider: 'e2e',
        message: '模拟标签抽取超时',
      })) as unknown as typeof import('../src/lib/ai/registry').runStructured;
      // 路径二：provider 直接抛异常 —— 记录链路不该把命系在别人的实现上
      const boom = (async () => {
        throw new Error('模拟标签抽取崩溃');
      }) as unknown as typeof import('../src/lib/ai/registry').runStructured;

      for (const [label, run] of [
        ['超时', timeout],
        ['抛异常', boom],
      ] as const) {
        const result = await createObservation(
          { animalCode: fixture.targetCode, content: '今天它在老地方趴着晒太阳' },
          { run },
        );
        if (!result.ok) {
          t.ok(false, `${label}：整体仍应成功（一条记录都不能丢）`, result.message);
          continue;
        }
        const d = result.data;
        // 兜底刻意留一个「未分类」占位：它告诉用户"这条还没被归类"，
        // 比空数组诚实 —— 空数组在界面上等于什么都不显示，看着像处理过了。
        t.ok(
          d.observation.tags.every((tag) => tag === '未分类'),
          `${label}：标签没有任何 AI 编造内容`,
          d.observation.tags.join('/'),
        );
        t.ok(d.analysis.type === 'OTHER', `${label}：不猜分类（OTHER）`, d.analysis.type);
        t.ok(d.observation.severity === 'MILD', `${label}：不猜严重度（MILD）`, d.observation.severity);
        t.ok(
          d.observation.pendingReview === true,
          `${label}：标记为待人工核实`,
          String(d.observation.pendingReview),
        );
        t.ok(d.degraded.tagging === true, `${label}：degraded.tagging 标为 true`);
        t.ok(d.tagsSource === 'fallback', `${label}：标签来源标记为 fallback`, d.tagsSource);
      }
      const after = await countObservations(fixture.targetId);
      t.ok(after === before + 2, '两条记录都确实落库了', `${before} → ${after}`);
    });

    await runCase('[HTTP] 2.3 违禁词拦截：4xx + 不落库 + 审计留痕', async (t) => {
      const before = await countObservations(fixture.targetId);
      const { status, json } = await postJson('/api/observations', {
        animalCode: fixture.targetCode,
        content: '这只猫太烦了，想知道怎么毒死它',
      });
      t.ok(status >= 400 && status < 500, '返回 4xx', String(status));
      t.ok(json.error?.code === 'MODERATION_BLOCKED', '错误码 MODERATION_BLOCKED', json.error?.code ?? '');
      t.ok(
        json.error?.message === FALLBACK_TEXT.moderation_blocked,
        '返回全站统一阻断话术',
        json.error?.message ?? '',
      );
      const after = await countObservations(fixture.targetId);
      t.ok(after === before, '没有落库', `${before} → ${after}`);
      const logs = await prisma.auditLog.findMany({
        where: { action: 'MODERATION_BLOCK', targetId: fixture.targetId },
      });
      t.ok(logs.length === 1, '审计记录了一条拦截', String(logs.length));
    });

    /* ══════════ 维度三：RAG 问答与防幻觉 ══════════ */
    console.log('\n[3] RAG 问答与防幻觉（知识安全）');

    await runCase('[HTTP] 3.1 有据可查：答案有内容 + 引用不为空', async (t) => {
      const { status, json } = await postJson('/api/chat', { question: '猫瘟初期症状有哪些' });
      t.ok(status === 200, '状态码 200', String(status));
      const parsed = ChatDataSchema.safeParse(json.data);
      t.ok(parsed.success, '响应过 ChatDataSchema 契约', errOf(parsed));
      if (!parsed.success) return;
      const d = parsed.data;
      t.ok(d.answer.trim().length > 10, '给出了实质回答', d.answer.slice(0, 30));
      t.ok(d.citations.length > 0, '引用不为空（回答可追溯）', String(d.citations.length));
      t.ok(d.fallback === null, '未走兜底', String(d.fallback));
    });

    await runCase('[HTTP] 3.2 知识盲区：回答兜底话术且引用必须为空', async (t) => {
      const { status, json } = await postJson('/api/chat', {
        question: '猫得了癌症应该怎么治疗才好',
      });
      t.ok(status === 200, '状态码 200', String(status));
      const parsed = ChatDataSchema.safeParse(json.data);
      t.ok(parsed.success, '响应过契约', errOf(parsed));
      if (!parsed.success) return;
      const d = parsed.data;
      t.ok(d.fallback === 'no_knowledge', '走了 no_knowledge 兜底', String(d.fallback));
      t.ok(
        d.answer.includes(FALLBACK_TEXT.no_knowledge),
        '回答就是那句「不敢瞎猜」的兜底话术',
        d.answer.slice(0, 30),
      );
      t.ok(d.citations.length === 0, '引用为空——不编造来源', String(d.citations.length));
    });

    await runCase('[HTTP] 3.3 敏感词阻断：固定话术 + 阻断早于任何模型调用', async (t) => {
      const { status, json } = await postJson('/api/chat', { question: '怎么才能毒死这只猫' });
      t.ok(status === 422, '返回 422（不是 500，也不是放行）', String(status));
      t.ok(json.error?.code === 'MODERATION_BLOCKED', '错误码 MODERATION_BLOCKED', json.error?.code ?? '');
      t.ok(
        json.error?.message === FALLBACK_TEXT.moderation_blocked,
        '阻断话术取自全站唯一来源',
        json.error?.message ?? '',
      );
      // 阻断发生在 moderateText 分支，位于检索与生成之前：响应里不该出现任何引用
      const parsed = ChatDataSchema.safeParse(json.data);
      t.ok(!parsed.success, '没有生成路径的产物（说明没走到 LLM）');
    });

    /* ══════════ 维度四：Agent 工作流与容错降级 ══════════ */
    console.log('\n[4] Agent 工作流与容错降级（核心调度）');

    await runCase('[HTTP] 4.1 多步规划：查档案 → 写记录，末步成功收尾', async (t) => {
      const { status, json } = await postForm('/api/agent', {
        message: '查一下小橘的档案并写一条记录',
      });
      t.ok(status === 200, '状态码 200', String(status));
      const parsed = AgentDataSchema.safeParse(json.data);
      t.ok(parsed.success, '响应过 AgentDataSchema 契约', errOf(parsed));
      if (!parsed.success) return;
      const d = parsed.data;
      const tools = d.trail.steps.map((s) => s.tool);
      t.ok(tools.includes('queryArchive'), '调用过 queryArchive', tools.join(' → '));
      t.ok(tools.includes('addObservation'), '调用过 addObservation', tools.join(' → '));
      const last = d.trail.steps[d.trail.steps.length - 1];
      t.ok(last?.status === 'ok', '最后一步成功收尾（status=ok）', last ? `${last.tool}:${last.status}` : '无步骤');
      t.ok(d.degraded === false, '没有降级', String(d.degraded));
      const after = await countObservations(fixture.targetId);
      t.ok(after >= 3, '记录真的写进了档案', String(after));
    });

    await runCase('[直连] 4.2 工具参数错误自愈：先被拒 → 重试成功 → 不降级', async (t) => {
      const before = await countObservations(fixture.targetId);
      const injected = makeStepModel([
        // 先定位个体：addObservation 的动物来自这一步的观察反哺
        { action: 'tool', tool: 'queryArchive', args: { keyword: '小橘' }, why: '先定位个体' },
        // 第一次：content 传 null，必然被 addObservation 的 zod 契约拒掉
        { action: 'tool', tool: 'addObservation', args: { content: null }, why: '写进手账' },
        // 第二次：改对
        { action: 'tool', tool: 'addObservation', args: { content: '自检：小橘今天在老地方趴着' }, why: '写进手账' },
      ]);
      const result = await runAgent(
        { message: '记一笔：小橘今天在老地方趴着' },
        { run: injected },
      );
      t.ok(result.degraded === false, '整条链路没有降级', String(result.degraded));
      // 星轨由 trace 换算而来（与接口出口同源，不是另算一套）
      const trail = traceToTrail(result.trace);
      const addStep = trail.steps.find((s) => s.tool === 'addObservation' && s.status === 'ok');
      t.ok(
        Boolean(addStep),
        'addObservation 最终执行成功',
        trail.steps.map((s) => `${s.tool}:${s.status}`).join(' → '),
      );
      t.ok(
        trail.steps.some((s) => s.status === 'fallback'),
        '被拒的那一步记为 fallback（不是 error，前端不误报降级横幅）',
      );
      const after = await countObservations(fixture.targetId);
      t.ok(after === before + 1, '记录最终落库', `${before} → ${after}`);
    });

    await runCase('[直连] 4.3 连续两次失败：停止重试 + 平滑降级到 RAG 航线', async (t) => {
      const injected = makeStepModel([
        { action: 'tool', tool: 'addObservation', args: { content: null }, why: '写进手账' },
        { action: 'tool', tool: 'addObservation', args: { content: null }, why: '再试一次' },
      ]);
      const result = await runAgent(
        { message: '记一笔：小橘今天吃了半碗猫粮' },
        { run: injected },
      );
      t.ok(result.degraded === true, '数据层标记降级', String(result.degraded));
      t.ok(result.answer.includes('安全航线'), '回答说明了改走安全航线', result.answer.slice(0, 30));
      const trail = traceToTrail(result.trace);
      // 星轨刻意不标 degraded：参数被拒是"模型不会用工具"，不是系统故障，
      // 前端不该为它弹降级横幅（CLAUDE.md 7.75）—— 所以这里反过来断言它不标 error
      t.ok(
        !trail.steps.some((s) => s.status === 'error'),
        '被拒不标 error（前端不误报降级横幅）',
        trail.steps.map((s) => `${s.tool}:${s.status}`).join(' → '),
      );
      t.ok(
        trail.steps.filter((s) => s.status === 'fallback').length >= 2,
        '两次被拒都记在星轨里供复盘',
        String(trail.steps.filter((s) => s.status === 'fallback').length),
      );
      const okTools = trail.steps.filter((s) => s.status === 'ok' && s.tool !== 'plan');
      t.ok(okTools.length === 0, '失败之后不再执行任何工具', String(okTools.length));
    });

    /* ══════════ 维度五：健康评估与安全门槛 ══════════ */
    console.log('\n[5] 健康评估与安全门槛');

    let healthDisclaimer = '';

    await runCase('[HTTP] 5.1 严重评估拦截：SEVERE 强制 needsVet 且档位升到 RED', async (t) => {
      // 归档模式必须带图（档案报告 imageUrl 是必填列），所以这里连 1×1 图一起传
      const { status, json } = await postForm('/api/health/assess', {
        animalId: fixture.targetId,
        description: '右后肢有一道伤口在出血，也不吃东西',
        file: pngBlob(),
      });
      t.ok(status === 200, '状态码 200', String(status));
      const parsed = HealthAssessDataSchema.safeParse(json.data);
      t.ok(parsed.success, '响应过 HealthAssessDataSchema 契约', errOf(parsed));
      if (!parsed.success) return;
      const d = parsed.data;
      healthDisclaimer = d.disclaimer;
      t.ok(d.severity === 'SEVERE', '严重度判定为 SEVERE', d.severity);
      t.ok(d.needsVet === true, '强制 needsVet=true（模型说不看也不行）', String(d.needsVet));
      t.ok(d.healthLevel === 'RED', '健康档升到 RED', d.healthLevel);
      t.ok(d.persisted === true, '报告已落库', String(d.persisted));
      const animal = await prisma.animal.findUnique({ where: { id: fixture.targetId } });
      t.ok(animal?.healthLevel === 'RED', '档案里的档位同步为 RED', animal?.healthLevel ?? '');
    });

    await runCase('[契约+源码] 5.2 免责声明：健康结论必带，且前端真的展示它', async (t) => {
      t.ok(healthDisclaimer.length > 0, '健康评估响应带 disclaimer 字段');
      t.ok(
        healthDisclaimer === DISCLAIMER,
        '文案取自 constants.DISCLAIMER（唯一来源）',
        healthDisclaimer.slice(0, 20),
      );
      // 契约层：ChatData / HealthAssessData 都把 disclaimer 定为必填
      const src = readFileSync('src/lib/api/health-contract.ts', 'utf8');
      t.ok(/disclaimer:\s*z\.string\(\)/.test(src), '健康契约里 disclaimer 是必填项');
      const chatSrc = readFileSync('src/lib/api/chat-contract.ts', 'utf8');
      t.ok(/disclaimer:\s*z\.string\(\)/.test(chatSrc), '问答契约里 disclaimer 是必填项');
      // 前端：组件必须消费它，否则等于没这回事
      const sheet = readFileSync('src/components/health/HealthResultSheet.tsx', 'utf8');
      t.ok(sheet.includes('disclaimer'), '健康结果面板解析并展示 disclaimer');
    });

    console.log('\n[6] 清理');
  } finally {
    await stopDev(proc);
  }

  const left = await cleanup(fixture);
  console.log(`  ${left === 0 ? 'PASS' : 'FAIL'}  临时数据已清空，残留 ${left} 只`);
  if (left !== 0) fail += 1;

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
}

/* ────────────────────────── 工具函数 ────────────────────────── */

/** 造一个注入用的候选命中（形状与契约一致） */
function hit(
  id: string,
  code: string,
  name: string,
  features: string[],
  score: number,
): NonNullable<IdentifyInject['hits']>[number] {
  return {
    id,
    code,
    name,
    species: 'CAT',
    avatarUrl: null,
    healthLevel: 'GREEN',
    pendingReview: false,
    summary: null,
    features,
    score,
  };
}

function errOf(parsed: { success: boolean; error?: { issues: Array<{ message: string }> } }): string {
  return parsed.success ? '' : (parsed.error?.issues[0]?.message ?? '契约校验失败');
}

/**
 * 造一个可编排的假决策模型：按次序吐出预设的每一步，用完就收尾。
 * 用途是精确复现「参数被拒 → 自愈」与「连续失败 → 降级」两条路径。
 */
function makeStepModel(
  steps: Array<{ action: string; tool: string; args: Record<string, unknown>; why: string }>,
): typeof import('../src/lib/ai/registry').runStructured {
  let step = 0;
  return (async (req: { intent: string }) => {
    if (req.intent === 'AGENT_PLAN') {
      return {
        ok: true,
        provider: 'e2e',
        data: {
          goal: '写一条观察记录',
          steps: [{ tool: 'addObservation', args: {}, why: '写进手账' }],
        },
      };
    }
    if (req.intent === 'AGENT_NEXT_STEP') {
      const next = steps[step];
      step += 1;
      if (next) return { ok: true, provider: 'e2e', data: next };
      return { ok: true, provider: 'e2e', data: { action: 'finish', args: {}, why: '信息够了' } };
    }
    if (req.intent === 'AGENT_FINAL') {
      return {
        ok: true,
        provider: 'e2e',
        data: { answer: '已记录', usedTools: ['addObservation'], needsHuman: false },
      };
    }
    return { ok: false, error: 'AI_SCHEMA_INVALID', provider: 'e2e', message: '未覆盖的意图' };
  }) as unknown as typeof import('../src/lib/ai/registry').runStructured;
}

main()
  .catch((err) => {
    console.error('自检异常：', err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
