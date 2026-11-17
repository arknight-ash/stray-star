import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Database,
  Info,
  KeyRound,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/admin/guard';
import { adminAccount } from '@/lib/auth/actor';
import { CAMPUS_SPOTS } from '@/lib/map-config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '系统设置 · 管理端',
  robots: { index: false, follow: false },
};

function day(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-space-700/40 py-2 last:border-b-0">
      <dt className="shrink-0 text-xs text-lo">{label}</dt>
      <dd className={`min-w-0 truncate text-right text-xs text-hi ${mono ? 'data-mono' : ''}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

function Card({
  title,
  Icon,
  children,
}: {
  title: string;
  Icon: typeof Info;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-card bg-space-800/60 p-3.5 ring-1 ring-space-700/70"
    >
      <h2 className="mb-2 flex items-center gap-1.5 font-display text-[15px] text-hi">
        <Icon size={15} style={{ color: 'var(--accent-300)' }} aria-hidden />
        {title}
      </h2>
      <dl>{children}</dl>
    </section>
  );
}

/**
 * 系统设置（2026-10-27 按设计稿二轮）。
 *
 * **只读、只展示真实值。** 设计稿里的通知开关、备份按钮在当前实现里没有对应后端 ——
 * 放一批不落库的假开关比少一列更糟（管理员以为开了备份，实际什么都没发生）。
 * 所以这一页的定位是「系统当前状态一览」：站点与校园口径、AI 链路、管理员账号、数据规模。
 * 哪天这些设置真的可写了，再把 Row 换成表单控件。
 */
export default async function AdminSettingsPage() {
  requireAdmin();

  const [lastLogin, counts] = await Promise.all([
    prisma.auditLog.findFirst({
      where: { action: 'ADMIN_LOGIN' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.$transaction([
      prisma.animal.count(),
      prisma.observation.count(),
      prisma.alert.count(),
      prisma.animalPhoto.count(),
      prisma.healthReport.count(),
      prisma.user.count(),
    ]),
  ]);
  const [animals, observations, alerts, photos, reports, users] = counts;

  const provider = process.env.AI_PROVIDER ?? 'mock';
  const chatModel = process.env.AI_MODEL ?? process.env.AI_CHAT_MODEL ?? '（未配置）';
  const visionModel = process.env.AI_VISION_MODEL ?? '（未配置）';
  const embedModel = process.env.AI_EMBED_MODEL ?? '（未配置）';
  const fallback = process.env.AI_FALLBACK_MODELS ?? '';
  const visionFallback = process.env.AI_VISION_FALLBACK_MODELS ?? '';

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2.5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-btn"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--accent-400) 18%, transparent)',
            color: 'var(--accent-300)',
          }}
          aria-hidden
        >
          <SettingsIcon size={17} />
        </span>
        <div>
          <h1 className="font-display text-[17px] leading-tight text-hi">系统设置</h1>
          <p className="mt-0.5 text-[11px] text-lo">站点、校园口径与 AI 链路的当前配置（只读）</p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="基础设置" Icon={Info}>
          <Row label="站点名称" value="智护流浪星" />
          <Row label="校园" value="武汉华夏理工学院 · 光谷校区" />
          <Row
            label="校园中心（WGS-84）"
            value={`${process.env.CAMPUS_CENTER_LAT ?? '30.469384'}, ${process.env.CAMPUS_CENTER_LNG ?? '114.405764'}`}
            mono
          />
          <Row label="命名角落" value={CAMPUS_SPOTS.map((s) => s.name).join(' / ')} />
          <Row label="地图防飞边界" value={`${process.env.CAMPUS_RADIUS_M ?? '2000'} m`} mono />
        </Card>

        <Card title="AI 配置" Icon={Sparkles}>
          <Row label="服务商" value={provider} mono />
          <Row label="对话模型" value={chatModel} mono />
          <Row label="视觉模型" value={visionModel} mono />
          <Row label="向量模型" value={embedModel} mono />
          <Row label="文本降级链" value={fallback || '（未配置）'} mono />
          <Row label="视觉降级链" value={visionFallback || '（未配置）'} mono />
          <Row
            label="单次尝试超时"
            value={`${process.env.AI_ATTEMPT_TIMEOUT_MS ?? '12000'} ms`}
            mono
          />
        </Card>

        <Card title="管理员账号" Icon={KeyRound}>
          <Row label="登录账号" value={adminAccount()} mono />
          <Row label="密码存放" value=".env 的 ADMIN_PASSWORD（不落库）" />
          <Row
            label="上次登录"
            value={lastLogin ? day(lastLogin.createdAt.toISOString()) : '暂无记录'}
            mono
          />
          <Row label="会话有效期" value="12 小时（httpOnly cookie）" />
          <div className="pt-2">
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-lo">
              <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden />
              改密码直接改 .env 里的 ADMIN_PASSWORD 后重启：旧会话的签名会立即失效，所有已登录的管理端被强制下线。
            </p>
          </div>
        </Card>

        <Card title="数据概览" Icon={Database}>
          <Row label="动物档案" value={`${animals} 只`} mono />
          <Row label="观察记录" value={`${observations} 条`} mono />
          <Row label="预警事件" value={`${alerts} 条`} mono />
          <Row label="照片" value={`${photos} 张`} mono />
          <Row label="健康报告" value={`${reports} 份`} mono />
          <Row label="注册用户" value={`${users} 人`} mono />
          <div className="pt-2">
            <p className="text-[11px] leading-relaxed text-lo">
              数据完整性可随时跑{' '}
              <code className="data-mono rounded bg-space-900/70 px-1 py-0.5 text-[10px]">
                npm run db:selftest
              </code>{' '}
              校验；种子重放{' '}
              <code className="data-mono rounded bg-space-900/70 px-1 py-0.5 text-[10px]">
                npm run db:seed
              </code>{' '}
              是幂等 upsert，不会碰用户提交的数据。总览见{' '}
              <Link href="/admin" className="underline-offset-2 hover:underline">
                系统总览
              </Link>
              。
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
