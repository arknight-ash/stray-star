import { CAMPUS } from './constants';

/**
 * 地理计算：距离、包围盒、围栏判定。
 * 纯函数，前后端共用（客户端用于建档表单校验，服务端用于 API 二次校验）。
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const EARTH_RADIUS_M = 6_371_000;

export function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** 两点球面距离（米）。校园尺度用 Haversine 足够，误差在米级 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function boundingBoxOf(points: LatLng[]): BoundingBox | null {
  const valid = points.filter((p) => isValidLatLng(p.lat, p.lng));
  if (!valid.length) return null;
  return {
    minLat: Math.min(...valid.map((p) => p.lat)),
    maxLat: Math.max(...valid.map((p) => p.lat)),
    minLng: Math.min(...valid.map((p) => p.lng)),
    maxLng: Math.max(...valid.map((p) => p.lng)),
  };
}

export function isInsideBox(point: LatLng, box: BoundingBox): boolean {
  return (
    point.lat >= box.minLat &&
    point.lat <= box.maxLat &&
    point.lng >= box.minLng &&
    point.lng <= box.maxLng
  );
}

export function isWithinFence(
  point: LatLng,
  center: LatLng = CAMPUS,
  radiusM: number = CAMPUS.radiusM,
): boolean {
  return haversineMeters(point, center) <= radiusM;
}

/**
 * 校园中心：优先读环境变量，缺失则用 constants 兜底。
 * 注意：非 NEXT_PUBLIC_ 变量只在服务端有值，客户端会自动落到兜底值，语义安全。
 */
export function readCampusCenter(): LatLng {
  const lat = Number(process.env.CAMPUS_CENTER_LAT);
  const lng = Number(process.env.CAMPUS_CENTER_LNG);
  if (isValidLatLng(lat, lng)) return { lat, lng };
  return { lat: CAMPUS.lat, lng: CAMPUS.lng };
}

export function readCampusZoom(): number {
  const zoom = Number(process.env.CAMPUS_ZOOM);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : CAMPUS.zoom;
}

export function readCampusRadiusM(): number {
  const radius = Number(process.env.CAMPUS_RADIUS_M);
  return Number.isFinite(radius) && radius > 0 ? radius : CAMPUS.radiusM;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/* ────────────────── 瓦片坐标系纠偏（GCJ-02） ────────────────── */

/**
 * WGS-84 → GCJ-02。
 *
 * 为什么需要它：国内地图服务（高德/腾讯）的栅格瓦片是按 GCJ-02 绘制的，
 * 而本项目所有坐标（seed、识别落库、围栏校验）都是 WGS-84（GPS 原始值）。
 * 直接拿 WGS-84 的点去铺 GCJ-02 瓦片，星点会整体偏移 300–600 米 ——
 * 在 zoom 17 的校园尺度上，那就是"星星掉到了隔壁小区"。
 *
 * 这里用的是公开的火星坐标偏移算法（Krasovsky 椭球 + 固定扰动多项式），
 * 精度约 1–2 米，对本项目"星点落在哪栋楼旁"的用途足够；
 * 需要测绘级精度时应当换正式坐标系转换库，而不是加大这里的系数。
 */
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

/** 境外不偏移：这套扰动只在中国大陆范围内成立 */
function outOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret =
    300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) /
    3.0;
  return ret;
}

/** 返回 [lat, lng]，顺序与 Leaflet 一致（它到处都用 lat/lng 而不是 lng/lat） */
export function wgs84ToGcj02(lat: number, lng: number): [number, number] {
  if (outOfChina(lat, lng)) return [lat, lng];

  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);

  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);

  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);

  return [lat + dLat, lng + dLng];
}

/**
 * GCJ-02 → WGS-84（上面那步的逆运算）。
 *
 * 什么时候用：**从国内地图 POI 里抄坐标的时候**。腾讯/高德查出来的"XX大学 30.467068,114.411298"
 * 是 GCJ-02，本项目一律存 WGS-84 —— 直接抄进去，画到 GCJ-02 瓦片上会再偏一次（总偏差 ~1km）。
 * 反解后才是我们想要的原始 GPS 值（存这个值，绘制时再经 wgs84ToGcj02 回到原处）。
 *
 * 正向变换没有解析逆式，用不动点迭代：`wgs ← wgs + (gcj - forward(wgs))`。
 * 偏移量在数百米量级、梯度远小于 1，5 次迭代即可收敛（实测回代误差 0）。
 */
export function gcj02ToWgs84(lat: number, lng: number): [number, number] {
  if (outOfChina(lat, lng)) return [lat, lng];

  let wLat = lat;
  let wLng = lng;
  for (let i = 0; i < 5; i += 1) {
    const [gLat, gLng] = wgs84ToGcj02(wLat, wLng);
    wLat += lat - gLat;
    wLng += lng - gLng;
  }
  return [wLat, wLng];
}
