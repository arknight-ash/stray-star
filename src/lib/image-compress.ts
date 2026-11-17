/**
 * 客户端图片压缩。
 *
 * 为什么这件事必须在浏览器里做、且必须有：
 *  1. 手机拍的原图动辄 5–8MB，直传要等，学生站在寒风里等不起；
 *  2. 服务端再做就要引入 sharp 这类原生依赖（Windows/Docker 上编译成本高），
 *     而 canvas 是现成的、零依赖的。
 *
 * 压缩后的图同时服务于「给 AI 看」和「给地图/档案看」两条路径，
 * 因此这里必须是唯一的入口 —— 两份实现迟早会有一个偷懒不压缩。
 */

export const COMPRESS_MAX_EDGE = 1280;
export const COMPRESS_QUALITY = 0.82;

export async function compressImage(
  file: File,
  maxEdge = COMPRESS_MAX_EDGE,
  quality = COMPRESS_QUALITY,
): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));

  // 已经是小图就不折腾：重编码一次只会丢画质
  if (scale === 1 && file.size < 1024 * 1024) {
    bitmap.close?.();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return file;
  }

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  return blob ?? file;
}
