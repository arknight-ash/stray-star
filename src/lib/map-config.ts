/**
 * 地图唯一配置源（阶段 2）。瓦片、围栏、降级阈值都只在这里定义，
 * 组件里禁止再出现 URL 字符串或魔法数字。
 *
 * 注意：这个文件会被 Server Component 直接 import，所以**不许出现 Leaflet 相关导入**。
 */

import { CAMPUS } from '@/lib/constants';
import { wgs84ToGcj02 } from '@/lib/geo';

function envNumber(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? Number.NaN : Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 默认底图：高德路网瓦片（免 key，国内直连）。
 * 它是**浅色**的，靠下面 `tone: 'dark'` 的反色滤镜压成夜视底。
 * 换成别的源时改 `NEXT_PUBLIC_MAP_TILE_URL` 即可，留空则回纯星场。
 */
const DEFAULT_TILE_URL =
  'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';

const rawTileUrl = (process.env.NEXT_PUBLIC_MAP_TILE_URL ?? DEFAULT_TILE_URL).trim();

/** 国内两家的瓦片是 GCJ-02（火星坐标），必须把 WGS-84 点位纠偏后再画，否则整片星点偏 300–600m */
function isGcj02Source(url: string): boolean {
  return /autonavi|\bamap\b|map\.qq\.com/i.test(url);
}

const tileCrs =
  (process.env.NEXT_PUBLIC_MAP_TILE_CRS as 'gcj02' | 'wgs84' | undefined) ??
  (isGcj02Source(rawTileUrl) ? 'gcj02' : 'wgs84');

/**
 * 色调：`dark` = 给瓦片层套反色压暗滤镜（浅色路网 → 深空底）；
 * `none` = 原色铺（卫星影像、深色瓦片用这个）。
 * 高德路网默认 dark；自定义源若不指定，按"是否高德路网"猜一个合理值。
 */
const tileTone =
  (process.env.NEXT_PUBLIC_MAP_TILE_TONE as 'dark' | 'none' | undefined) ??
  (isGcj02Source(rawTileUrl) && /style=8|style=7/.test(rawTileUrl) ? 'dark' : 'none');

export const MAP = {
  /** 校园中心：优先读环境变量，兜底用 lib/constants 的 CAMPUS（光谷校区 30.469384 / 114.405764，WGS-84） */
  center: {
    lat: envNumber(process.env.CAMPUS_CENTER_LAT, CAMPUS.lat),
    lng: envNumber(process.env.CAMPUS_CENTER_LNG, CAMPUS.lng),
  },
  zoom: Math.round(envNumber(process.env.CAMPUS_ZOOM, CAMPUS.zoom)),
  radiusM: envNumber(process.env.CAMPUS_RADIUS_M, CAMPUS.radiusM),

  /**
   * 底图瓦片。
   *
   * 默认接高德路网（免 key、国内可直连、有道路与地名，观众能认出这是校园）。
   * 曾经的默认是 CARTO dark_matter —— 它现在要 API key，无 key 时**照样返回 200**，
   * 只是一张写着 "API KEY REQUIRED" 的水印图：前端拿不到 tileerror，
   * 降级逻辑根本不触发，屏幕上就是满屏水印。换源前先记住这个坑。
   *
   * 留空（`NEXT_PUBLIC_MAP_TILE_URL=''`）即"不接外部底图"，完全不挂 TileLayer，
   * 直接走底下的 CSS 星场 —— 离线演示比一片水印体面得多。
   */
  tiles: {
    url: rawTileUrl,
    /** 显式留空（''）即视为"不接外部底图"，直接展示内置星场 */
    enabled: rawTileUrl.length > 0,
    /** 'gcj02' 时所有点位/中心/边界都先过 wgs84ToGcj02 再交给 Leaflet */
    crs: tileCrs,
    /** 'dark' 时给瓦片层加 .map-tiles-dark（见 styles/leaflet.css） */
    tone: tileTone,
    /** {s} 子域：高德是 1–4；其他源留空数组 */
    subdomains: isGcj02Source(rawTileUrl) ? ['1', '2', '3', '4'] : [],
    attribution: isGcj02Source(rawTileUrl)
      ? '© 高德地图 AutoNavi'
      : '© OpenStreetMap contributors © CARTO',
    /**
     * 缩放下限为什么是 16：Leaflet 在"视野比 maxBounds 还宽"时会强行居中并锁住平移，
     * 拖起来像坏了。校园围栏 ±2.3km，zoom 16 的视野约 2.4km 宽，正好开始能自由拖。
     */
    minZoom: 16,
    maxZoom: 18,
  },

  /**
   * 瓦片连续失败到这个次数就认定底图不可达（首次加载约 6–10 张瓦片），
   * 卸载 TileLayer 露出底下的 CSS 星场 —— 离线/被墙时首页仍是深空，不是灰白棋盘。
   */
  tileErrorThreshold: 8,
} as const;

/**
 * WGS-84 坐标 → 当前底图坐标系。
 *
 * 地图组件里**所有**交给 Leaflet 的坐标都必须过这里：center、maxBounds、每个星点。
 * 漏掉任何一处，那一处就会单独偏出去 —— 这类 bug 在暗色底图上很难一眼看出，
 * 只有对着地图核对方位时才会发现"星点整体斜着飘"。
 */
export function toTileLatLng(lat: number, lng: number): [number, number] {
  return MAP.tiles.crs === 'gcj02' ? wgs84ToGcj02(lat, lng) : [lat, lng];
}

/** 平移边界：校园中心 ± 半径，再外扩 15%，防止拖到隔壁城市回不来 */
export const CAMPUS_BOUNDS_PAD = 1.15;

/**
 * 校园角落命名地点（WGS-84）。
 *
 * 2026-10-27 重写：**不再按中心手工偏移**，改成腾讯地图「武汉华夏理工学院(光谷校区)」的
 * 真实 POI（GCJ-02）经 gcj02ToWgs84() 反解出来的值，和底图上的楼对得上：
 * 图书馆 / 李园食堂 / 学生公寓 7 号楼 / 田径运动场 / 1 号教学楼 / 西门。
 *
 * 原来那六处（东门、南门、一食堂、宿舍区、操场、教学楼后巷）是照着"一般校园"编的方位，
 * 跟华夏理工实际布局对不上 —— 最直接的后果是星点被摆到了围墙外（对照西门 114.403668
 * 与田径场 114.410083 这条 630m 的东西边线就能看出来）。真实 POI 反解后，
 * 六处全部落在 campus 东西 630m × 南北 356m 的范围内。
 *
 * 用途：
 *  - 星图上画淡色锚点标签，让"范围圈围着哪些角落"一眼可读；
 *  - 「补充位置」弹窗里一键套用，不必在地图上盲点；
 *  - nearestSpot() 把任意坐标归到最近的一处，首页/图鉴/问答共用这一套口径。
 * 换校园时改这里 + constants 的 CAMPUS，KEY 要与 MapExplorer 的 SPOT_ICON 对齐。
 */
export interface CampusSpot {
  key: string;
  name: string;
  lat: number;
  lng: number;
  /**
   * 问句里的口语说法（「宿舍区有几只」「操场那边」）。
   * 只用于**匹配用户怎么称呼这个地方**，展示一律用 name —— 名字要短，
   * 但人都说「宿舍区」不说「学生公寓」，少了这层就统计分支直接认不出。
   */
  aliases?: string[];
}

export const CAMPUS_SPOTS: CampusSpot[] = [
  { key: 'library', name: '图书馆', lat: 30.470383, lng: 114.404787 },
  {
    key: 'canteen',
    name: '李园食堂',
    lat: 30.47099,
    lng: 114.407422,
    aliases: ['李园', '李园餐厅'],
  },
  {
    key: 'dorm',
    name: '学生公寓',
    lat: 30.47032,
    lng: 114.407913,
    aliases: ['宿舍区', '宿舍楼', '宿舍', '公寓'],
  },
  {
    key: 'track',
    name: '田径运动场',
    lat: 30.469217,
    lng: 114.410083,
    aliases: ['田径场', '操场', '运动场', '体育场'],
  },
  {
    key: 'teaching',
    name: '1号教学楼',
    lat: 30.467784,
    lng: 114.40401,
    aliases: ['一号教学楼', '教学楼'],
  },
  {
    key: 'west-gate',
    name: '西门',
    lat: 30.469863,
    lng: 114.403668,
    aliases: ['西大门', '正门'],
  },
] as const;

/**
 * 校园四至（WGS-84），由真实 POI 反解得出：
 *   西 西门 114.40352 —— 东 田径运动场 114.41008（东西 630m）
 *   南 1 号教学楼 30.46778 —— 北 李园食堂 30.47099（南北 356m），≈ 323 亩，与校方公布的光谷校区面积一致。
 *
 * 注意它和 MAP.radiusM（默认 2km）不是一回事：那个是「别拖到隔壁城市」的防飞边界，
 * 这个才是**校园围墙**。档案点位、种子观察都必须落在里面。
 */
export const CAMPUS_FOOTPRINT = {
  south: 30.46778,
  north: 30.47099,
  west: 114.40352,
  east: 114.41008,
} as const;

export function isInsideCampusFootprint(lat: number, lng: number): boolean {
  return (
    lat >= CAMPUS_FOOTPRINT.south &&
    lat <= CAMPUS_FOOTPRINT.north &&
    lng >= CAMPUS_FOOTPRINT.west &&
    lng <= CAMPUS_FOOTPRINT.east
  );
}

/**
 * 问句里点名的角落（"宿舍区有几只" → dorm）。
 * 名字优先，其次别名；都不中返回 null。
 */
export function spotMentionedIn(text: string): CampusSpot | null {
  const hit = CAMPUS_SPOTS.find((s) => text.includes(s.name));
  if (hit) return hit;
  return CAMPUS_SPOTS.find((s) => (s.aliases ?? []).some((a) => text.includes(a))) ?? null;
}

/**
 * 取离坐标最近的命名角落（首页「最近记录」的位置文案用）。
 * 度数级的平面近似足够：校园 ~2km 范围内，误差远小于角落之间的间距。
 * 无坐标或全都超出 1.5km（围栏外）→ null，调用方回退为「位置待补充」。
 */
export function nearestSpot(
  lat: number | null,
  lng: number | null,
): CampusSpot | null {
  if (lat === null || lng === null) return null;
  let best: CampusSpot | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const spot of CAMPUS_SPOTS) {
    const dLat = spot.lat - lat;
    const dLng = (spot.lng - lng) * Math.cos((lat * Math.PI) / 180);
    const dist = Math.hypot(dLat, dLng) * 111_320; // 米
    if (dist < bestDist) {
      bestDist = dist;
      best = spot;
    }
  }
  return bestDist <= 1500 ? best : null;
}

export function campusBounds(): [[number, number], [number, number]] {
  const dLat = (MAP.radiusM / 111_320) * CAMPUS_BOUNDS_PAD;
  const dLng =
    (MAP.radiusM / (111_320 * Math.cos((MAP.center.lat * Math.PI) / 180))) * CAMPUS_BOUNDS_PAD;
  // 边界必须与 center、星点同处一个坐标系（GCJ-02 时先纠偏）
  const [lat, lng] = toTileLatLng(MAP.center.lat, MAP.center.lng);
  return [
    [lat - dLat, lng - dLng],
    [lat + dLat, lng + dLng],
  ];
}
