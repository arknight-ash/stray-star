import { prisma } from '@/lib/db';
import { ok, fail } from '@/lib/http';
import { log } from '@/lib/logger';

/**
 * 站点计数（页头那枚「已点亮 N 颗」）。
 *
 * 为什么不放在 `(site)/layout.tsx` 里直接查库：那会让每个路由都变成动态渲染，
 * 连 `/design`、`/scan` 这种本来可以静态预渲染的页面也要每次进 Node 查一次库；
 * 而且数据库一挂，全站所有页面都会 500，不只是需要数据的那几页。
 * 这枚数字只是装饰性徽章 —— 用客户端补一次、失败就显示「—」最划算。
 */

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    const animals = await prisma.animal.count();
    const res = ok({ animals });
    // 计数变化很慢：30 秒缓存足够，既不给库添压力，也不会显示明显过期的数
    res.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    return res;
  } catch (e) {
    log.warn('stats.failed', { error: e instanceof Error ? e.message : String(e) });
    return fail('INTERNAL', '统计暂时取不到');
  }
}
