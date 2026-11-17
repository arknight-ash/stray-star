import type { AlertLevel, Role } from '@/types/domain';

/**
 * 权限守卫（阶段 3 引入，S5 接真实鉴权后只需替换 resolveActor）。
 *
 * 为什么现在就写：schema 有了 pendingReview，就必须有人执行它，
 * 否则字段沦为装饰。守卫是纯函数，不依赖 session，可被自测直接断言。
 */

export type Actor =
  | { kind: 'anonymous'; ip?: string }
  | { kind: 'student'; id: string; role: Role }
  | { kind: 'admin'; id: string; role: Role };

export const ANONYMOUS: Actor = { kind: 'anonymous' };

export interface Decision {
  allowed: boolean;
  reason: string;
}

function allow(reason: string): Decision {
  return { allowed: true, reason };
}

function deny(reason: string): Decision {
  return { allowed: false, reason };
}

export function isAnonymous(actor: Actor): boolean {
  return actor.kind === 'anonymous';
}

/* ────────────────── 档案 ────────────────── */

/** 修改他人档案：匿名一律拒绝。登录用户也只能改「已确认」的正式档案，待审核档案由管理员处理。 */
export function canEditAnimal(
  actor: Actor,
  target: { pendingReview?: boolean } = {},
): Decision {
  if (isAnonymous(actor)) return deny('匿名用户不可修改档案，请登录后操作');
  if (actor.kind === 'student' && target.pendingReview) {
    return deny('该档案仍在管理员审核中，暂不可修改');
  }
  return allow('允许修改');
}

/**
 * 删除档案（如「已经找不到的小动物」下架）：**只给管理员**。
 *
 * 2026-10-27 收回：此前短暂放开给登录学生，实测副作用大于收益 ——
 * 档案是共享资产（一个班的同学都在往同一只猫的档案上记），
 * 任何人凭一次误触就能把别人的记录连坐清空，且没有「申请下架」的复核环节。
 * 现在的口径：客户端不提供删除入口；同学发现动物找不到了，交给管理员下架。
 *
 * 兜底不靠身份一项：管理员侧另有二次确认弹窗（DeleteAnimalButton）、
 * 接口限流（RATE_LIMIT.adminAction）与审计留档（ANIMAL_DELETE，含操作人 id）。
 */
export function canDelete(actor: Actor): Decision {
  if (isAnonymous(actor)) return deny('删除档案需要登录，请先登录后操作');
  if (actor.kind !== 'admin') return deny('删除档案由管理员统一处理，如有需要请联系管理员下架');
  return allow('管理员可删除档案');
}

/**
 * 删除一条观察记录：**只给管理员**，客户端不提供删除入口。
 *
 * 与档案同一条理由：记录是别人写在公共档案上的话，删除等于抹掉别人的证词，
 * 只有管理员（知道这条是不实信息或重复提交）才有资格按下。
 */
export function canDeleteObservation(actor: Actor): Decision {
  if (isAnonymous(actor)) return deny('删除记录需要管理员登录');
  if (actor.kind !== 'admin') return deny('只有管理员可以删除记录');
  return allow('管理员可删除记录');
}

/**
 * 审核「同学提交的新增动物申请」（pendingReview 档案的通过/驳回）。
 *
 * 与 canDelete 同级的裁决：通过等于宣布这只动物确实存在并进入正式图鉴，
 * 驳回等于连同它的照片一起删掉 —— 两个方向都不可逆，只能由管理员按下。
 */
export function canReviewAnimal(actor: Actor): Decision {
  if (isAnonymous(actor)) return deny('审核档案需要管理员登录');
  if (actor.kind !== 'admin') return deny('只有管理员可以审核新增动物申请');
  return allow('允许审核');
}

/* ────────────────── 预警 ────────────────── */

/**
 * ACK = 「我已知悉」，允许匿名（学生看到受伤动物时先认领跟进）。
 * RESOLVED = 「这件事结了」，必须有具体责任人。
 * CRITICAL 的最终确认只给管理员：一条紧急预警的关闭等于宣告动物脱离危险，
 * 匿名关掉它会导致后续所有人都看不到，风险不可逆。
 */
export function canAckAlert(actor: Actor, level: AlertLevel): Decision {
  if (isAnonymous(actor)) return allow('匿名可认领跟进（ACK），但不关闭预警');
  return allow(`${level} 预警可由 ${actor.kind} 认领`);
}

export function canResolveAlert(actor: Actor, level: AlertLevel): Decision {
  if (isAnonymous(actor)) return deny('匿名不可最终确认预警，需管理员核实后关闭');
  if (level === 'CRITICAL' && actor.kind !== 'admin') {
    return deny('CRITICAL 预警只能由管理员关闭');
  }
  return allow('允许关闭');
}

/* ────────────────── 健康报告审核（阶段 7） ────────────────── */

/**
 * 关键健康报告的复核开关。
 * 为什么比 ACK 更严：审核通过等于把一份 AI 初筛升格成"已确认事实"，
 * 它会参与后续的健康档派生，所以必须有具体责任人，匿名无权按下这个开关。
 */
export function canReviewReport(actor: Actor): Decision {
  if (isAnonymous(actor)) return deny('匿名不可复核健康报告，需管理员登录');
  if (actor.kind !== 'admin') return deny('只有管理员可以复核健康报告');
  return allow('允许复核');
}

/* ────────────────── 从请求解析 Actor ────────────────── */

/**
 * 本项目还没有 NextAuth session，因此当前恒为匿名。
 * S5 接入鉴权时只需改这里：从 session 读出用户与 role，其余代码不动。
 */
export function actorFromIp(ip?: string): Actor {
  return ip ? { kind: 'anonymous', ip } : ANONYMOUS;
}

/** 取出限流与审计共用的客户端 IP */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? 'unknown';
}
