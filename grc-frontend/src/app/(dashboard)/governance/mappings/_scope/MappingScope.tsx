'use client';

/**
 * Which frameworks a document's statements are mapped against, on its Mappings
 * tab. By default: the applicable and linked frameworks it was created with
 * (uploaded or AI-drafted). Any others can be added here and the mapping run
 * again; they stay with the document, so later runs and re-parses use them too.
 * Links a person confirmed survive a re-run.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play } from 'lucide-react';
import { MultiSelectDropdown } from '@/components/ui';
import { apiClient, governanceApi } from '@/lib/api';

type ScopeEntry = { id: number; name: string };
export type FrameworkScope = { applicable: ScopeEntry[]; linked: ScopeEntry[]; extra: ScopeEntry[] };
type RunState = {
  status: string; message?: string; error?: string; statements?: number; statements_mapped?: number;
  control_links?: number; framework_scope_ids?: number[];
};

const ACTIVE = new Set(['queued', 'running']);
const REFRESH = ['document-mappings', 'doc-coverage', 'gap-recommended-controls', 'document-policy-statements'];

export function MappingScope({ documentId, scope, canRun }: {
  documentId: number; scope?: FrameworkScope; canRun: boolean;
}) {
  const queryClient = useQueryClient();
  const own = useMemo(() => [...(scope?.applicable || []), ...(scope?.linked || [])], [scope]);
  const savedExtra = useMemo(() => (scope?.extra || []).map((f) => f.id), [scope]);
  const [extra, setExtra] = useState<number[]>(savedExtra);
  const [error, setError] = useState('');
  useEffect(() => setExtra(savedExtra), [savedExtra.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // The frameworks that can be added: the tenant's parsed ones, one per name.
  const frameworks = useQuery<ScopeEntry[]>({
    queryKey: ['mapping-scope-frameworks'],
    queryFn: async () => {
      const data = (await apiClient.get('/framework-upload/upload')).data;
      const items: any[] = Array.isArray(data) ? data : data?.items || data?.frameworks || [];
      const byName = new Map<string, ScopeEntry>();
      items.filter((f) => f.is_active && ['parsed', 'published', 'classified', 'completed'].includes(f.upload_status))
        .sort((a, b) => a.id - b.id)
        .forEach((f) => byName.set(String(f.name || '').trim().toLowerCase(), { id: f.id, name: f.name }));
      return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: 300_000,
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

  const run = useMutation({
    mutationFn: async () => (await governanceApi.runDocumentMapping(documentId, extra)).data as RunState,
    onSuccess: (data) => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['document-mappings', documentId] });
      if (ACTIVE.has(data.status)) queryClient.setQueryData(['document-mapping-run', documentId], data);
      else REFRESH.forEach((k) => queryClient.invalidateQueries({ queryKey: [k, documentId] }));
    },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not start the mapping.'),
  });

  const dirty = [...extra].sort().join(',') !== [...savedExtra].sort().join(',');
  const count = own.length + extra.filter((id) => !ownIds.has(id)).length;
  const chip = (f: ScopeEntry, label: string, tone: string) => (
    <span key={`${label}-${f.id}`} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 ${tone}`}>
      {f.name}<span className="text-[10px] opacity-70">· {label}</span>
    </span>
  );
  const last = status.data;

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Mapped against</span>
        {(scope?.applicable || []).map((f) => chip(f, 'Applicable', 'bg-primary-50 text-primary-800 ring-primary-200'))}
        {(scope?.linked || []).filter((f) => !(scope?.applicable || []).some((a) => a.id === f.id))
          .map((f) => chip(f, 'Linked', 'bg-sky-50 text-sky-800 ring-sky-200'))}
        {(scope?.extra || []).map((f) => chip(f, 'Added here', 'bg-violet-50 text-violet-800 ring-violet-200'))}
        {!own.length && !(scope?.extra || []).length && (
          <span className="text-xs text-amber-700">No frameworks yet. Pick them below.</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[260px] flex-1">
          <MultiSelectDropdown
            title="Also map against"
            items={options.map((f) => ({ value: String(f.id), label: f.name }))}
            selectedValues={extra.map(String)}
            onApply={(v) => { setError(''); setExtra(v.map(Number)); }}
            multiSelect
            triggerVariant="input"
            placeholder={frameworks.isLoading ? 'Loading frameworks…' : 'Also map against other frameworks…'}
            searchPlaceholder="Search frameworks…"
            forceSearch
            showAvatars={false}
            disabled={!canRun || running}
            size="sm"
            className="w-full"
            triggerClassName="w-full"
          />
        </div>
        {canRun && (
          <button onClick={() => run.mutate()} disabled={running || run.isPending || count === 0}
                  className="btn-primary btn-sm shrink-0">
            {running || run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? 'Mapping…' : dirty ? 'Save & run mapping' : 'Run mapping'}
          </button>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {running ? (
        <p className="text-xs text-slate-600">
          {last?.message || 'Mapping the statements'} against {count} framework{count === 1 ? '' : 's'}. This can take
          a few minutes; you can leave this page.
        </p>
      ) : last?.status === 'completed' && last.statements != null ? (
        <p className="text-xs text-emerald-700">
          Last run: {last.statements_mapped ?? last.statements} of {last.statements} statement(s) mapped,
          {' '}{last.control_links ?? 0} control link(s).
        </p>
      ) : last?.status === 'failed' ? (
        <p className="text-xs text-red-700">The last run failed: {last.error || 'unknown error'}.</p>
      ) : last?.status === 'skipped' && last.message ? (
        <p className="text-xs text-amber-700">{last.message}</p>
      ) : null}
      <p className="text-[11px] text-slate-400">
        A document is mapped against the applicable and linked frameworks it was created with. Frameworks added here
        stay with this document. Links you confirmed are kept when it runs again.
      </p>
    </div>
  );
}
