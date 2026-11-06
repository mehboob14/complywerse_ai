'use client';

/**
 * Evidence Workspace: the home of /evidence. Four figure cards, a toolbar (search, status, type, view) and one of five views over ONE client-filtered list:
 * Workbench (master-detail, the default), Pipeline (a board), Snapshot (a readout), and two built but not offered in the switcher, Register and Performance, which
 * open from the address. The view, the filters, the search, the selected file and the page are in the address (?view= &status= &evidence_type= &q= &open= &page=).
 *
 * The list is the newest 1,000 files the server sends, filtered in the browser (the rules are evidenceModel.ts); when there are more the page says so with the
 * server's own total. The cards are the server's summary only. Every request says what became of it: a failed list is an error with Retry (it read "No evidence
 * to show"), a failed summary is a failed card (it was replaced by numbers worked out from the list), and every action is said after the server answers, in its
 * words, with Retry where repeating is safe. Upload stays in page.tsx.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Search } from 'lucide-react';
import EvidenceViewer, { EvidenceFile } from '@/components/evidence/EvidenceViewer';
import {
  Button, EmptyState, ErrorState, MultiSelect, Notice, SegmentedControl, SkeletonLines, StatTile, TextInput, useConfirm, useNotify, useReportedMutation, type SortState,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, truncate } from '@/lib/format';
import type { AddressState } from '@/lib/addressState';
import { evidenceStatus } from '@/lib/statuses/evidence';
import {
  NO_FILTERS, STATUS_VALUES, cutNotice, effectiveSelected, filterItems, isFiltered, listIsBusy, pageOfId, tiles, typeOptions, type EvidenceItem,
} from './evidenceModel';
import { OFFERED_VIEWS, SCHEMA, type ViewKey } from './workspaceAddress';
import {
  deleteEvidence, fetchExpiringSoon, fetchItems, fetchSummary, fetchTypes, reviewEvidence, runAssessment, submitForReview, type ItemsResponse,
} from './api';
import { WorkbenchView } from './WorkbenchView';
import { DetailPreview, PreviewPanel } from './DetailPreview';
import { PipelineView } from './PipelineView';
import { SnapshotView } from './SnapshotView';
import { RegisterView } from './RegisterView';
import { PerformanceView } from './PerformanceView';
import { useMinWidth } from './useMinWidth';

export interface EvidenceWorkspaceProps {
  canCreate: boolean;
  canDelete: boolean;
  onUploadClick: () => void;
  /** what the address holds, and the way to change it (the page owns it: it also holds the Records | Settings choice) */
  address: AddressState<typeof SCHEMA>;
  setAddress: (patch: Partial<AddressState<typeof SCHEMA>>, options?: { push?: boolean }) => void;
}

const STATUS_OPTIONS = STATUS_VALUES.map((value) => ({ value, label: evidenceStatus.label(value) }));
const VIEW_LABEL: Record<ViewKey, string> = { workbench: 'Workbench', pipeline: 'Pipeline', snapshot: 'Snapshot', register: 'Register', performance: 'Performance' };
const REFRESH = [['ev-ws-summary'], ['ev-ws-items'], ['ev-ws-expiring']] as const;
const MUTED = 'text-ds-fg-muted';
/** a refusal (403, 404) is final, anything else is tried once more after a short wait: a failure is said within a couple of seconds */
const retryRead = (failures: number, error: unknown): boolean => canRetry(error) && failures < 1;
const RETRY_AFTER = 800;
const short = (name: string) => truncate(name, 60).text;

export function EvidenceWorkspace({ canCreate, canDelete, onUploadClick, address: a, setAddress: set }: EvidenceWorkspaceProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const wide = useMinWidth(1024);
  const [previewFile, setPreviewFile] = useState<EvidenceFile | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<SortState>(null);

  const summaryQ = useQuery({ queryKey: ['ev-ws-summary'], queryFn: fetchSummary, retry: retryRead, retryDelay: RETRY_AFTER });
  const itemsQ = useQuery({
    queryKey: ['ev-ws-items'],
    queryFn: () => fetchItems({ limit: 1000 }),
    retry: retryRead,
    retryDelay: RETRY_AFTER,
    // While any file is being read or rated, ask again every 3 seconds so its status and maturity settle on their own; it stops once nothing is, and a reading
    // that began more than ten minutes ago is not waited for (the server calls it stalled), so one lost run cannot keep the page asking for ever.
    refetchInterval: (query) => (listIsBusy((query.state.data as ItemsResponse | undefined)?.items ?? []) ? 3000 : false),
  });
  const typesQ = useQuery({ queryKey: ['ev-ws-types'], queryFn: fetchTypes });
  const expiringQ = useQuery({ queryKey: ['ev-ws-expiring'], queryFn: () => fetchExpiringSoon(30), retry: retryRead, retryDelay: RETRY_AFTER });

  const allItems = useMemo<EvidenceItem[]>(() => itemsQ.data?.items ?? [], [itemsQ.data]);
  const filters = useMemo(() => ({ q: a.q, status: a.status, types: a.evidence_type }), [a.q, a.status, a.evidence_type]);
  const items = useMemo(() => filterItems(allItems, filters), [allItems, filters]);
  const typeOpts = useMemo(() => typeOptions(typesQ.data, allItems), [typesQ.data, allItems]);
  const filtered = isFiltered(filters);
  const selectedId = effectiveSelected(items, a.open || null);
  const sheetId = a.open && items.some((i) => i.id === a.open) ? a.open : null;
  const cut = cutNotice(allItems.length, itemsQ.data?.total);
  const t = tiles(summaryQ.data);
  const clearFilters = () => set({ q: NO_FILTERS.q, status: [], evidence_type: [], page: 1 });
  const named = (id: number) => allItems.find((x) => x.id === id)?.name ?? 'this evidence';

  // a link with ?open= opens the list on the page that file is on, once the list has arrived
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !itemsQ.data) return;
    placed.current = true;
    if (a.open && a.page === 1) {
      const page = pageOfId(items, a.open, pageSize);
      if (page > 1) set({ page });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the list first arrives
  }, [itemsQ.data]);

  // ── what a person can do to a file: each says what happened only after the server has answered ──
  const approve = useReportedMutation<unknown, number>({
    mutationFn: async (id) => (await reviewEvidence(id, 'approve')).data,
    success: (_, id) => `Approved “${short(named(id))}”`, failure: "Couldn't approve the evidence", invalidate: REFRESH,
  });
  const submit = useReportedMutation<unknown, number>({
    mutationFn: async (id) => (await submitForReview(id)).data,
    success: (_, id) => `Submitted “${short(named(id))}” for review`, failure: "Couldn't submit the evidence for review", invalidate: REFRESH,
  });
  const reassess = useReportedMutation<unknown, number>({
    mutationFn: async (id) => (await runAssessment(id)).data,
    success: 'The AI review has started. The rating appears here in a few seconds.', failure: "Couldn't start the AI review", invalidate: [...REFRESH, ['evidence-review']],
  });
  // Delete asks first; the server then deletes, or answers 200 "warning" when the file is linked to controls: that is asked again, then deleted with force.
  const askForce = async (id: number, message: string | undefined) => {
    const yes = await confirm({ title: 'Delete it anyway?', message: message || 'This evidence is linked to controls.', confirmLabel: 'Delete anyway', tone: 'danger' });
    if (yes) remove.mutate({ id, force: true });
  };
  const remove = useReportedMutation<{ warning?: boolean; message?: string } | undefined, { id: number; force: boolean }>({
    mutationFn: async ({ id, force }) => (await deleteEvidence(id, force)).data as { warning?: boolean; message?: string } | undefined,
    success: 'Evidence deleted', failure: "Couldn't delete the evidence", toast: 'errors',
    onSuccess: (data, v) => {
      if (data?.warning) { void askForce(v.id, data.message); return; }
      notify.success(`Deleted “${short(named(v.id))}”`);
      if (a.open === v.id) set({ open: 0 });
      REFRESH.forEach((key) => { void qc.invalidateQueries({ queryKey: key }); });
    },
  });
  const askDelete = async (id: number) => {
    const yes = await confirm({ title: 'Delete this evidence?', message: `“${short(named(id))}” will be deleted. This can't be undone.`, confirmLabel: 'Delete evidence', tone: 'danger' });
    if (yes) remove.mutate({ id, force: false });
  };

  const openFull = (id: number) => router.push(`/evidence/${id}`);
  const onOpenFile = (id: number) => {
    const it = allItems.find((x) => x.id === id);
    if (it?.file_path) setPreviewFile({ evidence_id: it.id, file_path: it.file_path, file_name: it.file_name || `Evidence ${it.id}`, mime_type: it.file_type ?? null, file_size: null });
    else openFull(id);
  };
  const busyFor = (id: number | null) => ({
    approve: approve.isPending && approve.variables === id,
    reassess: reassess.isPending && reassess.variables === id,
    remove: remove.isPending && remove.variables?.id === id,
  });
  const pendingId = submit.isPending ? submit.variables ?? null : approve.isPending ? approve.variables ?? null : null;

  const detail = (id: number | null) => (
    <DetailPreview
      evidenceId={id} onApprove={(x) => approve.mutate(x)} onReassess={(x) => reassess.mutate(x)} onOpenFile={onOpenFile}
      onDelete={canDelete ? (x) => { void askDelete(x); } : undefined} canReview={canCreate} canDelete={canDelete} busy={busyFor(id)}
    />
  );

  const listError = itemsQ.isError && !itemsQ.data ? { message: errorMessage(itemsQ.error), onRetry: canRetry(itemsQ.error) ? () => { void itemsQ.refetch(); } : undefined } : null;
  const empty = allItems.length === 0 ? (
    <EmptyState
      bare kind="firstUse" icon={FileText} title="No evidence yet" description={canCreate ? 'Upload a file to start your evidence library.' : 'No evidence has been uploaded yet.'}
      action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onUploadClick}>Upload evidence</Button> : undefined}
    />
  ) : (
    <EmptyState bare kind="noMatches" title="No evidence matches" description="Try another search or fewer filters." onClearFilters={clearFilters} />
  );

  const listState = itemsQ.isLoading ? <SkeletonLines lines={8} label="Loading the evidence" />
    : listError ? <ErrorState compact title="Couldn't load the evidence" message={listError.message} onRetry={listError.onRetry} />
    : items.length === 0 ? <div className="rounded-ds-card border border-ds-border bg-ds-surface">{empty}</div> : null;
  const offered: ViewKey[] = OFFERED_VIEWS.includes(a.view) ? [...OFFERED_VIEWS] : [...OFFERED_VIEWS, a.view];
  const showFilters = a.view === 'workbench' || a.view === 'pipeline' || a.view === 'register';

  return (
    <div className="flex flex-col gap-[16px]">
      {summaryQ.isError && !summaryQ.data ? (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <ErrorState compact title="Couldn't load the figures" message={errorMessage(summaryQ.error)} onRetry={canRetry(summaryQ.error) ? () => { void summaryQ.refetch(); } : undefined} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
          <StatTile label="Total" value={t ? formatCount(t.total) : null} loading={summaryQ.isLoading} note={t ? 'Evidence items' : undefined} />
          <StatTile label="Approved" value={t?.approvedPct == null ? null : `${t.approvedPct}%`} loading={summaryQ.isLoading} note={t ? `${formatCount(t.approved)} of ${formatCount(t.total)}` : undefined} info={t && t.approvedPct == null ? 'Nothing has been uploaded yet.' : undefined} tone="success" />
          <StatTile
            label="Pending review" value={t ? formatCount(t.pending) : null} loading={summaryQ.isLoading}
            link={t && t.pending > 0 ? { href: '/evidence?status=pending_review', label: `${formatCount(t.pending)} pending review. Open the pending files` } : undefined}
          />
          <StatTile label="Expiring" value={t ? formatCount(t.expiring) : null} loading={summaryQ.isLoading} note={t ? 'Within the next 30 days' : undefined} tone={t && t.expiring > 0 ? 'warning' : 'default'} />
        </div>
      )}

      {cut && <Notice tone="warning" title={cut.title}>{cut.text}</Notice>}

      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
        {showFilters && (
          <>
            <TextInput
              className="w-full sm:w-[260px]" aria-label="Search evidence" placeholder="Search evidence" maxLength={100} leftAdornment={<Search aria-hidden />}
              value={a.q} onChange={(e) => set({ q: e.target.value, page: 1 })}
            />
            <MultiSelect showLabel label="Status" placeholder="All" options={STATUS_OPTIONS} value={a.status} onChange={(v) => set({ status: v, page: 1 })} className="w-full sm:w-[210px]" />
            <MultiSelect showLabel label="Type" placeholder="All" options={typeOpts} value={a.evidence_type} onChange={(v) => set({ evidence_type: v, page: 1 })} className="w-full sm:w-[210px]" />
            {filtered && <Button variant="link" onClick={clearFilters}>Clear filters</Button>}
            {filtered && !listError && <span aria-live="polite" className={`text-ds-body ${MUTED}`}>{formatCount(items.length)} of {formatCount(allItems.length)}</span>}
          </>
        )}
        <SegmentedControl
          className="sm:ml-auto" label="View" name="evidence-view" value={a.view}
          options={offered.map((value) => ({ value, label: VIEW_LABEL[value] }))} onChange={(view: ViewKey) => set({ view, open: 0, page: 1 })}
        />
      </div>

      {a.view === 'workbench' && (
        <>
          <WorkbenchView
            items={items} page={a.page} pageSize={pageSize} onPage={(page) => set({ page })} onPageSize={(n) => { setPageSize(n); set({ page: 1 }); }}
            selectedId={wide ? selectedId : sheetId} onSelect={(id) => set({ open: id })} loading={itemsQ.isLoading} error={listError} empty={empty}
            preview={wide ? <PreviewPanel mode="docked" open onClose={() => undefined}>{detail(selectedId)}</PreviewPanel> : null}
          />
          {!wide && <PreviewPanel mode="sheet" open={sheetId !== null} onClose={() => set({ open: 0 })}>{sheetId !== null && detail(sheetId)}</PreviewPanel>}
        </>
      )}
      {a.view === 'pipeline' && (listState ?? (
        <PipelineView items={items} canReview={canCreate} pendingId={pendingId} onAdvance={(id, action) => (action === 'submit' ? submit : approve).mutate(id)} />
      ))}
      {a.view === 'snapshot' && (
        <SnapshotView
          summary={summaryQ.data} summaryState={{ loading: summaryQ.isLoading, error: summaryQ.error, onRetry: () => { void summaryQ.refetch(); } }}
          expiringSoon={expiringQ.data ?? []} expiringState={{ loading: expiringQ.isLoading, error: expiringQ.isError && !expiringQ.data ? expiringQ.error : null, onRetry: () => { void expiringQ.refetch(); } }}
        />
      )}
      {a.view === 'register' && (
        <>
          <RegisterView
            items={items} sort={sort} onSort={(next) => { setSort(next); set({ page: 1 }); }} page={a.page} pageSize={pageSize} onPage={(page) => set({ page })}
            onPageSize={(n) => { setPageSize(n); set({ page: 1 }); }} selectedId={sheetId} onOpen={(id) => set({ open: id })} loading={itemsQ.isLoading} error={listError} empty={empty}
          />
          <PreviewPanel mode="sheet" open={sheetId !== null} onClose={() => set({ open: 0 })}>{sheetId !== null && detail(sheetId)}</PreviewPanel>
        </>
      )}
      {a.view === 'performance' && <PerformanceView />}

      <EvidenceViewer evidence={previewFile} onClose={() => setPreviewFile(null)} />
      {confirmDialog}
    </div>
  );
}
