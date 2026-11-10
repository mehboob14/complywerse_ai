'use client';

/**
 * Reports: the library of saved reports as the facet explorer (components/records). This file is the CONFIGURATION: it owns the data (one request for every report the person can see, plus what this
 * browser keeps), the state of the page (filters, order live in the ADDRESS, so a link opens the same view), the actions of a row (open, download a file, edit details, share, copy, delete, send
 * again) and what each part draws. What a filter MEANS is libraryModel.ts; where a report lives (on the server, only on this device, refused by the server) is syncModel.ts and is said on the row
 * and above the list, never hidden. The builder is /reports/builder; every old address of this page forwards there.
 */
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileBarChart, Plus, RotateCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, Menu, Notice, Pager, SkeletonRows, useAddressState, useConfirm, useNotify, useReportedMutation, type FilterChip, type MenuItem } from '@/components/ui/ds';
import { AppliedFilters } from '@/components/records/AppliedFilters';
import { RecordExplorer } from '@/components/records/RecordExplorer';
import { RecordTable, type RecordItem } from '@/components/records/RecordTable';
import { countOf, evaluate } from '@/components/records/facetEngine';
import type { FacetGroupView } from '@/components/records/FacetRail';
import { formatCount, truncate } from '@/lib/format';
import { datasetByKey, DATASETS } from '../_reports/datasets';
import { dropLocalSpec, dropSpec, listSpecsFull, newSpecId, putSpec, retrySpec } from '../_reports/savedReports';
import type { ReportSpec } from '../_reports/types';
import { usePermissions } from '../_reports/usePermissions';
import { DetailsSheet, type Details } from './DetailsSheet';
import { REPORTS_KEY } from './keys';
import { NewReportSheet } from './NewReportSheet';
import { RowMenu, libraryColumns, ReportCard, type RowEnv } from './ReportRows';
import { downloadWords, type FileFormat } from './fileModel';
import { makeFile } from './download';
import { LIBRARY_SCHEMA, builderHref, filtersOf, filtersPatch, legacyTarget, newReportHref, type LibraryAddress } from './libraryAddress';
import {
  FACET_TITLE, NO_FILTERS, OPEN_AT_FIRST, QUICK_IDS, QUICK_LABEL, RAIL_ORDER, SEARCHABLE, SORT_KEYS, SORT_LABEL, chosenOf, filterChips, filterCount, indexLibrary, inQuick, nextSort,
  orderedOptions, railOptions, removeChip, ruleOf, sortRows, toRows, type DatasetFacts, type FacetKey, type Filters, type LibraryRow, type QuickId, type Sort, type SortKey,
} from './libraryModel';
import { classifySync, deviceLine, failureWords } from './syncModel';

const PAGE_SIZES = [25, 50, 100] as const;
const NOUN = { one: 'report', other: 'reports' };
export const TITLE = 'Reports';
const INFO = 'The reports you saved and the ones shared with you. Open one to change it, or download its file from the row menu.';

const day = () => new Date().toISOString().slice(0, 10);

export function ReportsLibrary() {
  const router = useRouter();
  const uid = useId();
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const notify = useNotify();
  const searchRef = useRef<HTMLInputElement>(null);
  const search = useSearchParams()?.toString() ?? '';

  // an old address of this page (it used to host the builder) forwards to the builder, with what it carried
  const forward = legacyTarget(search);
  useEffect(() => { if (forward) router.replace(forward); }, [forward, router]);

  const [address, setAddress] = useAddressState(LIBRARY_SCHEMA);
  const filters = useMemo(() => filtersOf(address as LibraryAddress), [address]);
  const sort: Sort = (address as LibraryAddress).sort;
  const setFilters = useCallback((next: Filters) => setAddress(filtersPatch(next)), [setAddress]);
  const setSort = useCallback((next: Sort) => setAddress({ sort: next }), [setAddress]);

  // ── the data ──
  const { loaded: permsLoaded, canUse } = usePermissions();
  const datasets = useMemo(() => DATASETS.filter((d) => canUse(d)), [permsLoaded]);       // eslint-disable-line react-hooks/exhaustive-deps
  const list = useQuery({ queryKey: REPORTS_KEY, queryFn: listSpecsFull, staleTime: 30_000 });
  const data = list.data;
  const failure = data?.failure;
  const noList = !!failure && (data?.specs.length ?? 0) === 0;                 // the list could not be read at all: never drawn as an empty library
  const loading = list.isPending || !permsLoaded;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [data]);

  const rows = useMemo(() => {
    if (!data || !permsLoaded) return [];
    const onServer = new Set(data.onServer);
    const factsOf = (key: string): DatasetFacts | undefined => {
      const d = datasetByKey(key);
      return d ? { label: d.label, module: d.module, openable: datasets.some((x) => x.key === key) } : undefined;
    };
    return toRows(data.specs, factsOf, (id) => (onServer.has(id) ? 'synced' : id in data.refused ? 'refused' : 'device'));
  }, [data, permsLoaded, datasets]);
  const specOf = useCallback((row: LibraryRow): ReportSpec | undefined => data?.specs[row.id - 1], [data]);

  // ── the facets: one index, one pass for the matches and every live count ──
  const index = useMemo(() => indexLibrary(rows, now), [rows, now]);
  const searched = useDeferredValue(filters.search);
  const applied = useMemo(() => (searched === filters.search ? filters : { ...filters, search: searched }), [filters, searched]);
  const result = useMemo(() => evaluate(index, chosenOf(applied), ruleOf(applied)), [index, applied]);
  const filtered = result.matches;
  const filtering = filterCount(filters) > 0;
  const options = useMemo(() => railOptions(rows), [rows]);
  const chosen = chosenOf(filters);
  const groups: FacetGroupView[] = RAIL_ORDER.map((facet: FacetKey) => {
    const picked = chosen[facet] ?? [];
    const opts = orderedOptions(options[facet], picked, (v) => countOf(result.counts, facet, v));
    return {
      key: facet, label: FACET_TITLE[facet], chosen: picked.length, searchable: SEARCHABLE.includes(facet), limit: facet === 'module' ? 7 : undefined, defaultOpen: OPEN_AT_FIRST.includes(facet),
      options: opts.map((o) => ({ value: o.value, label: o.label, count: countOf(result.counts, facet, o.value), checked: picked.includes(o.value) })),
    };
  });
  const toggleFacet = (facet: string, value: string) => {
    const key = facet as FacetKey;
    const cur = filters[key];
    setFilters({ ...filters, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] } as Filters);
  };

  // ── the quick views, with the number each would show ──
  const quickCounts = useMemo(() => {
    const out: Record<string, number> = {};
    QUICK_IDS.forEach((id) => { out[id] = rows.reduce((n, r) => n + (inQuick(id, r) ? 1 : 0), 0); });
    return out;
  }, [rows]);
  const activeQuick = filters.quick ?? 'all';
  const quick: FilterChip[] = QUICK_IDS.filter((id) => id !== 'attention' || (quickCounts.attention ?? 0) > 0 || activeQuick === 'attention').map((id) => ({
    key: id, label: QUICK_LABEL[id], active: activeQuick === id, count: quickCounts[id] ?? 0,
  }));
  const onQuick = (id: string) => setFilters({ ...filters, quick: id === 'all' || activeQuick === id ? null : (id as QuickId) });

  // ── the list: sorted, a page of it ──
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const viewKey = `${filtered.length}|${sort.key}:${sort.dir}|${pageSize}|${filtered.length ? filtered[0].id : 0}`;
  const [seen, setSeen] = useState(viewKey);
  if (seen !== viewKey) { setSeen(viewKey); setPageNo(1); }
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageClamped = Math.min(Math.max(1, pageNo), pages);
  const pageRows = useMemo(() => sorted.slice((pageClamped - 1) * pageSize, pageClamped * pageSize), [sorted, pageClamped, pageSize]);
  const items: RecordItem<LibraryRow>[] = useMemo(() => pageRows.map((record) => ({ kind: 'row' as const, id: record.id, record, depth: 0 })), [pageRows]);

  // ── what the row actions do ──
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<LibraryRow | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: REPORTS_KEY }); };

  const save = useReportedMutation({
    mutationFn: (spec: ReportSpec) => putSpec({ ...spec, updatedAt: new Date().toISOString() }),
    success: (_, spec) => `“${truncate(spec.name, 60).text}” saved`,
    failure: "Couldn't save the report",
    fallback: 'The report was not changed.',
    toast: 'success',
    invalidate: [REPORTS_KEY.slice()],
    onSuccess: () => { setEditing(null); setEditError(null); },
    onError: (e) => setEditError(failureWords(classifySync(e), 'save the report')),
  });
  const share = useReportedMutation({
    mutationFn: (spec: ReportSpec) => putSpec({ ...spec, shared: !spec.shared, updatedAt: new Date().toISOString() }),
    success: (_, spec) => (spec.shared ? `“${truncate(spec.name, 60).text}” is now only yours` : `“${truncate(spec.name, 60).text}” is shared with everyone in the organisation`),
    failure: "Couldn't change who can open the report",
    invalidate: [REPORTS_KEY.slice()],
  });
  const copy = useReportedMutation({
    mutationFn: (spec: ReportSpec) => putSpec({ ...spec, id: newSpecId(), name: `${spec.name || 'Untitled report'} (copy)`, shared: false, mine: true, updatedAt: new Date().toISOString() }),
    success: (_, spec) => `A copy of “${truncate(spec.name, 60).text}” is saved, only for you`,
    failure: "Couldn't make a copy",
    retryable: false,
    invalidate: [REPORTS_KEY.slice()],
  });
  const remove = useReportedMutation({
    mutationFn: (row: LibraryRow) => dropSpec(row.slug),
    success: (_, row) => `“${truncate(row.name, 60).text}” deleted`,
    failure: "Couldn't delete the report",
    invalidate: [REPORTS_KEY.slice()],
  });
  const resend = useReportedMutation({
    mutationFn: async (slugs: string[]) => {
      let failed = 0;
      for (const slug of slugs) { try { await retrySpec(slug); } catch { failed += 1; } }
      if (failed > 0) throw new Error(`${failed} of ${slugs.length} could not be saved yet.`);
    },
    success: (_, slugs) => (slugs.length === 1 ? 'The report is saved' : `${slugs.length} reports are saved`),
    failure: "Couldn't save to the server",
    invalidate: [REPORTS_KEY.slice()],
  });
  const download = useReportedMutation({
    mutationFn: async ({ row, format }: { row: LibraryRow; format: FileFormat }) => {
      const spec = specOf(row);
      if (!spec) throw new Error('This report is not in the list any more. Reload the page.');
      return { format, file: await makeFile(spec, format, day()) };
    },
    failure: "Couldn't prepare the file",
    toast: 'errors',
  });

  const askDelete = async (row: LibraryRow) => {
    const yes = await confirm({
      title: `Delete “${truncate(row.name, 80).text}”?`,
      message: `${row.visibility === 'shared' ? 'It is shared, so nobody in the organisation will be able to open it any more. ' : ''}Dashboards that show it will say it is no longer available. This cannot be undone.`,
      confirmLabel: 'Delete report',
      tone: 'danger',
    });
    if (yes) remove.mutate(row);
  };
  const askForget = async (row: LibraryRow) => {
    const yes = await confirm({
      title: `Remove “${truncate(row.name, 80).text}” from this device?`,
      message: 'The server does not have this report, so it will be gone for good. This cannot be undone.',
      confirmLabel: 'Remove report',
      tone: 'danger',
    });
    if (yes) { dropLocalSpec(row.slug); refresh(); }
  };

  const env: RowEnv = {
    onOpen: (r) => router.push(builderHref(r.slug)),
    onDownload: (r, format) => download.mutate({ row: r, format }, {
      // the words depend on the file (how many rows, whether they are all of the register), so the mutation says nothing by itself and this does once the file exists
      onSuccess: ({ file }) => {
        const words = downloadWords(file.name, format, file.rows, file.coverage);
        if (words.partial) notify.warning(words.message, { title: words.title, duration: 10000 });
        else notify.success(words.message, { title: words.title });
      },
    }),
    onEdit: (r) => { setEditError(null); setEditing(r); },
    onShare: (r) => { const s = specOf(r); if (s) share.mutate(s); },
    onDuplicate: (r) => { const s = specOf(r); if (s) copy.mutate(s); },
    onDelete: (r) => { void askDelete(r); },
    onResend: (r) => resend.mutate([r.slug]),
    onForget: (r) => { void askForget(r); },
  };
  const columns = useMemo(() => libraryColumns(env), [data]);                                  // eslint-disable-line react-hooks/exhaustive-deps

  // ── what the page says ──
  const chips = filterChips(filters, options);
  const sortItems: MenuItem[] = SORT_KEYS.map((k, i) => ({
    key: `sort:${k}`, label: SORT_LABEL[k], checked: sort.key === k, radio: true, section: i === 0 ? 'Sort by' : undefined,
    trailing: sort.key === k ? (sort.dir === 'asc' ? '↑ ascending' : '↓ descending') : undefined, onSelect: () => setSort(nextSort(sort, k as SortKey)),
  }));
  const waiting = rows.filter((r) => r.mine && r.sync !== 'synced');
  const sayWaiting = deviceLine({ device: waiting.filter((r) => r.sync === 'device').length, refused: waiting.filter((r) => r.sync === 'refused').length }, NOUN);

  const head = (
    <PageHeader
      variant="page"
      title={TITLE}
      info={INFO}
      actions={<Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setNewOpen(true)} disabled={!permsLoaded}>New report</Button>}
    />
  );

  const body = (() => {
    if (noList) {
      const f = failure!;
      return f.kind === 'denied'
        ? <EmptyState kind="firstUse" icon={FileBarChart} title="You can't open saved reports" description="Your role does not include saved reports. You can still start a new one." />
        : <ErrorState title="Couldn't load the reports" message={f.kind === 'unreachable' ? 'The server could not be reached. Check your connection and try again.' : 'The server did not accept the request.'} onRetry={f.kind === 'unreachable' ? refresh : undefined} />;
    }
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={8} columns={4} label="Loading the reports" /></div>;
    if (rows.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState
            kind="firstUse" bare icon={FileBarChart} title="No reports yet"
            description="Pick a module, choose the columns and filters, and save the report. It will be listed here."
            action={<Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setNewOpen(true)}>Create your first report</Button>}
          />
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="noMatches" bare title="No report matches" description="Loosen a filter, or search for other words." onClearFilters={filtering ? () => setFilters(NO_FILTERS) : undefined} />
        </div>
      );
    }
    return (
      <>
        <RecordTable
          caption="Saved reports"
          columns={columns}
          items={items}
          sort={{ key: sort.key, dir: sort.dir }}
          onSort={(key) => setSort(nextSort(sort, key as SortKey))}
          onActivate={(r) => router.push(builderHref(r.slug))}
          actions={(r) => <RowMenu row={r} env={env} />}
          card={(row) => <ReportCard row={row} />}
        />
        <Pager className="mt-[8px]" page={pageClamped} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={NOUN} />
      </>
    );
  })();

  if (forward) return <div aria-busy="true" role="status" className="px-[4px] py-[12px] text-ds-body text-ds-fg-muted">Opening the report builder…</div>;

  const editSpec = editing ? specOf(editing) : undefined;
  const editInitial: Details = { name: editing?.name ?? '', description: editing?.description ?? '', shared: editing?.visibility === 'shared' };
  return (
    <>
      <RecordExplorer
        label={TITLE}
        noun={NOUN}
        head={head}
        notices={(
          <>
            {failure && !noList && (
              <Notice tone="warning" title="Couldn't reach the server" action={<Button leftIcon={<RotateCw aria-hidden />} onClick={refresh}>Retry</Button>}>
                {failure.kind === 'unreachable' ? `Showing the ${formatCount(rows.length)} ${rows.length === 1 ? 'report' : 'reports'} kept on this device. Reports saved by other people are not listed until the server answers.` : failureWords(failure, 'read the saved reports')}
              </Notice>
            )}
            {sayWaiting && !failure && (
              <Notice
                tone="warning"
                title="Some reports are not saved yet"
                action={<Button leftIcon={<RotateCw aria-hidden />} loading={resend.isPending} onClick={() => resend.mutate(waiting.map((r) => r.slug))}>Save again</Button>}
              >
                {sayWaiting}
              </Notice>
            )}
          </>
        )}
        quick={noList || loading ? [] : quick}
        onQuick={onQuick}
        quickLabel="Quick views"
        search={filters.search}
        onSearch={(q) => setFilters({ ...filters, search: q })}
        searchLabel="Search reports by name, description or module"
        searchRef={searchRef}
        actions={() => <Menu label="Sort" items={sortItems} />}
        groups={groups}
        onToggle={toggleFacet}
        onClear={(facet) => setFilters({ ...filters, [facet]: [] } as Filters)}
        onClearAll={() => setFilters(NO_FILTERS)}
        filtering={filterCount(filters)}
        shown={filtered.length}
        applied={loading || noList ? null : (
          <AppliedFilters
            chips={chips.map((c) => ({ key: c.key, label: c.label }))}
            summary={`${formatCount(filtered.length)} of ${formatCount(rows.length)} ${rows.length === 1 ? 'report' : 'reports'}`}
            onRemove={(key) => { const chip = chips.find((c) => c.key === key); if (chip) setFilters(removeChip(filters, chip)); }}
            onClear={() => setFilters(NO_FILTERS)}
          />
        )}
        body={body}
        ready={!loading && !noList}
      />
      <NewReportSheet open={newOpen} onClose={() => setNewOpen(false)} datasets={datasets} onPick={(key) => { setNewOpen(false); router.push(newReportHref(key)); }} />
      <DetailsSheet
        open={!!editSpec}
        initial={editInitial}
        saving={save.isPending}
        error={editError}
        onClose={() => { setEditing(null); setEditError(null); }}
        onSave={(d) => { if (editSpec) save.mutate({ ...editSpec, name: d.name, description: d.description, shared: d.shared }); }}
      />
      {confirmDialog}
    </>
  );
}
