/**
 * 管理端的两个小装饰件（纯 SVG，不引图片）。
 *
 * 为什么不放 public 里：这两枚只有 1–2 处使用，做成组件能跟着 currentColor 走，
 * 深浅底都不用另出一套图；也避免为一张 40px 的剪影多一次网络请求。
 */

/** 品牌四角星（与登录页同款） */
export function AdminMark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden focusable="false">
      <path
        d="M12 1.6c1 5.9 4.5 9.4 10.4 10.4-5.9 1-9.4 4.5-10.4 10.4C11 16.5 7.5 13 1.6 12 7.5 11 11 7.5 12 1.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * 坐着的猫剪影（侧栏底部）。用基本图形拼出来而不是描一条长路径：
 * 长路径在不同缩放下容易糊，而圆 + 三角 + 弧线在 48px 上仍然读得出一只猫。
 */
export function CatSilhouette({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 72 52" className={className} aria-hidden focusable="false">
      {/* 耳朵 */}
      <path d="M25 17.5 20.5 7l9 5.2Z" fill="currentColor" />
      <path d="M40 12.2 49.5 7 45 17.5Z" fill="currentColor" />
      {/* 头 */}
      <circle cx="35" cy="21" r="9.2" fill="currentColor" />
      {/* 身体 */}
      <path d="M24 50c0-9.5 4.6-15 11-15s11 5.5 11 15Z" fill="currentColor" />
      {/* 尾巴 */}
      <path
        d="M46 47.5c7.5 0 11.5-4.6 11.5-10.4 0-4.2-2.6-7-5.6-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
