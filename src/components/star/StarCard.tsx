import Link from 'next/link';
import { MapPin } from 'lucide-react';
import type { StarCardVM } from '@/types/domain';
import { HEALTH_META, SPECIES_META } from '@/lib/semantic';
import { formatCoord, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CodePlate } from './CodePlate';
import { HealthChip } from './HealthChip';
import { ConfidenceBadge } from './ConfidenceBadge';

/**
 * 星卡：一只动物 = 一颗星。
 * variant: grid（图鉴纸卡，设计稿图2）/ row（列表行）/ hero（档案页顶部）
 */
export function StarCard({
  animal,
  variant = 'grid',
  confidence,
  href,
  showLastSeen = true,
  className,
}: {
  animal: StarCardVM;
  variant?: 'grid' | 'row' | 'hero';
  confidence?: number;
  href?: string;
  showLastSeen?: boolean;
  className?: string;
}) {
  const target = href ?? `/animals/${animal.code}`;
  const species = SPECIES_META[animal.species];

  if (variant === 'hero') {
    return (
      <section className={cn('star-card p-5', className)}>
        <div className="flex items-start gap-4">
          <Avatar animal={animal} size={72} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CodePlate code={animal.code} />
              <span className="rounded-sticker bg-space-700/60 px-2 py-0.5 text-xs text-lo">
                {species.label}
              </span>
            </div>
            <h2 className="mt-2 font-display text-2xl leading-tight text-accent-300">
              {animal.name}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <HealthChip level={animal.healthLevel} />
              {typeof confidence === 'number' && <ConfidenceBadge value={confidence} size="sm" />}
            </div>
            {animal.mapLat != null && animal.mapLng != null && (
              <p className="data-mono mt-2 flex items-center gap-1 text-xs text-lo">
                <MapPin size={12} aria-hidden />
                {formatCoord(animal.mapLat, animal.mapLng)}
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'row') {
    return (
      <Link
        href={target}
        className={cn(
          'star-card star-card-interactive flex items-center gap-3 p-3',
          className,
        )}
      >
        <Avatar animal={animal} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CodePlate code={animal.code} tone="muted" />
            <span className="truncate text-sm text-hi">{animal.name}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <HealthChip level={animal.healthLevel} size="sm" />
            {showLastSeen && animal.lastSeenAt && (
              <span className="text-xs text-lo">{formatRelative(animal.lastSeenAt)}</span>
            )}
          </div>
        </div>
        {typeof confidence === 'number' && <ConfidenceBadge value={confidence} size="sm" />}
      </Link>
    );
  }

  // 图鉴网格（设计稿图2）：纸卡 = 照片区 + 墨字信息区 + 标签 chips。
  // 纸面上不允许用 text-lo（浅紫在纸上对比度不够）——纸面文字一律走 ink。
  return (
    <Link href={target} className={cn('star-card-glass block p-1.5', className)}>
      <div className="relative aspect-square overflow-hidden rounded-[10px] bg-space-700/50">
        {animal.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 头像来自 /uploads 本地路径
          <img
            src={animal.avatarUrl}
            alt={`${animal.name}（${animal.code}）`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span
            className="grid h-full w-full place-items-center font-display text-3xl text-hi"
            aria-hidden
          >
            {species.glyph}
          </span>
        )}
      </div>
      <div className="px-1 pb-0.5 pt-2">
        <div className="flex items-baseline justify-between gap-1">
          <h3 className="min-w-0 truncate font-display text-sm text-hi">{animal.name}</h3>
          <span className="data-mono shrink-0 text-[10px] tracking-wider text-lo">
            {animal.code}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="chip-glass inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px]">
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: `var(--star-${animal.healthLevel.toLowerCase()})` }}
              aria-hidden
            />
            {HEALTH_META[animal.healthLevel].label}
          </span>
          <span className="chip-glass inline-flex items-center px-1.5 py-0.5 text-[10px]">
            {species.label}
          </span>
          {typeof animal.observationCount === 'number' && animal.observationCount > 0 && (
            <span className="chip-glass data-mono inline-flex items-center px-1.5 py-0.5 text-[10px]">
              {animal.observationCount} 条
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function Avatar({ animal, size }: { animal: StarCardVM; size: number }) {
  if (animal.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={animal.avatarUrl}
        alt={`${animal.name}（${animal.code}）`}
        width={size}
        height={size}
        className="shrink-0 rounded-card object-cover ring-1 ring-space-700"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className="grid shrink-0 place-items-center rounded-card bg-space-700/60 font-display text-accent-300 ring-1 ring-space-700"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {SPECIES_META[animal.species].glyph}
    </span>
  );
}
