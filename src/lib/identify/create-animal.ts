import type { Species } from '@/types/domain';
import type { CreateAnimalData } from '@/lib/api/identify-contract';
import { LIMITS } from '@/lib/constants';
import { prisma } from '@/lib/db';
import { writeAudit } from '@/lib/db/audit';
import { toVectorLiteral } from '@/lib/db/vector';
import { formatCode } from '@/lib/format';
import { embedForRetrieval, fingerprintText } from '@/lib/identify/fingerprint';
import { log } from '@/lib/logger';
import { readOwnUpload, saveUpload } from '@/lib/uploads';

/**
 * 建档（可匿名）。
 *
 * 抽成 lib 而不是写在 route 里，是为了让自测能直接命中这条链路：
 * 「识别未登记 → 建档 → 再识别能命中」是整阶段最重要的闭环，
 * 它不该依赖有没有起 HTTP 服务。
 */
export interface CreateAnimalParams {
  file?: File | null;
  /** 复用站内已上传照片时的 URL */
  photoUrl?: string | null;
  name: string;
  species?: Species | null;
  summary?: string | null;
  features?: string[];
  lat?: number | null;
  lng?: number | null;
  ip?: string;
}

export type CreateAnimalResult =
  | { ok: true; data: CreateAnimalData }
  | { ok: false; code: 'BAD_REQUEST' | 'INTERNAL'; message: string };

export async function createAnimal(params: CreateAnimalParams): Promise<CreateAnimalResult> {
  const name = params.name.trim().slice(0, LIMITS.name);
  if (!name) return { ok: false, code: 'BAD_REQUEST', message: '请给它起个名字' };

  const features = (params.features ?? [])
    .map((f) => f.trim().slice(0, LIMITS.featureLen))
    .filter(Boolean)
    .slice(0, LIMITS.featureCount);

  /* ── 照片：上传优先，其次复用站内已存在的 ─────────────────── */
  let photoUrl: string | null = null;
  if (params.file) {
    const saved = await saveUpload(params.file);
    if (!saved.ok) return { ok: false, code: 'BAD_REQUEST', message: saved.message };
    photoUrl = saved.data.url;
  } else if (params.photoUrl) {
    const reused = await readOwnUpload(params.photoUrl);
    if (!reused) return { ok: false, code: 'BAD_REQUEST', message: '引用的照片不存在，请重新上传' };
    photoUrl = params.photoUrl;
  }

  /* ── 特征文本 → 与识别同一个向量出口 ───────────────────────── */
  const embeddingSource = [
    name,
    params.species ? (params.species === 'CAT' ? '猫' : '狗') : '',
    params.summary ?? '',
    ...features,
  ]
    .filter(Boolean)
    .join(' ');
  const embeddingText = embeddingSource.trim() || fingerprintText({ speciesLabel: '', features });

  let vector: number[] | null = null;
  try {
    vector = await embedForRetrieval(embeddingText);
  } catch (err) {
    log.error('animal.embed_failed', { error: err instanceof Error ? err.message : String(err) });
  }

  /* ── 编号：取现有最大值 +1，并发撞唯一键重试三次 ────────────── */
  let created: Awaited<ReturnType<typeof prisma.animal.create>> | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = await nextCode();
    try {
      created = await prisma.animal.create({
        data: {
          code,
          name,
          species: params.species ?? 'CAT',
          avatarUrl: photoUrl,
          healthLevel: 'GREEN',
          summary: params.summary?.slice(0, LIMITS.summary) || null,
          features,
          mapLat: params.lat ?? null,
          mapLng: params.lng ?? null,
          // 匿名建档：必须标记待审核
          pendingReview: true,
        },
      });
      break;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue;
      log.error('animal.create_failed', { error: err instanceof Error ? err.message : String(err) });
      return { ok: false, code: 'INTERNAL', message: '建档失败，请稍后重试' };
    }
  }
  if (!created) return { ok: false, code: 'INTERNAL', message: '建档失败（编号冲突），请重试' };

  let photoId: string | null = null;
  if (photoUrl) {
    const photo = await prisma.animalPhoto.create({
      data: { animalId: created.id, url: photoUrl, confidence: 1, pendingReview: true },
    });
    photoId = photo.id;
    if (vector) {
      const literal = toVectorLiteral(vector);
      await prisma.$executeRaw`UPDATE "AnimalPhoto" SET "embedding" = ${literal}::vector WHERE "id" = ${photo.id}`;
    }
  }
  if (vector) {
    const literal = toVectorLiteral(vector);
    await prisma.$executeRaw`UPDATE "Animal" SET "embedding" = ${literal}::vector WHERE "id" = ${created.id}`;
  }

  await writeAudit({
    actorId: null, // 匿名（S5 接入鉴权后回填）
    action: 'ANIMAL_CREATE',
    targetType: 'Animal',
    targetId: created.id,
    payload: { code: created.code, pendingReview: true, hasPhoto: Boolean(photoUrl), ip: params.ip ?? null },
  });

  return {
    ok: true,
    data: {
      animal: {
        id: created.id,
        code: created.code,
        name: created.name,
        species: created.species,
        avatarUrl: created.avatarUrl,
        healthLevel: created.healthLevel,
        pendingReview: created.pendingReview,
        lastSeenAt: null,
        mapLat: created.mapLat,
        mapLng: created.mapLng,
      },
      photoUrl,
      photoId,
    },
  };
}

async function nextCode(): Promise<string> {
  const rows = await prisma.animal.findMany({ select: { code: true } });
  let max = 0;
  for (const row of rows) {
    const n = Number.parseInt(row.code.replace(/^No\./i, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return formatCode(max + 1);
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && 'code' in err && String((err as { code?: unknown }).code) === 'P2002',
  );
}
