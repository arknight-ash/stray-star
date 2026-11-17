import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Camera, ImageOff } from 'lucide-react';
import { prisma } from '@/lib/db';
import { PageShell } from '@/components/shell/PageShell';
import type { ObservationType } from '@/lib/api/observation-contract';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '照片墙',
};

/**
 * 照片墙（2026-10-26 需求「真实的动物照片，有喂养、救助等」）。
 *
 * 数据只有一条来源：`Observation.imageUrl` —— 「记录一笔」上传的照片本来就挂在
 * 观察记录上（type: 喂养/健康/行为/其他），照片墙只是把它翻过来给所有人看。
 * 不读 AnimalPhoto：那是识别库（种子 SVG 色卡 + 识别上传），与"某次喂养的照片"
 * 语义不同，混在一起会把待归属的识别素材也当成"记录的证据"。
 */

const FILTERS: Array<{ key: string; label: string; type?: ObservationType }> = [
  { key: 'all', label: '全部' },
  { key: 'FEEDING', label: '喂养', type: 'FEEDING' },
  { key: 'HEALTH', label: '健康·救助', type: 'HEALTH' },
  { key: 'BEHAVIOR', label: '行为', type: 'BEHAVIOR' },
  { key: 'OTHER', label: '其他', type: 'OTHER' },
];

const TYPE_LABEL: Record<ObservationType, string> = {
  FEEDING: '喂养',
  HEALTH: '健康·救助',
  BEHAVIOR: '行为',
  OTHER: '其他',
};

export default async function PhotosPage({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const active = FILTERS.find((f) => f.key === searchParams.type) ?? FILTERS[0]!;

  const observations = await prisma.observation.findMany({
    where: {
      imageUrl: { not: null },
      ...(active.type ? { type: active.type } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      id: true,
      imageUrl: true,
      type: true,
      content: true,
      authorName: true,
      createdAt: true,
      animal: { select: { code: true, name: true } },
    },
  });

  return (
    <PageShell title="照片墙" subtitle="每一次喂养与救助，都留下了证据">
      {/* 类型筛选 chips */}
      <nav aria-label="按类型筛选" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const on = f.key === active.key;
          return (
            <Link
              key={f.key}
              href={f.key === 'all' ? '/photos' : `/photos?type=${f.key}`}
              aria-current={on ? 'page' : undefined}
              className="rounded-full px-3.5 py-1.5 text-xs ring-1 transition-colors duration-star ease-star"
              style={
                on
                  ? { backgroundImage: 'var(--grad-cta)', color: 'var(--text-hi)' }
                  : {
                      color: 'var(--text-lo)',
                      boxShadow: 'inset 0 0 0 1px var(--space-700)',
                    }
              }
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {observations.length === 0 ? (
        <div className="glass-card mt-4 flex flex-col items-center gap-2 p-10 text-center">
          <ImageOff size={22} className="text-lo" aria-hidden />
          <p className="text-sm text-hi">这类照片还没有</p>
          <p className="text-xs text-lo">
            去
            <Link href="/report" className="text-accent-300 underline underline-offset-2">
              记录一笔
            </Link>
            传一张，这里就会亮起来。
          </p>
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {observations.map((o) => (
            <li key={o.id} className="glass-card overflow-hidden">
              <div className="relative aspect-square bg-space-800">
                {/* imageUrl 来自服务端 saveUpload（/uploads 固定前缀），非用户可控外链 */}
                {/* eslint-disable-next-line @next/next/no-img-element -- 同 Avatar：/uploads 本地路径走 next/image 需额外域名白名单，收益为负 */}
                <img
                  src={o.imageUrl ?? ''}
                  alt={o.animal ? `${o.animal.name}（${o.animal.code}）的${TYPE_LABEL[o.type]}照片` : '动物照片'}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <span className="absolute left-2 top-2 rounded-sticker bg-space-900/80 px-1.5 py-0.5 text-[10px] text-hi backdrop-blur">
                  {TYPE_LABEL[o.type]}
                </span>
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs text-hi">
                  {o.animal ? `${o.animal.name} · ${o.animal.code}` : '校园的星'}
                </p>
                {o.content && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-lo">
                    {o.content}
                  </p>
                )}
                <p className="mt-1 flex items-center gap-1 text-[10px] text-lo">
                  <Camera size={10} aria-hidden />
                  {o.authorName ?? '匿名同学'} · {o.createdAt.toLocaleDateString('zh-CN')}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
