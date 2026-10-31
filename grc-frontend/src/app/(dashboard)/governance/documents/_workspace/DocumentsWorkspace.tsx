'use client';

/**
 * Governance Documents Workspace — the home of /governance/documents: the page head with the create buttons, the summary tiles, the filter bar, the register (a table, or
 * cards on a phone) and the details panel. Data and state live here; what each filter MEANS, how the review date is read, how frameworks are cut for a cell and how the page
 * lives in the address are rules in libraryModel.ts (tested); what the page says about how many documents it has is libraryNumbers.ts; which columns are drawn at which width
 * is libraryColumns.ts; the parts only draw. The page's state (filters, sort, the document peeked at) is in the address, so a link opens the same view; the person's own
 * columns, density and saved views are kept in their browser (libraryPrefs.ts).
 * The register has two layouts, the table and a folder for each department (libraryFolders.ts); the layout is in the address (?view=) and remembered, and "Move to…" files
 * documents under a department from either.
 *
 * On the design-system kit (the page has left the legacy governance page scope of globals.css): the head, the notice, the tiles, the controls, the states (skeleton, empty, error with Retry) are
 * kit pieces. Every write is reported when the server has answered (useReportedMutation: a failure stays on screen with the server's words and a Retry) and archiving asks
 * first (useConfirm, danger); a move, which is one request for each document with its own outcomes, says them through useNotify. The invalidations are what they always were.
 * The list is one request for the 1,000 most recently updated documents; when the server holds more, a notice says so and every count and the export say what they are over.
 * The existing create/upload/AI-draft/templates modals stay in page.tsx and are opened via the callbacks passed in.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, FileText, LayoutTemplate, Plus, Sparkles } from 'lucide-react';
import { PageHeader, RightSlidePanel } from '@/components/ui';
import { Button, EmptyState, ErrorState, FormField, Select, TextInput, useConfirm, useNotify, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ListNotice } from '@/components/governance/ListNotice';
import { assetsApi, governanceApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { parseUtc } from '@/lib/serverTime';
import { problemOf, studioApi } from '@/lib/studio/api';
import type { GovDoc } from './lib';
import { DOC_TYPE_STYLE, STAGE_ORDER, statusLabel, useDepartmentNames, useFrameworkInfo } from './lib';
import {
  fetchDocuments, fetchCoverage,
  bulkArchive, bulkAssignOwner, bulkSetReviewDate, bulkPublish, moveDocument, restoreDocument,
} from './api';
import { ARCHIVE_LINE, libraryCounts, unlessArchivedAsked } from './archive';
import { creation, departmentFilterOptions } from './library';
import { buildFolders, chooseView, displayOrder, moveAll, moveMessage, moveTargets, type MoveTarget } from './libraryFolders';
import {
  BUILT_IN_VIEWS, NO_FILTERS, NO_OWNER,
  classificationOptions, compareDocs, exportColumnsFor, frameworkOptions, fromParams, isFiltering, kpis, matchesFilters, openFromParams,
  toCsv, viewFromParams, viewMatching, withLibraryParams,
  type Filters, type LibraryState, type LibraryViewId, type Lookups, type MatchContext, type Option, type SavedView, type Sort,
} from './libraryModel';
import { csvName, headCount, isCut, loadedNotice, missingOpen, noMatch, tileNoun, tilesNote } from './libraryNumbers';
import {
  DEFAULT_PREFS, OPTIONAL_COLUMNS, browserStore, foldersKey, loadFolderPrefs, loadPrefs, loadViews, newViewId, prefsKey, savePrefs,
  saveFolderPrefs, saveViews, viewsKey,
  type Density, type FolderPrefs, type Prefs,
} from './libraryPrefs';
import { LibraryKpis } from './LibraryKpis';
import { LibraryFilters, type ColumnChoice, type FilterOptions } from './LibraryFilters';
import { DepartmentsFailed, NoDepartments } from './FolderRows';
import { LibraryTable } from './LibraryTable';
import { DocumentDrawer } from './DocumentDrawer';
import { useMinWidth } from './useMinWidth';
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
  { value: 'archived', label: 'Archived', subLabel: 'Shown on its own' },
];

/** What a change to a document refreshes: the list, the Overview's review and approval counters, and the attestation coverage. Unchanged from before the kit. */
const REFRESH_KEYS: ReadonlyArray<readonly unknown[]> = [['gov-docs-workspace'], ['gov-docs-overdue'], ['gov-docs-mypending'], ['gov-docs-coverage']];

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
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
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
  // the layout the address asks for (?view=): null until the address says one or the person picks one; a link without it is as it was
  const [viewParam, setViewParam] = useState<LibraryViewId | null>(() => viewFromParams(new URLSearchParams(searchParams?.toString() ?? '')));
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
    const next = withLibraryParams(new URLSearchParams(window.location.search), state, openId, viewParam).toString();
    const url = window.location.pathname + (next ? `?${next}` : '') + window.location.hash;
    if (url !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(null, '', url);
  }, [state, openId, viewParam]);

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
    notify.success(`“${name}” is in your views.`, { title: 'View saved' });
  };
  const deleteView = async (view: SavedView) => {
    if (!(await confirm({
      title: `Delete the view “${truncate(view.name, 60).text}”?`,
      message: 'Only the saved view goes; the documents and their filters are not touched.',
      confirmLabel: 'Delete view',
      tone: 'danger',
    }))) return;
    const next = saved.filter((v) => v.id !== view.id);
    setSaved(next);
    saveViews(browserStore(), viewsKey(currentUserId), next);
    notify.success('View deleted');
  };

  // what the Folders view keeps in this browser: the layout the person chose, and the folders they left open or closed (null: not read yet)
  const [folderPrefs, setFolderPrefs] = useState<FolderPrefs | null>(null);
  useEffect(() => { setFolderPrefs(loadFolderPrefs(browserStore(), foldersKey(currentUserId))); }, [currentUserId]);
  const changeFolderPrefs = (next: FolderPrefs) => { setFolderPrefs(next); saveFolderPrefs(browserStore(), foldersKey(currentUserId), next); };
  const changeView = (next: LibraryViewId) => {
    setViewParam(next);
    changeFolderPrefs({ view: next, open: folderPrefs?.open ?? {} });
  };

  // bulk side-panels
  const [assignOwnerFor, setAssignOwnerFor] = useState<number[] | null>(null);
  const [assignOwnerId, setAssignOwnerId] = useState<string>('');
  const [reviewDateFor, setReviewDateFor] = useState<number[] | null>(null);
  const [reviewDate, setReviewDate] = useState<string>('');

  const { data: listData, isLoading: docsLoading, isError: listFailed, error: listError, refetch } = useQuery({
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
  // The server holds more than came back: the notice says so, and every number below says what it is over (libraryNumbers.ts)
  const serverTotal = listData?.total;
  const cut = isCut(allDocs.length, serverTotal);
  const noList = listFailed && !listData;                        // the list could not be read at all: never drawn as an empty library

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

  // ── the layout: the register table, or a folder for each department ──
  // The address wins, then what the person chose before, then Folders where a department is in use and the table where none is. Until
  // that is known the body waits as a skeleton, so a library that opens in Folders never flashes the table first.
  const departments = useMemo(() => departmentsQ.data ?? [], [departmentsQ.data]);
  const noDepartments = !departments.some((d) => d.is_active !== false);
  const view: LibraryViewId = chooseView({ address: viewParam, remembered: folderPrefs?.view ?? null, departments });
  const deciding = viewParam == null && (folderPrefs == null || (folderPrefs.view == null && departmentsQ.isLoading));
  const inFolders = view === 'folders';
  const waiting = docsLoading || deciding || (inFolders && departmentsQ.isLoading);
  // Folders chosen but there is nothing to group by (no department in use), or the departments could not be read (the folders cannot be
  // told from "No department" without them): the body says so instead of drawing folders
  const foldersBlocked = inFolders && !waiting && (departmentsQ.isError || noDepartments);
  const targets = useMemo(() => moveTargets(departments), [departments]);
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

  const refreshAll = () => { REFRESH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] })); };

  // the documents the table is drawn from (the documents above a match come from here) and the ones that match
  const scope = useMemo(() => unlessArchivedAsked(allDocs, filters.statuses), [allDocs, filters.statuses]);
  const filtering = isFiltering(filters);
  // the box shows every keystroke at once; the filtering of a thousand documents follows when React has a moment (a deferred value)
  const searched = useDeferredValue(filters.search);
  const applied = useMemo(() => (searched === filters.search ? filters : { ...filters, search: searched }), [filters, searched]);
  const filteredDocs = useMemo(() => scope.filter((d) => matchesFilters(d, applied, ctx)), [scope, applied, ctx]);
  const archivedList = filters.statuses.length === 1 && filters.statuses[0] === 'archived';
  const openDocRow = openId != null ? allDocs.find((d) => d.id === openId) ?? null : null;
  // a link to a document the list does not hold (cut, removed, not ours to read) says so instead of opening nothing
  const missing = openId != null && !waiting && !listFailed && !openDocRow ? missingOpen({ id: openId, loaded: allDocs.length, total: serverTotal }) : null;
  // The folders (Folders view): a folder for each department, each with the documents of the scope that belong to it in the order
  // chosen, and which of them match. Built only while they are drawn.
  const folders = useMemo(() => {
    if (!inFolders || foldersBlocked || waiting) return null;
    return buildFolders({
      scope: [...scope].sort(compareDocs(sort, lookups)), matches: new Set(filteredDocs.map((d) => d.id)), departments, filtering, now,
    });
  }, [inFolders, foldersBlocked, waiting, scope, sort, lookups, filteredDocs, departments, filtering, now]);
  // the next / previous document of the list as it is shown (the order the CSV has): sorted, or folder by folder in the Folders view
  const ordered = useMemo(
    () => (folders ? displayOrder(folders) : [...filteredDocs].sort(compareDocs(sort, lookups))),
    [folders, filteredDocs, sort, lookups],
  );
  const at = openDocRow ? ordered.findIndex((d) => d.id === openDocRow.id) : -1;

  const pickFramework = (id: number) => {
    const key = String(id);
    setFilters({ ...filters, frameworks: filters.frameworks.includes(key) ? filters.frameworks.filter((f) => f !== key) : [...filters.frameworks, key] });
  };

  // the file says what it holds: cut, its name says how many of the loaded documents and how many exist (a first line of notes would break the table)
  const exportCsv = () => {
    const csv = toCsv(ordered, exportColumnsFor(prefs.hidden), lookups);
    download(csv, csvName({ date: new Date().toISOString().slice(0, 10), shown: ordered.length, loaded: allDocs.length, total: serverTotal }), 'text/csv;charset=utf-8');
  };

  // ── handlers ──
  const openDoc = (id: number) => router.push(`/governance/documents/${id}`);

  // Every write below is said after the server has answered: a failure stays on screen with the server's words and a Retry. The refresh is what it always was
  // (after a failure too: a bulk Restore may have restored some).
  const publish = useReportedMutation({
    mutationFn: (ids: number[]) => bulkPublish(ids),
    success: (_, ids) => `Publish requested for ${ids.length}`,
    failure: "Couldn't publish the documents",
    invalidate: REFRESH_KEYS,
    onError: refreshAll,
  });
  const archive = useReportedMutation({
    mutationFn: (ids: number[]) => bulkArchive(ids),
    success: (_, ids) => (ids.length === 1 ? { title: 'Document archived', message: 'It is no longer in force; its versions and history are kept.' } : `${ids.length} archived`),
    failure: "Couldn't archive the documents",
    invalidate: REFRESH_KEYS,
    onError: refreshAll,
  });
  const restore = useReportedMutation({
    mutationFn: async (ids: number[]) => { for (const id of ids) await restoreDocument(id); },
    success: (_, ids) => (ids.length === 1
      ? { title: 'Restored as a draft', message: 'Send it for review when it is ready: it is in force again once approved and published.' }
      : `${ids.length} restored as drafts`),
    failure: 'Not restored',
    invalidate: REFRESH_KEYS,
    onError: refreshAll,
  });
  const assignOwner = useReportedMutation({
    mutationFn: ({ ids, owner }: { ids: number[]; owner: number }) => bulkAssignOwner(ids, owner),
    success: 'Owner assigned',
    failure: "Couldn't assign the owner",
    invalidate: REFRESH_KEYS,
    onError: refreshAll,
    onSuccess: () => { setAssignOwnerFor(null); setAssignOwnerId(''); },
  });
  const setReviewOn = useReportedMutation({
    mutationFn: ({ ids, date }: { ids: number[]; date: string }) => bulkSetReviewDate(ids, new Date(date).toISOString()),
    success: 'Review date set',
    failure: "Couldn't set the review date",
    invalidate: REFRESH_KEYS,
    onError: refreshAll,
    onSuccess: () => { setReviewDateFor(null); setReviewDate(''); },
  });

  const byId = (id: number) => allDocs.find((d) => d.id === id);
  // documents are archived, never deleted (the user, 2026-10-17); asked as the document page asks it
  const askArchive = async (ids: number[]) => {
    const one = ids.length === 1 ? byId(ids[0]) : undefined;
    const yes = await confirm({
      title: one ? `Archive “${truncate(one.title, 80).text}”?` : `Archive ${ids.length} documents?`,
      message: ARCHIVE_LINE,
      confirmLabel: ids.length === 1 ? 'Archive document' : `Archive ${ids.length} documents`,
      tone: 'danger',
    });
    if (yes) archive.mutate(ids);
  };
  const onBulkPublish = (ids: number[]) => publish.mutate(ids);
  const onBulkArchive = (ids: number[]) => { void askArchive(ids); };
  const onBulkRestore = (ids: number[]) => restore.mutate(ids);
  const onArchiveDoc = (doc: GovDoc) => { void askArchive([doc.id]); };
  const onRestoreDoc = (doc: GovDoc) => restore.mutate([doc.id]);

  // Move to…: one request for each document (the server checks who may change it, an archived document and a department that is
  // switched off, and writes "Department changed" in the Change log); ONE message says what happened, by how it went. Answers with the ids not moved.
  const onMove = async (ids: number[], to: MoveTarget): Promise<number[]> => {
    const docsById = new Map(allDocs.map((d) => [d.id, d] as [number, GovDoc]));
    const outcome = await moveAll(ids, to.id, {
      departmentOf: (id) => docsById.get(id)?.department_id,
      move: (id, department) => moveDocument(id, department),
      reason: (e) => problemOf(e, 'The server did not accept it.'),
    });
    const said = moveMessage(outcome, to.label);
    if (said.type === 'error') notify.error(said.message ?? 'The server did not accept it.', { title: said.title });
    else if (said.type === 'warning') notify.warning(said.message ?? '', { title: said.title });
    else if (said.type === 'info') notify.info(said.title);
    else notify.success(said.title);
    refreshAll();
    ['governance-document', 'document-chain'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    return outcome.failed.map((f) => f.id);
  };

  const doAssignOwner = () => { if (assignOwnerFor && assignOwnerId) assignOwner.mutate({ ids: assignOwnerFor, owner: Number(assignOwnerId) }); };
  const doSetReviewDate = () => { if (reviewDateFor && reviewDate) setReviewOn.mutate({ ids: reviewDateFor, date: reviewDate }); };

  // ── register row actions ──
  // Edit: the document page's Details popup, on the whole document (the list holds only part of it)
  const [details, setDetails] = useState<any | null>(null);
  const onEditDoc = async (doc: GovDoc) => {
    try {
      setDetails(await qc.fetchQuery({ queryKey: ['governance-document', doc.id], queryFn: async () => (await governanceApi.getDocument(doc.id)).data as any }));
    } catch (e) {
      notify.error(e, { title: 'The details could not be opened', retry: () => { void onEditDoc(doc); } });
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
      notify.error('Could not export this document.', { title: 'Download failed', retry: () => { void onDownloadDoc(doc); } });
    }
  };

  const updatedLabel = useMemo(() => {
    const latest = allDocs.reduce((m, d) => (d.updated_at > m ? d.updated_at : m), '');
    const when = parseUtc(latest);     // the server's times are naive UTC
    if (!when) return '';
    const mins = Math.round((Date.now() - when.getTime()) / 60000);
    if (mins < 1) return 'updated just now';
    if (mins < 60) return `updated ${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `updated ${hrs} h ago`;
    return `updated ${Math.round(hrs / 24)} d ago`;
  }, [allDocs]);

  // the Folders view has no Department column (the folder is the department), so the list of columns does not offer it there
  const columns: ColumnChoice[] = OPTIONAL_COLUMNS
    .filter((id) => !(folders && id === 'department'))
    .map((id) => ({ id, label: COLUMN_LABEL[id], visible: !prefs.hidden.includes(id) }));

  // what the register says when it has no rows: no documents yet, nothing archived, or nothing matches (cut, it says the rest was not searched)
  const nothing = noMatch(allDocs.length, serverTotal);
  const empty = allDocs.length === 0 ? (
    <EmptyState kind="firstUse" bare icon={FileText} title="No documents yet"
      action={create === 'buttons' ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onNewDocument}>New document</Button> : undefined} />
  ) : archivedList && !filtering ? (
    <EmptyState kind="firstUse" bare icon={Archive} title="Nothing archived" />
  ) : (
    <EmptyState kind="noMatches" bare title={nothing.title} description={nothing.description} onClearFilters={filtering ? () => setFilters(NO_FILTERS) : undefined} />
  );

  // the details panel: beside the register from 1024px (the register narrows and keeps what is being read), a full-screen sheet below
  const wide = useMinWidth(1024);
  const peeking = wide && !!openDocRow;
  const notice = loadedNotice(allDocs.length, serverTotal);
  const label = routeFor('/governance/documents')?.label ?? 'Documents';
  const drawer = {
    doc: openDocRow,
    lookups,
    counts,
    activeFrameworks: filters.frameworks,
    onClose: () => setOpenId(null),
    onOpenDoc: openDoc,
    onPickFramework: pickFramework,
    onEdit: onEditDoc,
    canEdit: openDocRow ? mayChange(openDocRow) : false,
    onDownload: onDownloadDoc,
    onArchive: onArchiveDoc,
    canArchive: openDocRow ? mayChange(openDocRow) : false,
    onRestore: onRestoreDoc,
    canRestore: openDocRow ? (canEdit || mine(openDocRow)) && openDocRow.status === 'archived' : false,
    onStep: (dir: -1 | 1) => { const next = ordered[at + dir]; if (next) setOpenId(next.id); },
    hasPrev: at > 0,
    hasNext: at >= 0 && at < ordered.length - 1,
  };

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={label}
        info="Policies, standards and procedures: who owns them, when they are due for review and the frameworks they cover."
        meta={noList || docsLoading ? undefined : `${headCount({ inList: archivedList ? totals.archived : totals.all, loaded: allDocs.length, total: serverTotal })}${updatedLabel ? ` · ${updatedLabel}` : ''}`}
        actions={(
          <>
            {create === 'studio-off' && (
              <span className="shrink-0 text-ds-label text-ds-fg-muted">Creating documents needs the Comply AI Studio.</span>
            )}
            {create === 'buttons' && (
              <>
                {/* icon only on a phone, so the three buttons share a line (the words stay for a screen reader) */}
                <Button onClick={onTemplates} title="Templates" leftIcon={<LayoutTemplate aria-hidden />}><span className="max-sm:sr-only">Templates</span></Button>
                <Button onClick={onAIDraft} title="AI Draft" leftIcon={<Sparkles aria-hidden />}><span className="max-sm:sr-only">AI Draft</span></Button>
                <Button variant="primary" onClick={onNewDocument} title="New document" leftIcon={<Plus aria-hidden />}>New document</Button>
              </>
            )}
          </>
        )}
      />

      {noList ? (
        <ErrorState title="Couldn't load the documents" message={errorMessage(listError)} onRetry={canRetry(listError) ? () => { void refetch(); } : undefined} />
      ) : (
        <>
          {listFailed && (
            // the list was read once and a later read failed (after a change, say): what is on screen is the last answer, and it says so
            <ErrorState compact title="Couldn't refresh the documents" message={`${errorMessage(listError)} What is shown may be out of date.`} onRetry={canRetry(listError) ? () => { void refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
          )}
          {notice && <ListNotice title={notice.title}>{notice.detail}</ListNotice>}
          {missing && (
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1"><ListNotice title={missing.title}>{missing.detail}</ListNotice></div>
              <div className="flex shrink-0 gap-2">
                <Button href={`/governance/documents/${openId}`}>Open its page</Button>
                <Button variant="ghost" onClick={() => setOpenId(null)}>Dismiss</Button>
              </div>
            </div>
          )}

          <LibraryKpis
            kpis={summary}
            statuses={filters.statuses}
            review={filters.review}
            onStatuses={(next) => setFilters({ ...filters, statuses: next })}
            onReview={(next) => setFilters({ ...filters, review: next })}
            loading={docsLoading}
            noun={tileNoun(cut)}
            note={docsLoading ? null : tilesNote(allDocs.length, serverTotal)}
          />

          <LibraryFilters
            filters={filters}
            onChange={setFilters}
            options={options}
            canFilterMine={currentUserId != null}
            shown={filteredDocs.length}
            total={archivedList ? totals.archived : totals.all}
            listSize={{ loaded: allDocs.length, total: serverTotal }}
            loading={docsLoading}
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
            view={view}
            onView={changeView}
          />

          <div className={peeking ? 'flex items-start gap-[16px]' : undefined}>
            <section className="min-w-0 flex-1">
              {foldersBlocked ? (
                <div className="rounded-ds-card border border-ds-border bg-ds-surface">
                  {departmentsQ.isError ? <DepartmentsFailed onRetry={() => departmentsQ.refetch()} /> : <NoDepartments />}
                </div>
              ) : (
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
                  peeking={peeking}
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
                  loading={waiting}
                  emptyState={empty}
                  listSize={{ loaded: allDocs.length, total: serverTotal }}
                  folders={folders}
                  folderOpen={folderPrefs?.open}
                  onFolderOpen={(open) => changeFolderPrefs({ view: folderPrefs?.view ?? null, open })}
                  moveTargets={targets}
                  onMove={onMove}
                  canMoveRow={mayChange}
                />
              )}
            </section>
            {wide && <DocumentDrawer mode="side" {...drawer} />}
          </div>
        </>
      )}

      {!wide && <DocumentDrawer mode="sheet" {...drawer} />}

      {/* Bulk: assign owner */}
      <RightSlidePanel
        isOpen={assignOwnerFor != null}
        onClose={() => setAssignOwnerFor(null)}
        title={`Assign owner · ${assignOwnerFor?.length ?? 0} documents`}
        dirty={assignOwnerId !== ''}
        footer={(
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAssignOwnerFor(null)}>Cancel</Button>
            <Button variant="primary" onClick={doAssignOwner} loading={assignOwner.isPending} disabled={!assignOwnerId}>Assign owner</Button>
          </div>
        )}
      >
        <FormField label="New owner">
          <Select placeholder="Select a user" value={assignOwnerId} onChange={(e) => setAssignOwnerId(e.target.value)}>
            {users.map((u) => <option key={u.id} value={String(u.id)}>{u.email ? `${u.display_name} (${u.email})` : u.display_name}</option>)}
          </Select>
        </FormField>
      </RightSlidePanel>

      {/* Bulk: set review date */}
      <RightSlidePanel
        isOpen={reviewDateFor != null}
        onClose={() => setReviewDateFor(null)}
        title={`Set review date · ${reviewDateFor?.length ?? 0} documents`}
        dirty={reviewDate !== ''}
        footer={(
          <div className="flex justify-end gap-2">
            <Button onClick={() => setReviewDateFor(null)}>Cancel</Button>
            <Button variant="primary" onClick={doSetReviewDate} loading={setReviewOn.isPending} disabled={!reviewDate}>Set date</Button>
          </div>
        )}
      >
        <FormField label="Next review date">
          <TextInput type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
        </FormField>
      </RightSlidePanel>

      {/* Row Edit: the document page's Details popup */}
      {details && (
        <DetailsDialog doc={details} open onClose={() => setDetails(null)} canEdit={mayChange(details)} onSaved={refreshAll} />
      )}

      {/* Archive, and deleting a saved view, ask first */}
      {confirmDialog}
    </div>
  );
}

const NO_COUNTS: Record<number, { done: number; total: number }> = {};
