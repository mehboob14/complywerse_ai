'use client';

// The two lists of a plan's page: its business impact analysis (a row opens the process in its drawer) and its drills (a row opens the drill). Both come with the plan (the
// server sends every BIA record and every drill of the plan, so their counts are true), and both are the kit's RegisterTable (cards below 768px) with a Pager, sorted on the client.
// What a person without the right to change things sees is the same list with no "Add" button.
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Plus } from 'lucide-react';
import { NOT_SET, formatCount, formatDate } from '@/lib/format';
import { drillStatus, drillType, severity, sourceType } from '@/lib/statuses/bcm';
import { Button, EmptyState, Pager, RegisterTable, SectionCard, StatusPill, type RegisterColumn, type SortState } from '@/components/ui/ds';
import { HoursText, LINK, Pill, TitleLink } from '../../_parts';
import { biaCompleteness, biaSortValue, drillSortValue, ordered, pageOf, plural, type Bia, type Drill } from '../../bcmModel';

const MUTED = 'text-ds-fg-muted';
const SIZES = [10, 25, 50] as const;
const BIA_NOUN = { one: 'process', other: 'processes' };
const DRILL_NOUN = { one: 'drill', other: 'drills' };

/** The process name opens its drawer: a button that looks like the platform's links (it is not a link: it goes nowhere), with the counts the old card showed under it. */
function ProcessCell({ b, onOpen }: { b: Bia; onOpen: (id: number) => void }) {
  const assets = b.linked_assets?.length ?? 0;
  return (
    <div className="min-w-0">
      <button
        type="button" aria-haspopup="dialog" title={b.process_name} onClick={() => onOpen(b.id)}
        className={clsx('block w-full text-left [overflow-wrap:anywhere]', LINK)}
      >
        <span className="line-clamp-2">{b.process_name}</span>
      </button>
      <span className={`mt-[2px] block break-words text-ds-label font-normal ${MUTED}`}>
        {`${plural(assets, 'asset')} · ${plural(b.dependency_count, 'dependency', 'dependencies')} · ${plural(b.strategy_count, 'strategy', 'strategies')}`}
      </span>
    </div>
  );
}

export function BiaSection({ bia, canAdd, onOpen, onAdd }: { bia: Bia[]; canAdd: boolean; onOpen: (id: number) => void; onAdd: () => void }) {
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(25);
  const sorted = useMemo(() => ordered(bia, sort, biaSortValue), [bia, sort]);
  const { rows, range } = pageOf(sorted, page, size);

  const columns: RegisterColumn<Bia>[] = [
    { key: 'process', header: 'Process', isRowHeader: true, sortable: true, cell: (b) => <ProcessCell b={b} onOpen={onOpen} /> },
    { key: 'criticality', header: 'Criticality', width: 'w-[112px]', sortable: true, card: 'meta', cell: (b) => <Pill registry={severity} word={b.criticality_rating} /> },
    {
      key: 'rto', header: 'RTO', width: 'w-[68px]', align: 'right', priority: 2, sortable: true, card: 'meta', cardLabel: 'RTO / RPO / MTPD', cell: (b) => <HoursText h={b.rto_hours} />,
      cardCell: (b) => <span className="inline-flex flex-wrap items-center gap-x-[6px]"><HoursText h={b.rto_hours} /><span aria-hidden className={MUTED}>/</span><HoursText h={b.rpo_hours} /><span aria-hidden className={MUTED}>/</span><HoursText h={b.mtpd_hours} /></span>,
    },
    { key: 'rpo', header: 'RPO', width: 'w-[68px]', align: 'right', priority: 2, sortable: true, card: 'hide', cell: (b) => <HoursText h={b.rpo_hours} /> },
    { key: 'mtpd', header: 'MTPD', width: 'w-[76px]', align: 'right', priority: 3, sortable: true, card: 'hide', cell: (b) => <HoursText h={b.mtpd_hours} /> },
    {
      key: 'complete', header: 'Strategy', width: 'w-[140px]', priority: 2, sortable: true, card: 'meta', cardLabel: 'Recovery strategy',
      cell: (b) => {
        const done = biaCompleteness(b);
        return <span title={done.complete ? 'Has a recovery strategy' : 'Needs a recovery strategy'}><StatusPill size="sm" tone={done.complete ? 'success' : 'warning'} label={done.complete ? 'Complete' : 'Needs strategy'} /></span>;
      },
    },
  ];

  return (
    <SectionCard
      id="bia" title="Business impact analysis" meta={plural(bia.length, 'process', 'processes')}
      info="The critical processes this plan protects: how long each may be down (RTO), how much work may be lost (RPO) and the longest disruption the business can bear (MTPD). A process is complete once it has a recovery strategy."
      actions={canAdd ? <Button size="sm" leftIcon={<Plus aria-hidden />} onClick={onAdd}>Add process</Button> : undefined}
    >
      <RegisterTable
        caption="Business impact analysis processes"
        columns={columns}
        rows={rows}
        getRowId={(b) => b.id}
        sort={sort}
        onSortChange={(next) => { setSort(next); setPage(1); }}
        empty={<EmptyState bare kind="firstUse" title="No BIA processes yet" description={canAdd ? 'Add the critical processes this plan protects.' : 'No process has been added to this plan yet.'} action={canAdd ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onAdd}>Add process</Button> : undefined} />}
        cardTitle={(b) => <ProcessCell b={b} onOpen={onOpen} />}
        footer={bia.length > 0 ? <Pager page={range.page} pageSize={size} total={bia.length} noun={BIA_NOUN} pageSizes={SIZES} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} /> : undefined}
      />
    </SectionCard>
  );
}

export function DrillsSection({ drills, canSchedule, onSchedule }: { drills: Drill[]; canSchedule: boolean; onSchedule: () => void }) {
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(25);
  const sorted = useMemo(() => ordered(drills, sort, drillSortValue), [drills, sort]);
  const { rows, range } = pageOf(sorted, page, size);

  const columns: RegisterColumn<Drill>[] = [
    {
      key: 'title', header: 'Drill', isRowHeader: true, sortable: true,
      cell: (d) => (
        <div className="min-w-0">
          <TitleLink href={`/bcm/drills/${d.id}`} title={d.title} />
          <span className={`mt-[2px] block break-words text-ds-label font-normal ${MUTED}`}>{sourceType.label(d.source_type)}</span>
        </div>
      ),
    },
    { key: 'type', header: 'Type', width: 'w-[124px]', priority: 2, sortable: true, card: 'meta', cell: (d) => <span className="whitespace-nowrap">{drillType.label(d.drill_type)}</span> },
    { key: 'status', header: 'Status', width: 'w-[124px]', sortable: true, card: 'meta', cell: (d) => <Pill registry={drillStatus} word={d.effective_status} /> },
    {
      key: 'scheduled', header: 'Scheduled', width: 'w-[116px]', sortable: true, card: 'meta',
      cell: (d) => <span className={`whitespace-nowrap ${d.scheduled_date ? '' : MUTED}`}>{formatDate(d.scheduled_date, { calendar: true, empty: NOT_SET })}</span>,
    },
    { key: 'findings', header: 'Findings', width: 'w-[88px]', align: 'right', priority: 2, sortable: true, card: 'meta', cell: (d) => <span className="tabular-nums">{formatCount(d.finding_count)}</span> },
  ];

  return (
    <SectionCard
      id="drills" title="Drills" meta={plural(drills.length, 'drill')}
      info="The tests and real activations of this plan. A drill needs a recorded result before it can be closed."
      actions={canSchedule ? <Button size="sm" leftIcon={<Plus aria-hidden />} onClick={onSchedule}>Schedule drill</Button> : undefined}
    >
      <RegisterTable
        caption="Drills of this plan"
        columns={columns}
        rows={rows}
        getRowId={(d) => d.id}
        sort={sort}
        onSortChange={(next) => { setSort(next); setPage(1); }}
        empty={<EmptyState bare kind="firstUse" title="No drills yet" description={canSchedule ? 'Schedule a drill to test this plan.' : 'No drill has been scheduled for this plan yet.'} action={canSchedule ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onSchedule}>Schedule drill</Button> : undefined} />}
        cardTitle={(d) => <TitleLink href={`/bcm/drills/${d.id}`} title={d.title} />}
        footer={drills.length > 0 ? <Pager page={range.page} pageSize={size} total={drills.length} noun={DRILL_NOUN} pageSizes={SIZES} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} /> : undefined}
      />
    </SectionCard>
  );
}
