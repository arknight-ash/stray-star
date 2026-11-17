/**
 * 首页右栏的「星枢AI公告」与「今日寄语」（2026-10-26 设计稿新增区块）。
 *
 * 为什么是静态配置：公告没有运营后台，也不值得为几行文案建表 ——
 * 用真数据源（观察记录/预警）伪造"公告"反而误导。这里是**唯一编辑口**，
 * 发公告 = 往数组里加一行；数据模型成熟后可无缝换成 prisma 查询。
 * 日期用 `MM-DD` 字符串直接展示，与设计稿一致。
 */
export interface HomeAnnouncement {
  title: string;
  date: string;
  href?: string;
}

export const HOME_ANNOUNCEMENTS: HomeAnnouncement[] = [
  { title: '新功能上线：星图活动范围圈', date: '10-26', href: '/map' },
  { title: '照片墙上线：看看它们的日常', date: '10-26', href: '/photos' },
  { title: '数据统计页上线：趋势一目了然', date: '10-25', href: '/data' },
  { title: '拍照识别升级：对准动物即可建档', date: '10-24', href: '/scan' },
];

/** 今日寄语：一句静态文案，来自站点 slogan 的延伸 */
export const DAILY_QUOTE = {
  text: '这个世界上，总有人在默默守护着那些不被看见的生命。',
  from: '守护流浪星',
} as const;
