'use client';

// The Actions section: the log of governance actions that ask for a review, one status at a time, as a register with a pager that reads the server's total.
// "All actions" and "Pending review" show the person's own pending actions and the other statuses the organisation's, as this page always has (_queries.ts).
// The three counters the section used to open with were counted from whatever rows the chosen status had loaded, so two of the three read 0 under most
// statuses; the register's own count (the server's total) says how many there are.
import { useMemo, useState } from 'react';
import { formatCount, formatDate, statusLabel } from '@/lib/format';
import { reviewStatus, statusPill } from '@/lib/status';
import { EmptyState, Pager, PersonChip, RegisterTable, SegmentedControl, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { useGovernanceActions, type GovernanceAction } from './_queries';
import { ACTION_FILTERS, actionTypeLabel, coverage, pageOf } from './reviewsModel';

const COLUMNS: RegisterColumn<GovernanceAction>[] = [
  { key: 'action', header: 'Action', isRowHeader: true, cell: (a) => <span className="line-clamp-2 font-medium text-ds-fg [overflow-wrap:anywhere]" title={a.action_description}>{a.action_description}</span> },
  { key: 'type', header: 'Type', card: 'meta', cell: (a) => actionTypeLabel(a.action_type) },
  { key: 'by', header: 'By', priority: 2, card: 'meta', cell: (a) => <PersonChip name={a.action_user_name} size={20} /> },
  { key: 'date', header: 'Date', priority: 2, card: 'meta', cell: (a) => <span className="whitespace-nowrap">{formatDate(a.action_date)}</span> },
  { key: 'entity', header: 'Entity', priority: 3, card: 'meta', cell: (a) => statusLabel(a.entity_type) },
  { key: 'status', header: 'Status', card: 'meta', cell: (a) => <StatusPill size="sm" {...statusPill(reviewStatus, a.review_status)} /> },
];

export function ActionsSection() {
  const [filter, setFilter] = useState('pending_review');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const q = useGovernanceActions(filter);
  const rows = useMemo(() => q.data?.items ?? [], [q.data]);
  const cover = coverage(rows.length, q.data?.total);
  const visible = pageOf(rows, page, pageSize);

  return (
    <div className="flex flex-col gap-[12px]">
      <SegmentedControl
        label="Which actions"
        name="review-action-filter"
        value={filter}
        onChange={(next) => { setFilter(next); setPage(1); }}
        options={ACTION_FILTERS}
        className="self-start"
      />
      {q.isSuccess && cover.cut && (
        <p role="status" className="rounded-ds-card border border-ds-border bg-ds-warning-soft px-[12px] py-[8px] text-ds-body text-ds-warning">
          Showing the first {formatCount(cover.loaded)} of {formatCount(cover.total)} actions.
        </p>
      )}
      <RegisterTable
        caption="Governance actions"
        columns={COLUMNS}
        rows={visible}
        getRowId={(a) => a.id}
        loading={q.isPending}
        error={q.isError ? { message: errorMessage(q.error, "Couldn't load the governance actions."), onRetry: canRetry(q.error) ? () => { void q.refetch(); } : undefined } : null}
        cardTitle={(a) => a.action_description}
        empty={<EmptyState bare kind="firstUse" title="No governance actions" info="Actions that ask for a review appear here." />}
        footer={rows.length > 0 ? (
          <Pager page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="actions" />
        ) : undefined}
      />
    </div>
  );
}
