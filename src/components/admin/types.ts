/**
 * 管理端组件的视图类型入口。
 *
 * 全部走 `import type`：客户端组件只借类型，不把 `lib/admin/alerts.ts`
 * （它 import 了 PrismaClient）拖进浏览器包里。
 */
import type {
  AlertsPageData,
  AlertTrendDay,
  AlertPhotoCard,
} from '@/lib/admin/alerts';
import type {
  AdminAlertVM,
  AdminReportVM,
  AlertLevel,
  AlertSource,
  AlertStatus,
} from '@/lib/api/alert-contract';

export type {
  AlertsPageData,
  AlertTrendDay,
  AlertPhotoCard,
  AdminAlertVM,
  AdminReportVM,
  AlertLevel,
  AlertSource,
  AlertStatus,
};
