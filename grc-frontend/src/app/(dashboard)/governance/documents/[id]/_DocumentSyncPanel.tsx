'use client';

// Statements <-> the original document file (organisations with document sync only; the API says {enabled:false} otherwise).
// Backend: grc/modules/governance/doc_sync.py.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';

interface Pending { id: number; code: string | null; was: string; now: string }
interface SyncState {
  enabled: boolean;
  file_type?: string;
  version?: string;
  status?: string;
  can_apply?: boolean;
  reason?: string | null;
  creates_word_copy?: boolean;
  pending?: Pending[];
  not_found?: Array<{ id: number; code: string | null }>;
  counts?: { statements: number; checked: number; exact: number; corrected: number; not_found: number };
}

export default function DocumentSyncPanel({ documentId }: { documentId: string | number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const base = `/governance/documents/${documentId}/document-sync`;

  const { data } = useQuery<SyncState>({
    queryKey: ['document-sync', String(documentId)],
    queryFn: async () => (await apiClient.get(base)).data,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['document-sync'] });
    queryClient.invalidateQueries({ queryKey: ['document-policy-statements'] });
    queryClient.invalidateQueries({ queryKey: ['parse-status'] });     // a new version of the file: its statements follow it
    queryClient.invalidateQueries({ queryKey: ['governance-document'] });
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey.some((k) => typeof k === 'string' && k.includes('version')) });
    for (const key of ['document-chain', 'document-chain-redline']) queryClient.invalidateQueries({ queryKey: [key] });   // the Change log
  };

  const check = useMutation({
    mutationFn: async () => (await apiClient.post(`${base}/check`, null, { params: { again: true } })).data,
    onSuccess: () => { refresh(); toast({ type: 'success', title: 'Checked', message: 'Statements were compared with the document.' }); },
    onError: (e: any) => toast({ type: 'error', title: 'Check failed', message: e?.response?.data?.detail || 'Could not read the document.' }),
  });

  const apply = useMutation({
    mutationFn: async () => (await apiClient.post(`${base}/apply`, { change_reason: reason.trim() || null })).data,
    onSuccess: (r: any) => {
      setConfirming(false);
      setReason('');
      refresh();
      toast({ type: 'success', title: `Document updated to version ${r.version}`,
              message: `${r.updated} statement${r.updated === 1 ? '' : 's'} written into the document${r.sent_to_review ? '; it is back in review' : ''}.` });
    },
    onError: (e: any) => toast({ type: 'error', title: 'Document not updated', message: e?.response?.data?.detail || 'Could not write the document.' }),
  });

  if (!data?.enabled) return null;
  const pending = data.pending || [];
  const missing = data.not_found || [];
  const c = data.counts;
  const needsReview = data.status === 'approved' || data.status === 'published' || data.status === 'exception_applied';

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <FileCheck2 className="h-4 w-4 text-primary-600" />
        <span className="font-medium text-slate-800">Statements and the document</span>
        {c && (
          <span className="text-xs text-slate-600">
            {c.checked}/{c.statements} checked · {c.exact} as written · {c.corrected} corrected to the document · {c.not_found} not found
          </span>
        )}
        <button type="button" onClick={() => check.mutate()} disabled={check.isPending}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {check.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Check against document
        </button>
      </div>

      {missing.length > 0 && (
        <p className="mt-2 text-xs text-amber-900">
          Not found in the document: {missing.map((m) => m.code || m.id).join(', ')}. They stay as they are and cannot be written into the document.
        </p>
      )}

      {pending.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-amber-900">
            {pending.length} statement{pending.length === 1 ? ' has' : 's have'} been edited and {pending.length === 1 ? 'is' : 'are'} not in the document yet:
            {' '}{pending.map((p) => p.code || p.id).join(', ')}.
          </p>
          {data.reason && <p className="mt-1 text-xs text-amber-900">{data.reason}</p>}
          {!confirming && data.can_apply && (
            <button type="button" onClick={() => setConfirming(true)}
              className="mt-2 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
              Update document
            </button>
          )}
          {confirming && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-slate-700">
                This writes the edits into the document and creates the next version (now {data.version}).
                {data.creates_word_copy && ' The file is a PDF, so the new version is a Word copy; the PDF stays as the earlier version.'}
                {needsReview && ' The document goes back to review.'}
              </p>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why were the statements changed? (optional)"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-primary-500 focus:outline-none" />
              <div className="flex gap-2">
                <button type="button" onClick={() => apply.mutate()} disabled={apply.isPending}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                  {apply.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Write to document
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
