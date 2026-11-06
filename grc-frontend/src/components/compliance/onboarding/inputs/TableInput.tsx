'use client';

/**
 * A list of rows with typed columns (table): every row is a card of labelled cells, each cell the same input a single field of that type would be
 * (`cell`). With five columns or fewer, on a wide screen the rows line up under one header line; on a phone, or with more columns, every cell carries
 * its label and the row is a card. A row has the id it was given when it was made and keeps it for good: a framework scope picks rows by that id, and the
 * server keeps an id it receives. A row nobody has filled stays on the screen and is not sent (the server would drop it); a required cell left empty on a
 * row that has been started shows a quiet "Needed". The value handed to the page is always the whole list of started rows.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, useConfirm } from '@/components/ui/ds';
import type { Column, Field, Row } from '@/lib/frameworkOnboarding';
import { cleanRows, hasSingleControl, newRowId, rowMissing, rowStarted, sameRows, tableLayout } from '../fieldModel';
import { useDraft } from './useDraft';

const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? v : []).filter((r): r is Row => !!r && typeof r === 'object').map((r) => (typeof r.id === 'string' && r.id ? r : { ...r, id: newRowId() }));
const NARROW = 'grid grid-cols-1 gap-[8px] sm:grid-cols-2';

export default function TableInput({ id, label, field, value, onChange, readOnly = false, cell }: {
  id: string;
  label: string;
  field: Field;
  value: unknown;
  onChange: (rows: Row[]) => void;
  readOnly?: boolean;
  /** the input for one cell: the column, its value, how it changes, and an id for its control */
  cell: (column: Column, cellValue: unknown, set: (v: unknown) => void, cellId: string) => ReactNode;
}) {
  const cols = field.columns ?? [];
  const layout = tableLayout(cols);
  const { confirm, confirmDialog } = useConfirm();
  const [rows, setRows] = useDraft<Row[], unknown>(value, rowsOf, (draft, v) => sameRows(cols, draft, rowsOf(v)));
  const focusAfter = useRef<string | null>(null);

  const commit = (next: Row[]) => {
    setRows(next);
    if (!sameRows(cols, rows, next)) onChange(cleanRows(cols, next));            // adding or removing an unfilled row changes nothing the server keeps
  };
  const add = () => {
    const row = { id: newRowId() } as Row;
    focusAfter.current = `${id}-${row.id}-${cols[0]?.key}`;
    commit([...rows, row]);
  };
  const remove = async (row: Row) => {
    if (rowStarted(cols, row) && !(await confirm({ title: 'Remove this row?', message: 'What was entered in it is removed.', confirmLabel: 'Remove row', tone: 'danger' }))) return;
    commit(rows.filter((r) => r.id !== row.id));
  };
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target) document.getElementById(target)?.focus();
  });

  // one line of columns on a wide screen (grid layout); the template is a variable so the class stays a literal
  const lineStyle = { '--cols': `repeat(${cols.length}, minmax(0, 1fr)) var(--ds-control-h)` } as CSSProperties;

  return (
    <div role="group" aria-label={label} className="space-y-[8px]">
      {layout === 'grid' && rows.length > 0 && (
        <div aria-hidden style={lineStyle} className="hidden gap-[8px] px-[10px] xl:grid xl:[grid-template-columns:var(--cols)]">
          {cols.map((c) => <span key={c.key} className="min-w-0 truncate text-ds-label text-ds-fg-muted">{c.label}</span>)}
          <span />
        </div>
      )}
      {rows.length === 0 && <p className="text-ds-body text-ds-fg-muted">{readOnly ? 'No rows.' : 'No rows yet.'}</p>}
      {rows.map((row, i) => {
        const missing = readOnly ? [] : rowMissing(cols, row);
        return (
          <div key={row.id} role="group" aria-label={`${label}, row ${i + 1}`} className="rounded-ds-card border border-ds-border bg-ds-surface p-[10px]">
            <div style={lineStyle} className={layout === 'grid' ? `${NARROW} xl:[grid-template-columns:var(--cols)] xl:items-start` : `${NARROW} lg:grid-cols-3`}>
              {cols.map((c) => {
                const cellId = `${id}-${row.id}-${c.key}`;
                const labelClass = layout === 'grid' ? 'text-ds-label text-ds-fg-muted xl:sr-only' : 'text-ds-label text-ds-fg-muted';
                return (
                  <div key={c.key} className="min-w-0 space-y-[2px]">
                    {hasSingleControl(c)
                      ? <label htmlFor={cellId} className={`block ${labelClass}`}>{c.label}</label>
                      : <span id={`${cellId}-label`} className={`block ${labelClass}`}>{c.label}</span>}
                    {cell(c, row[c.key] ?? null, (v) => commit(rows.map((r) => (r.id === row.id ? { ...r, [c.key]: v } : r))), cellId)}
                    {missing.some((m) => m.key === c.key) && <span className="block text-ds-label text-ds-fg-muted">Needed</span>}
                  </div>
                );
              })}
              {!readOnly && (
                <div className={`flex justify-end sm:col-span-2 ${layout === 'grid' ? 'xl:col-span-1 xl:justify-self-end' : 'lg:col-span-3'}`}>
                  <IconButton label={`Remove row ${i + 1}`} onClick={() => { void remove(row); }}><Trash2 aria-hidden /></IconButton>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {!readOnly && <Button size="sm" leftIcon={<Plus aria-hidden />} onClick={add}>Add row</Button>}
      {confirmDialog}
    </div>
  );
}
