import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db';

/**
 * 学生会话（最小实现，与管理端 `ss_admin` 同一套思路）：
 *
 *  - cookie 里存 `userId.HMAC(secret, "student:"+userId)`，拿不到摘要也推不出
 *    任何秘密；NEXTAUTH_SECRET 换掉后所有旧 cookie 立即失效；
 *  - 校验用 `timingSafeEqual`，不做可被计时攻击区分的短路比较；
 *  - 身份落库：每次请求按 userId 查一次 User（有 Prisma 缓存与连接池，
 *    单机并发下开销可忽略；不做内存缓存是因为改名/禁用要立即生效）。
 *
 * 管理端 cookie 优先级更高：resolveActor 先查管理员再查学生（见 actor.ts）。
 */

export const STUDENT_COOKIE = 'ss_student';

function signingSecret(): string {
  return process.env.NEXTAUTH_SECRET ?? 'stray-star-insecure-dev-secret';
}

/** 生成某个用户的合法 cookie 值：`userId.hmac` */
export function signStudentCookie(userId: string): string {
  const mac = createHmac('sha256', signingSecret()).update(`student:${userId}`).digest('hex');
  return `${userId}.${mac}`;
}

/** 校验 cookie 值是否对某用户合法（常数时间比较） */
function matchesUser(cookieValue: string, userId: string): boolean {
  const idx = cookieValue.indexOf('.');
  if (idx <= 0) return false;
  const claimedId = cookieValue.slice(0, idx);
  const claimedMac = cookieValue.slice(idx + 1);
  if (claimedId !== userId) return false;
  const want = createHmac('sha256', signingSecret()).update(`student:${userId}`).digest('hex');
  const a = Buffer.from(claimedMac);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface StudentIdentity {
  id: string;
  name: string;
  studentId: string;
  role: 'STUDENT' | 'ADMIN';
}

/**
 * 从 Cookie 头解析学生身份。无效 / 未登录 / 用户已不存在 → null。
 * 与管理端不同，这里允许 role 为 ADMIN 的用户以学生身份登录（同一账号体系），
 * 但 resolveActor 只在无管理员 cookie 时才会走到这里。
 */
export async function studentFromHeader(
  header: string | null | undefined,
): Promise<StudentIdentity | null> {
  const raw = cookieValueFromHeader(header);
  if (!raw) return null;
  return studentFromCookieValue(raw);
}

export async function studentFromCookieValue(
  value: string | null | undefined,
): Promise<StudentIdentity | null> {
  if (!value) return null;
  const idx = value.indexOf('.');
  if (idx <= 0) return null;
  const userId = value.slice(0, idx);
  if (!matchesUser(value, userId)) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, studentId: true, role: true },
  });
  if (!user) return null;
  return user;
}

/** 从原始 Cookie 头里取本项目的学生 cookie 值 */
export function cookieValueFromHeader(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === STUDENT_COOKIE) {
      return part.slice(idx + 1).trim();
    }
  }
  return undefined;
}
