import { RATE_LIMIT, LIMITS } from '@/lib/constants';
import { isValidLatLng, isWithinFence, readCampusCenter, readCampusRadiusM } from '@/lib/geo';
import { fail, ok } from '@/lib/http';
import { createAnimal } from '@/lib/identify/create-animal';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { guardInput } from '@/lib/ai/provider';

/** Node runtime：落盘依赖 Node API */
export const runtime = 'nodejs';

/** POST multipart：建档。匿名允许，但产物一律 pendingReview = true。 */
export async function POST(req: Request): Promise<Response> {
  const ip = clientIpFrom(req.headers);

  const verdict = rateLimit(`animal:${ip}`, RATE_LIMIT.animalCreate);
  if (!verdict.ok) {
    return fail('RATE_LIMITED', `建档操作过于频繁，请 ${Math.ceil(verdict.retryAfterMs / 1000)} 秒后再试`);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('BAD_REQUEST', '请求格式有误，请使用 multipart/form-data 提交');
  }

  const file = asFile(form.get('file'));
  const photoUrl = asText(form.get('fromPhotoUrl'), 300);
  const name = asText(form.get('name'), LIMITS.name);
  const speciesRaw = asText(form.get('species'), 8);
  const summary = asText(form.get('summary'), LIMITS.summary);
  const lat = asNumber(form.get('lat'));
  const lng = asNumber(form.get('lng'));
  const features = collectFeatures(form, LIMITS.featureCount, LIMITS.featureLen);

  if (!name) return fail('BAD_REQUEST', '请给它起个名字');

  // 内容安全：姓名/简介/特征全部过一遍，命中阻断级直接拒绝
  const checked = guardInput([name, summary ?? '', ...features].join('\n'));
  if (checked.blocked) {
    return fail('MODERATION_BLOCKED', '档案内容包含不被允许的表述，请修改后再试', undefined, {
      reasons: checked.reasons,
    });
  }

  const species = parseSpecies(speciesRaw);
  if (speciesRaw && !species) return fail('BAD_REQUEST', '物种只支持 CAT 或 DOG');

  if ((lat === undefined) !== (lng === undefined)) {
    return fail('BAD_REQUEST', '经纬度必须成对提供');
  }
  if (lat !== undefined && lng !== undefined) {
    if (!isValidLatLng(lat, lng)) return fail('BAD_REQUEST', '定位坐标不合法');
    if (!isWithinFence({ lat, lng }, readCampusCenter(), readCampusRadiusM())) {
      return fail('BAD_REQUEST', '定位超出校园范围，请在校内拍摄或留空坐标');
    }
  }

  const result = await createAnimal({
    file,
    photoUrl,
    name,
    species,
    summary,
    features,
    lat,
    lng,
    ip,
  });

  if (!result.ok) return fail(result.code, result.message);
  return ok(result.data);
}

function parseSpecies(raw: string | undefined): 'CAT' | 'DOG' | null | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if (upper === 'CAT' || upper === 'DOG') return upper;
  return null;
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

function asNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function collectFeatures(form: FormData, maxCount: number, maxLen: number): string[] {
  const raw = [
    ...form.getAll('features'),
    ...(typeof form.get('featuresCsv') === 'string' ? [form.get('featuresCsv') as string] : []),
  ].flatMap((v) => (typeof v === 'string' ? v.split(/[,，\n]/) : []));

  const out: string[] = [];
  for (const part of raw) {
    const text = part.trim().slice(0, maxLen);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= maxCount) break;
  }
  return out;
}
