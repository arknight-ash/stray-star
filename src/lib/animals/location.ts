/**
 * 「在哪看到它」—— 一次目击地点落到两条数据上：观察记录 + 档案点位。
 *
 * 为什么需要这一层（2026-10-29）：
 *   星图上的点来自 `Animal.mapLat/mapLng`（档案坐标），而观察记录虽然也有两列坐标，
 *   但前端记录页从来没有定位入口 —— 结果是「星图上的点位」只能靠管理员在后台手动补。
 *   学生天天在校园里看见这些猫，却没有任何一句话能把这些点挪过去。
 *
 * 铁律：**坐标不由模型给**。
 *   让 LLM 直接输出 lat/lng，它会给一个看起来很像的地址（甚至别的城市），
 *   而星图对此毫无抵抗力 —— 一个错点会把整张图缩放到别处。
 *   所以这里只认 `CAMPUS_SPOTS` 白名单：模型/用户说「图书馆」，
 *   坐标由服务端查表得到。认不出就明确拒绝，绝不猜。
 *
 *   2026-10-29 补一条例外：**设备定位（GPS）可以给坐标**。
 *   区别在于「谁在断言」—— 白名单是服务端自己的结论，GPS 是这台手机当场测出来的，
 *   两者都不是模型编的。所以 GPS 走另一条校验：球面围栏（isWithinFence）+ 精度上报。
 *   模型仍然没有坐标入参，它只能说 `useCurrentPosition`，坐标由服务端从前端授权里取。
 *
 * 写库顺序：先落观察记录，再挪点位。
 *   反过来的话，一条被内容安全拦下的记录会留下「点已经挪了、但没有记录」的状态 ——
 *   那是查不清来源的位置变更，比不做更糟。
 */

import { prisma } from '@/lib/db';
import { AUDIT_ACTIONS, writeAudit } from '@/lib/db/audit';
import { CAMPUS_SPOTS, nearestSpot, spotMentionedIn, type CampusSpot } from '@/lib/map-config';
import { isValidLatLng, isWithinFence, readCampusCenter, readCampusRadiusM } from '@/lib/geo';
import { createObservation, type ObservationDeps } from '@/lib/observations/create';
import type { ObservationData } from '@/lib/api/observation-contract';
import type { ErrCode } from '@/lib/http';

/** 白名单地点名，供工具描述 / 错误文案复用，避免两处各写一份 */
export const LOCATION_SPOT_NAMES = CAMPUS_SPOTS.map((s) => s.name);

/** 设备定位（WGS-84）。accuracyM 是浏览器报的精度半径，只在展示与审计里用 */
export interface GeoFix {
  lat: number;
  lng: number;
  accuracyM?: number | null;
}

export interface RecordLocationInput {
  animalCode: string;
  /** 用户/模型说的地点原话，如「图书馆」「操场」「公寓楼下」 */
  place?: string | null;
  /**
   * 设备定位（2026-10-29）。给了它就不看 place —— 手机当场测的位置比「大概在操场」
   * 精确得多。已过围栏校验，但仍是**用户设备**给的，不是模型给的。
   */
  coords?: GeoFix | null;
  /** 观察原文；缺省时用「在<地点>看到它」 —— 记录必须能独立读懂 */
  note?: string | null;
  ip?: string | null;
  observerName?: string | null;
}

/** 坐标是怎么来的：白名单查表 / 设备定位。审计与文案都要据此说实话 */
export type LocationSource = 'spot' | 'gps';

export interface RecordLocationData {
  /** 最近的校园角落：GPS 落点也归到最近角落，供分组与文案使用 */
  spot: { key: string; name: string; lat: number; lng: number };
  /** 真正写进库的坐标（白名单与 spot 一致；GPS 则是设备实测） */
  coords: { lat: number; lng: number };
  source: LocationSource;
  /** 仅 GPS 有值：浏览器上报的精度半径（米） */
  accuracyM?: number | null;
  /** 哪只个体 —— 供编排层回灌 ctx，后续步骤不必再查一遍 */
  animal: { code: string; name: string };
  /** 是否真的把档案点位挪过去了（写完才为 true） */
  moved: boolean;
  /** 挪之前的位置，便于回滚与「原来在哪」的说明 */
  previous: { lat: number | null; lng: number | null };
  observation: ObservationData['observation'];
  alert: ObservationData['alert'];
  notice?: string | null;
}

export type RecordLocationOutcome =
  | { ok: true; data: RecordLocationData }
  | { ok: false; code: ErrCode; message: string };

/**
 * 从一句人话里认出白名单地点。认不出返回 null —— 由调用方拒绝，不降级猜测。
 * 单独抽出来是为了让自测能直接验「哪些说法算认得」，不必每次都写库。
 */
export function resolveCampusSpot(place: string): CampusSpot | null {
  const text = place.trim();
  if (!text) return null;
  return spotMentionedIn(text);
}

/** 认不出地点时给用户的提示：把可选地点列清楚，比「位置无效」有用得多 */
export function unknownSpotMessage(): string {
  return `只认得这些校园角落的坐标：${LOCATION_SPOT_NAMES.join('、')}。请用其中一个名字再说一次`;
}

/** GPS 落在围栏外 / 精度太差时的提示：都要给出「说地点名」这条退路 */
function gpsRejectMessage(reason: 'invalid' | 'outside' | 'coarse'): string {
  if (reason === 'invalid') return '设备定位坐标不合法，请改说地点名（如图书馆）';
  if (reason === 'outside')
    return '设备定位显示你不在校园范围内（或定位漂移到了校外），请改说地点名（如图书馆）';
  return '设备定位精度太差（误差超过 500 米），请到开阔处再试，或直接说地点名';
}

interface ResolvedTarget {
  lat: number;
  lng: number;
  /** 归到哪个校园角落：GPS 落点也归到最近的那个，供分组与文案使用 */
  spot: CampusSpot;
  source: LocationSource;
  accuracyM: number | null;
}

/**
 * 决定这次写哪组坐标。两条来源互斥，优先级：设备定位 > 地点名。
 *
 * GPS 的校验比白名单更严（多两道）：坐标本身合法 + 落在校园围栏内 + 精度别离谱。
 * 白名单坐标是人工核对过的常量，不需要再过一遍；设备定位是真的会漂到隔壁街区的。
 */
function resolveTarget(input: RecordLocationInput):
  | { ok: true; target: ResolvedTarget }
  | { ok: false; code: ErrCode; message: string } {
  if (input.coords) {
    const { lat, lng, accuracyM } = input.coords;
    if (!isValidLatLng(lat, lng)) {
      return { ok: false, code: 'BAD_REQUEST', message: gpsRejectMessage('invalid') };
    }
    if (!isWithinFence({ lat, lng }, readCampusCenter(), readCampusRadiusM())) {
      return { ok: false, code: 'BAD_REQUEST', message: gpsRejectMessage('outside') };
    }
    // 精度阈值给得很宽（500m）：校园半径才 2000m，太严会把「站在楼里」也拒掉。
    // 真正拦住离谱数据的是围栏，这条只是防「基站定位到了几公里外」那种。
    if (typeof accuracyM === 'number' && accuracyM > 500) {
      return { ok: false, code: 'BAD_REQUEST', message: gpsRejectMessage('coarse') };
    }
    const near = nearestSpot(lat, lng);
    if (!near) return { ok: false, code: 'BAD_REQUEST', message: gpsRejectMessage('outside') };
    return {
      ok: true,
      target: { lat, lng, spot: near, source: 'gps', accuracyM: accuracyM ?? null },
    };
  }

  const spot = resolveCampusSpot(input.place ?? '');
  if (!spot) return { ok: false, code: 'BAD_REQUEST', message: unknownSpotMessage() };
  return {
    ok: true,
    target: { lat: spot.lat, lng: spot.lng, spot, source: 'spot', accuracyM: null },
  };
}

export interface PinMoveResult {
  moved: boolean;
  previous: { lat: number | null; lng: number | null };
}

/**
 * 把档案点位挪到「这次目击的坐标」，并留下审计（2026-10-29 抽出）。
 *
 * 两个入口共用它：星枢的 `recordLocation`（via='agent'）与记录页带定位提交
 * （via='record'）。抽出来的原因很实际 —— 审计字段一旦两处各写一份，
 * 迟早一边加 `source`、另一边忘掉，事后就分不清某个点是谁挪的。
 *
 * 匿名用户也能挪点，所以审计是唯一追责依据：谁（null=匿名）把谁从哪挪到哪、
 * 依据哪条观察记录、坐标来自白名单还是设备定位。
 */
export async function movePinToSighting(input: {
  animalCode: string;
  lat: number;
  lng: number;
  observationId: string;
  via: 'agent' | 'record';
  /** 坐标来源，必须显式给：设备不报精度时 accuracyM 可能是 null，不能靠它反推 */
  source: LocationSource;
  accuracyM?: number | null;
  /** 归到哪个角落；缺省时按最近角落记 */
  spotKey?: string | null;
}): Promise<PinMoveResult> {
  const animal = await prisma.animal.findUnique({
    where: { code: input.animalCode },
    select: { id: true, code: true, mapLat: true, mapLng: true },
  });
  const previous = { lat: animal?.mapLat ?? null, lng: animal?.mapLng ?? null };
  if (!animal) return { moved: false, previous };

  const moved = previous.lat !== input.lat || previous.lng !== input.lng;
  if (!moved) return { moved, previous };

  await prisma.animal.update({
    where: { id: animal.id },
    data: { mapLat: input.lat, mapLng: input.lng },
  });
  await writeAudit({
    actorId: null,
    action: AUDIT_ACTIONS.ANIMAL_LOCATION,
    targetType: 'Animal',
    targetId: animal.id,
    payload: {
      code: animal.code,
      spot: input.spotKey ?? nearestSpot(input.lat, input.lng)?.key ?? null,
      lat: input.lat,
      lng: input.lng,
      from: previous,
      observationId: input.observationId,
      via: input.via,
      source: input.source,
      ...(input.accuracyM !== undefined && input.accuracyM !== null
        ? { accuracyM: input.accuracyM }
        : {}),
    },
  });
  return { moved, previous };
}

export async function recordSightingLocation(
  input: RecordLocationInput,
  deps: ObservationDeps = {},
): Promise<RecordLocationOutcome> {
  const resolved = resolveTarget(input);
  if (!resolved.ok) return resolved;
  const { target } = resolved;
  const { spot } = target;

  const animal = await prisma.animal.findUnique({
    where: { code: input.animalCode },
    select: { id: true, code: true, name: true, mapLat: true, mapLng: true },
  });
  if (!animal) return { ok: false, code: 'NOT_FOUND', message: '这只动物的档案不存在' };

  // 记录正文必须能独立读懂：GPS 落点说「附近」而不是断言站在某个角落
  const fallbackContent =
    target.source === 'gps' ? `在${spot.name}附近看到它` : `在${spot.name}看到它`;
  const content = input.note?.trim() ? input.note.trim() : fallbackContent;

  // 走完整记录链路：内容安全、AI 语义解析、同事务预警，一个都不绕过。
  // 坐标来自白名单查表或用户设备定位，两者都不是模型的输出。
  const created = await createObservation(
    {
      animalCode: animal.code,
      content,
      lat: target.lat,
      lng: target.lng,
      ...(input.observerName ? { authorName: input.observerName } : {}),
      ip: input.ip ?? null,
    },
    deps,
  );
  if (!created.ok) {
    return { ok: false, code: created.code, message: created.message };
  }

  /* 挪点位与审计交给共用实现：记录页那条入口走的是同一个函数，
     两边的审计字段才不会各写一份、慢慢漂移。 */
  const { moved, previous } = await movePinToSighting({
    animalCode: animal.code,
    lat: target.lat,
    lng: target.lng,
    observationId: created.data.observation.id,
    via: 'agent',
    source: target.source,
    accuracyM: target.accuracyM,
    spotKey: spot.key,
  });

  return {
    ok: true,
    data: {
      spot: { key: spot.key, name: spot.name, lat: spot.lat, lng: spot.lng },
      coords: { lat: target.lat, lng: target.lng },
      source: target.source,
      accuracyM: target.accuracyM,
      animal: { code: created.data.animal.code, name: created.data.animal.name },
      moved,
      previous,
      observation: created.data.observation,
      alert: created.data.alert,
      notice: created.data.notice ?? null,
    },
  };
}
