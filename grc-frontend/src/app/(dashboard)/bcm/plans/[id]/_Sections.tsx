'use client';

// The "Drills" tab of a plan: the plan's drills (a row opens the drill) with Schedule drill. They come with the plan (the server sends every drill of the plan, so the count is true), as the
// kit's RegisterTable (cards below 768px) with a Pager, sorted on the client. A person who may not schedule drills sees the same list with no button.
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { NOT_SET, formatCount, formatDate } from '@/lib/format';
import { drillStatus, drillType, sourceType } from '@/lib/statuses/bcm';
import { Button, EmptyState, Pager, RegisterTable, SectionCard, type RegisterColumn, type SortState } from '@/components/ui/ds';
import { Pill, TitleLink } from '../../_bcm-ui';
import { drillSortValue, ordered, pageOf, plural, type Drill } from '../../bcmModel';

const MUTED = 'text-ds-fg-muted';
const SIZES = [10, 25, 50] as const;
const DRILL_NOUN = { one: 'drill', other: 'drills' };

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
