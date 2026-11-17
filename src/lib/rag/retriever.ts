import { getEmbedding } from '@/lib/ai/embeddings';
import { searchChunksByEmbedding, searchKnowledgeByEmbedding } from '@/lib/db/vector';
import { prisma } from '@/lib/db';
import { buildCitation, type Citation } from './citations';
import { emphasisOf, keywordDetail, titleKey, contentTokens } from './keyword';
import {
  RAG_ABS_MIN,
  RAG_PER_DOC_MAX,
  RAG_REL_MIN,
  RAG_TOP_K,
} from '@/lib/constants';
import type { PrismaClient } from '@prisma/client';

/**
 * 一条被引用的「段」。RAG 的检索与引用粒度是段而不是篇（A1 决策）：
 * 引用写成《外伤处理 · 第 2 段》，用户核对时不用在整篇里自己找。
 */
export interface RetrievedPassage {
  chunkId: string;
  docId: string;
  title: string;
  source: string;
  /** 段在篇内序号（0 起），前端展示为 index + 1 */
  index: number;
  text: string;
  score: number;
  /**
   * 与 top1 的差距不足 RAG_REL_MIN —— 检索器分不出高下。
   * 此时两条都保留并如实标注，由前端显示「两条资料都相关」，
   * 而不是假装其中一条更权威。
   */
  tied: boolean;
}

/** 排序用的内部字段，不对外 */
interface Candidate extends Omit<RetrievedPassage, 'tied'> {
  hitLen: number;
  titleHit: boolean;
  /** 篇级分数救回来的：段级分不够，但整篇明显相关 */
  rescued: boolean;
}

export interface RetrieveResult {
  passages: RetrievedPassage[];
  /** 发生了什么降级：doc_rescue:N —— 段级检索没过线、靠整篇分捞回来的段数 */
  degraded: string[];
}

export interface RetrieveDeps {
  db?: PrismaClient;
  embed?: (text: string) => Promise<number[]>;
}

/** 先用向量粗召回这么多条，再做关键词融合重排 */
const RECALL_MULTIPLIER = 4;
const MIN_RECALL = 20;
/**
 * 问句整词提到篇名时的加分（《猫瘟（FPV）…》→ 问到「猫瘟」）。
 *
 * 为什么是整词包含而不是 token 加权：把篇名拆成 token 参与加权会让
 * 「校园」这类通用词把不相关的篇顶上来（见 keyword.emphasisOf 的注释）。
 * 整词包含要求用户真的说出了这一篇的主题词，是强得多的信号。
 */
const TITLE_BOOST = 0.15;

/**
 * 关键词兜底召回：把问句的 2-gram token 拿去对段文本做 contains，命中即进候选。
 * 只负责"捞"，分数仍由 scoreHit 的关键词覆盖率算法给出，避免两套打分口径。
 * 仅在向量路径一段都没过闸门时调用（见调用处注释）。
 */
async function keywordRecall(
  db: PrismaClient,
  question: string,
  take: number,
): Promise<Array<{ chunkId: string; docId: string; index: number; text: string; score: number }>> {
  const tokens = [...contentTokens(question)]
    .filter((t) => t.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
  if (!tokens.length) return [];
  const rows = await db.knowledgeChunk.findMany({
    where: { OR: tokens.map((t) => ({ text: { contains: t } })) },
    take: take * 2,
    select: { id: true, docId: true, index: true, text: true },
  });
  return rows.map((r) => ({
    chunkId: r.id,
    docId: r.docId,
    index: r.index,
    text: r.text,
    score: 0,
  }));
}

/**
 * 知识库检索：段级向量粗召回 → 关键词（标题/小标题加权）融合 → 篇级兜底 → 双轨闸门。
 *
 * 三条设计取舍：
 * 1. **融合取 max 而非加权平均**：真实 embedding 的余弦分（0.7+）与关键词覆盖率
 *    不在同一量纲，取最大值在两种 Provider 下都稳定；
 * 2. **篇级分用于兜底**：一条要点被切得太碎时段级分偏低，此时整篇分若明显相关
 *    就把该篇最好的一段捞回来（记 degraded），避免"明明有资料却说没有"；
 * 3. **闸门是双轨的**：ABS_MIN 挡无关，REL_MIN 判并列（只挡分数、不删条目）。
 *
 * 检索为空时返回空数组，由调用方走兜底话术，不允许编造内容。
 */
export async function retrieveKnowledgeWithMeta(
  question: string,
  limit = RAG_TOP_K,
  deps: RetrieveDeps = {},
): Promise<RetrieveResult> {
  const db = deps.db ?? prisma;
  const embed = deps.embed ?? getEmbedding;
  const recall = Math.max(limit * RECALL_MULTIPLIER, MIN_RECALL);

  const embedding = await embed(question);
  const [chunkHits, docHits] = await Promise.all([
    searchChunksByEmbedding(db, embedding, recall),
    searchKnowledgeByEmbedding(db, embedding, recall),
  ]);

  // 篇信息：标题/出处用于引用卡，content 用于算篇级分与抽取小标题
  const docIds = new Set<string>([
    ...chunkHits.map((c) => c.docId),
    ...docHits.map((d) => d.id),
  ]);
  const docs =
    docIds.size > 0
      ? await db.knowledgeDoc.findMany({
          where: { id: { in: [...docIds] } },
          select: { id: true, title: true, content: true, source: true },
        })
      : [];
  const docMap = new Map(docs.map((d) => [d.id, d]));
  const docVecScore = new Map(docHits.map((d) => [d.id, d.score]));

  const candidates: Candidate[] = [];

  // 问句里直接点名了某一篇（如「猫瘟…」）→ 该篇所有段都加分
  const boosted = new Set(
    docs.filter((d) => question.includes(titleKey(d.title))).map((d) => d.id),
  );

  /** 把一条段命中打成候选：向量分与关键词分取 max，再叠加篇名整词加分 */
  const scoreHit = (
    row: { chunkId: string; docId: string; index: number; text: string; score: number },
    doc: { title: string; content: string; source: string },
  ): Candidate => {
    const emphasis = emphasisOf(doc.content);
    const detail = keywordDetail(question, `${doc.title}\n${row.text}`, emphasis);
    const boost = boosted.has(row.docId) ? TITLE_BOOST : 0;
    return {
      chunkId: row.chunkId,
      docId: row.docId,
      title: doc.title,
      source: doc.source,
      index: row.index,
      text: row.text,
      score: Math.max(row.score, detail.score) + boost,
      hitLen: detail.hitLen,
      titleHit: detail.titleHit,
      rescued: false,
    };
  };

  for (const hit of chunkHits) {
    const doc = docMap.get(hit.docId);
    if (!doc) continue;
    candidates.push(scoreHit(hit, doc));
  }

  // 篇级兜底：整篇分明显相关时，保证该篇至少有一段进候选
  let rescued = 0;
  for (const doc of docs) {
    const vec = docVecScore.get(doc.id);
    if (vec === undefined) continue;
    const emphasis = emphasisOf(doc.content);
    const boost = boosted.has(doc.id) ? TITLE_BOOST : 0;
    const docScore =
      Math.max(vec, keywordDetail(question, `${doc.title}\n${doc.content}`, emphasis).score) + boost;
    if (docScore < RAG_ABS_MIN) continue;

    const own = candidates
      .filter((c) => c.docId === doc.id)
      .sort((a, b) => b.score - a.score);
    const best = own[0];
    if (!best || best.score >= docScore) continue;
    // 段级分低于篇级分 → 用篇级分把这一段抬进来
    best.score = docScore;
    best.rescued = true;
    rescued += 1;
  }

  /** 过滤 → 排序 → 同篇限流 → 取前 limit 条 */
  const pick = (list: Candidate[]): Candidate[] => {
    const kept = list
      .filter((c) => c.score >= RAG_ABS_MIN)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.hitLen - a.hitLen ||
          Number(b.titleHit) - Number(a.titleHit) ||
          a.chunkId.localeCompare(b.chunkId),
      );
    // 同一篇最多贡献 RAG_PER_DOC_MAX 段：否则一篇长文会占满全部引用位
    const perDoc = new Map<string, number>();
    const out: Candidate[] = [];
    for (const c of kept) {
      const used = perDoc.get(c.docId) ?? 0;
      if (used >= RAG_PER_DOC_MAX) continue;
      perDoc.set(c.docId, used + 1);
      out.push(c);
      if (out.length >= limit) break;
    }
    return out;
  };

  let selected = pick(candidates);
  let kwRecalled = 0;

  /*
   * 关键词兜底召回（2026-10-27）。
   *
   * 向量召回是 top-N 截断（recall = 20 段）。语料从 5 篇扩到 16 篇、110 段之后，
   * 「猫打喷嚏怎么办」的 top-20 里可能一条相关段都没有 —— 于是整条链路走到
   * 「资料里没写」，而知识库里明明有《呼吸道感染》这一篇。
   * 这里的取舍：只有当**向量路径一段都没过闸门**时，才按 token 做一次 contains 扫描。
   * 一是不会改变已有命中的排序（宁可不动现有的分，也不引入新的并列）；
   * 二是百量级段表全表扫代价可忽略，语料涨到万级再换 pg_trgm / 专用搜索引擎。
   */
  if (!selected.length) {
    const extra = await keywordRecall(db, question, recall);
    if (extra.length) {
      const missing = [...new Set(extra.map((r) => r.docId))].filter((id) => !docMap.has(id));
      if (missing.length) {
        const more = await db.knowledgeDoc.findMany({
          where: { id: { in: missing } },
          select: { id: true, title: true, content: true, source: true },
        });
        for (const d of more) docMap.set(d.id, d);
      }
      for (const row of extra) {
        const doc = docMap.get(row.docId);
        if (!doc) continue;
        candidates.push(scoreHit(row, doc));
      }
      selected = pick(candidates);
      kwRecalled = selected.length;
    }
  }

  const top = selected[0]?.score ?? 0;
  const passages: RetrievedPassage[] = selected.map((c) => ({
    chunkId: c.chunkId,
    docId: c.docId,
    title: c.title,
    source: c.source,
    index: c.index,
    text: c.text,
    score: Number(c.score.toFixed(3)),
    tied: top - c.score < RAG_REL_MIN,
  }));

  const degraded: string[] = [];
  if (rescued) degraded.push(`doc_rescue:${rescued}`);
  if (kwRecalled) degraded.push(`kw_recall:${kwRecalled}`);

  return { passages, degraded };
}

export async function retrieveKnowledge(
  question: string,
  limit = RAG_TOP_K,
  deps: RetrieveDeps = {},
): Promise<RetrievedPassage[]> {
  return (await retrieveKnowledgeWithMeta(question, limit, deps)).passages;
}

/** 检索 + 生成带引用的回答所需的全部上下文 */
export async function buildRagContext(
  question: string,
): Promise<{ passages: RetrievedPassage[]; citations: Citation[] }> {
  const { passages } = await retrieveKnowledgeWithMeta(question);
  // 引用号从 1 开始：prompt 里片段编号是 [1]，这里必须与之对齐
  return { passages, citations: passages.map((p, i) => buildCitation(p, i + 1)) };
}

/** 档案侧检索：按编号/名字/特征找动物（RAG 的「档案查询」分支） */
export async function searchAnimals(keyword: string, limit = 5) {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  return prisma.animal.findMany({
    where: {
      OR: [
        { code: { contains: trimmed, mode: 'insensitive' } },
        { name: { contains: trimmed, mode: 'insensitive' } },
        { summary: { contains: trimmed, mode: 'insensitive' } },
      ],
    },
    take: limit,
    orderBy: { createdAt: 'asc' },
  });
}
