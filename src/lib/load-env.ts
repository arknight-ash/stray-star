/**
 * 让 tsx 直接跑的脚本（seed / 自检）也能读到 .env。
 *
 * Next.js 会自己加载 .env.local，Prisma CLI 会自己加载 .env，
 * 但 `tsx prisma/seed.ts` 这类裸跑场景没人加载，所以这里补上。
 * 优先级：进程已有环境变量 > .env.local > .env（都不覆盖已有值）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ENV_FILES = ['.env.local', '.env'];

function parse(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // 成对引号优先：`KEY="值"  # 注释` 这种写法必须只取值、丢掉引号和注释
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      // 未加引号时才按行尾 `#` 注释切（`a#b` 这种值里的 # 不算注释）
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv(cwd: string = process.cwd()): void {
  for (const file of ENV_FILES) {
    let content: string;
    try {
      content = readFileSync(path.join(cwd, file), 'utf8');
    } catch {
      continue; // 文件不存在就跳过
    }
    for (const [key, value] of Object.entries(parse(content))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

// import 即生效：`import '../src/lib/load-env';`
loadEnv();
