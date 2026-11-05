'use client';

// The department table of At a glance: a row for each department of the view, from the top down, with the documents filed in it and in the ones under it, and the
// columns of the group the person chose: by status, by type, waiting on people, reviews, or issues. A department's name opens its own view; every figure
// opens the library on exactly what it counts (or is text, where the library cannot filter on it). Which columns there are and what each opens is _matrix.ts
// (tested). On the whole organisation the last row adds the departments up. Below 768px each department is a card.
import Link from 'next/link';
import { clsx } from 'clsx';
import { CornerDownRight } from 'lucide-react';
import { RegisterTable, SectionCard, SegmentedControl, type RegisterColumn } from '@/components/ui/ds';
import { EMPTY } from '@/lib/format';
import { Figure } from './_Figure';
import { TABLE_MEASURES, columnsFor, matrixLines, matrixTotals, type MatrixCell, type MatrixColumn, type MatrixLine, type MeasureId } from './_matrix';
import { figureHref, type Overview } from './_model';
import { viewHref, type GroupId, type ViewId } from './_views';

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
const NAME_LINK = `rounded-ds-control font-medium text-ds-fg hover:underline ${FOCUS}`;
const INFO = 'One row for each department of this view, from the top down; each counts the documents filed in it and in the ones under it. Open a department for its own view; a figure opens the library on those documents.';

interface Item {
  id: string;
  /** null: the row that adds the departments up */
  line: MatrixLine | null;
  documents: { value: number; href: string | null };
  cells: MatrixCell[];
}

/** The department's name, indented under its parent; the name opens the department's own view (not on the row that is this page). */
function DepartmentName({ line, flat = false }: { line: MatrixLine; flat?: boolean }) {
  const { row } = line;
  const off = !row.is_active;
  const name = line.open ? (
    <Link href={line.open} title={line.title} className={clsx('line-clamp-2 min-w-0 break-words', NAME_LINK, off && '!text-ds-fg-muted')}>{row.name}</Link>
  ) : (
    <span title={line.title} className={clsx('line-clamp-2 min-w-0 break-words font-[600]', off ? 'text-ds-fg-muted' : 'text-ds-fg')}>{row.name}</span>
  );
  const depth = flat ? 0 : row.depth;
  return (
    <span className="flex min-w-0 items-center gap-[6px]" style={{ paddingLeft: Math.min(depth, 4) * 20 }}>
      {depth > 0 && <CornerDownRight aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" />}
      {name}
    </span>
  );
}

/** The rows: every department in the tree's order, and on the whole organisation the sum of them. */
function itemsOf(data: Overview, columns: readonly MatrixColumn[], open: (dept: string) => string): Item[] {
  const items = matrixLines(data, columns, open).map((line): Item => ({ id: line.row.key, line, cells: line.cells, documents: { value: line.row.documents, href: figureHref(data, line.row.key) } }));
  if (!data.scope.whole_organisation || items.length < 2) return items;
  return [...items, { id: 'total', line: null, cells: matrixTotals(data, columns), documents: { value: data.totals.documents, href: figureHref(data, 'totals.documents') } }];
}

const placeOf = (item: Item): string => (item.line ? `${item.line.row.name}${item.line.row.department_id === null ? '' : ' and under it'}` : 'all departments');
/** The kit's header is one line; a figure's name may wrap (!whitespace-normal), so six columns fit beside the department name on a laptop. */
const FIGURE_WIDTH = 'w-[92px] !whitespace-normal';
const BOLD = '!font-[600]';

function columnsOf(measure: readonly MatrixColumn[]): RegisterColumn<Item>[] {
  return [
    { key: 'department', header: 'Department', isRowHeader: true, width: 'w-[26%]', cell: (i) => (i.line ? <DepartmentName line={i.line} /> : <span className="font-[600] text-ds-fg">Total</span>) },
    { key: 'documents', header: 'Documents', align: 'right', card: 'meta', width: FIGURE_WIDTH, cell: (i) => <Figure value={i.documents.value} href={i.documents.href} noun={`documents in ${placeOf(i)}`} className={i.line ? undefined : BOLD} /> },
    ...measure.map((c, n): RegisterColumn<Item> => ({
      key: c.id, header: c.label, align: 'right', card: 'meta', width: FIGURE_WIDTH,
      cell: (i) => <Figure value={i.cells[n].value} href={i.cells[n].href} noun={`${c.noun} in ${placeOf(i)}`} tone={c.tone} className={i.line ? undefined : BOLD} />,
    })),
    { key: 'owner', header: 'Owner', priority: 3, card: 'meta', width: 'w-[160px]', cell: (i) => <span className="line-clamp-1 break-words text-ds-fg-body" title={i.line?.row.owner ?? undefined}>{i.line?.row.owner ?? EMPTY}</span> },
  ];
}

export function MatrixCard({ data, measure, onMeasure, view, group }: {
  data: Overview;
  measure: MeasureId;
  onMeasure: (next: MeasureId) => void;
  /** the view the person is in, so opening a department stays in it */
  view: ViewId;
  group: GroupId;
}) {
  const columns = columnsFor(measure, data);
  const items = itemsOf(data, columns, (dept) => viewHref(dept, view, group, measure));
  return (
    <SectionCard
      id="departments"
      title="By department"
      info={`${INFO} ${TABLE_MEASURES.find((m) => m.id === measure)?.info ?? ''}`.trim()}
      actions={<SegmentedControl label="Columns" name="overview-measure" options={TABLE_MEASURES.map((m) => ({ value: m.id, label: m.label }))} value={measure} onChange={onMeasure} />}
    >
      <RegisterTable<Item>
        caption="Documents by department"
        columns={columnsOf(columns)}
        rows={items}
        getRowId={(i) => i.id}
        cardTitle={(i) => (i.line ? <DepartmentName line={i.line} flat /> : <span className="font-[600] text-ds-fg">Total</span>)}
        empty={<div className="px-[16px] py-[24px] text-center text-ds-body text-ds-fg-muted">No departments</div>}
      />
    </SectionCard>
  );
}
