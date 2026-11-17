import { z } from 'zod';
import { LIMITS } from '../constants';

/**
 * 档案级操作的前后端共用契约（2026-10-26）。
 * 目前只有「补充位置」：图鉴里给暂无坐标的星补经纬度（WGS-84）。
 */

export const AnimalLocationSchema = z.object({
  code: z.string().trim().min(1, '缺少动物编号').max(32),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type AnimalLocationInput = z.infer<typeof AnimalLocationSchema>;
