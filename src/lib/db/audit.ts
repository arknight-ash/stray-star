import type { Prisma } from '@prisma/client';
import { prisma } from './index';
import { log } from '../logger';

/** 审计动作枚举：保持动词式、可检索 */
export const AUDIT_ACTIONS = {
  IDENTIFY: 'IDENTIFY',
  ANIMAL_CREATE: 'ANIMAL_CREATE',
  ANIMAL_UPDATE: 'ANIMAL_UPDATE',
  ANIMAL_LOCATION: 'ANIMAL_LOCATION',
  ANIMAL_DELETE: 'ANIMAL_DELETE',
  /** 管理员审核「同学提交的新增动物申请」：approve / reject */
  ANIMAL_REVIEW: 'ANIMAL_REVIEW',
  OBSERVATION_CREATE: 'OBSERVATION_CREATE',
  OBSERVATION_DELETE: 'OBSERVATION_DELETE',
  HEALTH_ASSESS: 'HEALTH_ASSESS',
  REPORT_REVIEW: 'REPORT_REVIEW',
  ALERT_RAISE: 'ALERT_RAISE',
  ALERT_ACK: 'ALERT_ACK',
  ALERT_RESOLVE: 'ALERT_RESOLVE',
  ADMIN_LOGIN: 'ADMIN_LOGIN',
  KNOWLEDGE_INGEST: 'KNOWLEDGE_INGEST',
  MODERATION_BLOCK: 'MODERATION_BLOCK',
  CHAT_ANSWER: 'CHAT_ANSWER',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * 写审计日志。
 * 审计失败不能阻断主流程（日志是旁路），因此内部吞掉异常并记录一条 error。
 */
export async function writeAudit(params: {
  actorId?: string | null;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  payload?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId ?? null,
        payload: params.payload,
      },
    });
  } catch (err) {
    log.error('audit.write_failed', {
      action: params.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
