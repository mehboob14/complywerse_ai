'use client';

// The Approvals tab of the Approval Workflows page: four counts, then the open approvals as a register (a table from 768px, cards below) with Reject and
// Approve on every row. The reads, their query keys and what a decision calls are the ones the page has always had; what changed is what a person is TOLD:
//  - a read that fails or is refused says so, in the server's words (it used to read as zeros and "All caught up!"), and a refusal is not retried;
//  - the true total comes from the server (the list was capped at 100 and the badge counted what came), and a list the server holds more of says so;
//  - the days a step is overdue, a document type, a missing owner and every time are written by the platform's rules (the page read the server's UTC clock as the
//    viewer's, said "Other" for a charter, and printed a stray 0 after the year of a step overdue by hours).
// Pending shows the overdue approvals (the overdue list) then the ones that are not; All shows every pending approval in one list. Approved and Rejected have
// never listed anything (the API has no history route): they say so instead of promising a list. Who may decide is the server's (the approver, their delegate,
// an administrator): the buttons are drawn for everyone who can read the list, as they always were, and a refusal is shown in the dialog.
import { useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { FileCheck } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { formatCount, formatDate, truncate } from '@/lib/format';
import { approvalStep, statusPill } from '@/lib/status';
import type { WorkflowDashboard } from '@/types';
import {
  Button, EmptyState, ErrorState, NoAccessState, Notice, Pager, PersonChip, RegisterTable, SegmentedControl, StatTile, StatusPill, sortRows,
  type RegisterColumn, type SortState,
} from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { DecisionDialog, type DecisionKind } from './_DecisionDialog';
import { SectionHeading, TitleLink, readPage, retryRead, useFocusAfterRemoval, useRead } from './_parts';
import {
  approvalSortValue, cutTitle, docTypeLabel, documentHref, notOverdue, overdueWords, sliceOf, withDays, type ListKey, type PendingStep,
} from './_model';

const UNREADABLE = "The server's answer could not be read.";

export function ApprovalsTab({ list, onList }: { list: ListKey; onList: (list: ListKey) => void }) {
  const dashboard = useQuery({
    queryKey: ['workflow-dashboard'],
    queryFn: async () => (await governanceApi.getWorkflowDashboard()).data as WorkflowDashboard,
    retry: retryRead,
  });
  const pending = useRead(useQuery({
    queryKey: ['pending-approvals'],
    placeholderData: keepPreviousData,
    queryFn: () => readPage<PendingStep>(governanceApi.getPendingApprovals()),
    retry: retryRead,
  }));
  const overdue = useRead(useQuery({
    queryKey: ['overdue-approvals'],
    placeholderData: keepPreviousData,
    queryFn: () => readPage<PendingStep>(governanceApi.getOverdueApprovals()),
    retry: retryRead,
  }));
  const [deciding, setDeciding] = useState<{ kind: DecisionKind; step: PendingStep } | null>(null);
  useFocusAfterRemoval(pending.page?.total, 'input[name="workflow-approvals-list"]:checked');       // a decided approval leaves the list, and the focus on its button with it
  const decide = (kind: DecisionKind, step: PendingStep) => setDeciding({ kind, step });

  const pendingRows = useMemo(() => pending.page?.items ?? [], [pending.page]);
  const overdueRows = useMemo(() => overdue.page?.items ?? [], [overdue.page]);
  const allRows = useMemo(() => withDays(pendingRows, overdueRows), [pendingRows, overdueRows]);
  const dueRows = useMemo(() => notOverdue(pendingRows), [pendingRows]);

  // a person who may not read the library is told so, once, in the server's words (it is the same refusal for the counts and both lists)
  const refusal = [dashboard.error, pending.error].find((e) => statusOf(e) === 403);
  if (refusal && !pending.page) {
    return <NoAccessState title="You don't have access to approvals" reason={errorMessage(refusal)} />;
  }

  const readFailed = (r: { error: unknown; refetch: () => void }, what: string) => ({
    message: `Couldn't load the ${what}. ${errorMessage(r.error, UNREADABLE)}`,
    onRetry: canRetry(r.error) ? r.refetch : undefined,
  });
  const cutPending = pending.page && cutTitle(pending.page.items.length, pending.page.total, 'pending approvals');
  const cutOverdue = overdue.page && cutTitle(overdue.page.items.length, overdue.page.total, 'overdue approvals');
  const cuts = (list === 'pending' ? [cutOverdue, cutPending] : [cutPending]).filter((t): t is string => !!t);
  const count = (label: string, n: number | undefined) => (n === undefined ? label : `${label} ${formatCount(n)}`);

  let content;
  if (list === 'approved' || list === 'rejected') {
    content = (
      <EmptyState
        kind="firstUse"
        icon={FileCheck}
        title={`${list === 'approved' ? 'Approved' : 'Rejected'} requests are not listed here`}
        description="This page lists the requests that are still open. Today's decisions are counted in the tiles above."
      />
    );
  } else if (list === 'all') {
    content = (
      <ApprovalsTable
        caption="All pending approvals"
        noun={{ one: 'pending approval', other: 'pending approvals' }}
        rows={allRows}
        loading={pending.loading}
        error={pending.failed ? readFailed(pending, 'approvals') : null}
        empty={<EmptyState bare kind="firstUse" icon={FileCheck} title="No pending approvals" description="All caught up. No documents are waiting for approval." />}
        onDecide={decide}
      />
    );
  } else if (overdue.loading || pending.loading) {
    content = <ApprovalsTable caption="Pending approvals" noun={{ one: 'pending approval', other: 'pending approvals' }} rows={[]} loading onDecide={decide} />;
  } else if (!overdue.failed && !pending.failed && overdueRows.length === 0 && dueRows.length === 0) {
    content = <EmptyState kind="firstUse" icon={FileCheck} title="No pending approvals" description="All caught up. No documents are waiting for approval." />;
  } else {
    content = (
      <div className="flex flex-col gap-[16px]">
        {(overdue.failed || overdueRows.length > 0) && (
          <section aria-labelledby="workflow-overdue" className="flex flex-col gap-[8px]">
            <SectionHeading id="workflow-overdue">Overdue</SectionHeading>
            <ApprovalsTable
              caption="Overdue approvals"
              noun={{ one: 'overdue approval', other: 'overdue approvals' }}
              rows={overdueRows}
              error={overdue.failed ? readFailed(overdue, 'overdue approvals') : null}
              onDecide={decide}
            />
          </section>
        )}
        {(pending.failed || dueRows.length > 0) && (
          <section aria-labelledby="workflow-not-overdue" className="flex flex-col gap-[8px]">
            <SectionHeading id="workflow-not-overdue">Not overdue</SectionHeading>
            <ApprovalsTable
              caption="Approvals that are not overdue"
              noun={{ one: 'pending approval', other: 'pending approvals' }}
              rows={dueRows}
              error={pending.failed ? readFailed(pending, 'pending approvals') : null}
              onDecide={decide}
            />
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <Tiles q={dashboard} />
      <div className="flex flex-wrap items-center gap-[8px]">
        <SegmentedControl
          label="Which approvals"
          name="workflow-approvals-list"
          value={list}
          onChange={onList}
          options={[
            { value: 'pending', label: count('Pending', pending.page?.total) },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'all', label: count('All', pending.page?.total) },
          ]}
        />
      </div>
      {list !== 'approved' && list !== 'rejected' && cuts.length > 0 && (
        <Notice tone="warning" title={cuts[0]}>
          {cuts[1] ? `${cuts[1]}. ` : ''}Sorting and paging cover these. The rest follow as these are decided.
        </Notice>
      )}
      {content}
      {deciding && <DecisionDialog key={`${deciding.kind}-${deciding.step.step_id}`} kind={deciding.kind} step={deciding.step} onClose={() => setDeciding(null)} />}
    </div>
  );
}

/** The four counts the server keeps (one request): a failed request is one error, never four zeros. */
function Tiles({ q }: { q: UseQueryResult<WorkflowDashboard, unknown> }) {
  if (q.isError && !q.data) {
    return <ErrorState title="Couldn't load the counts" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
  }
  const d = q.data;
  const figure = (n: number | undefined) => (d ? formatCount(n) : null);
  return (
    <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
      <StatTile
        label="Assigned to you"
        value={figure(d?.pending_my_approval)}
        loading={q.isLoading}
        info="Pending approvals where you are the approver or the delegate. The list below shows every pending approval in the organization."
      />
      <StatTile label="Approved today" value={figure(d?.approved_today)} loading={q.isLoading} info="Approvals decided since 00:00 UTC today." />
      <StatTile label="Rejected today" value={figure(d?.rejected_today)} loading={q.isLoading} info="Rejections decided since 00:00 UTC today." />
      <StatTile
        label="Overdue"
        value={figure(d?.overdue)}
        loading={q.isLoading}
        tone={d && d.overdue > 0 ? 'danger' : 'default'}
        info="Pending approvals past their due time, in the whole organization."
      />
    </div>
  );
}

/** The document a step is about, with its type and code, and when it was asked for: the title is the link that opens the document. */
function DocumentCell({ step }: { step: PendingStep }) {
  const facts = [docTypeLabel(step.doc_type), step.document_code, step.requested_at ? `Requested ${formatDate(step.requested_at)}` : null].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0">
      <TitleLink href={documentHref(step.document_id)} title={step.document_title} />
      <div className="mt-[2px] text-ds-label font-normal text-ds-fg-muted [overflow-wrap:anywhere]">{facts}</div>
    </div>
  );
}

/** Its due day, and where it stands: a word as well as a colour, and for an overdue step how many whole days. */
function DueCell({ step }: { step: PendingStep }) {
  const pill = statusPill(approvalStep, step.is_overdue ? 'overdue' : 'pending');
  return (
    <div className="flex flex-col items-start gap-[4px]">
      <span className="whitespace-nowrap tabular-nums">{formatDate(step.due_date)}</span>
      <StatusPill size="sm" tone={pill.tone} label={step.is_overdue ? overdueWords(step) : pill.label} />
    </div>
  );
}

interface TableProps {
  caption: string;
  noun: { one: string; other: string };
  rows: PendingStep[];
  loading?: boolean;
  error?: { message: string; onRetry?: () => void } | null;
  empty?: ReactNode;
  onDecide: (kind: DecisionKind, step: PendingStep) => void;
}

/** A list of open approvals, sorted and paged here (the server sends them in due order, up to 100). Reject and Approve are always visible and name their document. */
function ApprovalsTable({ caption, noun, rows, loading = false, error = null, empty, onDecide }: TableProps) {
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const sorted = useMemo(() => sortRows(rows, sort, approvalSortValue), [rows, sort]);
  const view = sliceOf(sorted, page, size);

  const columns: RegisterColumn<PendingStep>[] = [
    { key: 'document', header: 'Document', isRowHeader: true, sortable: true, cell: (s) => <DocumentCell step={s} /> },
    { key: 'step', header: 'Step', priority: 2, width: 'w-[128px]', card: 'meta', cell: (s) => <span className="line-clamp-2 [overflow-wrap:anywhere]" title={s.step_name}>{s.step_name}</span> },
    { key: 'owner', header: 'Owner', priority: 3, width: 'w-[148px]', sortable: true, card: 'meta', cell: (s) => <PersonChip name={s.owner_name} size={20} /> },
    { key: 'due', header: 'Due', width: 'w-[152px]', sortable: true, card: 'meta', cell: (s) => <DueCell step={s} /> },
    {
      key: 'decision', header: 'Decision', width: 'w-[172px]', card: 'meta',
      cell: (s) => (
        <div className="flex flex-wrap items-center gap-[8px]">
          <Button size="sm" variant="dangerOutline" aria-label={`Reject: ${truncate(s.document_title, 80).text}`} onClick={() => onDecide('reject', s)}>Reject</Button>
          <Button size="sm" variant="primary" aria-label={`Approve: ${truncate(s.document_title, 80).text}`} onClick={() => onDecide('approve', s)}>Approve</Button>
        </div>
      ),
    },
  ];

  return (
    <RegisterTable<PendingStep>
      caption={caption}
      columns={columns}
      rows={view.rows}
      getRowId={(s) => s.step_id}
      sort={sort}
      onSortChange={(next) => { setSort(next); setPage(1); }}
      loading={loading}
      error={error}
      empty={empty}
      cardTitle={(s) => <DocumentCell step={s} />}
      footer={sorted.length > 0 ? (
        <Pager page={view.page} pageSize={size} total={sorted.length} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} noun={noun} />
      ) : undefined}
    />
  );
}
