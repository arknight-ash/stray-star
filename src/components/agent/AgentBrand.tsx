import { Camera, Database, PenLine, ShieldAlert, Orbit } from 'lucide-react';

/**
 * /agent 页的品牌头（2026-10-27）。
 *
 * 改版前这一页进来就是一片空白对话区，只有一个 2xl 的「星枢」小标题 ——
 * 用户不知道它是助手、能干什么、和 /chat 的问答有什么区别。
 *
 * 这里把「是谁 + 能干什么」说清楚：轨道球 + 名字 + 一句定位 + 四个能力标签。
 * 能力标签不是装饰 —— 它们和工具注册表的九件套一一对得上（识别/查库/记录/预警）。
 */
const CAPABILITIES = [
  { Icon: Camera, label: '看图识别个体' },
  { Icon: Database, label: '读库答数据' },
  { Icon: PenLine, label: '写观察记录' },
  { Icon: ShieldAlert, label: '查健康预警' },
] as const;

export function AgentBrand() {
  return (
    <section aria-label="星枢AI" className="agent-spotlight mb-4 rounded-card p-4 md:p-5">
      <div className="flex items-center gap-3.5">
        <span
          className="agent-orb grid h-12 w-12 shrink-0 place-items-center md:h-14 md:w-14"
          aria-hidden
        >
          <Orbit size={22} strokeWidth={1.75} className="relative z-10 text-hi" />
        </span>
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl leading-tight text-hi">
            星枢AI
            <span className="rounded-full border border-accent-400/45 bg-accent-400/10 px-1.5 py-0.5 text-[10px] font-normal leading-none text-accent-300">
              智能助手
            </span>
          </h1>
          <p className="mt-1 text-xs text-lo md:text-sm">
            说得清的事，它替你跑完全程；跑不动的，改走安全航线
          </p>
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2">
        {CAPABILITIES.map(({ Icon, label }) => (
          <li
            key={label}
            className="inline-flex items-center gap-1.5 rounded-full border border-space-700/80 bg-space-800/70 px-2.5 py-1 text-[11px] text-lo"
          >
            <Icon size={12} strokeWidth={1.75} style={{ color: 'var(--accent-300)' }} aria-hidden />
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}
