import type { PrismaClient } from '@prisma/client';
import { toVectorLiteral } from '../../src/lib/db/vector';
import { embedForRetrieval, fingerprintText } from '../../src/lib/identify/fingerprint';
import { ANIMALS, type AnimalSeed } from './animals';

/**
 * 种子照片：给每只动物补 1 张带向量的 AnimalPhoto。
 *
 * 为什么必须补：阶段 3 契约要求「识别时检索 AnimalPhoto」，
 * 而此前 AnimalPhoto 是 0 行 —— 按它检索必然 100% 判成「未登记星」。
 *
 * 幂等：AnimalPhoto 无唯一约束，按 (animalId, url) 先查后写，重复播种不翻倍。
 */
export async function seedPhotos(prisma: PrismaClient, animalIds: Map<string, string>) {
  let created = 0;
  let reused = 0;

  for (const a of ANIMALS) {
    const animalId = animalIds.get(a.code);
    if (!animalId) {
      console.warn(`  ! 跳过照片（找不到动物 ${a.code}）`);
      continue;
    }

    const url = `/animals/${a.code}.svg`;
    const existing = await prisma.animalPhoto.findFirst({ where: { animalId, url } });

    // 与运行时同一向量出口：embedForRetrieval → provider.embed（失败自动降级本地哈希）
    const embedding = await embedForRetrieval(photoFingerprintText(a));

    if (existing) {
      await prisma.$executeRaw`UPDATE "AnimalPhoto" SET "embedding" = ${toVectorLiteral(
        embedding,
      )}::vector WHERE "id" = ${existing.id}`;
      reused += 1;
      continue;
    }

    const photo = await prisma.animalPhoto.create({
      data: { animalId, url, confidence: 1, pendingReview: false },
    });
    await prisma.$executeRaw`UPDATE "AnimalPhoto" SET "embedding" = ${toVectorLiteral(
      embedding,
    )}::vector WHERE "id" = ${photo.id}`;
    created += 1;
  }

  console.log(`✓ 种子照片：新建 ${created} 张，复用 ${reused} 张（含 embedding）`);
}

/**
 * 照片侧指纹文本。
 * 刻意与 animalEmbeddingText 保持一致的核心特征（毛色/标记/位置），
 * 这样「用归档照片检索」与「用个体特征检索」两条路在同一语义空间里可比。
 */
function photoFingerprintText(a: AnimalSeed): string {
  return fingerprintText({
    speciesLabel: a.species === 'CAT' ? '猫' : '狗',
    features: a.features,
  });
}
