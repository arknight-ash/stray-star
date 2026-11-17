/**
 * 预警自检（第 7 阶段）。
 * 用法：npm run alerts:selftest         —— 直连数据库（规则 / 事务 / 权限 / 审计）
 *       npm run alerts:http:selftest    —— 额外起一个 next dev 跑真实 HTTP（含门禁 cookie）
 *
 * 断言清单见 docs/stage-7-alerts.md §9。
 * 测试数据全部自建自清：按 id 精确删除自己产生的行，不碰任何用户/种子数据。
 */
import '../src/lib/load-env';
import type { Prisma } from '@prisma/client';
import { startDev, stopDev, waitFor } from './lib/dev-server';
import { prisma } from '../src/lib/db';
import { createObservation } from '../src/lib/observations/create';
import {
  OBSERVATION_ALERT_RULES,
  type AlertRule,
  type AlertTriggerInput,
} from '../src/lib/alerts/rules';
import { evaluateObservationAlerts } from '../src/lib/alerts/engine';
import { ackAlert, resolveAlert } from '../src/lib/admin/alerts';
import { adminUserId } from '../src/lib/auth/actor';
import { ANONYMOUS, canAckAlert, canResolveAlert, canReviewReport } from '../src/lib/permissions';
import { ALERT_NOTICE, MANUAL_SEVERE_NOTICE, ALERT_RULE_CONFIG } from '../src/lib/constants';
import type { Actor } from '../src/lib/permissions';

// 自检必须与 .env 无关：观察入库会走 AI 抽标签，真实 Provider 会让断言随网络漂移
process.env.AI_PROVIDER = 'mock';

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

/** 自检专用编号：带前缀，清理阶段只认自己建的行 */
const PREFIX = 'TEST:ALERT:';

async function makeAnimal(code: string) {
  return prisma.animal.create({
    data: {
      name: code.replace(PREFIX, '测试'),
      code,
      species: 'CAT',
      healthLevel: 'GREEN',
      features: ['短毛'],
      // Animal 没有 seedKey（只有 Observation / HealthReport / Alert 有）：
      // 测试动物靠编号前缀识别，删的时候按 id。
      pendingReview: false,
    },
    select: { id: true, code: true },
  });
}

function trigger(animal: { id: string; code: string }, extra: Partial<AlertTriggerInput>): AlertTriggerInput {
  return {
    source: 'OBSERVATION',
    animalId: animal.id,
    animalCode: animal.code,
    severity: 'MILD',
    tags: [],
    ...extra,
  };
}

async function main() {
  console.log('\n[1] 规则 R5：7 天内 ≥2 条带负面标签的记录才发 WARN');
  const burst = await makeAnimal(`${PREFIX}NEG`);
  const first = await createObservation({ animalCode: burst.code, content: '今天精神差，食欲下降' });
  check('第 1 条提交成功', first.ok === true, first.ok ? '' : first.message);
  check(
    '第 1 条负面记录不惊动管理员',
    first.ok && first.data.alert === null && first.data.notice === null,
    first.ok ? String(first.data.alert?.level ?? 'null') : '',
  );
  check(
    '负面标签真的被认出来了',
    first.ok && first.data.observation.tags.some((t) => ['食欲下降', '精神差'].includes(t)),
    first.ok ? first.data.observation.tags.join('/') : '',
  );

  const second = await createObservation({ animalCode: burst.code, content: '还是不太吃，看着消瘦了' });
  check('第 2 条提交成功', second.ok === true, second.ok ? '' : second.message);
  check('第 2 条起发出 WARN', second.ok && second.data.alert?.level === 'WARN', second.ok ? String(second.data.alert?.level) : '');
  check('提交者看到「已通知管理员」', second.ok && second.data.notice === ALERT_NOTICE, second.ok ? String(second.data.notice) : '');
  check(
    'WARN 的原因写清了几条记录',
    second.ok && /2 条带负面标签/.test(second.data.alert?.reason ?? ''),
    second.ok ? second.data.alert?.reason ?? '' : '',
  );

  console.log('\n[2] 规则 R5：窗口外的旧记录不算数');
  const stale = await makeAnimal(`${PREFIX}STALE`);
  const old = await createObservation({ animalCode: stale.code, content: '精神差，食欲下降' });
  if (old.ok) {
    await prisma.observation.update({
      where: { id: old.data.observation.id },
      data: { createdAt: new Date(Date.now() - (ALERT_RULE_CONFIG.windowDays + 1) * 86400_000) },
    });
  }
  // 当前这条必须自带负面标签（否则它根本不进 R5 的判断），
  // 于是"窗口内只有它一条"就纯粹地在检验窗口边界。
  const fresh = await createObservation({ animalCode: stale.code, content: '今天还是精神差，食欲下降' });
  check(
    `${ALERT_RULE_CONFIG.windowDays} 天之前的记录不计入窗口`,
    fresh.ok && fresh.data.alert === null,
    fresh.ok ? String(fresh.data.alert?.level ?? 'null') : '',
  );

  console.log('\n[3] 规则 R3/R4：单条 SEVERE 与手动标记');
  const severe = await makeAnimal(`${PREFIX}SEVERE`);
  const sev = await createObservation({ animalCode: severe.code, content: '右后腿有外伤，一直在流血' });
  check('单条 SEVERE → CRITICAL', sev.ok && sev.data.alert?.level === 'CRITICAL', sev.ok ? String(sev.data.alert?.level) : '');
  check('也提示了已通知管理员', sev.ok && sev.data.notice === ALERT_NOTICE);

  const manual = await makeAnimal(`${PREFIX}MANUAL`);
  const man = await createObservation({ animalCode: manual.code, content: '看着不太对劲', severe: true });
  check('手动标记 → CRITICAL', man.ok && man.data.alert?.level === 'CRITICAL', man.ok ? String(man.data.alert?.level) : '');
  check('严重度被强制为 SEVERE', man.ok && man.data.observation.severity === 'SEVERE', man.ok ? man.data.observation.severity : '');
  check('manualSevere 落库', man.ok && man.data.observation.manualSevere === true);
  // 勾了「情况紧急」的人正盯着手机等回应，文案要比普通的「已通知管理员」更具体。
  check(
    '勾紧急 → 回给提交者更具体的提醒',
    man.ok && man.data.notice === MANUAL_SEVERE_NOTICE,
    man.ok ? String(man.data.notice) : '',
  );
  check(
    '同一条只发一条 CRITICAL（R3 让位给 R4）',
    (await prisma.alert.count({ where: { animalId: manual.id, level: 'CRITICAL' } })) === 1,
  );
  const manualAlert = await prisma.alert.findFirst({ where: { animalId: manual.id } });
  check('原因写明是同学手动标记', /手动标记/.test(manualAlert?.reason ?? ''), manualAlert?.reason ?? '无');

  console.log('\n[4] 去重与不短路');
  const dedupe = await makeAnimal(`${PREFIX}DEDUPE`);
  await createObservation({ animalCode: dedupe.code, content: '右后腿有外伤，一直在流血' });
  await createObservation({ animalCode: dedupe.code, content: '伤口还在流血' });
  check(
    '同一规则同一天只发一条',
    (await prisma.alert.count({ where: { animalId: dedupe.id, level: 'CRITICAL' } })) === 1,
    String(await prisma.alert.count({ where: { animalId: dedupe.id, level: 'CRITICAL' } })),
  );

  const both = await makeAnimal(`${PREFIX}BOTH`);
  await createObservation({ animalCode: both.code, content: '精神差，食欲下降' });
  const bothSecond = await createObservation({ animalCode: both.code, content: '后腿外伤出血，站不起来' });
  const bothCount = await prisma.alert.count({ where: { animalId: both.id } });
  check('同时踩中 R3 与 R5 时两条并存（不短路）', bothCount === 2, `${bothCount} 条`);
  check('回传取最严重的一档', bothSecond.ok && bothSecond.data.alert?.level === 'CRITICAL', bothSecond.ok ? String(bothSecond.data.alert?.level) : '');

  console.log('\n[5] 规则抛错不吞主流程（R16）');
  const exploding: AlertRule = {
    name: 'SELFTEST_EXPLODE',
    source: 'OBSERVATION',
    async evaluate() {
      throw new Error('INJECTED_RULE_FAILURE');
    },
  };
  OBSERVATION_ALERT_RULES.push(exploding);
  try {
    const survived = await createObservation({ animalCode: severe.code, content: '还在流血，不吃东西' });
    check('规则抛错后提交照常成功', survived.ok === true, survived.ok ? '' : survived.message);
    check('其他规则照常生效', survived.ok && survived.data.alert !== null);
  } finally {
    const idx = OBSERVATION_ALERT_RULES.indexOf(exploding);
    if (idx >= 0) OBSERVATION_ALERT_RULES.splice(idx, 1);
  }

  console.log('\n[6] 观察与预警同事务');
  const rollback = await makeAnimal(`${PREFIX}ROLLBACK`);
  const sabotaged = await createObservation(
    { animalCode: rollback.code, content: '右后腿有外伤，一直在流血' },
    {
      transact: async () => {
        throw new Error('INJECTED_PERSIST_FAILURE');
      },
    },
  );
  check('写入失败 → INTERNAL（不假装成功）', sabotaged.ok === false && sabotaged.code === 'INTERNAL', sabotaged.ok ? '竟然成功' : sabotaged.code);
  check('事务回滚：观察没有残留', (await prisma.observation.count({ where: { animalId: rollback.id } })) === 0);
  check('事务回滚：预警没有残留', (await prisma.alert.count({ where: { animalId: rollback.id } })) === 0);

  console.log('\n[7] 权限守卫（唯一裁决处 permissions）');
  check('匿名可 ACK（认领跟进）', canAckAlert(ANONYMOUS, 'CRITICAL').allowed);
  check('匿名不可 RESOLVED', canResolveAlert(ANONYMOUS, 'CRITICAL').allowed === false);
  check(
    'CRITICAL 的关闭只给管理员',
    canResolveAlert({ kind: 'student', id: 's1', role: 'STUDENT' }, 'CRITICAL').allowed === false,
  );
  check('匿名不可复核报告', canReviewReport(ANONYMOUS).allowed === false);

  const adminId = await adminUserId();
  const admin: Actor = { kind: 'admin', id: adminId ?? '', role: 'ADMIN' };
  check('种子数据里有管理员账号', Boolean(adminId), adminId ?? '未找到（先跑 db:seed）');

  const target = await prisma.alert.findFirst({ where: { animalId: severe.id } });
  if (!target) throw new Error('缺 CRITICAL 预警，前面的规则没跑通');
  const denied = await resolveAlert(target.id, ANONYMOUS);
  check(
    '匿名关闭 CRITICAL 被拒且给出规则原话',
    denied.ok === false && /管理员/.test(denied.message),
    denied.ok ? '竟然成功' : denied.message,
  );

  const acked = await ackAlert(target.id, ANONYMOUS);
  check('匿名 ACK 成功', acked.ok === true, acked.ok ? '' : acked.message);
  check('ACK 不写处置人（匿名无责任人）', acked.ok && acked.data.alert.handledBy === null);

  const resolved = await resolveAlert(target.id, admin);
  check('管理员关闭 CRITICAL 成功', resolved.ok === true, resolved.ok ? '' : resolved.message);
  check('关闭后状态为 RESOLVED', resolved.ok && resolved.data.alert.status === 'RESOLVED');
  check('关闭时间单独记录', resolved.ok && resolved.data.alert.resolvedAt !== null);
  const resolveAudit = await prisma.auditLog.findFirst({
    where: { action: 'ALERT_RESOLVE', targetId: target.id },
  });
  check('写 ALERT_RESOLVE 审计', Boolean(resolveAudit), resolveAudit ? '' : '未找到');
  const resolveRow = await prisma.alert.findUnique({ where: { id: target.id } });
  check('处置角色落库为 ADMIN', resolveRow?.ackedByRole === 'ADMIN', String(resolveRow?.ackedByRole));

  console.log('\n[8] 关键报告审核三动作（阶段 9）');
  const { reviewReport } = await import('../src/lib/admin/reports');
  const reportAnimal = await makeAnimal(`${PREFIX}REPORT`);
  const report = await prisma.healthReport.create({
    data: {
      animalId: reportAnimal.id,
      imageUrl: '/uploads/selftest-alerts.jpg',
      assessment: '右后肢疑似外伤',
      severity: 'SEVERE',
      healthStatus: 'RED',
      needsVet: true,
      advice: ['尽快就医'],
      confidence: 0.82,
      disclaimer: '自检',
      reviewedByAdmin: false,
      seedKey: null,
    },
    select: { id: true },
  });
  const reviewDenied = await reviewReport(
    report.id,
    { verdict: 'APPROVED' },
    ANONYMOUS,
  );
  check('匿名审核报告被拒', reviewDenied.ok === false && /管理员/.test(reviewDenied.message), reviewDenied.ok ? '竟然成功' : reviewDenied.message);

  const rejectNoNote = await reviewReport(report.id, { verdict: 'REJECTED' }, admin);
  check('驳回不带 note 被契约层拦截前先看业务层行为（note 由 zod 拦，这里直调应成功）', rejectNoNote.ok === true, rejectNoNote.ok ? '' : rejectNoNote.message);
  if (rejectNoNote.ok) {
    check('驳回后状态为 REJECTED', rejectNoNote.data.report.reviewStatus === 'REJECTED');
    check('驳回不升格 reviewedByAdmin', rejectNoNote.data.report.reviewedByAdmin === false);
  }

  const reviewEdit = await reviewReport(
    report.id,
    {
      verdict: 'APPROVED',
      edits: { assessment: '右后肢确诊外伤，需清创', severity: 'SEVERE' },
      note: '照片核对无误',
    },
    admin,
  );
  check('管理员通过并修改成功', reviewEdit.ok === true, reviewEdit.ok ? '' : reviewEdit.message);
  check('通过后状态为 APPROVED', reviewEdit.ok && reviewEdit.data.report.reviewStatus === 'APPROVED');
  check('修改落库（assessment 已更新）', reviewEdit.ok && reviewEdit.data.diff.assessment !== undefined);
  check('SEVERE 修改后 reconcile 强制 needsVet', reviewEdit.ok && reviewEdit.data.diff.needsVet === undefined, 'needsVet 本就为 true，不应产生校正');
  const reviewAudit = await prisma.auditLog.findFirst({ where: { action: 'REPORT_REVIEW', targetId: report.id } });
  check('写 REPORT_REVIEW 审计', Boolean(reviewAudit), reviewAudit ? '' : '未找到');
  check('审计 payload 带 diff', reviewAudit !== null && 'diff' in (reviewAudit?.payload as object));

  console.log('\n[9] 列表排序与计数');
  const { loadAlertBoard } = await import('../src/lib/admin/alerts');
  const board = await loadAlertBoard({ status: 'ALL' });
  const statuses = board.items.map((i) => i.status);
  const firstResolved = statuses.indexOf('RESOLVED');
  check('未处理的排在最前', firstResolved === -1 || statuses.slice(0, firstResolved).every((s) => s !== 'RESOLVED'));
  check('计数与列表一致（全部状态下）', board.counts.OPEN + board.counts.ACK + board.counts.RESOLVED >= board.items.length);
  check('关键报告只列 SEVERE / 建议就医', board.reports.every((r) => r.severity === 'SEVERE' || r.needsVet));

  // 收集本轮产生的 id，HTTP 模式结束后一并清理
  const animalIds = [burst.id, stale.id, severe.id, manual.id, dedupe.id, both.id, rollback.id, reportAnimal.id];
  await cleanup(animalIds, [report.id]);
}

async function cleanup(animalIds: string[], reportIds: string[]) {
  console.log('\n[10] 清理测试数据');
  await prisma.alert.deleteMany({ where: { animalId: { in: animalIds } } });
  await prisma.healthReport.deleteMany({ where: { animalId: { in: animalIds } } });
  await prisma.observation.deleteMany({ where: { animalId: { in: animalIds } } });
  await prisma.animal.deleteMany({ where: { id: { in: animalIds } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: [...animalIds, ...reportIds] } } });
  const left = await prisma.animal.count({ where: { code: { startsWith: PREFIX } } });
  check('测试动物已清空', left === 0, `残留 ${left}`);
}

async function httpMode() {
  console.log('\n[11] HTTP 链路（含管理端门禁）');
  // 3316 已被 rag 的 HTTP 自检占用，这里错开一个端口
  const port = 3318;
  const proc = await startDev(port);
  const base = `http://127.0.0.1:${port}`;
  let cookie = '';

  try {
    await waitFor(`${base}/`, 90_000);

    const animal = await makeAnimal(`${PREFIX}HTTP`);

    // 提交一条手动标记的观察 → 应当触发预警并回传提示
    const res = await fetch(`${base}/api/observations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        animalCode: animal.code,
        content: '后腿外伤，一直在流血',
        severe: true,
        clientId: `alert-http-${Date.now()}`,
      }),
    });
    const body = await res.json();
    check('HTTP 提交返回 200', res.status === 200 && body?.ok === true, String(res.status));
    check('HTTP 响应带 notice', body?.data?.notice === ALERT_NOTICE, String(body?.data?.notice));
    check('HTTP 响应带 alert 等级', body?.data?.alert?.level === 'CRITICAL', String(body?.data?.alert?.level));
    const alertId = body?.data?.alert?.id as string | undefined;

    const list = await fetch(`${base}/api/admin/alerts`);
    const listBody = await list.json();
    check('未登录时列表可读且标明匿名', listBody?.data?.actor?.kind === 'anonymous', String(listBody?.data?.actor?.kind));

    const badLogin = await fetch(`${base}/api/admin/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'admin', password: 'wrong-password' }),
    });
    check('错误密码 → 401', badLogin.status === 401, String(badLogin.status));

    const badAccount = await fetch(`${base}/api/admin/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'not-admin', password: process.env.ADMIN_PASSWORD?.trim() || process.env.ADMIN_TOKEN?.trim() || 'x' }),
    });
    check('错误账号 → 401', badAccount.status === 401, String(badAccount.status));

    const adminPassword = process.env.ADMIN_PASSWORD?.trim() || process.env.ADMIN_TOKEN?.trim();
    if (!adminPassword) {
      console.log('  SKIP 未配置 ADMIN_PASSWORD / ADMIN_TOKEN，跳过登录后的用例');
    } else {
      const login = await fetch(`${base}/api/admin/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account: process.env.ADMIN_ACCOUNT?.trim() || 'admin', password: adminPassword }),
      });
      const setCookie = login.headers.getSetCookie?.() ?? [];
      cookie = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('ss_admin=')) ?? '';
      check('账号+密码正确 → 200 且下发 cookie', login.status === 200 && cookie.length > 0, String(login.status));

      const asAdmin = await fetch(`${base}/api/admin/alerts`, { headers: { cookie } });
      const asAdminBody = await asAdmin.json();
      check('带 cookie 时识别为管理员', asAdminBody?.data?.actor?.kind === 'admin', String(asAdminBody?.data?.actor?.kind));

      if (alertId) {
        const noAuth = await fetch(`${base}/api/admin/alerts/${alertId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'RESOLVED' }),
        });
        const noAuthBody = await noAuth.json();
        check('匿名关闭 CRITICAL → 403', noAuth.status === 403, String(noAuth.status));
        check('403 的 message 是规则原话', /管理员/.test(noAuthBody?.error?.message ?? ''), noAuthBody?.error?.message ?? '无');

        const withAuth = await fetch(`${base}/api/admin/alerts/${alertId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ action: 'RESOLVED', clientId: `http-${Date.now()}` }),
        });
        const withAuthBody = await withAuth.json();
        check('管理员关闭 → 200 且状态 RESOLVED', withAuth.status === 200 && withAuthBody?.data?.alert?.status === 'RESOLVED', String(withAuth.status));
      }
    }

    await cleanup([animal.id], []);
  } finally {
    await stopDev(proc);
  }
}


const wantsHttp = process.argv.includes('--http');

main()
  .then(async () => {
    if (wantsHttp) await httpMode();
  })
  .catch(async (err) => {
    console.error('\n自检脚本异常：', err);
    fail += 1;
  })
  .then(async () => {
    // 兜底清理：断言失败提前退出时也不能把测试动物留在库里
    const stray = await prisma.animal.findMany({ where: { code: { startsWith: PREFIX } }, select: { id: true } });
    if (stray.length) await cleanup(stray.map((a) => a.id), []);
    console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  });
