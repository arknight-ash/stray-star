/** 领域枚举与前端视图模型（与 Prisma 模型一一对应，供 UI 层安全使用） */

export type Species = 'CAT' | 'DOG';
export type HealthLevel = 'GREEN' | 'YELLOW' | 'RED';
export type ObservationType = 'FEEDING' | 'HEALTH' | 'BEHAVIOR' | 'OTHER';
export type Severity = 'MILD' | 'MODERATE' | 'SEVERE';
export type AlertLevel = 'INFO' | 'WARN' | 'CRITICAL';
export type AlertStatus = 'OPEN' | 'ACK' | 'RESOLVED';
export type Role = 'STUDENT' | 'ADMIN';

export interface StarCardVM {
  id: string;
  code: string;
  name: string;
  species: Species;
  avatarUrl: string | null;
  healthLevel: HealthLevel;
  mapLat: number | null;
  mapLng: number | null;
  /** 建档时间：星卡只用于排序展示，识别/建档链路不产出它，故可选 */
  createdAt?: string;
  lastSeenAt: string | null;
  observationCount?: number;
}

export interface CandidateVM {
  animalId: string;
  code: string;
  name: string;
  species: Species;
  avatarUrl: string | null;
  score: number;
}

/** 手账时间线来源（阶段 4：lib/db/timeline.ts） */
export type TimelineKind = 'STAR_LIT' | 'OBSERVATION' | 'HEALTH_REPORT' | 'ALERT';
export type TimelineIcon =
  | 'star'
  | 'feeding'
  | 'health'
  | 'behavior'
  | 'note'
  | 'report'
  | 'alert';

/** 便签墙上的一条观察（众包提交后插到墙首） */
export interface NoteVM {
  id: string;
  content: string;
  tags: string[];
  type: ObservationType;
  severity: Severity;
  /** 众包照片。null = 纯文字记录，便签墙不渲染任何图片位（阶段 4 收尾约定） */
  imageUrl: string | null;
  authorName: string;
  at: string;
  pendingReview: boolean;
}

/**
 * 地图点位（阶段 2 首页星图 / 阶段 5 正式星图共用）。
 * 由 `<CampusStarMap>` 从 animals + alerts 派生，不直接来自数据库查询。
 */
export interface MapPinVM {
  id: string;
  code: string;
  name: string;
  species: Species;
  healthLevel: HealthLevel;
  mapLat: number;
  mapLng: number;
  /** 头像：选中星卡展示用（与 animals 数据同源） */
  avatarUrl?: string | null;
  /** Alert.status === 'OPEN'：决定星点是否叠 pulse/alert 变体（聚合与 snap 也读它） */
  hasOpenAlert: boolean;
  /**
   * 未处理预警里的**最高等级**（阶段 7）。星点脉冲按它取色：
   * 一只黄档动物挂着 CRITICAL 预警时，图上必须是红脉冲 ——
   * 颜色在这里说的是"有事要处理"，不是"档案当前几档"。
   */
  alertLevel?: AlertLevel | null;
  /** 那条预警的原因原文：摘要弹层直接展示，不再拼一句"有预警"了事 */
  alertReason?: string | null;
  /** 最近一条记录的内容；null → 「这颗星还没有被记录」 */
  latestNote: string | null;
  /** 观察记录数：活动范围圈按它变大（记录越多的星活动范围画得越大） */
  observationCount?: number;
  /** 最近一次 AI 初筛（摘要弹层用）；null = 还没做过初筛 */
  latestReport?: { assessment: string; healthStatus: HealthLevel } | null;
}

/**
 * 星图原料之一：只保留「画星点」需要的字段。
 * 刻意不传整行 Animal —— 客户端组件不该拿到坐标之外的个人信息。
 */
export interface StarPinAnimalVM {
  id: string;
  code: string;
  name: string;
  species: Species;
  healthLevel: HealthLevel;
  mapLat: number | null;
  mapLng: number | null;
  /** 头像：星图页右栏的选中星卡用（地图画点不用它） */
  avatarUrl?: string | null;
  latestNote?: string | null;
  /** 最近一次 AI 初筛摘要（阶段 7 的档案摘要弹层） */
  latestReport?: { assessment: string; healthStatus: HealthLevel } | null;
  /** 观察记录数：星图上决定活动范围圈的大小（记录越多圈越大）；缺省按 0 处理 */
  observationCount?: number;
}

/** 星图原料之二：预警只关心「哪只动物、什么状态、多急」 */
export interface StarPinAlertVM {
  animalId: string;
  status: AlertStatus;
  /** 阶段 7 起带上等级：脉冲取色要看它，不能只看"有没有" */
  level?: AlertLevel;
  reason?: string;
}
