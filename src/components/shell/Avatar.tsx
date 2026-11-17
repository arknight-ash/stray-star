import { cn } from '@/lib/utils';

/**
 * 站点头像位。
 *
 * 当前项目未开放登录（User 表已备好但无 session），头像作为固定装饰位存在：
 * 传入 src 时渲染图片，否则落到内置默认头像（观测员头盔，内联 SVG 不引外链 —— R13：头像资源走本地）。
 * 接 next-auth 后只改调用点传 session.user?.image，本组件签名不变。
 */
export function Avatar({
  src,
  alt = '观测员头像',
  className,
}: {
  src?: string;
  alt?: string;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 头像来源可能是 /uploads 本地路径，走 next/image 需要额外配置域名白名单，收益为负
      <img
        src={src}
        alt={alt}
        className={cn('h-8 w-8 rounded-full object-cover ring-1 ring-space-700', className)}
      />
    );
  }
  return (
    <span
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-space-800 ring-1 ring-space-700',
        className,
      )}
      role="img"
      aria-label={alt}
    >
      <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden focusable="false">
        <circle cx="16" cy="16" r="16" fill="var(--space-800)" />
        {/* 头盔 */}
        <circle cx="16" cy="12.5" r="6" fill="var(--space-700)" stroke="var(--accent-400)" strokeWidth="1.5" />
        {/* 面罩高光 */}
        <path d="M12.5 11a4.5 4.5 0 0 1 3-1.6" stroke="var(--accent-300)" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        {/* 肩部 */}
        <path
          d="M7.5 26.5c1.9-4.2 5-6.3 8.5-6.3s6.6 2.1 8.5 6.3"
          fill="var(--space-700)"
          stroke="var(--accent-400)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
