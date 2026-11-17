/** 展示格式化：时间、坐标、置信度。等宽数字用于观测数据感。 */

export function formatConfidence(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

export function formatCode(n: number): string {
  return `No.${String(n).padStart(3, '0')}`;
}

export function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatRelative(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDate(date);
}

export function formatCoord(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

/**
 * `10-25 12:46`（本地时区）。
 *
 * 为什么不直接用上面的 `formatDate`：Intl 的 zh-CN 输出是 `10/25 12:46`，
 * 斜杠在密集的表格/列表里比短横线更容易和分组线混在一起（管理端列表用的就是它）。
 */
export function formatShortTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/**
 * 取「第一句话」，超长时才省略。
 *
 * 为什么不能硬 slice：标题要能读懂。「今天下午在图书馆北侧花坛看到它，吃了…」
 * 从 20 字处切断会留下半句话，而时间线标题恰恰是最需要一眼读懂的地方。
 * 按句末标点切；找不到标点才退回硬切（避免遇到整段无标点的长文本时失控）。
 */
export function firstSentence(text: string, max = 34): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return trimmed;

  const cut = trimmed.slice(0, max);
  const stop = /[。！？!?；;\n]/;
  const at = [...cut].reverse().findIndex((ch, i) => stop.test(ch));
  if (at >= 0) {
    const index = cut.length - 1 - at;
    // 标点出现在很靠前的位置（<8 字）说明是异常输入，宁可硬切也不要 3 个字的标题
    if (index >= 8) return `${cut.slice(0, index + 1)}`;
  }
  return `${cut}…`;
}
