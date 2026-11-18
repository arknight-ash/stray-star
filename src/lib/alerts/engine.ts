import type { Prisma } from '@prisma/client';
import { alertFor } from '../health/derive';
import { prisma } from '../db';
import { log } from '../logger';
import {
  HEALTH_ALERT_RULES,
  OBSERVATION_ALERT_RULES,
  type AlertRule,
  type AlertSource,
  type AlertTriggerInput,
  type RuleContext,
} from './rules';

/**
 * 规则执行器（阶段 5 建，阶段 7 扩到观察侧）。
 *
 * 跑完一份规则集，命中的按 dedupeKey upsert 落库。
 * 规则之间不短路：既是一条 SEVERE 又触发了累计阀值，这两个信息应当并存，
 * 而不是让第一条规则 eat 掉第二条（R16）。
 */

/** 引擎需要的三项能力（读观察 + 读报告 + upsert 预警），事务客户端同样满足 */
type AlertDb = Pick<Prisma.TransactionClient, 'alert' | 'observation' | 'healthReport'>;

export interface RaisedAlert {
  id: string;
  level: 'INFO' | 'WARN' | 'CRITICAL';
  reason: string;
  /** upsert 的锚点；理论上非空，但按 select 出来的可空类型如实声明 */
  dedupeKey: string | null;
  source: AlertSource;
}

/**
 * @param options.rules 要跑的规则集（报告侧 / 观察侧各一份）
 * @param options.db 传事务客户端时，预警与业务记录一起提交/回滚；
 *                   不传就是全局 prisma（例如单独跑规则做补发）
 * @param options.date 覆盖「一天一条」的日期（自测用，生产不传）
 */
export async function evaluateAlerts(
  input: AlertTriggerInput,
  options: { rules: AlertRule[]; db?: AlertDb; date?: string },
): Promise<RaisedAlert[]> {
  const db = options.db ?? prisma;
  const ctx: RuleContext = {
    date: options.date ?? new Date().toISOString().slice(0, 10),
    prisma: db,
  };
  const raised: RaisedAlert[] = [];

  for (const rule of options.rules) {
    if (rule.source !== input.source) continue;
    try {
      const decision = await rule.evaluate(input, ctx);
      if (!decision.raise) continue;

      const level = decision.level ?? alertFor(input.healthStatus ?? 'GREEN');
      const saved = await db.alert.upsert({
        where: { dedupeKey: decision.dedupeKey },
        create: {
          animalId: input.animalId,
          level,
          reason: decision.reason,
          dedupeKey: decision.dedupeKey,
          source: input.source,
          // 证据指针：管理端「预警照片」靠它反查那一张具体的图，
          // 而不是退回到动物档案头像（头像和「这次到底发生了什么」经常不是一回事）。
          observationId: input.observationId ?? null,
          reportId: input.reportId ?? null,
          // 规则引擎产生的数据绝不占用 seedKey —— 那是留给种子数据的
          seedKey: null,
        },
        // 已存在的那条只刷新结论，不把它从 ACK/RESOLVED 拽回 OPEN：
        // 「同一天同一规则只发一次」说的是不重复建单，不是让人白处置一次。
        update: {
          reason: decision.reason,
          level,
          // 同一去重键再次命中 = 出现了更新的证据，把指针挪到最新那条；
          // 这次没带 id 时保持原值，不用 null 把已有证据抹掉。
          ...(input.observationId ? { observationId: input.observationId } : {}),
          ...(input.reportId ? { reportId: input.reportId } : {}),
        },
        select: { id: true, level: true, reason: true, dedupeKey: true, source: true },
      });
      raised.push({
        id: saved.id,
        level: saved.level,
        reason: saved.reason,
        dedupeKey: saved.dedupeKey,
        source: (saved.source as AlertSource) ?? input.source,
      });
    } catch (err) {
      // 预警失败不连累主流程：记录已经写好了，别因为规则跑挂就把结论吞掉
      log.error('alert.rule_failed', { rule: rule.name, animalId: input.animalId, message: String(err) });
    }
  }

  return raised;
}

/** 观察写入后的触发入口（lib/observations/create.ts 在事务里调它） */
export function evaluateObservationAlerts(
  input: AlertTriggerInput,
  options: { db?: AlertDb; date?: string } = {},
): Promise<RaisedAlert[]> {
  return evaluateAlerts(input, { ...options, rules: OBSERVATION_ALERT_RULES });
}

/** 健康报告写入后的触发入口（lib/health/assess.ts 在事务里调它） */
export function evaluateHealthAlerts(
  input: AlertTriggerInput,
  options: { db?: AlertDb; date?: string } = {},
): Promise<RaisedAlert[]> {
  return evaluateAlerts(input, { ...options, rules: HEALTH_ALERT_RULES });
}
