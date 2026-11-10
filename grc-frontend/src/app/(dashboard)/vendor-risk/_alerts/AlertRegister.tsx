'use client';

// Monitoring > Alerts: ONE register of every monitoring signal (a breach, adverse media, a flaw in software a supplier runs, a rating that fell, a certificate about to lapse...). It replaces
// the Signals feed and the Breach alerts page, which showed the same records two ways and disagreed about them: an alert acknowledged in the feed read as "closed" in the other and was never
// decided. Here Acknowledged and Closed are two states, the severity sort and the reassessment filter act on every signal (the feed sorted the 25 of a page), and the list says when it is cut.
// The explorer is components/records/RegisterFrame (the one wiring the registers share); this file is the Alerts configuration: the data (one request, read whole), the actions of a row and
// of the ticked rows, the Board by status, the period, importing ratings, and the drawer. The facets, chips and sorts are alertModel.ts.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Eye, Flag, Radar, Search, Upload } from 'lucide-react';
import {
  Button, EmptyState, Menu, Notice, StatusPill, useAddressState, useConfirm, useNotify, useReportedMutation, type MenuItem,
} from '@/components/ui/ds';
import { oneOf } from '@/lib/addressState';
import { OwnerCell } from '@/components/records/cells';
import { useCurrentUserId } from '@/components/records/lookups';
import { RegisterFrame } from '@/components/records/RegisterFrame';
import type { BulkActionDef } from '@/components/records/BulkBar';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCount, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { alertStage, signalKind, signalSeverity } from '@/lib/statuses/vendorMonitoring';
import { vendorTier } from '@/lib/statuses/vendor';
import { ALERT_REFRESH, READ_LIMIT, acknowledgeSignal, dismissSignal, moveAlert, raiseSignalFinding, useAlerts, useProviders } from './alertsApi';
import { AlertDrawer } from './AlertDrawer';
import { ALERT_SCHEMA, PERIODS, alertDef, headLine, periodLabel, registerAddress, rowActions, titleOf, type AlertRow, type RowAction } from './alertModel';
import { ImportRatings } from './ImportRatings';
import OwnLeaks from './OwnLeaks';

const MUTED = 'text-ds-fg-muted';
const PERIOD_SCHEMA = { days: oneOf(PERIODS.map((p) => String(p.days)), String(PERIODS[0].days)) };

const Severity = ({ r }: { r: AlertRow }) => <StatusPill size="sm" {...statusPill(signalSeverity, r.severity ?? 'medium')} />;
const Stage = ({ r }: { r: AlertRow }) => <StatusPill size="sm" {...statusPill(alertStage, r.stage)} />;
const supplierLine = (r: AlertRow): string => [r.vendor.name, signalKind.label(r.type), r.source || 'Entered by hand'].join(' · ');

export interface AlertHeadProps { meta?: string; actions: ReactNode }

export default function AlertRegister({ label, head }: { label: string; head: (h: AlertHeadProps) => ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission } = usePermissions();
  // The server accepts a write behind the module's own right or the risk-edit right that stands in for it; the buttons follow it exactly.
  const canEdit = hasPermission('vendor_risk:monitoring:edit') || hasPermission('erm:risks:edit');
  const canRaise = hasPermission('vendor_risk:findings:create') || hasPermission('erm:risks:edit');
  const canImport = hasPermission('vendor_risk:monitoring:create') || canEdit;
  const me = useCurrentUserId();
  const def = useMemo(() => alertDef(me), [me]);
  const [{ days }, setPeriod] = useAddressState(PERIOD_SCHEMA);
  const [importing, setImporting] = useState(false);

  // the address of the old Breach alerts page (?alert=41: e-mails, reminders, the Attention queue) opens that alert here
  useEffect(() => {
    const next = registerAddress(search?.toString() ?? '');
    if (next !== null) router.replace(next ? `${pathname}?${next}` : pathname);
  }, [search, pathname, router]);

  const list = useAlerts(Number(days));
  const feeds = useProviders();
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);

  const refresh = ALERT_REFRESH.map((k) => [...k]);
  const ack = useReportedMutation({
    mutationFn: async (r: AlertRow) => acknowledgeSignal(r.id),
    success: (_d, r) => `Acknowledged: ${titleOf(r)}`, failure: "Couldn't acknowledge it", invalidate: refresh,
  });
  const investigate = useReportedMutation({
    mutationFn: async (r: AlertRow) => moveAlert({ id: r.id, status: 'investigating' }),
    success: (_d, r) => `You are investigating: ${titleOf(r)}`, failure: "Couldn't take it on", invalidate: refresh,
  });
  const dismiss = useReportedMutation({
    mutationFn: async (r: AlertRow) => dismissSignal(r.id),
    success: (_d, r) => `Dismissed: ${titleOf(r)}`, failure: "Couldn't dismiss it", invalidate: refresh,
  });
  const raise = useReportedMutation({
    mutationFn: async (r: AlertRow) => raiseSignalFinding(r.id),
    success: (_d, r) => `Raised as a finding on ${r.vendor.name}`, failure: "Couldn't raise a finding", invalidate: [...refresh, ['tprm-findings']],
  });

  const act = async (action: RowAction, r: AlertRow) => {
    if (action === 'acknowledge') ack.mutate(r);
    else if (action === 'investigate') investigate.mutate(r);
    else if (action === 'dismiss') {
      const yes = await confirm({ title: 'Dismiss this signal?', message: 'There is nothing to act on. It stays on the list as not relevant and leaves the Attention queue.', confirmLabel: 'Dismiss' });
      if (yes) dismiss.mutate(r);
    } else {
      const yes = await confirm({ title: 'Raise this as a finding?', message: `It becomes a finding on ${r.vendor.name}'s current assessment, with its sources.`, confirmLabel: 'Raise finding' });
      if (yes) raise.mutate(r);
    }
  };
  const ACTION_ITEM: Record<RowAction, { label: string; icon: typeof Check; danger?: boolean }> = {
    acknowledge: { label: 'Acknowledge', icon: Check }, investigate: { label: 'Investigate', icon: Search }, dismiss: { label: 'Dismiss: nothing to act on', icon: Eye }, raise_finding: { label: 'Raise a finding', icon: Flag },
  };
  const rowMenu = (r: AlertRow) => {
    const items: MenuItem[] = rowActions(r, { edit: canEdit, raise: canRaise }).map((a) => ({ key: a, label: ACTION_ITEM[a].label, icon: ACTION_ITEM[a].icon, onSelect: () => { void act(a, r); } }));
    return items.length > 0 ? <Menu iconOnly label={`Actions for ${titleOf(r).slice(0, 60)}`} items={items} /> : null;
  };

  const bulkAcknowledge = async (ids: number[], clear: () => void) => {
    const yes = await confirm({
      title: `Acknowledge ${formatCount(ids.length)} ${ids.length === 1 ? 'signal' : 'signals'}?`,
      message: 'They are marked as seen and stay open for a decision. Nobody is asked to work them, and they leave the Attention queue.',
      confirmLabel: `Acknowledge ${formatCount(ids.length)}`,
    });
    if (!yes) return;
    let failed = 0;
    for (const id of ids) {
      try { await acknowledgeSignal(id); } catch { failed += 1; }
    }
    ALERT_REFRESH.forEach((k) => { void qc.invalidateQueries({ queryKey: [...k] }); });
    if (failed === 0) notify.success(`${formatCount(ids.length)} ${ids.length === 1 ? 'signal' : 'signals'} acknowledged`);
    else notify.error(`${formatCount(failed)} of ${formatCount(ids.length)} could not be acknowledged. The others were.`, { title: 'Some signals were not acknowledged' });
    clear();
  };

  const columns: RecordColumn<AlertRow>[] = [
    {
      key: 'title', header: 'Alert',
      cell: (row) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={titleOf(row.record)}>{titleOf(row.record)}</span>
          <span className={`block truncate text-ds-label ${MUTED}`}>{supplierLine(row.record)}{row.record.vendor.tier ? ` · ${vendorTier.label(row.record.vendor.tier)} tier` : ''}</span>
          {(!row.record.verified || row.record.triggered_reassessment) && (
            <span className="mt-[2px] flex flex-wrap gap-[4px]">
              {!row.record.verified && <StatusPill size="sm" tone="neutral" label="Unverified" />}
              {row.record.triggered_reassessment && <StatusPill size="sm" tone="progress" label="Reopened an assessment" />}
            </span>
          )}
        </div>
      ),
    },
    { key: 'severity', header: 'Severity', sortKey: 'severity', firstDir: 'asc', fit: { px: 104 }, cell: (row) => <Severity r={row.record} /> },
    { key: 'stage', header: 'Status', sortKey: 'stage', fit: { px: 140 }, cell: (row) => <Stage r={row.record} /> },
    { key: 'date', header: 'Date', sortKey: 'occurred', firstDir: 'desc', fit: { px: 116 }, cell: (row) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(row.record.occurred_at)}</span> },
    { key: 'owner', header: 'With', fit: { px: 96, dropRank: 1, wide: { px: 168, titleMin: 420 } }, cell: (row, look) => <OwnerCell name={row.record.owner?.name} wide={look.wide} /> },
  ];
  const card = (row: RecordRow<AlertRow>) => {
    const r = row.record;
    return (
      <div className="flex min-w-0 flex-col gap-[6px]">
        <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{titleOf(r)}</span>
        <span className="flex flex-wrap items-center gap-[8px]"><Severity r={r} /><Stage r={r} /></span>
        <span className={`truncate text-ds-label ${MUTED}`}>{[r.vendor.name, signalKind.label(r.type), formatDate(r.occurred_at)].join(' · ')}</span>
      </div>
    );
  };
  const boardCard = (r: AlertRow) => (
    <>
      <span className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{titleOf(r)}</span>
      <span className="flex flex-wrap items-center gap-[8px]"><Severity r={r} /></span>
      <span className={`truncate text-ds-label ${MUTED}`}>{[r.vendor.name, formatDate(r.occurred_at)].join(' · ')}</span>
    </>
  );

  const total = list.data?.total;
  const meta = list.data ? `${headLine(total ?? rows.length, list.data.stage_counts)} · ${periodLabel(Number(days)).toLowerCase()} and everything still open` : undefined;
  const periodItems: MenuItem[] = PERIODS.map((p, i) => ({
    key: `period:${p.days}`, label: p.label, checked: String(p.days) === days, radio: true, section: i === 0 ? 'Show' : undefined, onSelect: () => setPeriod({ days: String(p.days) as never }),
  }));
  const actions = (
    <>
      <Menu label="Period" items={periodItems} />
      {canImport && <Button leftIcon={<Upload aria-hidden />} onClick={() => setImporting(true)}>Import ratings</Button>}
    </>
  );
  const bulk = canEdit ? (ids: number[], clear: () => void) => ({
    actions: [{ id: 'ack', label: 'Acknowledge', icon: Check, onRun: () => { void bulkAcknowledge(ids, clear); } } as BulkActionDef],
  }) : undefined;
  const feedsOn = (feeds.data ?? []).filter((f) => f.configured).length;

  return (
    <>
      <RegisterFrame
        def={def}
        schema={ALERT_SCHEMA}
        label={label}
        rows={rows}
        loading={list.isLoading}
        error={list.isError && !list.data ? list.error : undefined}
        refreshError={list.isError && list.data ? list.error : undefined}
        onRetry={() => { void list.refetch(); }}
        head={() => head({ meta, actions })}
        notices={list.data?.truncated ? (
          <Notice tone="warning" title={`Showing the newest ${formatCount(rows.length)} signals`}>
            More than {formatCount(READ_LIMIT)} signals match this period. Choose a shorter period, or filter, to reach the rest.
          </Notice>
        ) : undefined}
        columns={columns}
        card={card}
        boardCard={boardCard}
        boardLabel={(r) => titleOf(r)}
        rowActions={rowMenu}
        rowLabel={(r) => `Select ${titleOf(r).slice(0, 60)}`}
        bulk={bulk}
        tickable={(r) => r.stage === 'new'}
        searchLabel="Search alerts by title, supplier, source, kind or who has them"
        noAccess={{ title: "You don't have access to monitoring", reason: errorMessage(list.error) }}
        emptyFirst={(
          <EmptyState
            bare kind="firstUse" icon={Radar} title="No monitoring signals yet"
            description={`Signals appear here when the feeds report a change (${feedsOn} ${feedsOn === 1 ? 'feed is' : 'feeds are'} on) or when one is recorded on a supplier.`}
            action={<Link href="/vendor-risk/settings#monitoring" className="text-ds-body text-ds-primary-text underline-offset-2 hover:underline">Turn on feeds in Settings</Link>}
          />
        )}
        detail={(open, nav) => <AlertDrawer row={open} nav={nav} canEdit={canEdit} canRaise={canRaise} />}
      />
      <div className="mt-[16px]"><OwnLeaks /></div>
      {canImport && <ImportRatings open={importing} onClose={() => setImporting(false)} feeds={feeds.data} />}
      {confirmDialog}
    </>
  );
}
