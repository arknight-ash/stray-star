import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { fail, ok, parseBody } from '@/lib/http';
import { RATE_LIMIT } from '@/lib/constants';
import { clientIpFrom } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { log } from '@/lib/logger';
import { STUDENT_COOKIE, signStudentCookie, studentFromHeader } from '@/lib/auth/student';

export const runtime = 'nodejs';

/**
 * 学生会话接口（与管理端 /api/admin/session 对齐的最小实现）：
 *
 *  POST   { studentId, password, remember? } → bcrypt 校验通过后下发
 *         `ss_student` cookie（httpOnly）。记住账号 = 30 天，否则 12 小时。
 *  GET    → 当前登录状态与昵称（供顶栏/登录页判断，不泄露任何敏感字段）。
 *  DELETE → 退出登录。
 *
 * 失败统一 401 且不区分「学号不存在」与「密码错误」，避免账号枚举。
 */

const BodySchema = z.object({
  studentId: z.string().trim().min(1, '请输入学号 / 用户名').max(64),
  password: z.string().min(1, '请输入密码').max(200),
  remember: z.boolean().optional(),
});

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
};

export async function POST(req: Request): Promise<Response> {
  const ip = clientIpFrom(req.headers);
  const verdict = rateLimit(`studentLogin:${ip}`, RATE_LIMIT.adminLogin);
  if (!verdict.ok) {
    return fail('RATE_LIMITED', `尝试过于频繁，请 ${Math.ceil(verdict.retryAfterMs / 1000)} 秒后再试`);
  }

  const body = await parseBody(req, BodySchema);
  if (!body.ok) return body.response;

  const user = await prisma.user.findFirst({
    where: { OR: [{ studentId: body.data.studentId }, { name: body.data.studentId }] },
    select: { id: true, name: true, studentId: true, password: true },
  });

  // 「学号不存在」与「密码错」都落到同一条话术上
  const badCreds = fail('UNAUTHORIZED', '学号或密码不正确');
  if (!user?.password) {
    log.warn('student.login_failed', { ip });
    return badCreds;
  }

  const passOk = await bcrypt.compare(body.data.password, user.password);
  if (!passOk) {
    log.warn('student.login_failed', { ip, user: user.id });
    return badCreds;
  }

  const maxAge = body.data.remember ? 30 * 24 * 60 * 60 : 12 * 60 * 60;
  const res = ok({ actor: { kind: 'student', name: user.name, studentId: user.studentId } });
  res.cookies.set(STUDENT_COOKIE, signStudentCookie(user.id), { ...COOKIE_OPTS, maxAge });

  log.info('student.login', { ip, user: user.id });
  return res;
}

/** 当前登录状态：顶栏与登录页共用 */
export async function GET(req: Request): Promise<Response> {
  const student = await studentFromHeader(req.headers.get('cookie'));
  return NextResponse.json({
    ok: true,
    data: {
      signedIn: Boolean(student),
      name: student?.name ?? null,
      studentId: student?.studentId ?? null,
    },
    traceId: '',
  });
}

export async function DELETE(req: Request): Promise<Response> {
  const res = ok({ actor: { kind: 'anonymous' } });
  res.cookies.set(STUDENT_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 });
  log.info('student.logout', { ip: clientIpFrom(req.headers) });
  return res;
}
