'use client';

// Governance > Documents > Policy exceptions: request, review and manage them. On the design-system kit (components/ui/ds): PageHeader variant="page",
// RegisterTable (a table from 768px, cards below), Pager, Menu for a row's actions, StatusPill, PersonChip, FormField and the controls, drawers that
// ask "Discard changes?", useConfirm for deleting and useReportedMutation for every write (the server's answer is said, and a refusal in its own words).
// The list the server sends is cut at 100 and carries no total: this page says so, shows how many there are in all (the analytics' counts) and what its
// search, sort and CSV work on (_logic.ts: serverList, cutNotice). The ten writes are in the pieces below; what each sends is unchanged.
// An exception that goes through an approval rule (Governance > Settings > Exception approvals) says which step it is at and who it waits for, is decided
// by the people its open step asks (approve, ask for changes, reject: what the step allows) and can be withdrawn; "Waiting for me" lists the ones that wait
// for the person. An alert's link (?open=12) opens that exception, whether or not its row is on the loaded page. One with no rule is decided as it always was.
//   _ExceptionForm.tsx   raise / change (drawer)       _ExceptionDetails.tsx  details, approval, comments, move to risk register (drawer)
//   _ApprovalPanel.tsx   the approval under a rule      _Decision.tsx          approve / ask for changes / reject / revoke
//   _Suggest.tsx         suggest exceptions (AI, opt-in)       _Summary.tsx  the three cards       _approval.ts  what is said about the approval (pure)
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Ban, Check, Download, Eye, MessageSquare, Pencil, Plus, Search, Send, Shield, Sparkles, Trash2, Undo2, X, XCircle } from 'lucide-react';
import { assetsApi, governanceApi, policyExceptionApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { EMPTY, truncate } from '@/lib/format';
import { exceptionStatus, priority as priorityStatus, statusPill } from '@/lib/status';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, IconButton, Menu, Notice, Pager, PersonChip, RegisterTable, SegmentedControl, Select, StatusPill, TextInput, useConfirm, useNotify,
  useReportedMutation, type MenuItem, type RegisterColumn, type SortState,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ListNotice } from '@/components/governance/ListNotice';
import {
  DATA_COLS, DEFAULT_PAGE_SIZE, PAGE_SIZES, countLabel, csvDone, cutNotice, dayText, emptyForm, formForPolicy, formFrom, itemsOf, momentDay, openIdOf, pagerOf,
  longRefusal, requesterOf, rowActionKeys, searchExceptions, serverList, sortLoaded, toCsv, toggleHidden, waitingLabel, waitingRows, withoutOpen,
  type DataCol, type ExceptionForm, type Filters, type RowActionKey,
} from './_logic';
import { statusDetail } from './_approval';
import { LIST_KEYS, type AssetOption, type ExceptionAnalytics, type ExceptionItem, type PolicyOption } from './_types';
import { ColumnsMenu } from './_ColumnsMenu';
import { DecisionDialog, type DecisionKind } from './_Decision';
import { ExceptionDetailsDrawer } from './_ExceptionDetails';
import { ExceptionFormDrawer } from './_ExceptionForm';
import { SuggestDialog } from './_Suggest';
import { Summary } from './_Summary';

const STATUS_OPTIONS = exceptionStatus.words.map((w) => ({ value: w, label: exceptionStatus.label(w) }));
const PRIORITY_OPTIONS = ['critical', 'high', 'medium', 'low'].map((w) => ({ value: w, label: priorityStatus.label(w) }));
const TOGGLEABLE = ['policy', 'status', 'priority', 'requester', 'created', 'expiry'];

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

/** The status, and under an approval rule the step it is at and who it waits for (what a draft sent back says too). Nothing more for one decided as it always was. */
function StatusCell({ exception: e }: { exception: ExceptionItem }) {
  const detail = statusDetail(e);
  return (
    <div className="flex min-w-0 flex-col items-start gap-[2px]">
      <StatusPill size="sm" {...statusPill(exceptionStatus, e.status)} />
      {detail?.step && <span className="text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{detail.step}</span>}
      {detail?.waiting && <span className="line-clamp-2 text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]" title={detail.waiting}>{detail.waiting}</span>}
    </div>
  );
}

export default function PolicyExceptionsPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:policy_exceptions:create');
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();

  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sort, setSort] = useState<SortState>(null);
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [waitingOnly, setWaitingOnly] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [viewing, setViewing] = useState<ExceptionItem | null>(null);       // the row that was opened: shown at once, then read again from the server
  const [wanted, setWanted] = useState<number | null>(null);                // an exception an alert's link asked for (?open=), whether or not its row is loaded
  const [deciding, setDeciding] = useState<{ kind: DecisionKind; exception: ExceptionItem } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  useEffect(() => { setPageNo(1); }, [searchTerm, statusFilter, priorityFilter, pageSize, sort, waitingOnly]);

  // An alert's link (/governance/exceptions?open=12) opens that exception. The page keeps nothing else in its address, so the link is used up once it has
  // been taken: the address is cleaned (and the same alert opens it again when it is pressed again).
  const openId = openIdOf(useSearchParams()?.toString());
  useEffect(() => {
    if (openId === null) return;
    setViewing(null);
    setWanted(openId);
    window.history.replaceState(null, '', window.location.pathname + withoutOpen(window.location.search) + window.location.hash);
  }, [openId]);

  // ── what the server sends ──
  const list = useQuery({
    queryKey: ['policy-exceptions', statusFilter, priorityFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      return itemsOf<ExceptionItem>((await policyExceptionApi.getAll(params)).data);
    },
    placeholderData: keepPreviousData,
    retry: (n, e) => n < 2 && canRetry(e),                          // a refusal (403) is not tried again: it is said at once
  });
  // the ones that wait for this person to decide now (under an approval rule); it shares the list's refresh: a key that starts with 'policy-exceptions'
  const waiting = useQuery({
    queryKey: ['policy-exceptions', 'waiting-for-me'],
    queryFn: async () => itemsOf<ExceptionItem>((await policyExceptionApi.waitingForMe()).data),
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
  // the pickers' lists are needed only once the form or the suggestions are opened
  const needPickers = form !== null || suggesting;
  const policies = useQuery({
    queryKey: ['governance-documents-list'],
    queryFn: async () => itemsOf<PolicyOption>((await governanceApi.getDocuments({ limit: 500 })).data)
      .filter((d) => String(d.doc_type || '').toLowerCase() === 'policy'),               // exceptions are raised against policies only, never procedures or standards
    enabled: needPickers,
  });
  const assets = useQuery({
    queryKey: ['assets-for-exception-link'],
    queryFn: async () => itemsOf<AssetOption>((await assetsApi.getAll({ limit: 500 })).data),
    enabled: form !== null,
  });

  // ── what is loaded, what the server holds, what is shown ──
  const filters: Filters = { status: statusFilter, priority: priorityFilter };
  const view = waitingOnly ? waiting : list;                          // "Waiting for me" lists what the server says waits for the person (never cut); the filters narrow it here
  const loaded = waitingOnly ? waitingRows(waiting.data ?? [], filters) : list.data ?? [];
  const settled = useRef(filters);                                    // while the rows of the previous filters are still on screen the counts are theirs
  if (!list.isPlaceholderData) settled.current = filters;
  const server = waitingOnly ? { cut: false, total: loaded.length } : serverList(loaded.length, settled.current, analytics.data);
  const failed = view.isError && !view.data;
  const searching = searchTerm.trim() !== '';
  const matches = searchExceptions(loaded, searchTerm);
  const sorted = sortLoaded(matches, sort);
  const pager = pagerOf(sorted.length, pageNo, pageSize);
  const pageRows = sorted.slice(pager.start, pager.end);
  const notice = failed || view.isLoading ? null : cutNotice(loaded.length, server, settled.current);

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
  const clearAll = () => { setSearchTerm(''); setStatusFilter(''); setPriorityFilter(''); setWaitingOnly(false); };
  const openRow = (e: ExceptionItem) => { setWanted(null); setViewing(e); };
  const closeDetails = () => { setViewing(null); setWanted(null); };

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

  // The columns in the order the table has always had; the narrower the window, the fewer (Policy, Requester and Created go below 1024px, Expiry below
  // 768px, where each exception is a card with the same facts as lines).
  const columns: RegisterColumn<ExceptionItem>[] = [
    { key: 'title', header: 'Title', isRowHeader: true, sortable: true, cell: (e) => <span className="line-clamp-2 font-[600] text-ds-fg" title={e.title}>{e.title}</span> },
    {
      key: 'policy', header: 'Policy', priority: 3, width: 'w-[128px]', card: 'meta',
      cell: (e) => { const p = e.document_title || e.policy_name; return p ? <span className="line-clamp-2" title={p}>{p}</span> : <span className="text-ds-fg-muted">Not set</span>; },
    },
    { key: 'status', header: 'Status', sortable: true, width: 'w-[152px]', card: 'meta', cell: (e) => <StatusCell exception={e} /> },
    { key: 'priority', header: 'Priority', sortable: true, width: 'w-[96px]', card: 'meta', cell: (e) => <StatusPill size="sm" {...statusPill(priorityStatus, e.priority)} /> },
    { key: 'requester', header: 'Requester', priority: 3, width: 'w-[128px]', card: 'meta', cell: (e) => <PersonChip name={requesterOf(e)} emptyLabel={EMPTY} /> },
    { key: 'created', header: 'Created', priority: 3, sortable: true, width: 'w-[100px]', cell: (e) => <span className="whitespace-nowrap tabular-nums">{momentDay(e.created_at)}</span> },
    {
      key: 'expiry', header: 'Expiry', priority: 2, sortable: true, width: 'w-[100px]', card: 'meta',
      cell: (e) => <span className={`whitespace-nowrap tabular-nums ${e.expiry_date ? '' : 'text-ds-fg-muted'}`}>{dayText(e.expiry_date)}</span>,
    },
    { key: 'actions', header: 'Actions', align: 'right', width: 'w-[56px]', cell: actionsOf },
  ];
  const visible = columns.filter((c) => !hiddenCols.includes(c.key));
  const toggleCol = (key: string) => { setHiddenCols((h) => toggleHidden(h, key)); if (sort?.key === key) setSort(null); };

  const exportCsv = () => {
    const cols = visible.filter((c) => c.key in DATA_COLS).map((c) => ({ id: c.key, ...DATA_COLS[c.key as keyof typeof DATA_COLS] }));
    downloadCsv('policy-exceptions', cols, sorted);
    notify.success(csvDone(sorted.length, loaded.length, server));
  };

  const firstUse = loaded.length === 0 && !statusFilter && !priorityFilter && !waitingOnly;
  const empty = firstUse ? (
    <EmptyState kind="firstUse" bare icon={Shield} title="No exceptions yet"
      action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => openNew()}>New exception</Button> : undefined} />
  ) : (
    <EmptyState kind="noMatches" bare title="No matches" onClearFilters={clearAll} />
  );

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title="Policy exceptions"
        info="Request, review, and manage policy exceptions"
        meta={failed || view.isLoading ? undefined : countLabel(matches.length, loaded.length, searching, server)}
        actions={(
          <>
            <Button leftIcon={<Sparkles aria-hidden />} onClick={() => setSuggesting(true)} title="Pick a policy and let AI suggest exceptions to raise">Suggest exceptions</Button>
            {canCreate && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => openNew()}>New exception</Button>}
          </>
        )}
      />

      {notice && <ListNotice title={notice.title}>{notice.detail}</ListNotice>}

      {refusal && <Notice tone="danger" title="Not submitted" action={<Button onClick={() => setRefusal(null)}>Dismiss</Button>}>{refusal}</Notice>}

      {linkFailed && (
        <Notice tone="danger" title={`Couldn't open exception ${wanted}`}
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
        <TextInput
          className="w-full sm:w-[300px]"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search exceptions"
          placeholder="Search exceptions"
          title="Searches the title, the policy and the requester"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          leftAdornment={<Search aria-hidden />}
          rightAdornment={searchTerm ? (
            <button type="button" aria-label="Clear search" title="Clear search" onClick={() => setSearchTerm('')}
              className="grid h-[24px] w-[24px] place-items-center rounded-full text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring">
              <X aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px]" />
            </button>
          ) : undefined}
        />
        {(waiting.data?.length || waitingOnly) ? (
          <SegmentedControl label="Show" name="exceptions-scope" value={waitingOnly ? 'mine' : 'all'} onChange={(v) => setWaitingOnly(v === 'mine')}
            options={[{ value: 'all', label: 'All' }, { value: 'mine', label: waitingLabel(waiting.data?.length ?? 0) }]} />
        ) : null}
        <Select aria-label="Status" placeholder="All statuses" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-[168px]">
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select aria-label="Priority" placeholder="All priorities" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="w-[168px]">
          {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <ColumnsMenu columns={columns.filter((c) => TOGGLEABLE.includes(c.key))} hidden={hiddenCols} onToggle={toggleCol} />
          <IconButton label={server.cut ? 'Export CSV (loaded rows only)' : 'Export CSV'} variant="secondary" disabled={sorted.length === 0} onClick={exportCsv}>
            <Download aria-hidden />
          </IconButton>
        </div>
      </div>

      <div aria-busy={view.isPlaceholderData || undefined} className={view.isPlaceholderData ? 'opacity-60' : undefined}>
        <RegisterTable<ExceptionItem>
          caption="Policy exceptions"
          columns={visible}
          rows={pageRows}
          getRowId={(e) => e.id}
          sort={sort}
          onSortChange={setSort}
          onRowActivate={openRow}
          selectedId={shownId}
          loading={view.isLoading}
          error={failed ? { message: `Could not load the exceptions. ${errorMessage(view.error)}`, onRetry: canRetry(view.error) ? () => { void view.refetch(); } : undefined } : null}
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

      {suggesting && <SuggestDialog policies={policies} canCreate={canCreate} onClose={() => setSuggesting(false)} onRaise={raiseFor} />}
      {form && <ExceptionFormDrawer key={form.id} exception={form.exception} initial={form.initial} policies={policies} assets={assets} onClose={() => setForm(null)} />}
      {shown && (
        <ExceptionDetailsDrawer key={shown.id} exception={shown} onClose={closeDetails} withdrawing={withdraw.isPending}
          onDecide={(kind) => setDeciding({ kind, exception: shown })} onWithdraw={() => { void askWithdraw(shown); }} />
      )}
      {deciding && <DecisionDialog key={`${deciding.kind}-${deciding.exception.id}`} kind={deciding.kind} exception={deciding.exception} onClose={() => setDeciding(null)} />}
      {confirmDialog}
    </div>
  );
}

