import { PrismaClient } from '@prisma/client';

/**
 * PrismaClient 单例。
 * dev 环境 HMR 会反复实例化，挂到 globalThis 避免连接数爆炸。
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type { Prisma } from '@prisma/client';
