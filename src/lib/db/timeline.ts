import { firstSentence } from '../format';
import { ALERT_TO_HEALTH, SEVERITY_HEALTH } from '../semantic';
import { prisma } from './index';
import type { HealthLevel, ObservationType, Severity, TimelineIcon, TimelineKind } from '@/types/domain';

/**
 * 手账时间线：把四类来源压成一个形状。
 *
 * 为什么要在服务端就做完映射：tone/标题这些一旦散落到组件里，
 * 「同样一条严重记录」在便签墙上和时间线上就会长出两套颜色和说法。
 * 组件只按 kind 决定渲染，不参与任何判断。
 */

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  at: string;
  icon: TimelineIcon;
  /** 语义色在服务端算完，组件不许再算 */
  tone: HealthLevel;
  title: string;
  body?: string;
  tags: string[];
  authorName?: string;
  statusLabel?: string;
  pendingReview: boolean;
  /** 众包照片（仅观察条目有）。null/undefined → 时间线不渲染图片位 */
  imageUrl?: string | null;
  meta?: {
    confidence?: number;
    severity?: Severity;
    advisory?: boolean;
    /** AI 判定的健康档与就医建议（第 5 阶段新增，供健康报告条目的贴纸取色） */
    healthStatus?: HealthLevel;
    needsVet?: boolean;
    /** 阶段 9：审核三态。REJECTED 时时间线打「已驳回」红徽标 */
    reviewStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  };
}

const TITLE_MAX = 34;

/**
 * 标题之外的续文。
 *
 * 曾经的写法是「title=首句（超长截断）+ body=全文」，短记录靠组件里一句
 * `body !== title` 挡住重复；但标题一旦被截断，两者就不相等了，
 * 于是同一句话在时间线上出现两遍（前一遍还带着省略号）。这里改成：
 * body 只放标题没覆盖到的部分，拼接起来正好是完整原文，永远不重叠。
 */
function bodyAfter(text: string, title: string): string | undefined {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed === title) return undefined;

  const head = title.replace(/…$/, '');
  if (head && trimmed.startsWith(head)) {
    const rest = trimmed.slice(head.length).trim();
    return rest || undefined;
  }
  // 标题不是正文前缀（理论上不该发生）：宁可整段给出，也不丢信息
  return trimmed;
}

const ICON_BY_TYPE: Record<ObservationType, TimelineIcon> = {
  FEEDING: 'feeding',
  HEALTH: 'health',
  BEHAVIOR: 'behavior',
  OTHER: 'note',
};

const ALERT_STATUS_LABEL: Record<string, string> = {
  OPEN: '待处理',
  ACK: '跟进中',
  RESOLVED: '已处置',
};

/** 展示优先级：实名用户 > 昵称 > 「匿名同学」 */
export function displayAuthor(userName: string | null | undefined, authorName: string | null | undefined): string {
  return userName || authorName || '匿名同学';
}

export async function loadTimeline(
  animalId: string,
  animal: { createdAt: Date; features: string[] },
  limit = 60,
): Promise<TimelineEntry[]> {
  const [observations, reports, alerts] = await Promise.all([
    prisma.observation.findMany({
      where: { animalId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        content: true,
        tags: true,
        severity: true,
        imageUrl: true,
        pendingReview: true,
        createdAt: true,
        authorName: true,
        user: { select: { name: true } },
      },
    }),
    prisma.healthReport.findMany({
      where: { animalId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        assessment: true,
        severity: true,
        healthStatus: true,
        needsVet: true,
        advice: true,
        confidence: true,
        reviewedByAdmin: true,
        reviewStatus: true,
        createdAt: true,
      },
    }),
    prisma.alert.findMany({
      where: { animalId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, level: true, reason: true, status: true, createdAt: true },
    }),
  ]);

  const entries: TimelineEntry[] = [];

  for (const o of observations) {
    const obsTitle = firstSentence(o.content, TITLE_MAX);
    entries.push({
      id: `OBSERVATION:${o.id}`,
      kind: 'OBSERVATION',
      at: o.createdAt.toISOString(),
      icon: ICON_BY_TYPE[o.type],
      tone: SEVERITY_HEALTH[o.severity],
      title: obsTitle,
      body: bodyAfter(o.content, obsTitle),
      tags: o.tags,
      authorName: displayAuthor(o.user?.name, o.authorName),
      pendingReview: o.pendingReview,
      imageUrl: o.imageUrl,
      meta: { severity: o.severity },
    });
  }

  for (const r of reports) {
    const reportTitle = firstSentence(r.assessment, TITLE_MAX);
    entries.push({
      id: `HEALTH_REPORT:${r.id}`,
      kind: 'HEALTH_REPORT',
      at: r.createdAt.toISOString(),
      icon: 'report',
      // 用 reconcile 校正过后的 healthStatus 定色：它才是最终落库的结论，
      // severity 只作为严重度文本保留
      tone: r.healthStatus,
      title: reportTitle,
      body: bodyAfter(r.assessment, reportTitle),
      tags: r.needsVet ? ['建议就医', ...r.advice.slice(0, 2).map((a) => `建议：${firstSentence(a, 24)}`)] : r.advice.slice(0, 2).map((a) => `建议：${firstSentence(a, 24)}`),
      // REJECTED 的报告不标"待核实"（它已经被判过了），时间线上打红徽标（阶段 9）
      pendingReview: !r.reviewedByAdmin && r.reviewStatus !== 'REJECTED',
      meta: {
        confidence: r.confidence,
        severity: r.severity,
        advisory: true,
        healthStatus: r.healthStatus,
        needsVet: r.needsVet,
        reviewStatus: r.reviewStatus as 'PENDING' | 'APPROVED' | 'REJECTED',
      },
    });
  }

  for (const a of alerts) {
    const alertTitle = firstSentence(a.reason, TITLE_MAX);
    entries.push({
      id: `ALERT:${a.id}`,
      kind: 'ALERT',
      at: a.createdAt.toISOString(),
      icon: 'alert',
      tone: ALERT_TO_HEALTH[a.level],
      title: alertTitle,
      body: bodyAfter(a.reason, alertTitle),
      tags: [],
      statusLabel: ALERT_STATUS_LABEL[a.status] ?? a.status,
      pendingReview: a.status === 'OPEN',
    });
  }

  // 点亮时刻永远压在最底：它是这颗星的起点，不该因为排序被挤没了
  entries.push({
    id: `STAR_LIT:${animalId}`,
    kind: 'STAR_LIT',
    at: animal.createdAt.toISOString(),
    icon: 'star',
    tone: 'GREEN',
    title: '✦ 点亮了这颗星',
    tags: animal.features.slice(0, 3),
    pendingReview: false,
  });

  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
