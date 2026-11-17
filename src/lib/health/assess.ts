import type { Prisma } from '@prisma/client';
import { HealthAssessmentSchema } from '../ai/schemas';
import { DISCLAIMER, CONFIDENCE_FLOOR, FALLBACK_TEXT, HEALTH_WINDOW_DAYS, TEXT_ONLY_MIN_CHARS, UNCERTAIN_NOTE } from '../constants';
import { log } from '../logger';
import { moderateText } from '../safety/moderation';
import { getProvider, runStructured, resolvePublicUrl } from '../ai';
import { writeAudit } from '../db/audit';
import { prisma } from '../db';
import { deriveHealthLevel, type DerivedObservation } from './derive';
import { reconcileHealth, reviewAdvice, type ReconciledHealth } from './reconcile';
import { evaluateHealthAlerts, type RaisedAlert } from '../alerts/engine';
import type { HealthAssessData } from '../api/health-contract';
import type { ErrCode } from '../http';
import type { AlertLevel, HealthLevel, Severity } from '../../types/domain';

/**
 * 健康评估编排（第 5 阶段）。
 *
 * 三条铁律在这里落地（docs/stage-5-health.md §3.2）：
 *   ⑥ confidence < 0.6 不改档 —— 再严重的 AI 猜测也不能替拥有者改写档案；
 *   ⑦ 变严重直接升档，不需要额外证据 —— 漏报的代价高于误报；
 *   ⑧ 变好必须重算，且窗口内无更严重 HEALTH 证据、无 OPEN 预警才准降 ——
 *      这条完全交给 lib/health/derive.ts，本文件不许另写一套降级逻辑。
 *
 * 另外两条老规矩：summary 不自动改写；一次 AI 评估 ≡ 一条 HEALTH 类证据。
 */

export interface AssessInput {
  animalId?: string | null;
  description?: string | null;
  /**
   * 站内图片地址（已由 uploads.saveUpload 落盘并完成魔法字节校验）。
   * 纯描述的 preview 模式下可以为 null —— 此时不会写库（HealthReport.imageUrl 必填）。
   */
  imageUrl: string | null;
  /**
   * 同一现场的其他视角（2026-10-28 多模态 Agent）。
   * 只作为「多看两张」的增益：某一张读不到就跳过，不让整个评估失败 ——
   * 多角度照片缺失属于信息量下降，不属于错误。
   */
  extraImageUrls?: string[];
  ip?: string | null;
}

export type AssessOutcome =
  | { ok: true; data: HealthAssessData }
  | { ok: false; code: ErrCode; message: string };

/**
 * 注入点（只给自测用；生产调用一律不传，走默认实现）。
 *
 * 为什么留这两个口子：本阶段验收要求「Provider 失败」与「写到一半失败」两条路径
 * 必须被真实执行到，而不是靠读代码相信它。生产代码里没有别的测试开关。
 */
export interface AssessDeps {
  /** AI 入口，默认 runStructured。自测用它模拟 Provider 不可用 / 返回垃圾 */
  run?: typeof runStructured;
  /** 事务包装，默认 prisma.$transaction。自测用它模拟「报告写完后动物更新失败」 */
  transact?: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
}

export async function assessHealth(
  input: AssessInput,
  deps: AssessDeps = {},
): Promise<AssessOutcome> {
  const startedAt = Date.now();
  const degraded: string[] = [];
  const run = deps.run ?? runStructured;
  const transact: NonNullable<AssessDeps['transact']> =
    deps.transact ?? ((fn) => prisma.$transaction(fn));

  const animal = input.animalId
    ? await prisma.animal.findUnique({
        where: { id: input.animalId },
        select: {
          id: true,
          code: true,
          name: true,
          species: true,
          healthLevel: true,
          healthManual: true,
          summary: true,
          features: true,
        },
      })
    : null;

  if (input.animalId && !animal) {
    return { ok: false, code: 'NOT_FOUND', message: '这只动物的档案不存在，可能已被合并或删除' };
  }

  // 图片怎么交给模型：能读到本地文件就塞 base64（公网 Provider 访问不到 /uploads/），
  // 读不到才退回 URL 模式，此时若还没有配 AI_PUBLIC_BASE_URL，必须明确报错而不是等超时。
  const reached = await reachImage(input.imageUrl);
  if (!reached.ok) return { ok: false, code: 'BAD_REQUEST', message: reached.message };

  // 多角度照片：逐张尝试，读不到的直接丢（见 AssessInput.extraImageUrls 的说明）
  const extras: string[] = [];
  for (const url of (input.extraImageUrls ?? []).slice(0, 3)) {
    const extra = await reachImage(url);
    if (extra.ok && extra.image) extras.push(extra.image);
    else log.info('health.extra_image_skipped', { url });
  }

  // 文本先过一遍内容安全：虐待/交易类描述必须在烧 AI 调用之前被挡下来
  if (input.description) {
    const guard = moderateText(input.description);
    if (!guard.safe) {
      log.warn('health.moderation_blocked', { reasons: guard.reasons });
      return { ok: false, code: 'MODERATION_BLOCKED', message: FALLBACK_TEXT.moderation_blocked };
    }
  }

  const prompt = buildPrompt(input.description, animal);

  const vision = await run(
    {
      intent: 'HEALTH',
      prompt,
      imageUrl: reached.image,
      ...(extras.length ? { extraImageUrls: extras } : {}),
    },
    HealthAssessmentSchema,
  );

  /**
   * 只发文字的退路（铁律：任何一步失败都要给一条不依赖图片的出路）。
   *
   * 上游视觉模型过载/超时/返回垃圾时，用户该看到的是「这次只看了你的文字描述」，
   * 而不是一句「健康评估服务暂时不可用」—— 后者等于把整条链路作废，
   * 而学生手上明明有一句现场描述。
   *
   * 三个前提缺一不可：
   *   ① 本来确实带了图（纯文字请求失败没有"更轻的版本"可退）；
   *   ② 文字描述够长（见 TEXT_ONLY_MIN_CHARS，一句「有点不对」不值得再烧一次调用）；
   *   ③ 第一次是视觉侧失败 —— AI_VALIDATION_ERROR 也算：主图让模型吐了垃圾，
   *      换成只读文字往往就正常了，这不算掩盖问题，因为 degraded 会如实记下来。
   */
  let ai = vision;
  let textOnly = false;
  let retriedText = false;
  const fallbackText = input.description?.trim() ?? '';
  if (!vision.ok && reached.image && fallbackText.length >= TEXT_ONLY_MIN_CHARS) {
    retriedText = true;
    log.warn('health.vision_failed_text_retry', {
      error: vision.error,
      provider: vision.provider,
      animalId: animal?.id,
    });
    const retry = await run(
      { intent: 'HEALTH', prompt: buildPrompt(input.description, animal, { withoutImage: true }) },
      HealthAssessmentSchema,
    );
    if (retry.ok) {
      ai = retry;
      textOnly = true;
      degraded.push(`visionUnavailable:${vision.error}`);
    } else {
      log.warn('health.text_retry_failed', { error: retry.error, provider: retry.provider });
    }
  }

  if (!ai.ok) {
    log.warn('health.assess_ai_failed', { error: ai.error, provider: ai.provider, animalId: animal?.id });
    // AI_SCHEMA_INVALID 必须「不写任何健康结论」：宁可让用户重拍，也不存一份格式错位的报告
    const isSchema = ai.error === 'AI_VALIDATION_ERROR';
    return {
      ok: false,
      code: isSchema ? 'AI_SCHEMA_INVALID' : mapAiError(ai.error),
      message: isSchema
        ? '这次 AI 返回的结果格式不正确，已按保守方式处理，没有给出任何健康结论。请重新提交或联系管理员。'
        : retriedText
          // 连「只看文字」都失败了：别再说「可以先补充文字描述」，用户已经写了
          ? '照片和文字这次都没能分析成功，服务可能正在过载。稍后再试一次，或联系管理员。'
          : '健康评估服务暂时不可用，可以先补充文字描述，稍后再试',
    };
  }

  // signals 带了 .default()，Zod 把它算成可选输入；这里补齐再交出去
  const reconciledBase = reconcileHealth({ ...ai.data, signals: ai.data.signals ?? [] });
  /**
   * 只凭文字时置信度封顶到闸门线。
   *
   * 为什么不直接压到闸门以下：升档是安全方向（铁律⑦ —— 漏报的代价高于误报），
   * 一句「流了很多血」本就该把档案推到 RED。
   * 为什么又要封顶：模型这次没看到伤口，它给的 0.9 是错觉；
   * 留着它会把这半份评估伪装成「看过照片的高置信度证据」，后面谁翻审计都看不出差别。
   */
  const reconciled = textOnly
    ? { ...reconciledBase, confidence: Math.min(reconciledBase.confidence, CONFIDENCE_FLOOR) }
    : reconciledBase;
  if (textOnly) log.info('health.text_only_confidence_capped', { confidence: reconciled.confidence });
  if (reconciled.adjusted) {
    log.info('health.reconciled', { reason: reconciled.adjustReason, provider: ai.provider });
  }

  const reviewed = reviewAdvice(reconciled.advice);
  if (reviewed.stripped > 0) {
    degraded.push(`adviceStripped:${reviewed.stripped}`);
  }

  const uncertain = reconciled.confidence < CONFIDENCE_FLOOR;

  // ⑥ 低置信度不碰档案：既不改档，也不让它参与派生（pendingReview=true）
  const decision = animal && !uncertain
    ? await resolveLevelChange(animal.id, animal.healthLevel, animal.healthManual, reconciled.severity)
    : null;

  const persisted = Boolean(animal && input.imageUrl);
  let report: { id: string } | null = null;
  let alerts: RaisedAlert[] = [];

  // 报告 / 档位变更 / 预警必须在同一个事务里提交。
  // 为什么：如果报告写成功、而升档或预警失败，档案里就留下一条「已有 SEVERE 报告但没人知道」的记录 ——
  // 这比整条失败更危险，因为它看起来已经处理过了。
  if (animal && input.imageUrl) {
    // 收窄后固定下来：事务回调是闭包，直接用 input.imageUrl 会退回 string | null
    const imageUrl = input.imageUrl;
    try {
      const written = await transact(async (tx) => {
        const created = await tx.healthReport.create({
          data: {
            animalId: animal.id,
            imageUrl,
            assessment: reconciled.assessment,
            severity: reconciled.severity,
            healthStatus: reconciled.healthStatus,
            needsVet: reconciled.needsVet,
            advice: reviewed.advice,
            confidence: reconciled.confidence,
            disclaimer: DISCLAIMER,
            // 匿名 AI 初筛：一律待管理员复核（R8）。这里不是 pendingReview 列，
            // 语义等价 —— 未复核的报告不该被当成「已确认事实」。
            reviewedByAdmin: false,
            seedKey: null,
          },
          select: { id: true },
        });

        if (decision?.changed) {
          await tx.animal.update({
            where: { id: animal.id },
            data: { healthLevel: decision.level },
          });
        }

        const raised = await evaluateHealthAlerts(
          {
            source: 'HEALTH_REPORT',
            animalId: animal.id,
            animalCode: animal.code,
            reportId: created.id,
            healthStatus: reconciled.healthStatus,
            severity: reconciled.severity,
            needsVet: reconciled.needsVet,
            confidence: reconciled.confidence,
          },
          { db: tx },
        );

        return { created, raised };
      });
      report = written.created;
      alerts = written.raised;
    } catch (err) {
      log.error('health.persist_failed', {
        animalId: animal.id,
        message: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        code: 'INTERNAL',
        message: '这次评估没能保存下来，档案没有被改动，请稍后再试',
      };
    }
  }

  if (report) {
    await writeAudit({
      actorId: null,
      action: 'HEALTH_ASSESS',
      targetType: 'Animal',
      targetId: animal!.id,
      payload: {
        reportId: report.id,
        provider: ai.provider,
        severity: reconciled.severity,
        healthStatus: reconciled.healthStatus,
        needsVet: reconciled.needsVet,
        confidence: reconciled.confidence,
        uncertain,
        adjusted: reconciled.adjusted,
        adjustReason: reconciled.adjustReason ?? null,
        // 这份结论到底有没有看过照片：事后追责时它比 confidence 更能说明问题
        assessedWithoutImage: textOnly,
        degraded,
        previousLevel: animal!.healthLevel,
        healthLevel: decision?.level ?? animal!.healthLevel,
        healthLevelChanged: decision?.changed ?? false,
        reason: decision?.reason ?? (uncertain ? '置信度低于闸门，不参与健康档派生' : 'preview 模式未写库'),
        ip: input.ip ?? null,
      },
    });

    await writeAudit({
      actorId: null,
      action: 'ALERT_RAISE',
      targetType: 'Alert',
      targetId: alerts[0]?.id ?? null,
      payload: {
        source: 'HEALTH_ASSESS',
        reportId: report.id,
        levels: alerts.map((a) => a.level),
        alertIds: alerts.map((a) => a.id),
      },
    });
  }

  return {
    ok: true,
    data: {
      reportId: report?.id ?? null,
      persisted,
      animal: animal ? { id: animal.id, code: animal.code, name: animal.name } : null,
      imageUrl: input.imageUrl,
      assessment: reconciled.assessment,
      healthStatus: reconciled.healthStatus,
      severity: reconciled.severity,
      healthLevel: decision?.level ?? animal?.healthLevel ?? reconciled.healthStatus,
      healthLevelChanged: decision?.changed ?? false,
      advice: reviewed.advice,
      confidence: reconciled.confidence,
      uncertain,
      uncertainNote: uncertain ? UNCERTAIN_NOTE : undefined,
      needsVet: reconciled.needsVet,
      signals: reconciled.signals,
      disclaimer: DISCLAIMER,
      alert: alerts[0] ? { id: alerts[0].id, level: alerts[0].level as AlertLevel, reason: alerts[0].reason } : null,
      degraded,
      timingMs: Date.now() - startedAt,
    },
  };
}

/**
 * 是否要把 Animal.healthLevel 改掉 —— 结论一律来自 deriveHealthLevel。
 *
 * 关键手法：把本次 AI 评估当作一条 HEALTH 类证据塞进同一个函数，
 * 而不是在这里另写「severity → level」的映射。第 4 阶段定下的五条派生原则
 * （手动优先 / 自由升级 / 降级要证据 / 未核实不参与 / 预警是地板）因此自动生效。
 */
async function resolveLevelChange(
  animalId: string,
  current: HealthLevel,
  healthManual: boolean,
  severity: Severity,
): Promise<{ level: HealthLevel; changed: boolean; reason: string }> {
  const since = new Date(Date.now() - HEALTH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [observations, reports, openAlerts] = await Promise.all([
    prisma.observation.findMany({
      where: { animalId, createdAt: { gte: since } },
      select: { type: true, severity: true, pendingReview: true, createdAt: true },
    }),
    prisma.healthReport.findMany({
      where: { animalId, createdAt: { gte: since } },
      select: { severity: true, confidence: true, createdAt: true },
    }),
    prisma.alert.findMany({
      where: { animalId, status: { in: ['OPEN', 'ACK'] } },
      select: { level: true },
    }),
  ]);

  const evidence: DerivedObservation[] = [
    ...observations.map((o) => ({
      type: o.type,
      severity: o.severity,
      pendingReview: o.pendingReview,
      createdAt: o.createdAt,
    })),
    // 历史 AI 报告同样是 HEALTH 类证据；低置信的那几份不算数
    ...reports.map((r) => ({
      type: 'HEALTH' as const,
      severity: r.severity,
      pendingReview: r.confidence < CONFIDENCE_FLOOR,
      createdAt: r.createdAt,
    })),
    { type: 'HEALTH' as const, severity, pendingReview: false, createdAt: new Date() },
  ];

  const result = deriveHealthLevel({
    current,
    healthManual,
    observations: evidence,
    openAlerts: openAlerts.map((a) => a.level as AlertLevel),
  });

  return result;
}

/**
 * 图片交给模型的方式。
 * 本地 /uploads/xxx.jpg 对远端 Provider 是公网不可达的地址，
 * 所以能读到文件就走 base64 data URL（前端已压到 ≤1280，体积可控）。
 */
async function reachImage(
  imageUrl: string | null,
): Promise<{ ok: true; image?: string } | { ok: false; message: string }> {
  // 纯文字也能评估（走 chat 分支）：识别是必须的模态，健康评估不是
  if (!imageUrl) return { ok: true };

  const { readOwnUpload } = await import('../uploads');
  const own = imageUrl.startsWith('/uploads/') ? await readOwnUpload(imageUrl) : null;

  if (own) {
    const base64 = Buffer.from(own.bytes).toString('base64');
    return { ok: true, image: `data:${own.mimeType};base64,${base64}` };
  }

  const absolute = resolvePublicUrl(imageUrl);
  if (absolute.startsWith('/') && getProvider().name !== 'mock') {
    return {
      ok: false,
      message:
        '这张照片无法被 AI 服务读取。请重新上传图片，或在环境变量中配置 AI_PUBLIC_BASE_URL 后重试',
    };
  }
  return { ok: true, image: absolute };
}

function buildPrompt(
  description: string | null | undefined,
  animal: { name: string; code: string; species: string; summary: string | null; features: string[] } | null,
  opts: { withoutImage?: boolean } = {},
): string {
  const parts: string[] = [];
  if (animal) {
    parts.push(`档案：${animal.code} ${animal.name}（${animal.species === 'CAT' ? '猫' : '狗'}）`);
    if (animal.features.length) parts.push(`已知外观：${animal.features.join('、')}`);
    if (animal.summary) parts.push(`最新状态：${animal.summary}`);
  }
  if (description) parts.push(`现场描述：${description}`);
  if (opts.withoutImage) {
    // 退路里必须把「没有照片」说出来：不写这句，模型会照着自己的想象描述伤口，
    // 结论读起来像是看过图，反而比直接报错更危险。
    parts.push('注意：本次没有可用的照片（视觉模型不可用），请只依据上面的文字判断，不要描述看不见的画面。');
    parts.push('confidence 要如实反映「只有文字」这一点，并在 advice 里提醒补拍一张清晰照片。');
  } else if (!parts.length) {
    parts.push('没有文字信息，请只依据照片做判断。');
  }
  parts.push('请输出 JSON 结果。');
  return parts.join('\n');
}

function mapAiError(code: string): ErrCode {
  if (code === 'AI_MODERATION_BLOCKED') return 'MODERATION_BLOCKED';
  if (code === 'AI_TIMEOUT') return 'AI_UNAVAILABLE';
  return 'AI_UNAVAILABLE';
}
