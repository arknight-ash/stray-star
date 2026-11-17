import type { PrismaClient } from '@prisma/client';
import { EMBEDDING_DIM } from '../constants';

/**
 * pgvector 检索。
 * 说明：Prisma 不认识 vector 类型，因此相似度查询一律走 $queryRaw，
 * 向量用字面量 '[0.1,0.2,...]' 传入（Prisma.sql 会做参数化，这里用 Prisma.raw 拼字面量）。
 */

export function toVectorLiteral(embedding: number[]): string {
  if (embedding.length !== EMBEDDING_DIM) {
    throw new Error(
      `embedding 维度应为 ${EMBEDDING_DIM}，实际 ${embedding.length}。请检查 AI_EMBED_MODEL 是否与库表 vector(${EMBEDDING_DIM}) 一致。`,
    );
  }
  return `[${embedding.join(',')}]`;
}

/** 余弦相似度 = 1 - 余弦距离；越大越相似（0..1） */
export interface AnimalVectorHit {
  id: string;
  code: string;
  name: string;
  species: 'CAT' | 'DOG';
  avatarUrl: string | null;
  healthLevel: 'GREEN' | 'YELLOW' | 'RED';
  pendingReview: boolean;
  summary: string | null;
  /** 个体外观特征：结果页「AI 看到了什么」与关键词路比对都要用 */
  features: string[];
  score: number;
}

export async function searchAnimalsByEmbedding(
  db: PrismaClient,
  embedding: number[],
  limit = 5,
): Promise<AnimalVectorHit[]> {
  const literal = toVectorLiteral(embedding);
  return db.$queryRaw<AnimalVectorHit[]>`
    SELECT "id", "code", "name", "species", "avatarUrl", "healthLevel", "pendingReview",
           "summary", "features",
           1 - ("embedding" <=> ${literal}::vector) AS score
    FROM "Animal"
    WHERE "embedding" IS NOT NULL
    ORDER BY "embedding" <=> ${literal}::vector
    LIMIT ${limit}
  `;
}

/**
 * 检索 AnimalPhoto（阶段 3 识别链路的主检索源）。
 * JOIN Animal 带出个体信息：多次 Supabase/ORM 式分表查询不如一次 JOIN，
 * 且能顺带拿到 healthLevel / pendingReview 用于结果页渲染。
 */
export async function searchPhotosByEmbedding(
  db: PrismaClient,
  embedding: number[],
  limit = 8,
): Promise<Array<AnimalVectorHit & { photoId: string }>> {
  const literal = toVectorLiteral(embedding);
  return db.$queryRaw<Array<AnimalVectorHit & { photoId: string }>>`
    SELECT p."id" AS "photoId", a."id" AS "id", a."code", a."name", a."species",
           a."avatarUrl", a."healthLevel", a."pendingReview", a."summary", a."features",
           1 - (p."embedding" <=> ${literal}::vector) AS score
    FROM "AnimalPhoto" p
    JOIN "Animal" a ON a."id" = p."animalId"
    WHERE p."embedding" IS NOT NULL AND p."animalId" IS NOT NULL
    ORDER BY p."embedding" <=> ${literal}::vector
    LIMIT ${limit}
  `;
}

export interface KnowledgeVectorHit {
  id: string;
  title: string;
  content: string;
  source: string;
  score: number;
}

export async function searchKnowledgeByEmbedding(
  db: PrismaClient,
  embedding: number[],
  limit = 4,
): Promise<KnowledgeVectorHit[]> {
  const literal = toVectorLiteral(embedding);
  return db.$queryRaw<KnowledgeVectorHit[]>`
    SELECT "id", "title", "content", "source",
           1 - ("embedding" <=> ${literal}::vector) AS score
    FROM "KnowledgeDoc"
    WHERE "embedding" IS NOT NULL
    ORDER BY "embedding" <=> ${literal}::vector
    LIMIT ${limit}
  `;
}

export interface KnowledgeChunkHit {
  chunkId: string;
  docId: string;
  title: string;
  source: string;
  /** 段在篇内序号，引用展示为「第 index+1 段」 */
  index: number;
  text: string;
  score: number;
}

/**
 * 段级检索（RAG 的主检索源）。
 * JOIN 带出篇的标题与出处 —— 引用卡片要显示「《外伤处理》第 2 段 · 校兽医室」，
 * 分两次查再在内存里拼，不如一次 JOIN。
 */
export async function searchChunksByEmbedding(
  db: PrismaClient,
  embedding: number[],
  limit = 20,
): Promise<KnowledgeChunkHit[]> {
  const literal = toVectorLiteral(embedding);
  return db.$queryRaw<KnowledgeChunkHit[]>`
    SELECT c."id" AS "chunkId", c."docId", d."title", d."source",
           c."index", c."text",
           1 - (c."embedding" <=> ${literal}::vector) AS score
    FROM "KnowledgeChunk" c
    JOIN "KnowledgeDoc" d ON d."id" = c."docId"
    WHERE c."embedding" IS NOT NULL
    ORDER BY c."embedding" <=> ${literal}::vector
    LIMIT ${limit}
  `;
}

/** 归一化，保证 cosine 距离计算稳定 */
export function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}
