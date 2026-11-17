import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db';
import { clientIpFrom, actorFromIp, type Actor } from '../permissions';
import { studentFromHeader } from './student';

/**
 * 管理端门禁（阶段 7 立，2026-10-27 改为账号 + 密码）。
 *
 * 为什么不是 NextAuth：本项目此刻还没有会话体系（`actorFromIp()` 恒匿名），
 * 而预警处置又必须知道"是谁关掉了这条 CRITICAL"（R8）。完整鉴权是另一个阶段的事，
 * 这里只补上「管理员是谁」这一层，且刻意做到：
 *  - **失败关闭**：没配密码时任何人都登不进去（不是"没配就能进"）；
 *  - **cookie 里不放凭据**：存的是 `HMAC(secret, 账号\n密码)` 的摘要，
 *    拿到 cookie 也推不出真正的密码，改账号或改密码后旧 cookie 立即失效；
 *  - 比较用 `timingSafeEqual`，不做可被计时攻击区分的短路比较。
 *
 * 接真实鉴权时只需替换本文件的 `resolveActor`，`permissions.ts` 的裁决语义一行不用改。
 */

export const ADMIN_COOKIE = 'ss_admin';

/** 初始账号。没配 ADMIN_ACCOUNT 时就是 admin —— 单管理员场景不必多一个必填变量 */
export const DEFAULT_ADMIN_ACCOUNT = 'admin';

function signingSecret(): string {
  return process.env.NEXTAUTH_SECRET ?? 'stray-star-insecure-dev-secret';
}

export function adminAccount(): string {
  return process.env.ADMIN_ACCOUNT?.trim() || DEFAULT_ADMIN_ACCOUNT;
}

/**
 * 登录密码。优先 `ADMIN_PASSWORD`；没配就回落到旧的管理口令 `ADMIN_TOKEN`。
 *
 * 回落是这次改造的关键：把「只有口令」升级成「账号 + 密码」时，密码值刻意保持不变 ——
 * 用户已经记住的那串口令继续用，只是前面多了个账号。没配密码时返回 null，
 * 门禁直接关闭，绝不退化成"谁都能进"。
 */
export function adminPassword(): string | null {
  const raw = process.env.ADMIN_PASSWORD?.trim() || process.env.ADMIN_TOKEN?.trim();
  return raw ? raw : null;
}

/** 兼容旧调用名（阶段 7 的"口令"只有密码这一半，语义等同 adminPassword） */
export function adminToken(): string | null {
  return adminPassword();
}

/** cookie 应当等于的值；密码未配置时为 null（此时任何 cookie 都不算数） */
export function expectedAdminCookie(): string | null {
  const password = adminPassword();
  if (!password) return null;
  return createHmac('sha256', signingSecret()).update(`${adminAccount()}\n${password}`).digest('hex');
}

/** 账号 + 密码一起校验：任一项错都返回 false，且比较过程不泄露哪一项错了 */
export function verifyAdminCredentials(account: string, password: string): boolean {
  const wantPassword = adminPassword();
  if (!wantPassword) return false;
  const accountOk = safeEqual(account.trim(), adminAccount());
  const passwordOk = safeEqual(password, wantPassword);
  return accountOk && passwordOk;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i += 1) diff |= ba[i]! ^ bb[i]!;
  return diff === 0;
}

export function isAdminCookieValue(value: string | null | undefined): boolean {
  const want = expectedAdminCookie();
  if (!want || !value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 从 Cookie 头里取出本项目的管理端 cookie（不引第三方解析，就这么一个键） */
export function adminCookieFromHeader(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === ADMIN_COOKIE) {
      return part.slice(idx + 1).trim();
    }
  }
  return undefined;
}

let adminIdCache: string | null | undefined;

/**
 * 管理员在 `User` 表里的 id（审计与 `Alert.ackedById` 要落具体的人）。
 * 找不到管理员账号时返回 null —— 那时预警照样能处置，只是处置人留空，
 * 不该因为种子数据没跑就让整个管理端不可用。
 */
export async function adminUserId(): Promise<string | null> {
  if (adminIdCache !== undefined) return adminIdCache;
  const row = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  adminIdCache = row?.id ?? null;
  return adminIdCache;
}

/** 供自测清理缓存（换库/换种子后不该拿着旧 id） */
export function resetAdminIdCache(): void {
  adminIdCache = undefined;
}

/** 接口侧：从请求解析操作者。管理端 cookie 优先，其次学生 cookie，否则按 IP 视为匿名 */
export async function resolveActor(req: Request): Promise<Actor> {
  if (isAdminCookieValue(adminCookieFromHeader(req.headers.get('cookie')))) {
    return { kind: 'admin', id: (await adminUserId()) ?? '', role: 'ADMIN' };
  }
  const student = await studentFromHeader(req.headers.get('cookie'));
  if (student) {
    return { kind: 'student', id: student.id, role: student.role };
  }
  return actorFromIp(clientIpFrom(req.headers));
}

/** 处置人 id：匿名与"查不到管理员账号"两种情况都落 null */
export function actorDbId(actor: Actor): string | null {
  if (actor.kind === 'anonymous') return null;
  return actor.id || null;
}
