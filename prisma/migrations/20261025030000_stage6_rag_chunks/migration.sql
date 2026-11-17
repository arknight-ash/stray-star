-- 阶段 6 RAG：知识库切块落库 + 向量索引补齐
--
-- 切块表让检索与引用的粒度从「篇」下沉到「段」：
--   · 段级向量对只出现在某一条要点里的关键词（如「止血」）命中率明显更高；
--   · 引用可以写成《外伤处理 · 第 2 段》，用户核对时不用在整篇里自己找。
-- 详见 docs/stage-6-rag.md §0①。

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" vector(1536),

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_docId_idx" ON "KnowledgeChunk"("docId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_docId_index_key" ON "KnowledgeChunk"("docId", "index");

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_docId_fkey" FOREIGN KEY ("docId") REFERENCES "KnowledgeDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 向量索引：此前 KnowledgeDoc / Animal / AnimalPhoto 上都没有向量索引，
-- 相似度查询走的是全表扫。5 行数据时无感，文档量上来就是 O(n) 的余弦计算。
-- 用 hnsw + vector_cosine_ops：与查询里的 <=> 运算符一致，否则索引不会被用上。
-- 注意：只建在非空向量较多的表上有意义；NULL 不进索引，不影响正确性。
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_embedding_hnsw" ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "KnowledgeDoc_embedding_hnsw" ON "KnowledgeDoc" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "Animal_embedding_hnsw" ON "Animal" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "AnimalPhoto_embedding_hnsw" ON "AnimalPhoto" USING hnsw ("embedding" vector_cosine_ops);
