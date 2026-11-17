import type { Metadata } from 'next';
import { AgentBrand } from '@/components/agent/AgentBrand';
import { AgentConsole } from '@/components/agent/AgentConsole';

export const metadata: Metadata = {
  title: '星枢AI · 智能助手',
  description:
    '一句话交给星枢AI：识别个体、评估健康、记录观察、检查预警、检索护理知识，每一步在星轨上看得见。',
};

/**
 * 星枢AI Agent 页（阶段 8 正式上线，取代 S2 以来的 redirect 占位）。
 *
 * S6 的 /chat 是纯 RAG 问答，保留不动；这里是带工具执行的工作流入口。
 * 降级路径也在这里闭环：工具失败 → 服务端自动改走 answerQuestion →
 * 星轨显示「改走安全航线」，用户不感知 500。
 *
 * 对齐设计稿图4：左栏视图切换 + 中栏对话流在 AgentConsole 内部实现，
 * 本页提供品牌头（AgentBrand，2026-10-27 新增）+ 全幅容器（不走 PageShell 页头）。
 */
export default function AgentPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 md:pb-10">
      <AgentBrand />
      <AgentConsole />
    </main>
  );
}
