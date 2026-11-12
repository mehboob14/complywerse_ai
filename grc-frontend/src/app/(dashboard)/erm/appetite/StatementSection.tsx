'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, FileText, Loader2, Send, Undo2 } from 'lucide-react';
import { ermApi } from '@/lib/api';
import { errorText } from '@/components/settings/CustomFields';
import { lineDiff, STATEMENT_STATUS, type AppetiteStatement } from './appetiteModel';

const INPUT = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
const BTN = 'inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-md bg-primary-500 px-2.5 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50';

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Badge({ status }: { status: AppetiteStatement['status'] }) {
  const s = STATEMENT_STATUS[status];
  return <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', s.tone)}>{s.label}</span>;
}

function Diff({ before, after }: { before: string; after: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2.5 text-sm">
      {lineDiff(before, after).map((line, i) => (
        <p key={i} className={clsx('whitespace-pre-wrap px-1', line.kind === 'added' && 'bg-emerald-50 text-emerald-800',
          line.kind === 'removed' && 'bg-rose-50 text-rose-700 line-through')}>
          {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}{line.text || ' '}
        </p>
      ))}
    </div>
  );
}

/**
 * The appetite statement: the approved version in force, the open draft (edit, submit), the decision on a submitted
 * version (approve or send back, by someone other than the submitter: the server refuses the submitter and says so) and
 * the version history with what each version changed.
 */
export default function StatementSection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['appetite-statements'],
    queryFn: async () => (await ermApi.appetite.statements.list()).data as AppetiteStatement[],
  });
  const current = versions.find((v) => v.status === 'approved');
  const open = versions.find((v) => v.status === 'draft' || v.status === 'pending_approval');

  const settle = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appetite-statements'] });
      setText(null); setNote(''); setError(null);
    },
    onError: (e: unknown) => setError(errorText(e, 'Could not save the statement.')),
  };
  const save = useMutation({
    mutationFn: () => (open ? ermApi.appetite.statements.update(open.id, text || '') : ermApi.appetite.statements.create(text || '')),
    ...settle,
  });
  const submit = useMutation({ mutationFn: (id: number) => ermApi.appetite.statements.submit(id), ...settle });
  const approve = useMutation({ mutationFn: (id: number) => ermApi.appetite.statements.approve(id, note.trim() || undefined), ...settle });
  const reject = useMutation({ mutationFn: (id: number) => ermApi.appetite.statements.reject(id, note.trim()), ...settle });
  const busy = save.isPending || submit.isPending || approve.isPending || reject.isPending;

  if (isLoading) return <div className="cw-card rounded-xl p-4 text-sm text-slate-500">Loading the statement…</div>;

  return (
    <section className="cw-card rounded-xl p-4 space-y-4" aria-labelledby="appetite-statement-title">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
        <h3 id="appetite-statement-title" className="text-base font-semibold text-slate-900">Appetite statement</h3>
      </div>

      {current ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge status="approved" /> Version {current.version}, approved by {current.approved_by_name || '—'} on {when(current.approved_at)};
            in force from {when(current.effective_from)}
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{current.statement}</p>
          {current.approval_note && <p className="text-xs text-slate-500">Approval note: {current.approval_note}</p>}
          <p className="text-xs text-slate-500">
            Limits in force: version {current.version}
            {current.limits ? ', frozen with it at approval. A later limit change needs someone else’s approval.' : ' (approved before limits were frozen with a version).'}
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-600">No appetite set. Start with the board-approved statement.</p>
      )}

      {open?.status === 'draft' && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <div className="flex items-center gap-2 text-xs text-slate-500"><Badge status="draft" /> Version {open.version}</div>
          {open.approval_note && <p className="text-xs text-amber-700">Sent back: {open.approval_note}</p>}
          {canEdit ? (
            <>
              <label htmlFor="appetite-draft" className="sr-only">Draft statement</label>
              <textarea id="appetite-draft" rows={5} className={INPUT} value={text ?? open.statement} onChange={(e) => setText(e.target.value)} />
              <div className="flex justify-end gap-2">
                <button type="button" className={BTN} disabled={busy || text === null || !text.trim()} onClick={() => save.mutate()}>
                  {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save draft
                </button>
                <button type="button" className={PRIMARY} disabled={busy || text !== null} title={text !== null ? 'Save the draft first' : undefined}
                  onClick={() => submit.mutate(open.id)}>
                  <Send className="h-3.5 w-3.5" strokeWidth={1.75} /> Send for approval
                </button>
              </div>
            </>
          ) : <p className="whitespace-pre-wrap text-sm text-slate-800">{open.statement}</p>}
        </div>
      )}

      {open?.status === 'pending_approval' && (
        <div className="space-y-2 rounded-lg border border-amber-200 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge status="pending_approval" /> Version {open.version}, sent by {open.submitted_by_name || '—'}. Changes against the approved version:
          </div>
          <Diff before={current?.statement || ''} after={open.statement} />
          {canEdit && (
            <>
              <label htmlFor="appetite-decision" className="block text-xs font-medium text-slate-700">Decision note (required to send back)</label>
              <textarea id="appetite-decision" rows={2} className={INPUT} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="E.g. approved by the Board on 10 November" />
              <div className="flex justify-end gap-2">
                <button type="button" className={BTN} disabled={busy || !note.trim()} onClick={() => reject.mutate(open.id)}>
                  <Undo2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Send back
                </button>
                <button type="button" className={PRIMARY} disabled={busy} onClick={() => approve.mutate(open.id)}>
                  {approve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />} Approve version
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!open && canEdit && (text === null ? (
        <button type="button" className={BTN} onClick={() => setText(current?.statement || '')}>
          {current ? 'Propose a new version' : 'Draft the statement'}
        </button>
      ) : (
        <div className="space-y-2">
          <label htmlFor="appetite-new" className="block text-xs font-medium text-slate-700">Version {(versions[0]?.version || 0) + 1}</label>
          <textarea id="appetite-new" rows={5} className={INPUT} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="How much risk the bank will take, per category, in plain words" />
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN} onClick={() => setText(null)}>Cancel</button>
            <button type="button" className={PRIMARY} disabled={busy || !text.trim()} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save draft
            </button>
          </div>
        </div>
      ))}
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}

      {versions.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-slate-600">Version history ({versions.length})</summary>
          <ul className="mt-2 space-y-2">
            {versions.map((v, i) => (
              <li key={v.id} className="rounded-lg border border-slate-100 p-2.5">
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">Version {v.version}</span> <Badge status={v.status} />
                  {v.approved_at && <span>approved by {v.approved_by_name || '—'} on {when(v.approved_at)}</span>}
                </div>
                <Diff before={versions[i + 1]?.statement || ''} after={v.statement} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
