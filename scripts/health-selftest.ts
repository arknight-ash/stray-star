/**
 * 健康评估自检（第 5 阶段）。
 * 用法：npm run health:selftest      —— 直连数据库 + mock Provider
 *       npm run health:http:selftest —— 额外起一个 next dev（--turbo）跑真实 HTTP 链路
 *
 * 断言清单见 docs/stage-5-health.md §9。
 * 测试数据全部带 `TEST:HEALTH:` 前缀，跑完清掉自己产生的行 —— 不碰任何用户/种子数据。
 */
import '../src/lib/load-env';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Prisma } from '@prisma/client';
import { HealthAssessmentSchema } from '../src/lib/ai/schemas';
import { getProvider } from '../src/lib/ai';
import { assessHealth, type AssessDeps } from '../src/lib/health/assess';
import { reconcileHealth, reviewAdvice } from '../src/lib/health/reconcile';
import { loadTimeline } from '../src/lib/db/timeline';
import { HEALTH_ALERT_RULES, type AlertRule } from '../src/lib/alerts/rules';
import { removeUploadUrls, sweepOrphanUploads } from './lib/uploads-cleanup';
import { startDev, stopDev } from './lib/dev-server';
import { prisma } from '../src/lib/db';
import { DISCLAIMER, UNCERTAIN_NOTE, CONFIDENCE_FLOOR } from '../src/lib/constants';

/**
 * 自检必须与 `.env` 无关：真实 Provider 会让断言随网络/额度时好时坏。
 * 在所有 import 求值完之后、任何 AI 调用之前把 Provider 钉死成 mock
 * （getProvider 是懒加载 + 内存缓存，没有更早的调用时这一行就是最终生效值）。
 */
process.env.AI_PROVIDER = 'mock';

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

/** 最小合法 JPEG：魔法字节只认头三字节，够 uploads 的嗅探用 */
function fakeJpegBytes(): Uint8Array {
  const bytes = new Uint8Array(256);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0;
  bytes[254] = 0xff;
  bytes[255] = 0xd9;
  return bytes;
}

/**
 * 本次运行的起点。清理阶段用它界定"这次跑出来的行"。
 *
 * 为什么需要：测试动物被删掉时它名下的预警会级联消失，但**建在种子动物身上的
 * 预警不会**（那是真实档案，脚本无权删）。曾经有一条 SELFTEST 产生的 CRITICAL
 * 挂在 No.005 上没清掉，把 db:selftest 的「预警 1 条」基线打成了 15/1 ——
 * 按时间窗清理规则引擎自己产生的行，才能既不误伤用户数据也不留脏数据。
 */
const RUN_STARTED_AT = new Date();

async function main() {
  console.log('\n[0] 运行前置');
  const provider = getProvider();
  check('Provider 被钉死为 mock（不受 .env / 网络影响）', provider.name === 'mock', provider.name);

  console.log('\n[1] Zod 契约：交叉约束');
  const severeGreen = HealthAssessmentSchema.safeParse({
    assessment: '看着还行',
    healthStatus: 'GREEN',
    severity: 'SEVERE',
    advice: ['尽快就医'],
    confidence: 0.8,
    needsVet: true,
  });
  check('拒绝 SEVERE + GREEN', severeGreen.success === false);

  const severeNoVet = HealthAssessmentSchema.safeParse({
    assessment: '腿受伤了',
    healthStatus: 'RED',
    severity: 'SEVERE',
    advice: ['尽快就医'],
    confidence: 0.8,
    needsVet: false,
  });
  check('拒绝 SEVERE + needsVet:false', severeNoVet.success === false);

  const legal = HealthAssessmentSchema.safeParse({
    assessment: '右后肢疑似外伤',
    healthStatus: 'RED',
    severity: 'SEVERE',
    advice: ['联系校兽医'],
    confidence: 0.82,
    needsVet: true,
  });
  check('接受合规的 SEVERE 结果', legal.success === true);

  console.log('\n[2] 一致性校正');
  const r1 = reconcileHealth({
    assessment: '眼部分泌物',
    healthStatus: 'GREEN',
    severity: 'MODERATE',
    advice: ['观察'],
    confidence: 0.7,
    needsVet: false,
    signals: [],
  });
  check('MODERATE 却说 GREEN → 校正为 YELLOW', r1.healthStatus === 'YELLOW', r1.healthStatus);
  check('记录了校正原因', r1.adjusted === true, r1.adjustReason);

  const r2 = reconcileHealth({
    assessment: 'x',
    healthStatus: 'YELLOW',
    severity: 'MODERATE',
    advice: ['观察'],
    confidence: 0.7,
    needsVet: true,
    signals: [],
  });
  check('needsVet=true 不会被改回 false', r2.needsVet === true);

  /*
   * 2026-10-29：模型对「同一张有伤口的照片」在 needsVet 上会摇摆 ——
   * 同一个输入一次给 true、一次给 false，severity 却都是 MODERATE。
   * 安全下限不能再交给这种飘忽，红旗信号命中就按安全一侧改判。
   */
  const r3 = reconcileHealth({
    assessment: '右后腿有伤口',
    healthStatus: 'YELLOW',
    severity: 'MODERATE',
    advice: ['清洁伤口'],
    confidence: 0.8,
    needsVet: false,
    signals: ['右后腿伤口', '走路瘸腿'],
  });
  check(
    'MODERATE + 伤口/跛行 + 模型说不用就医 → 改判需就医',
    r3.needsVet === true,
    r3.adjustReason,
  );

  const r4 = reconcileHealth({
    assessment: '眼部分泌物',
    healthStatus: 'YELLOW',
    severity: 'MODERATE',
    advice: ['观察'],
    confidence: 0.7,
    signals: ['眼部分泌物'],
  });
  check('模型漏说 needsVet → 无红旗时判为暂不就医', r4.needsVet === false, r4.adjustReason);

  console.log('\n[3] 建议出口审查');
  const advice = reviewAdvice(['保持干燥', '不用看兽医了，肯定能痊愈', '记录体温']);
  check('剔除绝对化医疗断言', advice.stripped === 1, `剔除 ${advice.stripped} 条`);
  check('其余建议保留', advice.advice.includes('保持干燥') && !advice.advice.some((a) => a.includes('肯定能痊愈')));

  console.log('\n[4] 端到端：SEVERE 评估');
  const dir = await mkdtemp(join(tmpdir(), 'health-'));
  const imgPath = join(dir, 'shot.jpg');
  await writeFile(imgPath, fakeJpegBytes());
  const imageUrl = `/uploads/${Date.now()}-health-test.jpg`;
  const createdUploads: string[] = [];

  const author = await prisma.animal.create({
    data: {
      name: '测试猫·星 A',
      // 编号里刻意不带长数字串：否则会命中「包含手机号」的脱敏规则，
      // 把日志弄脏不说，还会让 prompt 里的编号变成测试之外的变量
      code: `TEST:HEALTH:A-${Date.now().toString(36)}`,
      species: 'CAT',
      features: ['黑白'],
    },
    select: { id: true, code: true, createdAt: true, features: true },
  });

  const first = await assessHealth({
    animalId: author.id,
    description: '右后肢有外伤，一直在流血，也不吃东西',
    imageUrl,
    ip: '127.0.0.1',
  });
  check('评估成功返回', first.ok === true);
  if (!first.ok) throw new Error(first.message);

  check('判为 SEVERE', first.data.severity === 'SEVERE', first.data.severity);
  check('健康档为 RED', first.data.healthStatus === 'RED', first.data.healthStatus);
  check('必须建议就医', first.data.needsVet === true);
  check('写入了 HealthReport', Boolean(first.data.reportId) && first.data.persisted === true);
  check('档案等级升到 RED 且 changed', first.data.healthLevel === 'RED' && first.data.healthLevelChanged === true,
    `${first.data.healthLevel} changed=${first.data.healthLevelChanged}`);
  check('触发 CRITICAL 预警', first.data.alert?.level === 'CRITICAL', first.data.alert?.reason ?? '无');

  const saved = await prisma.healthReport.findUnique({ where: { id: first.data.reportId! } });
  check('报告带标准免责声明', saved?.disclaimer === DISCLAIMER);
  check('报告默认待管理员复核', saved?.reviewedByAdmin === false);
  check('本报告不算不确定（置信度 0.66 ≥ 0.6）', first.data.uncertain === false, String(first.data.confidence));
  createdUploads.push(imageUrl);

  const alertsCount1 = await prisma.alert.count({ where: { animalId: author.id } });
  const second = await assessHealth({
    animalId: author.id,
    description: '依然在流血，精神很差',
    imageUrl,
  });
  const alertsCount2 = await prisma.alert.count({ where: { animalId: author.id } });
  check('同一天第二次 SEVERE 不重复预警', second.ok && alertsCount1 === alertsCount2,
    `${alertsCount1} → ${alertsCount2}`);
  const alertSeed = await prisma.alert.findFirst({ where: { animalId: author.id } });
  check('规则引擎产生的预警 seedKey 恒为 null 且 dedupeKey 非空',
    alertSeed?.seedKey === null && Boolean(alertSeed?.dedupeKey), String(alertSeed?.dedupeKey));

  console.log('\n[5] 低置信度不改档');
  const low = await assessHealth({
    animalId: author.id,
    description: '今天按例看了一眼',
    imageUrl,
  });
  const lowData = low.ok ? low.data : null;
  check('低置信度（0.45）标记不确定', lowData?.uncertain === true, String(lowData?.confidence));
  check('低置信度不改档案等级', lowData?.healthLevelChanged === false);
  check('低置信度报告照写', Boolean(lowData?.reportId));
  // R5：提示文案只允许一处定义，前端兜底也用它
  check('低置信度提示用统一文案', lowData?.uncertainNote === UNCERTAIN_NOTE, String(lowData?.uncertainNote));

  console.log('\n[6] 管理员手动档不被覆盖');
  const manual = await prisma.animal.create({
    data: {
      name: '测试猫·星 B',
      code: `TEST:HEALTH:B-${Date.now().toString(36)}`,
      species: 'CAT',
      healthLevel: 'GREEN',
      healthManual: true,
    },
    select: { id: true },
  });
  const manualRun = await assessHealth({
    animalId: manual.id,
    description: '流血不止，严重外伤',
    imageUrl,
  });
  check('手动锁定的动物不被 SEVERE 改档',
    manualRun.ok && manualRun.data.healthLevel === 'GREEN' && manualRun.data.healthLevelChanged === false,
    manualRun.ok ? manualRun.data.healthLevel : '');

  console.log('\n[7] MODERATE 累计触发 WARN');
  const burst = await prisma.animal.create({
    data: {
      name: '测试猫·星 C',
      code: `TEST:HEALTH:C-${Date.now().toString(36)}`,
      species: 'CAT',
    },
    select: { id: true },
  });
  let warnLevel: string | null = null;
  for (let i = 0; i < 3; i += 1) {
    const r = await assessHealth({
      animalId: burst.id,
      description: '一直打喷嚏，还有眼屎',
      imageUrl,
    });
    if (r.ok) warnLevel = r.data.alert?.level ?? warnLevel;
  }
  const warnAlert = await prisma.alert.findFirst({
    where: { animalId: burst.id, dedupeKey: { startsWith: 'HEALTH_MOD_BURST' } },
  });
  check('累计 3 次 MODERATE 触发 WARN', warnLevel === 'WARN' || warnAlert?.level === 'WARN',
    warnAlert?.level ?? warnLevel ?? '无');
  check('WARN 不是 CRITICAL', warnAlert?.level !== 'CRITICAL');

  console.log('\n[8] preview 模式与拦截');
  const preview = await assessHealth({ description: '看着挺精神的', imageUrl: null });
  check('无 animalId → 不写库', preview.ok && preview.data.persisted === false && preview.data.reportId === null);

  const blocked = await assessHealth({
    animalId: author.id,
    description: '怎么毒死这只猫比较好',
    imageUrl,
  });
  check('虐待描述被拦截', blocked.ok === false && blocked.code === 'MODERATION_BLOCKED',
    blocked.ok ? '' : blocked.code);

  const missing = await assessHealth({ animalId: 'not-a-real-id', description: 'x', imageUrl });
  check('animalId 不存在 → NOT_FOUND', missing.ok === false && missing.code === 'NOT_FOUND');

  console.log('\n[9] 迁移回填与时间线');
  const seededReports = await prisma.healthReport.findMany({ where: { seedKey: { not: null } } });
  check('种子报告已回填 healthStatus', seededReports.length > 0 && seededReports.every((r) =>
    (r.severity === 'SEVERE' && r.healthStatus === 'RED') ||
    (r.severity === 'MODERATE' && r.healthStatus === 'YELLOW') ||
    (r.severity === 'MILD' && r.healthStatus === 'GREEN')), `${seededReports.length} 条`);
  check('SEVERE 种子报告 needsVet=true',
    seededReports.filter((r) => r.severity === 'SEVERE').every((r) => r.needsVet === true));

  const timeline = await loadTimeline(author.id, { createdAt: author.createdAt, features: author.features });
  const reportEntries = timeline.filter((e) => e.kind === 'HEALTH_REPORT');
  check('时间线出现健康报告条目', reportEntries.length >= 3, `${reportEntries.length} 条`);
  // 必须按 id 精确取那一份 SEVERE 报告：这条时间线上还有低置信度的 MILD 报告，
  // 用 find 取到的是「最新一条」，不是我们想验证的那条
  const severeEntry = timeline.find((e) => e.id === `HEALTH_REPORT:${first.data.reportId}`);
  check('时间线色调与健康档一致', severeEntry?.tone === 'RED', severeEntry?.tone ?? '没找到该条目');
  check('报告条目带 needsVet 标记', severeEntry?.meta?.needsVet === true);
  check('低置信度报告在时间线里是 GREEN 且未就医建议',
    reportEntries.some((e) => e.tone === 'GREEN' && e.meta?.needsVet === false));

  console.log('\n[10] pendingReview：匿名 AI 初筛 ≠ 人工确认');
  const extraIds: string[] = [];
  const review = await prisma.animal.create({
    data: {
      name: '测试猫·星 D',
      code: `TEST:HEALTH:D-${Date.now().toString(36)}`,
      species: 'CAT',
    },
    select: { id: true },
  });
  extraIds.push(review.id);

  const reviewRun = await assessHealth({
    animalId: review.id,
    description: '右后肢有外伤，一直在流血，也不吃东西',
    imageUrl,
  });
  const reviewReport =
    reviewRun.ok && reviewRun.data.reportId
      ? await prisma.healthReport.findUnique({ where: { id: reviewRun.data.reportId } })
      : null;
  check('匿名评估落库为「待管理员复核」', reviewReport?.reviewedByAdmin === false);
  check('用户数据不占用 seedKey', reviewReport?.seedKey === null);

  const reviewAlert = await prisma.alert.findFirst({ where: { animalId: review.id } });
  check(
    '预警保持 OPEN，没有被自动确认',
    reviewAlert?.status === 'OPEN' && reviewAlert?.ackAt === null && reviewAlert?.ackedById === null,
    reviewAlert?.status ?? '没有预警',
  );

  const pendingCount = await prisma.healthReport.count({
    where: { animalId: review.id, reviewedByAdmin: false },
  });
  check('审核入口能捞到未复核报告', pendingCount >= 1, `${pendingCount} 条`);

  const assessAudit = await prisma.auditLog.findFirst({
    where: { action: 'HEALTH_ASSESS', targetId: review.id },
    orderBy: { createdAt: 'desc' },
    select: { actorId: true },
  });
  check('审计记录的是匿名动作（actorId=null）', assessAudit?.actorId === null);

  console.log('\n[11] 失败注入与事务回滚');

  // 注入点①：Provider 整体不可用。生产代码永远不传 deps，这里传一个假 run。
  const failingCalls: string[] = [];
  const failingRun = (async (req: { imageUrl?: string }) => {
    failingCalls.push(req.imageUrl ? 'vision' : 'text');
    return {
      ok: false,
      error: 'AI_UNAVAILABLE',
      provider: 'mock',
      message: '注入的 Provider 故障（自测）',
    };
  }) as unknown as NonNullable<AssessDeps['run']>;

  const aiDown = await assessHealth(
    { animalId: review.id, description: '右后肢有外伤', imageUrl },
    { run: failingRun },
  );
  check(
    'AI 失败 → AI_UNAVAILABLE（不返回空结论）',
    aiDown.ok === false && aiDown.code === 'AI_UNAVAILABLE',
    aiDown.ok ? '返回了成功' : aiDown.code,
  );
  check(
    '……文字那条也试过了才认输（视觉 → 文字共 2 次）',
    failingCalls.join(',') === 'vision,text',
    failingCalls.join(',') || '没有调用',
  );
  check(
    '……且不新增报告',
    (await prisma.healthReport.count({ where: { animalId: review.id } })) === pendingCount,
  );

  // 注入点②：模型返回垃圾 JSON（文档 §9 第 15 条）
  const brokenRun = (async () => ({
    ok: false,
    error: 'AI_VALIDATION_ERROR',
    provider: 'mock',
    message: '格式不符',
    raw: '{"healthStatus":',
    issues: [{ path: 'healthStatus', message: 'Required' }],
  })) as unknown as NonNullable<AssessDeps['run']>;

  const schemaBad = await assessHealth(
    { animalId: review.id, description: '右后肢有外伤', imageUrl },
    { run: brokenRun },
  );
  check(
    '垃圾 JSON → AI_SCHEMA_INVALID',
    schemaBad.ok === false && schemaBad.code === 'AI_SCHEMA_INVALID',
    schemaBad.ok ? '返回了成功' : schemaBad.code,
  );
  check(
    '……且不留下任何健康结论',
    (await prisma.healthReport.count({ where: { animalId: review.id } })) === pendingCount,
  );

  // 注入点③：报告写完之后、升档那一步失败。
  // 用真事务包起来，只把 tx.animal.update 换成抛错版本 —— 这样验证的是「数据库真的回滚了」，
  // 而不是「我们以为它会回滚」。
  const rollbackAnimal = await prisma.animal.create({
    data: {
      name: '测试猫·星 E',
      code: `TEST:HEALTH:E-${Date.now().toString(36)}`,
      species: 'CAT',
      healthLevel: 'GREEN',
    },
    select: { id: true },
  });
  extraIds.push(rollbackAnimal.id);

  const sabotagedTransact: NonNullable<AssessDeps['transact']> = (fn) =>
    prisma.$transaction(async (tx) => {
      const sabotaged = new Proxy(tx, {
        get(target, prop) {
          if (prop === 'animal') {
            return new Proxy(target.animal, {
              get(model, key) {
                if (key === 'update') {
                  return () => {
                    throw new Error('INJECTED_ANIMAL_UPDATE_FAILURE');
                  };
                }
                const value = Reflect.get(model, key, model);
                return typeof value === 'function' ? value.bind(model) : value;
              },
            });
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as unknown as Prisma.TransactionClient;
      return fn(sabotaged);
    });

  const rolled = await assessHealth(
    {
      animalId: rollbackAnimal.id,
      // 这句描述会稳定命中 mock 的 SEVERE 分支（置信度 0.66 ≥ 闸门），
      // 所以 decision.changed 为真，才会真的走到 animal.update
      description: '右后肢有外伤，一直在流血，也不吃东西',
      imageUrl,
    },
    { transact: sabotagedTransact },
  );
  check(
    '写入失败 → INTERNAL（不假装成功）',
    rolled.ok === false && rolled.code === 'INTERNAL',
    rolled.ok ? '竟然返回成功' : rolled.code,
  );
  check(
    '事务回滚：报告没有残留',
    (await prisma.healthReport.count({ where: { animalId: rollbackAnimal.id } })) === 0,
  );
  check(
    '事务回滚：预警没有残留',
    (await prisma.alert.count({ where: { animalId: rollbackAnimal.id } })) === 0,
  );
  const rollbackLevel = await prisma.animal.findUnique({
    where: { id: rollbackAnimal.id },
    select: { healthLevel: true },
  });
  check('事务回滚：档案等级仍是 GREEN', rollbackLevel?.healthLevel === 'GREEN', rollbackLevel?.healthLevel);

  // 注入点④：预警规则抛错。R16 要求它绝不能吞掉一次成功的评估。
  const explodingRule: AlertRule = {
    name: 'SELFTEST_EXPLODE',
    source: 'HEALTH_REPORT',
    async evaluate() {
      throw new Error('INJECTED_RULE_FAILURE');
    },
  };
  HEALTH_ALERT_RULES.push(explodingRule);
  try {
    const survived = await assessHealth({
      animalId: rollbackAnimal.id,
      description: '右后肢有外伤，一直在流血，也不吃东西',
      imageUrl,
    });
    check('规则抛错不影响评估成功', survived.ok === true);
    check('规则抛错时报告照常落库', Boolean(survived.ok && survived.data.reportId));
    check(
      '其他规则仍然生效（CRITICAL 照发）',
      survived.ok && survived.data.alert?.level === 'CRITICAL',
      survived.ok ? String(survived.data.alert?.level) : '',
    );
  } finally {
    // 自测不能污染运行时规则集：无论断言是否失败都要摘掉
    const idx = HEALTH_ALERT_RULES.indexOf(explodingRule);
    if (idx >= 0) HEALTH_ALERT_RULES.splice(idx, 1);
  }

  // 注入点⑤：视觉那条挂了（超时），文字那条还活着 —— 必须退回「只看文字」。
  // 铁律：任何一步失败都要给一条不依赖图片的出路，否则用户手里明明有一句现场描述，
  // 却被一句「服务不可用」挡回去。
  const visionDownCalls: string[] = [];
  const visionDownRun = (async (req: { imageUrl?: string }) => {
    visionDownCalls.push(req.imageUrl ? 'vision' : 'text');
    if (req.imageUrl) {
      return { ok: false, error: 'AI_TIMEOUT', provider: 'mock', message: '注入：视觉超时' };
    }
    return {
      ok: true,
      provider: 'mock',
      data: {
        assessment: '文字描述显示右后肢有外伤',
        healthStatus: 'YELLOW',
        severity: 'MODERATE',
        advice: ['观察伤口'],
        // 故意给 0.9：服务端必须自己封顶，不能靠模型自觉
        confidence: 0.9,
        needsVet: false,
        signals: ['外伤'],
      },
    };
  }) as unknown as NonNullable<AssessDeps['run']>;

  const textFallback = await assessHealth(
    { animalId: review.id, description: '右后肢有一道伤口，还在渗血', imageUrl },
    { run: visionDownRun },
  );
  check('视觉超时 → 退回只看文字，评估照常出结论', textFallback.ok === true,
    textFallback.ok ? '' : textFallback.code);
  check('……先视觉后文字（没有跳过照片直接问文字）', visionDownCalls.join(',') === 'vision,text',
    visionDownCalls.join(',') || '没有调用');
  const fbData = textFallback.ok ? textFallback.data : null;
  check('……degraded 记下 visionUnavailable:AI_TIMEOUT',
    fbData?.degraded.includes('visionUnavailable:AI_TIMEOUT') === true, JSON.stringify(fbData?.degraded));
  check('……置信度封顶到闸门线（0.9 → 0.6，不冒充高置信）',
    fbData?.confidence === CONFIDENCE_FLOOR, String(fbData?.confidence));
  check('……报告照样落库（照片确实存着，只是没被读到）',
    Boolean(fbData?.reportId) && fbData?.persisted === true);
  const fbAudit = await prisma.auditLog.findFirst({
    where: { action: 'HEALTH_ASSESS', targetId: review.id },
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
  });
  check('……审计留下 assessedWithoutImage:true',
    (fbAudit?.payload as { assessedWithoutImage?: boolean } | null)?.assessedWithoutImage === true);

  // 描述太短时不该重试：一句「有点不对」不值得再烧一次调用，也撑不起一份结论
  const shortCalls: string[] = [];
  const shortRun = (async (req: { imageUrl?: string }) => {
    shortCalls.push(req.imageUrl ? 'vision' : 'text');
    return { ok: false, error: 'AI_UNAVAILABLE', provider: 'mock', message: '注入：全挂' };
  }) as unknown as NonNullable<AssessDeps['run']>;
  const tooShort = await assessHealth(
    { animalId: review.id, description: '有点不对', imageUrl },
    { run: shortRun },
  );
  check('描述太短 → 不重试（只烧一次）且照实报 AI_UNAVAILABLE',
    tooShort.ok === false && tooShort.code === 'AI_UNAVAILABLE' && shortCalls.length === 1,
    `${tooShort.ok ? '返回了成功' : tooShort.code} / ${shortCalls.length} 次`);

  console.log('\n[12] 清理测试数据');
  for (const id of [author.id, manual.id, burst.id, ...extraIds]) {
    await prisma.animal.delete({ where: { id } }).catch(() => undefined);
  }
  // 建在种子动物身上的预警不会被上面的级联带走，按时间窗单独收：
  // 只认规则引擎的 dedupeKey（HEALTH_ 前缀），种子那条 seedKey 恒不在其中。
  const strayAlerts = await prisma.alert.deleteMany({
    where: { createdAt: { gte: RUN_STARTED_AT }, dedupeKey: { startsWith: 'HEALTH_' } },
  });
  if (strayAlerts.count > 0) {
    console.log(`  已清理 ${strayAlerts.count} 条本次产生的预警（含挂在种子动物上的）`);
  }
  await rm(dir, { recursive: true, force: true });
  // 直连模式未必落盘，但登记过的地址照样要扫；再以数据库引用为准兜一遍孤儿
  const removed = await removeUploadUrls(createdUploads);
  const swept = await sweepOrphanUploads(prisma);
  console.log(
    `  已清理 ${3 + extraIds.length} 只测试动物${createdUploads.length ? ` 与 ${removed}/${createdUploads.length} 张登记图` : ''}${
      swept ? `、${swept} 张孤儿图` : ''
    }`,
  );
}

async function httpMode() {
  console.log('\n[13] HTTP 链路');
  const { spawn } = await import('node:child_process');
  const port = 3312;
  // 直接指向本地 next 的 bin：沙箱里 npx 解析不到，而且 --turbo 是本环境下唯一能起来的模式
  // （普通 dev 会 recursive-delete .next，被安全策略拦截）
  const proc = await startDev(port);

  const createdAssets: string[] = [];
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(`${base}/`, 90_000);

    const dir = await mkdtemp(join(tmpdir(), 'health-http-'));
    const file = join(dir, 'shot.jpg');
    await writeFile(file, fakeJpegBytes());
    const { readFile } = await import('node:fs/promises');

    const form = new FormData();
    form.set('file', new Blob([await readFile(file)]), 'shot.jpg');
    form.set('description', '右后肢有外伤，一直在流血，也不吃东西');
    form.set('clientId', `selftest-${Date.now()}`);

    const res = await fetch(`${base}/api/health/assess`, { method: 'POST', body: form });
    const body = await res.json();
    check('HTTP 返回 200 且成功信封', res.status === 200 && body?.ok === true, String(res.status));
    check('HTTP 结果含七字段结论',
      Boolean(body?.data?.healthStatus) && Array.isArray(body?.data?.advice) && typeof body?.data?.needsVet === 'boolean',
      JSON.stringify(body?.data?.healthStatus));
    check('HTTP 结果带免责声明', body?.data?.disclaimer === DISCLAIMER);
    if (body?.data?.imageUrl) createdAssets.push(body.data.imageUrl);

    // preview 模式：不带 animalId
    const previewForm = new FormData();
    previewForm.set('file', new Blob([await readFile(file)]), 'shot.jpg');
    previewForm.set('description', '看着挺精神的');
    const previewRes = await fetch(`${base}/api/health/assess`, { method: 'POST', body: previewForm });
    const previewBody = await previewRes.json();
    check('无图的 preview 请求被拦（归档必须带图）或被接受为 preview',
      previewRes.status === 200 || previewRes.status === 400,
      String(previewRes.status));
    check('preview 结果不写库',
      previewBody?.data?.persisted === false || previewRes.status === 400,
      String(previewBody?.data?.persisted));
    if (previewBody?.data?.imageUrl) createdAssets.push(previewBody.data.imageUrl);

    // 缺少图片也没有描述 → 必须 400
    const emptyForm = new FormData();
    emptyForm.set('animalId', 'whatever');
    const emptyRes = await fetch(`${base}/api/health/assess`, { method: 'POST', body: emptyForm });
    check('既无图也无描述 → 400', emptyRes.status === 400, String(emptyRes.status));

    await rm(dir, { recursive: true, force: true });
  } finally {
    await stopDev(proc);
    // 接口把图片落到了 public/uploads —— 用完即删。
    // 只按"响应回传的 URL"删会漏（preview 分支也写盘），所以末尾以数据库引用为准扫孤儿。
    const removed = await removeUploadUrls(createdAssets);
    const swept = await sweepOrphanUploads(prisma);
    if (createdAssets.length || swept) {
      console.log(`  已清理 ${removed}/${createdAssets.length} 张登记图、${swept} 张孤儿图`);
    }
  }
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`服务未在 ${timeoutMs}ms 内就绪：${url}`);
}

const wantsHttp = process.argv.includes('--http');

main()
  .then(async () => {
    if (wantsHttp) await httpMode();
  })
  .then(() => {
    console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('\n自检脚本异常：', err);
    process.exit(1);
  });
