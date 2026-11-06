'use client';

/**
 * Governance Documents library: the Facet explorer. This file is the Documents CONFIGURATION of components/records (RecordExplorer): it owns the data (one lean request for the
 * whole library), the page's state (filters, sort, the document open and the layout live in the ADDRESS, on the kit's useAddressState, so a link opens the same view; the
 * person's density, rows per page, saved views and open folders are kept in their browser), the mutations and what each part draws. What a filter MEANS is libraryModel.ts, the
 * facets and their live counts are libraryFacets.ts over components/records/facetEngine.ts (held to libraryModel by a parity test), the rows are libraryRows.tsx, the folders
 * libraryFolders.ts, the board libraryBoard.ts, the numbers the page states libraryNumbers.ts.
 *
 * The library loads ONCE, whole and lean: every count, every facet number and the export are over all the documents (the response says when it could not hold them all).
 * Every write is reported when the server has answered (useReportedMutation: a failure stays on screen with the server's words and a Retry) and archiving asks first
 * (useConfirm, danger); a move, which is one request for each document, says its outcomes through useNotify. The invalidations are what they always were.
 */
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive, ArchiveRestore, CalendarClock, ChevronsDownUp, ChevronsUpDown, Download, FileText, FolderInput, LayoutTemplate, Plus, Send, Sparkles, UserPlus,
} from 'lucide-react';
import { PageHeader, RightSlidePanel } from '@/components/ui';
import {
  Button, Checkbox, EmptyState, ErrorState, FormField, Menu, Pager, Select, SkeletonRows, TextInput, useAddressState, useConfirm, useNotify, useReportedMutation,
  type FilterChip, type MenuItem,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ListNotice } from '@/components/governance/ListNotice';
import { AppliedFilters } from '@/components/records/AppliedFilters';
import { BoardColumns } from '@/components/records/BoardColumns';
import { BulkBar, type BulkActionDef } from '@/components/records/BulkBar';
import { RecordExplorer } from '@/components/records/RecordExplorer';
import { RecordTable, type RecordItem } from '@/components/records/RecordTable';
import { countMatching, countOf, evaluate } from '@/components/records/facetEngine';
import { moveCursor, selectAllMatching, tickState, toggleAll, toggleOne } from '@/components/records/explorerModel';
import type { FacetGroupView } from '@/components/records/FacetRail';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { useSelection } from '@/components/records/useSelection';
import { assetsApi, governanceApi } from '@/lib/api';
import { useInbox } from '@/lib/inbox/inboxApi';
import { truncate } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { parseUtc } from '@/lib/serverTime';
import { problemOf, studioApi } from '@/lib/studio/api';
import type { GovDoc } from './lib';
import { useDepartmentNames, useFrameworkInfo } from './lib';
import { coverageFromRows, fetchAttention, fetchCoverage, fetchLibrary, bulkArchive, bulkAssignOwner, bulkPublish, bulkSetReviewDate, moveDocument, restoreDocument } from './api';
import { ARCHIVE_LINE, libraryCounts, unlessArchivedAsked } from './archive';
import { creation, departmentScopes, departmentPaths } from './library';
import { LIBRARY_SCHEMA, filtersPatch, openPatch, pageOf, statePatch, viewPatch, type LibraryAddress } from './libraryAddress';
import { groupDocuments, statusesOfColumn } from './libraryBoard';
import {
  FACET_TITLE, OPEN_AT_FIRST, RAIL_ORDER, SEARCHABLE, chosenOf, departmentsAbove, indexDocuments, orderedOptions, railOptions, ruleOf,
} from './libraryFacets';
import { filterChips, removeChip, validViewName, WAITING_LABEL } from './libraryFiltersLogic';
import {
  buildFolders, chooseView, commonDepartment, displayOrder, expandable, flipFolder, folderEntries, folderIsOpen, moveAll, moveMessage, moveTargets, setAllFolders,
  showMoreStep, allFolders, type FoldChange, type FoldView, type MoveTarget,
} from './libraryFolders';
import { caretLabel, folderItems, recordRows } from './libraryItems';
import {
  ATTENTION_LABEL, BUILT_IN_VIEWS, NO_FILTERS, SORT_KEYS, attentionDepartment, exportColumnsFor, isFiltering, nextSort, nextStatuses, sortDocs, toCsv, viewMatching,
  type FacetKey, type Filters, type LibraryViewId, type MatchContext, type SavedView, type Sort, type SortKey,
} from './libraryModel';
import { csvName, exportWords, headCount, isCut, loadedNotice, missingOpen, noMatch, pagerNoun } from './libraryNumbers';
import {
  DEFAULT_PREFS, PAGE_SIZES, browserStore, foldersKey, loadFolderPrefs, loadPrefs, loadViews, newViewId, prefsKey, saveFolderPrefs, savePrefs, saveViews, viewsKey,
  type Density, type FolderPrefs, type Prefs,
} from './libraryPrefs';
import { actionableIds, bulkActionsFor, drawnRows, pageOf as pageSlice, rowRights, type BulkId } from './libraryTableLogic';
import { DocumentCard, RowMenu, documentColumns, type RowEnv } from './libraryRows';
import { buildTree, collapseAll, expandAll, flip, NOTHING_OPEN, openness, treeEntries, type Fold } from './docTree';
import { waitingCount, waitingForMe, waitingNote } from './waitingModel';
import { DocumentDetail } from './DocumentDetail';
import { DepartmentsFailed, FoldersToolbar, NoDepartments } from './FolderRows';
import { MovePopover } from './MovePopover';
import DetailsDialog from '../[id]/_DetailsDialog';
import { useOrgDepartments } from '../_DetailsFields';
import { useDepartmentLevels } from '@/components/admin/DepartmentForm';

export interface DocumentsWorkspaceProps {
  canCreate: boolean;
  canEdit: boolean;
  currentUserId?: number | null;
  onNewDocument: () => void;
  onAIDraft: () => void;
  onTemplates: () => void;
}

/** What a change to a document refreshes: the list, the Overview's review and approval counters, and the attestation coverage. Unchanged from before the explorer. */
const REFRESH_KEYS: ReadonlyArray<readonly unknown[]> = [['gov-docs-workspace'], ['gov-docs-overdue'], ['gov-docs-mypending'], ['gov-docs-coverage']];

const SORT_LABEL: Record<SortKey, string> = {
  title: 'Title', type: 'Type', lifecycle: 'Status', owner: 'Owner', department: 'Department', frameworks: 'Frameworks', attestation: 'Attestation', review: 'Next review',
  version: 'Version', updated: 'Last updated',
};
/** The quick views in the chip row, in order, with the short words a chip has room for; every other built-in view is in the Views menu. */
const QUICK: [string, string][] = [
  ['all', 'All'], ['mine', 'Mine'], ['waiting', WAITING_LABEL], ['overdue', 'Review overdue'], ['drafts', 'Drafts & in review'], ['in-force', 'In force'], ['no-owner', 'No owner'], ['archived', 'Archived'],
];
const BULK_ICON = { publish: Send, 'assign-owner': UserPlus, 'set-review': CalendarClock, archive: Archive, restore: ArchiveRestore } as const;
const NO_KEYS: ReadonlySet<string> = new Set<string>();
const NO_COUNTS: Record<number, { done: number; total: number }> = {};
const RAIL_LIMIT: Partial<Record<FacetKey, number>> = { frameworks: 7, owners: 7 };
const MAX_HEIGHT = 'max-h-[calc(100vh-17rem)]';

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

/** Names the view the person is saving: the kit's side sheet with one field, the rules of libraryFiltersLogic.validViewName. */
function SaveViewPanel({ open, existing, onClose, onSave }: { open: boolean; existing: string[]; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);
  const error = validViewName(name, existing);
  const close = () => { setName(''); setTried(false); onClose(); };
  return (
    <RightSlidePanel
      isOpen={open}
      onClose={close}
      title="Save this view"
      dirty={name.trim() !== ''}
      footer={(
        <div className="flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => { if (error) { setTried(true); return; } onSave(name.trim()); close(); }}>Save view</Button>
        </div>
      )}
    >
      <FormField label="Name" hint="Keeps the filters and the order you have now. Only you see it." error={tried || name.trim() !== '' ? error ?? undefined : undefined}>
        <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="For example, Overdue policies" />
      </FormField>
    </RightSlidePanel>
  );
}

export function DocumentsWorkspace({ canCreate, canEdit, currentUserId, onNewDocument, onAIDraft, onTemplates }: DocumentsWorkspaceProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const uid = useId();
  const { confirm, confirmDialog } = useConfirm();
  const mine = (d: { owner_id?: number | null; author_id?: number | null }) =>
    currentUserId != null && (d.owner_id === currentUserId || d.author_id === currentUserId);
  // the row's Edit and Archive: its editors, never on an archived document (Restore brings it back first)
  const mayChange = (d: GovDoc) => (canEdit || mine(d)) && d.status !== 'archived';
  const mayRestore = (d: GovDoc) => (canEdit || mine(d)) && d.status === 'archived';

  // New Document, AI Draft and Templates all open the Comply AI Studio
  const studio = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 5 * 60_000, retry: false });
  const create = creation(canCreate, studio.data?.enabled);

  // ── the page's state: in the address, so a link opens the same view ──
  const [address, setAddress] = useAddressState(LIBRARY_SCHEMA);
  const page = useMemo(() => pageOf(address as LibraryAddress), [address]);
  const { filters, sort } = page.state;
  const openId = page.openId;
  const viewParam = page.view;
  const setFilters = useCallback((next: Filters) => setAddress(filtersPatch(next)), [setAddress]);
  const setSort = useCallback((next: Sort) => setAddress({ sort: next }), [setAddress]);
  const setOpenId = useCallback((id: number | null) => setAddress(openPatch(id)), [setAddress]);

  // ── what this person keeps in their browser: density, rows per page, saved views, the folders left open ──
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [saved, setSaved] = useState<SavedView[]>([]);
  useEffect(() => {
    setPrefs(loadPrefs(browserStore(), prefsKey(currentUserId)));
    setSaved(loadViews(browserStore(), viewsKey(currentUserId)));
  }, [currentUserId]);
  const changePrefs = (next: Prefs) => { setPrefs(next); savePrefs(browserStore(), prefsKey(currentUserId), next); };
  const views = useMemo(() => [...BUILT_IN_VIEWS, ...saved], [saved]);
  const [folderPrefs, setFolderPrefs] = useState<FolderPrefs | null>(null);
  useEffect(() => { setFolderPrefs(loadFolderPrefs(browserStore(), foldersKey(currentUserId))); }, [currentUserId]);
  const changeFolderPrefs = (next: FolderPrefs) => { setFolderPrefs(next); saveFolderPrefs(browserStore(), foldersKey(currentUserId), next); };
  const changeView = (next: LibraryViewId) => { setAddress(viewPatch(next)); changeFolderPrefs({ view: next, open: folderPrefs?.open ?? {} }); };

  // ── the data: the whole library in one lean request ──
  const { data: listData, isLoading: docsLoading, isError: listFailed, error: listError, refetch } = useQuery({
    queryKey: ['gov-docs-workspace'],
    queryFn: fetchLibrary,
    retry: (failures, e) => failures < 3 && canRetry(e),                  // a refusal (403) is said at once; a network or server failure is tried a few times, as it always was
  });
  const allDocs: GovDoc[] = useMemo(() => listData?.items ?? [], [listData]);
  const leanServed = listData?.lean === true;
  // a lean list carries each document's attestation; an older server sends full rows without it, and the coverage map is asked as it always was
  const { data: coverageMap } = useQuery({ queryKey: ['gov-docs-coverage'], queryFn: fetchCoverage, enabled: !!listData && !leanServed });
  const coverage = useMemo(() => (leanServed ? coverageFromRows(allDocs) : coverageMap ?? { pct: {}, counts: {} }), [leanServed, allDocs, coverageMap]);
  const serverTotal = listData?.total;
  const cut = isCut(allDocs.length, serverTotal);
  const noList = listFailed && !listData;                        // the list could not be read at all: never drawn as an empty library
  const attnKind = filters.attention;
  const attn = useQuery({
    queryKey: ['gov-docs-attention', attnKind, attentionDepartment(filters)],
    queryFn: () => fetchAttention(attnKind as string, attentionDepartment(filters)),
    enabled: attnKind != null,
    retry: (failures, e) => failures < 3 && canRetry(e),
  });
  const attnIds = useMemo(() => (attn.data ? new Set(attn.data.ids) : null), [attn.data]);
  const attnWaiting = attnKind != null && attn.isPending;
  const attnFailed = attnKind != null && attn.isError && !attn.data;
  const { data: users = [] } = useQuery({
    queryKey: ['tenant-users-gov'],
    queryFn: async () => (await assetsApi.getTenantUsers()).data as Array<{ id: number; display_name: string; email?: string }>,
    staleTime: 5 * 60 * 1000,
  });
  // what waits for this person: the inbox the top bar already asks for (the same queries), never a count of nobody while it has not answered
  const { inbox } = useInbox();
  const waiting = useMemo(() => waitingForMe(inbox), [inbox]);

  // ── names the rules and the cells need ──
  const departmentName = useDepartmentNames();
  const frameworkInfo = useFrameworkInfo();
  const departmentsQ = useOrgDepartments();
  const departments = useMemo(() => departmentsQ.data ?? [], [departmentsQ.data]);
  const levelNames = useDepartmentLevels().data?.labels;           // what the organisation calls the three levels; the default names until they arrive
  const lookups = useMemo(
    () => ({
      departments: departmentName, departmentScope: departmentScopes(departments), departmentPaths: departmentPaths(departments),
      frameworks: frameworkInfo, coverage: coverage.pct, me: currentUserId ?? null,
    }),
    [departmentName, departments, frameworkInfo, coverage, currentUserId],
  );
  const counts = coverage.counts ?? NO_COUNTS;
  // the same instant for every rule until the list is read again
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [listData]);
  const matchCtx: MatchContext = useMemo(() => ({ ...lookups, now, attention: attnIds, waiting: waiting.ids }), [lookups, now, attnIds, waiting.ids]);

  // ── the layout: the list, a folder for each department, or the board ──
  const noDepartments = !departments.some((d) => d.is_active !== false);
  const view: LibraryViewId = chooseView({ address: viewParam, remembered: folderPrefs?.view ?? null, departments });
  const deciding = viewParam == null && (folderPrefs == null || (folderPrefs.view == null && departmentsQ.isLoading));
  const inFolders = view === 'folders';
  const inBoard = view === 'board';
  const waitingForData = docsLoading || deciding || (inFolders && departmentsQ.isLoading) || attnWaiting;
  const foldersBlocked = inFolders && !waitingForData && (departmentsQ.isError || noDepartments);
  const targets = useMemo(() => moveTargets(departments, levelNames), [departments, levelNames]);

  // ── the facets: one index of the documents, one pass for the matches and every live count ──
  const above = useMemo(() => departmentsAbove(departments), [departments]);
  const index = useMemo(() => indexDocuments(allDocs, { now, coverage: coverage.pct, above }, matchCtx), [allDocs, now, coverage.pct, above, matchCtx]);
  // the box shows every keystroke at once; the filtering of a library follows when React has a moment (a deferred value)
  const searched = useDeferredValue(filters.search);
  const applied = useMemo(() => (searched === filters.search ? filters : { ...filters, search: searched }), [filters, searched]);
  const result = useMemo(() => evaluate(index, chosenOf(applied), ruleOf(applied, matchCtx)), [index, applied, matchCtx]);
  const filteredDocs = result.matches as GovDoc[];
  const filtering = isFiltering(filters);
  const archivedList = filters.statuses.length === 1 && filters.statuses[0] === 'archived';
  const totals = useMemo(() => libraryCounts(allDocs), [allDocs]);
  const scope = useMemo(() => unlessArchivedAsked(allDocs, filters.statuses), [allDocs, filters.statuses]);
  const matchKey = useMemo(() => `${filteredDocs.length}:${filteredDocs.reduce((h, d) => (h * 31 + d.id) >>> 0, 7)}`, [filteredDocs]);
  const matchIds = useMemo(() => new Set(filteredDocs.map((d) => d.id)), [filteredDocs]);

  const railOpts = useMemo(
    () => railOptions({ docs: allDocs, people: users, departments, levelNames, frameworks: frameworkInfo }),
    [allDocs, users, departments, levelNames, frameworkInfo],
  );
  const chosen = chosenOf(filters);
  const groups: FacetGroupView[] = RAIL_ORDER.map((facet) => {
    const picked = chosen[facet] ?? [];
    const options = orderedOptions(facet, railOpts[facet], picked, (v) => countOf(result.counts, facet, v));
    return {
      key: facet, label: FACET_TITLE[facet], chosen: picked.length, searchable: SEARCHABLE.includes(facet), limit: RAIL_LIMIT[facet], defaultOpen: OPEN_AT_FIRST.includes(facet),
      options: options.map((o) => ({ value: o.value, label: o.label, title: o.title, indent: o.indent, count: countOf(result.counts, facet, o.value), checked: picked.includes(o.value) })),
    };
  });
  const toggleFacet = (facet: string, value: string) => {
    const key = facet as FacetKey;
    const cur = filters[key] as string[];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    setFilters({ ...filters, [key]: key === 'statuses' ? nextStatuses(cur, next) : next } as Filters);
  };
  const clearFacet = (facet: string) => setFilters({ ...filters, [facet]: [] } as Filters);

  // ── the quick views, with the number each would show ──
  const viewCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const v of views) out[v.id] = countMatching(index, chosenOf(v.state.filters), ruleOf(v.state.filters, matchCtx));
    return out;
  }, [views, index, matchCtx]);
  const activeView = viewMatching(views, page.state);
  const applyView = (v: SavedView) => setAddress(statePatch(v.state));
  const waitingNumber = waitingCount(waiting, allDocs);
  const quick: FilterChip[] = [
    ...(!activeView && filtering ? [{ key: 'custom', label: 'Custom filters', count: filteredDocs.length, active: true, title: 'Custom filters: press to clear them' }] : []),
    ...QUICK.map(([id, label]) => ({
      key: id, label, active: activeView?.id === id, count: id === 'waiting' ? waitingNumber : viewCounts[id] ?? 0,
      title: id === 'waiting' && waiting.state !== 'ready' ? waitingNote(waiting)?.title : undefined,
    })),
    ...(activeView && !QUICK.some(([id]) => id === activeView.id) ? [{ key: activeView.id, label: activeView.name, active: true, count: viewCounts[activeView.id] ?? 0 }] : []),
  ];
  const onQuick = (key: string) => {
    if (key === 'custom') { setFilters(NO_FILTERS); return; }
    const v = views.find((x) => x.id === key);
    if (v) applyView(v);
  };

  // ── saved views ──
  const [naming, setNaming] = useState(false);
  const saveView = (name: string) => {
    const next = [...saved, { id: newViewId(saved), name, state: page.state }];
    setSaved(next);
    saveViews(browserStore(), viewsKey(currentUserId), next);
    notify.success(`“${name}” is in your views.`, { title: 'View saved' });
  };
  const deleteView = async (v: SavedView) => {
    if (!(await confirm({ title: `Delete the view “${truncate(v.name, 60).text}”?`, message: 'Only the saved view goes; the documents and their filters are not touched.', confirmLabel: 'Delete view', tone: 'danger' }))) return;
    const next = saved.filter((x) => x.id !== v.id);
    setSaved(next);
    saveViews(browserStore(), viewsKey(currentUserId), next);
    notify.success('View deleted');
  };
  const viewItems: MenuItem[] = [
    ...BUILT_IN_VIEWS.map((v, i) => ({ key: `v:${v.id}`, label: v.name, checked: activeView?.id === v.id, radio: true, trailing: String(viewCounts[v.id] ?? 0), section: i === 0 ? 'Views' : undefined, onSelect: () => applyView(v) })),
    ...saved.map((v, i) => ({ key: `v:${v.id}`, label: v.name, checked: activeView?.id === v.id, radio: true, trailing: String(viewCounts[v.id] ?? 0), section: i === 0 ? 'Saved by you' : undefined, onSelect: () => applyView(v) })),
    { key: 'save', label: 'Save current filters as a view…', section: 'Manage', disabled: !filtering || !!activeView, reason: !filtering ? 'Filter or search first' : activeView ? 'This is already a view' : undefined, onSelect: () => setNaming(true) },
    ...saved.map((v) => ({ key: `del:${v.id}`, label: `Delete “${truncate(v.name, 40).text}”…`, danger: true, onSelect: () => { void deleteView(v); } })),
  ];

  // ── the list: a tree of documents, a page of its top rows ──
  const lookupsForSort = lookups;
  const sortedScope = useMemo(() => sortDocs(scope, sort, lookupsForSort), [scope, sort, lookupsForSort]);
  const folders = useMemo(() => {
    if (!inFolders || foldersBlocked || waitingForData) return null;
    return buildFolders({ scope: sortedScope, matches: matchIds, departments, filtering, now });
  }, [inFolders, foldersBlocked, waitingForData, sortedScope, matchIds, departments, filtering, now]);
  const roots = useMemo(() => buildTree(inFolders ? [] : sortedScope, matchIds), [inFolders, sortedScope, matchIds]);
  const entries = useMemo(() => (folders ? folderEntries(folders) : treeEntries(roots)), [folders, roots]);
  const at = useMemo(() => new Map(entries.map((e) => [e.doc.id, e])), [entries]);
  const top = useMemo(() => roots.map((n) => n.doc), [roots]);
  const parents = useMemo(() => entries.filter((e) => e.children.length > 0).map((e) => e.doc.id), [entries]);
  const ordered = useMemo(() => (folders ? displayOrder(folders) : sortDocs(filteredDocs, sort, lookupsForSort)), [folders, filteredDocs, sort, lookupsForSort]);

  // what the person closed, paged to and asked for belongs to one set of matches, one order and one page size: when they change, they start again
  const [fold, setFold] = useState<Fold>(NOTHING_OPEN);
  const [pageNo, setPageNo] = useState(1);
  const [shut, setShut] = useState<ReadonlySet<string>>(NO_KEYS);
  const [extra, setExtra] = useState<Record<string, number>>({});
  const viewKey = `${matchKey}|${sort.key}:${sort.dir}|${prefs.pageSize}`;
  const [seen, setSeen] = useState({ match: matchKey, view: viewKey });
  if (seen.view !== viewKey) {
    if (seen.match !== matchKey) { setFold((f) => ({ ...f, shut: new Set() })); setShut(NO_KEYS); }
    setPageNo(1);
    setExtra({});
    setSeen({ match: matchKey, view: viewKey });
  }
  const openOf = (id: number, f: Fold = fold) => openness(f, id, (at.get(id)?.children.length ?? 0) > 0, filtering);
  const toggleRow = (id: number, isOpen: boolean) => setFold((f) => flip(f, id, isOpen));
  const pages = Math.max(1, Math.ceil(top.length / prefs.pageSize));
  const pageClamped = Math.min(Math.max(1, pageNo), pages);
  const pageRows = useMemo(() => drawnRows(pageSlice(top, pageClamped, prefs.pageSize), at, openOf), [top, pageClamped, prefs.pageSize, at, fold, filtering]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── the folders (Folders view) ──
  const foldView: FoldView = { saved: folderPrefs?.open ?? {}, shut, filtering, docCount: filteredDocs.length };
  const applyFold = (change: FoldChange) => { if (filtering) setShut(change.shut); else changeFolderPrefs({ view: folderPrefs?.view ?? null, open: change.saved }); };
  const everyFolder = folders ? allFolders(folders) : [];
  const foldable = everyFolder.filter(expandable);
  const allFoldersOpen = foldable.every((n) => folderIsOpen(foldView, n.key));
  const toggleAllFolders = () => {
    const open = !allFoldersOpen;
    applyFold(setAllFolders(foldView, foldable.map((n) => n.key), open));
    setFold((f) => (open ? expandAll(f) : collapseAll(parents)));
  };

  // ── ticks, the cursor, the details ──
  const selection = useSelection(matchKey);
  const bulkActions = bulkActionsFor(canEdit, archivedList, true);
  const selectable = bulkActions.length > 0;
  const [cursor, setCursor] = useState<number | null>(null);
  const openDocRow = openId != null ? allDocs.find((d) => d.id === openId) ?? null : null;
  const missing = openId != null && !waitingForData && !listFailed && !openDocRow ? missingOpen({ id: openId, loaded: allDocs.length, total: serverTotal }) : null;
  const at0 = openDocRow ? ordered.findIndex((d) => d.id === openDocRow.id) : -1;
  const ticked = actionableIds(selection.selected, filteredDocs.map((doc) => ({ doc, match: true })));

  const listItems = useMemo((): { items: RecordItem<GovDoc>[]; drawn: number[] } => {
    if (inBoard || waitingForData) return { items: [], drawn: [] };
    if (folders) {
      const built = folderItems({
        folders, view: foldView, extra, uid, selectable, selected: selection.selected,
        rowsOf: (n, limit) => drawnRows(n.top.slice(0, limit), at, openOf),
        toggleRow,
        onTick: (ids) => selection.set((s) => toggleAll(s, ids)),
        onFlip: (key) => applyFold(flipFolder(foldView, key)),
        onMore: (n, step) => setExtra((e) => ({ ...e, [n.key]: (e[n.key] ?? 0) + step })),
        onFewer: (n) => setExtra((e) => { const next = { ...e }; delete next[n.key]; return next; }),
      });
      return { items: built.items, drawn: built.rows.map((r) => r.doc.id) };
    }
    return { items: recordRows(pageRows, 0, toggleRow), drawn: pageRows.map((r) => r.doc.id) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inBoard, waitingForData, folders, foldView.saved, folderPrefs, shut, filtering, filteredDocs.length, extra, uid, selectable, selection.selected, at, fold, pageRows]);
  const pageIds = listItems.items.filter((i) => i.kind === 'row' && !i.context).map((i) => (i as { id: number }).id);

  // ── handlers ──
  const openDoc = (id: number) => router.push(`/governance/documents/${id}`);
  const refreshAll = () => { REFRESH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] })); };
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
  const [assignOwnerFor, setAssignOwnerFor] = useState<number[] | null>(null);
  const [assignOwnerId, setAssignOwnerId] = useState<string>('');
  const [reviewDateFor, setReviewDateFor] = useState<number[] | null>(null);
  const [reviewDate, setReviewDate] = useState<string>('');
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
  const onBulkArchive = (ids: number[]) => { void askArchive(ids); };
  const onArchiveDoc = (doc: GovDoc) => { void askArchive([doc.id]); };
  const onRestoreDoc = (doc: GovDoc) => restore.mutate([doc.id]);
  const doAssignOwner = () => { if (assignOwnerFor && assignOwnerId) assignOwner.mutate({ ids: assignOwnerFor, owner: Number(assignOwnerId) }); };
  const doSetReviewDate = () => { if (reviewDateFor && reviewDate) setReviewOn.mutate({ ids: reviewDateFor, date: reviewDate }); };
  const runBulk = (id: BulkId, ids: number[]) => {
    switch (id) {
      case 'publish': return publish.mutate(ids);
      case 'assign-owner': return setAssignOwnerFor(ids);
      case 'set-review': return setReviewDateFor(ids);
      case 'archive': return onBulkArchive(ids);
      case 'restore': return restore.mutate(ids);
    }
  };

  // Move to…: one request for each document (the server checks who may change it, an archived document and a department that is switched off, and writes "Department changed"
  // in the Change log); ONE message says what happened, by how it went. The documents that moved leave the ticks, the ones that could not be moved stay ticked.
  const [moving, setMoving] = useState<{ ids: number[]; anchor: DOMRect | null } | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
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
  const pickTarget = async (target: MoveTarget) => {
    if (!moving || moveBusy) return;
    const ids = moving.ids;
    const tickedHere = ids.filter((id) => selection.selected.has(id));
    setMoveBusy(true);
    let failed: number[] = [];
    try {
      failed = await onMove(ids, target);
    } finally {
      setMoveBusy(false);
      setMoving(null);
    }
    const stay = tickedHere.filter((id) => failed.includes(id));
    selection.set((s) => { const next = new Set(s); ids.forEach((id) => next.delete(id)); stay.forEach((id) => next.add(id)); return next; });
    selection.keep(stay);
  };

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
      // /export serves the uploaded file when present, else a PDF of the markdown content, so every document (incl. content-only AI drafts) is downloadable
      const res = await governanceApi.exportDocument(doc.id);
      download(res.data as BlobPart, doc.has_file && doc.file_name ? doc.file_name : pdfName);
    } catch {
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
  const allParentsOpen = parents.every((id) => openOf(id) != null);
  // read when it is pressed, not when it was made: the rows' cells keep the function they were drawn with until the columns change
  const filtersNow = useRef(filters);
  filtersNow.current = filters;
  const pickFramework = (id: number) => {
    const key = String(id);
    const current = filtersNow.current;
    setFilters({ ...current, frameworks: current.frameworks.includes(key) ? current.frameworks.filter((f) => f !== key) : [...current.frameworks, key] });
  };

  // the file says what it holds: cut, its name says how many of the loaded documents and how many exist
  const exportDocs = (docs: readonly GovDoc[], name: string) => download(toCsv(docs, exportColumnsFor([]), lookups), name, 'text/csv;charset=utf-8');
  const exportCsv = () => exportDocs(ordered, csvName({ date: new Date().toISOString().slice(0, 10), shown: ordered.length, loaded: allDocs.length, total: serverTotal }));
  const exportSelection = () => {
    const picked = new Set(ticked);
    exportDocs(ordered.filter((d) => picked.has(d.id)), `document-library-${new Date().toISOString().slice(0, 10)}-selection.csv`);
  };

  const env: RowEnv = {
    lookups, now, info: frameworkInfo, preferFrameworks: filters.frameworks, compact: prefs.density === 'compact', onPeek: setOpenId, onPickFramework: pickFramework,
    rights: (d) => rowRights({ canEdit, canEditRow: mayChange, canArchiveRow: mayChange, canRestoreRow: mayRestore, canRestore: true }, d),
    canMove: (d) => !!targets.length && mayChange(d), onOpenDoc: openDoc, onEdit: onEditDoc, onDownload: onDownloadDoc, onArchive: onArchiveDoc, onRestore: onRestoreDoc,
    onMove: (d, anchor) => setMoving({ ids: [d.id], anchor: anchor ?? null }),
  };
  const columns = useMemo(() => documentColumns(env), [env.lookups, env.now, env.info, env.preferFrameworks, env.compact]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the keyboard: "/" searches, j and k move the cursor, Enter opens it, Escape clears the ticks
  const searchRef = useRef<HTMLInputElement>(null);
  useExplorerKeys({
    onSearch: () => searchRef.current?.focus(),
    onMove: (dir) => setCursor((c) => moveCursor(listItems.drawn, c, dir)),
    onOpen: () => { if (cursor != null) setOpenId(cursor); },
    onEscape: () => { if (selection.selected.size > 0) selection.clear(); },
  }, !inBoard);
  useEffect(() => {
    if (cursor != null) document.querySelector(`[data-record-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // ── what the page says ──
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
  const label = routeFor('/governance/documents')?.label ?? 'Documents';
  const noun = { one: 'document', other: 'documents' };
  const scopeCount = archivedList ? totals.archived : totals.all;
  const nothing = noMatch(allDocs.length, serverTotal);
  const empty = allDocs.length === 0 ? (
    <EmptyState kind="firstUse" bare icon={FileText} title="No documents yet"
      action={create === 'buttons' ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onNewDocument}>New document</Button> : undefined} />
  ) : archivedList && !filtering ? (
    <EmptyState kind="firstUse" bare icon={Archive} title="Nothing archived" />
  ) : (
    <EmptyState kind="noMatches" bare title={nothing.title} description={nothing.description} onClearFilters={filtering ? () => setFilters(NO_FILTERS) : undefined} />
  );
  const notice = loadedNotice(allDocs.length, serverTotal);
  const waitNote = filters.waiting ? waitingNote(waiting) : null;
  const words = exportWords({ shown: filteredDocs.length, loaded: allDocs.length, total: serverTotal, canExport: filteredDocs.length > 0 });
  const chips = filterChips(filters, {
    types: railOpts.types, statuses: railOpts.statuses, owners: railOpts.owners, departments: railOpts.departments, frameworks: railOpts.frameworks, classifications: railOpts.classifications,
  }, { attentionTotal: attn.data?.total ?? null });
  const filterCountNow = chips.length;

  const sortItems: MenuItem[] = [
    ...SORT_KEYS.map((k, i) => ({
      key: `sort:${k}`, label: SORT_LABEL[k], checked: sort.key === k, radio: true, section: i === 0 ? 'Sort by' : undefined,
      trailing: sort.key === k ? (sort.dir === 'asc' ? '↑ ascending' : '↓ descending') : undefined, onSelect: () => setSort(nextSort(sort, k)),
    })),
    { key: 'dens:comfortable', label: 'Comfortable (two lines)', checked: prefs.density === 'comfortable', radio: true, section: 'Rows', onSelect: () => changePrefs({ ...prefs, density: 'comfortable' as Density }) },
    { key: 'dens:compact', label: 'Compact (one line)', checked: prefs.density === 'compact', radio: true, onSelect: () => changePrefs({ ...prefs, density: 'compact' as Density }) },
  ];

  const bulkDefs: BulkActionDef[] = bulkActions.map((a) => ({ id: a.id, label: a.label, icon: BULK_ICON[a.id], danger: a.danger, onRun: () => runBulk(a.id, ticked) }));
  const bulkMore: MenuItem[] = [
    { key: 'move', label: 'Move to…', icon: FolderInput, hidden: archivedList || !canEdit || targets.length === 0, onSelect: () => setMoving({ ids: ticked, anchor: document.activeElement instanceof HTMLElement ? document.activeElement.getBoundingClientRect() : null }) },
    { key: 'export', label: 'Export selection', icon: Download, onSelect: exportSelection },
  ];

  const sortState = { key: sort.key, dir: sort.dir };
  const loading = waitingForData;
  const selectionApi = selectable ? {
    ticked: selection.selected,
    onToggle: (id: number) => selection.set((s) => toggleOne(s, id)),
    state: tickState(selection.selected, pageIds),
    onToggleAll: () => selection.set((s) => toggleAll(s, pageIds)),
    headLabel: inFolders ? 'Select the documents shown' : 'Select all documents on this page',
    rowLabel: (d: GovDoc) => `Select ${truncate(d.title, 60).text}`,
  } : undefined;

  const body = (() => {
    if (noList) return <ErrorState title="Couldn't load the documents" message={errorMessage(listError)} onRetry={canRetry(listError) ? () => { void refetch(); } : undefined} />;
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={10} columns={5} label="Loading the documents" /></div>;
    if (foldersBlocked) {
      return <div className="rounded-ds-card border border-ds-border bg-ds-surface">{departmentsQ.isError ? <DepartmentsFailed onRetry={() => departmentsQ.refetch()} /> : <NoDepartments />}</div>;
    }
    if (attnFailed && attnKind) {
      return <ErrorState title={`Couldn't load “${ATTENTION_LABEL[attnKind]}”`} message={errorMessage(attn.error)} onRetry={canRetry(attn.error) ? () => { void attn.refetch(); } : undefined} />;
    }
    if (filteredDocs.length === 0) return <div className="rounded-ds-card border border-ds-border bg-ds-surface">{empty}</div>;
    if (inBoard) {
      const board = groupDocuments(ordered, archivedList);
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <BoardColumns
            label="Documents by status"
            columns={board}
            getId={(d: GovDoc) => d.id}
            activeId={openId}
            cardLabel={(d: GovDoc) => d.title}
            onOpen={(d: GovDoc) => setOpenId(d.id)}
            onShowAll={(column) => { setFilters({ ...filters, statuses: statusesOfColumn(column, filteredDocs) }); changeView('table'); }}
            renderCard={(d: GovDoc) => (
              <>
                <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{d.title}</span>
                <span className="truncate text-ds-label text-ds-fg-muted">{[d.document_code, d.owner_name || 'Unassigned'].filter(Boolean).join(' · ')}</span>
              </>
            )}
          />
        </div>
      );
    }
    const cutNoun = pagerNoun(cut);
    const nested = entries.filter((e) => e.depth > 0).length;
    return (
      <>
        {inFolders && folders ? (
          <FoldersToolbar
            allOpen={allFoldersOpen}
            canFold={foldable.length > 0}
            onToggleAll={toggleAllFolders}
            folders={everyFolder.length}
            documents={filteredDocs.length}
            loaded={allDocs.length}
            total={serverTotal}
          />
        ) : null}
        <RecordTable
          caption={inFolders ? 'Documents by department' : 'Documents'}
          columns={columns}
          items={listItems.items}
          sort={sortState}
          onSort={(key) => setSort(nextSort(sort, key as SortKey))}
          selection={selectionApi}
          activeId={openId}
          cursorId={cursor}
          onActivate={(d) => setOpenId(d.id)}
          actions={(d) => <RowMenu doc={d} env={env} />}
          card={(row) => <DocumentCard row={row} env={env} />}
          compact={prefs.density === 'compact'}
          maxHeight={MAX_HEIGHT}
        />
        {!inFolders && (
          <Pager
            className="mt-[8px]"
            page={pageClamped}
            pageSize={prefs.pageSize}
            total={top.length}
            onPage={setPageNo}
            onPageSize={(pageSize) => changePrefs({ ...prefs, pageSize })}
            pageSizes={PAGE_SIZES}
            noun={`${cutNoun}${nested === 0 ? '' : ` · +${nested} nested`}`}
          />
        )}
      </>
    );
  })();

  const viewOptions = [{ value: 'table', label: 'List' }, { value: 'folders', label: 'Folders' }, { value: 'board', label: 'Board' }];
  const head = (
    <PageHeader
      variant="page"
      title={label}
      info="Policies, standards and procedures: who owns them, when they are due for review and the frameworks they cover."
      meta={noList || docsLoading ? undefined : `${headCount({ inList: scopeCount, loaded: allDocs.length, total: serverTotal })}${updatedLabel ? ` · ${updatedLabel}` : ''}`}
      actions={(
        <>
          {create === 'studio-off' && <span className="shrink-0 text-ds-label text-ds-fg-muted">Creating documents needs the Comply AI Studio.</span>}
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
  );

  return (
    <>
      <RecordExplorer
        label={label}
        noun={noun}
        head={head}
        notices={(
          <>
            {listFailed && !noList && (
              // the list was read once and a later read failed (after a change, say): what is on screen is the last answer, and it says so
              <ErrorState compact title="Couldn't refresh the documents" message={`${errorMessage(listError)} What is shown may be out of date.`} onRetry={canRetry(listError) ? () => { void refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
            )}
            {notice && <ListNotice title={notice.title}>{notice.detail}</ListNotice>}
            {waitNote && <ListNotice title={waitNote.title}>{waitNote.detail}</ListNotice>}
            {missing && (
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1"><ListNotice title={missing.title}>{missing.detail}</ListNotice></div>
                <div className="flex shrink-0 gap-2">
                  <Button href={`/governance/documents/${openId}`}>Open its page</Button>
                  <Button variant="ghost" onClick={() => setOpenId(null)}>Dismiss</Button>
                </div>
              </div>
            )}
          </>
        )}
        quick={noList || loading ? [] : quick}
        onQuick={onQuick}
        quickLabel="Quick views"
        quickExtra={noList || loading ? undefined : <Menu label="Views" items={viewItems} />}
        search={filters.search}
        onSearch={(q) => setFilters({ ...filters, search: q })}
        searchLabel="Search documents by title, code, owner, department or framework"
        searchRef={searchRef}
        views={{ label: 'Library view', name: `${uid}-view`, options: viewOptions, value: view, onChange: (v) => changeView(v as LibraryViewId) }}
        actions={(
          <>
            {!inBoard && !inFolders && parents.length > 0 && !loading && (
              <Button className="max-md:hidden" variant="ghost" onClick={() => setFold(allParentsOpen ? collapseAll(parents) : expandAll(fold))} leftIcon={allParentsOpen ? <ChevronsDownUp aria-hidden /> : <ChevronsUpDown aria-hidden />}>
                <span className="max-lg:sr-only">{allParentsOpen ? 'Collapse all' : 'Expand all'}</span>
              </Button>
            )}
            {!inBoard && <Menu label="Sort" items={sortItems} />}
            <Button leftIcon={<Download aria-hidden />} onClick={exportCsv} disabled={filteredDocs.length === 0 || loading} title={words.title}>
              <span className="max-md:sr-only">{words.label}</span>
            </Button>
          </>
        )}
        groups={groups}
        onToggle={toggleFacet}
        onClear={clearFacet}
        onClearAll={() => setFilters(NO_FILTERS)}
        filtering={filterCountNow}
        railHead={currentUserId != null ? (
          <Checkbox label="Mine" checked={filters.mine} onChange={(e) => setFilters({ ...filters, mine: e.target.checked })} />
        ) : undefined}
        shown={filteredDocs.length}
        applied={loading || noList ? null : (
          <AppliedFilters
            chips={chips.map((c) => ({ key: c.key, label: c.label }))}
            summary={`${filteredDocs.length.toLocaleString('en-US')} of ${scopeCount.toLocaleString('en-US')} ${scopeCount === 1 ? 'document' : 'documents'}`}
            onRemove={(key) => { const chip = chips.find((c) => c.key === key); if (chip) setFilters(removeChip(filters, chip)); }}
            onClear={() => setFilters(NO_FILTERS)}
            onSave={!activeView && filtering ? () => setNaming(true) : undefined}
          />
        )}
        body={body}
        bulk={selectable && !loading && ticked.length > 0 ? (
          <BulkBar
            count={ticked.length}
            matching={filteredDocs.length}
            onSelectAll={() => selection.set(selectAllMatching(filteredDocs.map((d) => d.id)))}
            onClear={selection.clear}
            actions={bulkDefs}
            more={bulkMore}
          />
        ) : undefined}
        detail={(
          <DocumentDetail
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
            canRestore={openDocRow ? mayRestore(openDocRow) : false}
            onStep={(dir) => { const next = ordered[at0 + dir]; if (next) setOpenId(next.id); }}
            hasPrev={at0 > 0}
            hasNext={at0 >= 0 && at0 < ordered.length - 1}
          />
        )}
        ready={!loading && !noList}
      />

      {/* Bulk: assign owner */}
      <RightSlidePanel
        isOpen={assignOwnerFor != null}
        onClose={() => setAssignOwnerFor(null)}
        title={`Assign owner · ${assignOwnerFor?.length ?? 0} ${assignOwnerFor?.length === 1 ? 'document' : 'documents'}`}
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
        title={`Set review date · ${reviewDateFor?.length ?? 0} ${reviewDateFor?.length === 1 ? 'document' : 'documents'}`}
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

      <SaveViewPanel open={naming} existing={saved.map((v) => v.name)} onClose={() => setNaming(false)} onSave={saveView} />

      {moving && (
        <MovePopover
          anchor={moving.anchor}
          targets={targets}
          current={commonDepartment(moving.ids.map((id) => byId(id)).filter((d): d is GovDoc => !!d))}
          count={moving.ids.length}
          busy={moveBusy}
          onPick={pickTarget}
          onClose={() => setMoving(null)}
        />
      )}

      {/* Row Edit: the document page's Details popup */}
      {details && <DetailsDialog doc={details} open onClose={() => setDetails(null)} canEdit={mayChange(details)} onSaved={refreshAll} />}

      {/* Archive, and deleting a saved view, ask first */}
      {confirmDialog}
    </>
  );
}
