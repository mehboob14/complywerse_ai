'use client';

/**
 * Business Continuity > Plans: the Continuity Plans register on the facet explorer (_register/BcmRegister.tsx configured by plansRegister.ts). One lean request holds every plan, so every
 * count, facet number and the export are over all of them; the quick views chase what the Overview counts (review due, not tested in 12 months, no recovery strategy). A row opens its details
 * panel (a plain click) or the plan's page (a modified click, "Open plan"). Add plan, Delete and Change status keep the rights the page has always asked for
 * (`bcm:plans:create|delete|edit`); a delete asks first and names what goes with the plan. The filters, sort and the plan open live in the address (?status= ?q= ?sort= ?new=1 ... keep working).
 */
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Eye, Plus, Trash2 } from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { NOT_SET, formatCount, formatDate, truncate } from '@/lib/format';
import { frequency, planStatus, testedState } from '@/lib/statuses/bcm';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, Fact, FactList, Menu, StatusPill, useAddressState, useConfirm, useReportedMutation, SidePanel, type MenuItem } from '@/components/ui/ds';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { statusPill } from '@/lib/status';
import { ClampedText, HoursText, TitleLink } from '../_bcm-ui';
import { BcmRegister } from '../_register/BcmRegister';
import { DayCell, OwnerCell, PeekTitle, StepButtons, rowOf } from '../_register/bits';
import { schemaFor } from '../_register/registerModel';
import { BcmTabs } from '../_tabs/BcmTabs';
import { AREA } from '../_tabs/tabsModel';
import { PlanForm } from '../plans/_PlanForm';
import { REFRESH_ALL, useMeId, usePlansRegister } from '../bcmData';
import { dueWords, planDeleteWords, planMoves, plural, testedOf, windowOf, type PlanRow } from '../bcmModel';
import { PLANS, isActive } from './plansConfig';

const SCHEMA = schemaFor(PLANS);
const MUTED = 'text-ds-fg-muted';

const FIT: Record<'status' | 'review' | 'tested' | 'recovery' | 'owner', Omit<FitColumn, 'key'>> = {
  status: { px: 136 },
  review: { px: 150, dropRank: 3 },
  tested: { px: 160, dropRank: 1 },
  recovery: { px: 96, dropRank: 2 },
  owner: { px: 68, dropRank: 4, wide: { px: 176, titleMin: 420 } },
};

const recordHref = (id: number) => `/bcm/plans/${id}`;
/** "Retail · 3 processes · 2 drills": what a plan holds, in one line under its name. */
const subline = (p: PlanRow): string => [p.business_unit, plural(p.bia_count, 'process', 'processes'), plural(p.drill_count, 'drill')].filter(Boolean).join(' · ');

function ReviewCell({ p, now }: { p: PlanRow; now: number }) {
  if (!isActive(p)) return <span className={`text-ds-body ${MUTED}`}>{p.next_review_due ? formatDate(p.next_review_due, { calendar: true }) : NOT_SET}</span>;
  return <DayCell value={p.next_review_due} now={now} noun="Review" empty={NOT_SET} />;
}

function TestedCell({ p, now }: { p: PlanRow; now: number }) {
  const state = testedOf(p.last_drill_at, now);
  if (!isActive(p)) return <span className={`text-ds-body ${MUTED}`}>{p.last_drill_at ? formatDate(p.last_drill_at, { calendar: true }) : '—'}</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className={`whitespace-nowrap text-ds-body ${p.last_drill_at ? 'text-ds-fg' : MUTED}`}>{p.last_drill_at ? formatDate(p.last_drill_at, { calendar: true }) : 'No drill yet'}</span>
      {state !== 'recent' && <span className={`truncate text-ds-label font-[600] ${state === 'never' ? 'text-ds-danger' : 'text-ds-warning'}`}>{testedState.label(state)}</span>}
    </span>
  );
}

interface Env {
  now: number;
  onPeek: (id: number) => void;
}

function columnsFor(env: Env): RecordColumn<PlanRow>[] {
  return [
    {
      key: 'title', header: 'Plan', sortKey: 'title',
      cell: (row) => <RowLead row={row}><PeekTitle href={recordHref(row.record.id)} title={row.record.title} onPeek={() => env.onPeek(row.record.id)} sub={subline(row.record)} /></RowLead>,
    },
    { key: 'status', header: 'Status', sortKey: 'status', fit: FIT.status, cell: (row) => <StatusPill size="sm" {...statusPill(planStatus, row.record.status)} /> },
    { key: 'review', header: 'Review due', sortKey: 'review', fit: FIT.review, cell: (row) => <ReviewCell p={row.record} now={env.now} /> },
    { key: 'tested', header: 'Last drill', sortKey: 'tested', firstDir: 'desc', fit: FIT.tested, cell: (row) => <TestedCell p={row.record} now={env.now} /> },
    {
      key: 'recovery', header: 'RTO / RPO', sortKey: 'rto', fit: FIT.recovery,
      cell: (row) => (row.record.rto_hours == null && row.record.rpo_hours == null
        ? <span className={`whitespace-nowrap text-ds-body ${MUTED}`}>{NOT_SET}</span>
        : <span className="inline-flex flex-wrap items-center gap-x-[6px]"><HoursText h={row.record.rto_hours} /><span aria-hidden className={MUTED}>/</span><HoursText h={row.record.rpo_hours} /></span>),
    },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: FIT.owner, cell: (row, look) => <OwnerCell name={row.record.owner_name} withName={look.wide} /> },
  ];
}

function PlanCard({ row, now }: { row: RecordRow<PlanRow>; now: number }) {
  const p = row.record;
  const late = isActive(p) && windowOf(p.next_review_due, now) === 'overdue';
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={p.title} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{p.title}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <StatusPill size="sm" {...statusPill(planStatus, p.status)} />
        {isActive(p) && p.next_review_due && <span className={`text-ds-label ${late ? 'font-[600] text-ds-danger' : MUTED}`}>{dueWords(p.next_review_due, now, 'Review')}</span>}
        <span className="ml-auto"><OwnerCell name={p.owner_name} /></span>
      </span>
    </div>
  );
}

export function PlansRegister() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('bcm:plans:create');
  const canEdit = hasPermission('bcm:plans:edit');
  const canDelete = hasPermission('bcm:plans:delete');
  const [address, setAddress] = useAddressState(SCHEMA);
  const query = usePlansRegister();
  const me = useMeId();
  const { confirm, confirmDialog } = useConfirm();
  const now = useMemo(() => Date.now(), [query.rows]);          // eslint-disable-line react-hooks/exhaustive-deps

  const remove = useReportedMutation({
    mutationFn: async (p: PlanRow) => (await bcmApi.plans.remove(p.id)).data,
    success: 'Plan deleted', failure: "Couldn't delete the plan", invalidate: [...REFRESH_ALL],
    onSuccess: (_data, p) => { if (address.open === p.id) setAddress({ open: 0 }); },
  });
  const askDelete = async (p: PlanRow) => { if (await confirm({ ...planDeleteWords(p), tone: 'danger' })) remove.mutate(p); };
  const move = useReportedMutation({
    mutationFn: async ({ p, status }: { p: PlanRow; status: string }) => (await bcmApi.plans.transition(p.id, status)).data,
    success: (_data, v) => `Plan moved to ${planStatus.label(v.status)}`, failure: "Couldn't change the plan's status", invalidate: [...REFRESH_ALL, ['bcm-plan']],
  });

  const openPlan = (id: number) => router.push(recordHref(id));
  const rowMenu = (p: PlanRow) => {
    const items: MenuItem[] = [
      { key: 'peek', label: 'Open details', icon: Eye, onSelect: () => setAddress({ open: p.id }) },
      { key: 'open', label: 'Open plan', icon: ArrowUpRight, onSelect: () => openPlan(p.id) },
      { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canDelete, onSelect: () => { void askDelete(p); } },
    ];
    return <Menu iconOnly label={`Actions for ${truncate(p.title, 60).text}`} items={items} />;
  };

  const head = (compact: boolean, meta?: string) => (
    <div className="flex flex-col gap-[12px]">
      <PageHeader
        variant="page"
        title={AREA}
        info="Business continuity plans: their recovery objectives, business impact analysis and drills."
        meta={meta}
        actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAddress({ new: true })}><span className={compact ? 'sr-only' : undefined}>Add plan</span></Button> : undefined}
      />
      <BcmTabs />
    </div>
  );

  return (
    <>
      <BcmRegister
        def={PLANS}
        address={address}
        setAddress={setAddress}
        query={query}
        me={me}
        region="Continuity plans"
        searchLabel="Search plans by title, business unit or owner"
        head={(fit, meta) => head(fit.compact, meta)}
        columns={columnsFor({ now, onPeek: (id) => setAddress({ open: id }) })}
        card={(row) => <PlanCard row={row} now={now} />}
        rowMenu={rowMenu}
        nameOf={(p) => p.title}
        failureTitle="Couldn't load the plans"
        refusalTitle="You don't have access to the continuity plans"
        firstUse={(
          <EmptyState
            kind="firstUse" bare title="No continuity plans yet"
            description={canCreate ? 'Create your first BCM plan to start tracking recovery objectives and drills.' : 'No continuity plan has been created yet.'}
            action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAddress({ new: true })}>Add plan</Button> : undefined}
          />
        )}
        drawer={({ row, onClose, onStep, hasPrev, hasNext }) => (
          <SidePanel
            open={!!row}
            onClose={onClose}
            title={<span dir="auto" className="line-clamp-3 break-words" title={row?.title}>{row?.title}</span>}
            subtitle={row ? subline(row) : undefined}
            dockFrom={Infinity}
            width="md"
            restoreFocus={rowOf(row?.id ?? null)}
            actions={row && <StepButtons noun="plan" hasPrev={hasPrev} hasNext={hasNext} onStep={onStep} />}
            footer={row && (
              <div className="flex flex-wrap items-center gap-[8px]">
                <Button variant="primary" rightIcon={<ArrowUpRight aria-hidden />} onClick={() => openPlan(row.id)}>Open plan</Button>
                {canEdit && (
                  <Menu label="Change status" align="end" items={planMoves(row.status).map((s) => ({ key: s, label: planStatus.label(s), onSelect: () => move.mutate({ p: row, status: s }) }))} />
                )}
              </div>
            )}
          >
            {row && <PlanDetails p={row} now={now} />}
          </SidePanel>
        )}
      />
      {address.new && canCreate && <PlanForm plan={null} onClose={() => setAddress({ new: false })} />}
      {confirmDialog}
    </>
  );
}

/** What the panel says about a plan: its state, then the figures a review starts from. */
function PlanDetails({ p, now }: { p: PlanRow; now: number }) {
  const active = isActive(p);
  return (
    <div className="flex flex-col gap-[16px] p-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <StatusPill size="md" {...statusPill(planStatus, p.status)} />
        {active && windowOf(p.next_review_due, now) === 'overdue' && <StatusPill size="md" tone="danger" label="Review overdue" />}
        {active && testedOf(p.last_drill_at, now) !== 'recent' && <StatusPill size="md" tone={testedOf(p.last_drill_at, now) === 'never' ? 'danger' : 'warning'} label={testedState.label(testedOf(p.last_drill_at, now))} />}
        {active && p.bia_incomplete > 0 && <StatusPill size="md" tone="warning" label={`${plural(p.bia_incomplete, 'process', 'processes')} without a strategy`} />}
      </div>
      {p.description && <ClampedText text={p.description} />}
      <FactList min={150}>
        <Fact label="Owner" empty="Unassigned">{p.owner_name ? <OwnerCell name={p.owner_name} withName /> : null}</Fact>
        <Fact label="Review due" empty="Not set">{p.next_review_due ? <DayCell value={p.next_review_due} now={now} noun="Review" late={active} /> : null}</Fact>
        <Fact label="RTO"><HoursText h={p.rto_hours} /></Fact>
        <Fact label="RPO"><HoursText h={p.rpo_hours} /></Fact>
        <Fact label="Testing cadence">{frequency.label(p.testing_frequency)}</Fact>
        <Fact label="Last drill" empty="No drill yet">{p.last_drill_at ? formatDate(p.last_drill_at, { calendar: true }) : null}</Fact>
        <Fact label="Business unit" empty="Not set">{p.business_unit}</Fact>
        <Fact label="Processes">{formatCount(p.bia_count)}</Fact>
        <Fact label="Drills">{formatCount(p.drill_count)}</Fact>
        <Fact label="Plan document" empty="Not set">{p.document_ref_id ? <TitleLink href={`/governance/documents/${p.document_ref_id}`} title={p.document_title || 'Open the document'} /> : null}</Fact>
      </FactList>
      {p.status === 'approved' && p.approved_date && <p className={`m-0 text-ds-label ${MUTED}`}>{`Approved ${formatDate(p.approved_date)}${p.approved_by_name ? ` by ${p.approved_by_name}` : ''}`}</p>}
    </div>
  );
}
