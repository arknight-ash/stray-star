'use client';

import { useCallback, useState } from 'react';
import { CampusStarMap } from '@/components/map/CampusStarMap';
import { StarSummarySheet } from '@/components/map/StarSummarySheet';
import type { MapPinVM, StarPinAlertVM, StarPinAnimalVM } from '@/types/domain';

/**
 * 首页星图的交互壳：把「点了星点发生什么」留在客户端这一层，
 * 这样 `<CampusStarMap>` 保持纯展示（不 import router、不知道有档案页存在）。
 *
 * 阶段 7：点击改为弹出档案摘要，不再直接跳走 —— 巡检时的大多数点击只是想看一眼。
 */
export function StarMapBoard({
  animals,
  alerts,
}: {
  animals: StarPinAnimalVM[];
  alerts: StarPinAlertVM[];
}) {
  const [active, setActive] = useState<MapPinVM | null>(null);

  const handleSelect = useCallback((pin: MapPinVM) => setActive(pin), []);
  const handleClose = useCallback(() => setActive(null), []);

  return (
    <>
      <CampusStarMap animals={animals} alerts={alerts} onSelect={handleSelect} />
      <StarSummarySheet pin={active} onClose={handleClose} />
    </>
  );
}
