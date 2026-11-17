import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LIMITS } from './constants';

/**
 * multipart 落盘。
 *
 * 三条硬规矩：
 *  1. 类型由「魔法字节」判定，绝不信任客户端给的 Content-Type —— 后者随手就能伪造；
 *  2. 文件名用随机 UUID，绝不接受用户的文件名 —— 防路径穿越与覆盖；
 *  3. 体积先看 file.size，落盘前再确认一次字节数，避免超大文件写满磁盘。
 */

export interface UploadedImage {
  /** 站内相对路径，可直接用于 <img src> 与后续建档复用 */
  url: string;
  mimeType: string;
  bytes: number;
}

export type UploadResult = { ok: true; data: UploadedImage } | { ok: false; message: string };

interface Signature {
  ext: string;
  mimeType: string;
  test: (buf: Uint8Array) => boolean;
}

const SIGNATURES: Signature[] = [
  {
    ext: 'jpg',
    mimeType: 'image/jpeg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: 'png',
    mimeType: 'image/png',
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    ext: 'webp',
    mimeType: 'image/webp',
    test: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  },
];

export function uploadDir(): string {
  return process.env.UPLOAD_DIR || path.join('public', 'uploads');
}

export async function saveUpload(file: File): Promise<UploadResult> {
  if (!file || file.size === 0) return { ok: false, message: '图片为空，请重新拍摄或选择文件' };
  if (file.size > LIMITS.imageBytes) {
    return {
      ok: false,
      message: `图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），请压缩到 ${LIMITS.imageBytes / 1024 / 1024}MB 以内`,
    };
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  if (buffer.byteLength === 0) return { ok: false, message: '图片为空，请重新拍摄或选择文件' };
  if (buffer.byteLength > LIMITS.imageBytes) return { ok: false, message: '图片超出大小上限' };

  const sniffed = SIGNATURES.find((s) => s.test(buffer));
  if (!sniffed) {
    return { ok: false, message: '只支持 JPEG / PNG / WebP 格式的图片' };
  }

  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}.${sniffed.ext}`;
  await writeFile(path.join(dir, filename), buffer);

  return {
    ok: true,
    data: {
      url: publicUrlFor(filename),
      mimeType: sniffed.mimeType,
      bytes: buffer.byteLength,
    },
  };
}

/**
 * 磁盘目录 → 可被静态访问的 URL 前缀。
 * UPLOAD_DIR 配的是 public/uploads，静态路径自然是 /uploads，
 * 因此把开头的 public/ 去掉，避免出现 /public/uploads 这种 404 地址。
 */
function publicUrlFor(filename: string): string {
  const dir = uploadDir()
    .split(path.sep)
    .join('/')
    .replace(/^\/+/, '')
    .replace(/^public\//, '')
    .replace(/\/+$/, '');
  return dir ? `/${dir}/${filename}` : `/${filename}`;
}

/**
 * 只接受站内 /uploads/ 路径：fromPhotoUrl 这类复用接口若接受任意 URL 就成了 SSRF 跳板。
 */
export function isOwnUploadUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  if (!url.startsWith('/uploads/')) return false;
  if (url.includes('..') || url.includes('//')) return false;
  return /^\/uploads\/[a-f0-9-]{36}\.(jpg|png|webp)$/i.test(url);
}

/**
 * 读回站内已上传的图片（供「复用照片重跑」使用）。
 * 只接受本站生成的 UUID 文件名：路径里出现 .. 或 // 一律拒绝，防目录穿越。
 */
export async function readOwnUpload(url: string): Promise<{ bytes: ArrayBuffer; mimeType: string } | null> {
  if (!isOwnUploadUrl(url)) return null;
  const file = path.join(process.cwd(), uploadDir(), path.basename(url));
  try {
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(file);
    // 拷一份到独立的 ArrayBuffer：直接使用 Buffer 的底层内存会随池复用被改动
    const bytes = new Uint8Array(buf).slice().buffer as ArrayBuffer;
    return { bytes, mimeType: mimeTypeFor(path.extname(file).slice(1)) };
  } catch {
    return null;
  }
}

function mimeTypeFor(ext: string): string {
  return SIGNATURES.find((s) => s.ext === ext.toLowerCase())?.mimeType ?? 'image/jpeg';
}

export function uploadsRoot(): string {
  return path.join(process.cwd(), uploadDir());
}

function ascii(buf: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end && i < buf.length; i += 1) out += String.fromCharCode(buf[i]);
  return out;
}
