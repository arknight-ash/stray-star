'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * 设备定位（手机 GPS / 浏览器 Geolocation）—— 全站唯一入口（2026-10-29）。
 *
 * 为什么收成一个 hook：定位有三种失败方式，每种都得给用户**不同的出路**，
 * 而这三个坑每个页面都会踩一遍，各写一份必然有一处漏掉。
 *
 *  1. **非安全上下文**（最容易被忽略的一个）：`navigator.geolocation` 只在
 *     HTTPS 或 localhost 下可用。手机通过局域网 IP（http://192.168.x.x:3000）
 *     访问时，浏览器**直接拒绝、连权限弹窗都不给**。这时报「权限被拒」是错的，
 *     用户会跑去设置里翻半天 —— 必须直说「需要 HTTPS」。
 *  2. **权限被拒**：用户点了"不允许"，或之前点过且勾了"不再询问"。
 *     这种要引导去浏览器设置，同时给「说地点名」这条退路。
 *  3. **超时 / 不可用**：室内、地铁、老设备。室内定位漂移是常态，
 *     所以超时给 12s（默认 5s 基本必超），并允许重试。
 *
 * 返回的坐标是 **WGS-84**，与库里 `mapLat/mapLng`、围栏常量同一套坐标系；
 * 底图若是 GCJ-02，由 `toTileLatLng()` 在绘制时纠偏，这里不做转换。
 */

export interface GeoFix {
  lat: number;
  lng: number;
  /** 浏览器上报的精度半径（米）。null = 这台设备没给 */
  accuracyM: number | null;
}

/**
 * idle      还没请求过
 * locating  正在定位（按钮显示转圈）
 * ready     拿到坐标
 * denied    用户拒绝 / 浏览器策略拒绝
 * insecure  非 HTTPS/localhost，浏览器不允许定位
 * unsupported 设备没有定位能力
 * timeout   超时（室内常见）
 */
export type GeoStatus =
  | 'idle'
  | 'locating'
  | 'ready'
  | 'denied'
  | 'insecure'
  | 'unsupported'
  | 'timeout';

export interface GeolocationState {
  status: GeoStatus;
  fix: GeoFix | null;
  /** 给用户看的一句话：说清为什么失败、下一步能做什么 */
  message: string | null;
}

/** 每种失败都给一条**能走通**的退路，而不是干巴巴的错误码 */
const MESSAGES: Record<Exclude<GeoStatus, 'idle' | 'locating' | 'ready'>, string> = {
  denied: '定位权限被拒绝了。可以在浏览器设置里重新允许，或者直接说地点名（如图书馆）',
  insecure: '当前不是 HTTPS 环境，浏览器不允许定位。请用 https 打开，或直接说地点名（如图书馆）',
  unsupported: '这台设备没有可用的定位服务，请直接说地点名（如图书馆）',
  timeout: '定位超时了（室内信号弱时常见），可以到窗边再试一次，或直接说地点名',
};

/** 12s：默认 5s 在楼里几乎必超；再长用户会以为按坏了 */
const TIMEOUT_MS = 12_000;
/** 1 分钟内取过的位置可以直接复用，避免连点两次各等 10 秒 */
const MAX_AGE_MS = 60_000;

export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    status: 'idle',
    fix: null,
    message: null,
  });
  /** 请求序号：连点两次时只认最后一次的回调，防止旧结果覆盖新结果 */
  const seqRef = useRef(0);

  const clear = useCallback(() => {
    seqRef.current += 1;
    setState({ status: 'idle', fix: null, message: null });
  }, []);

  const locate = useCallback((): Promise<GeoFix | null> => {
    // 只在点击回调里调用 —— 浏览器要求定位必须有用户手势，自动获取会被静默拒绝
    if (typeof window === 'undefined') return Promise.resolve(null);

    if (!window.isSecureContext) {
      setState({ status: 'insecure', fix: null, message: MESSAGES.insecure });
      return Promise.resolve(null);
    }
    if (!('geolocation' in navigator) || !navigator.geolocation) {
      setState({ status: 'unsupported', fix: null, message: MESSAGES.unsupported });
      return Promise.resolve(null);
    }

    seqRef.current += 1;
    const seq = seqRef.current;
    setState({ status: 'locating', fix: null, message: null });

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (seq !== seqRef.current) return resolve(null);
          const fix: GeoFix = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          };
          setState({ status: 'ready', fix, message: null });
          resolve(fix);
        },
        (err) => {
          if (seq !== seqRef.current) return resolve(null);
          // 1=PERMISSION_DENIED 2=POSITION_UNAVAILABLE 3=TIMEOUT
          const status: GeoStatus =
            err.code === err.PERMISSION_DENIED
              ? 'denied'
              : err.code === err.TIMEOUT
                ? 'timeout'
                : 'unsupported';
          setState({
            status,
            fix: null,
            message: MESSAGES[status as keyof typeof MESSAGES] ?? MESSAGES.unsupported,
          });
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
      );
    });
  }, []);

  return {
    ...state,
    locating: state.status === 'locating',
    ready: state.status === 'ready' && state.fix !== null,
    locate,
    clear,
  };
}

/** 精度的人话写法：「±12 米」。null 时返回空串，调用方自己决定要不要显示 */
export function formatAccuracy(accuracyM: number | null): string {
  if (accuracyM === null || !Number.isFinite(accuracyM)) return '';
  return `±${Math.round(accuracyM)} 米`;
}
