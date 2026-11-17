import { fail, ok } from '@/lib/http';
import { RATE_LIMIT } from '@/lib/constants';
import { isValidLatLng } from '@/lib/geo';
import { runIdentify } from '@/lib/identify/pipeline';
import { log } from '@/lib/logger';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { readOwnUpload, saveUpload } from '@/lib/uploads';
import {
  IdentifyInjectSchema,
  type IdentifyData,
  type IdentifyInject,
} from '@/lib/api/identify-contract';
import path from 'node:path';

/** Node runtime：需要魔法字节嗅探与 Buffer，Edge 不可用 */
export const runtime = 'nodejs';

/** 幂等窗口：同一 clientId 30s 内直接复用结果，避免重复烧 AI 调用 */
const IDEMPOTENT_WINDOW_MS = 30_000;
const recent = new Map<string, { at: number; data: IdentifyData }>();

export async function POST(req: Request): Promise<Response> {
  const ip = clientIpFrom(req.headers);

  const verdict = rateLimit(`identify:${ip}`, RATE_LIMIT.identify);
  if (!verdict.ok) {
    return fail('RATE_LIMITED', `识别得太快了，请 ${Math.ceil(verdict.retryAfterMs / 1000)} 秒后再试`);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('BAD_REQUEST', '请求格式有误，请使用 multipart/form-data 提交图片');
  }

  let file = asFile(form.get('file'));
  let photoUrl: string | null = null;
  const note = asTrimmed(form.get('note'), 200);
  const fromPhotoUrl = asTrimmed(form.get('fromPhotoUrl'), 300);
  const lat = asNumber(form.get('lat'));
  const lng = asNumber(form.get('lng'));
  const clientId = asTrimmed(form.get('clientId'), 64);

  if (lat !== undefined && lng !== undefined && !isValidLatLng(lat, lng)) {
    return fail('BAD_REQUEST', '定位坐标不合法');
  }

  // 类型与体积校验放在这里：不合规要给 400，而不是静默降级成一个「看不懂的结果」
  if (file) {
    const saved = await saveUpload(file);
    if (!saved.ok) return fail('BAD_REQUEST', saved.message);
    photoUrl = saved.data.url;
  } else if (fromPhotoUrl) {
    const reused = await readOwnUpload(fromPhotoUrl);
    if (!reused) return fail('BAD_REQUEST', '复用的照片不存在，请重新上传');
    photoUrl = fromPhotoUrl;
    file = new File([reused.bytes], path.basename(fromPhotoUrl), { type: reused.mimeType });
  }

  const cacheKey = clientId ? `identify:${clientId}` : null;
  if (cacheKey) {
    const hit = recent.get(cacheKey);
    if (hit && Date.now() - hit.at < IDEMPOTENT_WINDOW_MS) return ok(hit.data);
  }

  /**
   * 自测注入口：只有 E2E_TESTS=1（端到端测试起服务时设的环境变量）才解析这个字段。
   * 生产一律忽略 —— 开着的后果是任何人都能直接指定候选池，把识别结果当旋钮拨。
   * 解析不出来就当没传，绝不给 400：这是测试专用通道，不该把业务请求挡在门外。
   */
  const inject = process.env.E2E_TESTS === '1' ? readInject(form.get('inject')) : undefined;

  const result = await runIdentify({ file, photoUrl, note, lat, lng, ip, inject });
  if (!result.ok) return fail(result.code, result.message, undefined, result.details);

  if (cacheKey) recent.set(cacheKey, { at: Date.now(), data: result.data });
  sweep();

  log.info('identify.done', {
    tier: result.data.tier,
    reasons: result.data.reasons,
    degraded: result.data.degraded,
    totalMs: result.data.timingMs.total,
  });

  return ok(result.data);
}

function asFile(value: FormDataEntryValue | null): File | null {
  if (!value || typeof value === 'string') return null;
  const blob = value as Blob;
  return typeof blob.arrayBuffer === 'function' ? (blob as File) : null;
}

function asTrimmed(value: FormDataEntryValue | null, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
}

function readInject(value: FormDataEntryValue | null): IdentifyInject | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = IdentifyInjectSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function asNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function sweep(): void {
  if (recent.size < 200) return;
  const now = Date.now();
  for (const [key, entry] of recent) {
    if (now - entry.at > IDEMPOTENT_WINDOW_MS) recent.delete(key);
  }
}
