import Link from 'next/link';
import { PageShell, SectionTitle } from '@/components/shell/PageShell';
import { StarCard } from '@/components/star/StarCard';
import { StarDot } from '@/components/star/StarDot';
import { StickerTag } from '@/components/star/StickerTag';
import { NoteCard } from '@/components/star/NoteCard';
import { HealthSpectrum } from '@/components/star/HealthSpectrum';
import { Disclaimer } from '@/components/star/Disclaimer';
import { ConfidenceBadge } from '@/components/star/ConfidenceBadge';
import { HealthChip } from '@/components/star/HealthChip';
import { CodePlate } from '@/components/star/CodePlate';
import { MOCK_STARS } from '@/lib/mock/stars';
import { DISCLAIMER } from '@/lib/constants';

/**
 * 设计系统预览页：一眼核对令牌落点、语义色与七个基础组件的所有状态。
 * 仅用于开发核对，不参与业务链路。
 */
export default function DesignPage() {
  const [star] = MOCK_STARS;

  return (
    <PageShell title="设计系统" subtitle="深空观测站 × 救助手账 · 令牌与基础组件一览">
      <section className="star-card p-5">
        <SectionTitle hint="star-green / star-yellow / star-red">语义色 · 星点变体</SectionTitle>
        <div className="flex flex-wrap items-center gap-6">
          {(['GREEN', 'YELLOW', 'RED'] as const).map((lv) => (
            <div key={lv} className="flex flex-col items-center gap-2">
              <StarDot level={lv} size={14} variant="idle" />
              <StarDot level={lv} size={14} variant="pulse" />
              <StarDot level={lv} size={14} variant="alert" />
              <span className="text-xs text-lo">{lv}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {(['GREEN', 'YELLOW', 'RED'] as const).map((lv) => (
            <HealthChip key={lv} level={lv} />
          ))}
        </div>
      </section>

      <section className="star-card mt-6 p-5">
        <SectionTitle hint="只读 / 可点击">HealthSpectrum 光谱条</SectionTitle>
        <div className="grid gap-5 sm:grid-cols-2">
          <HealthSpectrum level="GREEN" value={0.92} />
          <HealthSpectrum level="YELLOW" value={0.71} />
          <HealthSpectrum level="RED" size="sm" />
          <HealthSpectrum level="YELLOW" showLabels={false} />
        </div>
      </section>

      <section className="star-card mt-6 p-5">
        <SectionTitle hint="0.92 / 0.74 / 0.48">ConfidenceBadge 置信度</SectionTitle>
        <div className="flex flex-wrap items-start gap-4">
          <ConfidenceBadge value={0.92} showBar />
          <ConfidenceBadge value={0.74} showBar />
          <ConfidenceBadge value={0.48} showBar />
          <ConfidenceBadge value={0.66} size="sm" label="匹配" />
        </div>
      </section>

      <section className="star-card mt-6 p-5">
        <SectionTitle hint="胶带 / 状态标签">StickerTag 贴纸</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <StickerTag>已投喂</StickerTag>
          <StickerTag tone="green" rotate={2}>已绝育</StickerTag>
          <StickerTag tone="yellow" rotate={-3}>持续观察</StickerTag>
          <StickerTag tone="red" rotate={1}>需就医</StickerTag>
          <StickerTag tone="paper" rotate={-1}>手账胶带</StickerTag>
        </div>
      </section>

      <section className="mt-6">
        <SectionTitle hint="可旋转">NoteCard 便签墙</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <NoteCard rotate={-2} pin author="阿澈">
            晚 7 点在图书馆北侧花坛投喂，吃了大概半碗猫粮，左耳耳标看得很清楚。
          </NoteCard>
          <NoteCard rotate={1.5} tone="amber" author="小鹿">
            右后腿有外伤，已经上报社团，等有经验的同学一起处理。
          </NoteCard>
        </div>
      </section>

      <section className="mt-6">
        <SectionTitle hint="grid / row / hero">StarCard 星卡</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          {MOCK_STARS.slice(0, 3).map((s) => (
            <StarCard key={s.id} animal={s} confidence={0.88} />
          ))}
        </div>
        <div className="mt-3 space-y-3">
          {MOCK_STARS.slice(0, 2).map((s) => (
            <StarCard key={s.id} animal={s} variant="row" />
          ))}
        </div>
        <div className="mt-3">
          <StarCard animal={star} variant="hero" confidence={0.91} />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <CodePlate code="No.001" />
          <CodePlate code="No.005" tone="muted" />
          <span className="data-mono text-xs text-lo">30.469584, 114.404064</span>
        </div>
      </section>

      <section className="mt-6 space-y-3">
        <SectionTitle hint="inline / block / toast">Disclaimer 免责声明</SectionTitle>
        <Disclaimer />
        <Disclaimer variant="block" />
        <Disclaimer variant="toast" />
        <p className="text-xs text-lo">{DISCLAIMER.slice(0, 24)}…（文案唯一来源：lib/constants.ts）</p>
      </section>

      <p className="mt-8 text-sm text-lo">
        回到 <Link href="/" className="text-accent-300 underline">观测站首页</Link>
      </p>
    </PageShell>
  );
}
