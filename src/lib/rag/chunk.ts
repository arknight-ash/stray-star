/**
 * 知识库切块。
 *
 * 分段策略：**先按【小标题】切，再按长度兜底**。
 *
 * 为什么必须以小标题为界：知识库每篇是 6–7 条 `【小标题】要点` 这种结构，
 * 一个小标题就是一个完整语义单元。最初的实现只按 maxLen=400 聚合，
 * 而每篇整篇才 300 字 —— 结果一篇只切出 1 段，切块表形同虚设，
 * 引用仍然只能指到篇。按小标题切之后「止血」才是一个可被单独引用、单独检索的段，
 * 这正是 A1 决策（docs/stage-6-rag.md §0①）要的收益。
 */
export interface Chunk {
  index: number;
  text: string;
}

/** 小标题行：`【止血】……` */
const HEADING_RE = /^【[^】]*】/;

export function chunkContent(content: string, maxLen = 400): Chunk[] {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // 以小标题为界分组：每条要点自成一块
  const groups: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (HEADING_RE.test(line) && current.length) {
      groups.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) groups.push(current);

  const chunks: Chunk[] = [];
  const push = (text: string) => chunks.push({ index: chunks.length, text });

  for (const group of groups) {
    const text = group.join('\n');
    // 单条要点超过 maxLen（很长的段落）才退化成按行聚合，保证不丢内容
    if (text.length <= maxLen) {
      push(text);
      continue;
    }
    let buf = '';
    for (const line of group) {
      if (buf && (buf + line).length > maxLen) {
        push(buf);
        buf = '';
      }
      buf = buf ? `${buf}\n${line}` : line;
    }
    if (buf) push(buf);
  }

  return chunks;
}

/** 入库用：标题 + 每个块各自生成向量会更准，这里返回待嵌入的文本数组 */
export function chunkForEmbedding(title: string, content: string): Array<{ index: number; text: string }> {
  return chunkContent(content).map((c) => ({
    index: c.index,
    text: `${title}\n${c.text}`,
  }));
}
