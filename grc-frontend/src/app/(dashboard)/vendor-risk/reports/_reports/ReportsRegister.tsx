'use client';

// Insights > Reports: the kept reports on the facet explorer (components/records/RegisterFrame), the programme-health band above them, and every action on a report behind a confirm that says what
// happens: Approve (a report is approved once, by someone with the approval right; a report you generated yourself says so, the server allows it), Share with an examiner (a link that needs no sign-in,
// lasts 7, 14 or 30 days, every view is logged; shown ONCE, here, with Copy), Withdraw the link, Discard a draft (an approved report stays on record). A person is offered only the actions the server would
// let them do (reportsModel.rightsFrom). A failed read says so with Retry; a failed action says so with Retry. Nothing is ever shown as zero because it failed to load.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check, Copy, FileText, Link2, Trash2, Unlink, X } from 'lucide-react';
import { Button, EmptyState, Fact, FactList, Menu, Notice, Select, StatusPill, useConfirm, useNotify, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { RecordDetail, RegisterFrame } from '@/components/records/RegisterFrame';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { useCurrentUserId } from '@/components/records/lookups';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { usePermissions } from '@/hooks/usePermissions';
import { tpraApi } from '@/lib/api';
import { EMPTY, formatDate, formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { reportKind, reportState } from '@/lib/statuses/vendorInsights';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import HealthBand from './HealthBand';
import {
  DEFAULT_SHARE_DAYS, REPORTS_SCHEMA, SHARE_DAYS, can, headLine, ownReport, reportsDef, rightsFrom, stateOf, whoWhen, type KeptAnswer, type KeptReport,
} from './reportsModel';

const MUTED = 'text-ds-fg-muted';
const LINK = linkClasses({ tone: 'text', size: 'label' });
export const REPORTS_KEY = ['tprm-reports'] as const;
const openHref = (r: KeptReport) => `/vendor-risk/reports/${r.id}`;
const day = (v: string | null | undefined) => (v ? formatDate(v) : EMPTY);

export interface ReportsHeadProps { meta?: string; info: string; actions: React.ReactNode }
interface Fresh { id: number; title: string; link: string; expires: string | null }

export default function ReportsRegister({ label, info, head, onGenerate }: { label: string; info: string; head: (h: ReportsHeadProps) => React.ReactNode; onGenerate: () => void }) {
  const router = useRouter();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission } = usePermissions();
  const rights = rightsFrom(hasPermission);
  const me = useCurrentUserId();
  const def = useMemo(() => reportsDef(me), [me]);
  const [shareDays, setShareDays] = useState<Record<number, number>>({});
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const q = useQuery({ queryKey: REPORTS_KEY, queryFn: async () => (await tpraApi.listReports()).data as KeptAnswer, ...TPRM_QUERY_OPTS });
  const rows = useMemo(() => q.data?.items ?? [], [q.data]);
  const total = q.data?.total;

  const approve = useReportedMutation({ mutationFn: (r: KeptReport) => tpraApi.approveReport(r.id), success: (_d, r) => `“${r.title}” approved`, failure: 'The report could not be approved.', invalidate: [REPORTS_KEY] });
  const discard = useReportedMutation({ mutationFn: (r: KeptReport) => tpraApi.deleteReport(r.id), success: 'Report discarded', failure: 'The report could not be discarded.', invalidate: [REPORTS_KEY] });
  const revoke = useReportedMutation({
    mutationFn: (r: KeptReport) => tpraApi.revokeReportShare(r.id), success: 'The link is withdrawn', failure: 'The link could not be withdrawn.', invalidate: [REPORTS_KEY],
    onSuccess: (_d, r) => { setFresh((f) => (f?.id === r.id ? null : f)); },
  });
  const share = useReportedMutation({
    mutationFn: async (a: { r: KeptReport; days: number }) => (await tpraApi.shareReport(a.r.id, a.days)).data as KeptReport & { token: string; url: string | null },
    success: 'The examiner’s link is ready', failure: 'The report could not be shared.', invalidate: [REPORTS_KEY],
    onSuccess: (d, a) => { setFresh({ id: a.r.id, title: a.r.title, link: d.url || `${window.location.origin}/vendor-risk/examiner/${d.token}`, expires: d.share.expires_at }); },
  });

  const ask = {
    approve: async (r: KeptReport) => {
      const own = ownReport(r, me);
      if (await confirm({
        title: `Approve “${r.title}”?`,
        message: <>A report is approved once; after that it stays on record and cannot be discarded. Approving it is what allows it to be shared with an examiner.{own && <> <b>You generated this report yourself.</b> Nothing stops you approving it, but someone else reading it first is better practice.</>}</>,
        confirmLabel: 'Approve the report',
      })) approve.mutate(r);
    },
    discard: async (r: KeptReport) => {
      if (await confirm({ title: `Discard “${r.title}”?`, message: 'This draft is removed. An approved report cannot be discarded.', confirmLabel: 'Discard the draft', tone: 'danger' })) discard.mutate(r);
    },
    share: async (r: KeptReport) => {
      const days = shareDays[r.id] ?? DEFAULT_SHARE_DAYS;
      if (await confirm({ title: `Share “${r.title}” with an examiner?`, message: `Anyone with the link can read this report without signing in, for ${days} days. Every view is logged. The link is shown once, so copy it when it appears.`, confirmLabel: `Create a ${days}-day link` })) share.mutate({ r, days });
    },
    withdraw: async (r: KeptReport) => {
      if (await confirm({ title: `Withdraw the link to “${r.title}”?`, message: 'The examiner can no longer open it. You can share the report again later with a new link.', confirmLabel: 'Withdraw the link', tone: 'danger' })) revoke.mutate(r);
    },
  };

  const state = (r: KeptReport) => <StatusPill size="sm" {...statusPill(reportState, stateOf(r))} />;
  const columns: RecordColumn<KeptReport>[] = [
    {
      key: 'title', header: 'Report', sortKey: 'title',
      cell: (row) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={row.record.title}>{row.record.title}</span>
          <span className={`block truncate text-ds-label ${MUTED}`}>{reportKind.label(row.record.kind)}</span>
        </div>
      ),
    },
    { key: 'state', header: 'Status', sortKey: 'state', fit: { px: 190 }, cell: (row) => state(row.record) },
    {
      key: 'generated', header: 'Generated', sortKey: 'generated', firstDir: 'desc', fit: { px: 170, dropRank: 2 },
      cell: (row) => <span className="block min-w-0 text-ds-body text-ds-fg-body"><span className="whitespace-nowrap">{day(row.record.generated_at)}</span><span className={`block truncate text-ds-label ${MUTED}`}>{row.record.generated_by ?? 'Not recorded'}</span></span>,
    },
    {
      key: 'approved', header: 'Approved', sortKey: 'approved', firstDir: 'desc', fit: { px: 170, dropRank: 1 },
      cell: (row) => (row.record.approved_at
        ? <span className="block min-w-0 text-ds-body text-ds-fg-body"><span className="whitespace-nowrap">{day(row.record.approved_at)}</span><span className={`block truncate text-ds-label ${MUTED}`}>{row.record.approved_by ?? 'Not recorded'}</span></span>
        : <span className={`text-ds-body ${MUTED}`}>Not yet</span>),
    },
  ];
  const card = (row: RecordRow<KeptReport>) => (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{row.record.title}</span>
      <span className="flex flex-wrap items-center gap-[8px]">{state(row.record)}<span className={`text-ds-label ${MUTED}`}>{reportKind.label(row.record.kind)}</span></span>
      <span className={`truncate text-ds-label ${MUTED}`}>{whoWhen(row.record, day(row.record.generated_at), row.record.approved_at ? day(row.record.approved_at) : null)}</span>
    </div>
  );

  /** The actions this person may take on this report, as menu items (the same set the drawer's footer offers). */
  const actionsOf = (r: KeptReport): MenuItem[] => {
    const items: MenuItem[] = [{ key: 'open', label: 'Open the report', icon: ArrowUpRight, onSelect: () => router.push(openHref(r)) }];
    if (rights.approve && can.approve(r)) items.push({ key: 'approve', label: 'Approve', icon: Check, onSelect: () => { void ask.approve(r); } });
    if (rights.share && can.share(r)) items.push({ key: 'share', label: 'Share with an examiner', icon: Link2, onSelect: () => { void ask.share(r); } });
    if (rights.share && can.withdraw(r)) items.push({ key: 'withdraw', label: 'Withdraw the link', icon: Unlink, onSelect: () => { void ask.withdraw(r); } });
    if (rights.generate && can.discard(r)) items.push({ key: 'discard', label: 'Discard', icon: Trash2, danger: true, section: 'More', onSelect: () => { void ask.discard(r); } });
    return items;
  };
  const menu = (r: KeptReport) => <Menu iconOnly label={`Actions for ${r.title.slice(0, 60)}`} items={actionsOf(r)} />;

  const copy = () => {
    if (!fresh) return;
    void navigator.clipboard?.writeText(fresh.link).then(() => notify.success('Link copied')).catch(() => notify.error('The link could not be copied. Select it and copy it by hand.'));
  };

  return (
    <>
    <RegisterFrame
      def={def}
      schema={REPORTS_SCHEMA}
      label={label}
      rows={rows}
      loading={q.isLoading}
      error={q.isError && !q.data ? q.error : undefined}
      refreshError={q.isError && q.data ? q.error : undefined}
      serverTotal={total && total > rows.length ? total : null}
      onRetry={() => { void q.refetch(); }}
      head={() => head({ meta: q.data ? headLine(rows, total) : undefined, info, actions: <Button variant="primary" leftIcon={<FileText aria-hidden />} onClick={onGenerate}>Generate a report</Button> })}
      notices={(
        <>
          {fresh && (
            <Notice tone="warning" title="Copy this link now; it is not shown again" action={<span className="flex items-center gap-[8px]"><Button size="sm" leftIcon={<Copy aria-hidden />} onClick={copy}>Copy the link</Button><Button size="sm" variant="ghost" leftIcon={<X aria-hidden />} onClick={() => setFresh(null)}>Done</Button></span>}>
              <span className="block break-words">Anyone with it can read “{fresh.title}” until {day(fresh.expires)}, without signing in.</span>
              <input readOnly value={fresh.link} aria-label="Examiner link" onFocus={(e) => e.target.select()} className="mt-[6px] block min-h-ds-control w-full rounded-ds-control border border-ds-border-control bg-ds-surface px-[10px] font-mono text-ds-label text-ds-fg" />
            </Notice>
          )}
          <HealthBand />
        </>
      )}
      columns={columns}
      card={card}
      boardCard={() => null}
      boardLabel={(r) => r.title}
      rowActions={menu}
      rowLabel={(r) => `Select ${r.title.slice(0, 60)}`}
      searchLabel="Search reports by title or person"
      noAccess={{ title: "You don't have access to the reports", reason: errorMessage(q.error) }}
      emptyFirst={(
        <EmptyState
          bare kind="firstUse" icon={FileText} title="No report kept yet"
          description="Generate the committee pack, the register of functions and obligations, a supplier's evidence file or the ratings of your critical suppliers. A kept report does not change afterwards."
          action={<Button variant="primary" onClick={onGenerate}>Generate a report</Button>}
        />
      )}
      detail={(open, nav) => (
        <RecordDetail
          id={open?.id ?? null}
          nav={nav}
          title={<span dir="auto" className="line-clamp-3 break-words">{open?.title}</span>}
          subtitle={open ? reportKind.label(open.kind) : undefined}
          footer={open ? (
            <div className="flex flex-wrap items-center justify-end gap-[8px]">
              {rights.generate && can.discard(open) && <Button variant="dangerOutline" leftIcon={<Trash2 aria-hidden />} onClick={() => { void ask.discard(open); }}>Discard</Button>}
              {rights.approve && can.approve(open) && <Button leftIcon={<Check aria-hidden />} onClick={() => { void ask.approve(open); }}>Approve</Button>}
              {rights.share && can.withdraw(open) && <Button leftIcon={<Unlink aria-hidden />} onClick={() => { void ask.withdraw(open); }}>Withdraw the link</Button>}
              <Button href={openHref(open)} variant="primary" rightIcon={<ArrowUpRight aria-hidden />}>Open the report</Button>
            </div>
          ) : undefined}
        >
          {open && (
            <div className="flex flex-col gap-[16px]">
              <div className="flex flex-wrap items-center gap-[8px]">{state(open)}</div>
              <FactList min={150}>
                <Fact label="Generated">{open.generated_at ? <>{formatDateTime(open.generated_at)}{open.generated_by ? <span className={MUTED}> by {open.generated_by}</span> : null}</> : null}</Fact>
                <Fact label="Approved" empty="Not yet">{open.approved_at ? <>{formatDateTime(open.approved_at)}{open.approved_by ? <span className={MUTED}> by {open.approved_by}</span> : null}</> : null}</Fact>
                {open.period_start && open.period_end && <Fact label="Period">{formatDate(open.period_start, { calendar: true })} to {formatDate(open.period_end, { calendar: true })}</Fact>}
                {open.share.active && <Fact label="Examiner’s link">Until {day(open.share.expires_at)}</Fact>}
                {open.share.active && <Fact label="Views">{open.share.views}{open.share.last_viewed_at ? <span className={MUTED}> · last {formatDateTime(open.share.last_viewed_at)}</span> : null}</Fact>}
              </FactList>
              {rights.share && can.share(open) && (
                <div className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border p-[12px]">
                  <p className="text-ds-body font-[600] text-ds-fg">Share with an examiner</p>
                  <p className="text-ds-body text-ds-fg-muted">A link that needs no sign-in. Every view is logged, and you can withdraw it at any time.</p>
                  <div className="flex flex-wrap items-center gap-[8px]">
                    <Select aria-label="The link lasts" className="!w-[140px]" value={String(shareDays[open.id] ?? DEFAULT_SHARE_DAYS)} onChange={(e) => setShareDays({ ...shareDays, [open.id]: Number(e.target.value) })}>
                      {SHARE_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}
                    </Select>
                    <Button leftIcon={<Link2 aria-hidden />} loading={share.isPending} onClick={() => { void ask.share(open); }}>Share with an examiner</Button>
                  </div>
                </div>
              )}
              {!open.approved_at && !rights.approve && <p className={`text-ds-body ${MUTED}`}>A report is approved by someone with the approval right before it can be shared.</p>}
              <p className="text-ds-label text-ds-fg-muted">A kept report is frozen: it shows what was true when it was generated. <Link href={openHref(open)} className={LINK}>Open it to read or print it.</Link></p>
            </div>
          )}
        </RecordDetail>
      )}
    />
    {confirmDialog}
    </>
  );
}
