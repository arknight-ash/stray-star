/**
 * 写接口的 clientId 幂等（30s 窗口）。
 *
 * 抽出来的原因：观察、预警处置、报告复核三处都需要，各写一份 Map 迟早有一处忘了清扫。
 * 只缓存**成功**的结果 —— 失败请求不该被幂等窗口吞掉，否则用户改好了参数也打不开。
 */

const WINDOW_MS = 30_000;
const recent = new Map<string, { at: number; data: unknown }>();

export async function idempotent<T>(key: string | undefined, run: () => Promise<T>): Promise<T> {
  if (!key) return run();
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < WINDOW_MS) return hit.data as T;
  const data = await run();
  recent.set(key, { at: Date.now(), data });
  sweep();
  return data;
}

function sweep(): void {
  if (recent.size < 200) return;
  const now = Date.now();
  for (const [key, value] of recent) {
    if (now - value.at > WINDOW_MS) recent.delete(key);
  }
}
