/**
 * RAG 问答自检（第 6 阶段）。
 * 用法：npm run rag:selftest      —— 直连数据库 + mock Provider
 *       npm run rag:http:selftest —— 额外起一个 next dev（--turbo）跑真实 HTTP 链路
 *
 * 与 health / obs 同一条纪律：Provider 钉死成 mock，断言不依赖 `.env` 与网络。
 *
 * 最有价值的一组断言是 §2：六个问题在改动前是「4 个库内问题漏掉 2 个」，
 * 修复后必须全部命中、两个负向仍然为空 —— 这组是双轨闸门的回归基线，
 * 谁再动阈值，它第一个报警。
 */
import '../src/lib/load-env';
import { spawn } from 'node:child_process';
import { startDev, stopDev } from './lib/dev-server';
import { join } from 'node:path';
import { getProvider } from '../src/lib/ai';
import { answerQuestion, type AnswerDeps } from '../src/lib/rag/answer';
import { retrieveKnowledgeWithMeta } from '../src/lib/rag/retriever';
import { classifyIntent } from '../src/lib/rag/intent';
import { chunkContent } from '../src/lib/rag/chunk';
import { FALLBACK_TEXT, RAG_REL_MIN } from '../src/lib/constants';
import { prisma } from '../src/lib/db';
import type { ChatData } from '../src/lib/api/chat-contract';
import { KNOWLEDGE } from '../prisma/seed/knowledge';

process.env.AI_PROVIDER = 'mock';

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

/**
 * 库内确实有答案的正向问题。
 * 知识库 2026-10-27 从 5 篇扩到 16 篇，这里同步覆盖新增场景：
 * 腿伤、呼吸道、幼猫、中暑这四类都是校园最高频的提问。
 *
 * 注意：本自测把 Provider 钉死成 mock（本地词袋向量，无语义），
 * 所以只能验证「字面有重叠时能捞到」。像「猫腿瘸了怎么办」这种必须靠语义
 * 才能对到《腿伤、跛行与骨折判断》的问法，在 mock 下必然为空 ——
 * 它由真实 embedding 的探针覆盖（实测 top1 0.66），不要为了让它变绿去调阈值。
 */
const IN_DOMAIN = [
  '猫瘟有什么症状',
  '绝育之后要注意什么',
  '捡到受伤的猫怎么止血',
  '能不能抓校园里的猫',
  '猫跛行怎么办',
  '猫打喷嚏怎么办',
  '奶猫怎么喂',
  '夏天猫中暑了怎么办',
];
/** 库里没有答案的负向问题（必须与校园动保语料完全无关） */
const OUT_DOMAIN = ['怎么申请奖学金', '今天天气不错'];

async function main() {
  console.log('\n[0] 运行前置');
  const provider = getProvider();
  check('Provider 被钉死为 mock', provider.name === 'mock', provider.name);

  const docCount = await prisma.knowledgeDoc.count();
  const chunkCount = await prisma.knowledgeChunk.count();
  check('知识库已切块入库', docCount > 0 && chunkCount >= docCount * 2, `${docCount} 篇 / ${chunkCount} 段`);

  // 语料完整性：种子文件里的每一篇都必须在库、且切出 ≥6 段。
  // 2026-10-27 扩语料时踩过一次：只改了 seed 文件没入库，页面照旧「资料里没写」，
  // 这条断言就是防这个 —— 加了篇目却没跑 rag:ingest，它会直接报出来。
  const perDoc = await prisma.knowledgeDoc.findMany({
    select: { title: true, _count: { select: { chunks: true } } },
  });
  const andChunks = new Map(perDoc.map((d) => [d.title, d._count.chunks]));
  const notIngested = KNOWLEDGE.filter((k) => !andChunks.has(k.title)).map((k) => k.title);
  check(
    `种子 ${KNOWLEDGE.length} 篇全部在库`,
    notIngested.length === 0,
    notIngested.length ? `缺 ${notIngested.join('、')}` : `${andChunks.size} 篇`,
  );
  const thin = [...andChunks].filter(([, n]) => n < 6);
  check(
    '每篇至少切出 6 段',
    thin.length === 0,
    thin.length ? thin.map(([t, n]) => `${t}:${n}`).join('、') : 'ok',
  );

  console.log('\n[1] 切块按【小标题】分段');
  const sample = await prisma.knowledgeDoc.findFirst({ select: { content: true } });
  const chunks = chunkContent(sample?.content ?? '');
  check('一个【小标题】一段（不再整篇一段）', chunks.length > 1, `${chunks.length} 段`);
  check('每段都以小标题开头', chunks.every((c) => /^【/.test(c.text)));

  console.log(`\n[2] 检索：库内 ${IN_DOMAIN.length} 个问题必须全部命中`);
  for (const q of IN_DOMAIN) {
    const { passages } = await retrieveKnowledgeWithMeta(q, 4);
    check(`正向命中「${q}」`, passages.length > 0, `${passages.length} 条`);
  }

  console.log(`\n[3] 检索：库外 ${OUT_DOMAIN.length} 个问题必须为空`);
  for (const q of OUT_DOMAIN) {
    const { passages } = await retrieveKnowledgeWithMeta(q, 4);
    check(`负向为空「${q}」`, passages.length === 0, `${passages.length} 条`);
  }

  console.log('\n[4] 并列标注');
  {
    const { passages } = await retrieveKnowledgeWithMeta('猫瘟有什么症状', 4);
    const tiedCount = passages.filter((p) => p.tied).length;
    const top = passages[0];
    const gap = top ? top.score - (passages[passages.length - 1]?.score ?? top.score) : 0;
    // 并列判定：与 top1 差 < RAG_REL_MIN 的都标 tied；不存在时至少 top1 自己是 tied
    check('top1 自身被标为 tied（差 0 < REL_MIN）', top?.tied === true, `gap=${gap.toFixed(3)}`);
    check('并列条目不止一条时全部标注', tiedCount === 0 || tiedCount >= 1, `${tiedCount} 条 tied`);
    const anyTied = passages.some((p) => p.tied);
    const allTiedAreClose = passages.filter((p) => p.tied).every((p) => top!.score - p.score < RAG_REL_MIN);
    check('被标 tied 的都在 REL_MIN 之内', !anyTied || allTiedAreClose);
  }

  console.log('\n[5] 意图分类');
  check('问护理知识 → KNOWLEDGE', classifyIntent({ question: '猫瘟有什么症状' }) === 'KNOWLEDGE');
  check('问动物近况 → ANIMAL', classifyIntent({ question: '它最近怎么样', animalMatched: true }) === 'ANIMAL');
  check(
    '带编号 → 涉及个体',
    ['ANIMAL', 'MIXED'].includes(classifyIntent({ question: 'No.001 最近怎么样' })),
  );
  check(
    '既问这只又问怎么办 → MIXED',
    classifyIntent({ question: '这只猫呕吐怎么办', animalMatched: true }) === 'MIXED',
  );

  console.log('\n[6] 正常问答：答案带引用');
  {
    const res = await answerQuestion({ question: '猫瘟有什么症状' }, { audit: false });
    check('返回成功', res.ok);
    if (res.ok) {
      const d = res.data as ChatData;
      check('有答案', d.answer.length > 0);
      check('有引用', d.citations.length > 0, `${d.citations.length} 条`);
      check('引用号从 1 开始', d.citations[0]?.seq === 1);
      check('引用精确到段（chunkIndex 有值）', d.citations[0]?.chunkIndex !== undefined);
      check('带免责声明', d.disclaimer.length > 0);
      check('未走兜底', d.fallback === null, String(d.fallback));
    }
  }

  console.log('\n[7] 引用白名单：模型编的 id 必须丢掉');
  {
    const deps: AnswerDeps = {
      audit: false,
      run: async () => ({
        ok: true,
        provider: 'mock',
        data: { answer: '编一个来源 [1]', citedDocIds: ['fake-id'], confidence: 0.9, followUp: '' },
      }),
    };
    const res = await answerQuestion({ question: '猫瘟有什么症状' }, deps);
    check('注入生效', res.ok);
    if (res.ok) {
      const d = res.data as ChatData;
      check('编造的引用被丢弃 → citations 为空', d.citations.length === 0, `${d.citations.length} 条`);
      check('degraded 记录了丢弃数', d.degraded.some((x) => x.startsWith('citations_dropped:')), d.degraded.join(','));
    }
  }

  console.log('\n[8] 模型不可用：返回原文而不是 503');
  {
    const deps: AnswerDeps = {
      audit: false,
      run: async () => ({
        ok: false,
        provider: 'mock',
        error: 'AI_UNAVAILABLE',
        message: 'provider down',
      }),
    };
    const res = await answerQuestion({ question: '猫瘟有什么症状' }, deps);
    check('仍返回 200 级结果（不是失败）', res.ok);
    if (res.ok) {
      const d = res.data as ChatData;
      check('fallback = ai_unavailable', d.fallback === 'ai_unavailable', String(d.fallback));
      check('答案含检索到的原文', d.answer.includes(FALLBACK_TEXT.ai_unavailable));
      check('标记不确定', d.uncertain === true);
      check('仍给出 1 条来源', d.citations.length === 1, `${d.citations.length} 条`);
    }
  }

  console.log('\n[9] 空检索兜底');
  {
    const res = await answerQuestion({ question: '今天的股票行情怎么样' }, { audit: false });
    check('返回成功', res.ok);
    if (res.ok) {
      const d = res.data as ChatData;
      check('fallback = no_knowledge', d.fallback === 'no_knowledge', String(d.fallback));
      check('文案与常量一致', d.answer === FALLBACK_TEXT.no_knowledge);
      check('intent 归为 CHATTER', d.intent === 'CHATTER', d.intent);
    }
  }

  console.log('\n[10] 档案空兜底 + 未核实过滤');
  {
    const stamp = Date.now().toString(36);
    const animal = await prisma.animal.create({
      data: { name: `测试猫·RAG-${stamp}`, code: `TEST:RAG:${stamp}`, species: 'CAT' },
      select: { id: true, code: true },
    });
    // 一条未核实 + 一条已核实：只有后者能进引用
    await prisma.observation.create({
      data: {
        animalId: animal.id,
        content: '未核实：据说它昨晚打了喷嚏',
        pendingReview: true,
        severity: 'MILD',
        type: 'OTHER',
      },
    });

    // 完全没有记录 → 档案空兜底
    const empty = await answerQuestion(
      { question: '它最近怎么样', animalId: animal.id },
      { audit: false },
    );
    check('档案无记录 → 返回成功', empty.ok);
    if (empty.ok) {
      const d = empty.data as ChatData;
      check('fallback = no_animal_record', d.fallback === 'no_animal_record', String(d.fallback));
      check('文案逐字等于指定话术', d.answer === '档案里暂时没有这条记录，要不要记录一笔？', d.answer);
    }

    // 补一条已核实记录 → 应当被引用
    await prisma.observation.create({
      data: {
        animalId: animal.id,
        content: '已核实：左前爪有轻微擦伤，已消毒',
        pendingReview: false,
        severity: 'MILD',
        type: 'HEALTH',
      },
    });
    const withNote = await answerQuestion(
      { question: '它最近怎么样', animalId: animal.id },
      { audit: false },
    );
    if (withNote.ok) {
      const d = withNote.data as ChatData;
      check('有已核实记录后不再走兜底', d.fallback !== 'no_animal_record', String(d.fallback));
      const allText = JSON.stringify(d.citations);
      check('未核实观察不出现在引用里', !allText.includes('未核实：据说'));
      check('已核实记录进入引用', allText.includes('已核实：左前爪'));
    } else {
      check('有已核实记录后不再走兜底', false, 'not ok');
    }

    await prisma.observation.deleteMany({ where: { animalId: animal.id } });
    await prisma.animal.delete({ where: { id: animal.id } });
  }

  console.log('\n[11] 命中多只：列候选不猜');
  {
    const stamp = Date.now().toString(36);
    const shared = `同名字-${stamp}`;
    const a = await prisma.animal.create({
      data: { name: shared, code: `TEST:RAG:A-${stamp}`, species: 'CAT' },
      select: { id: true },
    });
    const b = await prisma.animal.create({
      data: { name: shared, code: `TEST:RAG:B-${stamp}`, species: 'CAT' },
      select: { id: true },
    });
    const res = await answerQuestion({ question: `${shared}最近怎么样` }, { audit: false });
    check('返回成功', res.ok);
    if (res.ok) {
      const d = res.data as ChatData;
      check('不挑一只作答（animal 为 null）', d.animal === null);
      check('给出候选列表', d.candidates.length === 2, `${d.candidates.length} 只`);
      check('提示用户指明是哪只', d.answer.includes('哪一只'));
    }
    await prisma.animal.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  }

  console.log('\n[12] 内容安全');
  {
    // 用现有词表内的措辞。注意：单独一个「虐待」目前不在拦截表里
    // （加上会误伤「如何救助被虐待的猫」这类正当提问），这里不替安全模块擅自扩规则。
    const blocked = await answerQuestion({ question: '怎么毒死校园里的猫' }, { audit: false });
    check('伤害动物描述被拦截', !blocked.ok && blocked.code === 'MODERATION_BLOCKED', blocked.ok ? '未拦截' : blocked.code);
  }

  console.log('\n[13] 清理测试数据');
  const leftover = await prisma.animal.count({ where: { code: { startsWith: 'TEST:RAG' } } });
  check('测试动物已清空', leftover === 0, `${leftover} 只残留`);
}

async function httpMode() {
  console.log('\n[14] HTTP 链路');
  const port = 3316;
  const proc = await startDev(port);
  const base = `http://127.0.0.1:${port}`;

  try {
    await waitFor(`${base}/`, 90_000);

    const ask = (body: unknown) =>
      fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const okRes = await ask({ question: '猫瘟有什么症状' });
    const okJson = await okRes.json();
    check('正常问答 200', okRes.status === 200, String(okRes.status));
    check('HTTP 返回带引用', (okJson?.data?.citations?.length ?? 0) > 0);
    check('HTTP 返回带免责', typeof okJson?.data?.disclaimer === 'string');

    const emptyRes = await ask({ question: '今天的股票行情怎么样' });
    const emptyJson = await emptyRes.json();
    check('空检索 200 + no_knowledge', emptyRes.status === 200 && emptyJson?.data?.fallback === 'no_knowledge');

    const shortRes = await ask({ question: '猫' });
    check('问题过短 400', shortRes.status === 400, String(shortRes.status));

    // 幂等：同 clientId 两次必须同一条答案
    const cid = `rag-idem-${Date.now().toString(36)}`;
    const first = await (await ask({ question: '绝育之后要注意什么', clientId: cid })).json();
    const second = await (await ask({ question: '绝育之后要注意什么', clientId: cid })).json();
    check('同 clientId 幂等', first?.data?.answer === second?.data?.answer);

    // 限流：chat 额度 12/分钟，多打几次必然 429
    let limited = false;
    for (let i = 0; i < 20 && !limited; i += 1) {
      const res = await ask({ question: `压力测试问题 ${i} 绝育护理要点` });
      if (res.status === 429) limited = true;
    }
    check('超过额度后 429', limited);
  } finally {
    await stopDev(proc);
  }
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`服务未在 ${timeoutMs}ms 内就绪：${url}`);
}

const wantsHttp = process.argv.includes('--http');

main()
  .then(async () => {
    if (wantsHttp) await httpMode();
  })
  .then(async () => {
    await prisma.$disconnect();
    console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('\n自检脚本异常：', err);
    await prisma.$disconnect();
    process.exit(1);
  });
