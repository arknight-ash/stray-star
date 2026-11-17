/**
 * 数据库问答自检（星枢 / 星枢问答的「读库」能力）。
 * 用法：npm run insight:selftest
 *
 * 覆盖三层：
 *   1. lib/insight/db-stats  统计口径自洽（三色之和 = 总数、角落之和 = 有坐标的）
 *   2. lib/insight/list      条件名单与记录检索的过滤是否真的生效
 *   3. lib/insight/ask       问句判定：该认的认，不该认的一律返回 null
 *
 * 第 3 层是最重要的回归面：把护理问题（「猫瘟怎么办」）判成统计问题，
 * 用户会收到一句干巴巴的计数而不是处置建议 —— 断言 null 就是在守这条线。
 *
 * 测试数据自建自清：按 code 前缀精确删除自己建的行，不碰种子与用户数据。
 */
import '../src/lib/load-env';
import { prisma } from '../src/lib/db';
import { CAMPUS_SPOTS } from '../src/lib/map-config';
import { OBSERVATORY } from '../src/lib/constants';
import { loadDbSnapshot, describeSnapshot } from '../src/lib/insight/db-stats';
import { listAnimals, listObservations } from '../src/lib/insight/list';
import { askDatabase } from '../src/lib/insight/ask';
import {
  getObservatoryNote,
  loadObservatorySnapshot,
  resetObservatoryCache,
} from '../src/lib/insight/observatory';
import { ObservatoryNoteSchema } from '../src/lib/ai/schemas';
import { mockProvider } from '../src/lib/ai/providers/mock';

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const PREFIX = 'TEST:INSIGHT:';
const spot = CAMPUS_SPOTS.find((s) => s.name === '宿舍区') ?? CAMPUS_SPOTS[0]!;

async function cleanup() {
  const left = await prisma.animal.deleteMany({ where: { code: { startsWith: PREFIX } } });
  return left.count;
}

async function main() {
  await cleanup();

  console.log('\n[1] 统计口径自洽');
  const base = await loadDbSnapshot();
  check(
    '三色之和 = 档案总数',
    base.animals.green + base.animals.yellow + base.animals.red === base.animals.total,
    `${base.animals.green}+${base.animals.yellow}+${base.animals.red} vs ${base.animals.total}`,
  );
  check(
    '猫 + 狗 = 档案总数',
    base.animals.cats + base.animals.dogs === base.animals.total,
    `${base.animals.cats}+${base.animals.dogs} vs ${base.animals.total}`,
  );
  check(
    '有坐标 + 缺坐标 = 档案总数',
    base.animals.located + base.animals.missingLocation === base.animals.total,
    `${base.animals.located}+${base.animals.missingLocation} vs ${base.animals.total}`,
  );
  const spotSum = base.spots.reduce((n, s) => n + s.animals, 0);
  check(
    '角落动物之和 = 有坐标的档案数',
    spotSum === base.animals.located,
    `${spotSum} vs ${base.animals.located}`,
  );
  check(
    '预警分级之和 = 未处理预警数',
    base.alerts.critical + base.alerts.warn + base.alerts.info === base.alerts.open,
    '',
  );
  check(
    '今天记录数不超过近 7 天',
    base.observations.today <= base.observations.last7d,
    `${base.observations.today} / ${base.observations.last7d}`,
  );
  check('概况文本非空且带数字', /\d/.test(describeSnapshot(base)), '');

  console.log('\n[2] 名单与记录检索');
  const created = await prisma.animal.create({
    data: {
      code: `${PREFIX}01`,
      name: '自检小星',
      species: 'CAT',
      healthLevel: 'RED',
      pendingReview: true,
      summary: '自检用临时档案',
      mapLat: spot.lat,
      mapLng: spot.lng,
    },
  });

  const reds = await listAnimals({ healthLevel: ['RED', 'YELLOW'], limit: 50 });
  check(
    '按健康档筛出红色个体',
    reds.some((r) => r.code === created.code),
    `${reds.length} 只`,
  );
  check(
    '筛出的每一只都在指定档位里',
    reds.every((r) => r.healthLevel === 'RED' || r.healthLevel === 'YELLOW'),
    '',
  );

  const pendings = await listAnimals({ pendingReview: true, limit: 50 });
  check(
    '按待核实筛选命中',
    pendings.some((r) => r.code === created.code),
    '',
  );

  const nearSpot = await listAnimals({ spotName: spot.name, limit: 50 });
  check(
    `按角落「${spot.name}」筛选命中`,
    nearSpot.some((r) => r.code === created.code),
    '',
  );
  check(
    '角落名单里每只的角落都一致',
    nearSpot.every((r) => r.spot === spot.name),
    '',
  );

  const missing = await listAnimals({ missingLocation: true, limit: 50 });
  check('缺位置名单不含带坐标的个体', !missing.some((r) => r.code === created.code), '');

  const noObs = await listObservations({ animalCode: created.code });
  check('新档案还没有观察记录', noObs.length === 0, '');
  const weekObs = await listObservations({ days: 7, limit: 50 });
  const weekAgo = Date.now() - 7 * 86_400_000;
  check(
    '近 7 天检索的时间窗有效',
    weekObs.every((o) => new Date(o.at).getTime() >= weekAgo),
    `${weekObs.length} 条`,
  );

  console.log('\n[3] 问句判定：该认的认');
  const cases: Array<[string, string]> = [
    ['现在一共有多少只动物', 'animalTotal'],
    ['有几只猫几只狗', 'animalTotal'],
    ['健康情况分布怎么样', 'healthDist'],
    ['现在有几条未处理预警', 'alerts'],
    ['哪些动物需要关注', 'attention'],
    ['红色预警的有哪些', 'attention'],
    ['本周记录了几条观察', 'observations'],
    ['照片墙上有多少张照片', 'photos'],
    ['哪个角落记录最多', 'spots'],
    ['宿舍区有几只', 'spots'],
    ['有哪些还没补位置的', 'missingLocation'],
    ['有多少待核实的', 'pending'],
    ['最近有什么新记录', 'recent'],
  ];
  for (const [q, topic] of cases) {
    const r = await askDatabase(q);
    check(`「${q}」→ ${topic}`, r?.topic === topic, r ? `实际 ${r.topic}` : '实际 null');
  }

  console.log('\n[4] 问句判定：不该认的一律放行');
  const mustMiss = [
    '猫瘟怎么办',
    '喂猫一天几次',
    '小灰平常在哪活动',
    '补充位置怎么弄',
    '这只猫受伤了怎么处理',
  ];
  for (const q of mustMiss) {
    const r = await askDatabase(q);
    check(`「${q}」不归数据库路`, r === null, r ? `误判为 ${r.topic}` : '');
  }

  console.log('\n[5] 星图观测手记：AI 主动看全局');
  // 造两只对照星：一只「红档 + 6 天没记录 + 活跃度下降」，一只「今天刚被记录、一切正常」
  const quietStar = await prisma.animal.create({
    data: {
      code: `${PREFIX}OB1`,
      name: '自检静默星',
      species: 'CAT',
      healthLevel: 'RED',
      mapLat: spot.lat,
      mapLng: spot.lng,
    },
  });
  const freshStar = await prisma.animal.create({
    data: {
      code: `${PREFIX}OB2`,
      name: '自检活跃星',
      species: 'CAT',
      healthLevel: 'GREEN',
      mapLat: spot.lat,
      mapLng: spot.lng,
    },
  });
  const sixDaysAgo = new Date(Date.now() - 6 * 86_400_000);
  for (let i = 0; i < 3; i += 1) {
    await prisma.observation.create({
      data: {
        animalId: quietStar.id,
        type: 'BEHAVIOR',
        content: `自检记录 ${i + 1}`,
        createdAt: new Date(sixDaysAgo.getTime() + i * 60_000),
        pendingReview: false,
      },
    });
  }
  await prisma.observation.create({
    data: { animalId: freshStar.id, type: 'FEEDING', content: '自检：今天刚喂过', pendingReview: false },
  });

  resetObservatoryCache();
  const snapshot = await loadObservatorySnapshot();
  check('时刻标签是 HH:mm', /^\d{2}:\d{2}$/.test(snapshot.facts.hourLabel), snapshot.facts.hourLabel);
  check(
    '总量口径与 db-stats 一致',
    snapshot.facts.totals.total >= 2 &&
      snapshot.facts.totals.green + snapshot.facts.totals.yellow + snapshot.facts.totals.red ===
        snapshot.facts.totals.total,
    `${snapshot.facts.totals.green}+${snapshot.facts.totals.yellow}+${snapshot.facts.totals.red}=${snapshot.facts.totals.total}`,
  );
  check(
    '候选上限受配置约束',
    snapshot.facts.candidates.length <= OBSERVATORY.maxCandidates,
    `${snapshot.facts.candidates.length} / ${OBSERVATORY.maxCandidates}`,
  );
  const quiet = snapshot.facts.candidates.find((c) => c.code === quietStar.code);
  check('长期没记录的星进入候选', Boolean(quiet), quiet ? `quietDays=${quiet.quietDays}` : '未进入');
  check(
    '活跃度下降写进依据（近 3 天 0 条、之前 3 条）',
    Boolean(quiet && quiet.obsRecent === 0 && quiet.obsBefore === 3) &&
      Boolean(quiet?.reasons.some((r) => r.includes('活跃度下降'))),
    quiet ? quiet.reasons.join(' | ') : '',
  );
  check(
    '今天刚记录的正常星不进候选（不制造噪音）',
    !snapshot.facts.candidates.some((c) => c.code === freshStar.code),
    '',
  );

  // —— 正常路径：AI 写的话被采纳，且编号/数字必须真的在库里 ——
  const quietDays = quiet?.quietDays ?? 0;
  const aiNote = await getObservatoryNote({
    run: (async () => ({
      ok: true,
      provider: 'mock',
      data: {
        headline: `AI 观测：${snapshot.facts.hourLabel}，自检静默星（${quietStar.code}）已 ${quietDays} 天没有新记录，建议现场看一眼。`,
        focusCode: quietStar.code,
        signals: [`${quietStar.code} 已 ${quietDays} 天无记录`, `全场未处理预警 ${snapshot.facts.totals.openAlerts} 条`],
        confidence: 0.7,
      },
    })) as unknown as typeof import('../src/lib/ai/registry').runStructured,
  });
  check('AI 生成 → source=ai', aiNote.source === 'ai', aiNote.source);
  check('正文剥掉了重复的「AI 观测：」前缀', !aiNote.text.startsWith('AI 观测'), aiNote.text.slice(0, 20));
  check('关注对象解析成具体档案', aiNote.focus?.code === quietStar.code, aiNote.focus?.code ?? 'null');
  check('口径随卡片一起返回', aiNote.window.total === snapshot.facts.totals.total && aiNote.window.ttlMinutes > 0,
    `${aiNote.window.total} 颗 / ${aiNote.window.ttlMinutes} 分钟`);

  // —— 缓存：数据没变就不再烧模型调用 ——
  let calls = 0;
  const throwingRun = (async () => {
    calls += 1;
    throw new Error('不该被调用');
  }) as unknown as typeof import('../src/lib/ai/registry').runStructured;
  const cachedNote = await getObservatoryNote({ run: throwingRun });
  check('同一份数据第二次直接命中缓存', cachedNote.cached === true && calls === 0, `AI 调用 ${calls} 次`);
  check('缓存不改变生成时间', cachedNote.generatedAt === aiNote.generatedAt, '');

  // —— 防幻觉：句子里出现库里没有的编号，整句作废走兜底 ——
  resetObservatoryCache();
  const hallucinated = await getObservatoryNote({
    run: (async () => ({
      ok: true,
      provider: 'mock',
      data: {
        headline: 'AI 观测：今晚 No.999 疑似受伤，建议立即处理。',
        focusCode: quietStar.code,
        signals: [],
        confidence: 0.9,
      },
    })) as unknown as typeof import('../src/lib/ai/registry').runStructured,
  });
  check(
    '编造编号 → 整句作废（降级为本地摘要）',
    hallucinated.source === 'fallback' && hallucinated.degraded.includes('note:unknown_code_or_empty'),
    hallucinated.degraded.join(',') || '没有降级标记',
  );

  // —— 数字防漂移：facts 里没有的量不许出现在句子里 ——
  resetObservatoryCache();
  const inventedNumber = await getObservatoryNote({
    run: (async () => ({
      ok: true,
      provider: 'mock',
      data: {
        headline: 'AI 观测：今晚 No.003 已经 30 天没有出现，建议立刻组织搜索。',
        focusCode: quietStar.code,
        signals: [],
        confidence: 0.8,
      },
    })) as unknown as typeof import('../src/lib/ai/registry').runStructured,
  });
  check(
    '编造天数（30 天）→ 作废走兜底',
    inventedNumber.source === 'fallback',
    inventedNumber.text.slice(0, 30),
  );

  // —— 口径防串：全场没有未处理预警时，不许把"红色健康档"说成"预警" ——
  resetObservatoryCache();
  const wrongWording = await getObservatoryNote({
    run: (async () => ({
      ok: true,
      provider: 'mock',
      data: {
        headline: 'AI 观测：全场共有 2 条 RED 预警尚未处理，建议尽快安排人手。',
        focusCode: quietStar.code,
        signals: [`全场 ${snapshot.facts.totals.red} 条 RED 预警`],
        confidence: 0.7,
      },
    })) as unknown as typeof import('../src/lib/ai/registry').runStructured,
  });
  const alertsNow = snapshot.facts.totals.openAlerts;
  check(
    '把健康档说成预警 → 作废走兜底（口径不许串）',
    alertsNow > 0 ? wrongWording.source === 'ai' : wrongWording.source === 'fallback',
    `当前未处理预警 ${alertsNow} 条 / source=${wrongWording.source}`,
  );

  // —— AI 不可用：兜底句必须有依据，且不许冒充 AI ——
  resetObservatoryCache();
  const aiDown = await getObservatoryNote({
    run: (async () => ({
      ok: false,
      error: 'AI_TIMEOUT',
      provider: 'mock',
      message: '注入：超时',
    })) as unknown as typeof import('../src/lib/ai/registry').runStructured,
  });
  check('AI 失败 → source=fallback', aiDown.source === 'fallback', aiDown.source);
  check('降级原因写清楚', aiDown.degraded.includes('ai:AI_TIMEOUT'), aiDown.degraded.join(','));
  check('兜底句仍带时刻与事实', aiDown.text.includes(snapshot.facts.hourLabel) && aiDown.text.length > 12,
    aiDown.text.slice(0, 40));

  // —— 首屏预算：上游慢时不许把整页拖住；AI 晚到的答案自己回填缓存 ——
  resetObservatoryCache();
  let slowCalls = 0;
  const slowRun = (async () => {
    slowCalls += 1;
    await new Promise((r) => setTimeout(r, 60));
    return {
      ok: true,
      provider: 'mock',
      data: {
        headline: 'AI 观测：此刻全场的星都还算安静，建议明早再巡一次。',
        focusCode: quietStar.code,
        signals: [],
        confidence: 0.6,
      },
    };
  }) as unknown as typeof import('../src/lib/ai/registry').runStructured;
  const startedAt = Date.now();
  const budgeted = await getObservatoryNote({ run: slowRun, budgetMs: 10 });
  const spent = Date.now() - startedAt;
  check(
    '超出首屏预算 → 先交本地摘要，不陪上游一起等',
    budgeted.source === 'fallback' && budgeted.degraded.includes('ai:pending') && spent < 55,
    `${spent}ms / ${budgeted.degraded.join(',')}`,
  );
  await new Promise((r) => setTimeout(r, 160));
  const backfilled = await getObservatoryNote({ run: slowRun });
  check(
    'AI 晚到 → 自己回填缓存，下次进页面就是模型写的那句',
    backfilled.source === 'ai' && backfilled.cached === true && slowCalls === 1,
    `source=${backfilled.source} / cached=${backfilled.cached} / 调用 ${slowCalls} 次`,
  );

  // —— mock Provider 必须能出符合契约的 note（本地演示不靠网络） ——
  const mockNote = await mockProvider.chat(
    [{ role: 'user', content: '请根据 facts 写一条此刻的星图观测手记。' }],
    ObservatoryNoteSchema,
    { intent: 'OBSERVATORY', context: { ...snapshot.facts } },
  );
  check('mock Provider 产出合法手记', mockNote.headline.length > 6 && Array.isArray(mockNote.signals),
    mockNote.headline.slice(0, 30));

  console.log('\n[6] 清理');
  const removed = await cleanup();
  check('临时档案已删除', removed >= 3, `删除 ${removed} 只`);
  const left = await prisma.animal.count({ where: { code: { startsWith: PREFIX } } });
  check('没有残留', left === 0, `${left} 只`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('自检异常：', err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
