import '../src/lib/load-env';
import { getEmbedding } from '../src/lib/ai/embeddings';
import { chunkContent } from '../src/lib/rag/chunk';
import { toVectorLiteral } from '../src/lib/db/vector';
import { AUDIT_ACTIONS, writeAudit } from '../src/lib/db/audit';
import { prisma } from '../src/lib/db';

/**
 * 知识库入库：文档 → 切块 → embed → upsert（幂等）。
 *
 * 幂等规则：段已存在且已有向量时跳过，除非 --force。
 * 因此改一篇文档后重跑是安全的 —— 只有内容变化的段会被重算。
 *
 * 用法：
 *   npm run rag:ingest          增量（只补缺失的向量）
 *   npm run rag:ingest -- --force  全量重算
 */

async function main() {
  const force = process.argv.includes('--force');
  const docs = await prisma.knowledgeDoc.findMany({
    select: { id: true, title: true, content: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!docs.length) {
    console.log('知识库是空的，先跑 npm run db:seed');
    return;
  }

  let created = 0;
  let embedded = 0;
  let skipped = 0;
  let removed = 0;

  for (const doc of docs) {
    const chunks = chunkContent(doc.content);
    if (!chunks.length) {
      console.log(`  ! 《${doc.title}》没有可切块的内容，跳过`);
      continue;
    }

    const existing = await prisma.knowledgeChunk.findMany({
      where: { docId: doc.id },
      select: { id: true, index: true, text: true },
    });
    // embedding 是 Unsupported 字段，Prisma 的 select 拿不到，只能问数据库
    const withVec = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "KnowledgeChunk" WHERE "docId" = ${doc.id} AND "embedding" IS NOT NULL
    `;
    const hasVec = new Set(withVec.map((r) => r.id));
    const byIndex = new Map(existing.map((c) => [c.index, c]));

    // 文档改短后多出来的段要删掉，否则引用会指向已经不存在的文本
    const stale = existing.filter((c) => c.index >= chunks.length);
    if (stale.length) {
      await prisma.knowledgeChunk.deleteMany({
        where: { id: { in: stale.map((c) => c.id) } },
      });
      removed += stale.length;
    }

    for (const chunk of chunks) {
      const prev = byIndex.get(chunk.index);
      const textChanged = !prev || prev.text !== chunk.text;
      const needVector = !prev || !hasVec.has(prev.id);

      let chunkId: string;
      if (!prev) {
        const row = await prisma.knowledgeChunk.create({
          data: { docId: doc.id, index: chunk.index, text: chunk.text },
          select: { id: true },
        });
        chunkId = row.id;
        created += 1;
      } else {
        chunkId = prev.id;
        if (textChanged) {
          await prisma.knowledgeChunk.update({
            where: { id: prev.id },
            data: { text: chunk.text },
          });
        }
      }

      if (!needVector && !textChanged && !force) {
        skipped += 1;
        continue;
      }

      // 嵌入输入带标题：段本身可能只有「保持笼内干燥温暖」，
      // 加上标题才有「这是绝育术后护理」这个语境
      const vec = await getEmbedding(`${doc.title}\n${chunk.text}`);
      await prisma.$executeRaw`
        UPDATE "KnowledgeChunk" SET "embedding" = ${toVectorLiteral(vec)}::vector
        WHERE "id" = ${chunkId}
      `;
      embedded += 1;
    }

    // 整篇向量：段级检索的兜底（一条要点被切碎时段级分会偏低）
    const docHasVec = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::int AS n FROM "KnowledgeDoc"
      WHERE "id" = ${doc.id} AND "embedding" IS NOT NULL
    `;
    if (force || !Number(docHasVec[0]?.n ?? 0)) {
      const vec = await getEmbedding(`${doc.title}\n${doc.content}`);
      await prisma.$executeRaw`
        UPDATE "KnowledgeDoc" SET "embedding" = ${toVectorLiteral(vec)}::vector
        WHERE "id" = ${doc.id}
      `;
    }

    console.log(`  《${doc.title}》→ ${chunks.length} 段`);
  }

  await writeAudit({
    action: AUDIT_ACTIONS.KNOWLEDGE_INGEST,
    targetType: 'KnowledgeDoc',
    actorId: null,
    payload: { docs: docs.length, created, embedded, skipped, removed, force },
  });

  console.log(
    `\n完成：${docs.length} 篇 / 新建段 ${created} / 写入向量 ${embedded} / 跳过 ${skipped} / 清理 ${removed}`,
  );
}

main()
  .catch((err) => {
    console.error('入库失败：', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
