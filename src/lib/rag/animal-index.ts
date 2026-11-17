import { prisma } from '@/lib/db';
import { loadWhereabouts, EMPTY_WHEREABOUTS, type Whereabouts } from '@/lib/animals/whereabouts';
import type { PrismaClient } from '@prisma/client';

/**
 * 档案这一路索引（RAG 的第二路）。
 *
 * 为什么不能只用向量：把 `searchAnimalsByEmbedding` 当"问某只猫"的检索器会出两类错 ——
 * 1. 「校园里那只橘猫最近怎么样」会把**相似但另一只**猫的档案当依据
 *    （识别链路的 SCORE_MARGIN_MIN 就是为同一个问题加的）；
 * 2. 未核实的观察（`pendingReview = true`）混进引用，等于把"有人这么说"当事实。
 *
 * 所以档案路先做**实体解析**：编号 / 名字 / 特征词做精确或包含匹配，
 * 命中即取该档案全文；向量只留给"模糊描述找动物"的场景。
 */

export interface AnimalRef {
  id: string;
  code: string;
  name: string;
  summary: string | null;
}

export type MatchBy = 'animalId' | 'code' | 'name' | 'feature' | 'none';

export interface ResolvedAnimal {
  /** 唯一命中才有值。命中多只时这里为 null，只给候选 */
  animal: AnimalRef | null;
  candidates: AnimalRef[];
  matchedBy: MatchBy;
}

export interface AnimalFact {
  id: string;
  content: string;
  at: string;
}

export interface AnimalContext extends ResolvedAnimal {
  /** 可被引用的已核实观察（pendingReview = false） */
  facts: AnimalFact[];
  /** 最新一条已核实观察的正文，用于引用卡片的片段 */
  latestNote: string | null;
  /** 「平时在哪活动」：与图鉴「常见位置」同一算法（lib/animals/whereabouts） */
  whereabouts: Whereabouts;
}

export interface AnimalIndexDeps {
  db?: PrismaClient;
}

/** 编号形如 No.001 */
const CODE_RE = /No\.\d{2,3}/i;

/**
 * 从问题里解析出"在问哪只动物"。
 *
 * 命中多只时**列候选不猜**：把另一只猫的档案当成这只的答案，
 * 是 RAG 里最危险的一类错误 —— 它看起来言之凿凿。
 */
export async function resolveAnimalRef(
  input: { animalId?: string | null; question: string },
  deps: AnimalIndexDeps = {},
): Promise<ResolvedAnimal> {
  const db = deps.db ?? prisma;

  if (input.animalId) {
    const found = await db.animal.findUnique({
      where: { id: input.animalId },
      select: { id: true, code: true, name: true, summary: true },
    });
    if (found) return { animal: found, candidates: [found], matchedBy: 'animalId' };
    // animalId 无效时不静默退回关键词：调用方需要知道"你指定的那只不存在"
    return { animal: null, candidates: [], matchedBy: 'none' };
  }

  const q = input.question;
  const code = q.match(CODE_RE)?.[0];
  if (code) {
    const found = await db.animal.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
      select: { id: true, code: true, name: true, summary: true },
    });
    if (found) return { animal: found, candidates: [found], matchedBy: 'code' };
  }

  // 名字 / 特征词：拿全量档案做包含匹配。档案量是校园级的（几十只），
  // 全表扫比"先猜一个分词再查"可靠得多 —— 中文没有空格，分词错一次就全错。
  const all = await db.animal.findMany({
    select: { id: true, code: true, name: true, summary: true, features: true },
  });

  const byName = all.filter((a) => a.name.length >= 2 && q.includes(a.name));
  if (byName.length === 1) {
    const { features: _f, ...ref } = byName[0];
    return { animal: ref, candidates: [ref], matchedBy: 'name' };
  }
  if (byName.length > 1) {
    return {
      animal: null,
      candidates: byName.map(({ features: _f, ...r }) => r),
      matchedBy: 'name',
    };
  }

  const byFeature = all.filter((a) => a.features.some((f) => f.length >= 2 && q.includes(f)));
  if (byFeature.length === 1) {
    const { features: _f, ...ref } = byFeature[0];
    return { animal: ref, candidates: [ref], matchedBy: 'feature' };
  }
  if (byFeature.length > 1) {
    return {
      animal: null,
      candidates: byFeature.map(({ features: _f, ...r }) => r),
      matchedBy: 'feature',
    };
  }

  return { animal: null, candidates: [], matchedBy: 'none' };
}

/**
 * 取档案里**可以当依据**的记录。
 *
 * `pendingReview = true` 的观察一律不进引用：它是"有人这么说"，不是事实。
 * 这些记录照常出现在档案页（那里有明确的待核实标记），只是不能作为回答的依据。
 */
export async function loadAnimalContext(
  input: { animalId?: string | null; question: string },
  deps: AnimalIndexDeps = {},
): Promise<AnimalContext> {
  const db = deps.db ?? prisma;
  const resolved = await resolveAnimalRef(input, deps);

  if (!resolved.animal) {
    return { ...resolved, facts: [], latestNote: null, whereabouts: EMPTY_WHEREABOUTS };
  }

  const [rows, whereabouts] = await Promise.all([
    db.observation.findMany({
      where: { animalId: resolved.animal.id, pendingReview: false },
      select: { id: true, content: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    loadWhereabouts(resolved.animal.id, deps),
  ]);

  const facts: AnimalFact[] = rows.map((r) => ({
    id: r.id,
    content: r.content,
    at: r.createdAt.toISOString(),
  }));

  return { ...resolved, facts, latestNote: facts[0]?.content ?? null, whereabouts };
}
