'use client';

/**
 * The controls of an assessment, the built-in lens of the Controls tab: search, filters kept in the address (a link lands on the same list), a List or By domain view, a table
 * whose row opens the control in a drawer (`?item=`), Add control for a person who may edit. Every number is a count of what is loaded (the whole assessment, never a page of it).
 * A lens registered for a format replaces this tab's body; the contract is lens.ts.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import {
  AccordionRow, Button, DebouncedSearch, EmptyState, FilterChips, MultiSelect, Notice, PersonStack, ProgressBar, RegisterTable, SegmentedControl, StatusPill, useAddressState,
  type FilterChip, type ListOption, type RegisterColumn,
} from '@/components/ui/ds';
import { integer, listOf, oneOf, sortOf, text, type AddressState } from '@/lib/addressState';
import { rowCountText } from '@/components/ui/ds/tableModel';
import { formatCount, formatDate, EMPTY } from '@/lib/format';
import { statusPill, priority as priorityWords } from '@/lib/status';
import { CONTROL_STATUS_ORDER, controlStatus } from '@/lib/statuses/assessments';
import {
  activeFilterCount, DEFAULT_SORT, dueMs, filterItems, groupByDomain, isOpenGap, neighbours, PRIORITIES, PRIORITY_LABEL, sortItems, type ItemFilters, type SlaDays, type Sort, type SortKey, type WorkItem,
} from './itemModel';
import { ItemDrawer } from './ItemDrawer';
import { AddControlPanel } from './AddControlPanel';

const SORT_KEYS = ['number', 'status', 'priority', 'due', 'evidence'] as const;
const SCHEMA = {
  q: text(),
  status: listOf(CONTROL_STATUS_ORDER),
  priority: listOf([...PRIORITIES, 'none']),
  domain: listOf(),
  evidence: oneOf(['any', 'with', 'without'] as const, 'any'),
  owner: oneOf(['any', 'unassigned'] as const, 'any'),
  gaps: oneOf(['0', '1'] as const, '0'),
  view: oneOf(['list', 'domain'] as const, 'list'),
  sort: sortOf(SORT_KEYS, null),
  item: integer(0, { min: 0 }),
};
type Address = AddressState<typeof SCHEMA>;

const PAGE = 100;
const filtersOf = (a: Address): ItemFilters => ({ q: a.q, status: a.status, priority: a.priority, domain: a.domain, evidence: a.evidence, owner: a.owner, gaps: a.gaps === '1' });

export function ItemsTab({ assessmentId, assessmentName, items, days, readOnly, structuredRemarks, onChanged }: {
  assessmentId: number;
  assessmentName: string;
  items: readonly WorkItem[];
  days: SlaDays;
  readOnly: boolean;
  structuredRemarks: boolean;
  onChanged: () => void;
}) {
  const [a, set] = useAddressState(SCHEMA);
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const f = filtersOf(a);
  const sort = (a.sort ?? DEFAULT_SORT) as Sort;
  const filtered = useMemo(() => sortItems(filterItems(items, f), sort, days), [items, a.q, a.status, a.priority, a.domain, a.evidence, a.owner, a.gaps, a.sort, days]);       // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupByDomain(filtered), [filtered]);
  const allDomains = useMemo(() => groupByDomain(items).map((g) => g.domain), [items]);
  const active = activeFilterCount(f);
  const open = a.item ? items.find((i) => i.id === a.item) ?? null : null;
  const near = neighbours(filtered, open?.id ?? null);

  const clear = () => { set({ q: '', status: [], priority: [], domain: [], evidence: 'any', owner: 'any', gaps: '0' }); setShown(PAGE); };
  const change = (patch: Partial<Address>) => { set(patch); setShown(PAGE); };

  const statusOptions: ListOption[] = CONTROL_STATUS_ORDER.map((s) => ({ value: s, label: controlStatus.label(s) }));
  const priorityOptions: ListOption[] = [...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })), { value: 'none', label: 'Not set' }];
  const domainOptions: ListOption[] = allDomains.map((d) => ({ value: d, label: d }));

  const counts = useMemo(() => ({
    gaps: items.filter(isOpenGap).length,
    unowned: items.filter((i) => i.assignees.length === 0 && !i.responsible).length,
    noEvidence: items.filter((i) => i.evidenceCount === 0).length,
  }), [items]);
  const chips: FilterChip[] = [
    { key: 'gaps', label: 'Open gaps', count: counts.gaps, active: a.gaps === '1' },
    { key: 'unassigned', label: 'No owner', count: counts.unowned, active: a.owner === 'unassigned' },
    { key: 'without', label: 'No evidence', count: counts.noEvidence, active: a.evidence === 'without' },
  ];
  const toggle = (key: string) => {
    if (key === 'gaps') change({ gaps: a.gaps === '1' ? '0' : '1' });
    else if (key === 'unassigned') change({ owner: a.owner === 'unassigned' ? 'any' : 'unassigned' });
    else change({ evidence: a.evidence === 'without' ? 'any' : 'without' });
  };

  const columns: Array<RegisterColumn<WorkItem>> = [
    {
      key: 'number', header: 'Control', isRowHeader: true, sortable: true, width: 'w-[38%]',
      cell: (it) => (
        <span className="block min-w-0">
          <span className="block text-ds-label text-ds-fg-muted">{it.number || EMPTY}</span>
          <span className="line-clamp-2 break-words text-ds-body text-ds-fg" title={it.description}>{it.description || EMPTY}</span>
        </span>
      ),
    },
    { key: 'domain', header: 'Domain', priority: 2, card: 'meta', cell: (it) => <span className="line-clamp-2 break-words text-ds-body text-ds-fg-body">{it.domain}</span> },
    { key: 'status', header: 'Answer', sortable: true, card: 'meta', cell: (it) => <StatusPill {...statusPill(controlStatus, it.status)} size="sm" /> },
    { key: 'priority', header: 'Priority', sortable: true, priority: 2, card: 'meta', cell: (it) => (it.priority ? <StatusPill {...statusPill(priorityWords, it.priority)} size="sm" /> : <span className="text-ds-body text-ds-fg-muted">{EMPTY}</span>) },
    {
      key: 'owner', header: 'Assigned to', priority: 2, card: 'meta',
      cell: (it) => <PersonStack people={it.assignees.map((x) => x.name)} size={24} max={2} label="Assigned to" emptyLabel={it.responsible || 'Unassigned'} />,
    },
    {
      key: 'due', header: 'Due', sortable: true, priority: 3, card: 'meta',
      cell: (it) => {
        if (!isOpenGap(it)) return <span className="text-ds-body text-ds-fg-muted">{EMPTY}</span>;
        const due = dueMs(it, days);
        if (due === null) return <span className="text-ds-body text-ds-fg-muted">No date</span>;
        const late = due < Date.now();
        return <span className={`text-ds-body ${late ? 'font-[600] text-ds-danger' : 'text-ds-fg-body'}`}>{formatDate(due, { calendar: true })}{late ? ' · overdue' : ''}</span>;
      },
    },
    { key: 'evidence', header: 'Files', sortable: true, align: 'right', priority: 3, card: 'meta', cell: (it) => <span className="text-ds-body tabular-nums text-ds-fg-body">{formatCount(it.evidenceCount)}</span> },
  ];

  const table = (rows: readonly WorkItem[], caption: string, footer?: ReactNode, sortable = true) => (
    <RegisterTable
      caption={caption} columns={sortable ? columns : columns.filter((c) => c.key !== 'domain')} rows={rows.slice()} getRowId={(r) => r.id}
      sort={sortable ? sort : undefined} onSortChange={sortable ? (next) => change({ sort: next ? { key: next.key as SortKey, dir: next.dir } : null }) : undefined}
      onRowActivate={(r) => set({ item: r.id })} selectedId={open?.id ?? null}
      cardTitle={(r) => <span className="block min-w-0"><span className="block text-ds-label text-ds-fg-muted">{r.number || EMPTY}</span><span className="line-clamp-3 break-words text-ds-body font-[600] text-ds-fg">{r.description}</span></span>}
      footer={footer}
    />
  );

  const listed = filtered.slice(0, shown);
  const count = rowCountText({ shown: listed.length, total: filtered.length, noun: 'control' });

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <DebouncedSearch className="w-full sm:w-[280px]" label="Search controls" placeholder="Search controls" value={a.q} onSearch={(q) => change({ q })} />
        <MultiSelect className="w-full sm:w-auto" label="Answer" showLabel placeholder="All" options={statusOptions} value={a.status} onChange={(v) => change({ status: v })} />
        <MultiSelect className="w-full sm:w-auto" label="Priority" showLabel placeholder="All" options={priorityOptions} value={a.priority} onChange={(v) => change({ priority: v })} />
        {allDomains.length > 1 && <MultiSelect className="w-full sm:w-auto" label="Domain" showLabel placeholder="All" options={domainOptions} value={a.domain} onChange={(v) => change({ domain: v })} />}
        <div className="ml-auto flex flex-wrap items-center gap-[8px]">
          <SegmentedControl label="View" name="controls-view" value={a.view} onChange={(view) => set({ view })} options={[{ value: 'list', label: 'List' }, { value: 'domain', label: 'By domain' }]} />
          {!readOnly && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add control</Button>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-[8px]">
        <FilterChips label="Quick filters" chips={chips} onToggle={toggle} />
        {active > 0 && <Button size="sm" variant="link" onClick={clear}>Clear filters</Button>}
        {count && <span className="ml-auto text-ds-label text-ds-fg-muted" role="status">{count}{active > 0 ? ` of ${formatCount(items.length)}` : ''}</span>}
      </div>

      {items.length === 0 ? (
        <EmptyState kind="firstUse" title="No controls yet" description={readOnly ? 'Nothing has been added to this assessment.' : 'Add a control, or refresh the assessment from its workbook.'} action={!readOnly ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add control</Button> : undefined} />
      ) : filtered.length === 0 ? (
        <EmptyState kind="noMatches" title="No control matches" description="Change or clear the filters." onClearFilters={clear} />
      ) : a.view === 'domain' ? (
        <div className="flex flex-col gap-[8px]">
          {groups.map((g, i) => (
            <AccordionRow key={g.domain} defaultOpen={i === 0 || active > 0} title={g.domain} meta={`${formatCount(g.items.length)} ${g.items.length === 1 ? 'control' : 'controls'} · ${formatCount(g.answered)} answered · ${formatCount(g.complied)} complied`}
              trailing={<span className="w-[96px]"><ProgressBar value={g.items.length ? Math.round((g.answered / g.items.length) * 100) : 0} label={`${g.domain} answered`} showValue={false} /></span>}>
              {table(sortItems(g.items, sort, days), `Controls in ${g.domain}`, undefined, false)}
            </AccordionRow>
          ))}
        </div>
      ) : (
        table(listed, 'Controls', filtered.length > shown ? (
          <div className="flex flex-wrap items-center justify-between gap-[8px] pt-[8px]">
            <span className="text-ds-label text-ds-fg-muted">{count}</span>
            <Button onClick={() => setShown((n) => n + PAGE)}>Show {formatCount(Math.min(PAGE, filtered.length - shown))} more</Button>
          </div>
        ) : undefined)
      )}

      {open && (
        <ItemDrawer assessmentId={assessmentId} assessmentName={assessmentName} item={open} domains={allDomains} days={days} readOnly={readOnly} structuredRemarks={structuredRemarks}
          prev={near.prev} next={near.next} onOpen={(id) => set({ item: id })} onClose={() => set({ item: 0 })} onChanged={onChanged} />
      )}
      {a.item > 0 && !open && (
        <Notice tone="warning" title="That control is not in this assessment" action={<Button size="sm" onClick={() => set({ item: 0 })}>Close</Button>}>It may have been deleted.</Notice>
      )}
      {adding && <AddControlPanel assessmentId={assessmentId} domains={allDomains} onClose={() => setAdding(false)} onAdded={onChanged} />}
    </div>
  );
}
