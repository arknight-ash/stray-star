/**
 * 问题分类（意图判断）。
 *
 * 为什么用规则而不是再调一次 AI：
 * - 意图判断在检索之前，多一次模型调用等于给每次提问加一次往返与一次失败面；
 * - 规则是可断言的，AI 分类则很难写回归（同一个问题两次可能给不同意图）。
 * 等真的出现"规则判不出来"的句式再换成模型，不预先付这个成本。
 *
 * 注意：`DATA`（统计/名单）不在这里判 —— 它由 `lib/insight/ask.ts` 真正跑一次
 * 库查询来决定，因为"能不能答"只有查过才知道。在这里靠词表硬判，
 * 一旦判成 DATA 却算不出东西，用户会收到一句"没查到"而不是护理知识。
 */

export type ChatIntent =
  /** 问护理知识：走知识库路 */
  | 'KNOWLEDGE'
  /** 问某只动物：走档案路 */
  | 'ANIMAL'
  /** 两路都要：例如「橘猫最近呕吐，要怎么护理」 */
  | 'MIXED'
  /** 问库里的统计/名单：多少只、几条记录、哪些需要关注 */
  | 'DATA'
  /** 两路都没依据：走兜底话术 */
  | 'CHATTER';

/** 问句里提到「某只动物」的指代词 */
const ANAPHORA = ['这只', '那只', '它', '此猫', '这条', '这只猫', '这只狗', '这孩子'];

/** 护理/健康类常见词：命中说明在问知识而不是问个体 */
const CARE_WORDS = [
  '怎么办',
  '如何',
  '怎么',
  '注意',
  '护理',
  '症状',
  '可以吗',
  '能不能',
  '要不要',
  '建议',
  '处理',
  '喂',
  '药',
];

/**
 * 问「某只动物的近况」而不是问护理知识。
 * 没有这一类判断时，「它最近怎么样」会因为含"怎么"被判成 MIXED，
 * 于是档案明明没有记录却跑去答护理知识 —— 用户问的是这只猫，不是百科。
 */
const STATE_WORDS = ['最近', '近况', '怎么样', '状态', '情况', '还好吗', '过得好吗', '现在'];

const CODE_RE = /No\.\d{2,3}/i;

export interface IntentInput {
  question: string;
  /** 请求里显式带的动物 */
  animalId?: string | null;
  /** 实体解析是否命中了某只动物 */
  animalMatched?: boolean;
}

export function classifyIntent(input: IntentInput): ChatIntent {
  const q = input.question;
  const wantsAnimal =
    Boolean(input.animalId) ||
    Boolean(input.animalMatched) ||
    CODE_RE.test(q) ||
    ANAPHORA.some((w) => q.includes(w));

  const wantsCare =
    CARE_WORDS.some((w) => q.includes(w)) || /(吗|呢)\s*$/.test(q.trim()) || /[？?]/.test(q);

  if (wantsAnimal && STATE_WORDS.some((w) => q.includes(w))) return 'ANIMAL';
  if (wantsAnimal && wantsCare) return 'MIXED';
  if (wantsAnimal) return 'ANIMAL';
  return 'KNOWLEDGE';
}
