/**
 * 确定性「手抖」：便签倾角、贴纸转角。
 *
 * 为什么不能用 Math.random()：服务端渲染出一版、客户端 hydration 时算出另一版，
 * React 会直接抛 hydration mismatch。这类 UI 抖动必须由 id 唯一决定，
 * 两端算出同一个值才算数。
 *
 * 之所以不复用 lib/ai/embedding-local.ts 的 hash32：那是 AI 层的实现细节，
 * 展示层依赖它是反向依赖。复制这十几行比跨层引用便宜得多。
 */

/** FNV-1a 32 位：短字符串分布足够均匀，且无需依赖外部实现 */
export function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 由 id 决定 [-spread, +spread] 的整数倾角 */
export function rotateFor(id: string, spread = 3): number {
  return (hash32(id) % (spread * 2 + 1)) - spread;
}

/** 微小位移（px），用于让散落的便签不至于排得像表格 */
export function offsetFor(id: string, spread = 4): number {
  return (hash32(`${id}#off`) % (spread * 2 + 1)) - spread;
}
