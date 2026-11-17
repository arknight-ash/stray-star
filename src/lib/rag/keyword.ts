import { tokenize } from '../ai/embedding-local';
import { RAG_EMPHASIS_MUL } from '../constants';

/**
 * 关键词打分（词袋向量的补充）。
 *
 * 为什么需要它：本地词袋向量（hashEmbedding）在中文短句上区分度不够——
 * 「绝育后怎么护理」和「天文望远镜」的余弦分数几乎一样（0.105 vs 0.102）。
 * 关键词覆盖率对这类短问答反而稳定：查询 n-gram 命中文档的比例，
 * 没有字面重叠就是 0，不会像哈希那样因为维度冲突产生伪相似。
 *
 * 真实 embedding 模型（OpenAI / 通义）分数普遍在 0.7+，关键词分会更低，
 * 因此最终取两者最大值，两种情况下都能工作。
 */

/** 常见虚字：由它们组成的 2-gram 不带语义，直接丢掉 */
const FUNCTION_CHARS = new Set(
  ('的了和是在有我你他它们这那不与及或就都很也要会能可对请问吗呢吧啊着过被把' +
    '什么怎么如何哪些多久是否还要需要应该可能因为所以但是然后')
    .split(''),
);

export function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(text)) {
    if (/^[\p{Script=Han}]+$/u.test(t)) {
      // 两个都是虚字 → 丢弃
      if (t.length === 2 && FUNCTION_CHARS.has(t[0]) && FUNCTION_CHARS.has(t[1])) continue;
    }
    out.add(t);
  }
  return out;
}

/**
 * 篇内「重点词」：所有【小标题】。
 *
 * 为什么单独抽出来：知识库的要点是 `【小标题】内容` 结构，写小标题的词
 * 往往正是用户会问的那个词（「止血」就写在外伤篇的小标题里）。
 * 命中重点词说明对得更准，给它加权能救回「短问题 + 长文档」被低估的分数
 * （实测「捡到受伤的猫怎么止血」从 0.125 抬过闸门，见 docs/stage-6-rag.md §0②）。
 *
 * **刻意不含篇名**：早期版本把篇名也算进重点词，结果「能不能抓校园里的猫」
 * 因为「校园」命中《校园投喂规范》的篇名而被加权顶到第一，
 * 真正该命中的《抓捕与安全注意》反而排到了后面。
 * 篇名描述的是"这一篇讲什么"，不等于"这一段讲什么"；
 * 篇名的相关性改由 titleBoost 按整词包含来判定（见 retriever.ts）。
 */
export function emphasisOf(content: string): string {
  const heads = [...content.matchAll(/【([^】]*)】/g)].map((m) => m[1]);
  return heads.join(' ');
}

/**
 * 篇名主词：《绝育（TNR）术后护理》→「绝育」。
 * 括号里通常是英文缩写/副标题，放进包含判断只会让它永远匹配不上。
 */
export function titleKey(title: string): string {
  const before = title.split('（')[0].trim();
  return before.length >= 2 ? before : title.replace(/（[^）]*）/g, '').trim();
}

export interface KeywordDetail {
  /** 覆盖率 0..1 */
  score: number;
  /** 命中 token 的长度之和：用于同分 tie-break（对得越具体越优先） */
  hitLen: number;
  /** 是否命中了标题/小标题：tie-break 的第二优先级 */
  titleHit: boolean;
}

/**
 * 查询在文档中的覆盖率，0..1。
 *
 * 权重：
 * - 长 token（多为实词组合）比短 token 更有区分度 → ×1.5；
 * - 命中标题 /【小标题】→ 再 ×RAG_EMPHASIS_MUL，让"问到点子上"的段排上来。
 */
export function keywordDetail(query: string, doc: string, emphasis = ''): KeywordDetail {
  const q = contentTokens(query);
  if (q.size === 0) return { score: 0, hitLen: 0, titleHit: false };

  const d = contentTokens(doc);
  const e = emphasis ? contentTokens(emphasis) : new Set<string>();

  let hit = 0;
  let total = 0;
  let hitLen = 0;
  let titleHit = false;

  for (const token of q) {
    const emphasised = e.has(token);
    const w = (token.length >= 2 ? 1.5 : 1) * (emphasised ? RAG_EMPHASIS_MUL : 1);
    total += w;
    if (d.has(token)) {
      hit += w;
      hitLen += token.length;
      if (emphasised) titleHit = true;
    }
  }

  return { score: total ? hit / total : 0, hitLen, titleHit };
}

export function keywordScore(query: string, doc: string, emphasis = ''): number {
  return keywordDetail(query, doc, emphasis).score;
}
