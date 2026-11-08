'use client';

/**
 * Business Continuity > Drills: the Drills & Invocations register on the facet explorer (_register/BcmRegister.tsx configured by drillsRegister.ts), with a read-only Board (Overdue, Scheduled,
 * In progress, Done). One lean request holds every drill; "Overdue" is the server's word for a drill still scheduled whose day has begun, and the quick views chase what the Overview counts
 * (overdue, the next 30 days, drills that still need a result, open findings). Schedule drill, Delete and Change status keep the rights the page has always asked for
 * (`bcm:drills:create|delete|edit`). The filters, sort, view and the drill open live in the address (?status=overdue ?source=incident_triggered ?type= ?q= ?sort= ?new=1 keep working).
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Eye, Plus, Trash2 } from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { NOT_SET, formatCount, formatDateTime, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { drillStatus, drillType, sourceType } from '@/lib/statuses/bcm';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, Fact, FactList, Menu, SidePanel, StatusPill, useAddressState, useConfirm, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { ClampedText, MUTED_LINK } from '../_bcm-ui';
import { BcmRegister } from '../_register/BcmRegister';
import { DayCell, OwnerCell, PeekTitle, StepButtons, rowOf } from '../_register/bits';
import { schemaFor } from '../_register/registerModel';
import { BcmTabs } from '../_tabs/BcmTabs';
import { AREA } from '../_tabs/tabsModel';
import { DrillForm } from '../drills/_DrillForm';
import { REFRESH_ALL, useDrillsRegister, useMeId } from '../bcmData';
import { drillDeleteWords, drillMoves, plural, type DrillRow } from '../bcmModel';
import { DRILLS, isOpen } from './drillsConfig';

const SCHEMA = schemaFor(DRILLS);
const MUTED = 'text-ds-fg-muted';

const FIT: Record<'status' | 'scheduled' | 'findings' | 'owner', Omit<FitColumn, 'key'>> = {
  status: { px: 124 },
  scheduled: { px: 150, dropRank: 2 },
  findings: { px: 130, dropRank: 1 },
  owner: { px: 68, dropRank: 3, wide: { px: 176, titleMin: 420 } },
};

const recordHref = (id: number) => `/bcm/drills/${id}`;
/** "Core banking · Tabletop": the plan and the kind, in one line under the name. */
const subline = (d: DrillRow): string => [d.plan_title, drillType.label(d.drill_type), d.source_type === 'incident_triggered' ? sourceType.label(d.source_type) : null].filter(Boolean).join(' · ');

function ScheduledCell({ d, now }: { d: DrillRow; now: number }) {
  // a drill that is under way or finished has no lateness; its day is just the day
  return <DayCell value={d.scheduled_date} now={now} noun="Starts" late={isOpen(d) && d.status === 'scheduled'} empty={NOT_SET} />;
}

function FindingsCell({ d }: { d: DrillRow }) {
  if (d.finding_count === 0) return <span className={`text-ds-body ${MUTED}`}>None</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-ds-body tabular-nums text-ds-fg">{plural(d.finding_count, 'finding')}</span>
      {d.open_finding_count > 0 ? <span className="text-ds-label font-[600] text-ds-warning">{`${formatCount(d.open_finding_count)} open`}</span> : <span className={`text-ds-label ${MUTED}`}>All closed</span>}
    </span>
  );
}

function columnsFor(env: { now: number; onPeek: (id: number) => void }): RecordColumn<DrillRow>[] {
  return [
    {
      key: 'title', header: 'Drill', sortKey: 'title',
      cell: (row) => <RowLead row={row}><PeekTitle href={recordHref(row.record.id)} title={row.record.title} onPeek={() => env.onPeek(row.record.id)} sub={subline(row.record)} /></RowLead>,
    },
    { key: 'status', header: 'Status', sortKey: 'status', fit: FIT.status, cell: (row) => <StatusPill size="sm" {...statusPill(drillStatus, row.record.effective_status)} /> },
    { key: 'scheduled', header: 'Scheduled', sortKey: 'scheduled', firstDir: 'desc', fit: FIT.scheduled, cell: (row) => <ScheduledCell d={row.record} now={env.now} /> },
    { key: 'findings', header: 'Findings', sortKey: 'findings', firstDir: 'desc', fit: FIT.findings, cell: (row) => <FindingsCell d={row.record} /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: FIT.owner, cell: (row, look) => <OwnerCell name={row.record.owner_name} withName={look.wide} /> },
  ];
}

function DrillCard({ row, now }: { row: RecordRow<DrillRow>; now: number }) {
  const d = row.record;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={d.title} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{d.title}</span>
      {d.plan_title && <span className={`truncate text-ds-label ${MUTED}`}>{d.plan_title}</span>}
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <StatusPill size="sm" {...statusPill(drillStatus, d.effective_status)} />
        <ScheduledCell d={d} now={now} />
        <span className="ml-auto"><OwnerCell name={d.owner_name} /></span>
      </span>
    </div>
  );
}

/** A card of the board: a name, the plan, and where it stands against its day. */
function BoardCard({ d, now }: { d: DrillRow; now: number }) {
  return (
    <>
      <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{d.title}</span>
      {d.plan_title && <span className={`truncate text-ds-label ${MUTED}`}>{d.plan_title}</span>}
      <span className="flex flex-wrap items-end gap-x-[8px] gap-y-[4px]">
        <ScheduledCell d={d} now={now} />
        <span className="ml-auto"><OwnerCell name={d.owner_name} /></span>
      </span>
    </>
  );
}

export function DrillsRegister() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('bcm:drills:create');
  const canEdit = hasPermission('bcm:drills:edit');
  const canDelete = hasPermission('bcm:drills:delete');
  const [address, setAddress] = useAddressState(SCHEMA);
  const query = useDrillsRegister();
  const me = useMeId();
  const { confirm, confirmDialog } = useConfirm();
  const now = useMemo(() => Date.now(), [query.rows]);          // eslint-disable-line react-hooks/exhaustive-deps

  const remove = useReportedMutation({
    mutationFn: async (d: DrillRow) => (await bcmApi.drills.remove(d.id)).data,
    success: 'Drill deleted', failure: "Couldn't delete the drill", invalidate: [...REFRESH_ALL],
    onSuccess: (_data, d) => { if (address.open === d.id) setAddress({ open: 0 }); },
  });
  const askDelete = async (d: DrillRow) => { if (await confirm({ ...drillDeleteWords(d), tone: 'danger' })) remove.mutate(d); };
  const move = useReportedMutation({
    mutationFn: async ({ d, status }: { d: DrillRow; status: string }) => (await bcmApi.drills.transition(d.id, status)).data,
    success: (_data, v) => `Drill moved to ${drillStatus.label(v.status)}`, failure: "Couldn't change the drill's status", invalidate: [...REFRESH_ALL, ['bcm-drill']],
  });

  const openDrill = (id: number) => router.push(recordHref(id));
  const rowMenu = (d: DrillRow) => {
    const items: MenuItem[] = [
      { key: 'peek', label: 'Open details', icon: Eye, onSelect: () => setAddress({ open: d.id }) },
      { key: 'open', label: 'Open drill', icon: ArrowUpRight, onSelect: () => openDrill(d.id) },
      { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canDelete, onSelect: () => { void askDelete(d); } },
    ];
    return <Menu iconOnly label={`Actions for ${truncate(d.title, 60).text}`} items={items} />;
  };

  const head = (compact: boolean, meta?: string) => (
    <div className="flex flex-col gap-[12px]">
      <PageHeader
        variant="page"
        title={AREA}
        info="Continuity tests of the plans and the real activations of them, with what each found."
        meta={meta}
        actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAddress({ new: true })}><span className={compact ? 'sr-only' : undefined}>Schedule drill</span></Button> : undefined}
      />
      <BcmTabs />
    </div>
  );

  return (
    <>
      <BcmRegister
        def={DRILLS}
        address={address}
        setAddress={setAddress}
        query={query}
        me={me}
        region="Drills and invocations"
        searchLabel="Search drills by title, plan or owner"
        head={(fit, meta) => head(fit.compact, meta)}
        columns={columnsFor({ now, onPeek: (id) => setAddress({ open: id }) })}
        card={(row) => <DrillCard row={row} now={now} />}
        rowMenu={rowMenu}
        boardCard={(d) => <BoardCard d={d} now={now} />}
        nameOf={(d) => d.title}
        failureTitle="Couldn't load the drills"
        refusalTitle="You don't have access to the drills"
        firstUse={(
          <EmptyState
            kind="firstUse" bare title="No drills yet"
            description={canCreate ? 'Schedule a continuity test or link a real incident-triggered invocation.' : 'No drill has been scheduled yet.'}
            action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAddress({ new: true })}>Schedule drill</Button> : undefined}
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
            actions={row && <StepButtons noun="drill" hasPrev={hasPrev} hasNext={hasNext} onStep={onStep} />}
            footer={row && (
              <div className="flex flex-wrap items-center gap-[8px]">
                <Button variant="primary" rightIcon={<ArrowUpRight aria-hidden />} onClick={() => openDrill(row.id)}>Open drill</Button>
                {canEdit && (
                  <Menu label="Change status" align="end" items={drillMoves(row.status).map((s) => ({ key: s, label: drillStatus.label(s), onSelect: () => move.mutate({ d: row, status: s }) }))} />
                )}
              </div>
            )}
          >
            {row && <DrillDetails d={row} now={now} />}
          </SidePanel>
        )}
      />
      {address.new && canCreate && <DrillForm mode={{ kind: 'create' }} onClose={() => setAddress({ new: false })} />}
      {confirmDialog}
    </>
  );
}

/** What the panel says about a drill: where it stands, then the facts a follow-up starts from. */
function DrillDetails({ d, now }: { d: DrillRow; now: number }) {
  return (
    <div className="flex flex-col gap-[16px] p-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <StatusPill size="md" {...statusPill(drillStatus, d.effective_status)} />
        {['in_progress', 'completed', 'under_review'].includes(d.status) && !d.has_result && <StatusPill size="md" tone="warning" label="Needs a result" />}
        {d.open_finding_count > 0 && <StatusPill size="md" tone="warning" label={`${plural(d.open_finding_count, 'open finding')}`} />}
      </div>
      <FactList min={150}>
        <Fact label="Plan">{d.plan_title ? <Link href={`/bcm/plans/${d.plan_id}`} className={MUTED_LINK}>{d.plan_title}</Link> : null}</Fact>
        <Fact label="Type">{drillType.label(d.drill_type)}</Fact>
        <Fact label="Source">{sourceType.label(d.source_type)}</Fact>
        <Fact label="Scheduled" empty="Not set">{d.scheduled_date ? <ScheduledCell d={d} now={now} /> : null}</Fact>
        <Fact label="Started" empty="Not started">{d.actual_start ? formatDateTime(d.actual_start) : null}</Fact>
        <Fact label="Ended" empty="Not ended">{d.actual_end ? formatDateTime(d.actual_end) : null}</Fact>
        <Fact label="Owner" empty="Unassigned">{d.owner_name ? <OwnerCell name={d.owner_name} withName /> : null}</Fact>
        <Fact label="Result">{d.has_result ? 'Recorded' : 'Not recorded'}</Fact>
        <Fact label="Findings">{d.finding_count === 0 ? 'None' : `${formatCount(d.finding_count)}, ${formatCount(d.open_finding_count)} open`}</Fact>
        {d.source_type === 'incident_triggered' && <Fact label="Incident">{d.linked_incident_title}</Fact>}
      </FactList>
    </div>
  );
}
