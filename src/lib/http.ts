import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { log } from '@/lib/logger';

/** 统一响应信封：成功 {ok,data,traceId}，失败 {ok,error{code,message,details}} */
export type ErrCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'AI_UNAVAILABLE'
  | 'AI_SCHEMA_INVALID'
  | 'MODERATION_BLOCKED'
  | 'INTERNAL';

export interface ApiOk<T> {
  ok: true;
  data: T;
  traceId: string;
}

export interface ApiErr {
  ok: false;
  error: { code: ErrCode; message: string; details?: unknown };
  traceId: string;
}

export type ApiResult<T> = ApiOk<T> | ApiErr;

const STATUS: Record<ErrCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  AI_SCHEMA_INVALID: 502,
  MODERATION_BLOCKED: 422,
  INTERNAL: 500,
};

export function newTraceId(): string {
  return crypto.randomUUID();
}

export function ok<T>(data: T, traceId = newTraceId()): NextResponse<ApiOk<T>> {
  return NextResponse.json({ ok: true, data, traceId });
}

export function fail(
  code: ErrCode,
  message: string,
  traceId = newTraceId(),
  details?: unknown,
): NextResponse<ApiErr> {
  if (STATUS[code] >= 500) log.error('api.error', { code, message, traceId, details });
  else log.warn('api.reject', { code, message, traceId });
  return NextResponse.json({ ok: false, error: { code, message, details }, traceId }, { status: STATUS[code] });
}

/** 解析请求体并校验；失败直接返回 400，details 里带上 Zod issues */
export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse<ApiErr> }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: fail('BAD_REQUEST', '请求体不是合法 JSON') };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: fail('BAD_REQUEST', '请求参数校验失败', newTraceId(), zodIssues(parsed.error)),
    };
  }
  return { ok: true, data: parsed.data };
}

export function zodIssues(err: ZodError) {
  return err.issues.slice(0, 8).map((i) => ({ path: i.path.join('.'), message: i.message }));
}
