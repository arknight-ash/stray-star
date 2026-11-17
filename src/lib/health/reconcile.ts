import type { HealthAssessment } from '../ai/schemas';
import { inferNeedsVet } from '../ai/schemas';
import { SEVERITY_HEALTH, worseHealth } from '../semantic';
import type { HealthLevel, Severity } from '@/types/domain';

/**
 * AI 健康初筛结果的一致性校正。
 *
 * 模型被要求同时输出 severity 与 healthStatus，两边打架只是时间问题
 * （真实观测里它就是会吐「SEVERE 但 GREEN」）。这里的处理是：
 *   - 取更严重的一侧作为结论，模型的乐观判断不被采纳；
 *   - SEVERE 强制 needsVet —— 「不用看兽医」这种结论永远不能由模型下。
 *
 * 一句话原则：**模型可以参与判断，但安全下限由规则把着。**
 */

/**
 * 裁决之后 needsVet 一定是有结论的布尔值 —— 这是本层存在的意义，
 * 所以这里把契约里可选的 needsVet 收窄成必填（类型上就把「模型没说」这件事关在门外）。
 */
export interface ReconciledHealth extends Omit<HealthAssessment, 'needsVet'> {
  needsVet: boolean;
  /** 本次是否发生过「向严重一侧」的校正，写进 AuditLog 便于事后追责 */
  adjusted: boolean;
  /** 人可读的校正说明，只在 adjusted 为真时有值 */
  adjustReason?: string;
}

export function reconcileHealth(raw: HealthAssessment): ReconciledHealth {
  const bySeverity = SEVERITY_HEALTH[raw.severity as Severity];
  const healthStatus: HealthLevel = worseHealth(bySeverity, raw.healthStatus as HealthLevel);
  /*
   * needsVet 的最终裁决权在系统，不在模型。
   *
   * 两种情况都不接受模型的答案：
   *   1. 模型漏说（undefined）—— 2026-10-29 之前契约要求必填，模型只要把这一个字段
   *      翻成中文（实测给的是「需要兽医」），整份评估就被判缺失作废，用户拿不到结论；
   *   2. 模型说「不用就医」，但信号里有伤口 / 出血 / 跛行 / 拒食这类红旗 ——
   *      实测同一张「右后腿有伤口」的照片，它一次判 MODERATE + needsVet true、
   *      一次判 MODERATE + needsVet false。安全下限不能交给这种摇摆。
   *
   * 红旗一旦命中就按安全一侧改判（铁律⑦：漏报的代价高于误报）；没有红旗才听模型的。
   */
  const flagged = inferNeedsVet(raw.severity, raw.signals ?? []);
  const needsVet = flagged ? true : (raw.needsVet ?? false);

  const reasons: string[] = [];
  if (healthStatus !== (raw.healthStatus as HealthLevel)) {
    reasons.push(`模型给的 ${raw.healthStatus} 与 ${raw.severity} 不一致，按严重一侧校正为 ${healthStatus}`);
  }
  if (needsVet !== (raw.needsVet ?? false)) {
    if (raw.needsVet === false) {
      reasons.push('信号里出现伤口、出血、跛行等红旗，按安全一侧改判为需要就医');
    } else {
      reasons.push(
        `模型没有明确是否就医，按 ${raw.severity} 与信号判为${
          needsVet ? '需要' : '暂不需要'
        }线下就医`,
      );
    }
  }

  return {
    ...raw,
    healthStatus,
    needsVet,
    adjusted: reasons.length > 0,
    adjustReason: reasons.length ? reasons.join('；') : undefined,
  };
}

/**
 * 建议出口审查。
 *
 * AI 输出已经过了 guardOutput 的敏感词过滤，但那套规则是从「内容安全」角度写的；
 * 「保证治好」「无需就医」这类绝对化医疗断言对救助场景是另一种风险 ——
 * 它不会触发任何内容审核，却会让人误以为不用去医院。
 * 命中的建议整条删除（而不是改写），因为改写等于替模型重新写答案。
 */
const MEDICAL_ABSOLUTE =
  /(一定|肯定|保证)\s*(能|会)\s*(治好|痊愈|康复|好起来)|无需\s*(就医|看兽医|去医院|处理)|不用\s*(就医|看兽医|去医院)|包治百病|自行\s*痊愈/;

export interface AdviceReview {
  advice: string[];
  stripped: number;
}

const SAFE_ADVICE = '请携带本次评估结果联系校兽医或当地动保组织，由专业人员面诊确认。';

export function reviewAdvice(advice: string[]): AdviceReview {
  const kept = advice.filter((a) => !MEDICAL_ABSOLUTE.test(a));
  return { advice: kept.length ? kept : [SAFE_ADVICE], stripped: advice.length - kept.length };
}
