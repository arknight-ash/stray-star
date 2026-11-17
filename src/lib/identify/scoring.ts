import type { Species } from '@/types/domain';
import {
  CONFIDENCE_FLOOR,
  IDENTIFY_CANDIDATE,
  IDENTIFY_KW_WEIGHT,
  IDENTIFY_MATCH,
  IDENTIFY_VEC_WEIGHT,
  QUERY_TOKEN_MIN,
  SCORE_MARGIN_MIN,
  SPECIES_MISMATCH_MUL,
} from '../constants';
import type { AnimalVectorHit } from '../db/vector';
import { contentTokens, keywordScore } from '../rag/keyword';
import { SPECIES_META } from '../semantic';

/**
 * 识别判定（hybrid 打分 + 三道闸门）。
 *
 * 分数为什么是「加权融合」而不是取两路的最大值：
 * - 换成语义向量（GLM embedding-3）之后，同一物种的个体分数会挤在 0.70–0.85
 *   （实测黑猫煤球 0.746、白色长毛猫雪梨 0.777 —— 颜色相反的猫也能排到前面，
 *   说明文本向量对"毛色"这类视觉差异并不敏感）；
 * - 而关键词路恰好相反：档案里"左耳绝育耳标""异瞳""跛行"这些独有词权重很高；
 * - 旧实现 Math.max(vec, kw) 会让 0.777 的向量分直接盖掉 0.25 的关键词分，
 *   等于把唯一能区分个体的证据扔了。融合后 top1 排序 5/5 正确。
 *
 * 阈值来历见 docs/stage-3-identify.md 第 1 节 —— 在种子数据上实测标定，不是拍脑袋。
 */

export type IdentifyTier = 'matched' | 'candidate' | 'new';

export interface ScoredCandidate {
  animalId: string;
  code: string;
  name: string;
  species: Species;
  avatarUrl: string | null;
  healthLevel: 'GREEN' | 'YELLOW' | 'RED';
  pendingReview: boolean;
  /** 向量路分数（余弦） */
  vectorScore: number;
  /** 关键词路分数（查询实词在候选文本里的覆盖率） */
  keywordScore: number;
  /** 最终分 =（向量 × 0.8 + 关键词 × 0.2）× 物种冲突折扣；无视觉时退化为纯关键词 */
  score: number;
}

export interface DecisionInput {
  /** 已按 animalId 去重的候选（pipeline 负责合并 photo/animal 两路） */
  hits: AnimalVectorHit[];
  /** 关键词查询文本：视觉特征 + note（note 只在这一路生效） */
  queryText: string;
  /** 是否实际上传了图片。false 时判定上限锁死在 candidate */
  hasImage: boolean;
  /** 是否信任本次视觉判定（置信度 >= VISION_TRUST_FLOOR 且物种已知） */
  trustVision: boolean;
  visionSpecies: Species | 'UNKNOWN';
  visionConfidence: number;
}

export interface IdentifyDecision {
  tier: IdentifyTier;
  top1: ScoredCandidate | null;
  second: ScoredCandidate | null;
  candidates: ScoredCandidate[];
  /** 判定被闸门拦下的原因，写入响应便于排查，也用于自检断言 */
  reasons: string[];
  uncertain: boolean;
  queryTokenCount: number;
}

/**
 * 候选个体的比对文本：名字 + 物种 + 摘要 + 全部特征。
 *
 * 刻意不含 code：编号会 tokenize 出 no / 001 这类所有候选都共享的 token，
 * 等于给每个无关个体白送一点覆盖率，是典型的「看起来有分数其实没有意义」。
 */
export function candidateDocText(
  hit: Pick<AnimalVectorHit, 'name' | 'species' | 'summary' | 'features'>,
): string {
  return [
    hit.name,
    SPECIES_META[hit.species as Species]?.label ?? '',
    hit.summary ?? '',
    ...(hit.features ?? []),
  ]
    .filter(Boolean)
    .join(' ');
}

export function decide(input: DecisionInput): IdentifyDecision {
  const reasons: string[] = [];
  const queryTokenCount = contentTokens(input.queryText).size;

  const scored: ScoredCandidate[] = input.hits.map((hit) => {
    const vector = clamp01(hit.score);
    const keyword = clamp01(keywordScore(input.queryText, candidateDocText(hit)));
    // 物种冲突打折只在「视觉判定可信」时才执行：模型自己犹疑时的物种结论不该否决候选
    const mismatch =
      input.trustVision && input.visionSpecies !== 'UNKNOWN' && input.visionSpecies !== hit.species
        ? SPECIES_MISMATCH_MUL
        : 1;
    // 没有可信视觉时没有可用的向量（pipeline 会退化为全量候选），此时分数只能是纯关键词
    const fused =
      input.trustVision && vector > 0
        ? IDENTIFY_VEC_WEIGHT * vector + IDENTIFY_KW_WEIGHT * keyword
        : keyword;
    return {
      animalId: hit.id,
      code: hit.code,
      name: hit.name,
      species: hit.species,
      avatarUrl: hit.avatarUrl,
      healthLevel: hit.healthLevel,
      pendingReview: hit.pendingReview,
      vectorScore: vector,
      keywordScore: keyword,
      score: fused * mismatch,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const top1 = scored[0] ?? null;
  const second = scored[1] ?? null;

  const uncertainFromVision = input.visionConfidence < CONFIDENCE_FLOOR;
  if (uncertainFromVision) reasons.push('vision_low_confidence');
  if (input.visionSpecies === 'UNKNOWN') reasons.push('species_unknown');

  let tier: IdentifyTier = 'new';

  if (!top1) {
    reasons.push('no_candidate');
  } else if (top1.score < IDENTIFY_CANDIDATE) {
    reasons.push('score_below_candidate');
    tier = 'new';
  } else {
    const margin = top1.score - (second?.score ?? 0);
    const tooShort = queryTokenCount < QUERY_TOKEN_MIN;
    const tooClose = margin < SCORE_MARGIN_MIN;

    if (tooShort) reasons.push('query_too_short');
    if (tooClose) reasons.push('margin_too_small');

    if (top1.score >= IDENTIFY_MATCH && !tooShort && !tooClose && !uncertainFromVision) {
      tier = 'matched';
    } else {
      tier = 'candidate';
    }
  }

  // 无图不许 matched：没有照片就没有个体级外观证据，再高的关键词覆盖率也只是「听起来像」
  if (tier === 'matched' && !input.hasImage) {
    tier = 'candidate';
    reasons.push('no_image_matched_downgraded');
  }

  return {
    tier,
    top1,
    second,
    candidates:
      tier === 'candidate' ? scored.filter((c) => c.score >= IDENTIFY_CANDIDATE).slice(0, 3) : [],
    reasons,
    uncertain: tier !== 'matched' || uncertainFromVision,
    queryTokenCount,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
