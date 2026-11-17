import Link from 'next/link';

/**
 * 首页右下角的「星枢AI」悬浮入口（2026-10-27 改版）。
 *
 * 改版前是一颗 44px 的圆点、里面一个 10px 的呼吸星 —— 干净，但没人知道那是助手，
 * 点进去纯靠好奇。现在改成带文字的胶囊：一眼能读出「星枢AI」，呼吸星只做点缀。
 *
 * 只在 md 以上出现：手机上底部 tab 已经有「星枢AI」那一格（还是抬起的实心球），
 * 再浮一个胶囊只会压住卡片正文。桌面端侧栏虽有同名页签，但胶囊是滑动中随手可点的那一个。
 * 也只在首页出现 —— 其他页面没有给它预留 padding。
 */
export function AgentStarFab() {
  return (
    <Link
      href="/agent"
      aria-label="打开星枢AI 对话"
      className="agent-fab-pill fixed bottom-[calc(56px+16px+env(safe-area-inset-bottom))] right-4 z-40 hidden h-11 items-center gap-2 rounded-full pl-3 pr-4 text-xs font-medium text-hi backdrop-blur transition-transform duration-star ease-star hover:scale-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400 md:bottom-8 md:right-6 md:flex md:h-12 md:gap-2.5 md:text-sm"
    >
      <span
        className="agent-fab-star block h-2 w-2 rounded-full md:h-2.5 md:w-2.5"
        // 静态辉光是留给 prefers-reduced-motion 的：动画被全局规则关掉后，
        // 原本只剩一个没有光晕的小圆点，看起来像坏了。这里把"最终帧"直接写成内联样式。
        style={{
          backgroundColor: 'var(--accent-300)',
          boxShadow: '0 0 10px var(--accent-300)',
        }}
        aria-hidden
      />
      星枢AI
    </Link>
  );
}
