import type { RetrievedPassage } from './retriever';

/**
 * 一条引用。
 *
 * `kind` 分三路，对应问答可用的三种依据：知识库（段）、动物档案（个体）、
 * 本地数据库（统计口径）。前端都渲染成同一颗「星图标注」，
 * 但三者不能混称 —— 把一条统计说成"资料里写的"是在冒充来源。
 */
export interface Citation {
  /** 引用号，对应正文里的 [n] */
  seq: number;
  kind: 'knowledge' | 'animal' | 'database';
  /** 卡片标题：篇名 或 动物名 */
  title: string;
  /** 片段：段首要点 或 档案摘要/最新记录 */
  snippet: string;
  /** 出处：手册名 或 档案编号 */
  source: string;
  score: number;
  /** 与 top1 并列：前端如实展示「两条资料都相关」 */
  tied: boolean;
  /** 可跳转的目标（档案页）；知识库引用没有落点 */
  href?: string;

  // —— 知识库引用专有 ——
  docId?: string;
  chunkId?: string;
  /** 段序号（0 起）。展示为「第 chunkIndex + 1 段」 */
  chunkIndex?: number;

  // —— 档案引用专有 ——
  animalId?: string;
  animalCode?: string;

  // —— 数据库引用专有：命中的是哪一类统计 ——
  dbTopic?: string;
}

/** 展示用：段序号转人类可读（0 → 「第 1 段」） */
export function chunkLabel(index: number): string {
  return `第 ${index + 1} 段`;
}

function firstSentence(text: string, fallback: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? fallback;
  const clean = line.replace(/^【[^】]*】/, '').trim();
  return clean.length > 120 ? `${clean.slice(0, 120)}…` : clean || fallback;
}

/** 知识库段 → 引用。seq 由编排层按 prompt 里的编号指定 */
export function buildCitation(passage: RetrievedPassage, seq = 0): Citation {
  return {
    seq,
    kind: 'knowledge',
    title: passage.title,
    snippet: firstSentence(passage.text, passage.title),
    source: passage.source,
    score: passage.score,
    tied: passage.tied,
    docId: passage.docId,
    chunkId: passage.chunkId,
    chunkIndex: passage.index,
  };
}

export interface AnimalCitationInput {
  id: string;
  code: string;
  name: string;
  summary: string | null;
  /** 最新一条已核实的观察正文；没有则退回 summary */
  latestNote?: string | null;
}

/** 动物档案 → 引用。档案是"事实"而不是"资料"，分数恒为 1（命中即命中） */ export function buildAnimalCitation(
  animal: AnimalCitationInput,
  seq: number,
): Citation {
  const snippet = animal.latestNote?.trim() || animal.summary?.trim() || '还没有任何记录';
  return {
    seq,
    kind: 'animal',
    title: animal.name,
    snippet: snippet.length > 120 ? `${snippet.slice(0, 120)}…` : snippet,
    source: animal.code,
    score: 1,
    tied: false,
    href: `/animals/${animal.code}`,
    animalId: animal.id,
    animalCode: animal.code,
  };
}

/**
 * 数据库统计 → 引用。
 *
 * 与档案引用一样，它不进模型的引用白名单：答案是本地算出来的，
 * 模型没有"选"它。source 写清口径来源，用户能分辨"这是统计"而不是"资料里写的"。
 */
export function buildDatabaseCitation(
  input: { topic: string; facts: string[]; answer: string },
  seq: number,
): Citation {
  const facts = input.facts.length
    ? input.facts.slice(0, 3).join('；')
    : input.answer.slice(0, 120);
  return {
    seq,
    kind: 'database',
    title: '本地数据库',
    snippet: facts.length > 120 ? `${facts.slice(0, 120)}…` : facts,
    source: '按档案与记录实时统计',
    score: 1,
    tied: false,
    dbTopic: input.topic,
  };
}
