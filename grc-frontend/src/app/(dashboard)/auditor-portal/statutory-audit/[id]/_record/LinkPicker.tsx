'use client';

// Link an observation to a record that is already in the platform: a control, a risk, an issue, a governance document or a file in the evidence library. One sheet for all five: a search,
// the matches (a record already linked is marked, never offered twice), one press links it. The server returns the first 50 matches of a search, and the sheet says so, so nobody takes
// the list for everything there is.
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, DebouncedSearch, ErrorState, Notice, Sheet, SkeletonRows, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { statutoryAuditApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { REFRESH, retryRead } from '../../_register/observationData';

export type LinkKind = 'controls' | 'risks' | 'issues' | 'documents' | 'evidence';
interface Option { id: number; label: string; subtitle?: string | null }
const SERVER_LIMIT = 50;

const WORDS: Record<LinkKind, { title: string; help: string; search: string; one: string }> = {
  controls: { title: 'Link a control', help: 'Choose a control this observation relates to.', search: 'Search controls by name or code', one: 'control' },
  risks: { title: 'Link a risk', help: 'Choose a risk this observation relates to.', search: 'Search risks by title', one: 'risk' },
  issues: { title: 'Link an issue', help: 'Choose an issue to follow alongside this observation.', search: 'Search issues by title or code', one: 'issue' },
  documents: { title: 'Link a document', help: 'Choose a policy or procedure that addresses this observation.', search: 'Search documents by title', one: 'document' },
  evidence: { title: 'Link evidence', help: 'Choose a file already in the evidence library.', search: 'Search evidence by name or file name', one: 'file' },
};

const link = (kind: LinkKind, obsId: number, id: number) => {
  switch (kind) {
    case 'controls': return statutoryAuditApi.linkControl(obsId, { internal_control_id: id });
    case 'risks': return statutoryAuditApi.linkRisk(obsId, { risk_id: id });
    case 'issues': return statutoryAuditApi.linkIssue(obsId, { issue_id: id });
    case 'documents': return statutoryAuditApi.linkDocument(obsId, { document_id: id });
    default: return statutoryAuditApi.linkEvidence(obsId, { evidence_id: id });
  }
};

export function LinkPicker({ kind, obsId, linked, onClose }: { kind: LinkKind; obsId: number; /** the ids of the records of this kind already linked */ linked: ReadonlySet<number>; onClose: () => void }) {
  const [q, setQ] = useState('');
  const words = WORDS[kind];
  const found = useQuery({
    queryKey: ['statutory-link-opts', kind, q],
    queryFn: async () => (await statutoryAuditApi.linkOptions(kind, q || undefined)).data as Option[],
    placeholderData: keepPreviousData,
    retry: retryRead,
    retryDelay: 800,
  });
  const add = useReportedMutation({
    mutationFn: async (o: Option) => (await link(kind, obsId, o.id)).data,
    success: (_d, o) => `Linked “${truncate(o.label, 60).text}”`,
    failure: `Couldn't link the ${words.one}`,
    toast: 'success',                                        // a failure is said in the sheet, beside what was pressed
    retryable: false,
    invalidate: REFRESH,
    onSuccess: onClose,
  });
  const options = found.data ?? [];

  return (
    <Sheet open onClose={onClose} width="md" title={words.title} subtitle={words.help} footer={<div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>}>
      <div className="flex flex-col gap-[12px]">
        <DebouncedSearch label={words.search} placeholder={words.search} value={q} onSearch={setQ} loading={found.isFetching} />
        {add.isError && <Notice tone="danger" title={`The ${words.one} wasn't linked`}>{errorMessage(add.error)}</Notice>}
        {found.isError && !found.data ? <ErrorState compact title="Couldn't load the list" message={errorMessage(found.error)} onRetry={() => { void found.refetch(); }} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
          : found.isLoading ? <SkeletonRows rows={6} columns={1} label="Loading the list" />
          : options.length === 0 ? <p role="status" className="rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[24px] text-center text-ds-body text-ds-fg-muted">{q ? 'Nothing matches that search.' : 'There is nothing to link yet.'}</p>
          : (
            <>
              <ul aria-label="Matches" className="m-0 flex max-h-[60vh] list-none flex-col overflow-y-auto rounded-ds-card border border-ds-border p-0">
                {options.map((o) => {
                  const already = linked.has(o.id);
                  return (
                    <li key={o.id} className="border-b border-ds-border last:border-b-0">
                      <button
                        type="button"
                        disabled={already || add.isPending}
                        onClick={() => add.mutate(o)}
                        className="flex min-h-ds-control w-full flex-col items-start gap-[2px] px-[12px] py-[8px] text-left enabled:hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{o.label}</span>
                        {(o.subtitle || already) && <span className="text-ds-label text-ds-fg-muted">{already ? 'Already linked' : o.subtitle}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {options.length >= SERVER_LIMIT && <p className="text-ds-label text-ds-fg-muted">Showing the first {SERVER_LIMIT} matches. Search to narrow the list.</p>}
            </>
          )}
      </div>
    </Sheet>
  );
}
