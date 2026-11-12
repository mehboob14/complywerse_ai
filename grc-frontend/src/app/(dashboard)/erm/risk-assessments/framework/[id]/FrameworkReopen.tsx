'use client';

// "Reopen with reason" on an approved framework assessment. An approved assessment is locked on the server; someone who
// may approve it (not whoever completed it) reopens it, and the reason goes to the audit log
// (framework_risk_assessments.py reopen). Register risks it already raised stay.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, X } from 'lucide-react';
import { ermApi } from '@/lib/api';
import { apiErrorText } from '@/lib/apiError';

export function FrameworkReopen({ assessmentId }: { assessmentId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const close = () => { setOpen(false); setReason(''); reopen.reset(); };
  const reopen = useMutation({
    mutationFn: () => ermApi.frameworkRiskAssessments.reopen(assessmentId, reason.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['framework-risk-assessment', assessmentId] }); close(); },
  });

  return (
    <>
      <button onClick={() => setOpen(true)} className="cw-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium">
        <RotateCcw size={14} /> Reopen with reason
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={close}>
          <div role="dialog" aria-modal="true" aria-labelledby="fw-reopen-title"
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <h4 id="fw-reopen-title" className="text-sm font-semibold text-slate-900">Reopen approved assessment</h4>
              <button onClick={close} aria-label="Close"><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <div className="space-y-2 px-4 py-3">
              <p className="text-xs text-slate-600">
                Its answers can change again and it needs approving afresh. Risks it already added to the register stay.
              </p>
              <label htmlFor="fw-reopen-reason" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Reason (required, kept in the audit log)
              </label>
              <textarea id="fw-reopen-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={2000}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs" placeholder="Why the approved answers need to change" />
              {reopen.error && (
                <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {apiErrorText(reopen.error, 'The assessment was not reopened.')}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
              <button onClick={close} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
              <button onClick={() => reopen.mutate()} disabled={!reason.trim() || reopen.isPending}
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
