'use client';

/**
 * 位置选点小地图（补充位置弹窗内用）。
 *
 * 边界与星图画布一致：只有这个文件 import react-leaflet，由上层 dynamic(ssr:false) 加载。
 * 点击处是 GCJ-02 瓦片坐标，回传前先反解回 WGS-84（与全库存储口径一致，见 lib/geo.ts）。
 */

import { CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '@/styles/leaflet.css';
import { MAP, campusBounds, toTileLatLng } from '@/lib/map-config';
import { gcj02ToWgs84, wgs84ToGcj02 } from '@/lib/geo';
import { cn } from '@/lib/utils';

export interface PickedPoint {
  lat: number;
  lng: number;
}

function ClickCatcher({
  pickedTile,
  onPick,
}: {
  pickedTile: [number, number] | null;
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      const [lat, lng] = gcj02ToWgs84(e.latlng.lat, e.latlng.lng);
      onPick(lat, lng);
    },
  });

  if (!pickedTile) return null;
  return (
    <CircleMarker
      center={pickedTile}
      radius={9}
      pathOptions={{
        color: 'var(--accent-300)',
        weight: 2,
        fillColor: 'var(--accent-400)',
        fillOpacity: 0.9,
      }}
    />
  );
}

export default function LocationPickerMap({
  picked,
  onPick,
  className,
}: {
  picked: PickedPoint | null;
  onPick: (point: PickedPoint) => void;
  className?: string;
}) {
  const bounds = campusBounds();
  const center = toTileLatLng(MAP.center.lat, MAP.center.lng);
  const pickedTile = picked ? toTileLatLng(picked.lat, picked.lng) : null;

  return (
    <div className={cn('relative h-full w-full overflow-hidden', className)}>
      <MapContainer
        center={center}
        zoom={MAP.zoom}
        minZoom={MAP.tiles.minZoom}
        maxZoom={MAP.tiles.maxZoom}
        maxBounds={bounds}
        maxBoundsViscosity={0.9}
        dragging
        touchZoom
        keyboard
        zoomControl={false}
        // 弹窗里的地图没有"页面往下滚"的冲突，滚轮缩放是主操作
        scrollWheelZoom
        doubleClickZoom={false}
        boxZoom={false}
        className="h-full w-full"
      >
        {MAP.tiles.enabled && (
          <TileLayer
            url={MAP.tiles.url}
            attribution={MAP.tiles.attribution}
            subdomains={MAP.tiles.subdomains}
            className={MAP.tiles.tone === 'dark' ? 'map-tiles-dark' : undefined}
          />
        )}
        {MAP.tiles.enabled && <div className="map-tint" aria-hidden />}
        <ClickCatcher
          pickedTile={pickedTile}
          onPick={(lat, lng) => onPick({ lat, lng })}
        />
      </MapContainer>

      <p className="pointer-events-none absolute bottom-2 left-2 z-[600] rounded-sticker bg-space-800/90 px-2 py-1 text-[11px] text-lo">
        在地图上点击它的常出没位置
      </p>
    </div>
  );
}
