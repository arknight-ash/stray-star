import { existsSync } from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { toVectorLiteral } from '../../src/lib/db/vector';
import { embedForRetrieval, fingerprintText } from '../../src/lib/identify/fingerprint';
import { ANIMALS, type AnimalSeed } from './animals';

/** 与 seed.ts 同一目录口径：占位 SVG 和真实照片都落在这里 */
const PUBLIC_ANIMALS = path.join(process.cwd(), 'public', 'animals');

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
  let upgraded = 0;

  for (const a of ANIMALS) {
    const animalId = animalIds.get(a.code);
    if (!animalId) {
      console.warn(`  ! 跳过照片（找不到动物 ${a.code}）`);
      continue;
    }

    // 与 seedAnimals 同一口径：有真实照片（No.00X.jpg）就写真照片，没有才回落占位 SVG。
    // 2026-11-18 修：这里原先把占位 SVG 写进了 AnimalPhoto.url，导致管理员「预警照片」
    // 墙和任何读 photos[0] 的地方都只见到灰底占位图。
    const placeholderUrl = `/animals/${a.code}.svg`;
    const url = existsSync(path.join(PUBLIC_ANIMALS, `${a.code}.jpg`))
      ? `/animals/${a.code}.jpg`
      : placeholderUrl;

    let existing = await prisma.animalPhoto.findFirst({ where: { animalId, url } });

    // 老库修补：url 指到占位图的那一行原地改成真实照片。不删旧行再加新行，
    // 否则 photos[0]（按 createdAt 升序）仍会先命中先建出来的占位图。
    if (!existing && url !== placeholderUrl) {
      const stale = await prisma.animalPhoto.findFirst({
        where: { animalId, url: placeholderUrl },
      });
      if (stale) {
        existing = await prisma.animalPhoto.update({
          where: { id: stale.id },
          data: { url },
        });
        upgraded += 1;
      }
    }

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

  console.log(
    `✓ 种子照片：新建 ${created} 张，复用 ${reused} 张，占位图升级 ${upgraded} 张（含 embedding）`,
  );
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
