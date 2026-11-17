import type { Metadata } from 'next';
import { PageShell } from '@/components/shell/PageShell';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { prisma } from '@/lib/db';

export const metadata: Metadata = {
  title: '星枢AI问答',
  description: '问一句，带着出处回答校园流浪动物的喂养、健康与救助问题。',
};

/**
 * 问答页。
 *
 * 建议问题来自**真实的知识库标题**，不是手写死的字符串：
 * 知识库换了内容，这里的引导也跟着变，不会指着一个已经不存在的主题。
 * 这也顺带保证空库时不会出现「点进去什么都答不上来」的推荐。
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams?: { animalId?: string };
}) {
  const [docs, animal] = await Promise.all([
    prisma.knowledgeDoc.findMany({
      select: { title: true },
      orderBy: { createdAt: 'asc' },
      take: 5,
    }),
    searchParams?.animalId
      ? prisma.animal.findUnique({
          where: { id: searchParams.animalId },
          select: { id: true, code: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  const suggestions = docs.map((d) => d.title.replace(/（[^）]*）/g, '')).slice(0, 4);

  return (
    <PageShell
      title="星枢AI问答"
      subtitle="答得上来的挂着出处，答不上来的会说不知道"
    >
      <ChatPanel
        animalId={animal?.id ?? null}
        animalLabel={animal ? `${animal.name}（${animal.code}）` : null}
        suggestions={suggestions}
      />
    </PageShell>
  );
}
