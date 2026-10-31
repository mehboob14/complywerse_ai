'use client';

// Statements <-> the original document file (organisations with document sync only; the API says {enabled:false} otherwise).
// Backend: grc/modules/governance/doc_sync.py.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { proposedOf, sendLabel } from '@/lib/proposals';
import { ProposeNote, proposedWords, useProposalRole, useRefreshAfterProposal } from './_ProposalsView';

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
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const base = `/governance/documents/${documentId}/document-sync`;

  const { data, isError, error, refetch } = useQuery<SyncState>({
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

  const check = useReportedMutation({
    mutationFn: async () => (await apiClient.post(`${base}/check`, null, { params: { again: true } })).data,
    success: { title: 'Checked', message: 'Statements were compared with the document.' },
    failure: 'Check failed',
    fallback: 'Could not read the document.',
    onSuccess: () => { refresh(); },
  });

  // not the owner or author: writing the statements in goes to the owner to accept, with a message they read
  const { proposes, decider } = useProposalRole(Number(documentId));
  const refreshAfterProposal = useRefreshAfterProposal();
  const apply = useReportedMutation({
    mutationFn: async () => (await apiClient.post(`${base}/apply`, { change_reason: reason.trim() || null, message: reason.trim() || undefined })).data,
    success: (r: any) => proposedWords(r, decider)
      ?? { title: `Document updated to version ${r.version}`, message: `${r.updated} statement${r.updated === 1 ? '' : 's'} written into the document${r.sent_to_review ? '; it is back in review' : ''}.` },
    failure: 'Document not updated',
    fallback: 'Could not write the document.',
    retryable: false,                                                    // a second try could write a second version
    onSuccess: (r: any) => {
      setConfirming(false);
      setReason('');
      if (proposedOf(r)) { refreshAfterProposal(); return; }            // the document is as it was until the owner accepts
      refresh();
    },
  });

  if (isError && !data) {
    return <div className="mb-4"><ErrorState compact title="Couldn't read the document sync" message={errorMessage(error)} onRetry={() => { void refetch(); }} /></div>;
  }
  if (!data?.enabled) return null;
  const pending = data.pending || [];
  const missing = data.not_found || [];
  const c = data.counts;
  const needsReview = data.status === 'approved' || data.status === 'published' || data.status === 'exception_applied';

  return (
    <div className="mb-4 rounded-xl border border-[#d5dbe1] bg-[#fff] p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <FileCheck2 className="h-4 w-4 text-primary-600" aria-hidden />
        <span className="text-sm font-semibold text-[#1f2933]">Document sync</span>
        {c && (
          <span className="text-xs text-[#586472]" title="Checked against the document: as written, corrected to the document, not found in it">
            {c.checked}/{c.statements} checked · {c.exact} as written · {c.corrected} corrected · {c.not_found} not found
          </span>
        )}
        <Button size="sm" className="ml-auto" loading={check.isPending} title="Compare the statements with the document" onClick={() => check.mutate()}>Check</Button>
      </div>

      {missing.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-amber-900">
          Not found: {missing.map((m) => m.code || m.id).join(', ')}
          <InfoTip label="About statements not found" text="They stay as they are and cannot be written into the document." />
        </p>
      )}

      {pending.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-[13px] text-amber-900">
            {pending.length} {pending.length === 1 ? 'statement' : 'statements'} edited, not yet in the document: {pending.map((p) => p.code || p.id).join(', ')}
          </p>
          {data.reason && <p className="mt-1 text-xs text-amber-900">{data.reason}</p>}
          {!confirming && data.can_apply && (
            <Button variant="primary" className="mt-2" onClick={() => setConfirming(true)}>Update document</Button>
          )}
          {confirming && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-[#26323d]">
                Writes the edits into the document as the next version (now {data.version}).
                {data.creates_word_copy && ' The new version is a Word copy; the PDF stays as the earlier version.'}
                {needsReview && ' The document goes back to review.'}
              </p>
              {proposes ? (
                <ProposeNote id={`sync-why-${documentId}`} decider={decider} value={reason} onChange={setReason} placeholder="e.g. The statements on passwords follow the new standard" />
              ) : (
                <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" aria-label="Reason" />
              )}
              <div className="flex gap-2">
                <Button variant="primary" loading={apply.isPending} disabled={proposes && !reason.trim()} onClick={() => apply.mutate()}>
                  {proposes ? sendLabel(decider) : 'Write to document'}
                </Button>
                <Button onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
