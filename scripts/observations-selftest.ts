/**
 * 众包观察自检（第 4 阶段欠账，2026-10-25 补齐）。
 * 用法：npm run obs:selftest      —— 直连数据库 + mock Provider
 *       npm run obs:http:selftest —— 额外起一个 next dev（--turbo）跑真实 HTTP 链路
 *
 * 覆盖 docs/stage-4-profile.md §7 里承诺、但此前没有回归保护的部分：
 * `photo` 上传、`type` / `lat` / `lng` 真正落库、围栏校验、抽标签失败的降级、
 * 未核实观察不参与派生、以及「观察 + 升档」的事务回滚。
 *
 * 测试数据全部带 `TEST:OBS:` 前缀，跑完清掉自己产生的行 —— 不碰任何用户/种子数据。
 */
import '../src/lib/load-env';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { startDev, stopDev } from './lib/dev-server';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Prisma } from '@prisma/client';
import { getProvider } from '../src/lib/ai';
import { createObservation, type ObservationDeps } from '../src/lib/observations/create';
import { loadTimeline } from '../src/lib/db/timeline';
import { removeUploadUrls, sweepOrphanUploads } from './lib/uploads-cleanup';
import { readCampusCenter } from '../src/lib/geo';
import { prisma } from '../src/lib/db';

/**
 * 落点从当前校园中心派生，不写死经纬度。
 *
 * 曾经这里写着上海交大那组坐标；校园一换（武汉华夏理工学院光谷校区），围栏校验就会
 * 把"显式 type / 坐标落库 / 带图提交"整组用例打成 FAIL —— 而失败原因是测试自己过时，
 * 不是代码坏了。围栏是业务规则，测试必须跟着 CAMPUS 走。
 */
const CAMPUS = readCampusCenter();
const NEAR_LAT = Number((CAMPUS.lat + 0.0001).toFixed(6));
const NEAR_LNG = Number((CAMPUS.lng + 0.0002).toFixed(6));

/**
 * 与 health 自检同一条纪律：把 Provider 钉死成 mock，断言不得依赖 `.env` / 网络。
 * （`getProvider` 懒加载 + 缓存，import 求值完后设置即生效）
 */
process.env.AI_PROVIDER = 'mock';

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

/** 最小合法 JPEG：uploads 只嗅前几字节，够用 */
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

const MILD_TEXT = '晚 7 点喂了半碗，吃得挺香';
const SEVERE_TEXT = '右后肢有外伤，一直在流血，也不吃东西';
/** 既无健康信息也无行为的纯目击：AI 应判 OTHER，且该类记录不挂「待核实」 */
const NEUTRAL_TEXT = '在草坪上远远看见它走过';

async function main() {
  console.log('\n[0] 运行前置');
  const provider = getProvider();
  check('Provider 被钉死为 mock（不受 .env / 网络影响）', provider.name === 'mock', provider.name);

  const created: string[] = [];
  const stamp = Date.now().toString(36);

  async function newAnimal(tag: string, healthLevel: 'GREEN' | 'RED' = 'GREEN') {
    const animal = await prisma.animal.create({
      data: {
        name: `测试猫·观察 ${tag}`,
        code: `TEST:OBS:${tag}-${stamp}`,
        species: 'CAT',
        healthLevel,
      },
      select: { id: true, code: true },
    });
    created.push(animal.id);
    return animal;
  }

  console.log('\n[1] 正常创建（分类/标签/严重度全部来自 AI 解析）');
  const a = await newAnimal('A');
  const first = await createObservation({ animalCode: a.code, content: MILD_TEXT, ip: '127.0.0.1' });
  check('创建成功', first.ok === true, first.ok ? '' : first.message);
  if (!first.ok) throw new Error(first.message);

  check('AI 解析生效（source=ai）', first.data.tagsSource === 'ai', first.data.tagsSource);
  check('AI 判定分类为投喂', first.data.observation.type === 'FEEDING', first.data.observation.type);
  check('……且这类记录仍待核实', first.data.observation.pendingReview === true);
  check('展示名兜底为「匿名同学」', first.data.observation.authorName === '匿名同学');
  check('AI 抽取标签非空', first.data.observation.tags.length > 0,
    first.data.observation.tags.join('/'));
  check('AI 判定情感（轻松/平静）',
    first.data.analysis.sentiment === 'POSITIVE' || first.data.analysis.sentiment === 'NEUTRAL',
    first.data.analysis.sentiment);
  check('AI 给出置信度', first.data.analysis.confidence > 0, String(first.data.analysis.confidence));
  check('success toast 带编号', first.data.toast.includes(a.code), first.data.toast);

  // 2026-10-27 的需求保留：判为「其他」的记录入库即正式，不再挂「待核实」——
  // 这类记录没有健康结论可核，挂着黄标只会把真正待核实的健康上报淹掉。
  // 2026-10-28 起这个判定也由 AI 给（用户不再手选分类）。
  const asOther = await createObservation({ animalCode: a.code, content: NEUTRAL_TEXT, ip: '127.0.0.1' });
  check('AI 判「其他」→ 入库即正式',
    asOther.ok && asOther.data.observation.type === 'OTHER' && asOther.data.observation.pendingReview === false,
    asOther.ok ? `${asOther.data.observation.type}/${asOther.data.observation.pendingReview}` : asOther.message);

  const audit = await prisma.auditLog.findFirst({
    where: { action: 'OBSERVATION_CREATE', targetId: a.id },
    orderBy: { createdAt: 'desc' },
    select: { actorId: true, payload: true },
  });
  check('审计记录匿名 actor', audit?.actorId === null);

  console.log('\n[2] 契约字段真的落库（AI 判定的 type / lat / lng / imageUrl）');
  const b = await newAnimal('B');
  const withFields = await createObservation({
    animalCode: b.code,
    content: SEVERE_TEXT,
    lat: NEAR_LAT,
    lng: NEAR_LNG,
    imageUrl: '/uploads/00000000-0000-0000-0000-000000000000.jpg',
  });
  check('AI 判定的 type 落库（外伤 → HEALTH）',
    withFields.ok && withFields.data.observation.type === 'HEALTH',
    withFields.ok ? withFields.data.observation.type : '');
  if (withFields.ok) {
    const row = await prisma.observation.findUnique({
      where: { id: withFields.data.observation.id },
      select: { mapLat: true, mapLng: true, imageUrl: true, type: true },
    });
    check('坐标写入 mapLat/mapLng', row?.mapLat === NEAR_LAT && row?.mapLng === NEAR_LNG,
      `${row?.mapLat},${row?.mapLng}`);
    check('图片地址写入 imageUrl', row?.imageUrl === '/uploads/00000000-0000-0000-0000-000000000000.jpg');
  }

  console.log('\n[2.5] 带图 / 无图提交：数据要能一路走到便签墙');
  // 便签墙与时间线都从 loadTimeline 取数；图片必须跟着条目一起出来，
  // 否则 UI 的 imageUrl 永远是 null，"无图展示"就成了唯一可能。
  const bTimeline = await loadTimeline(b.id, { createdAt: new Date(), features: [] });
  const imgEntry = withFields.ok
    ? bTimeline.find((e) => e.id === `OBSERVATION:${withFields.data.observation.id}`)
    : undefined;
  check('带图提交：时间线条目带 imageUrl',
    imgEntry?.imageUrl === '/uploads/00000000-0000-0000-0000-000000000000.jpg',
    String(imgEntry?.imageUrl));

  const aTimeline = await loadTimeline(a.id, { createdAt: new Date(), features: [] });
  const textEntry = aTimeline.find((e) => e.id === `OBSERVATION:${first.data.observation.id}`);
  check('纯文字提交：imageUrl 为 null（界面不渲染图片位）', textEntry?.imageUrl === null,
    String(textEntry?.imageUrl));

  console.log('\n[3] 围栏校验');
  const before = await prisma.observation.count({ where: { animalId: b.id } });
  const outside = await createObservation({
    animalCode: b.code,
    content: MILD_TEXT,
    lat: 31.5,
    lng: 121.9,
  });
  check('围栏外坐标 → BAD_REQUEST', outside.ok === false && outside.code === 'BAD_REQUEST',
    outside.ok ? '竟然通过了' : outside.code);
  check('……且不落库', (await prisma.observation.count({ where: { animalId: b.id } })) === before);

  console.log('\n[4] 未知编号');
  const missing = await createObservation({ animalCode: 'TEST:OBS:NOPE', content: MILD_TEXT });
  check('不存在的编号 → NOT_FOUND', missing.ok === false && missing.code === 'NOT_FOUND');

  console.log('\n[5] 内容安全');
  const blocked = await createObservation({ animalCode: b.code, content: '怎么毒死这只猫比较好' });
  check('虐待描述 → MODERATION_BLOCKED', blocked.ok === false && blocked.code === 'MODERATION_BLOCKED',
    blocked.ok ? '竟然通过了' : blocked.code);
  check('……且不落库', (await prisma.observation.count({ where: { animalId: b.id } })) === before);

  console.log('\n[6] 抽标签失败：正文照存、标签兜底、不碰健康档');
  const c = await newAnimal('C');
  // 注入点：AI 入口整体失败。生产代码永远不传 deps。
  const failingRun = (async () => ({
    ok: false,
    error: 'AI_UNAVAILABLE',
    provider: 'mock',
    message: '注入的 Provider 故障（自测）',
  })) as unknown as NonNullable<ObservationDeps['run']>;

  const degraded = await createObservation({ animalCode: c.code, content: MILD_TEXT }, { run: failingRun });
  check('标签降级为 fallback', degraded.ok && degraded.data.tagsSource === 'fallback');
  check('标签兜底 [未分类]', degraded.ok && degraded.data.observation.tags.join('/') === '未分类',
    degraded.ok ? degraded.data.observation.tags.join('/') : '');
  check('类型退回 OTHER', degraded.ok && degraded.data.observation.type === 'OTHER');
  check('解析失败的记录必待核实（没有结论可核，但要有眼睛）',
    degraded.ok && degraded.data.observation.pendingReview === true);
  check('正文仍然存下来了', degraded.ok && degraded.data.observation.content === MILD_TEXT);
  const cAfterFallback = await prisma.animal.findUnique({ where: { id: c.id }, select: { healthLevel: true } });
  check('抽标签失败不改健康档', cAfterFallback?.healthLevel === 'GREEN', cAfterFallback?.healthLevel);

  console.log('\n[7] 未核实的观察不参与派生');
  const d = await newAnimal('D');
  const severe = await createObservation({ animalCode: d.code, content: SEVERE_TEXT });
  check('mock 判为 SEVERE', severe.ok && severe.data.observation.severity === 'SEVERE',
    severe.ok ? severe.data.observation.severity : '');
  check('仍是待核实', severe.ok && severe.data.observation.pendingReview === true);
  const dRow = await prisma.animal.findUnique({ where: { id: d.id }, select: { healthLevel: true } });
  check('未核实 → 档案档位不变（原则 3）', dRow?.healthLevel === 'GREEN', dRow?.healthLevel);
  check('响应里 healthChanged=false', severe.ok && severe.data.animal.healthChanged === false);

  console.log('\n[8] 预警地板与事务回滚');
  // 原则 4：有 OPEN 的 CRITICAL 时，哪怕只是一条普通观察，档位也不低于红
  const e = await newAnimal('E');
  await prisma.alert.create({
    data: {
      animalId: e.id,
      level: 'CRITICAL',
      reason: '自测用：未处理的紧急预警',
      dedupeKey: `SELFTEST_OBS_FLOOR:${e.id}`,
    },
  });
  const floored = await createObservation({ animalCode: e.code, content: MILD_TEXT });
  check('OPEN 预警是地板：档位被抬到 RED', floored.ok && floored.data.animal.healthLevel === 'RED',
    floored.ok ? floored.data.animal.healthLevel : '');
  check('……且 healthChanged=true', floored.ok && floored.data.animal.healthChanged === true);
  check('……原因写的是预警地板', floored.ok && floored.data.animal.healthReason.includes('预警'),
    floored.ok ? floored.data.animal.healthReason : '');

  // 回滚：观察写完之后、升档那一步失败。用真事务 + Proxy 只让 animal.update 抛错，
  // 验证的是数据库真的回滚了，而不是「我们以为它会回滚」。
  const f = await newAnimal('F');
  await prisma.alert.create({
    data: {
      animalId: f.id,
      level: 'CRITICAL',
      reason: '自测用：未处理的紧急预警',
      dedupeKey: `SELFTEST_OBS_ROLLBACK:${f.id}`,
    },
  });
  const sabotagedTransact: NonNullable<ObservationDeps['transact']> = (fn) =>
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

  const rolled = await createObservation(
    { animalCode: f.code, content: MILD_TEXT },
    { transact: sabotagedTransact },
  );
  check('写入失败 → INTERNAL（不假装成功）', rolled.ok === false && rolled.code === 'INTERNAL',
    rolled.ok ? '竟然返回成功' : rolled.code);
  check('事务回滚：观察没有残留', (await prisma.observation.count({ where: { animalId: f.id } })) === 0);
  const fRow = await prisma.animal.findUnique({ where: { id: f.id }, select: { healthLevel: true } });
  check('事务回滚：档位仍是 GREEN', fRow?.healthLevel === 'GREEN', fRow?.healthLevel);

  console.log('\n[9] 清理测试数据');
  for (const id of created) {
    await prisma.animal.delete({ where: { id } }).catch(() => undefined);
  }
  console.log(`  已清理 ${created.length} 只测试动物`);
}

async function httpMode() {
  console.log('\n[10] HTTP 链路');
  const { spawn } = await import('node:child_process');
  const port = 3314;
  // 直接指向本地 next 的 bin：沙箱里 npx 解析不到，--turbo 是本环境下唯一能起来的模式
  const proc = await startDev(port);

  const base = `http://127.0.0.1:${port}`;
  const createdAssets: string[] = [];
  const createdAnimals: string[] = [];
  const stamp = Date.now().toString(36);

  try {
    await waitFor(`${base}/`, 90_000);

    const animal = await prisma.animal.create({
      data: { name: '测试猫·观察 H', code: `TEST:OBS:H-${stamp}`, species: 'CAT' },
      select: { id: true, code: true },
    });
    createdAnimals.push(animal.id);

    // JSON 通道：便签墙（RecordBar）一直在用，不能被 multipart 改造打断
    const jsonRes = await fetch(`${base}/api/observations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ animalCode: animal.code, content: MILD_TEXT, clientId: `obs-json-${stamp}` }),
    });
    const jsonBody = await jsonRes.json();
    check('JSON 提交仍然可用（向后兼容）', jsonRes.status === 200 && jsonBody?.ok === true, String(jsonRes.status));
    check('JSON 结果待核实', jsonBody?.data?.observation?.pendingReview === true);

    // 幂等：同 clientId 再打一次，必须是同一条
    const idemRes = await fetch(`${base}/api/observations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ animalCode: animal.code, content: MILD_TEXT, clientId: `obs-json-${stamp}` }),
    });
    const idemBody = await idemRes.json();
    check('同 clientId 幂等（同一条记录）',
      idemBody?.data?.observation?.id === jsonBody?.data?.observation?.id,
      String(idemBody?.data?.observation?.id));

    const dir = await mkdtemp(join(tmpdir(), 'obs-http-'));
    const file = join(dir, 'shot.jpg');
    await writeFile(file, fakeJpegBytes());

    // multipart + 真 JPEG
    const form = new FormData();
    form.set('animalCode', animal.code);
    form.set('content', '拍了张照片，右后腿有点跛');
    form.set('lat', String(NEAR_LAT));
    form.set('lng', String(NEAR_LNG));
    form.set('clientId', `obs-photo-${stamp}`);
    form.set('photo', new Blob([await readFile(file)]), 'shot.jpg');

    const photoRes = await fetch(`${base}/api/observations`, { method: 'POST', body: form });
    const photoBody = await photoRes.json();
    check('multipart + 图片 → 200', photoRes.status === 200 && photoBody?.ok === true, String(photoRes.status));
    check('图片落库为可访问的站内地址', typeof photoBody?.data?.observation?.imageUrl === 'string' &&
      photoBody.data.observation.imageUrl.startsWith('/uploads/'), String(photoBody?.data?.observation?.imageUrl));
    check('AI 判定的分类生效（跛 → 健康）', photoBody?.data?.observation?.type === 'HEALTH',
      photoBody?.data?.observation?.type);
    check('带图提交时 AI 真的看了图', photoBody?.data?.analysis?.withImage === true,
      String(photoBody?.data?.analysis?.withImage));
    if (photoBody?.data?.observation?.imageUrl) createdAssets.push(photoBody.data.observation.imageUrl);

    // 伪造图片：txt 改名 jpg，必须 400 且不留文件
    const fakeForm = new FormData();
    fakeForm.set('animalCode', animal.code);
    fakeForm.set('content', '这是一段文本，不是图片');
    fakeForm.set('photo', new Blob(['not an image at all']), 'fake.jpg');
    const fakeRes = await fetch(`${base}/api/observations`, { method: 'POST', body: fakeForm });
    const fakeBody = await fakeRes.json();
    check('伪造图片 → 400', fakeRes.status === 400, String(fakeRes.status));
    check('……错误信息说明只支持图片格式',
      String(fakeBody?.error?.message ?? '').includes('JPEG'), String(fakeBody?.error?.message));

    // 围栏外坐标
    const outForm = new FormData();
    outForm.set('animalCode', animal.code);
    outForm.set('content', MILD_TEXT);
    outForm.set('lat', '40.0');
    outForm.set('lng', '116.4');
    const outRes = await fetch(`${base}/api/observations`, { method: 'POST', body: outForm });
    check('围栏外坐标 → 400', outRes.status === 400, String(outRes.status));

    // 空正文
    const emptyForm = new FormData();
    emptyForm.set('animalCode', animal.code);
    emptyForm.set('content', '   ');
    const emptyRes = await fetch(`${base}/api/observations`, { method: 'POST', body: emptyForm });
    check('空正文 → 400', emptyRes.status === 400, String(emptyRes.status));

    await rm(dir, { recursive: true, force: true });
  } finally {
    await stopDev(proc);
    for (const id of createdAnimals) {
      await prisma.animal.delete({ where: { id } }).catch(() => undefined);
    }
    // 接口把图片落到了 public/uploads —— 用完即删。
    // 只按"响应回传的 URL"删会漏（preview/重试分支也会写盘），末尾以数据库引用为准兜一遍孤儿。
    const removed = await removeUploadUrls(createdAssets);
    const swept = await sweepOrphanUploads(prisma);
    if (createdAssets.length || swept) {
      console.log(
        `  已清理 ${removed}/${createdAssets.length} 张登记图、${swept} 张孤儿图与 ${createdAnimals.length} 只测试动物`,
      );
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
