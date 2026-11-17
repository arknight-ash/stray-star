/**
 * 数据库自检：确认「建表 + pgvector + 种子 + 检索」这条链路真的通。
 * 用法：npm run db:selftest
 */
import '../src/lib/load-env';
import { prisma } from '../src/lib/db';
import { retrieveKnowledge, searchAnimals } from '../src/lib/rag/retriever';
import { searchAnimalsByEmbedding, searchKnowledgeByEmbedding } from '../src/lib/db/vector';
import { embedForRetrieval } from '../src/lib/identify/fingerprint';
import {
  boundingBoxOf,
  haversineMeters,
  isInsideBox,
  readCampusCenter,
  readCampusRadiusM,
  type LatLng,
} from '../src/lib/geo';
import { CAMPUS_FOOTPRINT, isInsideCampusFootprint } from '../src/lib/map-config';
import { KNOWLEDGE } from '../prisma/seed/knowledge';

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('\n[1] 种子数据完整性');
  const [animals, seedObservations, userObservations, knowledge, alerts, users] = await Promise.all([
    prisma.animal.count(),
    // 只数种子行：用户在页面上提交的观察同样落 this 表，把用户数据算进"种子完整性"是错的
    prisma.observation.count({ where: { seedKey: { not: null } } }),
    prisma.observation.count({ where: { seedKey: null } }),
    prisma.knowledgeDoc.count(),
    prisma.alert.count(),
    prisma.user.count(),
  ]);
  check('动物 5 只', animals === 5, `实际 ${animals}`);
  check(
    '种子观察 15 条',
    seedObservations === 15,
    `实际 ${seedObservations}（另有用户提交 ${userObservations} 条，不计入）`,
  );
  // 语料数量与种子文件对齐：2026-10-27 从 5 篇扩到 16 篇，写死数字会再次过期
  check(
    `护理知识 ${KNOWLEDGE.length} 篇`,
    knowledge === KNOWLEDGE.length,
    `实际 ${knowledge}（种子 ${KNOWLEDGE.length} 篇）`,
  );
  check('预警 1 条', alerts === 1, `实际 ${alerts}`);
  check('用户 3 个', users === 3, `实际 ${users}`);

  // 阶段 7 迁移的两条断言（R11：改 schema 必须补断言）
  const seedAlert = await prisma.alert.findFirst({
    where: { seedKey: { not: null } },
    select: { source: true },
  });
  check(
    '种子预警的触发来源已回填（Alert.source 迁移生效）',
    seedAlert?.source === 'HEALTH_REPORT',
    String(seedAlert?.source),
  );
  const manualSevere = await prisma.observation.count({ where: { manualSevere: true } });
  check('历史观察的「手动标记」默认 false', manualSevere === 0, `实际 ${manualSevere}`);

  console.log('\n[2] pgvector 字段可用');
  const dims = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT vector_dims(embedding)::int AS n FROM "KnowledgeDoc" LIMIT 1
  `;
  check('知识库 embedding 为 1536 维', dims[0]?.n === 1536, `实际 ${dims[0]?.n}`);

  console.log('\n[3] 向量检索真的能召回');
  const raw = await searchKnowledgeByEmbedding(
    prisma,
    await embedForRetrieval('猫瘟有什么症状，怎么识别'),
    5,
  );
  console.log(
    '    原始分数：',
    raw.map((h) => `${h.title}=${h.score.toFixed(3)}`).join(' | ') || '无',
  );
  const hit = await retrieveKnowledge('猫瘟有什么症状，怎么识别', 3);
  check('检索有命中', hit.length > 0, `top1=${hit[0]?.title ?? '无'}`);
  check('命中内容与问题相关', /猫瘟|FPV/.test(hit[0]?.title ?? ''), hit[0]?.title ?? '无');
  const care = await retrieveKnowledge('流浪猫绝育后怎么护理', 3);
  check(
    '同义改写也能命中正确篇目',
    /绝育|TNR/.test(care[0]?.title ?? ''),
    `top1=${care[0]?.title ?? '无'}`,
  );

  const missRaw = await searchKnowledgeByEmbedding(
    prisma,
    await embedForRetrieval('如何用天文望远镜观测猎户座星云'),
    3,
  );
  console.log(
    '    无关查询原始分数：',
    missRaw.map((h) => `${h.title}=${h.score.toFixed(3)}`).join(' | ') || '无',
  );
  const miss = await retrieveKnowledge('如何用天文望远镜观测猎户座星云', 3);
  check('无关问题低分不召回（不编造）', miss.length === 0, `命中 ${miss.length} 条`);

  console.log('\n[4] 个体向量检索');
  const target = await prisma.animal.findFirst({ where: { code: 'No.001' } });
  if (!target) throw new Error('缺 No.001，先跑 npm run db:seed');
  const byVec = await searchAnimalsByEmbedding(prisma, await embedForRetrieval(target.summary ?? ''), 3);
  check('用自身特征能检索到自己', byVec[0]?.id === target.id, `top1=${byVec[0]?.code ?? '无'}`);

  console.log('\n[5] 档案关键字检索');
  const byName = await searchAnimals('煤球');
  check('按名字能查到档案', byName.some((a) => a.code === 'No.001'), `${byName.length} 条`);

  console.log('\n[6] 照片表与识别链路可用性（阶段 3 契约要求检索 AnimalPhoto）');
  // Prisma 不认识 Unsupported("vector") 字段，IS NOT NULL 一律走 raw SQL
  const withVec = await prisma.$queryRaw<Array<{ id: string; code: string }>>`
    SELECT "id", "code" FROM "Animal" WHERE "embedding" IS NOT NULL ORDER BY "code"
  `;
  const photoRows = await prisma.$queryRaw<Array<{ animalId: string; cnt: number }>>`
    SELECT "animalId", count(*)::int AS cnt
    FROM "AnimalPhoto"
    WHERE "animalId" IS NOT NULL AND "embedding" IS NOT NULL
    GROUP BY "animalId"
  `;
  const photoCount = new Map(photoRows.map((r) => [r.animalId, r.cnt]));
  const missingPhoto = withVec.filter((a) => !photoCount.get(a.id));
  check(
    '每个有 embedding 的个体至少有 1 张带向量的照片',
    withVec.length > 0 && missingPhoto.length === 0,
    `有向量 ${withVec.length} 只，缺照片 ${missingPhoto.map((a) => a.code).join(',') || '无'}`,
  );

  console.log('\n[7] 校园中心必须落在点位包围盒内');
  const points = (await prisma.animal.findMany({ select: { code: true, mapLat: true, mapLng: true } }))
    .filter((a): a is { code: string; mapLat: number; mapLng: number } => a.mapLat != null && a.mapLng != null)
    .map<LatLng>((a) => ({ lat: a.mapLat, lng: a.mapLng }));
  const box = boundingBoxOf(points);
  const center = readCampusCenter();
  const radiusM = readCampusRadiusM();
  console.log(
    `    中心 ${center.lat},${center.lng}｜包围盒 lat[${box?.minLat},${box?.maxLat}] lng[${box?.minLng},${box?.maxLng}]｜围栏 ${radiusM}m`,
  );
  check('种子点位足以算出包围盒', box !== null, `${points.length} 个点位`);
  if (box) {
    check(
      '中心落在点位包围盒内（否则首页星图会是空白视野）',
      isInsideBox(center, box),
      `中心 ${center.lat},${center.lng}`,
    );
    const distances = points.map((p) => haversineMeters(center, p));
    const worst = Math.max(...distances);
    console.log(`    最远点位距离 ${worst.toFixed(0)}m`);
    check(`中心到每个点位 ≤ ${radiusM}m`, worst <= radiusM, `最远 ${worst.toFixed(0)}m`);
  }

  console.log('\n[8] 种子点位必须落在校园四至内（2026-10-27 按真实 POI 标定）');
  const outsideAnimals = (
    await prisma.animal.findMany({ select: { code: true, name: true, mapLat: true, mapLng: true } })
  ).filter((a) => a.mapLat == null || a.mapLng == null || !isInsideCampusFootprint(a.mapLat, a.mapLng));
  check(
    '每只动物的档案坐标都在校园围墙内',
    outsideAnimals.length === 0,
    outsideAnimals.map((a) => `${a.code} ${a.name}`).join(', ') ||
      `四至 lat[${CAMPUS_FOOTPRINT.south},${CAMPUS_FOOTPRINT.north}] lng[${CAMPUS_FOOTPRINT.west},${CAMPUS_FOOTPRINT.east}]`,
  );
  const seedObsOutside = await prisma.observation.count({
    where: {
      seedKey: { not: null },
      OR: [
        { mapLat: null },
        { mapLng: null },
        { mapLat: { lt: CAMPUS_FOOTPRINT.south } },
        { mapLat: { gt: CAMPUS_FOOTPRINT.north } },
        { mapLng: { lt: CAMPUS_FOOTPRINT.west } },
        { mapLng: { gt: CAMPUS_FOOTPRINT.east } },
      ],
    },
  });
  check('种子观察的坐标都在校园围墙内', seedObsOutside === 0, `越界 ${seedObsOutside} 条`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\n数据库自检异常：', err);
  await prisma.$disconnect();
  process.exit(1);
});
