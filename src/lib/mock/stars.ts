import type { StarCardVM } from '@/types/domain';

/**
 * 与 prisma/seed/animals.ts 一一对应的前端占位数据。
 * 用途：数据库尚未启动（或未 seed）时，首页与设计系统页仍能完整渲染。
 * S2 接库后，业务页面改为服务端读取 Prisma，本文件只保留给 /design 预览用。
 */
export const MOCK_STARS: StarCardVM[] = [
  {
    id: 'seed-no-001',
    code: 'No.001',
    name: '煤球',
    species: 'CAT',
    avatarUrl: '/animals/No.001.svg',
    healthLevel: 'GREEN',
    mapLat: 30.469584,
    mapLng: 114.404064,
    createdAt: '2026-09-02T10:00:00.000Z',
    lastSeenAt: new Date(Date.now() - 3600_000).toISOString(),
    observationCount: 3,
  },
  {
    id: 'seed-no-002',
    code: 'No.002',
    name: '橘长',
    species: 'CAT',
    avatarUrl: '/animals/No.002.svg',
    healthLevel: 'YELLOW',
    mapLat: 30.467184,
    mapLng: 114.406464,
    createdAt: '2026-09-05T10:00:00.000Z',
    lastSeenAt: new Date(Date.now() - 7200_000).toISOString(),
    observationCount: 4,
  },
  {
    id: 'seed-no-003',
    code: 'No.003',
    name: '雪梨',
    species: 'CAT',
    avatarUrl: '/animals/No.003.svg',
    healthLevel: 'GREEN',
    mapLat: 30.470884,
    mapLng: 114.407364,
    createdAt: '2026-09-11T10:00:00.000Z',
    lastSeenAt: new Date(Date.now() - 86400_000 * 2).toISOString(),
    observationCount: 3,
  },
  {
    id: 'seed-no-004',
    code: 'No.004',
    name: '大黄',
    species: 'DOG',
    avatarUrl: '/animals/No.004.svg',
    healthLevel: 'GREEN',
    mapLat: 30.467884,
    mapLng: 114.409064,
    createdAt: '2026-09-18T10:00:00.000Z',
    lastSeenAt: new Date(Date.now() - 3600_000 * 5).toISOString(),
    observationCount: 3,
  },
  {
    id: 'seed-no-005',
    code: 'No.005',
    name: '小灰',
    species: 'DOG',
    avatarUrl: '/animals/No.005.svg',
    healthLevel: 'RED',
    mapLat: 30.471584,
    mapLng: 114.402764,
    createdAt: '2026-10-10T10:00:00.000Z',
    lastSeenAt: new Date(Date.now() - 1800_000).toISOString(),
    observationCount: 2,
  },
];
