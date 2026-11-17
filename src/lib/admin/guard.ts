import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, adminPassword, isAdminCookieValue } from '@/lib/auth/actor';

/**
 * 管理端页面门禁（2026-10-27 抽出，供 (panel) 下每个页面调用）。
 *
 * 为什么不只在 layout 里判断：App Router 的 layout 与 page 是并行渲染的，
 * 只在 layout 拦一道，页面里的查库仍然会先跑。放在每个页面第一行，
 * 「未登录 → 一行数据都不查、一个字节都不渲染」这条语义才成立。
 *
 * 未配置密码时不跳登录页 —— 那时候登录也进不来，直接去登录页只会让人反复输密码，
 * 由调用方展示「未启用」的说明块更清楚。
 */
export function requireAdmin(): void {
  if (!adminPassword()) return; // 由页面自己渲染「未启用」提示
  const cookie = cookies().get(ADMIN_COOKIE)?.value;
  if (!isAdminCookieValue(cookie)) redirect('/admin/login');
}

/** 管理端是否已完成配置（密码存在） */
export function adminConfigured(): boolean {
  return Boolean(adminPassword());
}
