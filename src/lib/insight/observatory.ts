import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runStructured, type StructuredResult } from '@/lib/ai/registry';
import { ObservatoryNoteSchema, type ObservatoryNote } from '@/lib/ai/schemas';
import { OBSERVATORY } from '@/lib/constants';
import { log } from '@/lib/logger';
import { loadDbSnapshot } from './db-stats';
import type { MapNote } from '@/lib/api/map-note-contract';
import type { AlertLevel, HealthLevel } from '@/types/domain';

/**
 * 「AI 星图观测手记」—— 星图页右栏那句主动总结（2026-10-28）。
 *
 * 为什么要有它：星图此前的 AI 都是被动问答（你问它才答）。这张卡要证明的是另一件事 ——
 * **AI 在看全局**：谁连续几天没出现、哪块角落最近最活跃、还有几条预警没人处理。
 *
 * 三条设计底线（对应项目既有铁律）：
 *   ① **数字由数据库算，模型只负责说人话**。喂给模型的是 `facts`（确定性事实），
 *      它不许自造编号/数字/症状；句子里出现库里没有的编号 → 整句作废走兜底。
 *   ② **不产生新结论**。它只能提醒「建议现场看一眼」，不能诊断、不能改健康档 ——
 *      它一只动物都没看过，凭什么下判断。
 *   ③ **降级必须说出来**。AI 挂了就用规则拼一句（`source:'fallback'`），
 *      UI 会明写「本地摘要」；绝不把兜底的句子伪装成模型写的。
 *
 * 缓存：指纹（数据一变就重算）+ 10 分钟上限，见 `constants.OBSERVATORY`。
 * 这既是"预计算"的落点，也是唯一能挡住「每次刷新烧一次模型调用」的东西。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ObservatoryStar {
  code: string;
  name: string;
  healthLevel: HealthLevel;
  openAlert: { level: AlertLevel; reason: string } | null;
  /** 最近一条记录距今几天；从没有记录时为 null */
  quietDays: number | null;
  /** 近 3 天记录数 */
  obsRecent: number;
  /** 3~10 天前的记录数（活跃度对照） */
  obsBefore: number;
  obsTotal: number;
  /** 为什么进候选（中文，直接进 prompt，让模型的依据可追溯） */
  reasons: string[];
}

/** 喂给模型的全部事实。它会被原样 JSON 化进 context —— 所以只放可核查的东西 */
export interface ObservatoryFacts {
  hourLabel: string;
  totals: {
    total: number;
    green: number;
    yellow: number;
    red: number;
    openAlerts: number;
    todayObs: number;
    observations7d: number;
  };
  /** 近 7 天最活跃的角落（最多 2 个） */
  spots: Array<{ name: string; observations7d: number }>;
  candidates: ObservatoryStar[];
}

export interface ObservatorySnapshot {
  facts: ObservatoryFacts;
  /** 库里真实存在的全部编号：用来判模型有没有编造对象（只给代码用，不进 prompt） */
  knownCodes: string[];
  fingerprint: string;
}

export interface ObservatoryDeps {
  db?: PrismaClient;
  /** 自测注入时钟：不要让「几天没出现」依赖跑测试的那一天 */
  now?: Date;
  /** 自测注入 AI：生产永远不传，走 runStructured */
  run?: typeof runStructured;
  /** 自测注入首屏预算（毫秒）：生产走 `OBSERVATORY.renderBudgetMs` */
  budgetMs?: number;
}

/** 数据没变就不重算；变了立刻重算。这是"预计算"的全部实现，别在页面里再写一套 */
let cache: { fingerprint: string; at: number; data: MapNote } | null = null;

/** 自测用：清掉模块级缓存，否则第二次断言会直接命中上一次的结果 */
export function resetObservatoryCache(): void {
  cache = null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export async function loadObservatorySnapshot(
  deps: ObservatoryDeps = {},
): Promise<ObservatorySnapshot> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const sinceBaseline = new Date(now.getTime() - OBSERVATORY.baselineDays * DAY_MS);
  const sinceRecent = new Date(now.getTime() - OBSERVATORY.recentDays * DAY_MS);

  // 总量与角落活跃度一律取自 db-stats：星图、图鉴、星枢问答用的是同一份口径，
  // 这里若自己再算一遍，迟早出现「星图说 5 条、问答说 4 条」。
  const [base, animals, lastSeen, windowObs, openAlerts] = await Promise.all([
    loadDbSnapshot({ db, now }),
    db.animal.findMany({ select: { id: true, code: true, name: true, healthLevel: true } }),
    db.observation.groupBy({
      by: ['animalId'],
      _max: { createdAt: true },
      _count: { _all: true },
    }),
    db.observation.findMany({
      where: { createdAt: { gte: sinceBaseline } },
      select: { animalId: true, createdAt: true },
    }),
    db.alert.findMany({
      where: { status: 'OPEN' },
      select: { animalId: true, level: true, reason: true },
    }),
  ]);

  const lastSeenMap = new Map(lastSeen.map((r) => [r.animalId, r]));
  const recentCount = new Map<string, number>();
  const beforeCount = new Map<string, number>();
  for (const o of windowObs) {
    if (o.createdAt >= sinceRecent) {
      recentCount.set(o.animalId, (recentCount.get(o.animalId) ?? 0) + 1);
    } else {
      beforeCount.set(o.animalId, (beforeCount.get(o.animalId) ?? 0) + 1);
    }
  }
  // 同一只星多条预警时只留最严重的一条：prompt 里堆三条重复的「有预警」不会让它更聪明
  const alertOrder: Record<AlertLevel, number> = { CRITICAL: 3, WARN: 2, INFO: 1 };
  const alertMap = new Map<string, { level: AlertLevel; reason: string }>();
  for (const a of openAlerts) {
    const prev = alertMap.get(a.animalId);
    if (!prev || alertOrder[a.level] > alertOrder[prev.level]) {
      alertMap.set(a.animalId, { level: a.level, reason: a.reason });
    }
  }

  const scored = animals.map((a) => {
    const seen = lastSeenMap.get(a.id);
    const lastAt = seen?._max.createdAt ?? null;
    const quietDays = lastAt ? daysBetween(lastAt, now) : null;
    const obsRecent = recentCount.get(a.id) ?? 0;
    const obsBefore = beforeCount.get(a.id) ?? 0;
    const alert = alertMap.get(a.id) ?? null;

    const reasons: string[] = [];
    let score = 0;
    if (alert) {
      score += alert.level === 'CRITICAL' ? 100 : alert.level === 'WARN' ? 80 : 50;
      reasons.push(
        `挂着一条未处理${alert.level === 'CRITICAL' ? '紧急' : alert.level === 'WARN' ? '提醒' : '通知'}预警（${alert.reason}）`,
      );
    }
    if (a.healthLevel === 'RED') {
      score += 60;
      reasons.push('健康档是预警档');
    } else if (a.healthLevel === 'YELLOW') {
      score += 40;
      reasons.push('健康档处于观察档');
    }
    // 只有"曾经被记录过"的星才谈得上活跃度下降：从没记录过的是未点亮，不是变安静
    if (seen && quietDays !== null) {
      if (quietDays >= OBSERVATORY.quietDays * 2) {
        score += 35;
        reasons.push(`已 ${quietDays} 天没有新记录`);
      } else if (quietDays >= OBSERVATORY.quietDays) {
        score += 25;
        reasons.push(`已 ${quietDays} 天没有新记录`);
      }
      if (obsRecent === 0 && obsBefore >= 2) {
        score += 30;
        reasons.push(`活跃度下降（近 ${OBSERVATORY.recentDays} 天 0 条，之前 ${obsBefore} 条）`);
      } else if (obsRecent === 0 && obsBefore === 1) {
        score += 15;
        reasons.push(`近 ${OBSERVATORY.recentDays} 天没有新记录`);
      }
    }

    const star: ObservatoryStar = {
      code: a.code,
      name: a.name,
      healthLevel: a.healthLevel,
      openAlert: alert,
      quietDays,
      obsRecent,
      obsBefore,
      obsTotal: seen?._count._all ?? 0,
      reasons,
    };
    return { star, score };
  });

  const candidates = scored
    .filter((s) => s.score > 0 && s.star.obsTotal > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, OBSERVATORY.maxCandidates)
    .map((s) => s.star);

  const facts: ObservatoryFacts = {
    hourLabel: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    totals: {
      total: base.animals.total,
      green: base.animals.green,
      yellow: base.animals.yellow,
      red: base.animals.red,
      openAlerts: base.alerts.open,
      todayObs: base.observations.today,
      observations7d: base.observations.last7d,
    },
    spots: base.spots
      .filter((s) => s.observations > 0)
      .sort((x, y) => y.observations - x.observations)
      .slice(0, 2)
      .map((s) => ({ name: s.name, observations7d: s.observations })),
    candidates,
  };

  const fingerprint = createHash('sha1')
    .update(
      JSON.stringify({
        hour: Math.floor(now.getTime() / OBSERVATORY.ttlMs),
        totals: facts.totals,
        spots: facts.spots,
        candidates: candidates.map((c) => [c.code, c.quietDays, c.obsRecent, c.openAlert?.level ?? null]),
      }),
    )
    .digest('hex')
    .slice(0, 16);

  return { facts, knownCodes: animals.map((a) => a.code), fingerprint };
}

export async function getObservatoryNote(deps: ObservatoryDeps = {}): Promise<MapNote> {
  const now = deps.now ?? new Date();
  const snapshot = await loadObservatorySnapshot(deps);
  const window = {
    label: `近 ${OBSERVATORY.baselineDays} 天记录 · ${OBSERVATORY.recentDays} 天活跃度对比`,
    total: snapshot.facts.totals.total,
    openAlerts: snapshot.facts.totals.openAlerts,
    observations7d: snapshot.facts.totals.observations7d,
    ttlMinutes: Math.round(OBSERVATORY.ttlMs / 60000),
  };

  if (cache && cache.fingerprint === snapshot.fingerprint) {
    const ttl = cache.data.source === 'ai' ? OBSERVATORY.ttlMs : OBSERVATORY.failTtlMs;
    if (now.getTime() - cache.at < ttl) return { ...cache.data, cached: true };
  }

  const run = deps.run ?? runStructured;
  const aiPromise = run(
    {
      intent: 'OBSERVATORY',
      prompt: '请根据 facts 写一条此刻的星图观测手记。',
      context: { ...snapshot.facts },
      // 页面是同步等的：宁可给本地摘要，也不让首屏为这句话多等十几秒
      timeoutMs: OBSERVATORY.aiTimeoutMs,
    },
    ObservatoryNoteSchema,
  );

  // 首屏预算（2026-10-28）：`aiTimeoutMs` 只保证"不会等十几秒"，可上游一过载就会稳定慢满 6 秒。
  // 等不到就先交本地摘要；AI 的答案落地后自己写进缓存，下次进页面看到的就是模型那句。
  const budgetMs = deps.budgetMs ?? OBSERVATORY.renderBudgetMs;
  const ai = await raceBudget(aiPromise, budgetMs);

  if (!ai) {
    log.warn('observatory.note_pending', { budgetMs });
    const pending: MapNote = {
      ...fallbackNote(snapshot, ['ai:pending'], now),
      window,
      fingerprint: snapshot.fingerprint,
      cached: false,
    };
    cache = { fingerprint: snapshot.fingerprint, at: now.getTime(), data: pending };
    void aiPromise
      .then((late) => {
        // 只回填「还是这一份数据、而且没被别的请求抢先写成 AI 版」的缓存
        if (cache?.fingerprint !== snapshot.fingerprint || cache.data.source === 'ai') return;
        const filled = composeNote(snapshot, late, window, new Date());
        if (filled.source === 'ai') cache = { ...cache, at: Date.now(), data: filled };
      })
      .catch(() => {});
    return pending;
  }

  const note = composeNote(snapshot, ai, window, now);
  cache = { fingerprint: snapshot.fingerprint, at: now.getTime(), data: note };
  return note;
}

/** 一次 AI 结果的落点：能用就用，不能用就静默换本地摘要 —— 两条路都过了防幻觉校验 */
function composeNote(
  snapshot: ObservatorySnapshot,
  ai: StructuredResult<ObservatoryNote>,
  window: MapNote['window'],
  at: Date,
): MapNote {
  const base = { window, fingerprint: snapshot.fingerprint, cached: false };
  if (ai.ok) {
    const normalized = normalizeAiNote(ai.data, snapshot);
    if (normalized)
      return { ...normalized, ...base, source: 'ai', degraded: [], generatedAt: at.toISOString() };
    log.warn('observatory.note_invalid', { provider: ai.provider, headline: ai.data.headline });
    return { ...fallbackNote(snapshot, ['note:unknown_code_or_empty'], at), ...base };
  }
  log.warn('observatory.ai_failed', { error: ai.error, provider: ai.provider });
  return { ...fallbackNote(snapshot, [`ai:${ai.error}`], at), ...base };
}

/**
 * 预算竞速：`ms` 内没回来就返回 null（**不取消**原 Promise，让它继续跑完去填缓存）。
 * 计时器 unref —— 自测里失败路径不该为了等一个空计时器多挂 2.5 秒。
 */
async function raceBudget<T>(task: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([task, budget]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 模型的句子能不能用：编号是不是真的、有没有内容。不能用的整句作废，不做局部修补 */
function normalizeAiNote(
  data: ObservatoryNote,
  snapshot: ObservatorySnapshot,
): Pick<MapNote, 'text' | 'focus' | 'signals'> | null {
  const text = stripObservePrefix(data.headline);
  if (text.length < 6) return null;

  const known = new Set(snapshot.knownCodes);
  const mentioned = text.match(/No\.\d{2,3}/gi) ?? [];
  if (mentioned.some((code) => !known.has(normalizeCode(code, snapshot.knownCodes)))) return null;

  const factsNumbers = collectNumbers(snapshot.facts);
  if (!numbersAreGrounded(text, factsNumbers)) return null;
  if (!alertTalkGrounded(text, snapshot.facts.totals.openAlerts)) return null;

  const focusStar = data.focusCode
    ? snapshot.facts.candidates.find((c) => c.code.toLowerCase() === data.focusCode!.toLowerCase())
    : undefined;

  const signals = (data.signals ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    // 依据里也不能出现不存在的编号；单条作废比整句作废轻
    .filter((s) => (s.match(/No\.\d{2,3}/gi) ?? []).every((c) => known.has(normalizeCode(c, snapshot.knownCodes))))
    .filter((s) => numbersAreGrounded(s, factsNumbers) && alertTalkGrounded(s, snapshot.facts.totals.openAlerts))
    .slice(0, 4);

  return {
    text,
    focus: focusStar
      ? { code: focusStar.code, name: focusStar.name, healthLevel: focusStar.healthLevel }
      : null,
    signals,
  };
}

/**
 * facts 里出现过的所有数字（含时间、天数窗口）。
 *
 * 为什么要把"天数窗口"也放进来：模型很自然会写「近 7 天」「3 天活跃度对比」，
 * 这些数字不在 totals 里，但它们是 prompt 的一部分，属于合法引用。
 */
function collectNumbers(facts: ObservatoryFacts): Set<string> {
  const out = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) out.add(String(value));
    else if (typeof value === 'string') {
      for (const m of value.match(/\d+/g) ?? []) out.add(m);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(facts);
  out.add(String(OBSERVATORY.recentDays));
  out.add(String(OBSERVATORY.baselineDays));
  out.add(String(OBSERVATORY.quietDays));
  // 「近 7 天」是全站固定口径（db-stats 的 last7d），星图与问答都这么说
  out.add('7');
  return out;
}

/**
 * 数字必须有出处。
 *
 * 实测踩到的坑：模型把「健康档 RED 的有 2 只」写成了「全场 2 条 RED 预警」——
 * 数字是对的，含义是编的。单靠数字白名单抓不住它，所以下面还有一条口径检查；
 * 而这条检查负责的是另一种更常见的漂移：凭空写出「30 天」「第 3 次」这类不存在的量。
 */
function numbersAreGrounded(text: string, allowed: Set<string>): boolean {
  // 编号里的数字不是"数量"，先摘掉再判
  const stripped = text.replace(/No\.\d{2,3}/gi, ' ');
  for (const m of stripped.match(/\d+/g) ?? []) {
    if (!allowed.has(m)) return false;
  }
  return true;
}

/** 没有未处理预警时，句子里不许出现「预警」—— 健康档的"红"不是预警 */
function alertTalkGrounded(text: string, openAlerts: number): boolean {
  if (openAlerts > 0) return true;
  // 明说「暂无预警 / 没有预警」是合规的：它说的正是事实
  const withoutDenial = text.replace(/(暂无|没有|无)\s*预警/g, ' ');
  return !withoutDenial.includes('预警');
}

/** 模型常把编号写成小写 no.003；比对前统一成库里的写法 */
function normalizeCode(raw: string, knownCodes: string[]): string {
  return knownCodes.find((c) => c.toLowerCase() === raw.toLowerCase()) ?? raw;
}

/**
 * 去掉开头的「AI 观测：」——卡片标题已经写了这四个字，正文再来一遍是重复。
 * 只吃这一个前缀（含全角/半角冒号与空格变体），不做别的改写：模型的话不许被 UI 润色。
 */
function stripObservePrefix(headline: string): string {
  return headline.replace(/^\s*(AI\s*观测|观测手记)\s*[：:]\s*/i, '').trim();
}

/** 兜底：用事实拼一句。宁可朴素，也不能没有依据或假装是 AI 写的 */
function fallbackNote(
  snapshot: ObservatorySnapshot,
  degraded: string[],
  now: Date,
): Pick<MapNote, 'text' | 'focus' | 'signals' | 'source' | 'degraded' | 'generatedAt'> {
  const { hourLabel, totals, spots, candidates } = snapshot.facts;
  const alertStar = candidates.find((c) => c.openAlert) ?? null;
  const top = alertStar ?? candidates[0] ?? null;

  /** 这只星"为什么要看"：优先说多久没记录，没有就到健康档。绝不硬凑一句「已 0 天没记录」 */
  const why = (star: ObservatoryStar): string => {
    if (star.quietDays !== null && star.quietDays >= 1) return `已 ${star.quietDays} 天没有新记录`;
    if (star.openAlert) return '还挂着一条未处理预警';
    return star.healthLevel === 'RED' ? '健康档是预警档' : '健康档处于观察档';
  };

  let text: string;
  if (totals.openAlerts > 0 && top) {
    text =
      `${hourLabel}，全场还有 ${totals.openAlerts} 条未处理预警，` +
      `${top.name}（${top.code}）${why(top)}，建议先去现场核实。`;
  } else if (totals.red + totals.yellow > 0 && top) {
    text =
      `${hourLabel}，${totals.red + totals.yellow} 颗星处于观察或预警档，` +
      `${top.name}（${top.code}）${why(top)}，可以补一次现场记录。`;
  } else if (spots.length > 0) {
    text =
      `${hourLabel}，全场 ${totals.total} 颗星都处于稳定档，` +
      `${spots[0]!.name}附近近期最活跃（${spots[0]!.observations7d} 条记录）。`;
  } else {
    text = `${hourLabel}，全场 ${totals.total} 颗星都处于稳定档，暂无待处理事项。`;
  }

  return {
    text,
    focus: top ? { code: top.code, name: top.name, healthLevel: top.healthLevel } : null,
    signals: [
      `未处理预警 ${totals.openAlerts} 条`,
      `近 7 天记录 ${totals.observations7d} 条`,
    ],
    source: 'fallback',
    degraded,
    generatedAt: now.toISOString(),
  };
}
