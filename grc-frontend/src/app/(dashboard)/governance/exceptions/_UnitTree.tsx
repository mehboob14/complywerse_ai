'use client';

// Exceptions > By unit: the units that have exceptions, as a tree table. A unit's row counts its own exceptions and everything under it (that is how the server
// counts: GET /policy-exceptions/by-unit), with the organisation's own word for its level ("Sub-department") as a small chip and a unit that was switched off
// muted. A row for the exceptions raised for no unit and a row of totals close the table. A press on a unit, or on one of its counts, opens the list of that
// unit and everything under it (the page does that: `onOpen`); the exceptions of no unit cannot be asked for by unit, so that row is plain. Zero is a dash.
// On a phone each unit is a card. The loading, empty and failed states are the register's own; a failed read is never an empty tree.
import { CornerDownRight, Network } from 'lucide-react';
import { clsx } from 'clsx';
import { EmptyState, RegisterTable, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { EMPTY, formatCount } from '@/lib/format';
import type { ByUnitAnswer, Counts, UnitRow } from './_types';

type Row =
  | { key: string; kind: 'unit'; unit: UnitRow; counts: Counts }
  | { key: 'none'; kind: 'none'; counts: Counts }
  | { key: 'total'; kind: 'total'; counts: Counts };

/** The counts, in the order the server lists them: the header, and what a screen reader hears after the number. */
const FIELDS: ReadonlyArray<{ key: keyof Counts; header: string; noun: string; width: string }> = [
  { key: 'total', header: 'Total', noun: 'exceptions', width: 'w-[84px]' },
  { key: 'open', header: 'Open', noun: 'open exceptions', width: 'w-[84px]' },
  { key: 'approved', header: 'Approved', noun: 'approved exceptions', width: 'w-[96px]' },
  { key: 'expiring', header: 'Expiring', noun: 'exceptions expiring soon', width: 'w-[92px]' },
  { key: 'to_implement', header: 'To implement', noun: 'exceptions to implement', width: 'w-[112px] !whitespace-normal' },
];

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
const PRESS = `rounded-ds-control text-ds-primary-text hover:underline ${FOCUS}`;

/** The unit's name under its parent, with its level; the name opens the list of the unit and everything under it. */
function UnitName({ row, onOpen, flat = false }: { row: Row; onOpen: (unit: number) => void; flat?: boolean }) {
  if (row.kind === 'none') return <span className="font-[600] text-ds-fg">No unit</span>;
  if (row.kind === 'total') return <span className="font-[600] text-ds-fg">All exceptions</span>;
  const { unit } = row;
  const depth = flat ? 0 : Math.min(unit.depth, 3);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px]" style={{ paddingLeft: depth * 20 }}>
      {depth > 0 && <CornerDownRight aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" />}
      <button
        type="button"
        onClick={() => onOpen(unit.department_id)}
        title={`Show the exceptions of ${unit.name} and everything under it`}
        className={clsx('min-w-0 break-words text-left font-medium', unit.is_active ? PRESS : `${PRESS} !text-ds-fg-muted`)}
      >
        {unit.name}
      </button>
      <span className="rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] text-ds-label text-ds-fg-muted">{unit.level_label}</span>
      {!unit.is_active && <span className="text-ds-label text-ds-fg-muted">Inactive</span>}
    </span>
  );
}

/** One count: a dash for none, the number for a total, a press for a unit's count (it opens that unit's list). */
function Count({ row, field, onOpen }: { row: Row; field: (typeof FIELDS)[number]; onOpen: (unit: number) => void }) {
  const n = row.counts[field.key];
  if (!n) return <span className="text-ds-fg-muted"><span aria-hidden>{EMPTY}</span><span className="sr-only">0</span></span>;
  if (row.kind !== 'unit') return <span className={clsx('tabular-nums', row.kind === 'total' && 'font-[600] text-ds-fg')}>{formatCount(n)}</span>;
  const { unit } = row;
  const itself = field.key === 'total' && unit.own !== n ? `${formatCount(unit.own)} raised for ${unit.name} itself` : undefined;
  return (
    <button type="button" onClick={() => onOpen(unit.department_id)} title={itself} aria-label={`${formatCount(n)} ${field.noun} in ${unit.name} and below. Show them`}
      className={clsx('inline-block min-w-[24px] text-right font-medium tabular-nums', PRESS)}>
      {formatCount(n)}
    </button>
  );
}

export function UnitTree({ query, onOpen }: {
  query: { data?: ByUnitAnswer; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  /** a unit was pressed: show the list of that unit and everything under it */
  onOpen: (unit: number) => void;
}) {
  const answer = query.data;
  const failed = query.isError && !answer;
  const rows: Row[] = answer ? [
    ...answer.units.map((unit): Row => ({ key: `u${unit.department_id}`, kind: 'unit', unit, counts: unit.counts })),
    ...(answer.no_unit.counts.total > 0 ? [{ key: 'none', kind: 'none', counts: answer.no_unit.counts } as Row] : []),
    ...(answer.totals.total > 0 ? [{ key: 'total', kind: 'total', counts: answer.totals } as Row] : []),
  ] : [];

  const columns: RegisterColumn<Row>[] = [
    { key: 'unit', header: 'Unit', isRowHeader: true, cell: (r) => <UnitName row={r} onOpen={onOpen} /> },
    ...FIELDS.map((f): RegisterColumn<Row> => ({
      key: f.key, header: f.header, align: 'right', width: f.width, card: 'meta',
      cell: (r) => <Count row={r} field={f} onOpen={onOpen} />,
    })),
  ];

  return (
    <RegisterTable<Row>
      caption="Exceptions by unit"
      columns={columns}
      rows={rows}
      getRowId={(r) => r.key}
      loading={query.isLoading}
      error={failed ? { message: `Could not load the units. ${errorMessage(query.error)}`, onRetry: canRetry(query.error) ? () => { void query.refetch(); } : undefined } : null}
      empty={<EmptyState kind="firstUse" bare icon={Network} title="No exceptions yet" />}
      cardTitle={(r) => <UnitName row={r} onOpen={onOpen} flat />}
    />
  );
}
