import { HEALTH_TAG_TONES, tagTone } from '../semantic';

/**
 * 「负面标签」的判定（阶段 7 规则 R5）。
 *
 * 刻意不另立一份负面词表：手账上把 `外伤` 标成红色、把 `食欲下降` 标成黄色，
 * 预警却说它们不是负面 —— 同一枚标签两种语义，是最难解释的那类 bug。
 * 所以负面 = `tagTone(tag)` 落在 red / yellow（见 `lib/semantic.ts` 的 `HEALTH_TAG_TONES`）。
 *
 * 代价：`腹泻` 这类没进白名单的词现在算中性（amber）。要让它变负面，
 * 得先动 `HEALTH_TAG_TONES`（那会同时改手账取色），属于语义映射变更，须先问过再改。
 */

/** 白名单里属于负面的标签，用于 SQL 的 `hasSome` 过滤（避免把整张表拉回内存数） */
export const NEGATIVE_TAGS: string[] = Object.entries(HEALTH_TAG_TONES)
  .filter(([, tone]) => tone === 'red' || tone === 'yellow')
  .map(([tag]) => tag);

export function isNegativeTag(tag: string): boolean {
  const tone = tagTone(tag);
  return tone === 'red' || tone === 'yellow';
}

/** 一条记录里属于负面的那几个标签（保持原顺序，reason 里要原样展示） */
export function negativeTagsOf(tags: readonly string[]): string[] {
  return tags.filter(isNegativeTag);
}
