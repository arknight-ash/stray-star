import { CONFIDENCE_FLOOR, DISCLAIMER } from '@/lib/constants';

/** 置信度闸门：低于阈值必须显式呈现「不确定」，不得把猜测包装成结论 */
export function guardConfidence(confidence: number) {
  const uncertain = confidence < CONFIDENCE_FLOOR;
  return {
    uncertain,
    message: uncertain
      ? '置信度偏低，结果可能不准确。建议补拍清晰照片或交给管理员人工核对。'
      : undefined,
  };
}

/** 为任何 AI 健康相关输出补免责声明，字段缺失时填充标准文案 */
export function withDisclaimer<T extends { disclaimer?: string }>(payload: T): T & { disclaimer: string } {
  return { ...payload, disclaimer: payload.disclaimer?.trim() || DISCLAIMER };
}

/** 低置信度 + 严重分级 → 是否必须管理员复核 */
export function needsAdminReview(params: {
  confidence: number;
  severity?: 'MILD' | 'MODERATE' | 'SEVERE';
}): boolean {
  return params.confidence < CONFIDENCE_FLOOR || params.severity === 'SEVERE';
}
