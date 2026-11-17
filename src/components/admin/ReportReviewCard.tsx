'use client';

import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { SEVERITY_META } from '@/lib/semantic';
import { ConfidenceBadge } from '@/components/star/ConfidenceBadge';
import type { AdminReportVM } from '@/lib/api/alert-contract';

/**
 * 关键健康报告的审核卡（阶段 9）：通过 / 驳回 / 修改 三动作。
 *
 * 拍板结论（docs/stage-9-wrapup.md §1）：
 * - 修改 = 直接编辑原字段（assessment/severity），提交后服务端过 reconcile；
 * - 驳回必须给理由（服务端 zod 拦，前端 disabled 预挡）；
 * - 权限拒绝的理由原样显示，不自己改写（R7）。
 *
 * 只列 SEVERE / 建议就医 的报告：MILD 那份"看着还行"不该占管理员的注意力。
 */
export function ReportReviewCard({
  report,
  onDone,
}: {
  report: AdminReportVM;
  onDone: (next: AdminReportVM) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(report.assessment);
  const [draftSeverity, setDraftSeverity] = useState(report.severity);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rejected = report.reviewStatus === 'REJECTED';

  async function submit(verdict: 'APPROVED' | 'REJECTED') {
    if (verdict === 'REJECTED' && !note.trim()) {
      setError('驳回必须填写理由');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/${report.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          verdict,
          ...(verdict === 'APPROVED' && editing
            ? { edits: { assessment: draft, severity: draftSeverity } }
            : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          clientId: `review-${report.id}-${verdict}`,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        // 服务端的拒绝理由（权限、校验）原样显示 —— R7 不许前端改写
        setError(body?.error?.message ?? '操作失败，请重试');
        return;
      }
      onDone({
        ...report,
        reviewStatus: body.data.report.reviewStatus,
        reviewedByAdmin: body.data.report.reviewedByAdmin,
        reviewNote: body.data.report.reviewNote,
        reviewedByName: body.data.report.reviewedByName,
        ...(editing && verdict === 'APPROVED' ? { assessment: draft, severity: draftSeverity } : {}),
      });
      setEditing(false);
      setNote('');
    } catch {
      setError('网络似乎不太稳定，请重试');
    } finally {
      setBusy(false);
    }
  }

  const severity = SEVERITY_META[report.severity];

  return (
    <article
      className={`rounded-card border p-3 ${
        rejected ? 'border-star-red/40 bg-space-800/40' : 'border-space-700/70 bg-space-800/40'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="data-mono rounded-sticker px-2 py-0.5 text-[11px] text-hi">
          {report.animalCode} · {report.animalName}
        </span>
        <span className="text-[11px] text-lo">AI 判定 {severity.label}</span>
        {report.needsVet && <span className="text-[11px] text-star-red">建议就医</span>}
        <ConfidenceBadge value={report.confidence} size="sm" />
        {rejected && (
          <span className="rounded-sticker bg-star-red/15 px-2 py-0.5 text-[11px] text-star-red ring-1 ring-star-red/50">
            已驳回
          </span>
        )}
        {report.reviewedByAdmin && !rejected && (
          <span className="rounded-sticker bg-star-green/12 px-2 py-0.5 text-[11px] text-star-green ring-1 ring-star-green/45">
            已确认
          </span>
        )}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <label className="block text-xs text-lo">
            评估结论（提交后服务端会再做一次一致性校正）
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1 w-full resize-none rounded-btn border border-space-700 bg-space-900/60 p-2 text-sm text-hi outline-none focus:border-accent-400/60"
            />
          </label>
          <label className="block text-xs text-lo">
            严重度
            <select
              value={draftSeverity}
              onChange={(e) => setDraftSeverity(e.target.value as AdminReportVM['severity'])}
              className="mt-1 block rounded-btn border border-space-700 bg-space-900/60 px-2 py-1.5 text-sm text-hi outline-none focus:border-accent-400/60"
            >
              <option value="MILD">轻度</option>
              <option value="MODERATE">中度</option>
              <option value="SEVERE">重度</option>
            </select>
          </label>
        </div>
      ) : (
        <p className={`mt-2 text-sm text-hi ${rejected ? 'opacity-70' : ''}`}>{report.assessment}</p>
      )}

      {report.reviewNote && (
        <p className="mt-1.5 text-xs text-lo">
          审核备注（{report.reviewedByName ?? '管理员'}）：{report.reviewNote}
        </p>
      )}

      {/* 驳回理由输入：任何动作都可用，通过时它就是"修改说明" */}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
        placeholder={rejected ? '已驳回，可补充说明后重新审核' : '审核备注（驳回必填）'}
        aria-label="审核备注"
        className="mt-2 w-full rounded-btn border border-space-700 bg-transparent px-2.5 py-1.5 text-xs text-hi outline-none placeholder:text-lo/50 focus:border-accent-400/60"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void submit('APPROVED')}
          disabled={busy}
          aria-busy={busy}
          className="flex min-h-[32px] items-center gap-1 rounded-btn bg-star-green/15 px-3 text-xs text-star-green ring-1 ring-star-green/45 transition-opacity duration-star ease-star hover:bg-star-green/25 disabled:opacity-40"
        >
          <Check size={13} aria-hidden /> 通过{editing ? '并修改' : ''}
        </button>
        <button
          type="button"
          onClick={() => void submit('REJECTED')}
          disabled={busy}
          aria-busy={busy}
          className="flex min-h-[32px] items-center gap-1 rounded-btn bg-star-red/12 px-3 text-xs text-star-red ring-1 ring-star-red/45 transition-opacity duration-star ease-star hover:bg-star-red/20 disabled:opacity-40"
        >
          <X size={13} aria-hidden /> 驳回
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing((v) => !v);
            if (!editing) {
              setDraft(report.assessment);
              setDraftSeverity(report.severity);
            }
          }}
          disabled={busy}
          aria-pressed={editing}
          className="flex min-h-[32px] items-center gap-1 rounded-btn border border-space-700 px-3 text-xs text-hi transition-colors duration-star ease-star hover:border-accent-400 disabled:opacity-40"
        >
          <Pencil size={12} aria-hidden /> {editing ? '收起修改' : '修改'}
        </button>
        <span className="text-[11px] text-lo">
          {rejected
            ? '已驳回：不计入正式档案，可补充说明后重新通过'
            : report.reviewedByAdmin
              ? `已由 ${report.reviewedByName ?? '管理员'} 确认，计入正式档案`
              : '未确认：结论不参与正式档案'}
        </span>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-star-red">
          {error}
        </p>
      )}
    </article>
  );
}
