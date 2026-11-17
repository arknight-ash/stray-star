import Link from 'next/link';
import { ArrowRight, Orbit } from 'lucide-react';

/**
 * 首页「星枢AI」主卡（2026-10-27 改版）。
 *
 * 改版前星枢只是四张等分功能卡之一（拍摄/图鉴/星枢问答/记录），和别的卡一样大小、
 * 一样灰底 —— 用户根本注意不到它不是普通的查询入口，而是一个能调工具的助手。
 *
 * 现在它独占一行：光斑卡面 + 轨道球 + 能力标签 + 「开始对话」CTA，
 * 剩下三张卡退居其后（功能卡网格同时从 4 列改 3 列）。
 * 卡面视觉全部走 globals.css 的 .agent-spotlight / .agent-orb，组件里不写死颜色。
 */
const CAPS = ['看图识别个体', '读库答数据', '写观察记录', '查健康预警'] as const;

export function AgentSpotlight() {
  return (
    <Link
      href="/agent"
      className="agent-spotlight group flex items-center gap-3.5 rounded-card p-4 md:gap-4 md:p-5"
      aria-label="打开星枢AI 对话"
    >
      <span
        className="agent-orb grid h-11 w-11 shrink-0 place-items-center md:h-12 md:w-12"
        aria-hidden
      >
        <Orbit size={20} strokeWidth={1.75} className="relative z-10 text-hi" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-display text-lg leading-none text-hi">星枢AI</span>
          <span className="rounded-full border border-accent-400/45 bg-accent-400/10 px-1.5 py-0.5 text-[10px] leading-none text-accent-300">
            智能助手
          </span>
        </p>
        {/* 手机上给两行、不截成省略号：卡面上唯一一句「它能干什么」，截断了就没信息量 */}
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-lo md:line-clamp-1 md:text-[13px]">
          一句话说清要做什么，它规划路径、调工具、把结果办完
        </p>
        {/* 能力标签只在 sm 以上出现：手机上卡面要留给「星枢AI」四个字和一键进入 */}
        <ul className="mt-2 hidden flex-wrap items-center gap-x-3 gap-y-1 sm:flex">
          {CAPS.map((cap) => (
            <li key={cap} className="flex items-center gap-1.5 text-[11px] text-lo">
              <span
                className="h-1 w-1 rounded-full"
                style={{ backgroundColor: 'var(--accent-400)' }}
                aria-hidden
              />
              {cap}
            </li>
          ))}
        </ul>
      </div>

      <span
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-hi shadow-glow md:px-4 md:py-2.5 md:text-sm"
        style={{ backgroundImage: 'var(--grad-cta)' }}
      >
        <span className="hidden sm:inline">开始对话</span>
        <ArrowRight
          size={14}
          aria-hidden
          className="transition-transform duration-star ease-star group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}
