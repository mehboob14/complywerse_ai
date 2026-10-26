'use client';

/**
 * Governance Documents Workspace — the home of /governance/documents: the header with the create buttons, the summary cards, the
 * filter bar, the register table and the detail drawer. Data and state live here; what each filter MEANS, how the review date is
 * read, how frameworks are cut for a cell and how the page lives in the address are rules in libraryModel.ts (tested); the parts
 * only draw. The page's state (filters, sort, the document peeked at) is in the address, so a link opens the same view; the
 * person's own columns, density and saved views are kept in their browser (libraryPrefs.ts).
 * The existing create/upload/AI-draft/templates modals stay in page.tsx and are opened via the callbacks passed in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, FileText, Loader2, Plus, SearchX, Sparkles, LayoutTemplate } from 'lucide-react';
import { AnimatedModal, MultiSelectDropdown, RightSlidePanel, useToast } from '@/components/ui';
import { assetsApi, governanceApi } from '@/lib/api';
import { parseUtc } from '@/lib/serverTime';
import { problemOf, studioApi } from '@/lib/studio/api';
import type { GovDoc } from './lib';
import { DOC_TYPE_STYLE, STAGE_ORDER, statusLabel, useDepartmentNames, useFrameworkInfo } from './lib';
import {
  fetchDocuments, fetchCoverage,
  bulkArchive, bulkAssignOwner, bulkSetReviewDate, bulkPublish, restoreDocument,
} from './api';
import { ARCHIVE_LINE, libraryCounts, unlessArchivedAsked } from './archive';
import { creation, departmentFilterOptions } from './library';
import {
  BUILT_IN_VIEWS, NO_FILTERS, NO_OWNER,
  classificationOptions, compareDocs, exportColumnsFor, frameworkOptions, fromParams, isFiltering, kpis, matchesFilters, openFromParams,
  toCsv, viewMatching, withLibraryParams,
  type Filters, type LibraryState, type Lookups, type MatchContext, type Option, type SavedView, type Sort,
} from './libraryModel';
import {
  DEFAULT_PREFS, OPTIONAL_COLUMNS, browserStore, loadPrefs, loadViews, newViewId, prefsKey, savePrefs, saveViews, viewsKey,
  type Density, type Prefs,
} from './libraryPrefs';
import { LibraryKpis } from './LibraryKpis';
import { LibraryFilters, type ColumnChoice, type FilterOptions } from './LibraryFilters';
import { LibraryTable } from './LibraryTable';
import { DocumentDrawer } from './DocumentDrawer';
import DetailsDialog from '../[id]/_DetailsDialog';
import { useOrgDepartments } from '../_DetailsFields';

export interface DocumentsWorkspaceProps {
  canCreate: boolean;
  canEdit: boolean;
  currentUserId?: number | null;
  onNewDocument: () => void;
  onAIDraft: () => void;
  onTemplates: () => void;
}

const COLUMN_LABEL: Record<(typeof OPTIONAL_COLUMNS)[number], string> = {
  type: 'Type', lifecycle: 'Lifecycle', owner: 'Owner', department: 'Department', frameworks: 'Frameworks', attestation: 'Attestation',
  review: 'Next review', version: 'Version', updated: 'Updated',
};
const STATUS_OPTIONS: Option[] = [
  ...STAGE_ORDER.map((s) => ({ value: s as string, label: statusLabel(s) })),
  { value: 'expired', label: 'Expired' },
  { value: 'archived', label: 'Archived (shown on its own)' },
];

const BTN_PLAIN = 'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 py-1.5 text-sm font-medium text-[#26323d] hover:bg-[#f3f6f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

function download(data: BlobPart, fileName: string, type?: string) {
  const url = URL.createObjectURL(new Blob([data], type ? { type } : undefined));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function DocumentsWorkspace({ canCreate, canEdit, currentUserId, onNewDocument, onAIDraft, onTemplates }: DocumentsWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const mine = (d: { owner_id?: number | null; author_id?: number | null }) =>
    currentUserId != null && (d.owner_id === currentUserId || d.author_id === currentUserId);
  // the row's Edit and Archive: its editors, never on an archived document (Restore brings it back first)
  const mayChange = (d: GovDoc) => (canEdit || mine(d)) && d.status !== 'archived';

  // New Document, AI Draft and Templates all open the Comply AI Studio
  const studio = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 5 * 60_000, retry: false });
  const create = creation(canCreate, studio.data?.enabled);

  // ── the page's state: in the address, so a link opens the same view ──
  const [state, setState] = useState<LibraryState>(() => fromParams(new URLSearchParams(searchParams?.toString() ?? '')));
  const [openId, setOpenId] = useState<number | null>(() => openFromParams(new URLSearchParams(searchParams?.toString() ?? '')));
  const { filters, sort } = state;
  const setFilters = useCallback((next: Filters) => setState((s) => ({ ...s, filters: next })), []);
  const setSort = useCallback((next: Sort) => setState((s) => ({ ...s, sort: next })), []);
  const synced = useRef(false);
  useEffect(() => {
    // the first run only reads: the state was just taken FROM the address, so there is nothing to write, and a page that somehow
    // started on the defaults must not strip a link's parameters before anyone changed anything
    if (!synced.current) { synced.current = true; return; }
    // history.replaceState (not router.replace): no navigation, no history entries. With `null` as its state Next folds the new address
    // into its router (usePathname/useSearchParams, and the address it returns to after a refresh); passing history.state would skip that
    const next = withLibraryParams(new URLSearchParams(window.location.search), state, openId).toString();
    const url = window.location.pathname + (next ? `?${next}` : '') + window.location.hash;
    if (url !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(null, '', url);
  }, [state, openId]);

  // ── what this person keeps in their browser: columns, density, rows per page, saved views ──
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [saved, setSaved] = useState<SavedView[]>([]);
  useEffect(() => {
    setPrefs(loadPrefs(browserStore(), prefsKey(currentUserId)));
    setSaved(loadViews(browserStore(), viewsKey(currentUserId)));
  }, [currentUserId]);
  const changePrefs = (next: Prefs) => { setPrefs(next); savePrefs(browserStore(), prefsKey(currentUserId), next); };
  const views = useMemo(() => [...BUILT_IN_VIEWS, ...saved], [saved]);
  const activeViewId = viewMatching(views, state)?.id ?? null;
  const saveView = (name: string) => {
    const next = [...saved, { id: newViewId(saved), name, state }];
    setSaved(next);
    saveViews(browserStore(), viewsKey(currentUserId), next);
    toast({ title: 'View saved', message: `“${name}” is in your views.`, type: 'success' });
  };
  const deleteView = (id: string) => {
    const next = saved.filter((v) => v.id !== id);
    setSaved(next);
    saveViews(browserStore(), viewsKey(currentUserId), next);
  };

  // bulk side-panels
  const [assignOwnerFor, setAssignOwnerFor] = useState<number[] | null>(null);
  const [assignOwnerId, setAssignOwnerId] = useState<string>('');
  const [reviewDateFor, setReviewDateFor] = useState<number[] | null>(null);
  const [reviewDate, setReviewDate] = useState<string>('');

  const { data: listData, isLoading: docsLoading, isError: listFailed, refetch } = useQuery({
    queryKey: ['gov-docs-workspace'],
    queryFn: () => fetchDocuments({ limit: 1000, sort_by: 'updated_at', sort_order: 'desc' }),
  });
  const { data: coverage } = useQuery({ queryKey: ['gov-docs-coverage'], queryFn: fetchCoverage });
  const { data: users = [] } = useQuery({
    queryKey: ['tenant-users-gov'],
    queryFn: async () => (await assetsApi.getTenantUsers()).data as Array<{ id: number; display_name: string; email?: string }>,
    staleTime: 5 * 60 * 1000,
  });

  const allDocs: GovDoc[] = useMemo(() => listData?.items ?? [], [listData]);
  const truncated = (listData?.total ?? 0) > allDocs.length;

  // ── names the rules and the cells need ──
  const departmentName = useDepartmentNames();
  const frameworkInfo = useFrameworkInfo();
  const lookups: Lookups = useMemo(
    () => ({ departments: departmentName, frameworks: frameworkInfo, coverage: coverage?.pct ?? {}, me: currentUserId ?? null }),
    [departmentName, frameworkInfo, coverage, currentUserId],
  );
  const counts = coverage?.counts ?? NO_COUNTS;
  // the same instant for every rule until the list is read again
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [listData]);
  const ctx: MatchContext = useMemo(() => ({ ...lookups, now }), [lookups, now]);

  // ── the options the filters offer ──
  const departmentsQ = useOrgDepartments();
  const options: FilterOptions = useMemo(() => {
    const knownTypes = Object.keys(DOC_TYPE_STYLE);
    const otherTypes = Array.from(new Set(allDocs.map((d) => d.doc_type))).filter((t) => t && !knownTypes.includes(t));
    return {
      types: [...knownTypes, ...otherTypes].map((k) => ({ value: k, label: DOC_TYPE_STYLE[k]?.label ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ') })),
      statuses: STATUS_OPTIONS,
      owners: [{ value: NO_OWNER, label: 'No owner' }, ...users.map((u) => ({ value: String(u.id), label: u.display_name, subLabel: u.email }))],
      departments: departmentFilterOptions(departmentsQ.data, allDocs),
      frameworks: frameworkOptions(allDocs, frameworkInfo),
      classifications: classificationOptions(allDocs),
    };
  }, [allDocs, users, departmentsQ.data, frameworkInfo]);

  // archived documents count only under Archived (archive.ts)
  const totals = useMemo(() => libraryCounts(allDocs), [allDocs]);
  const summary = useMemo(() => kpis(allDocs, now), [allDocs, now]);

  const refreshAll = () => {
    ['gov-docs-workspace', 'gov-docs-overdue', 'gov-docs-mypending', 'gov-docs-coverage']
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  // the documents the table is drawn from (the documents above a match come from here) and the ones that match
  const scope = useMemo(() => unlessArchivedAsked(allDocs, filters.statuses), [allDocs, filters.statuses]);
  const filtering = isFiltering(filters);
  const filteredDocs = useMemo(() => scope.filter((d) => matchesFilters(d, filters, ctx)), [scope, filters, ctx]);
  const archivedList = filters.statuses.length === 1 && filters.statuses[0] === 'archived';
  const openDocRow = openId != null ? allDocs.find((d) => d.id === openId) ?? null : null;
  // the next / previous document of the list as it is sorted (the order the CSV has)
  const ordered = useMemo(() => [...filteredDocs].sort(compareDocs(sort, lookups)), [filteredDocs, sort, lookups]);
  const at = openDocRow ? ordered.findIndex((d) => d.id === openDocRow.id) : -1;

  const pickFramework = (id: number) => {
    const key = String(id);
    setFilters({ ...filters, frameworks: filters.frameworks.includes(key) ? filters.frameworks.filter((f) => f !== key) : [...filters.frameworks, key] });
  };

  const exportCsv = () => {
    const csv = toCsv(ordered, exportColumnsFor(prefs.hidden), lookups);
    download(csv, `document-library-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
  };

  // ── handlers ──
  const openDoc = (id: number) => router.push(`/governance/documents/${id}`);

  const runBulk = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, type: 'success' }); }
    catch (e) { toast({ title: 'Action failed', message: problemOf(e), type: 'error' }); }     // the server's reason (e.g. archived)
    finally { refreshAll(); }                                                                  // a bulk Restore may have restored some
  };
  const onBulkPublish = (ids: number[]) => runBulk(() => bulkPublish(ids), `Publish requested for ${ids.length}`);
  const onBulkArchive = (ids: number[]) => runBulk(() => bulkArchive(ids), `${ids.length} archived`);
  const onBulkRestore = (ids: number[]) => runBulk(async () => { for (const id of ids) await restoreDocument(id); }, `${ids.length} restored as drafts`);

  const doAssignOwner = async () => {
    if (!assignOwnerFor || !assignOwnerId) return;
    await runBulk(() => bulkAssignOwner(assignOwnerFor, Number(assignOwnerId)), 'Owner assigned');
    setAssignOwnerFor(null); setAssignOwnerId('');
  };
  const doSetReviewDate = async () => {
    if (!reviewDateFor || !reviewDate) return;
    await runBulk(() => bulkSetReviewDate(reviewDateFor, new Date(reviewDate).toISOString()), 'Review date set');
    setReviewDateFor(null); setReviewDate('');
  };

  // ── register row actions ──
  // Edit: the document page's Details popup, on the whole document (the list holds only part of it)
  const [details, setDetails] = useState<any | null>(null);
  const onEditDoc = async (doc: GovDoc) => {
    try {
      setDetails(await qc.fetchQuery({ queryKey: ['governance-document', doc.id], queryFn: async () => (await governanceApi.getDocument(doc.id)).data as any }));
    } catch (e) {
      toast({ title: 'The details could not be opened', message: problemOf(e), type: 'error' });
    }
  };
  const onDownloadDoc = async (doc: GovDoc) => {
    const pdfName = `${(doc.title || 'document').replace(/[^\w.\- ]+/g, '_').trim() || 'document'}.pdf`;
    try {
      // /export serves the uploaded file when present, else a PDF of the markdown
      // content — so every document (incl. content-only AI drafts) is downloadable.
      const res = await governanceApi.exportDocument(doc.id);
      download(res.data as BlobPart, doc.has_file && doc.file_name ? doc.file_name : pdfName);
    } catch {
      // Fallback (e.g. /export not live yet) — file-backed docs still work via download-file.
      if (doc.has_file) {
        try {
          const r = await governanceApi.downloadDocumentFile(doc.id);
          download(r.data as BlobPart, doc.file_name || `document-${doc.id}`);
          return;
        } catch { /* fall through to error toast */ }
      }
      toast({ title: 'Download failed', message: 'Could not export this document.', type: 'error' });
    }
  };
  // documents are archived, never deleted (the user, 2026-10-17); asked as the document page asks it
  const [archiving, setArchiving] = useState<GovDoc | null>(null);
  const archive = useMutation({
    mutationFn: (id: number) => bulkArchive([id]),
    onSuccess: () => {
      setArchiving(null);
      toast({ title: 'Document archived', message: 'It is no longer in force; its versions and history are kept.', type: 'success' });
      refreshAll();
    },
  });
  const onArchiveDoc = (doc: GovDoc) => { archive.reset(); setArchiving(doc); };
  const onRestoreDoc = async (doc: GovDoc) => {
    try {
      await restoreDocument(doc.id);
      toast({ title: 'Restored as a draft', message: 'Send it for review when it is ready: it is in force again once approved and published.', type: 'success' });
      refreshAll();
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      toast({ title: 'Not restored', message: typeof detail === 'string' ? detail : undefined, type: 'error' });
    }
  };

  const updatedLabel = useMemo(() => {
    const latest = allDocs.reduce((m, d) => (d.updated_at > m ? d.updated_at : m), '');
    const when = parseUtc(latest);     // the server's times are naive UTC
    if (!when) return '';
    const mins = Math.round((Date.now() - when.getTime()) / 60000);
    if (mins < 1) return 'Updated just now';
    if (mins < 60) return `Updated ${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `Updated ${hrs} h ago`;
    return `Updated ${Math.round(hrs / 24)} d ago`;
  }, [allDocs]);

  const columns: ColumnChoice[] = OPTIONAL_COLUMNS.map((id) => ({ id, label: COLUMN_LABEL[id], visible: !prefs.hidden.includes(id) }));

  // what the table says when it has no rows: no documents yet, nothing archived, or nothing matches
  const empty = (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-12 text-center">
      {allDocs.length === 0 ? <FileText className="h-9 w-9 text-[#9aa5b1]" strokeWidth={1.5} aria-hidden /> : <SearchX className="h-9 w-9 text-[#9aa5b1]" strokeWidth={1.5} aria-hidden />}
      <h3 className="text-[15px] font-semibold text-[#1f2933]">
        {allDocs.length === 0 ? 'No documents yet' : archivedList && !filtering ? 'Nothing is archived' : 'No documents match'}
      </h3>
      <p className="text-[13px] text-[#586472]">
        {allDocs.length === 0
          ? 'Policies, standards and procedures you write or upload appear here, with their owners, review dates and frameworks.'
          : archivedList && !filtering ? 'Archived documents are kept here, with their versions and history, where their editors can restore them.'
          : 'No document has all of what the filters ask for. Remove a filter, or try fewer words in the search.'}
      </p>
      {allDocs.length > 0 && filtering && (
        <button type="button" onClick={() => setFilters(NO_FILTERS)} className={BTN_PLAIN}>Clear all filters</button>
      )}
      {allDocs.length === 0 && create === 'buttons' && (
        <button type="button" onClick={onNewDocument} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3 py-1.5 text-sm font-medium text-[#fff] hover:bg-[#115e59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
          <Plus strokeWidth={1.75} className="h-4 w-4" /> New document
        </button>
      )}
    </div>
  );

  return (
    <div className="governance-light space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold leading-tight text-[#1f2933]">Document library</h1>
          <p className="text-[13px] text-[#586472]">Policies, standards and procedures: who owns them, when they are due for review, and the frameworks they cover.{updatedLabel ? ` ${updatedLabel}.` : ''}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {create === 'studio-off' && (
            <span className="shrink-0 text-xs text-[#3f4b58]">Creating documents needs the Comply AI Studio.</span>
          )}
          {create === 'buttons' && (
            <>
              <button onClick={onTemplates} title="Templates" className={BTN_PLAIN}>
                <LayoutTemplate strokeWidth={1.75} className="h-4 w-4" /> <span className="hidden xl:inline">Templates</span>
              </button>
              <button onClick={onAIDraft} title="AI Draft" className={BTN_PLAIN}>
                <Sparkles strokeWidth={1.75} className="h-4 w-4 text-[#0f766e]" /> <span className="hidden xl:inline">AI Draft</span>
              </button>
              <button onClick={onNewDocument} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#0f766e] px-3 py-1.5 text-sm font-medium text-[#fff] hover:bg-[#115e59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
                <Plus strokeWidth={1.75} className="h-4 w-4" /> <span className="hidden sm:inline">New Document</span><span className="sm:hidden">New</span>
              </button>
            </>
          )}
        </div>
      </header>

      <LibraryKpis
        kpis={summary}
        statuses={filters.statuses}
        review={filters.review}
        onStatuses={(next) => setFilters({ ...filters, statuses: next })}
        onReview={(next) => setFilters({ ...filters, review: next })}
        loading={docsLoading}
      />

      <LibraryFilters
        filters={filters}
        onChange={setFilters}
        options={options}
        canFilterMine={currentUserId != null}
        shown={filteredDocs.length}
        total={archivedList ? totals.archived : totals.all}
        views={views}
        activeViewId={activeViewId}
        onApplyView={(v) => setState(v.state)}
        onSaveView={saveView}
        onDeleteView={deleteView}
        columns={columns}
        onToggleColumn={(id) => changePrefs({ ...prefs, hidden: prefs.hidden.includes(id) ? prefs.hidden.filter((c) => c !== id) : [...prefs.hidden, id] })}
        onResetColumns={() => changePrefs({ ...prefs, hidden: DEFAULT_PREFS.hidden })}
        density={prefs.density}
        onDensity={(density: Density) => changePrefs({ ...prefs, density })}
        onExport={exportCsv}
        canExport={filteredDocs.length > 0}
      />

      {listFailed && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-[#f1b5ae] bg-[#fef3f2] px-3 py-2 text-[13px] text-[#7a1616]">
          <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1">The documents could not be loaded.</span>
          <button type="button" onClick={() => refetch()} className={BTN_PLAIN}>Try again</button>
        </div>
      )}
      {truncated && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-[#e6d3a3] bg-[#fffbeb] px-3 py-2 text-[13px] text-[#6b4f0a]">
          <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          Showing the {allDocs.length} most recently updated of {listData?.total} documents. Older ones are not in this list.
        </div>
      )}

      <section className="min-w-0">
        <LibraryTable
          // the documents above a match come from the same archived-aware scope as the list: no archived parent in the working list
          scope={scope}
          filtering={filtering}
          docs={filteredDocs}
          lookups={lookups}
          counts={counts}
          preferFrameworks={filters.frameworks}
          sort={sort}
          onSort={setSort}
          hiddenColumns={prefs.hidden}
          density={prefs.density}
          pageSize={prefs.pageSize}
          onPageSize={(pageSize) => changePrefs({ ...prefs, pageSize })}
          activeId={openId}
          onPeek={setOpenId}
          onOpenDoc={openDoc}
          onPickFramework={pickFramework}
          onEdit={onEditDoc}
          onDownload={onDownloadDoc}
          onArchive={onArchiveDoc}
          onBulkPublish={onBulkPublish}
          onBulkArchive={onBulkArchive}
          onBulkAssignOwner={(ids) => setAssignOwnerFor(ids)}
          onBulkSetReviewDate={(ids) => setReviewDateFor(ids)}
          canEdit={canEdit}
          canEditRow={mayChange}
          canArchiveRow={mayChange}
          onRestore={onRestoreDoc}
          canRestoreRow={(d) => (canEdit || mine(d)) && d.status === 'archived'}
          showingArchived={archivedList}
          onBulkRestore={onBulkRestore}
          loading={docsLoading}
          emptyState={empty}
        />
      </section>

      <DocumentDrawer
        doc={openDocRow}
        lookups={lookups}
        counts={counts}
        activeFrameworks={filters.frameworks}
        onClose={() => setOpenId(null)}
        onOpenDoc={openDoc}
        onPickFramework={pickFramework}
        onEdit={onEditDoc}
        canEdit={openDocRow ? mayChange(openDocRow) : false}
        onDownload={onDownloadDoc}
        onArchive={onArchiveDoc}
        canArchive={openDocRow ? mayChange(openDocRow) : false}
        onRestore={onRestoreDoc}
        canRestore={openDocRow ? (canEdit || mine(openDocRow)) && openDocRow.status === 'archived' : false}
        onStep={(dir) => { const next = ordered[at + dir]; if (next) setOpenId(next.id); }}
        hasPrev={at > 0}
        hasNext={at >= 0 && at < ordered.length - 1}
      />

      {/* Bulk: assign owner */}
      <RightSlidePanel isOpen={assignOwnerFor != null} onClose={() => setAssignOwnerFor(null)} title={`Assign owner · ${assignOwnerFor?.length ?? 0} documents`}>
        <div className="space-y-4 p-1">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">New owner</label>
            <MultiSelectDropdown title="Owner" items={options.owners.filter((o) => o.value !== NO_OWNER)} selectedValues={assignOwnerId ? [assignOwnerId] : []} onApply={(v) => setAssignOwnerId(v[0] || '')} multiSelect={false} autoApply forceSearch triggerVariant="input" placeholder="Select a user" size="md" triggerClassName="w-full" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setAssignOwnerFor(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={doAssignOwner} disabled={!assignOwnerId} className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">Assign owner</button>
          </div>
        </div>
      </RightSlidePanel>

      {/* Bulk: set review date */}
      <RightSlidePanel isOpen={reviewDateFor != null} onClose={() => setReviewDateFor(null)} title={`Set review date · ${reviewDateFor?.length ?? 0} documents`}>
        <div className="space-y-4 p-1">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Next review date</label>
            <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setReviewDateFor(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={doSetReviewDate} disabled={!reviewDate} className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">Set date</button>
          </div>
        </div>
      </RightSlidePanel>

      {/* Row Edit: the document page's Details popup */}
      {details && (
        <DetailsDialog doc={details} open onClose={() => setDetails(null)} canEdit={mayChange(details)} onSaved={refreshAll} />
      )}

      {/* Row Archive: asked as the document page asks it */}
      <AnimatedModal isOpen={!!archiving} onClose={() => setArchiving(null)} size="md" title={`Archive “${archiving?.title ?? ''}”?`}
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setArchiving(null)}
              className="rounded-lg border border-[#b8c4c8] bg-white px-3 py-1.5 text-sm font-medium text-[#26323d] hover:bg-[#f3f6f8]">Cancel</button>
            <button type="button" onClick={() => archiving && archive.mutate(archiving.id)} disabled={archive.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#b42318] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#912018] disabled:opacity-50">
              {archive.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />} Archive
            </button>
          </div>
        )}>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-[#26323d]">{ARCHIVE_LINE}</p>
          {archive.isError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-[#7a1616]" role="alert">Not archived: {problemOf(archive.error)}</p>}
        </div>
      </AnimatedModal>
    </div>
  );
}

const NO_COUNTS: Record<number, { done: number; total: number }> = {};
