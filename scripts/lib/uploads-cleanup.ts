import { readdirSync } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { uploadDir } from '../../src/lib/uploads';

/**
 * 自检用的上传目录清理。
 *
 * 为什么需要它：`public/uploads` 只增不减，而自检每次都会写真图。
 * 早期两个自检脚本各写了一份删除逻辑，路径少了一层 `public/`，删除异常又被
 * `.catch(() => undefined)` 吞掉 —— 结果 print 着「已清理 1 张」，磁盘上却攒了十几张。
 *
 * 现在的口径：**以数据库引用为准**。只删「没有任何 Animal.avatarUrl / AnimalPhoto.url /
 * Observation.imageUrl 指向」的文件，所以既不需要记住 URL，也不会误删用户刚存下的图。
 */

/** 把 `/uploads/x.jpg` 落回真实磁盘路径；非法则返回 null */
function toDiskPath(url: string): string | null {
  if (!url.startsWith('/uploads/')) return null;
  return join(uploadDir(), basename(url));
}

/** 删除指定 URL 对应的文件（不存在就跳过），返回真正删掉的数量 */
export async function removeUploadUrls(urls: string[]): Promise<number> {
  let removed = 0;
  for (const url of urls) {
    const file = toDiskPath(url);
    if (!file) continue;
    try {
      await access(file);
      await rm(file, { force: true });
      removed += 1;
    } catch {
      /* 不存在或删不掉：不影响自检结论 */
    }
  }
  return removed;
}

/**
 * 清掉上传目录里所有「数据库不认」的文件，返回删除数量。
 * 自检跑完后调用 —— 此时测试动物已删除，它们留下的图就是孤儿。
 */
export async function sweepOrphanUploads(prisma: PrismaClient): Promise<number> {
  let files: string[];
  try {
    files = readdirSync(uploadDir());
  } catch {
    return 0;
  }
  if (!files.length) return 0;

  const urls = files.map((f) => `/uploads/${f}`);
  const [photos, observations, animals] = await Promise.all([
    prisma.animalPhoto.findMany({ where: { url: { in: urls } }, select: { url: true } }),
    prisma.observation.findMany({ where: { imageUrl: { in: urls } }, select: { imageUrl: true } }),
    prisma.animal.findMany({ where: { avatarUrl: { in: urls } }, select: { avatarUrl: true } }),
  ]);

  const used = new Set<string>();
  for (const p of photos) used.add(p.url);
  for (const o of observations) if (o.imageUrl) used.add(o.imageUrl);
  for (const a of animals) if (a.avatarUrl) used.add(a.avatarUrl);

  const orphans = files.filter((f) => !used.has(`/uploads/${f}`));
  let removed = 0;
  for (const file of orphans) {
    try {
      await rm(join(uploadDir(), file), { force: true });
      removed += 1;
    } catch {
      /* 删不掉不影响自检结论 */
    }
  }
  return removed;
}
