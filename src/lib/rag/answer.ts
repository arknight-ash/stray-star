import {
  DISCLAIMER,
  CONFIDENCE_FLOOR,
  FALLBACK_TEXT,
  RAG_TOP_K,
  UNCERTAIN_NOTE,
} from '../constants';
import { systemFor } from '../ai/prompts';
import { RagAnswerSchema } from '../ai/schemas';
import type { z } from 'zod';
import { runStructured, type StructuredResult } from '../ai/registry';
import { moderateText } from '../safety/moderation';
import { log } from '../logger';
import { AUDIT_ACTIONS, writeAudit } from '../db/audit';
import { prisma } from '../db';
import {
  buildAnimalCitation,
  buildCitation,
  buildDatabaseCitation,
  chunkLabel,
  type Citation,
} from './citations';
import { classifyIntent, type ChatIntent } from './intent';
import { resolveAnimalRef, loadAnimalContext, type AnimalContext } from './animal-index';
import { describeWhereabouts, WHEREABOUTS_RULE } from '@/lib/animals/whereabouts';
import { askDatabase } from '@/lib/insight/ask';
import {
  retrieveKnowledgeWithMeta,
  type RetrievedPassage,
  type RetrieveDeps,
  type RetrieveResult,
} from './retriever';
import type { ChatData, ChatRequest } from '../api/chat-contract';
import type { ErrCode } from '../http';
import type { PrismaClient } from '@prisma/client';

/**
 * 问答编排：意图 → 两路检索 → 拼 prompt → 生成 → 引用白名单 → 兜底。
 *
 * 三条不可动的纪律：
 * 1. **没有依据就不答**。检索为空走兜底话术，不允许模型用常识补齐；
 * 2. **引用必须白名单**。模型返回的 citedDocIds 若不在本次检索结果里，
 *    整条引用丢弃并记 degraded —— 宁可没有引用，也不能指向一个编出来的来源；
 * 3. **失败不留沉默**。模型不可用时返回检索原文并标 uncertain，而不是 503。
 */

export type AnswerOutcome =
  { ok: true; data: ChatData } | { ok: false; code: ErrCode; message: string };

/**
 * 生成器的注入点（自测用）：签名与 runStructured 的入参对齐。
 *
 * 用 `z.input` 而不是 `z.infer`：`RagAnswerSchema` 的 citedDocIds / followUp 带 .default()，
 * output 类型是必填、input 类型是可选；而 `runStructured(req, schema)` 推断出的是 input 侧，
 * 两边不这么说就会在"默认值到底有没有"上类型打架。
 */
export type RagRunner = (req: {
  prompt: string;
  system?: string;
  context?: Record<string, unknown>;
}) => Promise<StructuredResult<z.input<typeof RagAnswerSchema>>>;

export interface AnswerDeps extends RetrieveDeps {
  /** 只影响检索路；档案路共用同一个 db */
  resolveAnimal?: (
    input: { animalId?: string | null; question: string },
    deps?: { db?: PrismaClient },
  ) => Promise<AnimalContext>;
  run?: RagRunner;
  /** 关掉审计，避免自测把审计表写脏 */
  audit?: boolean;
}

/**
 * 引用与「不知道」的口径。
 *
 * 2026-10-27 实测两处误伤，所以这里写成判断顺序，而不是一句「没有就说不知道」：
 *  - 「猫腿瘸了怎么办」检索到了《腿伤、跛行与骨折判断》，模型却因为片段里
 *    写的是「跛行」「不敢着地」而非「瘸」就拒答，且同一问题时而答时而不答；
 *  - 同类问题还有「拉稀/腹泻」「不吃东西/拒食」。
 * 把「先判断是不是同一件事」放在「缺信息就拒答」之前，模型才有稳定的决策依据。
 */
const CITE_RULES = [
  '引用只能写成 [n]，n 必须是上面出现过的编号。',
  '第一步先判断：这些片段讲的是不是用户问的这件事。只要片段里有能用来回答的内容，就正常作答。',
  '同学的口语说法与片段里的学名指同一件事时，按同一件事处理，不要因为用词不同就拒答：' +
    '「瘸」与「跛行」「不敢着地」，「拉稀」与「腹泻」，「不吃东西」与「拒食」，「流鼻涕打喷嚏」与「呼吸道感染」。',
  '第二步只有两种情形才回答「资料里没写」：片段完全没涉及用户问的这件事；' +
    '或用户问的是片段里确实没有的具体事实（价格、寿命、某药的具体剂量）。',
  '涉及用药剂量或具体药品名时不要给数值，改为建议咨询校兽医。',
].join('\n');

/** 片段喂给模型的固定格式：编号即引用号 */
function buildPrompt(question: string, passages: RetrievedPassage[], ctx: AnimalContext): string {
  const blocks: string[] = [];
  let seq = 0;

  for (const p of passages) {
    seq += 1;
    blocks.push(`[${seq}] ${p.title} · ${p.source}（${chunkLabel(p.index)}）\n${p.text}`);
  }

  const where = describeWhereabouts(ctx.whereabouts);

  if (ctx.animal) {
    // 位置并进档案块而不是另起一段：prompt 里的编号必须与引用白名单的编号一一对应，
    // 多插一段会把它后面的档案引用号顶偏。档案引用本来就不靠模型"引"。
    const body: string[] = [];
    let heading = '档案摘要';
    if (ctx.latestNote) {
      heading = '最近一条已核实记录';
      body.push(ctx.latestNote);
    } else if (ctx.animal.summary) {
      body.push(ctx.animal.summary);
    }
    if (where) {
      body.push(`常出没位置（按档案坐标归类，与图鉴的「常见位置」同一口径）：${where}`);
    }
    if (body.length) {
      seq += 1;
      blocks.push(
        `[${seq}] ${ctx.animal.name}（${ctx.animal.code}）· ${heading}\n${body.join('\n')}`,
      );
    }
  }

  return [
    '以下是可能相关的资料片段，编号即引用号：',
    '',
    blocks.join('\n\n'),
    '',
    CITE_RULES,
    ...(where
      ? ['', WHEREABOUTS_RULE]
      : ctx.animal
        ? [
            '',
            '该档案没有位置坐标（图鉴里也显示「位置待补充」）：被问到位置时直接说明暂无，' +
              '不要拿观察正文里的地名冒充「常出没位置」。',
          ]
        : []),
    '',
    `问题：${question}`,
  ].join('\n');
}

export async function answerQuestion(
  input: ChatRequest,
  deps: AnswerDeps = {},
): Promise<AnswerOutcome> {
  const startedAt = Date.now();
  const degraded: string[] = [];
  const question = input.question.trim();

  const guard = moderateText(question);
  if (!guard.safe) {
    // 阻断话术的唯一来源是 constants.FALLBACK_TEXT —— 别在这里另抄一份字面量，
    // 否则「同一个问题在问答页和记录页被拦下来的说法不一样」，也让文案失去了单一事实源。
    return { ok: false, code: 'MODERATION_BLOCKED', message: FALLBACK_TEXT.moderation_blocked };
  }

  const db = deps.db ?? prisma;
  const resolve = deps.resolveAnimal ?? loadAnimalContext;

  // —— 两路检索 ——
  const ctx = await resolve({ animalId: input.animalId, question }, { db });
  const intent: ChatIntent = classifyIntent({
    question,
    animalId: input.animalId,
    // 命中多只也算"涉及个体"：否则会退化成 KNOWLEDGE，跑去答护理知识
    animalMatched: Boolean(ctx.animal) || ctx.candidates.length > 0,
  });

  // —— 数据库路：统计与名单先问库，再谈检索 ——
  // 只在"没有指向任何一只动物"时走这条路：问「小灰多重」不该被当成全场统计。
  // askDatabase 自己不认识的问法返回 null，落回原来的两路检索 ——
  // 判定失败只是"不归它管"，不是"答不上来"，不能因此给用户兜底话术。
  if (!input.animalId && !ctx.animal && ctx.candidates.length === 0) {
    let dbAnswer: Awaited<ReturnType<typeof askDatabase>> = null;
    try {
      dbAnswer = await askDatabase(question, { db });
    } catch (err) {
      log.warn('chat.db_answer_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      degraded.push('db_answer_failed');
    }
    if (dbAnswer) {
      return finish({
        question,
        intent: 'DATA',
        answer: dbAnswer.answer,
        citations: [buildDatabaseCitation(dbAnswer, 1)],
        animal: null,
        candidates: [],
        fallback: null,
        uncertain: false,
        degraded,
        startedAt,
        ctx,
        deps,
      });
    }
  }

  let passages: RetrievedPassage[] = [];
  try {
    const result: RetrieveResult = await retrieveKnowledgeWithMeta(question, RAG_TOP_K, deps);
    passages = result.passages;
    degraded.push(...result.degraded);
  } catch (err) {
    // 检索挂了不等于没资料：记下来，按"没有依据"处理，绝不假装检索过
    log.error('rag.retrieve_failed', { error: err instanceof Error ? err.message : String(err) });
    degraded.push('retrieve_failed');
  }

  const hasAnimalRef = Boolean(ctx.animal) || ctx.candidates.length > 0;
  // 位置也算"档案里有记录"：档案可能一条正文都没写，但坐标就是它常出没的地方，
  // 这种问法（「它平时在哪活动」）不该被兜底成"没有这条记录"。
  const where = ctx.animal ? describeWhereabouts(ctx.whereabouts) : null;
  const hasAnimalRecord = ctx.facts.length > 0 || Boolean(ctx.animal?.summary) || Boolean(where);
  const hasKnowledge = passages.length > 0;

  // 命中多只 → 先让用户指明是哪只。
  // 放在兜底之前：分不清是哪只却先说"没有这条记录"，等于把"不知道问谁"说成了"没有记录"。
  if (!ctx.animal && ctx.candidates.length > 1) {
    const names = ctx.candidates.map((c) => `${c.name}（${c.code}）`).join('、');
    return finish({
      question,
      intent,
      answer: `有好几只对得上：${names}。你说的是哪一只？`,
      citations: [],
      animal: null,
      candidates: ctx.candidates,
      fallback: null,
      uncertain: true,
      degraded,
      startedAt,
      ctx,
      deps,
    });
  }

  // —— 兜底判定：两种「空」必须分开 ——
  // 知识库空是"没有这类知识"，档案空是"没有这条记录"。
  // 前者不该引导用户去记录一笔 —— 记了也进不了知识库。
  if (!hasKnowledge && !hasAnimalRecord) {
    const fallback = hasAnimalRef ? 'no_animal_record' : 'no_knowledge';
    return finish({
      question,
      intent: hasKnowledge ? intent : 'CHATTER',
      answer: FALLBACK_TEXT[fallback],
      citations: [],
      animal: ctx.animal,
      candidates: ctx.candidates,
      fallback,
      uncertain: true,
      uncertainNote: fallback === 'no_animal_record' ? undefined : FALLBACK_TEXT.no_knowledge,
      degraded,
      startedAt,
      ctx,
      deps,
    });
  }

  // 明确在问某只动物、但档案里没有它的记录 —— 知识库有命中也不该拿去顶替
  if (hasAnimalRef && !hasAnimalRecord && intent === 'ANIMAL') {
    return finish({
      question,
      intent,
      answer: FALLBACK_TEXT.no_animal_record,
      citations: [],
      animal: ctx.animal,
      candidates: ctx.candidates,
      fallback: 'no_animal_record',
      uncertain: true,
      degraded,
      startedAt,
      ctx,
      deps,
    });
  }

  // —— 生成 ——
  const knowledgeCitations: Citation[] = passages.map((p, i) => buildCitation(p, i + 1));

  /**
   * 档案引用**不进模型的引用白名单**：
   * "问的是哪只动物"由实体解析确定，不是模型挑的 —— 模型不引它，不代表没用它。
   * 只要本次真的把档案上下文喂进了 prompt，档案就必须出现在来源里。
   */
  const animalCitation =
    ctx.animal && (ctx.latestNote || ctx.animal.summary || where)
      ? buildAnimalCitation(
          {
            id: ctx.animal.id,
            code: ctx.animal.code,
            name: ctx.animal.name,
            summary: ctx.animal.summary,
            // 只有坐标、没有正文的档案：把位置当成片段，引用卡片才不是空的
            latestNote: ctx.latestNote ?? (where ? `常出没：${where}` : null),
          },
          knowledgeCitations.length + 1,
        )
      : null;
  const allCitations: Citation[] = animalCitation
    ? [...knowledgeCitations, animalCitation]
    : knowledgeCitations;

  const prompt = buildPrompt(question, passages, ctx);
  // mock 与真实 Provider 都从 context.docs 里取"可用来源"：
  // id 用 docId —— 引用白名单按篇匹配，段切分方式变了也不影响模型行为
  const context = {
    docs: passages.map((p) => ({ id: p.docId, title: p.title, content: p.text, score: p.score })),
    ...(ctx.animal
      ? { animal: { id: ctx.animal.id, code: ctx.animal.code, name: ctx.animal.name } }
      : {}),
    // 位置事实单独给一份：mock 与真实 Provider 都能直接取用，不必从 prompt 里再解析
    ...(where ? { animalWhere: where } : {}),
  };

  const run: RagRunner =
    deps.run ??
    ((req) =>
      runStructured(
        { intent: 'RAG', prompt: req.prompt, system: req.system, context: req.context },
        RagAnswerSchema,
      ));

  const ai = await run({ prompt, system: systemFor('RAG'), context });

  // 模型不可用：把 top1 原文当答案返回，而不是 503 —— 检索到的原文也是依据
  if (!ai.ok) {
    degraded.push(ai.error);
    const rawPassage = passages[0];
    const rawAnswer = rawPassage
      ? `${FALLBACK_TEXT.ai_unavailable}\n\n${rawPassage.title}（${chunkLabel(rawPassage.index)}）\n${rawPassage.text}`
      : (ctx.latestNote ?? ctx.animal?.summary ?? FALLBACK_TEXT.no_animal_record);
    return finish({
      question,
      intent,
      answer: rawAnswer,
      citations: rawPassage ? [buildCitation(rawPassage, 1)] : [],
      animal: ctx.animal,
      candidates: ctx.candidates,
      fallback: 'ai_unavailable',
      uncertain: true,
      degraded,
      startedAt,
      ctx,
      deps,
    });
  }

  // —— 引用白名单 ——
  /**
   * 模型看到的片段编号是 `[1] [2]`（buildPrompt 里逐段自增），
   * 所以它回传的 citedDocIds 很可能是「1」「2」而不是 cuid 形式的 docId。
   * 2026-10-27 实测：扩语料后大量回答出现 citations_dropped:2、来源一片空白 ——
   * 答案里明明写着 [1][4]，白名单却按 docId 比对，一条都对不上全被丢掉。
   *
   * 两种写法都认，但**编号必须落在本次检索范围内**（1..passages.length）：
   * 白名单纪律不变 —— 只有本次真的检索到的来源才可能被引用，模型编的仍然丢。
   */
  const docIdSet = new Set(passages.map((p) => p.docId));
  const seqToDocId = new Map<string, string>();
  passages.forEach((p, i) => seqToDocId.set(String(i + 1), p.docId));

  const cited = new Set<string>();
  let invalidCited = 0;
  const rawCited = ai.data.citedDocIds ?? [];
  for (const raw of rawCited) {
    const id = String(raw).trim();
    const mapped = docIdSet.has(id) ? id : seqToDocId.get(id);
    if (mapped) cited.add(mapped);
    else invalidCited += 1;
  }
  /**
   * 模型漏标 [n] 时的回退：检索是真跑过的，passages 就是这次答案的依据，
   * 把它们列出来比"答案有、来源一片空白"更有用。
   * 实测 GLM 在指令跟随偏弱时会整段不标引用 —— 不能因此让来源卡片消失。
   * 注意只列**本次检索命中**的，白名单纪律不变（绝不接受模型编出来的 id）。
   *
   * 但「一条都没对上」和「压根没标」必须分开：模型编了 id 却全被白名单刷掉时，
   * 不能退回去把全部来源都列出来 —— 那等于把编造行为洗成正常引用。
   */
  const keptKnowledge =
    cited.size > 0
      ? knowledgeCitations.filter((c) => c.docId && cited.has(c.docId))
      : rawCited.length === 0
        ? knowledgeCitations
        : [];
  if (rawCited.length === 0 && knowledgeCitations.length > 0) {
    log.warn('rag.citations_unlabeled', { question, passages: knowledgeCitations.length });
  }
  // 只统计「引了本次检索之外的东西」：同一篇的多段被合并成一条引用不算丢弃
  if (invalidCited > 0) degraded.push(`citations_dropped:${invalidCited}`);
  const kept: Citation[] = animalCitation ? [...keptKnowledge, animalCitation] : keptKnowledge;

  const uncertain = ai.data.confidence < CONFIDENCE_FLOOR;

  return finish({
    question,
    intent,
    answer: ai.data.answer,
    citations: kept,
    animal: ctx.animal,
    candidates: ctx.candidates,
    fallback: null,
    uncertain,
    uncertainNote: uncertain ? UNCERTAIN_NOTE : undefined,
    degraded,
    startedAt,
    ctx,
    deps,
  });
}

interface FinishInput {
  question: string;
  intent: ChatIntent;
  answer: string;
  citations: Citation[];
  animal: AnimalContext['animal'];
  candidates: AnimalContext['candidates'];
  fallback: ChatData['fallback'];
  uncertain: boolean;
  uncertainNote?: string;
  degraded: string[];
  startedAt: number;
  ctx: AnimalContext;
  deps: AnswerDeps;
}

/** 统一收口：审计 + 组装响应，保证每条分支都带同样的字段 */
async function finish(input: FinishInput): Promise<AnswerOutcome> {
  const data: ChatData = {
    question: input.question,
    answer: input.answer,
    intent: input.intent,
    citations: input.citations,
    animal: input.animal
      ? { id: input.animal.id, code: input.animal.code, name: input.animal.name }
      : null,
    candidates: input.candidates.map((c) => ({ id: c.id, code: c.code, name: c.name })),
    fallback: input.fallback,
    uncertain: input.uncertain,
    ...(input.uncertainNote ? { uncertainNote: input.uncertainNote } : {}),
    disclaimer: DISCLAIMER,
    degraded: input.degraded,
    timingMs: Date.now() - input.startedAt,
  };

  if (input.deps.audit !== false) {
    await writeAudit({
      action: AUDIT_ACTIONS.CHAT_ANSWER,
      targetType: 'Animal',
      targetId: input.animal?.id ?? null,
      actorId: null,
      payload: {
        intent: data.intent,
        fallback: data.fallback,
        citations: data.citations.length,
        uncertain: data.uncertain,
        degraded: data.degraded,
      },
    }).catch(() => undefined);
  }

  return { ok: true, data };
}

export { resolveAnimalRef };
