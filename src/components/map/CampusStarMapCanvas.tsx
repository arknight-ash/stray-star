'use client';

/**
 * 星图画布（Leaflet 真正初始化的地方）。
 *
 * 边界（阶段 2 明确约定）：
 *  - 只有这个文件 import leaflet / react-leaflet，页面与服务端组件永远不碰；
 *  - 上层 `<CampusStarMap>` 用 `next/dynamic({ ssr: false })` 加载它，所以 SSR 阶段不会出现 `window` 报错；
 *  - 星点**不用 `L.divIcon`**：divIcon 的 html 字符串是 XSS 面（名字/记录都是用户输入），
 *    这里改成把经纬度投影成容器像素坐标，用 React 的 `<StarDot>` 自己画 ——
 *    颜色、脉冲、无障碍与全站完全同源（R2/R9）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '@/styles/leaflet.css';
import { MAP, campusBounds, toTileLatLng, CAMPUS_SPOTS } from '@/lib/map-config';
import { StarDot } from '@/components/star/StarDot';
import { ALERT_META, ALERT_TO_HEALTH, HEALTH_META, worseHealth } from '@/lib/semantic';
import { cn } from '@/lib/utils';
import type { MapPinVM } from '@/types/domain';

export interface CampusStarMapCanvasProps {
  pins: MapPinVM[];
  onSelect?: (pin: MapPinVM) => void;
  /** 区域快速跳转：变化时平移视野（key='all' 收拢全部星） */
  focus?: { key: string; lat: number; lng: number } | null;
  /** 左下角的操作提示条（外层有自己面板时关掉） */
  showHint?: boolean;
}

/** 星点的原始数据 + 已投影到底图坐标系的坐标（GCJ-02 源必须两套都留，弹层要用原始值） */
export interface TilePin {
  pin: MapPinVM;
  lat: number;
  lng: number;
}

type Projected = { item: TilePin; x: number; y: number };
type SpotPoint = { name: string; x: number; y: number };

/** 区域快速跳转：focus 变化时把视野平移/飞到目标角落（'all' 收拢全部星进视野） */
function FocusPanner({
  focus,
  items,
}: {
  focus: { key: string; lat: number; lng: number } | null;
  items: TilePin[];
}) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    if (focus.key === 'all') {
      if (items.length === 0) return;
      map.flyToBounds(
        items.map((p) => [p.lat, p.lng] as [number, number]),
        { padding: [48, 32], maxZoom: MAP.zoom },
      );
      return;
    }
    map.flyTo(toTileLatLng(focus.lat, focus.lng), Math.max(map.getZoom(), MAP.zoom), {
      duration: 0.8,
    });
  }, [focus, map, items]);
  return null;
}

/** 校园角落锚点层：只做导视（星点围着哪些角落），不参与交互 */
function SpotLayer({ points }: { points: SpotPoint[] }) {
  if (points.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[450]" aria-hidden>
      {points.map(({ name, x, y }) => (
        <div key={name} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y }}>
          <span
            className="block h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: 'var(--accent-300)',
              boxShadow: '0 0 6px color-mix(in srgb, var(--accent-300) 60%, transparent)',
            }}
          />
          <span className="mt-0.5 block whitespace-nowrap text-center text-[10px] leading-none text-lo">
            {name}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 星点层：跟随地图视野把经纬度投影成像素坐标 */
function StarLayer({ items, onSelect }: { items: TilePin[]; onSelect?: (pin: MapPinVM) => void }) {
  const map = useMap();
  const [points, setPoints] = useState<Projected[]>([]);
  const [spotPoints, setSpotPoints] = useState<SpotPoint[]>([]);

  const project = useCallback(() => {
    const size = map.getSize();
    const next: Projected[] = [];
    for (const item of items) {
      const p = map.latLngToContainerPoint([item.lat, item.lng]);
      // 视野外的不渲染（留 60px 余量，避免边缘闪烁）
      if (p.x < -60 || p.y < -60 || p.x > size.x + 60 || p.y > size.y + 60) continue;
      next.push({ item, x: p.x, y: p.y });
    }
    setPoints(next);

    // 校园角落锚点：与星点同一套投影与视口裁剪
    const spots: SpotPoint[] = [];
    for (const spot of CAMPUS_SPOTS) {
      const [lat, lng] = toTileLatLng(spot.lat, spot.lng);
      const p = map.latLngToContainerPoint([lat, lng]);
      if (p.x < -40 || p.y < -40 || p.x > size.x + 40 || p.y > size.y + 40) continue;
      spots.push({ name: spot.name, x: p.x, y: p.y });
    }
    setSpotPoints(spots);
  }, [map, items]);

  const fitAll = useCallback(() => {
    if (items.length === 0) return;
    const bounds = items.map((p) => [p.lat, p.lng] as [number, number]);
    map.fitBounds(bounds, { padding: [48, 32], maxZoom: MAP.zoom, animate: false });
  }, [map, items]);

  // 首帧把所有星收进视野，避免一进图就有星落在屏幕外
  useEffect(() => {
    let cancelled = false;
    map.whenReady(() => {
      if (cancelled) return;
      fitAll();
      project();
    });
    return () => {
      cancelled = true;
    };
  }, [map, fitAll, project]);

  // 容器尺寸变化只重投影，不再 fitAll —— 地图已经能拖了，
  // 用户转屏/改窗口时把视野硬拉回原点，等于把他正在看的位置弄丢。
  useEffect(() => {
    map.on('moveend zoomend', project);
    map.on('resize', project);
    return () => {
      map.off('moveend zoomend', project);
      map.off('resize', project);
    };
  }, [map, project]);

  if (points.length === 0 && spotPoints.length === 0) return null;

  return (
    <>
      {/* 校园角落锚点（导视层，在星点之下） */}
      <SpotLayer points={spotPoints} />

      <div className="pointer-events-none absolute inset-0 z-[500]">
        {points.map(({ item, x, y }) => {
          const { pin } = item;
          // 预警脉冲的取色（阶段 7）：有未处理预警时按**预警等级**定色，
          // 且只升不降 —— 一只黄档动物挂着 CRITICAL，图上必须是红色告警星。
          const alertLevel = pin.alertLevel ?? null;
          const shownLevel = alertLevel ? worseHealth(pin.healthLevel, ALERT_TO_HEALTH[alertLevel]) : pin.healthLevel;
          const meta = HEALTH_META[shownLevel];
          const label = `✦ ${pin.name} · ${pin.code}，${meta.starName}${
            alertLevel ? `，有未处理的${ALERT_META[alertLevel].label}预警` : ''
          }${pin.latestNote ? '' : '，这颗星还没有被记录'}`;

          // 2026-10-26 需求「定位只有范围，按颜色区分」：
          // 星点不再是精确打点，而是一片半透明**活动范围圈**——
          // 颜色按健康/预警档取语义三色，记录越多圈越大（范围 ≈ 被目击的广度）。
          const diameter = 44 + Math.min(24, (pin.observationCount ?? 0) * 2);

          return (
            <div
              key={pin.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: x, top: y }}
            >
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(pin)}
                  aria-label={label}
                  className="pointer-events-auto grid place-items-center rounded-full transition-transform duration-star ease-star hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400"
                  style={{
                    width: diameter,
                    height: diameter,
                    backgroundColor: `color-mix(in srgb, ${meta.dot} 16%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${meta.dot} 45%, transparent), 0 0 16px color-mix(in srgb, ${meta.dot} 22%, transparent)`,
                  }}
                >
                  <StarDot
                    level={shownLevel}
                    variant={alertLevel ? 'alert' : 'idle'}
                    shape="star"
                    size={18}
                  />
                </button>
              ) : (
                <span
                  title={label}
                  className="grid place-items-center rounded-full"
                  style={{
                    width: diameter,
                    height: diameter,
                    backgroundColor: `color-mix(in srgb, ${meta.dot} 16%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${meta.dot} 45%, transparent)`,
                  }}
                >
                  <StarDot
                    level={shownLevel}
                    variant={alertLevel ? 'alert' : 'idle'}
                    shape="star"
                    size={18}
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function CampusStarMapCanvas({
  pins,
  onSelect,
  focus,
  showHint = true,
}: CampusStarMapCanvasProps) {
  // 没接底图（NEXT_PUBLIC_MAP_TILE_URL=''）时直接进入"纯星图"态：
  // 星场要全亮、提示条要出，不能停在"瓦片还没来"的半透明等待态
  const [tilesDown, setTilesDown] = useState(!MAP.tiles.enabled);
  const failures = useRef(0);
  const bounds = useMemo(() => campusBounds(), []);
  // 底图是 GCJ-02（高德/腾讯）时，星点必须先纠偏 —— 否则整片星会偏出 300–600 米。
  // 原始 WGS-84 坐标仍留在 pin 上（弹层、坐标文本用），只有画图用转换值。
  const items = useMemo<TilePin[]>(
    () =>
      pins.map((pin) => {
        const [lat, lng] = toTileLatLng(pin.mapLat, pin.mapLng);
        return { pin, lat, lng };
      }),
    [pins],
  );
  const center = useMemo(() => toTileLatLng(MAP.center.lat, MAP.center.lng), []);

  const handleTileError = useCallback(() => {
    failures.current += 1;
    if (failures.current >= MAP.tileErrorThreshold) setTilesDown(true);
  }, []);

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={MAP.zoom}
        minZoom={MAP.tiles.minZoom}
        maxZoom={MAP.tiles.maxZoom}
        // 围栏既防"拖到隔壁城市回不来"，也是语义上的边界：这张图讲的是**这个校区**的星
        maxBounds={bounds}
        // 拖到边界时给一点回弹阻尼，别像撞墙一样硬停
        maxBoundsViscosity={0.9}
        // 星图可以拖 —— 这是它作为"观测图"的基本操作（以往禁止拖拽是因为纯展示态没有导视，
        // 现在底图给了地理参照，拖到哪都能认出方位，不存在"拖丢"）。
        // 滚轮留给页面滚动：地图区域内的滚轮缩放会把往下读页面的动作吃掉，
        // 需要缩放用左上角的 +/-，或双指。
        dragging
        touchZoom
        keyboard
        zoomControl={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        boxZoom={false}
        className="h-full w-full"
      >
        {/* 缩放按钮放右上（默认在左上），避开右下角的版权署名。样式见 styles/leaflet.css */}
        <ZoomControl position="topright" />

        {/* 瓦片失败时露出的底：CSS 星场。
            没有底图时把它调亮、并压掉本该给瓦片用的蒙版 —— 让"纯星图"看起来是有意的设计，
            而不是一块加载失败的棋盘（用户离线或 CDN 被墙时就是这条路径）。 */}
        <div
          className={cn(
            'starfield pointer-events-none absolute inset-0 z-0 transition-opacity duration-star ease-star',
            tilesDown ? 'opacity-100' : 'opacity-60',
          )}
          aria-hidden
        />

        {!tilesDown && MAP.tiles.enabled && (
          <TileLayer
            url={MAP.tiles.url}
            attribution={MAP.tiles.attribution}
            subdomains={MAP.tiles.subdomains}
            className={MAP.tiles.tone === 'dark' ? 'map-tiles-dark' : undefined}
            eventHandlers={{ tileerror: handleTileError }}
          />
        )}

        {!tilesDown && MAP.tiles.enabled && <div className="map-tint" aria-hidden />}
        <FocusPanner focus={focus ?? null} items={items} />
        <StarLayer items={items} onSelect={onSelect} />
      </MapContainer>

      {/* 有了地理参照就该告诉用户"这张图能动" —— 否则它看起来只是一张插图。
          位置与"底图不可达"提示互斥复用同一角落，右侧留给版权署名。 */}
      {!tilesDown && MAP.tiles.enabled && showHint && (
        <p className="pointer-events-none absolute bottom-3 left-3 z-[600] rounded-sticker bg-space-800/90 px-2 py-1 text-[11px] text-lo">
          可拖动查看 · 圈越大代表记录越多 · 右上角 +/− 缩放
        </p>
      )}

      {tilesDown && showHint && (
        <p className="absolute bottom-3 left-3 z-[600] rounded-sticker bg-space-800/90 px-2 py-1 text-[11px] text-lo">
          {MAP.tiles.enabled ? '底图暂不可达，已切换为纯星图' : '当前为纯星图模式（未接入底图）'}
        </p>
      )}
    </div>
  );
}
