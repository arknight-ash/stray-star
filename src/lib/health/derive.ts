import type { AlertLevel, HealthLevel, ObservationType, Severity } from '../../types/domain';
import { HEALTH_ORDER, SEVERITY_HEALTH, worseHealth } from '../semantic';
import { HEALTH_WINDOW_DAYS } from '../constants';

/**
 * 健康等级派生。
 *
 * 这套规则只实现一次 —— S5 的健康预警规则引擎直接调用本模块，不许重写。
 * 两处各写一份必然漂移，而漂移的表现是「动物平白无故从红变绿」，很难发现。
 *
 * 五条原则（阶段 4 拍板，docs/stage-4-profile.md §4.3 / §11.2）：
 *   0. 管理员手动设定 > 一切自动派生
 *   1. 自由升级：有更严重的证据立刻升
 *   2. 降级要有同类型的正面证据
 *   3. 未核实的记录不参与派生
 *   4. OPEN 预警是地板，只抬不压
 */

export interface DerivedObservation {
  type: ObservationType;
  severity: Severity;
  pendingReview: boolean;
  createdAt: Date;
}

export interface DeriveInput {
  current: HealthLevel;
  /** 管理员锁定时为 true —— 现场结论不该被统计结论推翻 */
  healthManual?: boolean;
  /** 该个体的全部观察（调用方负责查询，本函数只做规则） */
  observations: DerivedObservation[];
  /** 未关闭的预警等级列表 */
  openAlerts?: AlertLevel[];
  now?: Date;
}

export interface DeriveResult {
  level: HealthLevel;
  changed: boolean;
  /** 人可读的原因，写进 AuditLog.payload —— 变更必须能事后解释 */
  reason: string;
}

export function deriveHealthLevel(input: DeriveInput): DeriveResult {
  const { current, observations, openAlerts = [], now = new Date() } = input;

  if (input.healthManual) {
    return {
      level: current,
      changed: false,
      reason: '管理员手动设定，自动派生暂不覆盖',
    };
  }

  const cutoff = now.getTime() - HEALTH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const inWindow = observations.filter((o) => o.createdAt.getTime() >= cutoff);

  // 原则 3：未核实的记录只是「有人这么说」，不是事实依据
  const verified = inWindow.filter((o) => !o.pendingReview);

  // 原则 1：窗口内的最高档，构成了候选项
  const candidate = verified.reduce<HealthLevel>(
    (worst, o) => worseHealth(worst, SEVERITY_HEALTH[o.severity]),
    'GREEN',
  );

  const hasHealthEvidence = verified.some((o) => o.type === 'HEALTH');

  /* 原则 2：降级闸门。
   * 直觉上「新的好转记录应该能覆盖旧的」，但真实场景里
   * 「今天喂了它半碗」证明不了「右后腿外伤好了」。
   * 下调必须来自同类型的正面证据。 */
  if (HEALTH_ORDER[candidate] < HEALTH_ORDER[current]) {
    if (!hasHealthEvidence) {
      return {
        level: current,
        changed: false,
        reason: `近 ${HEALTH_WINDOW_DAYS} 天的记录趋向好转，但没有新的健康确认记录，暂不下调`,
      };
    }
    // 窗口内存在 HEALTH 类记录，但它的严重度不足以支撑当前档时才真正下调
    const worstHealthType = verified
      .filter((o) => o.type === 'HEALTH')
      .reduce<HealthLevel>((worst, o) => worseHealth(worst, SEVERITY_HEALTH[o.severity]), 'GREEN');
    if (HEALTH_ORDER[worstHealthType] >= HEALTH_ORDER[current]) {
      return {
        level: current,
        changed: false,
        reason: `近 ${HEALTH_WINDOW_DAYS} 天内仍有同等程度的健康记录，维持现状`,
      };
    }
    const level = raiseFloor(worstHealthType, openAlerts);
    return {
      level,
      changed: level !== current,
      reason: `存在较轻的健康确认记录，下调至${level === 'GREEN' ? '健康' : '观察'}档`,
    };
  }

  const level = raiseFloor(candidate, openAlerts);

  /* 原则 4：预警兜底。OPEN 的 CRITICAL 不会因为一次「看着还行」的观察就消失 ——
   * 那正是它存在的意义。 */
  if (level === current) {
    const floor = alertFloor(openAlerts);
    if (floor && HEALTH_ORDER[floor] > HEALTH_ORDER[current]) {
      return {
        level: floor,
        changed: true,
        reason: `存在未处理预警，等级不低于${floor === 'RED' ? '预警（红）' : '观察（黄）'}档`,
      };
    }
    if (!verified.length) {
      return { level: current, changed: false, reason: `近 ${HEALTH_WINDOW_DAYS} 天无已核实记录，维持现状` };
    }
    return { level: current, changed: false, reason: '窗口内最高严重度与当前档一致' };
  }

  /* 原因文案要能回答「它为什么变红了」。这里其实是两个不同的驱动因素：
   *  - 证据本身够重：窗口里出现了（已核实的）严重/中等记录；
   *  - 证据不够重，但有未处理预警把下限顶上去了（原则 4）。
   * 之前两种情况都写成「出现严重记录」，审计里看到会以为有人报了重伤，
   * 实际可能只是一条没人处理的旧预警 —— 排查时会走错方向。 */
  const liftedByEvidence = HEALTH_ORDER[candidate] > HEALTH_ORDER[current];

  return {
    level,
    changed: true,
    reason:
      HEALTH_ORDER[level] > HEALTH_ORDER[current]
        ? liftedByEvidence
          ? `近 ${HEALTH_WINDOW_DAYS} 天出现${level === 'RED' ? '严重' : '中等'}记录，升级`
          : `存在未处理预警，等级不低于${level === 'RED' ? '预警（红）' : '观察（黄）'}档`
        : `下调至${level === 'GREEN' ? '健康' : '观察'}档`,
  };
}

/** 预警地板：OPEN 的 CRITICAL/WARN 抬升下限，但不主动压低任何东西 */
function alertFloor(openAlerts: AlertLevel[]): HealthLevel | null {
  if (openAlerts.includes('CRITICAL')) return 'RED';
  if (openAlerts.includes('WARN')) return 'YELLOW';
  return null;
}

function raiseFloor(level: HealthLevel, openAlerts: AlertLevel[]): HealthLevel {
  const floor = alertFloor(openAlerts);
  return floor ? worseHealth(level, floor) : level;
}

/**
 * S5 规则引擎的占位入口：由「现在的健康档」推导该不该发预警。
 * 本阶段不写 Alert 表（预警属 S5），但把换算关系留在这里，
 * 免得 S5 再写一遍不同的映射。
 */
export function alertFor(level: HealthLevel): AlertLevel {
  if (level === 'RED') return 'CRITICAL';
  if (level === 'YELLOW') return 'WARN';
  return 'INFO';
}
