/**
 * 坐标聚合（网格吸附）—— 阶段 2 只建骨架，默认关闭。
 *
 * 为什么现在就建：一旦首页与星图开始按点位渲染，"一只猫一个点"就会变成隐私与可读性的
 * 双重要求。把它钉在单独文件里，将来只把 `MAP_SNAP_GRID_M` 从 0 改成 50，全站口径一致，
 * 不用去翻每个调用点 —— 也只有这里允许出现"把坐标改成不那么精确"的逻辑。
 *
 * `MAP_SNAP_GRID_M = 0`（默认）→ 不聚合，返回真实点位。
 */

import { worseHealth } from '@/lib/semantic';
import type { HealthLevel, MapPinVM } from '@/types/domain';

function readGridM(): number {
  const raw = process.env.MAP_SNAP_GRID_M;
  const n = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 聚合网格边长（米）。0 表示关闭，UI 沿用真实坐标。 */
export const MAP_SNAP_GRID_M = readGridM();

const M_PER_DEG_LAT = 111_320;

/** 把单个坐标吸附到网格中心；gridM <= 0 时原样返回（保留真实精度） */
export function snapPoint(
  lat: number,
  lng: number,
  gridM: number = MAP_SNAP_GRID_M,
): { lat: number; lng: number } {
  if (gridM <= 0) return { lat, lng };
  const dLat = gridM / M_PER_DEG_LAT;
  const dLng = gridM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  const snap = (v: number, d: number) => (Math.floor(v / d) + 0.5) * d;
  return { lat: snap(lat, dLat), lng: snap(lng, dLng) };
}

export interface PinCluster {
  /** 网格键，稳定可复用作 React key 与去重键 */
  key: string;
  lat: number;
  lng: number;
  pins: MapPinVM[];
  /** 簇内最严重的健康档：聚合后星点颜色取它，宁可显眼不可漏 */
  healthLevel: HealthLevel;
  hasOpenAlert: boolean;
}

/**
 * 按网格把点位聚成簇。`gridM <= 0` 时每个点位自成一簇（等价于不聚合），
 * 调用方不需要写 if —— 这是刻意保留的统一出口。
 */
export function clusterPins(
  pins: MapPinVM[],
  gridM: number = MAP_SNAP_GRID_M,
): PinCluster[] {
  if (gridM <= 0) {
    return pins.map((pin) => ({
      key: pin.id,
      lat: pin.mapLat,
      lng: pin.mapLng,
      pins: [pin],
      healthLevel: pin.healthLevel,
      hasOpenAlert: pin.hasOpenAlert,
    }));
  }

  const buckets = new Map<string, PinCluster>();
  for (const pin of pins) {
    const { lat, lng } = snapPoint(pin.mapLat, pin.mapLng, gridM);
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    const found = buckets.get(key);
    if (!found) {
      buckets.set(key, {
        key,
        lat,
        lng,
        pins: [pin],
        healthLevel: pin.healthLevel,
        hasOpenAlert: pin.hasOpenAlert,
      });
      continue;
    }
    found.pins.push(pin);
    found.healthLevel = worseHealth(found.healthLevel, pin.healthLevel);
    found.hasOpenAlert = found.hasOpenAlert || pin.hasOpenAlert;
  }
  return [...buckets.values()];
}
