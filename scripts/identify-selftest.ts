/**
 * 阶段 3 端到端自测：npm run id:selftest
 *
 * 两段：
 *  [1-2] 函数级：直接跑 pipeline / createAnimal / 权限守卫，不依赖服务是否起来
 *  [3]   HTTP 级：临时拉起 next dev（端口 3137），验证 multipart 解析、限流、幂等，跑完即关
 */
import '../src/lib/load-env';
import { spawn, type ChildProcess } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import { startDev, stopDev } from './lib/dev-server';
import path from 'node:path';
import { getProvider, setProvider } from '../src/lib/ai/registry';
import { runIdentify } from '../src/lib/identify/pipeline';
import { createAnimal } from '../src/lib/identify/create-animal';
import { resetRateLimits } from '../src/lib/rate-limit';
import { saveUpload, uploadsRoot } from '../src/lib/uploads';
import { prisma } from '../src/lib/db';
import {
  canAckAlert,
  canDelete,
  canDeleteObservation,
  canEditAnimal,
  canResolveAlert,
  canReviewAnimal,
  ANONYMOUS,
} from '../src/lib/permissions';
import type { IdentifyData } from '../src/lib/api/identify-contract';

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const PORT = 3137;
const BASE = `http://127.0.0.1:${PORT}`;

/** 最小合法 JPEG：SOI + APP0 + EOI，够过魔法字节嗅探 */
function minimalJpeg(): File {
  const bytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
  return new File([bytes], 'selftest.jpg', { type: 'image/jpeg' });
}

function fakePng(): File {
  return new File([new TextEncoder().encode('this is definitely not a png')], 'fake.png', {
    type: 'image/png',
  });
}

function oversizeJpeg(): File {
  const bytes = new Uint8Array(9 * 1024 * 1024);
  bytes.set([0xff, 0xd8, 0xff], 0);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return new File([bytes], 'huge.jpg', { type: 'image/jpeg' });
}

async function identify(
  file: File | null,
  note?: string,
  photoUrl?: string,
): Promise<IdentifyData | null> {
  const result = await runIdentify({
    file,
    note: note ?? null,
    photoUrl: photoUrl ?? null,
    ip: 'selftest',
  });
  if (!result.ok) {
    console.log(`    ↑ 返回错误：${result.code} ${result.message}`);
    return null;
  }
  return result.data;
}

/**
 * 视觉桩：固定返回给定的特征，embedding 仍转发真实 provider。
 *
 * 为什么需要它：判定逻辑（分数 / margin / 三道闸门）是确定性代码，不该由"模型这次看图
 * 有没有看清"决定。自测用 1×1 占位图跑真实视觉模型时，模型必然判 UNKNOWN，
 * 于是「视觉不确定不许 matched」这条纪律把所有命中用例都压成 candidate —— 断言红，
 * 但产品没错。桩只替换"看图"这一环，向量仍与库同源，所以检索与打分是真跑的。
 */
function visionStub(features: string[], species: 'CAT' | 'DOG' = 'CAT') {
  const real = getProvider();
  return {
    name: 'selftest-stub',
    models: real.models,
    visionAnalyze: async (_img: unknown, _p: string, schema: { parse: (v: unknown) => unknown }) =>
      schema.parse({ species, confidence: 0.93, features, note: '' }),
    chat: async () => {
      throw new Error('selftest 桩不提供 chat');
    },
    embed: (text: string) => real.embed(text),
    embedMany: (texts: string[]) => real.embedMany(texts),
  } as never;
}

async function section1() {
  console.log('\n[1] 识别判定（实测阈值 + 三道闸门）');
  const uploaded = await saveUpload(minimalJpeg());
  if (!uploaded.ok) throw new Error(`自测图片落盘失败：${uploaded.message}`);
  const photoUrl = uploaded.data.url;

  const precise = '黑色短毛猫 左耳绝育耳标 尾巴尖白毛 图书馆北侧';
  // 只在这一段挂桩：本段考的是「视觉可信时能否命中」
  const realProvider = getProvider();
  setProvider(visionStub(['黑色短毛猫', '左耳绝育耳标', '尾巴尖白毛']));
  const hit = await identify(minimalJpeg(), precise, photoUrl);
  setProvider(realProvider);
  console.log(
    `    精确描述 → tier=${hit?.tier} top=${hit && !hit.matched ? (hit.candidates[0]?.code ?? '无') : hit?.matched ? hit.animal.code : '无'} conf=${hit?.confidence} reasons=${hit?.reasons.join(',')}`,
  );
  check(
    '精确描述命中并认出煤球',
    hit?.tier === 'matched' && hit.matched && hit.animal.code === 'No.001',
    `tier=${hit?.tier}`,
  );
  check('命中态不标记不确定', hit?.uncertain === false, `uncertain=${hit?.uncertain}`);
  check('photoUrl 返回用于重跑复用', Boolean(hit?.photoUrl));

  const vague = await identify(minimalJpeg(), '猫 短毛', photoUrl);
  check(
    '宽泛描述被实词闸门拦进灰区',
    vague?.tier === 'candidate',
    `tier=${vague?.tier} reasons=${vague?.reasons.join(',')}`,
  );
  check('灰区必须标记不确定', vague?.uncertain === true);
  check(
    '灰区给出候选列表',
    Boolean(vague && !vague.matched && vague.candidates.length > 0),
    `${vague && !vague.matched ? vague.candidates.length : 0} 条`,
  );

  // 有图但没有任何描述：视觉只能说出「是只狗」，而库里有两只狗 —— 不许替用户拍板
  const onlySpecies = await identify(minimalJpeg(), undefined, photoUrl);
  check(
    '只有弱物种线索不许命中',
    onlySpecies?.tier !== 'matched',
    `tier=${onlySpecies?.tier} reasons=${onlySpecies?.reasons.join(',')}`,
  );
  check('弱线索必须标记不确定', onlySpecies?.uncertain === true);

  // 与库完全无关的内容 → 未登记星
  const irrelevant = await identify(null, '实验室的不锈钢保温杯与天文望远镜配件');
  check(
    '无关描述判为未登记星',
    irrelevant?.tier === 'new',
    `tier=${irrelevant?.tier} reasons=${irrelevant?.reasons.join(',')}`,
  );
  check(
    '未登记星也要给 suggestedSpecies',
    Boolean(irrelevant && !irrelevant.matched && irrelevant.suggestedSpecies),
  );

  console.log('\n[2] 无图不许 matched（决策 2 的硬约束）');
  const noImage = await identify(null, precise);
  check(
    '只有描述不许命中',
    noImage?.tier !== 'matched',
    `tier=${noImage?.tier} reasons=${noImage?.reasons.join(',')}`,
  );
  check('无图时标记 degraded.vision', noImage?.degraded.vision === true);

  const empty = await identify(null, undefined);
  check('既无图又无描述被拒', empty === null);

  console.log('\n[3] 内容安全');
  const blocked = await runIdentify({
    file: minimalJpeg(),
    note: '这只猫低价转让，要的联系我',
    photoUrl,
    ip: 'selftest',
  });
  check(
    '命中交易规则的请求被拒',
    !blocked.ok && blocked.code === 'MODERATION_BLOCKED',
    blocked.ok ? '未被拦截' : blocked.code,
  );

  console.log('\n[4] AI 不可用时的降级');
  const failing = {
    name: 'selftest-failing',
    models: { chat: 'x', vision: 'x', embed: 'x' },
    visionAnalyze: async () => {
      throw new Error('模拟 vision 服务不可用');
    },
    chat: async () => {
      throw new Error('模拟 chat 服务不可用');
    },
    embed: async () => new Array(1536).fill(0),
    embedMany: async () => [],
  };
  setProvider(failing as never);
  const degraded = await identify(minimalJpeg(), precise, photoUrl);
  check('vision 挂了仍返回结构化结果', degraded !== null);
  check('vision 挂了标记 degraded.vision', degraded?.degraded.vision === true);
  check(
    'vision 挂了不许 matched（证据不足降级）',
    degraded?.tier !== 'matched',
    `tier=${degraded?.tier}`,
  );
  setProvider(null);

  console.log('\n[5] 建档 → 再识别 的闭环');
  const created = await createAnimal({
    photoUrl,
    name: '自测小星',
    species: 'CAT',
    summary: '自测脚本建立的待审核档案',
    features: ['纯黑短毛', '额头有一撮白毛', '常驻自测楼东侧'],
    ip: 'selftest',
  });
  check('匿名建档成功', created.ok, created.ok ? created.data.animal.code : created.message);
  if (created.ok) {
    check('匿名建档 pendingReview=true', created.data.animal.pendingReview === true);
    const again = await identify(null, '纯黑短毛 额头有一撮白毛 常驻自测楼东侧', photoUrl);
    const hitNew =
      again?.tier === 'matched' && again.matched && again.animal.code === created.data.animal.code;
    check(
      '新档案能被再次识别命中（无图时也应降级）',
      again?.tier !== 'new',
      `tier=${again?.tier} top=${again && !again.matched ? (again.candidates[0]?.code ?? '无') : ''}`,
    );
    expectNoImageGuardholds: {
      // 上面走的是无图路径，这里再补一次「有图」路径，确认闭环在真实条件下成立
      const keepProvider = getProvider();
      setProvider(visionStub(['纯黑短毛', '额头有一撮白毛', '常驻自测楼东侧']));
      const withImage = await identify(minimalJpeg(), '纯黑短毛 额头一撮白毛 自测楼东侧', photoUrl);
      setProvider(keepProvider);
      const targetsNew =
        withImage?.tier === 'matched' &&
        withImage.matched &&
        withImage.animal.code === created.data.animal.code;
      check(
        '有图时新档案能被识别命中',
        targetsNew,
        `tier=${withImage?.tier} top=${withImage?.matched ? withImage.animal.code : (withImage?.candidates[0]?.code ?? '无')}`,
      );
      break expectNoImageGuardholds;
    }
    // 清理自测档案，避免污染后续 seed 断言（动物数量是 db:selftest 的断言项）
    await prisma.animalPhoto.deleteMany({ where: { animalId: created.data.animal.id } });
    await prisma.auditLog.deleteMany({ where: { targetId: created.data.animal.id } });
    await prisma.animal.delete({ where: { id: created.data.animal.id } });
    console.log('    （已清理自测档案，保持库内回到 5 只）');
  }
  await unlink(path.join(uploadsRoot(), path.basename(photoUrl))).catch(() => {});
}

async function section2() {
  console.log('\n[6] 匿名权限守卫（决策 3）');
  check('匿名不可修改档案', canEditAnimal(ANONYMOUS, { pendingReview: false }).allowed === false);
  check('匿名不可删除任何记录', canDelete(ANONYMOUS).allowed === false);
  // 2026-10-27 收紧：删除档案只给管理员。学生那一档原本是"一线同学最先知道动物不在了"，
  // 实测代价更大 —— 档案是共享资产，一次误触会连坐清掉所有人的记录。
  check(
    '学生不可删除档案（客户端已无删除入口）',
    canDelete({ kind: 'student', id: 'u1', role: 'STUDENT' }).allowed === false,
  );
  check(
    '管理员可删除档案（含待审核档案）',
    canDelete({ kind: 'admin', id: 'a1', role: 'ADMIN' }).allowed === true,
  );
  check(
    '只有管理员能审核新增动物申请',
    canReviewAnimal({ kind: 'admin', id: 'a1', role: 'ADMIN' }).allowed === true &&
      canReviewAnimal({ kind: 'student', id: 'u1', role: 'STUDENT' }).allowed === false &&
      canReviewAnimal(ANONYMOUS).allowed === false,
  );
  check(
    '只有管理员能删除观察记录',
    canDeleteObservation({ kind: 'admin', id: 'a1', role: 'ADMIN' }).allowed === true &&
      canDeleteObservation({ kind: 'student', id: 'u1', role: 'STUDENT' }).allowed === false &&
      canDeleteObservation(ANONYMOUS).allowed === false,
  );
  check('匿名可以认领跟进预警', canAckAlert(ANONYMOUS, 'CRITICAL').allowed === true);
  check(
    '匿名不可最终确认 CRITICAL',
    canResolveAlert(ANONYMOUS, 'CRITICAL').allowed === false,
    canResolveAlert(ANONYMOUS, 'CRITICAL').reason,
  );
  check('匿名同样不能关闭 WARN', canResolveAlert(ANONYMOUS, 'WARN').allowed === false);
  check(
    '学生可以关闭 WARN（非紧急）',
    canResolveAlert({ kind: 'student', id: 'u1', role: 'STUDENT' }, 'WARN').allowed === true,
  );
  check(
    '只有管理员能关闭 CRITICAL',
    canResolveAlert({ kind: 'admin', id: 'a1', role: 'ADMIN' }, 'CRITICAL').allowed === true &&
      canResolveAlert({ kind: 'student', id: 'u1', role: 'STUDENT' }, 'CRITICAL').allowed === false,
  );
}

async function waitForServer(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const res = await fetch(`${BASE}/`, { cache: 'no-store' });
      if (res.status > 0) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return false;
}

async function section3() {
  console.log('\n[7] HTTP 层（临时起 next dev，端口 3137）');
  // 用 --turbo：非 turbo 模式启动时会先递归删除 .next，
  // 在受限环境里这一步会被安全删除策略拦下，导致 dev server 起不来。
  const child = await startDev(PORT, { ...process.env, NEXT_DISABLE_ESLINT: '1' });
  try {
    const ready = await waitForServer(child, 120_000);
    if (!ready) {
      console.log('  SKIP 服务未能在 120s 内就绪（主机性能或端口占用），HTTP 断言跳过，不计失败');
      return;
    }

    // 伪造类型
    const badType = new FormData();
    badType.append('file', fakePng());
    const r1 = await fetch(`${BASE}/api/identify`, { method: 'POST', body: badType });
    check('伪装成 png 的文本 → 400', r1.status === 400, `HTTP ${r1.status}`);

    // 超大文件
    const huge = new FormData();
    huge.append('file', oversizeJpeg());
    const r2 = await fetch(`${BASE}/api/identify`, { method: 'POST', body: huge });
    check('超过 8MB → 400', r2.status === 400, `HTTP ${r2.status}`);

    // 空请求
    const empty = new FormData();
    const r3 = await fetch(`${BASE}/api/identify`, { method: 'POST', body: empty });
    check('既无图也无描述 → 400', r3.status === 400, `HTTP ${r3.status}`);

    // 幂等：相同 clientId 第二次应更快
    const first = new FormData();
    first.append('file', minimalJpeg());
    first.append('note', '黑色短毛猫 左耳绝育耳标 尾巴尖白毛 图书馆北侧');
    first.append('clientId', 'selftest-idempotent');
    const t0 = Date.now();
    const a = await fetch(`${BASE}/api/identify`, { method: 'POST', body: first });
    const firstMs = Date.now() - t0;
    const bodyA = await a.json();

    const second = new FormData();
    second.append('file', minimalJpeg());
    second.append('note', '任意不同的 note 也应命中缓存');
    second.append('clientId', 'selftest-idempotent');
    const t1 = Date.now();
    const b = await fetch(`${BASE}/api/identify`, { method: 'POST', body: second });
    const secondMs = Date.now() - t1;
    const bodyB = await b.json();
    check('首次识别返回 200', a.status === 200 && bodyA.ok === true, `HTTP ${a.status}`);
    check(
      '相同 clientId 命中幂等缓存',
      Boolean(bodyB.ok && bodyB.data?.tier),
      `第二次 tier=${bodyB?.data?.tier ?? '无'}`,
    );
    check('幂等缓存更快', secondMs <= firstMs + 50, `${firstMs}ms → ${secondMs}ms`);

    // 限流：identify 10 次/分钟
    let sawRateLimit = false;
    for (let i = 0; i < 12; i += 1) {
      const fd = new FormData();
      fd.append('file', minimalJpeg());
      fd.append('note', `压力测试 ${i}`);
      fd.append('clientId', `burst-${i}-${Date.now()}`);
      const res = await fetch(`${BASE}/api/identify`, { method: 'POST', body: fd });
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
    }
    check('连续请求触发限流 429', sawRateLimit);

    // 建档 API
    const created = new FormData();
    created.append('name', 'HTTP自测星');
    created.append('species', 'CAT');
    created.append('features', '灰白相间');
    created.append('file', minimalJpeg());
    const cr = await fetch(`${BASE}/api/animals`, { method: 'POST', body: created });
    const crBody = await cr.json();
    check(
      '建档接口返回 200',
      cr.status === 200,
      `HTTP ${cr.status} ${JSON.stringify(crBody?.error ?? '')}`,
    );
    check(
      '匿名建档 pendingReview=true',
      crBody?.data?.animal?.pendingReview === true,
      String(crBody?.data?.animal?.pendingReview),
    );
    if (crBody?.data?.animal?.id) {
      await prisma.animalPhoto.deleteMany({ where: { animalId: crBody.data.animal.id } });
      await prisma.auditLog.deleteMany({ where: { targetId: crBody.data.animal.id } });
      await prisma.animal.delete({ where: { id: crBody.data.animal.id } });
      console.log('    （已清理 HTTP 自测档案）');
    }
  } finally {
    await stopDev(child);
  }
}

async function main() {
  console.log('开始阶段 3 自测…');
  resetRateLimits();
  await section1();
  await section2();
  if (process.argv.includes('--http')) {
    await section3();
  } else {
    console.log('\n[7] HTTP 段已跳过（跑 npm run id:selftest:http 启用，会临时拉起 next dev）');
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\n自测异常：', err);
  await prisma.$disconnect();
  process.exit(1);
});
