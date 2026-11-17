import type { Prisma } from '@prisma/client';
import { ALERT_RULE_CONFIG } from '../constants';
import { negativeTagsOf, NEGATIVE_TAGS } from './negative-tags';
import type { AlertLevel, HealthLevel, Severity } from '@/types/domain';

/**
 * 预警规则集（阶段 5 建骨架，阶段 7 扩到观察侧）。
 *
 * 用法：往 `HEALTH_ALERT_RULES` / `OBSERVATION_ALERT_RULES` 里加规则即可，
 * engine.ts 的循环与所有调用点都不用动（R16）。
 *
 * 规则表（阶段 7）：
 *   R1 HEALTH_SEVERE          报告 severity=SEVERE            → CRITICAL
 *   R2 HEALTH_MODERATE_BURST  窗口内 ≥N 次 MODERATE/SEVERE 报告 → WARN
 *   R3 OBS_SEVERE_SINGLE      单条观察 severity=SEVERE         → CRITICAL
 *   R4 OBS_MANUAL_SEVERE      同学手动标记「情况紧急」          → CRITICAL
 *   R5 OBS_NEGATIVE_BURST     窗口内 ≥N 条带负面标签的记录      → WARN
 */

/** 触发来源。落进 `Alert.source`，管理端按它筛「同学上报」与「AI 初筛」 */
export type AlertSource = 'OBSERVATION' | 'HEALTH_REPORT';

/**
 * R4（同学手动标记「情况紧急」）产出的预警的 dedupeKey 前缀。
 *
 * 为什么不新加一列：Alert 表没有 observationId，也就不可能通过关联去查
 * `Observation.manualSevere`；而加列要动 schema 和存量数据。dedupeKey 是规则引擎
 * 自己写下的机器键，前缀即规则身份 —— 用它认领「这条是人喊出来的」，
 * 比拿 reason 做中文匹配稳（reason 是会随文案改动的展示文本）。
 */
export const MANUAL_SEVERE_DEDUPE_PREFIX = 'OBS_MANUAL:';

/** 这条预警是不是「同学手动标记情况紧急」喊出来的 */
export function isManualSevereAlert(row: {
  source?: string | null;
  dedupeKey?: string | null;
}): boolean {
  return row.source === 'OBSERVATION' && (row.dedupeKey ?? '').startsWith(MANUAL_SEVERE_DEDUPE_PREFIX);
}

export interface AlertTriggerInput {
  animalId: string;
  animalCode: string;
  source: AlertSource;
  observationId?: string | null;
  reportId?: string | null;
  severity: Severity;
  /** 观察侧：落库后的标签（AI 抽取，手动标记时不额外塞标签，避免伪造证据） */
  tags?: string[];
  /** 观察侧：同学勾了「情况紧急」。勾选时 severity 已被强制为 SEVERE */
  manualSevere?: boolean;
  /** 报告侧 */
  healthStatus?: HealthLevel;
  needsVet?: boolean;
  confidence?: number;
}

export interface AlertDecision {
  raise: boolean;
  level: AlertLevel;
  reason: string;
  /** 去重键。规则引擎产生的 Alert 的 seedKey 恒为 null，去重只能靠它 */
  dedupeKey: string;
}

/**
 * 规则只需要「读观察 + 读报告」两项能力。
 * 特意不写成 PrismaClient：这样记录与预警能落在**同一个事务**里
 * （见 lib/observations/create.ts 与 lib/health/assess.ts），
 * 否则规则一跑就得跳出事务，事务也就白加了。
 */
export type RuleDb = Pick<Prisma.TransactionClient, 'observation' | 'healthReport'>;

export interface RuleContext {
  /** yyyy-mm-dd（UTC），用于「一天一条」粒度 */
  date: string;
  prisma: RuleDb;
}

export interface AlertRule {
  name: string;
  /** 这条规则只服务哪一类触发源；引擎按它分派，避免报告侧去数观察表 */
  source: AlertSource;
  evaluate(input: AlertTriggerInput, ctx: RuleContext): Promise<AlertDecision>;
}

function noRaise(): AlertDecision {
  return { raise: false, level: 'INFO', reason: '', dedupeKey: '' };
}

function windowStart(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/* ────────────────── 报告侧（阶段 5） ────────────────── */

/**
 * R1 重度异常 → 立刻 CRITICAL。
 * 低置信度也照发：预警的含义是「需要人来看一眼」，不是「已确诊」。
 * 同一只动物同一天只发一条 —— 连续拍五张照片不该刷出五条待办。
 */
export const R1_SEVERE: AlertRule = {
  name: 'HEALTH_SEVERE',
  source: 'HEALTH_REPORT',
  async evaluate(input, ctx) {
    if (input.severity !== 'SEVERE') return noRaise();
    return {
      raise: true,
      level: 'CRITICAL',
      reason: `AI 初筛判定重度异常（${input.animalCode}），${
        (input.confidence ?? 1) < 0.6 ? '置信度偏低，' : ''
      }建议尽快线下核实处置`,
      dedupeKey: `HEALTH_SEVERE:${input.animalId}:${ctx.date}`,
    };
  },
};

/**
 * R2 累计中度异常：窗口内 3 条及以上 MODERATE/SEVERE → WARN。
 * 单条不发：流浪猫偶尔打一次喷嚏不构成事件；一周里三个人分别上报三次，就不再是巧合。
 */
export const R2_MODERATE_BURST: AlertRule = {
  name: 'HEALTH_MODERATE_BURST',
  source: 'HEALTH_REPORT',
  async evaluate(input, ctx) {
    if (input.severity !== 'MODERATE') return noRaise();
    const n = await ctx.prisma.healthReport.count({
      where: {
        animalId: input.animalId,
        createdAt: { gte: windowStart(ALERT_RULE_CONFIG.windowDays) },
        severity: { in: ['MODERATE', 'SEVERE'] },
      },
    });
    if (n < ALERT_RULE_CONFIG.moderateCount) return noRaise();
    return {
      raise: true,
      level: 'WARN',
      reason: `${ALERT_RULE_CONFIG.windowDays} 天内累计 ${n} 次中等及以上异常评估（${input.animalCode}），建议线下核实`,
      dedupeKey: `HEALTH_MOD_BURST:${input.animalId}:${ctx.date}`,
    };
  },
};

/* ────────────────── 观察侧（阶段 7） ────────────────── */

/**
 * R3 单条严重观察 → CRITICAL。
 *
 * 与 R4 互斥：同学手动标记时也必然是 SEVERE（服务端强制），
 * 两条都发等于为同一件事刷出两条待办，所以手动的那份交给 R4，这里让开。
 */
export const R3_OBS_SEVERE: AlertRule = {
  name: 'OBS_SEVERE_SINGLE',
  source: 'OBSERVATION',
  async evaluate(input, ctx) {
    if (input.severity !== 'SEVERE' || input.manualSevere) return noRaise();
    return {
      raise: true,
      level: 'CRITICAL',
      reason: `同学上报严重异常（${input.animalCode}），建议尽快线下核实处置`,
      dedupeKey: `OBS_SEVERE:${input.animalId}:${ctx.date}`,
    };
  },
};

/**
 * R4 同学手动标记「情况紧急」→ CRITICAL。
 *
 * 为什么单列一条而不是合并进 R3：人工判断与 AI 判断的证据强度不同，
 * 管理端要看得出"这条是人说的"，事后复盘也得分得清是谁先发现的。
 */
export const R4_OBS_MANUAL_SEVERE: AlertRule = {
  name: 'OBS_MANUAL_SEVERE',
  source: 'OBSERVATION',
  async evaluate(input, ctx) {
    if (!input.manualSevere) return noRaise();
    return {
      raise: true,
      level: 'CRITICAL',
      reason: `同学手动标记情况紧急（${input.animalCode}），已通知管理员核实`,
      dedupeKey: `${MANUAL_SEVERE_DEDUPE_PREFIX}${input.animalId}:${ctx.date}`,
    };
  },
};

/**
 * R5 负面标签累积 → WARN。
 *
 * 两个约束（都是被误报教出来的）：
 *  1. **当前这条必须自己带负面标签**。否则某天有人写"今天喂了半碗"，
 *     也会因为窗口里躺着两条旧负面记录而再发一条 —— 待办会被无关的日常冲淡；
 *  2. 计数口径默认按**记录条数**（`ALERT_RULE_CONFIG.negativeMode`），
 *     一条长文里写五个负面词只算一次。
 */
export const R5_OBS_NEGATIVE_BURST: AlertRule = {
  name: 'OBS_NEGATIVE_BURST',
  source: 'OBSERVATION',
  async evaluate(input, ctx) {
    const tags = input.tags ?? [];
    if (negativeTagsOf(tags).length === 0) return noRaise();

    const since = windowStart(ALERT_RULE_CONFIG.windowDays);
    let count: number;
    if (ALERT_RULE_CONFIG.negativeMode === 'tags') {
      // 口径 B：窗口内所有记录的负面标签总个数
      const rows = await ctx.prisma.observation.findMany({
        where: { animalId: input.animalId, createdAt: { gte: since } },
        select: { tags: true },
      });
      count = rows.reduce((sum, r) => sum + negativeTagsOf(r.tags).length, 0);
    } else {
      count = await ctx.prisma.observation.count({
        where: {
          animalId: input.animalId,
          createdAt: { gte: since },
          tags: { hasSome: NEGATIVE_TAGS },
        },
      });
    }

    if (count < ALERT_RULE_CONFIG.negativeCount) return noRaise();
    const shown = negativeTagsOf(tags).slice(0, 3).join('、');
    return {
      raise: true,
      level: 'WARN',
      reason: `${ALERT_RULE_CONFIG.windowDays} 天内 ${count} 条带负面标签的记录（${input.animalCode}）：${shown}`,
      dedupeKey: `OBS_NEG:${input.animalId}:${ctx.date}`,
    };
  },
};

/** 新增规则往这里加，顺序无关 */
export const HEALTH_ALERT_RULES: AlertRule[] = [R1_SEVERE, R2_MODERATE_BURST];
export const OBSERVATION_ALERT_RULES: AlertRule[] = [R3_OBS_SEVERE, R4_OBS_MANUAL_SEVERE, R5_OBS_NEGATIVE_BURST];
