/**
 * 星形基底：给 StarDot、图例等处复用的一枚五角星。
 *
 * 为什么单独放一个文件：`StarDot` 是 client 组件且带动画库依赖，
 * 服务端组件（图例）直接 import 它会把整棵子树拖进客户端 bundle，
 * 这里只导出纯渲染件，两端都能用。
 */
import { cn } from '@/lib/utils';

/** viewBox 24 的居中五角星（外径 10、内径 4.2），不引图标库、不额外发请求 */
export const STAR_PATH =
  'M12 2 L14.47 8.6 L21.51 8.91 L15.99 13.3 L17.88 20.09 L12 16.2 L6.12 20.09 L8.01 13.3 L2.49 8.91 L9.53 8.6 Z';

export function StarGlyph({
  size = 16,
  color,
  glow = true,
  className,
}: {
  size?: number;
  /** CSS 颜色（可以是 var(--star-green) 这类变量） */
  color: string;
  /** 是否加光晕：小尺寸图例里可关掉，避免糊成一团 */
  glow?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      style={{
        filter: glow
          ? `drop-shadow(0 0 ${Math.max(3, Math.round(size / 3))}px color-mix(in srgb, ${color} 55%, transparent))`
          : undefined,
      }}
      aria-hidden
      focusable="false"
    >
      <path d={STAR_PATH} fill={color} />
    </svg>
  );
}
