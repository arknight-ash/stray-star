import { fail } from '@/lib/http';
import { AGENT_LIMITS, FALLBACK_TEXT, RATE_LIMIT } from '@/lib/constants';
import { log } from '@/lib/logger';
import { clientIpFrom } from '@/lib/permissions';
import { guardInput } from '@/lib/ai/provider';
import { rateLimit } from '@/lib/rate-limit';
import { AgentRequestSchema } from '@/lib/api/agent-contract';
import { isValidLatLng } from '@/lib/geo';
import { saveUpload } from '@/lib/uploads';

/**
 * /api/agent 与 /api/agent/stream 共用的入口解析（2026-10-28 抽出）。
 *
 * 抽出来的原因很实际：流式那条路要重写一遍限流、multipart、限张数、内容安全，
 * 而这几件事**必须**与 JSON 那条路完全一致 —— 复制一份出去，迟早一边改一边忘，
 * 变成"流式入口没做敏感过滤"这种事故。所以只留这一份。
 *
 * 顺序也有讲究：先限流（最贵的入口，先挡洪水）→ 再解析表单（含落盘）→
 * 最后内容安全（这一步要调 AI 之前的 Guard，放在落盘之后是必然：
 * 要先把图存下来才能知道图有多大）。
 */
export type ParsedAgentRequest =
  | {
      ok: true;
      message: string;
      clientId?: string;
      /** 已落盘的照片（最多 AGENT_LIMITS.maxPhotos 张，第一张为主图） */
      photoUrls: string[];
      /** 人在回路：每个工具执行前都要用户确认（表单里 confirmEach=1） */
      confirmEach: boolean;
      /**
       * 用户本轮授权的设备定位（2026-10-29）。
       * 前端点了「用当前位置」才会带 lat/lng；坐标合法性在前端已校验一次，
       * 这里再挡一次「明显不是经纬度」的脏值（比如浏览器插件塞进来的字符串）。
       * 是否在校内由业务层用围栏判定 —— 那一步要看服务端配置的中心/半径。
       */
      userLocation?: { lat: number; lng: number; accuracyM?: number | null };
      ip: string;
    }
  | { ok: false; response: Response };

export async function parseAgentRequest(req: Request): Promise<ParsedAgentRequest> {
  const ip = clientIpFrom(req.headers);

  const verdict = rateLimit(`agent:${ip}`, RATE_LIMIT.agent);
  if (!verdict.ok) {
    return {
      ok: false,
      response: fail(
        'RATE_LIMITED',
        `星枢AI忙不过来了，请 ${Math.ceil(verdict.retryAfterMs / 1000)} 秒后再试`,
      ),
    };
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return {
      ok: false,
      response: fail('BAD_REQUEST', '请用表单提交（message 必填，图片走 file / files 字段）'),
    };
  }

  const rawMessage = form.get('message');
  const rawClientId = form.get('clientId');
  const parsed = AgentRequestSchema.safeParse({
    message: typeof rawMessage === 'string' ? rawMessage : '',
    clientId: typeof rawClientId === 'string' && rawClientId ? rawClientId : undefined,
  });
  if (!parsed.success) {
    return { ok: false, response: fail('BAD_REQUEST', parsed.error.issues[0]?.message ?? '消息不合法') };
  }

  /* ── 多图：files 字段可重复，file 为单图旧通道（老客户端与自测都还用它）── */
  const raw: unknown[] = [...form.getAll('files'), form.get('file')];
  const files = raw.filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > AGENT_LIMITS.maxPhotos) {
    return {
      ok: false,
      response: fail('BAD_REQUEST', `最多附 ${AGENT_LIMITS.maxPhotos} 张照片，先传最关键的几张`),
    };
  }

  const photoUrls: string[] = [];
  for (const file of files) {
    const saved = await saveUpload(file);
    if (!saved.ok) return { ok: false, response: fail('BAD_REQUEST', saved.message) };
    photoUrls.push(saved.data.url);
  }

  const { message, clientId } = parsed.data;

  /* ── 敏感过滤（阶段 9 补口）：S8 里工具内部各自过滤，但用户原话直达决策 prompt ── */
  const guard = guardInput(message);
  if (guard.blocked) {
    log.info('agent.moderation_blocked', { ip, reasons: guard.reasons });
    return {
      ok: false,
      response: fail('MODERATION_BLOCKED', FALLBACK_TEXT.moderation_blocked),
    };
  }

  // 定位是可有可无的增强：脏值直接丢弃，别为它把整条对话拒掉
  const userLocation = parsedLocation(form);

  return {
    ok: true,
    message: guard.value,
    ...(clientId ? { clientId } : {}),
    photoUrls,
    // multipart 里只可能是字符串；非 '1' 一律按关闭处理（默认自动执行，不打扰用户）
    confirmEach: form.get('confirmEach') === '1',
    ...(userLocation ? { userLocation } : {}),
    ip,
  };
}

/** 解析前端带上的设备定位。缺、脏、超范围一律返回 undefined，不影响主链路 */
function parsedLocation(form: FormData): { lat: number; lng: number; accuracyM?: number | null } | undefined {
  const rawLat = form.get('lat');
  const rawLng = form.get('lng');
  // 必须两个字段都在：Number(null) 是 0，而 (0,0) 是几内亚湾 —— 一个"合法"的假坐标
  if (typeof rawLat !== 'string' || typeof rawLng !== 'string') return undefined;
  if (!rawLat.trim() || !rawLng.trim()) return undefined;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!isValidLatLng(lat, lng)) return undefined;
  const acc = Number(form.get('acc'));
  // 精度只用于展示与审计，非有限值就当没给
  return Number.isFinite(acc) && acc >= 0 ? { lat, lng, accuracyM: acc } : { lat, lng };
}
