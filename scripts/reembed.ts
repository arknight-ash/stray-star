/**
 * 向量重建：`npm run ai:reembed`（可加 `--only=animal,photo,doc,chunk`，`--dry` 只看不写）
 *
 * 为什么必须有这一步：
 * 库里的向量是**入库那一刻的 Provider** 算出来的。mock 走本地哈希（hashEmbedding），
 * 换到 GLM/OpenAI 之后查询向量换了空间，余弦相似度失去意义 ——
 * 表现是「识别全部判成未登记星」「知识库检索命中乱套」，而且**不报错**（静默劣化）。
 * 所以切换 AI_PROVIDER 之后，必须把四类向量按新 Provider 重算一遍：
 *
 *  - Animal.embedding        个体档案（编号+名字+物种+状态+特征）
 *  - AnimalPhoto.embedding   识别用的视觉指纹（物种+特征）
 *  - KnowledgeDoc.embedding  整篇兜底召回
 *  - KnowledgeChunk.embedding 段级检索与引用
 *
 * 幂等：每次都是覆盖写，跑几次结果一样（同一段文本 → 同一向量）。
 */
import '../src/lib/load-env';
import { prisma } from '../src/lib/db';
import { getProvider } from '../src/lib/ai/registry';
import { getEmbedding } from '../src/lib/ai/embeddings';
import { toVectorLiteral } from '../src/lib/db/vector';
import { fingerprintText } from '../src/lib/identify/fingerprint';

const SPECIES_LABEL = { CAT: '猫', DOG: '狗' } as const;

type Target = 'animal' | 'photo' | 'doc' | 'chunk';

const only = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean) as Target[];
const dry = process.argv.includes('--dry');
const targets = new Set<Target>(only.length ? only : ['animal', 'photo', 'doc', 'chunk']);

async function reembedAnimals(): Promise<number> {
  if (!targets.has('animal')) return 0;
  const animals = await prisma.animal.findMany({
    select: { id: true, code: true, name: true, species: true, summary: true, features: true },
    orderBy: { code: 'asc' },
  });
  let done = 0;
  for (const a of animals) {
    const text = [
      a.code,
      a.name,
      SPECIES_LABEL[a.species],
      a.summary ?? '',
      ...(a.features ?? []),
    ].join(' ');
    const vec = await getEmbedding(text);
    if (!dry) {
      await prisma.$executeRaw`UPDATE "Animal" SET "embedding" = ${toVectorLiteral(vec)}::vector WHERE "id" = ${a.id}`;
    }
    done += 1;
    process.stdout.write(`\r  档案 ${done}/${animals.length}`);
  }
  console.log(`\r  ✓ 档案向量 ${done} 条${dry ? '（dry）' : ''}`);
  return done;
}

async function reembedPhotos(): Promise<number> {
  if (!targets.has('photo')) return 0;
  const photos = await prisma.animalPhoto.findMany({
    select: {
      id: true,
      animal: { select: { species: true, features: true } },
    },
  });
  let done = 0;
  for (const p of photos) {
    // 没有归属的照片（animal 为 null）没有可重建的文本依据，跳过并计数
    if (!p.animal) continue;
    const text = fingerprintText({
      speciesLabel: SPECIES_LABEL[p.animal.species],
      features: p.animal.features ?? [],
    });
    const vec = await getEmbedding(text);
    if (!dry) {
      await prisma.$executeRaw`UPDATE "AnimalPhoto" SET "embedding" = ${toVectorLiteral(vec)}::vector WHERE "id" = ${p.id}`;
    }
    done += 1;
    process.stdout.write(`\r  照片 ${done}/${photos.length}`);
  }
  console.log(`\r  ✓ 照片向量 ${done} 条${dry ? '（dry）' : ''}`);
  return done;
}

async function reembedDocs(): Promise<{ docs: number; chunks: number }> {
  let docs = 0;
  let chunks = 0;

  if (targets.has('doc')) {
    const rows = await prisma.knowledgeDoc.findMany({
      select: { id: true, title: true, content: true },
    });
    for (const d of rows) {
      const vec = await getEmbedding(`${d.title}\n${d.content}`);
      if (!dry) {
        await prisma.$executeRaw`UPDATE "KnowledgeDoc" SET "embedding" = ${toVectorLiteral(vec)}::vector WHERE "id" = ${d.id}`;
      }
      docs += 1;
      process.stdout.write(`\r  文档 ${docs}/${rows.length}`);
    }
    console.log(`\r  ✓ 文档向量 ${docs} 条${dry ? '（dry）' : ''}`);
  }

  if (targets.has('chunk')) {
    const rows = await prisma.knowledgeChunk.findMany({
      select: { id: true, text: true, doc: { select: { title: true } } },
      orderBy: [{ docId: 'asc' }, { index: 'asc' }],
    });
    for (const c of rows) {
      const vec = await getEmbedding(`${c.doc.title}\n${c.text}`);
      if (!dry) {
        await prisma.$executeRaw`UPDATE "KnowledgeChunk" SET "embedding" = ${toVectorLiteral(vec)}::vector WHERE "id" = ${c.id}`;
      }
      chunks += 1;
      process.stdout.write(`\r  段落 ${chunks}/${rows.length}`);
    }
    console.log(`\r  ✓ 段落向量 ${chunks} 条${dry ? '（dry）' : ''}`);
  }

  return { docs, chunks };
}

async function main() {
  const p = getProvider();
  console.log(`Provider = ${p.name}（embed 模型：${p.models.embed}）`);
  if (p.name === 'mock') {
    console.log('当前是 mock Provider —— 重建只会把本地哈希向量再写一遍，没有意义。');
    console.log('请先在 .env 里把 AI_PROVIDER 改成真实厂商再跑。');
    return;
  }

  const t0 = Date.now();
  const animals = await reembedAnimals();
  const photos = await reembedPhotos();
  const { docs, chunks } = await reembedDocs();

  console.log(
    `\n完成：档案 ${animals}、照片 ${photos}、文档 ${docs}、段落 ${chunks}，共 ${
      animals + photos + docs + chunks
    } 条，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s${dry ? '（dry run，未写库）' : ''}`,
  );
}

main()
  .catch((err) => {
    console.error('\n失败：', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
