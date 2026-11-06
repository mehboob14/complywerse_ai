'use client';

/**
 * Which frameworks a document's statements are mapped against, on its Mappings tab. By default: the applicable and linked frameworks it was created with
 * (uploaded or AI-drafted). Any others can be added here and the mapping run again; they stay with the document, so later runs and re-parses use them too.
 * Links a person confirmed survive a re-run.
 *
 * On the design-system kit. The frameworks it is mapped against are related records, so the first two show and "+N more" opens the rest (a document can be
 * mapped against thirty frameworks); the picker is the kit's searchable multi-select; Run mapping reports that it started (a failure is said here, once, in the
 * server's words, with the link to the Statements when that is what is missing). The request, its payload, the polling of the run and the refresh when it
 * finishes are as they were.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { Button, ErrorState, MultiSelect, Notice, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { InfoTip } from '@/components/ui/InfoTip';
import { moreCount } from '@/lib/format';
import { apiClient, governanceApi } from '@/lib/api';
import type { FrameworkScope } from '../_types';
import { scopeLine } from './scopeLine';

export type { FrameworkScope };
type ScopeEntry = { id: number; name: string };
type RunState = {
  status: string; message?: string; error?: string; statements?: number; statements_mapped?: number;
  control_links?: number; framework_scope_ids?: number[];
};
type Chip = { f: ScopeEntry; label: string; tone: 'applicable' | 'linked' | 'extra' };

const ACTIVE = new Set(['queued', 'running']);
const REFRESH = ['document-mappings', 'doc-coverage', 'gap-recommended-controls', 'document-policy-statements'];
const CHIP_TONE: Record<Chip['tone'], string> = {
  applicable: 'border-ds-border bg-ds-primary-soft text-ds-primary-text',
  linked: 'border-ds-border bg-ds-info-soft text-ds-info',
  extra: 'border-ds-border bg-ds-surface-hover text-ds-fg-body',
};

export function MappingScope({ documentId, scope, canRun }: {
  documentId: number; scope?: FrameworkScope; canRun: boolean;
}) {
  const queryClient = useQueryClient();
  const own = useMemo(() => [...(scope?.applicable || []), ...(scope?.linked || [])], [scope]);
  const savedExtra = useMemo(() => (scope?.extra || []).map((f) => f.id), [scope]);
  const [extra, setExtra] = useState<number[]>(savedExtra);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setExtra(savedExtra), [savedExtra.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // The frameworks that can be added: the tenant's parsed ones, one per name.
  const frameworks = useQuery<ScopeEntry[]>({
    queryKey: ['mapping-scope-frameworks'],
    queryFn: async () => {
      const data = (await apiClient.get('/framework-upload/upload')).data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = Array.isArray(data) ? data : data?.items || data?.frameworks || [];
      const byName = new Map<string, ScopeEntry>();
      items.filter((f) => f.is_active && ['parsed', 'published', 'classified', 'completed'].includes(f.upload_status))
        .sort((a, b) => a.id - b.id)
        .forEach((f) => byName.set(String(f.name || '').trim().toLowerCase(), { id: f.id, name: f.name }));
      return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: 300_000,
    enabled: canRun,            // only who picks them
  });
  const ownNames = new Set(own.map((f) => f.name.trim().toLowerCase()));
  const ownIds = new Set(own.map((f) => f.id));
  const options = (frameworks.data || []).filter((f) => !ownIds.has(f.id) && !ownNames.has(f.name.trim().toLowerCase()));

  const status = useQuery<RunState>({
    queryKey: ['document-mapping-run', documentId],
    queryFn: async () => (await governanceApi.getDocumentMappingRunStatus(documentId)).data,
    refetchInterval: (query) => (ACTIVE.has(query.state.data?.status || '') ? 3000 : false),
  });
  const running = ACTIVE.has(status.data?.status || '');

  // When a run finishes, the mappings, coverage and statements are new.
  const before = useRef<string | undefined>(undefined);
  useEffect(() => {
    const now = status.data?.status;
    if (before.current && ACTIVE.has(before.current) && now && !ACTIVE.has(now)) {
      REFRESH.forEach((k) => queryClient.invalidateQueries({ queryKey: [k, documentId] }));
    }
    before.current = now;
  }, [status.data?.status, documentId, queryClient]);

  const run = useReportedMutation({
    mutationFn: async () => (await governanceApi.runDocumentMapping(documentId, extra)).data as RunState,
    success: (data) => (ACTIVE.has(data.status) ? 'Mapping started' : data.status === 'skipped' ? { title: 'Mapping skipped', message: data.message } : 'Mapping finished'),
    failure: "Couldn't start the mapping",
    toast: 'success',                                    // a failure is said on the line below the button, once
    onSuccess: (data) => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['document-mappings', documentId] });
      if (ACTIVE.has(data.status)) queryClient.setQueryData(['document-mapping-run', documentId], data);
      else REFRESH.forEach((k) => queryClient.invalidateQueries({ queryKey: [k, documentId] }));
    },
    onError: (e) => setError(errorMessage(e, 'Could not start the mapping.')),
  });

  const dirty = [...extra].sort().join(',') !== [...savedExtra].sort().join(',');
  const count = ownIds.size + extra.filter((id) => !ownIds.has(id)).length;
  const last = status.data;
  const saved = own.length + (scope?.extra || []).length;
  const line = scopeLine({ running, error, saved, picked: extra.length, last });

  const applicable = scope?.applicable || [];
  const chips: Chip[] = [
    ...applicable.map((f): Chip => ({ f, label: 'Applicable', tone: 'applicable' })),
    ...(scope?.linked || []).filter((f) => !applicable.some((a) => a.id === f.id)).map((f): Chip => ({ f, label: 'Linked', tone: 'linked' })),
    ...(scope?.extra || []).map((f): Chip => ({ f, label: 'Added here', tone: 'extra' })),
  ];
  const { shown, more } = moreCount(chips, 2);
  const chip = (c: Chip) => (
    <span key={`${c.label}-${c.f.id}`} className={`inline-flex max-w-full items-center gap-[4px] rounded-full border px-[8px] py-[2px] text-ds-label ${CHIP_TONE[c.tone]}`}>
      <span className="truncate" title={c.f.name}>{c.f.name}</span>
      <span className="shrink-0 opacity-80">· {c.label}</span>
    </span>
  );

  return (
    <div className="flex flex-col gap-[10px] rounded-ds-card bg-ds-surface-subtle p-[12px]">
      <div className="flex flex-wrap items-center gap-[6px]">
        <span className="mr-[2px] inline-flex items-center gap-[4px] text-ds-label font-[600] text-ds-fg-muted">
          Mapped against{chips.length > 0 ? ` ${chips.length}` : ''}
          <InfoTip label="About the frameworks"
            text={canRun ? 'The applicable and linked frameworks the document was created with. Frameworks added here stay with this document. Links you confirmed are kept when it runs again.'
              : "Read only: the document's editors choose the frameworks and run the mapping."} />
        </span>
        {(showAll ? chips : shown).map(chip)}
        {more > 0 && (
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex h-[24px] items-center rounded-full px-[8px] text-ds-label font-[600] text-ds-primary-text hover:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring"
          >
            {showAll ? 'Show fewer' : `+${more} more`}
          </button>
        )}
        {!saved && <span className="text-ds-label text-ds-fg-muted">None yet</span>}
      </div>

      {canRun && (
        <div className="flex flex-wrap items-center gap-[8px]">
          <MultiSelect
            label="Also map against"
            options={options.map((f) => ({ value: String(f.id), label: f.name }))}
            value={extra.map(String)}
            onChange={(v) => { setError(''); setExtra(v.map(Number)); }}
            placeholder={frameworks.isLoading ? 'Loading…' : 'Also map against…'}
            searchPlaceholder="Search frameworks"
            searchable
            disabled={running || frameworks.isError}
            className="min-w-[260px] flex-1"
          />
          <Button variant="primary" leftIcon={<Play aria-hidden />} loading={running || run.isPending} disabled={count === 0} onClick={() => run.mutate()}>
            {running ? 'Mapping…' : dirty ? 'Save & run' : 'Run mapping'}
          </Button>
        </div>
      )}
      {canRun && frameworks.isError && (
        <ErrorState compact title="Couldn't load the frameworks to add" message={errorMessage(frameworks.error)} onRetry={canRetry(frameworks.error) ? () => { void frameworks.refetch(); } : undefined} />
      )}

      {/* one line at a time: what is happening, what went wrong, what is missing, then how the last run went */}
      {line === 'running' ? (
        <p role="status" className="text-ds-body text-ds-fg-body">
          {last?.message || 'Mapping the statements'} against {count} framework{count === 1 ? '' : 's'} · you can leave this page
        </p>
      ) : line === 'error' ? (
        <Notice tone="danger">
          {error}
          {/no statements/i.test(error) && (
            <> <Link href={`/governance/documents/${documentId}?tab=statements`} className="rounded-ds-control font-[600] text-ds-primary-text underline focus-visible:outline-none focus-visible:shadow-ds-ring">Open Statements</Link></>
          )}
        </Notice>
      ) : line === 'none' ? (
        <p className={`text-ds-body ${canRun ? 'text-ds-warning' : 'text-ds-fg-muted'}`}>
          {canRun ? 'Pick frameworks above, then run the mapping' : 'No frameworks to map against yet'}
        </p>
      ) : line === 'completed' && last ? (
        <p className="text-ds-body text-ds-success">
          Last run: {last.statements_mapped ?? last.statements}/{last.statements} statements mapped · {last.control_links ?? 0} control links
        </p>
      ) : line === 'failed' && last ? (
        <p className="text-ds-body text-ds-danger">Last run failed: {last.error || 'unknown error'}</p>
      ) : line === 'skipped' && last ? (
        <p className="text-ds-body text-ds-warning">{last.message}</p>
      ) : null}
    </div>
  );
}
