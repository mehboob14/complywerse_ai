'use client';

// "Reopen with reason" on a closed issue. The server asks for a reason of at least REOPEN_MIN_REASON characters and keeps
// it in the issue's history (issues.py reopen_issue), so the dialog asks for the same.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, X } from 'lucide-react';
import { issuesApi } from '@/lib/api';
import { apiErrorText } from '@/lib/apiError';

export const REOPEN_MIN_REASON = 10;

export function ReopenIssueButton({ issueId }: { issueId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const close = () => { setOpen(false); setReason(''); reopen.reset(); };
  const reopen = useMutation({
    mutationFn: () => issuesApi.reopen(issueId, { reason: reason.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['issue-detail', issueId] }); close(); },
  });
  const ready = reason.trim().length >= REOPEN_MIN_REASON;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded border border-primary-200 bg-primary-50 px-2 py-1 text-[10px] font-medium text-primary-700 hover:bg-primary-100"
      >
        <RotateCcw className="h-3 w-3" /> Reopen with reason
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={close}>
          <div role="dialog" aria-modal="true" aria-labelledby="reopen-title"
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <h4 id="reopen-title" className="text-sm font-semibold text-slate-900">Reopen with reason</h4>
              <button onClick={close} aria-label="Close"><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <div className="space-y-2 px-4 py-3">
              <label htmlFor="reopen-reason" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Reason (required, kept in the issue&apos;s history)
              </label>
              <textarea id="reopen-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={2000}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                placeholder={`Why the closure did not hold: at least ${REOPEN_MIN_REASON} characters`} />
              {reopen.error && (
                <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {apiErrorText(reopen.error, 'The issue was not reopened.')}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
              <button onClick={close} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
              <button onClick={() => reopen.mutate()} disabled={!ready || reopen.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:bg-slate-300">
                {reopen.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                Reopen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
