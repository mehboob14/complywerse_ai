'use client';

// The drawer's Sampling tab: the evidence sampled to test the control. A file can be uploaded (it is saved to the Evidence Library) or linked from the library; each sample is approved or rejected by a
// reviewer, and shows its state as a word.
import { useState } from 'react';
import { Check, ClipboardCheck, Plus, Search, Upload, X } from 'lucide-react';
import { Button, DebouncedSearch, ErrorState, SkeletonRows, StatusPill, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { statusPill } from '@/lib/status';
import { evidenceFile } from '@/lib/statuses/controls';
import { WB, type RefreshKeys } from './catalogData';
import type { ControlDetail } from './catalogModel';
import { FilePick } from './FilePick';

interface LibraryFile { id: number; name: string; file_name?: string; evidence_type?: string; status?: string }

function LibraryPicker({ linkedIds, onLink, linking }: { linkedIds: Set<number>; onLink: (id: number) => void; linking: number | null }) {
  const [q, setQ] = useState('');
  const lib = useQuery({
    queryKey: ['wb-evidence-lib', q],
    queryFn: async () => (await apiClient.get(`${WB}/evidence-library?limit=30${q ? `&q=${encodeURIComponent(q)}` : ''}`)).data as { items: LibraryFile[] },
  });
  const items = (lib.data?.items ?? []).filter((e) => !linkedIds.has(e.id));
  return (
    <div className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
      <DebouncedSearch label="Search the evidence library" placeholder="Search the evidence library" value={q} onSearch={setQ} loading={lib.isFetching && !lib.isPending} />
      {lib.isError && !lib.data ? (
        <ErrorState compact title="Couldn’t search the library" message={errorMessage(lib.error)} onRetry={canRetry(lib.error) ? () => { void lib.refetch(); } : undefined} />
      ) : lib.isPending ? (
        <SkeletonRows rows={3} columns={2} label="Searching the library" />
      ) : items.length === 0 ? (
        <p className="m-0 p-[8px] text-center text-ds-body text-ds-fg-muted">Nothing to link.</p>
      ) : (
        <ul className="m-0 max-h-[240px] list-none divide-y divide-ds-border overflow-y-auto rounded-ds-card border border-ds-border bg-ds-surface p-0">
          {items.map((e) => (
            <li key={e.id} className="flex items-center gap-[8px] p-[8px]">
              <ClipboardCheck aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ds-body font-[600] text-ds-fg" title={e.name}>{e.name}</span>
                <span className="text-ds-label text-ds-fg-muted">{[e.evidence_type || 'evidence', e.status].filter(Boolean).join(' · ')}</span>
              </span>
              <Button size="sm" leftIcon={<Plus aria-hidden />} loading={linking === e.id} onClick={() => onLink(e.id)}>Link</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SamplingTab({ d, keys }: { d: ControlDetail; keys: RefreshKeys }) {
  const [linking, setLinking] = useState(false);
  const upload = useReportedMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); return apiClient.post(`${WB}/items/${d.work_item_id}/evidence`, fd); },
    success: { title: 'Sample uploaded', message: 'It is saved to the Evidence Library and waits for a review here.' },
    failure: "Couldn't upload the sample",
    invalidate: keys,
  });
  const link = useReportedMutation({
    mutationFn: (evidenceId: number) => { const fd = new FormData(); fd.append('evidence_id', String(evidenceId)); return apiClient.post(`${WB}/items/${d.work_item_id}/evidence`, fd); },
    success: { title: 'Sample linked', message: 'It waits for a review here.' },
    failure: "Couldn't link the sample",
    invalidate: keys,
    onSuccess: () => setLinking(false),
  });
  const review = useReportedMutation({
    mutationFn: (v: { id: number; action: 'approved' | 'rejected' }) => apiClient.post(`${WB}/evidence/${v.id}/review`, { action: v.action }),
    success: (_, v) => (v.action === 'approved' ? 'Sample approved' : 'Sample rejected'),
    failure: "Couldn't record the review",
    invalidate: keys,
  });
  const linkedIds = new Set(d.evidence.map((e) => e.evidence_id).filter((x): x is number => x != null));
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <FilePick primary icon={<Upload aria-hidden className="h-[16px] w-[16px]" />} busy={upload.isPending} onPick={(f) => upload.mutate(f)}>Upload sample</FilePick>
        <Button leftIcon={<Search aria-hidden />} aria-expanded={linking} onClick={() => setLinking((v) => !v)}>Link from library</Button>
      </div>
      <p className="m-0 text-ds-label text-ds-fg-muted">The evidence sampled to test this control. An upload is saved to the Evidence Library and read there as well.</p>
      {linking && <LibraryPicker linkedIds={linkedIds} onLink={(id) => link.mutate(id)} linking={link.isPending ? (link.variables ?? null) : null} />}
      {d.evidence.length === 0 ? (
        <p className="m-0 rounded-ds-card border border-dashed border-ds-border p-[12px] text-ds-body text-ds-fg-muted">No samples attached yet.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-ds-border overflow-clip rounded-ds-card border border-ds-border bg-ds-surface p-0">
          {d.evidence.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-[8px] gap-y-[6px] p-[12px]">
              <ClipboardCheck aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
              <span className="min-w-[120px] flex-1">
                <span className="block truncate text-ds-body text-ds-fg" title={e.file_name || undefined}>{e.file_name || 'Sample'}</span>
                <span className="text-ds-label text-ds-fg-muted">{[e.test_procedure_id ? 'for a test step' : '', e.evidence_id ? 'in the library' : ''].filter(Boolean).join(' · ')}</span>
              </span>
              <StatusPill size="sm" {...statusPill(evidenceFile, e.review_status)} />
              {e.review_status === 'pending' && (
                <span className="flex gap-[6px]">
                  <Button size="sm" leftIcon={<Check aria-hidden />} loading={review.isPending && review.variables?.id === e.id && review.variables.action === 'approved'} onClick={() => review.mutate({ id: e.id, action: 'approved' })}>Approve</Button>
                  <Button size="sm" leftIcon={<X aria-hidden />} loading={review.isPending && review.variables?.id === e.id && review.variables.action === 'rejected'} onClick={() => review.mutate({ id: e.id, action: 'rejected' })}>Reject</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
