'use client';

// Master List Review (/control-library/review): the unified controls of the master baseline with the framework controls behind each. A reviewer approves a correct unified control, flags one that needs
// another look, or removes a framework control that does not belong in it (asked first: it drops the link). The list is paged on the server's total and filtered by review state with the true counts;
// the approved share is the first figure. A decision says what it did.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Flag, ShieldCheck, X } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, FilterChips, Pager, SkeletonRows, StatTile, StatusPill, useConfirm, useReportedMutation, type FilterChip } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import apiClient from '@/lib/api';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { routeFor } from '@/lib/navRegistry';
import { unifiedReview } from '@/lib/statuses/catalog';
import { GL } from './libraryData';

interface Member { parsed_control_id: number; framework: string; code: string; title: string; text: string }
interface ReviewItem { id: number; code: string; name: string; review_status: string; framework_count: number; member_count: number; members: Member[] }
interface Queue { items: ReviewItem[]; total: number; counts: Record<string, number> }

const SIZES = [25, 50, 100] as const;
const FILTERS = [['', 'All'], ['pending', 'Pending'], ['flagged', 'Flagged'], ['approved', 'Approved']] as const;

export function ReviewPage() {
  const { confirm, confirmDialog } = useConfirm();
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(25);
  const q = useQuery({
    queryKey: ['review-queue', filter, page, size],
    retry: (failures, e) => failures < 2 && canRetry(e),
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: size, skip: (page - 1) * size };
      if (filter) params.review_status = filter;
      return (await apiClient.get(`${GL}/review/queue`, { params })).data as Queue;
    },
  });
  const refresh = [['review-queue']] as const;
  const approve = useReportedMutation({ mutationFn: (id: number) => apiClient.post(`${GL}/review/${id}/approve`), success: 'Marked as approved', failure: "Couldn't approve the control", invalidate: refresh });
  const flag = useReportedMutation({ mutationFn: (id: number) => apiClient.post(`${GL}/review/${id}/flag`), success: 'Flagged for another look', failure: "Couldn't flag the control", invalidate: refresh });
  const remove = useReportedMutation({
    mutationFn: (v: { id: number; pid: number }) => apiClient.post(`${GL}/review/${v.id}/remove-member`, { parsed_control_id: v.pid }),
    success: { title: 'Control removed', message: 'It no longer belongs to this unified control.' },
    failure: "Couldn't remove the control",
    invalidate: refresh,
  });
  const askRemove = async (nc: ReviewItem, m: Member) => {
    if (await confirm({ title: 'Remove this control?', message: `${m.framework} ${m.code} does not belong in “${nc.name}”. It is taken out of this unified control; the framework keeps it.`, confirmLabel: 'Remove control', tone: 'danger' })) remove.mutate({ id: nc.id, pid: m.parsed_control_id });
  };

  const data = q.data;
  const counts = data?.counts ?? {};
  const total = (counts.pending || 0) + (counts.approved || 0) + (counts.flagged || 0);
  const approvedPct = total ? Math.round(((counts.approved || 0) / total) * 100) : 0;
  const chips: FilterChip[] = FILTERS.map(([k, label]) => ({ key: k || 'all', label, active: filter === k, count: k === '' ? total : counts[k] || 0 }));
  const label = routeFor('/control-library/review')?.label ?? 'Master List Review';

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader variant="page" title={label} back={{ href: '/control-library', label: 'Back to the Control Library' }} info="Approve correct unified controls or remove a wrong member, to drive the library to 100% correct." />
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 xl:grid-cols-4">
        <StatTile label="Approved" value={q.isPending ? null : `${approvedPct}%`} loading={q.isPending} tone={approvedPct === 100 && total > 0 ? 'success' : 'default'} progress={q.isPending ? null : approvedPct} note={`${formatCount(counts.approved || 0)} of ${formatCount(total)} unified controls`} />
        <StatTile label="Pending" value={q.isPending ? null : formatCount(counts.pending || 0)} loading={q.isPending} note="Not looked at yet" />
        <StatTile label="Flagged" value={q.isPending ? null : formatCount(counts.flagged || 0)} loading={q.isPending} tone={(counts.flagged || 0) > 0 ? 'warning' : 'default'} note="Need another look" />
      </div>
      <FilterChips label="Review state" chips={chips} onToggle={(k) => { setFilter(k === 'all' ? '' : k); setPage(1); }} />

      {q.isError && !data ? (
        <ErrorState title="Couldn’t load the review queue" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      ) : q.isPending ? (
        <SkeletonRows rows={5} columns={3} label="Loading the review queue" />
      ) : (data?.items ?? []).length === 0 ? (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface"><EmptyState kind="firstUse" bare icon={ShieldCheck} title="Nothing to review here" description={filter ? 'No unified control is in this state.' : 'The master baseline has no unified controls yet.'} /></div>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-[12px] p-0">
            {(data?.items ?? []).map((nc) => (
              <li key={nc.id} className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
                <div className="flex flex-wrap items-start justify-between gap-[12px]">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-[8px]">
                      <span className="font-mono text-ds-label text-ds-fg-muted">{nc.code}</span>
                      <StatusPill size="sm" {...statusPill(unifiedReview, nc.review_status)} />
                    </div>
                    <h2 className="m-0 mt-[4px] !text-ds-section !text-ds-fg [overflow-wrap:anywhere]">{nc.name}</h2>
                    <p className="m-0 text-ds-label text-ds-fg-muted">{`${formatCount(nc.member_count)} controls · ${formatCount(nc.framework_count)} frameworks`}</p>
                  </div>
                  <div className="flex gap-[8px]">
                    <Button variant="primary" leftIcon={<CheckCircle2 aria-hidden />} loading={approve.isPending && approve.variables === nc.id} onClick={() => approve.mutate(nc.id)}>Approve</Button>
                    <Button leftIcon={<Flag aria-hidden />} loading={flag.isPending && flag.variables === nc.id} onClick={() => flag.mutate(nc.id)}>Flag</Button>
                  </div>
                </div>
                <ul className="m-0 mt-[12px] grid list-none grid-cols-1 gap-[8px] p-0 md:grid-cols-2">
                  {nc.members.map((m) => (
                    <li key={m.parsed_control_id} className="flex items-start justify-between gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[8px]">
                      <span className="min-w-0">
                        <span className="block text-ds-label font-[600] text-ds-fg-muted">{`${m.framework} · ${m.code}`}</span>
                        <span className="line-clamp-2 text-ds-body text-ds-fg-body" title={m.title}>{m.title}</span>
                      </span>
                      <Button size="sm" leftIcon={<X aria-hidden />} title="It does not belong in this unified control" loading={remove.isPending && remove.variables?.pid === m.parsed_control_id} onClick={() => askRemove(nc, m)}>Remove</Button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <Pager page={page} pageSize={size} total={data?.total ?? 0} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} pageSizes={SIZES} noun={{ one: 'unified control', other: 'unified controls' }} />
        </>
      )}
      {confirmDialog}
    </div>
  );
}
