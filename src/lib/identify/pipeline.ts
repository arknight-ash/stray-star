import type { HealthLevel, Species } from '@/types/domain';
import { runVision } from '../ai/registry';
import { SpeciesResultSchema, type SpeciesResult } from '../ai/schemas';
import { prisma } from '../db';
import { writeAudit } from '../db/audit';
import {
  searchAnimalsByEmbedding,
  searchPhotosByEmbedding,
  type AnimalVectorHit,
} from '../db/vector';
import { log } from '../logger';
import { guardInput } from '../ai/provider';
import { moderateText } from '../safety/moderation';
import type { AnimalSummary, IdentifyData, IdentifyInject } from '../api/identify-contract';
import type { ErrCode } from '../http';
import { VISION_TRUST_FLOOR } from '../constants';
import {
  embedForRetrieval,
  fingerprintText,
  keywordQueryText,
  type FingerprintInput,
} from './fingerprint';
import { decide, type IdentifyTier } from './scoring';

/**
 * 识别编排：落盘 → 物种判定 → 视觉指纹 → 双路检索 → 判定 → 审计。
 *
 * 铁律（阶段 1 定下的）：任何一步失败都降级继续并返回结构化结果，
 * 绝不把异常抛到客户端。最坏结果是 tier='new' + degraded 标记，而不是 500。
 */

/**
 * 自测注入口（2026-10-29）。
 *
 * 识别链路是「视觉 → 指纹 → 向量检索 → 综合打分」四段，档位由 scoring 裁决，
 * 不是直接读模型返回值 —— 想稳定造出 matched / candidate / new 三档，
 * 唯一可控的办法是直接喂视觉结论与候选池。
 * 形状在 api/identify-contract 的 IdentifyInjectSchema 定义（唯一来源），
 * 且只有路由在 E2E_TESTS=1 时才会把请求里的 inject 字段解析进来。
 */
export interface IdentifyRequest {
  file?: File | null;
  /** API 层已落盘时的站内 URL；带了就跳过重复落盘 */
  photoUrl?: string | null;
  note?: string | null;
  lat?: number | null;
  lng?: number | null;
  ip?: string;
  inject?: IdentifyInject;
}

export interface IdentifyOutcome {
  data: IdentifyData;
}

export type IdentifyResult =
  | { ok: true; data: IdentifyData }
  | { ok: false; code: ErrCode; message: string; details?: unknown };

const SPECIES_LABEL = { CAT: '猫', DOG: '狗', UNKNOWN: '' } as const;

export async function runIdentify(req: IdentifyRequest): Promise<IdentifyResult> {
  const started = Date.now();
  // 有图 = 本次上传了文件，或复用了站内已存在的照片
  const hasImage = Boolean(req.file && req.file.size > 0) || Boolean(req.photoUrl);
  const rawNote = (req.note ?? '').trim();

  if (!hasImage && !rawNote) {
    return { ok: false, code: 'BAD_REQUEST', message: '请上传一张照片，或至少写一句它的样子' };
  }

  // note 也可以来自姓名/摘要等自由文本，这里统一脱敏；阻断级直接拒绝
  const guarded = guardInput(rawNote);
  if (guarded.blocked) {
    return {
      ok: false,
      code: 'MODERATION_BLOCKED',
      message: '描述里包含不被允许的内容，请修改后再试',
      details: { reasons: guarded.reasons },
    };
  }
  const note = guarded.value.slice(0, 200);

  const degraded = { vision: !hasImage, embedding: false };
  const timing = { vision: 0, embed: 0, search: 0 };

  /* ── 1. 物种判定：失败/超时都不中断 ───────────────────────── */
  let species: SpeciesResult = {
    species: 'UNKNOWN',
    confidence: 0.3,
    features: [],
    note: '未获取到可用图像信息',
  };

  if (req.inject?.species) {
    species = req.inject.species;
  } else if (hasImage) {
    const t0 = Date.now();
    try {
      const image = await loadImageBytes(req.file, req.photoUrl);
      if (!image) {
        // 有图但读不出来（文件被清理 / 不是本站文件）：按无视觉继续，别让整条链路 500
        degraded.vision = true;
        log.warn('identify.vision_no_bytes', { photoUrl: req.photoUrl ?? null });
      } else {
        const base64 = Buffer.from(image.data).toString('base64');
        const prompt = note
          ? `请判断照片中的动物物种与外观特征。现场补充描述：${note}`
          : '请判断照片中的动物物种与外观特征。';

        const result = await runVision(
          { kind: 'base64', data: base64, mimeType: image.mimeType },
          prompt,
          SpeciesResultSchema,
          // 总预算 = 整条降级链（主模型 + 两个备选）各 15s，再留 4s 余量。
          // 单模型单次尝试的预算由 AI_ATTEMPT_TIMEOUT_MS 控制，超时就换下一家，
          // 不会让主模型一个人把总预算吃光（那正是"转 30 秒然后认不出来"的原因）。
          { intent: 'SPECIES', timeoutMs: 40_000 },
        );

        // 契约里 features / note 有 default()，但 Zod 的 input 侧仍是可选的，这里显式兜底
        if (result.ok) {
          species = {
            species: result.data.species,
            confidence: result.data.confidence,
            features: result.data.features ?? [],
            note: result.data.note ?? '',
          };
        } else {
          degraded.vision = true;
          log.warn('identify.vision_failed', { error: result.error, message: result.message });
        }
      }
    } catch (err) {
      degraded.vision = true;
      log.error('identify.vision_threw', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    timing.vision = Date.now() - t0;
  }

  // 只有高置信的视觉输出才有权进入检索查询：低置信时它给出的是泛化词
  // （"短毛""圆脸"之类），实测会把真实命中的覆盖率从 0.85 稀释到 0.5
  const trustVision =
    hasImage &&
    species.species !== 'UNKNOWN' &&
    species.confidence >= VISION_TRUST_FLOOR &&
    species.features.length > 0;

  const fingerprint: FingerprintInput = {
    speciesLabel: SPECIES_LABEL[species.species],
    features: trustVision ? species.features : [],
  };

  /* ── 2. 视觉指纹向量（note 不进向量，只走关键词路） ─────────── */
  let vector: number[] | null = null;
  const tEmbed = Date.now();
  if (trustVision) {
    try {
      vector = await embedForRetrieval(fingerprintText(fingerprint));
    } catch (err) {
      degraded.embedding = true;
      log.error('identify.embed_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  timing.embed = Date.now() - tEmbed;

  /* ── 3. 候选池 ───────────────────────────────────────────────
   * 有可信视觉向量 → 走 pgvector 双路检索（照片 ∪ 个体，按个体去重取最高分）；
   * 没有可信向量 → 退化为全量候选 + 纯关键词比对。
   * 后者不是偷懒：零向量去做 ANN 只会返回「排序无意义的前 N 条」，
   * 库一变大就会漏掉真正相似的那一只。
   */
  const merged = new Map<string, AnimalVectorHit>();
  const tSearch = Date.now();
  const injectedHits = req.inject?.hits;
  if (injectedHits) {
    for (const hit of injectedHits) mergeMax(merged, hit);
  } else {
    if (vector) {
      try {
        const [photos, animals] = await Promise.all([
          searchPhotosByEmbedding(prisma, vector, 8),
          searchAnimalsByEmbedding(prisma, vector, 5),
        ]);
        for (const hit of [...photos, ...animals]) mergeMax(merged, hit);
      } catch (err) {
        log.error('identify.search_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        degraded.embedding = true;
      }
    }
    if (!merged.size) {
      for (const hit of await allCandidates()) mergeMax(merged, hit);
    }
  }
  timing.search = Date.now() - tSearch;

  /* ── 4. 判定 ─────────────────────────────────────────────── */
  const decision = decide({
    hits: [...merged.values()],
    queryText: keywordQueryText(fingerprint, note),
    hasImage,
    trustVision,
    visionSpecies: species.species,
    visionConfidence: species.confidence,
  });

  const tier: IdentifyTier = decision.tier;
  // 落盘通常在 API 层完成（这样类型/体积不合规能直接 400），这里只在缺失时补一次
  const photoUrl = req.photoUrl ?? (hasImage ? await persistPhoto(req.file!, req.ip) : null);

  const base = {
    photoUrl,
    features: species.features,
    uncertain: decision.uncertain,
    degraded,
    timingMs: { total: Date.now() - started, ...timing },
    reasons: decision.reasons,
    ...(note ? { note } : {}),
  };

  const data: IdentifyData =
    tier === 'matched' && decision.top1
      ? {
          ...base,
          tier: 'matched',
          matched: true,
          confidence: round(decision.top1.score),
          animal: toSummary(decision.top1),
        }
      : {
          ...base,
          tier: tier === 'matched' ? 'candidate' : tier,
          matched: false,
          suggestedSpecies: species.species,
          confidence: decision.top1 ? round(decision.top1.score) : 0,
          candidates: decision.candidates.map((c) => ({
            animalId: c.animalId,
            code: c.code,
            name: c.name,
            species: c.species,
            avatarUrl: c.avatarUrl,
            pendingReview: c.pendingReview,
            score: round(c.score),
          })),
        };

  await writeAudit({
    actorId: null, // 当前无登录态（S5 接入后回填）
    action: 'IDENTIFY',
    targetType: 'Animal',
    targetId: tier === 'matched' && decision.top1 ? decision.top1.animalId : null,
    payload: {
      tier,
      score: decision.top1?.score ?? 0,
      reasons: decision.reasons,
      hasImage,
      degraded,
      noteLength: note.length,
      ip: req.ip ?? null,
    },
  });

  return { ok: true, data };
}

/**
 * 取「要送给模型的图」的字节。
 *
 * 两个来源：本次上传的 File（识别页 / 健康页），或站内已有的 photoUrl（星枢工具
 * 复用已落盘照片、结果页「补描述重跑」）。此前这里直接写 `req.file!`，
 * 只有 URL 时拿到 undefined → TypeError 被 catch 成「视觉不可用」，
 * 表现就是「星枢对话里发图永远识别不了」。视觉这一步的取图能力必须归 pipeline 自己，
 * 否则每多一个调用方就要多修一次。
 *
 * photoUrl 只经 readOwnUpload（仅认本站 UUID 文件名），不接受任意外链，避免被当成 SSRF 跳板。
 */
async function loadImageBytes(
  file: File | null | undefined,
  photoUrl: string | null | undefined,
): Promise<{ data: Uint8Array; mimeType: string } | null> {
  if (file && file.size > 0) {
    return { data: new Uint8Array(await file.arrayBuffer()), mimeType: file.type || 'image/jpeg' };
  }
  if (photoUrl) {
    const { readOwnUpload } = await import('../uploads');
    const own = await readOwnUpload(photoUrl);
    if (own) return { data: new Uint8Array(own.bytes), mimeType: own.mimeType };
  }
  return null;
}

/** 把上传的照片留存下来：结果页要复用它做「补描述重跑 / 建档」 */
async function persistPhoto(file: File, ip?: string): Promise<string | null> {
  try {
    const { saveUpload } = await import('../uploads');
    const saved = await saveUpload(file);
    if (!saved.ok) {
      log.warn('identify.persist_rejected', { message: saved.message, ip });
      return null;
    }
    return saved.data.url;
  } catch (err) {
    log.error('identify.persist_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function mergeMax(into: Map<string, AnimalVectorHit>, hit: AnimalVectorHit): void {
  const existing = into.get(hit.id);
  if (!existing || hit.score > existing.score) into.set(hit.id, hit);
}

/** 无可信向量时的兜底候选池：全量个体，vectorScore 记 0 */
async function allCandidates(): Promise<AnimalVectorHit[]> {
  const rows = await prisma.animal.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      species: true,
      avatarUrl: true,
      healthLevel: true,
      pendingReview: true,
      summary: true,
      features: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return rows.map((r) => ({ ...r, score: 0 }));
}

function toSummary(c: {
  animalId: string;
  code: string;
  name: string;
  species: Species;
  avatarUrl: string | null;
  healthLevel: HealthLevel;
  pendingReview: boolean;
}): AnimalSummary {
  return {
    id: c.animalId,
    code: c.code,
    name: c.name,
    species: c.species,
    avatarUrl: c.avatarUrl,
    healthLevel: c.healthLevel,
    pendingReview: c.pendingReview,
    lastSeenAt: null,
    mapLat: null,
    mapLng: null,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** 供 API 层复用的纯文本脱敏（建档也要用） */
export function sanitizeUserText(text: string): ReturnType<typeof moderateText> {
  return moderateText(text);
}
