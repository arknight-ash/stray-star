import { fail, ok } from '@/lib/http';
import { RATE_LIMIT } from '@/lib/constants';
import { log } from '@/lib/logger';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { readOwnUpload, saveUpload } from '@/lib/uploads';
import { HealthAssessRequestSchema } from '@/lib/api/health-contract';
import { assessHealth } from '@/lib/health/assess';
import type { HealthAssessData } from '@/lib/api/health-contract';

/** Node runtime：base64 转换需要 Buffer/文件读 */
export const runtime = 'nodejs';

/** 幂等窗口：同一 clientId 30s 内复用结果，避免重复烧 vision 调用 */
const IDEMPOTENT_WINDOW_MS = 30_000;
const recent = new Map<string, { at: number; data: HealthAssessData }>();

export async function POST(req: Request): Promise<Response> {
  const ip = clientIpFrom(req.headers);

  const verdict = rateLimit(`health:${ip}`, RATE_LIMIT.healthAssess);
  if (!verdict.ok) {
    return fail('RATE_LIMITED', `评估得太快了，请 ${Math.ceil(verdict.retryAfterMs / 1000)} 秒后再试`);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('BAD_REQUEST', '请求格式有误，请使用 multipart/form-data 提交图片');
  }

  const parsed = HealthAssessRequestSchema.safeParse({
    animalId: asTrimmed(form.get('animalId'), 64) || undefined,
    description: asTrimmed(form.get('description'), 400) || undefined,
    fromPhotoUrl: asTrimmed(form.get('fromPhotoUrl'), 300) || undefined,
    clientId: asTrimmed(form.get('clientId'), 64) || undefined,
  });
  if (!parsed.success) {
    return fail('BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数不合法');
  }
  const { animalId, description, fromPhotoUrl, clientId } = parsed.data;

  // 图片可以省（纯描述也能评估），但「既没图也没描述」必须挡在 AI 之前
  const file = asFile(form.get('file'));
  let imageUrl: string | null = null;

  if (file) {
    const saved = await saveUpload(file);
    if (!saved.ok) return fail('BAD_REQUEST', saved.message);
    imageUrl = saved.data.url;
  } else if (fromPhotoUrl) {
    const reused = await readOwnUpload(fromPhotoUrl);
    if (!reused) return fail('BAD_REQUEST', '复用的照片不存在，请重新上传');
    imageUrl = fromPhotoUrl;
  }

  if (!imageUrl && !description) {
    return fail('BAD_REQUEST', '请上传一张照片，或写一句你看到的症状');
  }
  // 归档模式的报告必须带图：HealthReport.imageUrl 是必填列，
  // 而且「多模态健康评估」的前提就是有一张现场照片 —— 纯描述只允许在 preview 模式试算
  if (!imageUrl && animalId) {
    return fail('BAD_REQUEST', '为档案做健康评估需要一张现场照片');
  }

  const cacheKey = clientId ? `health:${clientId}` : null;
  if (cacheKey) {
    const hit = recent.get(cacheKey);
    if (hit && Date.now() - hit.at < IDEMPOTENT_WINDOW_MS) return ok(hit.data);
  }

  const result = await assessHealth({ animalId, description, imageUrl, ip });
  if (!result.ok) return fail(result.code, result.message);

  if (cacheKey) recent.set(cacheKey, { at: Date.now(), data: result.data });
  sweep();

  log.info('health.assess_done', {
    severity: result.data.severity,
    healthStatus: result.data.healthStatus,
    uncertain: result.data.uncertain,
    changed: result.data.healthLevelChanged,
    alerted: Boolean(result.data.alert),
    persisted: result.data.persisted,
    totalMs: result.data.timingMs,
  });

  return ok(result.data);
}

function sweep(): void {
  if (recent.size < 200) return;
  const now = Date.now();
  for (const [key, value] of recent) {
    if (now - value.at > IDEMPOTENT_WINDOW_MS) recent.delete(key);
  }
}

function asFile(value: FormDataEntryValue | null): File | null {
  if (!value || typeof value === 'string') return null;
  return value.size > 0 ? value : null;
}

function asTrimmed(value: FormDataEntryValue | null, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}
