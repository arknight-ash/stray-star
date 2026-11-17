import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { RecordComposer } from '@/components/notebook/RecordComposer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '记录一笔',
  description: '看到它就替它记一笔：写出你观察到的状态，附张照片更好，情况紧急可以直接通知管理员。',
};

/**
 * 众包记录页（补掉阶段 4 起的死链：底部「记录」tab 与识别结果页都指向 /report）。
 *
 * 与移动端底部记录条（RecordBar，只在档案页出现）的分工：
 *  - 这里是**独立入口**：先从列表里选一颗星，再写记录；桌面唯一的记录入口；
 *  - RecordBar 是**就地补充**：已经在某只动物的档案页上，不必再选一次。
 * 因此带 `?animal=No.001` 进来时直接进表单，不重复那次已经做完的选择；
 * 编号在库里查不到时静默退回选星态 —— 这是写错链接，不是 404，
 * 让人从零开始点一遍远比甩一个死页友好。
 */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: { animal?: string };
}) {
  const requested = typeof searchParams.animal === 'string' ? searchParams.animal.trim() : '';

  const animals = await prisma.animal.findMany({
    orderBy: [{ healthLevel: 'desc' }, { code: 'asc' }],
    select: {
      code: true,
      name: true,
      species: true,
      healthLevel: true,
      avatarUrl: true,
    },
  });

  const initialCode = animals.some((a) => a.code === requested) ? requested : undefined;

  return (
    // 对齐设计稿图5：中央纸卡承载全部内容（卡内自带标题与三步进度），外层不再有页头
    <main className="mx-auto flex w-full max-w-3xl justify-center px-4 pb-28 pt-6 md:pb-16">
      <div className="w-full">
        <RecordComposer options={animals} initialCode={initialCode} />
      </div>
    </main>
  );
}
