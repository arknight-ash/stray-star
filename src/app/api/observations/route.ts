import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fail, newTraceId, ok, parseBody, zodIssues } from '@/lib/http';
import { RATE_LIMIT, LIMITS } from '@/lib/constants';
import { log } from '@/lib/logger';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { ObservationFormSchema, type ObservationForm } from '@/lib/api/observation-contract';
import { createObservation } from '@/lib/observations/create';
import { movePinToSighting } from '@/lib/animals/location';
import { isOwnUploadUrl, saveUpload, uploadDir } from '@/lib/uploads';

export const runtime = 'nodejs';

/**
 * 众包观察（docs/stage-4-profile.md §7）。
 *
 * 两条入口都支持，因为调用方确实有两类：
 *  - `multipart/form-data`：带 `photo` 的完整表单（规格里的主路径，照片走魔法字节嗅探）；
 *  - `application/json`：便签墙的纯文字快速记录（前端 `RecordBar` 一直在用）。
 * 只做前者会打断正在用的 UI，只做后者等于规格里的 `photo` 字段永远没有落地路径。
 *
 * 幂等按 `clientId` 做 30s 内存窗口：连点两次不该记两条账。
 */

/** 幂等窗口：同一 clientId 30s 内直接复用结果，避免一次误触生成两条便签 */
const IDEMPOTENT_WINDOW_MS = 30_000;
const recent = new Map<string, { at: number; data: unknown }>();

export async function POST(req: Request): Promise<Response> {
  const ip = clientIpFrom(req.headers);

  const verdict = rateLimit(`observation:${ip}`, RATE_LIMIT.observationCreate);
  if (!verdict.ok) {
    return fail('RATE_LIMITED', `记录得太快了，请 ${Math.ceil(verdict.retryAfterMs / 1000)} 秒后再试`);
  }

  const parsed = await readInput(req);
  if (!parsed.ok) return parsed.response;
  const { input, photo } = parsed;

  // 幂等命中要在落盘之前判断：否则重放请求会先存一张永远没人引用的图
  const cacheKey = input.clientId ? `observation:${input.clientId}` : null;
  if (cacheKey) {
    const hit = recent.get(cacheKey);
    if (hit && Date.now() - hit.at < IDEMPOTENT_WINDOW_MS) return ok(hit.data);
  }

  // 先落盘、再入库；入库失败必须把文件删掉，别在 public/uploads 里留孤儿
  let imageUrl: string | null = null;
  if (photo) {
    const saved = await saveUpload(photo);
    if (!saved.ok) return fail('BAD_REQUEST', saved.message);
    imageUrl = saved.data.url;
  }

  const result = await createObservation({ ...input, ip, imageUrl });
  if (!result.ok) {
    if (imageUrl) await discardUpload(imageUrl);
    return fail(result.code, result.message);
  }

  /*
   * 带定位提交的记录要让星图上的点跟着动（2026-10-29）。
   *
   * 之前这里只把 lat/lng 写进观察记录，档案点位纹丝不动 —— 于是「我站在它旁边
   * 记了一笔」在星图上什么也没发生，用户只能再去星枢说一遍。两条入口做同一件事，
   * 就不该有两种结果。
   *
   * 失败不影响本次记录：记录已经落库，点位挪不动只是少了一步副作用，
   * 不该让用户以为整条记录提交失败了。
   */
  if (input.lat !== undefined && input.lng !== undefined) {
    try {
      await movePinToSighting({
        animalCode: result.data.animal.code,
        lat: input.lat,
        lng: input.lng,
        observationId: result.data.observation.id,
        via: 'record',
        source: 'gps',
        accuracyM: input.accuracyM ?? null,
      });
    } catch (err) {
      log.warn('observation.pin_move_failed', {
        code: result.data.animal.code,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (cacheKey) recent.set(cacheKey, { at: Date.now(), data: result.data });
  sweep();

  log.info('observation.created', {
    code: result.data.animal.code,
    tagsSource: result.data.tagsSource,
    healthChanged: result.data.animal.healthChanged,
    withPhoto: Boolean(imageUrl),
    alerted: Boolean(result.data.alert),
    totalMs: result.data.timingMs.total,
  });

  return ok(result.data);
}

type ParsedInput =
  | { ok: true; input: ObservationForm; photo: File | null }
  | { ok: false; response: Response };

async function readInput(req: Request): Promise<ParsedInput> {
  const contentType = req.headers.get('content-type') ?? '';

  if (!contentType.includes('multipart/form-data')) {
    const body = await parseBody(req, ObservationFormSchema);
    return body.ok ? { ok: true, input: body.data, photo: null } : { ok: false, response: body.response };
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, response: fail('BAD_REQUEST', '请求格式有误，请使用 multipart/form-data 提交') };
  }

  // 超长正文按规格「截断不报错」，所以先 slice 再交给 Zod
  const parsed = ObservationFormSchema.safeParse({
    animalCode: asText(form.get('animalCode'), 64),
    content: asText(form.get('content'), LIMITS.observation),
    // 「情况紧急」勾选框：multipart 里只可能是字符串，非真值一律按未勾选处理。
    // 分类与严重度由服务端的 AI 解析决定，前端不再上传 type。
    severe: asBool(form.get('severe')),
    authorName: asText(form.get('authorName'), LIMITS.authorName),
    lat: asNumber(form.get('lat')),
    lng: asNumber(form.get('lng')),
    accuracyM: asNumber(form.get('acc')),
    clientId: asText(form.get('clientId'), 64),
  });

  if (!parsed.success) {
    return {
      ok: false,
      response: fail('BAD_REQUEST', '提交内容不完整', newTraceId(), zodIssues(parsed.error)),
    };
  }

  return { ok: true, input: parsed.data, photo: asFile(form.get('photo')) };
}

/** 入库失败时回收刚写的图；删不掉只记日志，不影响给用户的错误信息 */
async function discardUpload(url: string): Promise<void> {
  if (!isOwnUploadUrl(url)) return;
  try {
    await unlink(path.join(uploadDir(), path.basename(url)));
  } catch (err) {
    log.warn('observation.photo_discard_failed', {
      url,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function asFile(value: FormDataEntryValue | null): File | null {
  if (!value || typeof value === 'string') return null;
  const blob = value as Blob;
  return typeof blob.arrayBuffer === 'function' ? (blob as File) : null;
}

function asText(value: FormDataEntryValue | null, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
}

function asBool(value: FormDataEntryValue | null): boolean | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on' ? true : undefined;
}

function asNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function sweep(): void {
  if (recent.size < 200) return;
  const now = Date.now();
  for (const [key, value] of recent) {
    if (now - value.at > IDEMPOTENT_WINDOW_MS) recent.delete(key);
  }
}
