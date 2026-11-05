'use client';

// Governance > Documents > Exceptions: request, review and manage them. On the design-system kit (components/ui/ds): PageHeader variant="page",
// RegisterTable (a table from 768px, cards below), Pager, Menu for a row's actions, StatusPill, PersonChip, FormField and the controls, drawers that
// ask "Discard changes?", useConfirm for deleting and useReportedMutation for every write (the server's answer is said, and a refusal in its own words).
// Three views, kept in the address with the filters (_logic.ts ADDRESS: ?view=unit|document, absent is the list): the List (with a Unit and a Document column
// and filters for the unit, with everything under it, and the kind of document), By unit (the tree of units with rolled-up counts; a press opens the list of
// that unit) and By document (the units as folders, their documents, and each document's exceptions; a press opens the exception).
// The list the server sends is cut at 100 and carries no total: this page says so, shows how many there are in all (the analytics' counts) and what its
// search, sort and CSV work on (_logic.ts: serverList, cutNotice). The writes are in the pieces below; what each sends is unchanged.
// An exception that goes through an approval rule (Governance > Settings > Exception approvals) says which step it is at and who it waits for, is decided
// by the people its open step asks (approve, ask for changes, reject: what the step allows) and can be withdrawn; "Waiting for me" lists the ones that wait
// for the person to decide and, once approved, to implement ("Decide" / "Implement"). An alert's link (?open=12) opens that exception, whether or not its
// row is on the loaded page. One with no rule is decided as it always was.
//   _ExceptionForm.tsx   raise / change (drawer)       _ExceptionDetails.tsx  details, approval, comments, move to risk register (drawer)
//   _ApprovalPanel.tsx   the approval under a rule      _Decision.tsx          approve / ask for changes / reject / revoke
//   _Suggest.tsx         suggest exceptions (AI, opt-in)       _Summary.tsx  the three cards       _approval.ts  what is said about the approval (pure)
//   _UnitTree.tsx        By unit       _DocumentTree.tsx  By document       _DocumentPicker.tsx  the form's document picker       _assistOwner.tsx  the form's AI helpers
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Ban, Check, Download, Eye, MessageSquare, Pencil, Plus, Search, Send, Shield, Sparkles, Trash2, Undo2, X, XCircle } from 'lucide-react';
import { assetsApi, governanceApi, policyExceptionApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { EMPTY, truncate } from '@/lib/format';
import { exceptionStatus, priority as priorityStatus, statusPill } from '@/lib/status';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, IconButton, Menu, Notice, Pager, PersonChip, RegisterTable, SegmentedControl, Select, StatusPill, TextInput, useAddressState, useConfirm, useNotify,
  useReportedMutation, type MenuItem, type RegisterColumn, type SortState,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ListNotice } from '@/components/governance/ListNotice';
import { DepartmentSelect } from '@/components/governance/DepartmentSelect';
import { useAdminDepartments } from '@/components/admin/DepartmentForm';
import {
  ADDRESS, DATA_COLS, DEFAULT_PAGE_SIZE, DOC_TYPES, PAGE_SIZES, VIEW_OPTIONS, WIDE_WINDOW, countLabel, csvDone, cutNotice, dayText, departmentOf, documentOf, emptyForm, formForPolicy, formFrom, itemsOf,
  hiddenColumns, listParams, momentDay, openIdOf, pagerOf, longRefusal, requesterOf, rowActionKeys, searchExceptions, serverList, sortLoaded, toCsv, toggleHidden, unitChipText, unitPathOf,
  waitingLabel, waitingRows, withoutOpen,
  type DataCol, type DocumentOption, type ExceptionForm, type Filters, type RowActionKey,
} from './_logic';
import { statusDetail } from './_approval';
import { BY_DOCUMENT_KEY, BY_UNIT_KEY, LIST_KEYS, type AssetOption, type ByDocumentAnswer, type ByUnitAnswer, type ExceptionAnalytics, type ExceptionItem } from './_types';
import { ColumnsMenu } from './_ColumnsMenu';
import { TypeChip, WaitingChip } from './_chips';
import { DecisionDialog, type DecisionKind } from './_Decision';
import { DocumentTree } from './_DocumentTree';
import { ExceptionDetailsDrawer } from './_ExceptionDetails';
import { ExceptionFormDrawer } from './_ExceptionForm';
import { SuggestDialog } from './_Suggest';
import { Summary } from './_Summary';
import { UnitTree } from './_UnitTree';

const STATUS_OPTIONS = exceptionStatus.words.map((w) => ({ value: w, label: exceptionStatus.label(w) }));
const PRIORITY_OPTIONS = ['critical', 'high', 'medium', 'low'].map((w) => ({ value: w, label: priorityStatus.label(w) }));
const TOGGLEABLE = ['document', 'unit', 'status', 'priority', 'type', 'requester', 'created', 'expiry'];

/** Downloaded as `<name>.csv`; the text is toCsv's. */
function downloadCsv(name: string, cols: DataCol<ExceptionItem>[], rows: ExceptionItem[]) {
  const url = URL.createObjectURL(new Blob([toCsv(cols, rows)], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

type FormState = { exception: ExceptionItem | null; initial: ExceptionForm; id: number };

/** Whether the window is at least `px` wide (a media query, kept up to date as it is resized); the first render says yes, the wide layout the page was written for. */
function useAtLeast(px: number): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(`(min-width: ${px}px)`);
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => window.matchMedia(`(min-width: ${px}px)`).matches,
    () => true,
  );
}

/** The status, and under an approval rule the step it is at and who it waits for (what a draft sent back says too). Nothing more for one decided as it always was.
 *  A row of "Waiting for me" also says what it waits for: Decide or Implement. */
function StatusCell({ exception: e }: { exception: ExceptionItem }) {
  const detail = statusDetail(e);
  return (
    <div className="flex min-w-0 flex-col items-start gap-[2px]">
      <StatusPill size="sm" {...statusPill(exceptionStatus, e.status)} />
      <WaitingChip kind={e.waiting_kind} />
      {detail?.step && <span className="text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{detail.step}</span>}
      {detail?.waiting && <span className="line-clamp-2 text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]" title={detail.waiting}>{detail.waiting}</span>}
    </div>
  );
}

/** The document it is about: its title, with its kind and code under it; a document the person may not open is named so, never numbered. */
function DocumentCell({ exception: e }: { exception: ExceptionItem }) {
  const d = documentOf(e);
  if (!d) return <span className="text-ds-fg-muted">Not set</span>;
  return (
    <div className="flex min-w-0 flex-col items-start gap-[2px]">
      <span className={clsx('line-clamp-2', d.hidden && 'text-ds-fg-muted')} title={d.title}>{d.title}</span>
      {(d.type || d.code) && (
        <span className="flex flex-wrap items-center gap-[6px]">
          <TypeChip type={e.document_type} />
          {d.code && <span className="text-ds-label text-ds-fg-muted">{d.code}</span>}
        </span>
      )}
    </div>
  );
}

/** The unit it is raised for, from the top down; says when it is its document's (none was chosen for the exception itself). */
function UnitCell({ exception: e }: { exception: ExceptionItem }) {
  const u = departmentOf(e);
  if (!u) return <span className="text-ds-fg-muted">Not set</span>;
  return (
    <div className="flex min-w-0 flex-col items-start gap-[2px]">
      <span className="line-clamp-2" title={u.text}>{u.text}</span>
      {u.inherited && <span className="text-ds-label text-ds-fg-muted">From the document</span>}
    </div>
  );
}

export default function ExceptionsPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:policy_exceptions:create');
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();

  // the view and the filters are in the address: a link, a reload and Back land where the person was
  const [address, setAddress] = useAddressState(ADDRESS);
  const { view, q: searchTerm, status: statusFilter, priority: priorityFilter, unit: unitFilter, doctype: docTypeFilter, waiting: waitingOnly } = address;
  const [sort, setSort] = useState<SortState>(null);
  const [pickedCols, setPickedCols] = useState<string[] | null>(null);       // the columns the person left out in the Columns menu; null until they choose
  const hiddenCols = hiddenColumns(pickedCols, useAtLeast(WIDE_WINDOW));    // until then a narrow window leaves out the least used ones: there is no room for the title beside all ten
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [form, setForm] = useState<FormState | null>(null);
  const [viewing, setViewing] = useState<ExceptionItem | null>(null);       // the row that was opened: shown at once, then read again from the server
  const [wanted, setWanted] = useState<number | null>(null);                // an exception an alert's link asked for (?open=), or one pressed in By document
  const [deciding, setDeciding] = useState<{ kind: DecisionKind; exception: ExceptionItem } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  useEffect(() => { setPageNo(1); }, [searchTerm, statusFilter, priorityFilter, unitFilter, docTypeFilter, pageSize, sort, waitingOnly, view]);

  // An alert's link (/governance/exceptions?open=12) opens that exception. The link is used up once it has been taken: the address is cleaned (and the same
  // alert opens it again when it is pressed again). The other names of the address are the page's own (useAddressState) and are left as they are.
  const openId = openIdOf(useSearchParams()?.toString());
  useEffect(() => {
    if (openId === null) return;
    setViewing(null);
    setWanted(openId);
    window.history.replaceState(null, '', window.location.pathname + withoutOpen(window.location.search) + window.location.hash);
  }, [openId]);

  // the unit filter's names: the chip says it, and "Waiting for me" (which the server does not filter) is narrowed by its path
  const departments = useAdminDepartments();
  const unitPath = useMemo(() => unitPathOf(departments.data, unitFilter ? Number(unitFilter) : null), [departments.data, unitFilter]);
  const unitName = unitPath.length > 0 ? unitPath[unitPath.length - 1] : null;
  const filters: Filters = { status: statusFilter, priority: priorityFilter, unit: unitFilter, documentType: docTypeFilter, unitPath };

  // ── what the server sends ──
  const list = useQuery({
    queryKey: ['policy-exceptions', 'list', statusFilter, priorityFilter, unitFilter, docTypeFilter],
    queryFn: async () => itemsOf<ExceptionItem>((await policyExceptionApi.getAll(listParams(filters))).data),
    enabled: view === 'list',
    placeholderData: keepPreviousData,
    retry: (n, e) => n < 2 && canRetry(e),                          // a refusal (403) is not tried again: it is said at once
  });
  // the ones that wait for this person to decide, or to implement once approved (under an approval rule); it shares the list's refresh: a key that starts with 'policy-exceptions'
  const waiting = useQuery({
    queryKey: ['policy-exceptions', 'waiting-for-me'],
    queryFn: async () => itemsOf<ExceptionItem>((await policyExceptionApi.waitingForMe()).data),
    retry: (n, e) => n < 2 && canRetry(e),
  });
  // the two trees are asked for only when they are shown
  const byUnit = useQuery({
    queryKey: BY_UNIT_KEY,
    queryFn: async () => (await policyExceptionApi.getByUnit()).data as ByUnitAnswer,
    enabled: view === 'unit',
    retry: (n, e) => n < 2 && canRetry(e),
  });
  const byDocument = useQuery({
    queryKey: BY_DOCUMENT_KEY,
    queryFn: async () => (await policyExceptionApi.getByDocument()).data as ByDocumentAnswer,
    enabled: view === 'document',
    retry: (n, e) => n < 2 && canRetry(e),
  });
  // the exception whose details are open, read from the server as it is now (what was decided a moment ago, who it waits for): the row opened shows at once
  const shownId = viewing?.id ?? wanted;
  const one = useQuery({
    queryKey: ['policy-exceptions', 'one', shownId],
    queryFn: async () => (await policyExceptionApi.getById(shownId as number)).data as ExceptionItem,
    enabled: shownId !== null,
    initialData: viewing ?? undefined,
    gcTime: 0,
    retry: (n, e) => n < 2 && canRetry(e),
  });
  const shown = shownId !== null ? one.data ?? null : null;
  const linkFailed = wanted !== null && viewing === null && shown === null && one.isError;
  const analytics = useQuery({
    queryKey: ['policy-exceptions-analytics'],
    queryFn: async () => (await policyExceptionApi.getAnalytics()).data as ExceptionAnalytics,
    retry: (n, e) => n < 2 && canRetry(e),
  });
  // the pickers' lists are needed only once the form or the suggestions are opened; any kind of document can be the subject of an exception
  const needPickers = form !== null || suggesting;
  const documents = useQuery({
    queryKey: ['governance-documents-list'],
    queryFn: async () => itemsOf<DocumentOption>((await governanceApi.getDocuments({ limit: 500 })).data),
    enabled: needPickers,
  });
  const assets = useQuery({
    queryKey: ['assets-for-exception-link'],
    queryFn: async () => itemsOf<AssetOption>((await assetsApi.getAll({ limit: 500 })).data),
    enabled: form !== null,
  });

  // ── what is loaded, what the server holds, what is shown ──
  const inList = view === 'list';
  const current = waitingOnly ? waiting : list;                       // "Waiting for me" lists what the server says waits for the person (never cut); the filters narrow it here
  const loaded = waitingOnly ? waitingRows(waiting.data ?? [], filters) : list.data ?? [];
  const settled = useRef(filters);                                    // while the rows of the previous filters are still on screen the counts are theirs
  if (!list.isPlaceholderData) settled.current = filters;
  const server = waitingOnly ? { cut: false, total: loaded.length } : serverList(loaded.length, settled.current, analytics.data);
  const failed = current.isError && !current.data;
  const searching = searchTerm.trim() !== '';
  const matches = searchExceptions(loaded, searchTerm);
  const sorted = sortLoaded(matches, sort);
  const pager = pagerOf(sorted.length, pageNo, pageSize);
  const pageRows = sorted.slice(pager.start, pager.end);
  const notice = failed || current.isLoading ? null : cutNotice(loaded.length, server, settled.current);

  // ── writes made from the register ──
  // a rule that cannot start names every step nobody can act at: when the server's sentence is longer than a toast keeps, it is said in full under the header
  const [refusal, setRefusal] = useState<string | null>(null);
  const submit = useReportedMutation({
    mutationFn: (e: ExceptionItem) => policyExceptionApi.submit(e.id),
    success: 'Submitted for approval',
    failure: 'Not submitted',
    invalidate: LIST_KEYS,
    onSuccess: () => setRefusal(null),
    onError: (error) => setRefusal(longRefusal(error)),
  });
  const remove = useReportedMutation({
    mutationFn: (e: ExceptionItem) => policyExceptionApi.delete(e.id),
    success: 'Exception deleted',
    failure: 'Not deleted',
    invalidate: LIST_KEYS,
  });
  const askDelete = async (e: ExceptionItem) => {
    if (await confirm({ title: 'Delete this exception?', message: truncate(e.title, 120).text, confirmLabel: 'Delete exception', tone: 'danger' })) remove.mutate(e);
  };
  const withdraw = useReportedMutation({
    mutationFn: (e: ExceptionItem) => policyExceptionApi.withdraw(e.id),
    success: 'Withdrawn: it is a draft again',
    failure: 'Not withdrawn',
    invalidate: [...LIST_KEYS, ['exception-comments']],
  });
  const askWithdraw = async (e: ExceptionItem) => {
    if (await confirm({ title: 'Withdraw this exception?', message: 'It goes back to a draft. When it is submitted again its rule starts from the first step.', confirmLabel: 'Withdraw' })) withdraw.mutate(e);
  };

  const openNew = (initial: ExceptionForm = emptyForm()) => setForm({ exception: null, initial, id: Date.now() });
  const openEdit = (e: ExceptionItem) => setForm({ exception: e, initial: formFrom(e), id: Date.now() });
  const raiseFor = (documentId: number, opts?: { title?: string; justification?: string; priority?: string }) => { setSuggesting(false); openNew(formForPolicy(documentId, opts)); };
  const clearAll = () => setAddress({ q: '', status: '', priority: '', unit: '', doctype: '', waiting: false });
  const openRow = (e: ExceptionItem) => { setWanted(null); setViewing(e); };
  const openById = (id: number) => { setViewing(null); setWanted(id); };               // a row of By document: only its number is known, so it is read from the server
  const closeDetails = () => { setViewing(null); setWanted(null); };

  // A press on a unit (or one of its counts) in By unit shows the list of that unit and everything under it, and moves focus to it (the tree it came from is gone).
  const results = useRef<HTMLDivElement>(null);
  const focusResults = useRef(false);
  useEffect(() => { if (view === 'list' && focusResults.current) { focusResults.current = false; results.current?.focus(); } }, [view]);
  const openUnit = (id: number) => {
    focusResults.current = true;
    setAddress({ view: 'list', unit: String(id), status: '', priority: '', doctype: '', waiting: false, q: '' }, { push: true });
  };

  // The ⋯ menu of a row: what the server lets the person do with it (rowActionKeys), never more.
  const actionsOf = (e: ExceptionItem) => {
    const allowed = rowActionKeys(e);
    const items: Array<MenuItem & { key: RowActionKey }> = [
      { key: 'view', label: 'Details', icon: Eye, onSelect: () => openRow(e) },
      { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => openEdit(e) },
      { key: 'submit', label: 'Submit for approval', icon: Send, onSelect: () => submit.mutate(e), disabled: submit.isPending },
      { key: 'approve', label: 'Approve', icon: Check, onSelect: () => setDeciding({ kind: 'approve', exception: e }) },
      { key: 'changes', label: 'Ask for changes', icon: MessageSquare, onSelect: () => setDeciding({ kind: 'changes', exception: e }) },
      { key: 'reject', label: 'Reject', icon: XCircle, danger: true, onSelect: () => setDeciding({ kind: 'reject', exception: e }) },
      { key: 'withdraw', label: 'Withdraw', icon: Undo2, onSelect: () => { void askWithdraw(e); }, disabled: withdraw.isPending },
      { key: 'revoke', label: 'Revoke', icon: Ban, onSelect: () => setDeciding({ kind: 'revoke', exception: e }) },
      { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => { void askDelete(e); } },
    ];
    return <Menu label={`Actions for ${truncate(e.title, 60).text}`} iconOnly items={items.map((i) => ({ ...i, hidden: !allowed.includes(i.key) }))} />;
  };

  // The columns in the order the table has always had, with the document and the unit after the title; the narrower the window, the fewer (Document, Unit,
  // Type, Requester and Created go below 1024px, Expiry below 768px, where each exception is a card with the same facts as lines).
  const columns: RegisterColumn<ExceptionItem>[] = [
    { key: 'title', header: 'Title', isRowHeader: true, sortable: true, cell: (e) => <span className="line-clamp-2 font-[600] text-ds-fg" title={e.title}>{e.title}</span> },
    { key: 'document', header: 'Document', priority: 3, sortable: true, width: 'w-[176px]', card: 'meta', cell: (e) => <DocumentCell exception={e} /> },
    { key: 'unit', header: 'Unit', priority: 3, sortable: true, width: 'w-[144px]', card: 'meta', cell: (e) => <UnitCell exception={e} /> },
    { key: 'status', header: 'Status', sortable: true, width: 'w-[152px]', card: 'meta', cell: (e) => <StatusCell exception={e} /> },
    { key: 'priority', header: 'Priority', sortable: true, width: 'w-[96px]', card: 'meta', cell: (e) => <StatusPill size="sm" {...statusPill(priorityStatus, e.priority)} /> },
    {
      key: 'type', header: 'Type', priority: 3, sortable: true, width: 'w-[120px]', card: 'meta',
      cell: (e) => (e.exception_type_label ? <span className="line-clamp-2" title={e.exception_type_label}>{e.exception_type_label}</span> : <span className="text-ds-fg-muted">Not set</span>),
    },
    { key: 'requester', header: 'Requester', priority: 3, width: 'w-[128px]', card: 'meta', cell: (e) => <PersonChip name={requesterOf(e)} emptyLabel={EMPTY} /> },
    { key: 'created', header: 'Created', priority: 3, sortable: true, width: 'w-[100px]', cell: (e) => <span className="whitespace-nowrap tabular-nums">{momentDay(e.created_at)}</span> },
    {
      key: 'expiry', header: 'Expiry', priority: 2, sortable: true, width: 'w-[100px]', card: 'meta',
      cell: (e) => <span className={`whitespace-nowrap tabular-nums ${e.expiry_date ? '' : 'text-ds-fg-muted'}`}>{dayText(e.expiry_date)}</span>,
    },
    { key: 'actions', header: 'Actions', align: 'right', width: 'w-[56px]', cell: actionsOf },
  ];
  const visible = columns.filter((c) => !hiddenCols.includes(c.key));
  const toggleCol = (key: string) => { setPickedCols(toggleHidden(hiddenCols, key)); if (sort?.key === key) setSort(null); };

  const exportCsv = () => {
    // the columns the person switched off in the menu are not exported; the ones a narrow window leaves out on its own are (the file does not depend on the window)
    const cols = columns.filter((c) => c.key in DATA_COLS && !(pickedCols ?? []).includes(c.key)).map((c) => ({ id: c.key, ...DATA_COLS[c.key as keyof typeof DATA_COLS] }));
    downloadCsv('exceptions', cols, sorted);
    notify.success(csvDone(sorted.length, loaded.length, server));
  };

  const anyFilter = Boolean(statusFilter || priorityFilter || unitFilter || docTypeFilter || waitingOnly);
  const firstUse = loaded.length === 0 && !anyFilter;
  const empty = firstUse ? (
    <EmptyState kind="firstUse" bare icon={Shield} title="No exceptions yet"
      action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => openNew()}>New exception</Button> : undefined} />
  ) : (
    <EmptyState kind="noMatches" bare title="No matches" onClearFilters={clearAll} />
  );

  // what the header counts: the list's rows, or everything the tree shows
  const total = view === 'unit' ? byUnit.data?.totals.total : view === 'document' ? byDocument.data?.total : undefined;
  const meta = inList
    ? (failed || current.isLoading ? undefined : countLabel(matches.length, loaded.length, searching, server))
    : total === undefined ? undefined : countLabel(total, total, false);

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title="Exceptions"
        info="Request, review, and manage exceptions"
        meta={meta}
        actions={(
          <>
            <Button leftIcon={<Sparkles aria-hidden />} onClick={() => setSuggesting(true)} title="Pick a document and let AI suggest exceptions to raise">Suggest exceptions</Button>
            {canCreate && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => openNew()}>New exception</Button>}
          </>
        )}
      />

      {notice && inList && <ListNotice title={notice.title}>{notice.detail}</ListNotice>}

      {refusal && <Notice tone="danger" title="Not submitted" action={<Button onClick={() => setRefusal(null)}>Dismiss</Button>}>{refusal}</Notice>}

      {linkFailed && (
        <Notice tone="danger" title="Couldn't open that exception"
          action={(
            <span className="flex flex-wrap gap-2">
              {canRetry(one.error) && <Button onClick={() => { void one.refetch(); }}>Retry</Button>}
              <Button onClick={() => setWanted(null)}>Dismiss</Button>
            </span>
          )}>
          {errorMessage(one.error)}
        </Notice>
      )}

      <Summary query={analytics} />

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl label="View" name="exceptions-view" value={view} options={VIEW_OPTIONS} onChange={(v) => setAddress({ view: v }, { push: true })} />
        {inList && (
          <>
            <TextInput
              className="w-full sm:w-[260px]"
              inputMode="search"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search exceptions"
              placeholder="Search exceptions"
              title="Searches the title, the document, the unit and the requester"
              value={searchTerm}
              onChange={(e) => setAddress({ q: e.target.value })}
              leftAdornment={<Search aria-hidden />}
              rightAdornment={searchTerm ? (
                <button type="button" aria-label="Clear search" title="Clear search" onClick={() => setAddress({ q: '' })}
                  className="grid h-[24px] w-[24px] place-items-center rounded-full text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring">
                  <X aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px]" />
                </button>
              ) : undefined}
            />
            {(waiting.data?.length || waitingOnly) ? (
              <SegmentedControl label="Show" name="exceptions-scope" value={waitingOnly ? 'mine' : 'all'} onChange={(v) => setAddress({ waiting: v === 'mine' })}
                options={[{ value: 'all', label: 'All' }, { value: 'mine', label: waitingLabel(waiting.data?.length ?? 0) }]} />
            ) : null}
            <Select aria-label="Status" placeholder="All statuses" value={statusFilter} onChange={(e) => setAddress({ status: e.target.value })} className="w-[168px]">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select aria-label="Priority" placeholder="All priorities" value={priorityFilter} onChange={(e) => setAddress({ priority: e.target.value })} className="w-[168px]">
              {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <div className="w-[200px] max-w-full">
              <DepartmentSelect label="Unit" value={unitFilter} onChange={(v) => setAddress({ unit: v })} first={{ label: 'All units' }} keep={unitFilter ? [Number(unitFilter)] : []} />
            </div>
            <Select aria-label="Document type" placeholder="All document types" value={docTypeFilter} onChange={(e) => setAddress({ doctype: e.target.value })} className="w-[188px]">
              {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
            {unitFilter && (
              <Button size="sm" rightIcon={<X aria-hidden />} aria-label={`Remove the unit filter: ${unitName ?? 'this unit'} and below`} onClick={() => setAddress({ unit: '' })}>
                {unitChipText(unitName)}
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <ColumnsMenu columns={columns.filter((c) => TOGGLEABLE.includes(c.key))} hidden={hiddenCols} onToggle={toggleCol} />
              <IconButton label={server.cut ? 'Export CSV (loaded rows only)' : 'Export CSV'} variant="secondary" disabled={sorted.length === 0} onClick={exportCsv}>
                <Download aria-hidden />
              </IconButton>
            </div>
          </>
        )}
      </div>

      {view === 'unit' && <UnitTree query={byUnit} onOpen={openUnit} />}
      {view === 'document' && <DocumentTree query={byDocument} onOpen={openById} />}
      {inList && (
        <div ref={results} tabIndex={-1} aria-busy={current.isPlaceholderData || undefined} className={clsx('focus-visible:outline-none', current.isPlaceholderData && 'opacity-60')}>
          <RegisterTable<ExceptionItem>
            caption="Exceptions"
            columns={visible}
            rows={pageRows}
            getRowId={(e) => e.id}
            sort={sort}
            onSortChange={setSort}
            onRowActivate={openRow}
            selectedId={shownId}
            loading={current.isLoading}
            error={failed ? { message: `Could not load the exceptions. ${errorMessage(current.error)}`, onRetry: canRetry(current.error) ? () => { void current.refetch(); } : undefined } : null}
            empty={empty}
            cardTitle={(e) => (
              <div className="flex items-start justify-between gap-[8px]">
                <span className="line-clamp-3 min-w-0 flex-1 font-[600]" title={e.title}>{e.title}</span>
                {actionsOf(e)}
              </div>
            )}
            footer={sorted.length > 0 ? (
              <Pager page={pager.page} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES}
                noun={server.cut ? 'loaded exceptions' : 'exceptions'} />
            ) : undefined}
          />
        </div>
      )}

      {suggesting && <SuggestDialog documents={documents} canCreate={canCreate} onClose={() => setSuggesting(false)} onRaise={raiseFor} />}
      {form && <ExceptionFormDrawer key={form.id} exception={form.exception} initial={form.initial} documents={documents} assets={assets} onClose={() => setForm(null)} />}
      {shown && (
        <ExceptionDetailsDrawer key={shown.id} exception={shown} onClose={closeDetails} withdrawing={withdraw.isPending}
          onDecide={(kind) => setDeciding({ kind, exception: shown })} onWithdraw={() => { void askWithdraw(shown); }} />
      )}
      {deciding && <DecisionDialog key={`${deciding.kind}-${deciding.exception.id}`} kind={deciding.kind} exception={deciding.exception} onClose={() => setDeciding(null)} />}
      {confirmDialog}
    </div>
  );
}
