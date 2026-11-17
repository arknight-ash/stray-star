import { Map } from 'lucide-react';
import { CampusStarMap } from '@/components/map/CampusStarMap';
import { HEALTH_META } from '@/lib/semantic';
import { Panel, PanelMore } from './Panel';
import type { OverviewData } from '@/lib/admin/overview';

/**
 * 校园动物分布（设计稿中栏那张地图卡）。
 *
 * 直接复用星图组件：星点取色、脉冲、点击弹层的语义与学生端完全一致，
 * 管理端不该有第二套"哪只猫在闪"的判断逻辑。
 */
export function CampusMapPanel({ map }: { map: OverviewData['map'] }) {
  return (
    <Panel
      title="校园动物分布"
      Icon={Map}
      action={<PanelMore href="/admin/stats" label="分布明细" />}
      bodyClassName="px-3 pb-3"
    >
      <div className="h-[300px] overflow-hidden rounded-btn ring-1 ring-space-700/60">
        <CampusStarMap animals={map.animals} alerts={map.alerts} showHint={false} />
      </div>
      <ul className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-lo">
        {(['GREEN', 'YELLOW', 'RED'] as const).map((level) => (
          <li key={level} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: HEALTH_META[level].dot }}
              aria-hidden
            />
            {HEALTH_META[level].label}
          </li>
        ))}
        <li className="ml-auto data-mono">{map.animals.length} 颗星</li>
      </ul>
    </Panel>
  );
}
