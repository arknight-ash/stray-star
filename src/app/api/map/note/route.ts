import { log } from '@/lib/logger';
import { fail, ok } from '@/lib/http';
import { getObservatoryNote } from '@/lib/insight/observatory';

/**
 * GET /api/map/note —— 星图页的「AI 星图观测手记」。
 *
 * 页面本身是服务端组件，直接调 `getObservatoryNote` 就够了；这个接口存在的理由是
 * **让外部定时任务能预热**（例如每晚 20:30 提前算一次，评委打开页面时是即时的），
 * 也给未来「换一条」按钮留了入口。
 *
 * 不加额外限流：缓存与指纹都在 `lib/insight/observatory.ts` 里 ——
 * 同一份数据只有第一次会真的调模型，重复请求拿到的都是缓存。
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const note = await getObservatoryNote();
    return ok(note);
  } catch (err) {
    log.error('observatory.route_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return fail('INTERNAL', '观测手记暂时算不出来，稍后再试');
  }
}
