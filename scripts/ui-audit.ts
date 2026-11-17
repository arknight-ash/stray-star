/**
 * 全站 UI 一致性自查（阶段 9）。
 *
 * 四组断言（docs/stage-9-wrapup.md §4）：
 *   1. 组件层零硬编码色值 —— 语义色只能从 tokens.css 出，组件里只许 var()/tailwind 类；
 *   2. 语义三色（绿/黄/红）全站单一事实源 —— tokens.css 唯一定义，tailwind 与 semantic.ts 只许引用；
 *   3. 动效降级覆盖 —— globals.css 必须有 prefers-reduced-motion 全局兜底；
 *      用 framer-motion 的文件必须自己接 useReducedMotion（CSS 兜底管不到 JS 动画）；
 *   4. WCAG AA 对比度 —— 正文 ≥4.5:1，大字/图形 ≥3.0:1（拍板 Q3=A，硬阈值）。
 *
 * 运行：npm run ui:audit。不连数据库，纯静态，可随意重跑。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    failures.push(`${label}${detail ? ` —— ${detail}` : ''}`);
    console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`);
  }
}

/* ── 工具函数 ─────────────────────────────────────────────── */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function parseTokens(css: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const m of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

/** 相对亮度（WCAG 2.x 公式） */
function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* ── 1. 组件层零硬编码色值 ────────────────────────────────── */

console.log('\n[1] 组件层零硬编码色值');
const tsxFiles = [...walk(join(SRC, 'components')), ...walk(join(SRC, 'app'))].filter((f) =>
  /\.tsx$/.test(f),
);
const offenders: string[] = [];
for (const f of tsxFiles) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // var(--x) 里的合法；命中的是裸 hex
    if (/#[0-9a-fA-F]{3,8}\b/.test(line) && !line.includes('var(--')) {
      offenders.push(`${relative(SRC, f)}:${i + 1}`);
    }
  });
}
check('组件与页面无裸 hex', offenders.length === 0, offenders.slice(0, 5).join(', '));

/* ── 2. 语义三色单一事实源 ────────────────────────────────── */

console.log('\n[2] 语义三色单一事实源');
const tokensCss = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');
const tokens = parseTokens(tokensCss);
const SEMANTIC = { green: tokens['star-green'], yellow: tokens['star-yellow'], red: tokens['star-red'] } as const;
check(
  'tokens.css 定义了三色',
  Boolean(SEMANTIC.green && SEMANTIC.yellow && SEMANTIC.red),
  JSON.stringify(SEMANTIC),
);

for (const name of ['green', 'yellow', 'red'] as const) {
  const occurrences = (tokensCss.match(new RegExp(`--star-${name}:`, 'g')) ?? []).length;
  check(`--star-${name} 只定义一次`, occurrences === 1, `${occurrences} 次`);
}

// semantic.ts 与其余源码不许再写死这些 hex（tailwind.config 只许 var() 引用）
const hexLiterals = [SEMANTIC.green, SEMANTIC.yellow, SEMANTIC.red].map((h) => h.toLowerCase());
const otherFiles = walk(SRC).filter(
  (f) => /\.tsx?$/.test(f) && !f.endsWith('tokens.css'),
);
const leaks: string[] = [];
for (const f of otherFiles) {
  const text = readFileSync(f, 'utf8').toLowerCase();
  for (const hex of hexLiterals) {
    if (hex && text.includes(hex)) leaks.push(`${relative(SRC, f)} 含 ${hex}`);
  }
}
check('semantic.ts 与业务代码不含三色 hex 字面量', leaks.length === 0, leaks.slice(0, 4).join('; '));

const tailwindCfg = readFileSync(join(ROOT, 'tailwind.config.ts'), 'utf8');
check(
  'tailwind 的 star 色映射走 var()',
  /green:\s*'var\(--star-green\)'/.test(tailwindCfg) &&
    /yellow:\s*'var\(--star-yellow\)'/.test(tailwindCfg) &&
    /red:\s*'var\(--star-red\)'/.test(tailwindCfg),
);

/* ── 3. 动效降级覆盖 ──────────────────────────────────────── */

console.log('\n[3] 动效降级覆盖');
const globals = readFileSync(join(SRC, 'app/globals.css'), 'utf8');
check(
  'globals.css 有 prefers-reduced-motion 全局兜底',
  /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(globals),
);
const keyframes = (globals.match(/@keyframes\s+[\w-]+/g) ?? []).length;
check('CSS keyframes 有定义（全局降级已覆盖它们）', keyframes > 0, `${keyframes} 组`);

const framerFiles = tsxFiles.filter((f) => readFileSync(f, 'utf8').includes('framer-motion'));
for (const f of framerFiles) {
  const text = readFileSync(f, 'utf8');
  check(
    `${relative(SRC, f)}（framer-motion）接了 useReducedMotion`,
    text.includes('useReducedMotion'),
  );
}

/* ── 4. WCAG AA 对比度（拍板 Q3=A：正文 4.5 / 图形 3.0）──── */

console.log('\n[4] WCAG AA 对比度');
const resolve = (name: string): string => {
  const v = tokens[name];
  if (!v) throw new Error(`tokens.css 缺 --${name}`);
  return v.startsWith('#') ? v : (tokens[v.replace('var(--', '').replace(')', '')] ?? v);
};

const textPairs: Array<[string, string, string]> = [
  // [前景, 背景, 说明] —— 正文阈值 4.5
  ['text-hi', 'space-900', '正文亮字 / 最深底'],
  ['text-hi', 'space-800', '正文亮字 / 卡片底'],
  ['text-hi', 'space-700', '正文亮字 / 浮层底'],
  ['text-lo', 'space-900', '次级文字 / 最深底'],
  ['text-lo', 'space-800', '次级文字 / 卡片底'],
  ['ink', 'paper', '手账正文 / 纸面'],
];
const graphicPairs: Array<[string, string, string]> = [
  // 图形与大字阈值 3.0（星点、徽章、状态色在深底上）
  ['star-green', 'space-900', '绿星 / 最深底'],
  ['star-yellow', 'space-900', '黄星 / 最深底'],
  ['star-red', 'space-900', '红星 / 最深底'],
  ['star-green', 'space-800', '绿星 / 卡片底'],
  ['star-yellow', 'space-800', '黄星 / 卡片底'],
  ['star-red', 'space-800', '红星 / 卡片底'],
  ['accent-400', 'space-900', '主行动色 / 最深底'],
];

let textMin = Infinity;
for (const [fg, bg, label] of textPairs) {
  const ratio = contrast(resolve(fg), resolve(bg));
  textMin = Math.min(textMin, ratio);
  check(`${label}: ${ratio.toFixed(2)}:1 ≥ 4.5`, ratio >= 4.5);
}

let graphicMin = Infinity;
for (const [fg, bg, label] of graphicPairs) {
  const ratio = contrast(resolve(fg), resolve(bg));
  graphicMin = Math.min(graphicMin, ratio);
  check(`${label}: ${ratio.toFixed(2)}:1 ≥ 3.0`, ratio >= 3.0);
}

console.log(`\n最紧的正文对比 ${textMin.toFixed(2)}:1，最紧的图形对比 ${graphicMin.toFixed(2)}:1`);

/* ── 汇总 ─────────────────────────────────────────────────── */

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  console.log('失败项：');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
