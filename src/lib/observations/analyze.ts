import { LIMITS } from '../constants';
import { log } from '../logger';
import { readOwnUpload } from '../uploads';
import { runStructured, type StructuredResult } from '../ai/registry';
import { ObservationAnalysisSchema, type ObservationAnalysis } from '../ai/schemas';

/**
 * 众包记录的语义解析（2026-10-28）。
 *
 * 这一层是「AI 是中枢」在记录链路上的落点（CLAUDE.md ★1/★4）：
 * 分类、标签、严重度、情感、实体全部由模型给，前端不设下拉框。
 * 用户只陈述现场（"它好像瘸了"），系统负责归类 —— 归类不是用户的工作。
 *
 * 两条工程约束：
 * 1) **照片必须内联成 data URL**。上传件落在 public/uploads，站内相对路径模型访问不到
 *    （AI_PUBLIC_BASE_URL 常是 localhost）；readOwnUpload 只认本站 UUID 文件名，
 *    顺带把 SSRF 与路径穿越挡在外面。
 * 2) **看图失败不等于解析失败**。视觉模型超时/限流时退回纯文字重新解析一次 ——
 *    照片是补充证据，正文才是主证据，不该因为图没看成把整条记录打成"未分类"。
 */

/** 内联上限：客户端已把图压到 1280 宽，正常 <500KB；超过 4MB 宁可不上图也不要炸请求体 */
const INLINE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export interface ObservationAnalysisOutcome {
  analysis: ObservationAnalysis;
  /** ai = 模型给出了结构化结论；fallback = 模型不可用，只保留原文等人工核实 */
  source: 'ai' | 'fallback';
  /** 这次解析是否真的带上了照片（决定前端能不能说"我看过照片了"） */
  withImage: boolean;
  /** 是否尝试过视觉入口（失败回退文本时为 true，审计用） */
  visionAttempted: boolean;
}

/** AI 不可用时的兜底：不猜分类、不猜严重度，只标记「未分类」等人工核实 */
export const FALLBACK_ANALYSIS: ObservationAnalysis = {
  type: 'OTHER',
  tags: ['未分类'],
  severity: 'MILD',
  sentiment: 'NEUTRAL',
  entities: [],
  summary: '',
  confidence: 0,
  corrections: [],
};

export async function analyzeObservation({
  text,
  imageUrl,
  run = runStructured,
}: {
  text: string;
  imageUrl?: string | null;
  /** 自测注入点，与 create.ts 共用同一套写法 */
  run?: typeof runStructured;
}): Promise<ObservationAnalysisOutcome> {
  const dataUrl = await inlineUpload(imageUrl);
  const visionAttempted = Boolean(dataUrl);

  if (dataUrl) {
    const vision = await safeRun(run, {
      intent: 'TAGS',
      prompt: buildPrompt(text, true),
      imageUrl: dataUrl,
    });
    if (vision?.ok) {
      return { analysis: vision.data, source: 'ai', withImage: true, visionAttempted };
    }
    log.warn('observation.vision_analysis_failed', {
      error: vision?.error ?? 'THREW',
      message: vision?.message ?? '',
      // 不记图片本身，只记"曾经试图看图"
    });
  }

  const textOnly = await safeRun(run, { intent: 'TAGS', prompt: buildPrompt(text, false) });
  if (textOnly?.ok) {
    return {
      analysis: textOnly.data,
      source: 'ai',
      withImage: false,
      visionAttempted,
    };
  }

  log.warn('observation.analysis_failed', {
    error: textOnly?.error ?? 'THREW',
    message: textOnly?.message ?? '',
    hadImage: Boolean(imageUrl),
  });

  return {
    analysis: { ...FALLBACK_ANALYSIS },
    source: 'fallback',
    withImage: false,
    visionAttempted,
  };
}

/**
 * 模型调用的外壳（2026-10-29）。
 *
 * runStructured 自己会把 provider 的异常收拾成 `{ok:false}`，但记录链路不该把这条命
 * 系在别人的实现上：任何一个会直接抛的 provider，都会在 `await run(...)` 这里冲出来，
 * 把一条现场记录连同分类一起带走 —— 而记录是用户最丢不起的东西。
 * 抛了就当作这次没结果，交给下一条路径（纯文字 → 最终 fallback）。
 */
async function safeRun(
  run: typeof runStructured,
  req: Parameters<typeof runStructured>[0],
): Promise<StructuredResult<ObservationAnalysis> | null> {
  try {
    return await run(req, ObservationAnalysisSchema);
  } catch (err) {
    log.warn('observation.analysis_threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function buildPrompt(text: string, withImage: boolean): string {
  const body = `请解析这条校园动物观察记录：\n"""${text}"""`;
  return withImage
    ? `${body}\n（另附一张同一时刻拍的现场照片，只作补充证据；与正文冲突时以正文为准）`
    : body;
}

/**
 * 把站内已上传的图读成 data URL 交给模型。
 * 读不到 / 太大 / 不是本站文件 → 返回 null，调用方自动走纯文字解析。
 */
async function inlineUpload(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;

  const file = await readOwnUpload(url);
  if (!file) {
    log.warn('observation.vision_skip_unreadable', { url });
    return null;
  }
  if (file.bytes.byteLength > INLINE_IMAGE_MAX_BYTES) {
    log.warn('observation.vision_skip_oversize', {
      url,
      bytes: file.bytes.byteLength,
      limit: Math.min(INLINE_IMAGE_MAX_BYTES, LIMITS.imageBytes),
    });
    return null;
  }

  const base64 = Buffer.from(file.bytes).toString('base64');
  return `data:${file.mimeType};base64,${base64}`;
}
