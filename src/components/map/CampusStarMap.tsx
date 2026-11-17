'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import type { AlertLevel, MapPinVM, StarPinAlertVM, StarPinAnimalVM } from '@/types/domain';

const LEVEL_RANK: Record<AlertLevel, number> = { INFO: 0, WARN: 1, CRITICAL: 2 };

/**
 * 校园星图 —— 展示与点选组件（阶段 2，阶段 9 起开放平移）。
 *
 * 职责边界：
 *  - **只负责把 animals + alerts 变成星点并画出来**，不查库、不路由、不弹窗；
 *  - 不 import Leaflet：真正的画布由 `CampusStarMapCanvas` 通过 `dynamic({ ssr: false })` 加载，
 *    所以任何页面（包括 Server Component）引用本组件都不会触发 `window is not defined`；
 *  - 星图本身恒可拖动/缩放（右下角容器也不拦 pointer 事件），这是"观测一张地图"的基本操作；
 *    它仍然不负责跳转 —— 点击星点发生什么由外层通过 `onSelect` 决定。
 */
export interface CampusStarMapProps {
  animals: StarPinAnimalVM[];
  alerts: StarPinAlertVM[];
  /** 点击星点时回调。不传则星点纯展示（不可点击） */
  onSelect?: (pin: MapPinVM) => void;
  /** 区域快速跳转：变化时地图平移到该角落（key='all' 收拢全部星进视野） */
  focus?: { key: string; lat: number; lng: number } | null;
  /** 左下角的操作提示条；外层自己有提示面板时可关掉，避免叠字 */
  showHint?: boolean;
}

const Canvas = dynamic(() => import('./CampusStarMapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="starfield h-full w-full bg-space-900" role="status">
      <span className="sr-only">正在铺设星图</span>
    </div>
  ),
});

export function CampusStarMap({
  animals,
  alerts,
  onSelect,
  focus,
  showHint = true,
}: CampusStarMapProps) {
  const pins = useMemo<MapPinVM[]>(() => {
    // 一只动物可能同时挂着几条未处理预警（比如既 SEVERE 又踩中负面标签累积），
    // 图上只能画一个点 —— 取最急的那条，颜色与摘要都以它为准。
    const openAlerts = new Map<string, { level: AlertLevel; reason: string }>();
    for (const a of alerts) {
      if (a.status !== 'OPEN') continue;
      const level = a.level ?? 'INFO';
      const prev = openAlerts.get(a.animalId);
      if (!prev || LEVEL_RANK[level] > LEVEL_RANK[prev.level]) {
        openAlerts.set(a.animalId, { level, reason: a.reason ?? '' });
      }
    }

    const list: MapPinVM[] = [];
    for (const animal of animals) {
      // 没有坐标的动物照样在图鉴里，只是不上星图（不要把 0,0 当成"海上的一颗星"）
      if (animal.mapLat === null || animal.mapLng === null) continue;
      const alert = openAlerts.get(animal.id) ?? null;
      list.push({
        id: animal.id,
        code: animal.code,
        name: animal.name,
        species: animal.species,
        healthLevel: animal.healthLevel,
        mapLat: animal.mapLat,
        mapLng: animal.mapLng,
        avatarUrl: animal.avatarUrl ?? null,
        hasOpenAlert: alert !== null,
        alertLevel: alert?.level ?? null,
        alertReason: alert?.reason ?? null,
        latestNote: animal.latestNote ?? null,
        latestReport: animal.latestReport ?? null,
        observationCount: animal.observationCount ?? 0,
      });
    }
    return list;
  }, [animals, alerts]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-space-900">
      <Canvas pins={pins} onSelect={onSelect} focus={focus ?? null} showHint={showHint} />
    </div>
  );
}
