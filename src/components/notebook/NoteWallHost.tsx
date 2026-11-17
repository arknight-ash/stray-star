'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PenLine } from 'lucide-react';
import { NoteWall } from './NoteWall';
import { RecordBar } from './RecordBar';
import type { NoteVM } from '@/types/domain';

/**
 * 便签墙 + 记录条的最小客户端宿主。
 *
 * 为什么要单独抽出来：提交成功后服务端数据要重拉（便签与 health 档位都可能变了），
 * 这需要客户端参与；但整个档案页没必要为此变成 client component，
 * 服务端查好的数据照样一次性灌进来。
 */
export function NoteWallHost({
  notes,
  animalCode,
  animalName,
}: {
  notes: NoteVM[];
  animalCode: string;
  animalName: string;
}) {
  const router = useRouter();

  return (
    <>
      {/* RecordBar 是 `md:hidden` 的底部浮条，桌面端没有它 ——
          这一链接就是桌面在这页唯一的记录入口，指向同一个表单、
          带着已经选好的动物编号，进 /report 不必再选一次星 */}
      <section
        aria-label="众包便签墙"
        className="glass-card p-4"
      >
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="font-display text-base text-hi">众包便签墙</h2>
          <Link
            href={`/report?animal=${animalCode}`}
            className="hidden md:inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-accent-400 px-4 text-xs font-medium text-space-900 shadow-glow transition-opacity duration-star ease-star hover:opacity-90"
          >
            <PenLine size={13} aria-hidden />
            记录一笔
          </Link>
        </div>
        <NoteWall notes={notes} />
      </section>

      <RecordBar
        animalCode={animalCode}
        animalName={animalName}
        onAdded={() => {
          // 一条新观察可能推动健康档派生，重拉服务端数据即可，前端不重复推演
          router.refresh();
        }}
      />
    </>
  );
}
