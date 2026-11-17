import { NextResponse } from 'next/server';
import { fail, ok, parseBody } from '@/lib/http';
import { z } from 'zod';
import { RATE_LIMIT } from '@/lib/constants';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { log } from '@/lib/logger';
import { writeAudit } from '@/lib/db/audit';
import {
  ADMIN_COOKIE,
  adminAccount,
  adminPassword,
  adminUserId,
  expectedAdminCookie,
  isAdminCookieValue,
  adminCookieFromHeader,
  verifyAdminCredentials,
} from '@/lib/auth/actor';

export const runtime = 'nodejs';

/**
 * 管理端登录（阶段 7 §1-Q1，2026-10-27 由「管理口令」升级为「账号 + 密码」）。
 *
 * POST   { account, password } → 账号与密码都正确则下发 `ss_admin` cookie（httpOnly，12 小时）；
 * DELETE                       → 退出。
 *
 * 初始账号 `admin`，密码沿用原口令（`ADMIN_PASSWORD` 未配置时回落到 `ADMIN_TOKEN`），
 * 所以老用户不需要记新密码，只是登录框多了一个账号。
 *
 * 失败一律 401 且**不区分"账号错""密码错""没配置"**，避免把服务器配置情况泄露给探测者。
 * cookie 里存的是 HMAC 摘要而不是凭据本身（见 lib/auth/actor.ts）。
 */

const BodySchema = z.object({
  account: z.string().trim().min(1, '请输入管理员账号').max(64),
  password: z.string().min(1, '请输入密码').max(200),
});

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 12 * 60 * 60,
  secure: process.env.NODE_ENV === 'production',
};

export async function POST(req: Request): Promise<Response> {
  const ip = clientIpFrom(req.headers);
  const verdict = rateLimit(`adminLogin:${ip}`, RATE_LIMIT.adminLogin);
  if (!verdict.ok) {
    return fail('RATE_LIMITED', `尝试过于频繁，请 ${Math.ceil(verdict.retryAfterMs / 1000)} 秒后再试`);
  }

  const body = await parseBody(req, BodySchema);
  if (!body.ok) return body.response;

  if (!adminPassword()) {
    log.warn('admin.login_disabled', { ip });
    return fail('UNAUTHORIZED', '管理端未启用（服务端未配置管理员密码）');
  }

  if (!verifyAdminCredentials(body.data.account, body.data.password)) {
    log.warn('admin.login_failed', { ip, account: body.data.account.slice(0, 32) });
    return fail('UNAUTHORIZED', '账号或密码不正确');
  }

  const cookie = expectedAdminCookie();
  if (!cookie) return fail('UNAUTHORIZED', '管理端未启用（服务端未配置管理员密码）');

  const res = ok({ actor: { kind: 'admin', role: 'ADMIN', account: adminAccount() } });
  res.cookies.set(ADMIN_COOKIE, cookie, COOKIE_OPTS);

  const adminId = await adminUserId();
  await writeAudit({
    actorId: adminId,
    action: 'ADMIN_LOGIN',
    targetType: 'User',
    targetId: adminId,
    payload: { ip, account: adminAccount() },
  });

  return res;
}

export async function DELETE(req: Request): Promise<Response> {
  const res = ok({ actor: { kind: 'anonymous', role: null } });
  res.cookies.set(ADMIN_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 });
  log.info('admin.logout', { ip: clientIpFrom(req.headers) });
  return res;
}

/** 供页面判断"当前是否已登录"：只读 cookie，不泄露口令状态 */
export async function GET(req: Request): Promise<Response> {
  const signedIn = isAdminCookieValue(adminCookieFromHeader(req.headers.get('cookie')));
  return NextResponse.json({ ok: true, data: { signedIn }, traceId: '' });
}
