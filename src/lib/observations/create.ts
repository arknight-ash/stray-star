import type { Prisma } from '@prisma/client';
import { runStructured } from '../ai/registry';
import { ALERT_NOTICE, MANUAL_SEVERE_NOTICE, FALLBACK_TEXT, HEALTH_WINDOW_DAYS } from '../constants';
import { isWithinFence, readCampusCenter, readCampusRadiusM } from '../geo';
import { log } from '../logger';
import { moderateText } from '../safety/moderation';
import { writeAudit } from '../db/audit';
import { prisma } from '../db';
import { evaluateObservationAlerts, type RaisedAlert } from '../alerts/engine';
import { deriveHealthLevel, type DerivedObservation } from '../health/derive';
import { analyzeObservation } from './analyze';
import type { ObservationData, ObservationForm } from '../api/observation-contract';
import type { ErrCode } from '../http';
import type { AlertLevel, HealthLevel, ObservationType, Severity } from '../../types/domain';

/**
 * 众包观察入库（第 4 阶段欠账，第 5 阶段补做；2026-10-28 改为 AI 主导）。
 *
 * 三条这里的规矩：
 *  1. 分类 / 标签 / 严重度 / 情感全部来自 `analyzeObservation`（一次多模态结构化调用）。
 *     入库层不再接受「用户自己选好的分类」—— 那等于让人替 AI 做它该做的事；
 *  2. AI 解析失败不许丢弃用户的话：正文本身已经存下来了，标签退回 ['未分类']，
 *     并且**不许改健康档**（没有任何结论可以做依据）；
 *  3. `summary` 不自动改写（第 4 阶段 §11 拍板：AI 不许改写人类写的那句状态）。
 */

export type CreateOutcome =
  | { ok: true; data: ObservationData }
  | { ok: false; code: ErrCode; message: string };

/**
 * 注入点（只给自测用；生产调用一律不传）。
 * 与 `lib/health/assess.ts` 同一套理由：抽标签失败、写到一半失败这两条路径必须被真实执行到。
 */
export interface ObservationDeps {
  /** AI 入口，默认 runStructured。自测用它模拟「抽标签挂了」 */
  run?: typeof runStructured;
  /** 事务包装，默认 prisma.$transaction。自测用它模拟「观察写完后升档失败」 */
  transact?: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
}

export async function createObservation(
  input: ObservationForm & { ip?: string | null; imageUrl?: string | null },
  deps: ObservationDeps = {},
): Promise<CreateOutcome> {
  const startedAt = Date.now();
  const run = deps.run ?? runStructured;
  const transact: NonNullable<ObservationDeps['transact']> =
    deps.transact ?? ((fn) => prisma.$transaction(fn));

  const animal = await prisma.animal.findUnique({
    where: { code: input.animalCode },
    select: { id: true, code: true, name: true, healthLevel: true, healthManual: true, summary: true },
  });
  if (!animal) return { ok: false, code: 'NOT_FOUND', message: '这只动物的档案不存在' };

  // 坐标：给了就必须在校园围栏内。围栏外的点对「去哪找它」毫无意义，
  // 还会把地图缩放到别的城市，所以宁可拒绝也不静默存下。
  if (input.lat !== undefined && input.lng !== undefined) {
    const point = { lat: input.lat, lng: input.lng };
    if (!isWithinFence(point, readCampusCenter(), readCampusRadiusM())) {
      return { ok: false, code: 'BAD_REQUEST', message: '这个位置不在校园范围内，请重新定位或去掉位置信息' };
    }
  }

  const guard = moderateText(input.content);
  if (!guard.safe) {
    // 阻断必须留痕（2026-10-29）：此前这里直接 return，事后根本查不到
    // "谁在什么时候、冲着哪只动物提交过被拒的内容"—— 而这正是安全机制最需要证据的地方。
    // 只记命中原因与长度，不存原文：审计表不是脏话仓库。
    await writeAudit({
      actorId: null,
      action: 'MODERATION_BLOCK',
      targetType: 'Observation',
      targetId: animal.id,
      payload: {
        animalCode: input.animalCode,
        reasons: guard.reasons,
        contentLength: input.content.length,
        ip: input.ip ?? null,
      },
    });
    return { ok: false, code: 'MODERATION_BLOCKED', message: FALLBACK_TEXT.moderation_blocked };
  }

  /* ── AI 语义解析：一句话（+ 可选照片）→ 分类 / 标签 / 严重度 / 情感 / 实体 ──
     这里是整条链路的判断中枢。前端没有"选类型""选严重程度"的控件，
     少一次人工转写，也少一处可以和模型结论打架的地方。 */
  const analysisStart = Date.now();
  const outcome = await analyzeObservation({
    text: guard.sanitized,
    imageUrl: input.imageUrl,
    run,
  });
  const { analysis } = outcome;
  const tagsSource: 'ai' | 'fallback' = outcome.source;

  // 同学勾了「情况紧急」（旧客户端/后台兼容通道）：severity 直接钉死为 SEVERE。
  // 现状：客户端 UI 已不再提供这个开关（严重度由 AI 判定）；这里保留是为了不打断
  // 旧版本 App 与 alerts 自测对 R4 的覆盖，标记本身仍单独存一列供事后复盘。
  const manualSevere = input.severe === true;
  const severity: Severity = manualSevere ? 'SEVERE' : analysis.severity;

  // 向严一侧的一致性校正：被判定为 SEVERE 的记录必然涉及健康，
  // 不能出现"严重 + 投喂"这种在时间线上无法解释的组合。
  const type: ObservationType =
    severity === 'SEVERE' && analysis.type !== 'HEALTH' ? 'HEALTH' : analysis.type;

  const corrections = [...analysis.corrections];
  if (manualSevere && analysis.severity !== 'SEVERE') {
    corrections.push(`severity:${analysis.severity}->SEVERE(manual)`);
  }
  if (severity === 'SEVERE' && analysis.type !== 'HEALTH') {
    corrections.push(`type:${analysis.type}->HEALTH(severity=SEVERE)`);
  }

  // 「其他」类的记录入库即为正式，不再挂「待核实」：
  // 它既没有健康结论、也不参与档位派生，留着核实没有可核的东西，
  // 只会让记录列表里浮着一片永远没人去点的黄标，反而把真正待核实的健康上报淹掉。
  // 解析失败退回的 OTHER 不在此列 —— 那种情况连标签都没有，仍要人过一眼。
  const pendingReview: boolean = type !== 'OTHER' || tagsSource === 'fallback';
  const displayName = input.authorName?.trim() || null;
  const point =
    input.lat !== undefined && input.lng !== undefined ? { lat: input.lat, lng: input.lng } : null;
  const imageUrl = input.imageUrl ?? null;

  // 解析失败 → 没有证据，不碰健康档；只做好该做的事：把言论归档。
  // 档位在写入前算：新记录恒为 pendingReview=true，按 derive 原则 3 不参与派生，
  // 所以「先算再一起写」与「写完再算」结果一致，还能让两条写操作进同一个事务。
  const decision =
    tagsSource === 'ai' ? await resolveHealth(animal.id, animal.healthLevel, animal.healthManual) : null;

  let created: Prisma.ObservationGetPayload<{ select: typeof OBS_SELECT }>;
  let alerts: RaisedAlert[] = [];
  try {
    const written = await transact(async (tx) => {
      const row = await tx.observation.create({
        data: {
          animalId: animal.id,
          userId: null,
          authorName: displayName,
          type,
          content: input.content,
          tags: analysis.tags,
          severity,
          manualSevere,
          imageUrl,
          mapLat: point?.lat ?? null,
          mapLng: point?.lng ?? null,
          pendingReview,
          seedKey: null,
        },
        select: OBS_SELECT,
      });

      // 观察与「档案升档」必须一起提交：只落观察不升档，等于记了一笔没人看的账
      if (decision?.changed) {
        await tx.animal.update({ where: { id: animal.id }, data: { healthLevel: decision.level } });
      }

      // 预警与观察同事务（阶段 7）：记下一笔"没人被通知的异常"比整条失败更危险 ——
      // 它看起来已经处理过了。规则自身抛错只记日志，不会把这次提交吞掉。
      const raised = await evaluateObservationAlerts(
        {
          source: 'OBSERVATION',
          animalId: animal.id,
          animalCode: animal.code,
          observationId: row.id,
          severity,
          tags: analysis.tags,
          manualSevere,
        },
        { db: tx },
      );

      return { row, raised };
    });
    created = written.row;
    alerts = written.raised;
  } catch (err) {
    log.error('observation.persist_failed', {
      animalId: animal.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      code: 'INTERNAL',
      message: '这条记录没能保存下来，档案没有被改动，请稍后再试',
    };
  }

  const [observationCount, pendingCount] = await Promise.all([
    prisma.observation.count({ where: { animalId: animal.id } }),
    prisma.observation.count({ where: { animalId: animal.id, pendingReview: true } }),
  ]);

  await writeAudit({
    actorId: null,
    action: 'OBSERVATION_CREATE',
    targetType: 'Animal',
    targetId: animal.id,
    payload: {
      observationId: created.id,
      authorName: displayName,
      anonymous: true,
      tagsSource,
      tags: analysis.tags,
      type,
      severity,
      sentiment: analysis.sentiment,
      // interface 不带索引签名，进 Prisma Json 列前转成纯对象字面量
      entities: analysis.entities.map((e) => ({ kind: e.kind, text: e.text })),
      aiSummary: analysis.summary,
      confidence: analysis.confidence,
      corrections,
      vision: { attempted: outcome.visionAttempted, used: outcome.withImage },
      manualSevere,
      healthChanged: decision?.changed ?? false,
      reason: decision?.reason ?? (tagsSource === 'ai' ? '窗口内无更强证据' : '解析失败，不参与派生'),
      ip: input.ip ?? null,
    },
  });

  if (alerts.length > 0) {
    await writeAudit({
      actorId: null,
      action: 'ALERT_RAISE',
      targetType: 'Alert',
      targetId: alerts[0]!.id,
      payload: {
        source: 'OBSERVATION',
        observationId: created.id,
        levels: alerts.map((a) => a.level),
        alertIds: alerts.map((a) => a.id),
      },
    });
  }

  // 一次提交可能同时踩中 R3 与 R5，但提交者只需要知道"有人被通知了"——
  // 取最严重的一档回传，不把两条待办都塞给他。
  const top = mostSevere(alerts);

  return {
    ok: true,
    data: {
      observation: {
        id: created.id,
        type: created.type,
        content: created.content,
        tags: created.tags,
        severity: created.severity,
        manualSevere: created.manualSevere,
        imageUrl: created.imageUrl,
        pendingReview: created.pendingReview,
        createdAt: created.createdAt.toISOString(),
        authorName: displayName ?? '匿名同学',
      },
      animal: {
        code: animal.code,
        name: animal.name,
        healthLevel: decision?.level ?? animal.healthLevel,
        previousHealthLevel: animal.healthLevel,
        healthChanged: decision?.changed ?? false,
        healthReason: decision?.reason ?? '',
        summary: animal.summary,
        summaryChanged: false,
        observationCount,
        pendingCount,
      },
      toast: `已归档到 ✦ ${animal.name} · ${animal.code} 的档案`,
      alert: top ? { id: top.id, level: top.level as AlertLevel, reason: top.reason } : null,
      // 同学自己勾了「情况紧急」时，把话说得更具体一点：
      // 他要的是"有人正在赶来"，而不是一句笼统的"已通知管理员"。
      notice: top ? (manualSevere ? MANUAL_SEVERE_NOTICE : ALERT_NOTICE) : null,
      /** AI 这次解析的全貌：前端据此展示标签组与「AI 已为你归档」，不自己猜 */
      analysis: {
        type,
        severity,
        tags: analysis.tags,
        sentiment: analysis.sentiment,
        entities: analysis.entities,
        summary: analysis.summary,
        confidence: analysis.confidence,
        source: tagsSource,
        withImage: outcome.withImage,
        visionAttempted: outcome.visionAttempted,
        corrections,
      },
      tagsSource,
      degraded: { tagging: tagsSource === 'fallback', vision: outcome.visionAttempted && !outcome.withImage },
      timingMs: { total: Date.now() - startedAt, tagging: Date.now() - analysisStart },
    },
  };
}

const LEVEL_RANK: Record<string, number> = { INFO: 0, WARN: 1, CRITICAL: 2 };

/** 取最严重的一条：CRITICAL > WARN > INFO */
function mostSevere(alerts: RaisedAlert[]): RaisedAlert | null {
  return alerts.reduce<RaisedAlert | null>(
    (best, a) => (best === null || LEVEL_RANK[a.level]! > LEVEL_RANK[best.level]! ? a : best),
    null,
  );
}

/** 落库后要回给前端的列；抽成常量好让 Prisma 推导出准确类型 */
const OBS_SELECT = {
  id: true,
  type: true,
  content: true,
  tags: true,
  severity: true,
  manualSevere: true,
  imageUrl: true,
  pendingReview: true,
  createdAt: true,
  authorName: true,
} satisfies Prisma.ObservationSelect;

async function resolveHealth(animalId: string, current: HealthLevel, healthManual: boolean) {
  const since = new Date(Date.now() - HEALTH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [observations, openAlerts] = await Promise.all([
    prisma.observation.findMany({
      where: { animalId, createdAt: { gte: since } },
      select: { type: true, severity: true, pendingReview: true, createdAt: true },
    }),
    prisma.alert.findMany({
      where: { animalId, status: { in: ['OPEN', 'ACK'] } },
      select: { level: true },
    }),
  ]);

  const evidence: DerivedObservation[] = observations.map((o) => ({
    type: o.type,
    severity: o.severity,
    pendingReview: o.pendingReview,
    createdAt: o.createdAt,
  }));

  return deriveHealthLevel({
    current,
    healthManual,
    observations: evidence,
    openAlerts: openAlerts.map((a) => a.level as AlertLevel),
  });
}
