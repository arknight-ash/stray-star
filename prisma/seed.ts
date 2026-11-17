/**
 * 种子脚本：pnpm db:seed / npm run db:seed
 * 目标：seed 之后「拍照 → 识别 → 档案 → 问答 → 预警」全链路可跑通。
 * 幂等：全表按 seedKey / 唯一键 upsert，**没有任何 deleteMany**。
 * 用户提交的数据 seedKey 恒为 null，重跑多少次都不会被清除（阶段 4 起有真实写入路径）。
 */
import '../src/lib/load-env';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { toVectorLiteral } from '../src/lib/db/vector';
import { embedForRetrieval } from '../src/lib/identify/fingerprint';
import { ANIMALS, animalEmbeddingText, type AnimalSeed } from './seed/animals';
import { KNOWLEDGE } from './seed/knowledge';
import { OBSERVATIONS } from './seed/observations';
import { seedPhotos } from './seed/photos';
import { DEFAULT_PASSWORD, USERS } from './seed/users';

const prisma = new PrismaClient();
const PUBLIC_ANIMALS = path.join(process.cwd(), 'public', 'animals');

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/** 无真实照片素材时生成本地 SVG 物种色卡（不引用外链，离线可跑） */
function avatarSvg(a: AnimalSeed): string {
  const glyph = a.species === 'CAT' ? '猫' : '犬';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="${a.name}">
  <defs>
    <radialGradient id="g" cx="50%" cy="40%" r="70%">
      <stop offset="0%" stop-color="${a.palette}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#131A38" stop-opacity="0.95"/>
    </radialGradient>
  </defs>
  <rect width="160" height="160" fill="#131A38"/>
  <circle cx="80" cy="72" r="46" fill="url(#g)"/>
  <path d="M46 40 L52 16 L74 32 Z" fill="${a.palette}"/>
  <path d="M114 40 L108 16 L86 32 Z" fill="${a.palette}"/>
  <circle cx="64" cy="66" r="4.5" fill="#0B1026"/>
  <circle cx="96" cy="66" r="4.5" fill="#0B1026"/>
  <path d="M72 84 Q80 90 88 84" stroke="#0B1026" stroke-width="3" fill="none" stroke-linecap="round"/>
  <text x="80" y="140" text-anchor="middle" font-family="serif" font-size="30" fill="#FFE3A3">${glyph}</text>
  <text x="80" y="154" text-anchor="middle" font-family="monospace" font-size="10" fill="#9AA3C7">${a.code}</text>
</svg>
`;
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const map = new Map<string, string>();

  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { studentId: u.studentId },
      update: { name: u.name, email: u.email, role: u.role, password: passwordHash },
      create: { ...u, password: passwordHash },
    });
    map.set(u.studentId, user.id);
  }

  console.log(`✓ 用户 ${USERS.length} 个（统一密码：${DEFAULT_PASSWORD}）`);
  return map;
}

async function seedAnimals() {
  await mkdir(PUBLIC_ANIMALS, { recursive: true });
  const map = new Map<string, string>();

  for (const a of ANIMALS) {
    const svgPath = `/animals/${a.code}.svg`;
    await writeFile(path.join(PUBLIC_ANIMALS, `${a.code}.svg`), avatarSvg(a), 'utf8');
    // 头像优先用真实照片（No.00X.jpg，2026-10-26 需求）；jpg 不存在时回落 SVG 色卡
    const avatarUrl = existsSync(path.join(PUBLIC_ANIMALS, `${a.code}.jpg`))
      ? `/animals/${a.code}.jpg`
      : svgPath;

    const animal = await prisma.animal.upsert({
      where: { code: a.code },
      update: {
        name: a.name,
        species: a.species,
        healthLevel: a.healthLevel,
        avatarUrl,
        mapLat: a.lat,
        mapLng: a.lng,
        summary: a.summary,
        features: a.features,
        pendingReview: false,
      },
      create: {
        code: a.code,
        name: a.name,
        species: a.species,
        healthLevel: a.healthLevel,
        avatarUrl,
        mapLat: a.lat,
        mapLng: a.lng,
        summary: a.summary,
        features: a.features,
        pendingReview: false,
      },
    });

    // 个体特征 → 向量。必须走 embedForRetrieval（唯一出口）：
    // 这里若直写 hashEmbedding，切换到真实 Provider 后库向量与查询向量不在同一空间，
    // 识别会静默地全部判成「未登记星」。
    const literal = toVectorLiteral(await embedForRetrieval(animalEmbeddingText(a)));
    await prisma.$executeRaw`UPDATE "Animal" SET "embedding" = ${literal}::vector WHERE "id" = ${animal.id}`;
    map.set(a.code, animal.id);
  }

  console.log(`✓ 动物 ${ANIMALS.length} 只（3 猫 2 狗），头像已生成到 public/animals/`);
  return map;
}

/**
 * 众包观察：按 seedKey upsert。
 *
 * 曾经这里是 deleteMany({}) —— 在没有真实写入路径的阶段无所谓，
 * 但阶段 4 起用户会在页面上真提交记录，一次 seed 就把用户数据清空且毫无报错。
 * 现在：种子数据带 seedKey，用户数据 seedKey 恒为 null，**永远不会被 seed 碰到**。
 */
async function seedObservations(animalIds: Map<string, string>, userIds: Map<string, string>) {
  let created = 0;
  for (const [index, o] of OBSERVATIONS.entries()) {
    const animalId = animalIds.get(o.animalCode);
    const userId = userIds.get(o.authorId);
    if (!animalId || !userId) {
      console.warn(`  ! 跳过观察（找不到 ${o.animalCode} / ${o.authorId}）`);
      continue;
    }

    const animal = ANIMALS.find((a) => a.code === o.animalCode)!;
    const seedKey = `SEED:OBS:${o.animalCode}:${index}`;
    // 照片墙演示：标记了 photoForWall 的观察挂上该动物的真实照片
    const data = {
      animalId,
      userId,
      type: o.type,
      content: o.content,
      tags: o.tags,
      severity: o.severity,
      mapLat: animal.lat,
      mapLng: animal.lng,
      imageUrl: o.photoForWall && existsSync(path.join(PUBLIC_ANIMALS, `${o.animalCode}.jpg`))
        ? `/animals/${o.animalCode}.jpg`
        : null,
      createdAt: daysAgo(o.daysAgo),
    };

    await prisma.observation.upsert({
      where: { seedKey },
      update: data,
      create: { ...data, seedKey, pendingReview: false },
    });
    created += 1;
  }

  const userRows = await prisma.observation.count({ where: { seedKey: null } });
  console.log(`✓ 观察 ${created} 条（另有用户提交 ${userRows} 条，未被触碰）`);
}

async function seedKnowledge() {
  for (const k of KNOWLEDGE) {
    // KnowledgeDoc.title 无唯一约束，因此按 title 先查后写，保证重复播种不产生副本
    const existing = await prisma.knowledgeDoc.findFirst({ where: { title: k.title } });
    const doc = existing
      ? await prisma.knowledgeDoc.update({
          where: { id: existing.id },
          data: { content: k.content, source: k.source },
        })
      : await prisma.knowledgeDoc.create({
          data: { title: k.title, content: k.content, source: k.source },
        });
    const literal = toVectorLiteral(await embedForRetrieval(`${k.title}\n${k.content}`));
    await prisma.$executeRaw`UPDATE "KnowledgeDoc" SET "embedding" = ${literal}::vector WHERE "id" = ${doc.id}`;
  }

  console.log(`✓ 护理知识 ${KNOWLEDGE.length} 条，已写入 embedding`);
}

/** 小灰（RED）配套一条未审核的评估报告 + 一条未处理预警，让预警链路开箱可见 */
async function seedAlertAndReport(animalIds: Map<string, string>, userIds: Map<string, string>) {
  const animalId = animalIds.get('No.005');
  const reporterId = userIds.get('20230207');
  if (!animalId || !reporterId) return;

  // 同 observation：按 seedKey upsert，重复播种不产生副本，也不清空任何既有数据
  const assessment =
    '照片与描述显示右后腿存在开放性外伤，周围被毛污染，行走时避用患肢。属需要尽快线下核实并送医的情况。';
  const advice = [
    '避免直接接触伤口，先用干净纱布轻压止血',
    '不要使用人用药膏或口服止痛药',
    '尽快联系校兽医或动保组织安排诱捕送医',
  ];

  await prisma.healthReport.upsert({
    where: { seedKey: 'SEED:REPORT:No.005' },
    update: { severity: 'SEVERE', advice, confidence: 0.66, healthStatus: 'RED', needsVet: true },
    create: {
      animalId,
      seedKey: 'SEED:REPORT:No.005',
      imageUrl: '/animals/No.005.svg',
      assessment,
      severity: 'SEVERE',
      healthStatus: 'RED',
      needsVet: true,
      advice,
      confidence: 0.66,
      disclaimer:
        '本报告由 AI 基于照片与描述生成，仅供参考，不构成兽医诊断。请尽快联系校兽医或当地动保组织处理。',
      reviewedByAdmin: false,
      createdAt: daysAgo(1),
    },
  });

  await prisma.alert.upsert({
    where: { seedKey: 'SEED:ALERT:No.005' },
    update: { level: 'CRITICAL', status: 'OPEN' },
    create: {
      animalId,
      seedKey: 'SEED:ALERT:No.005',
      level: 'CRITICAL',
      reason: '右后腿外伤且连续 2 天精神变差、进食减少，需尽快医疗介入',
      status: 'OPEN',
      createdAt: daysAgo(1),
    },
  });

  console.log('✓ 预警 1 条（CRITICAL / OPEN）+ 待审核评估报告 1 条');
}

async function main() {
  console.log('开始播种智护流浪星…');
  const userIds = await seedUsers();
  const animalIds = await seedAnimals();
  await seedObservations(animalIds, userIds);
  await seedKnowledge();
  await seedPhotos(prisma, animalIds);
  await seedAlertAndReport(animalIds, userIds);
  console.log('播种完成。');
}

main()
  .catch((err) => {
    console.error('播种失败：', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
