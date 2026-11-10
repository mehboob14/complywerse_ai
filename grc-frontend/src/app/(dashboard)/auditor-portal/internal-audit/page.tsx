'use client';

export const dynamic = 'force-dynamic';

// Internal Audit: the organisation's internal audits, one row each, every row opening its assessment workspace where the audit's observations are worked through. It used to open the first
// audit it found and hide the list, with a "Settings" switch that edited the Audit Plan's statuses (which live in the Audit Plan, in the assessment workspace), not these audits; the list is the
// page now and the switch is gone. Uploading an audit is the Assessments' Types page (one press away); every other kind of assessment is in the Assessments register.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Upload } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, Notice, RegisterTable, StatusPill, TitleLink, sortRows, rowCountText, type RegisterColumn, type SortState } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import apiClient from '@/lib/api';
import { formatCount, formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { lifecycle, lifecycleOf } from '@/lib/statuses/assessments';
import { DEFAULT_SORT, INTERNAL_AUDIT_FORMAT, LIMIT, auditsOf, numbersOf, sortValue, workspaceHref, type ListRow } from './_audits/auditsModel';

const MUTED = 'text-ds-fg-muted';
const KEY = ['redesign-assessments', 'internal-audit'] as const;       // the key the assessment workspace's writes already refresh

export default function InternalAuditPage() {
  const router = useRouter();
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const q = useQuery({
    queryKey: KEY,
    queryFn: async () => auditsOf((await apiClient.get('/compliance/assessments', { params: { assessment_format: INTERNAL_AUDIT_FORMAT, limit: LIMIT, summary: 0, all_formats: 1 } })).data),
    retry: (failures, error) => failures < 2 && canRetry(error),
    retryDelay: 800,
    staleTime: 15_000,
  });
  const rows = useMemo(() => sortRows(q.data?.rows ?? [], sort, sortValue), [q.data, sort]);
  const total = q.data?.total ?? 0;

  const columns: RegisterColumn<ListRow>[] = [
    {
      key: 'name', header: 'Audit', sortable: true, isRowHeader: true, card: 'hide',
      cell: (r) => (
        <div className="min-w-0">
          <TitleLink href={workspaceHref(r.id)} title={r.name} lines={2} />
          {r.file_name && <span className={`block truncate text-ds-label ${MUTED}`}>{r.file_name}</span>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortable: true, card: 'meta', cell: (r) => <StatusPill size="sm" {...statusPill(lifecycle, lifecycleOf(r))} /> },
    {
      key: 'items', header: 'Observations', sortable: true, firstDir: 'desc', card: 'meta', priority: 2,
      cell: (r) => {
        const n = numbersOf(r);
        return (
          <span className="flex min-w-0 flex-col">
            <span className="whitespace-nowrap text-ds-body tabular-nums text-ds-fg">{n.total === null ? '—' : formatCount(n.total)}</span>
            {(n.notComplied > 0 || n.inProgress > 0) && (
              <span className={`truncate text-ds-label ${n.notComplied > 0 ? 'font-[600] text-ds-danger' : MUTED}`}>
                {[n.notComplied > 0 ? `${formatCount(n.notComplied)} not complied` : null, n.inProgress > 0 ? `${formatCount(n.inProgress)} in progress` : null].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
        );
      },
    },
    { key: 'assessor', header: 'Assessor', sortable: true, card: 'meta', priority: 2, cell: (r) => <span className={`text-ds-body ${r.assessor ? 'text-ds-fg-body' : MUTED}`}>{r.assessor || '—'}</span> },
    { key: 'due', header: 'Due', sortable: true, card: 'meta', priority: 3, cell: (r) => <span className={`whitespace-nowrap text-ds-body ${r.due_date ? 'text-ds-fg-body' : MUTED}`}>{formatDate(r.due_date, { calendar: true })}</span> },
    { key: 'updated', header: 'Last changed', sortable: true, firstDir: 'desc', card: 'meta', priority: 3, cell: (r) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(r.updated_at ?? r.created_at)}</span> },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title="Internal Audit"
        info="The organisation's internal audits. Each one opens in the assessment workspace, where its observations are worked through. Other kinds of assessment are in the Assessments register."
        meta={q.data ? `${formatCount(total)} ${total === 1 ? 'audit' : 'audits'}` : undefined}
        actions={(
          <>
            <Button href="/assessments/register" leftIcon={<ClipboardList aria-hidden />}>All assessments</Button>
            <Button href={`/assessments/types?type=${INTERNAL_AUDIT_FORMAT}`} leftIcon={<Upload aria-hidden />}>Upload an audit</Button>
          </>
        )}
      />
      {q.data && total > q.data.rows.length && (
        <Notice tone="warning" title={`Showing ${formatCount(q.data.rows.length)} of ${formatCount(total)} audits`}>The rest are in the Assessments register.</Notice>
      )}
      <RegisterTable<ListRow>
        caption="Internal audits"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={(next) => setSort(next)}
        onRowActivate={(r) => router.push(workspaceHref(r.id))}
        loading={q.isLoading}
        error={q.isError ? { message: `Couldn't load the internal audits. ${errorMessage(q.error)}`, onRetry: () => { void q.refetch(); } } : null}
        empty={<EmptyState bare kind="firstUse" title="No internal audits yet" description="Upload the audit master workbook and it appears here." action={<Button variant="primary" href={`/assessments/types?type=${INTERNAL_AUDIT_FORMAT}`} leftIcon={<Upload aria-hidden />}>Upload an audit</Button>} />}
        footer={<p className={`text-ds-label ${MUTED}`}>{rowCountText({ shown: rows.length, total, noun: 'audit', loading: q.isLoading, failed: q.isError })}</p>}
        cardTitle={(r) => <TitleLink href={workspaceHref(r.id)} title={truncate(r.name, 120).text} lines={2} />}
      />
    </div>
  );
}
