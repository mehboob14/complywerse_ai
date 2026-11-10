'use client';

// Calculated fields: three choices and a name — the recipes in ./calcColumns are enough for what GRC reports ask for (days open, days overdue, inherent minus residual, coverage %, banded scores),
// without a formula language. The preview is the point of the editor: a derived field is easy to define backwards, and the only way to notice is to see it worked out on real rows before it joins the
// report. This is the content of the "Calculated fields" sheet (the workspace draws the sheet); the markup is the kit's.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Checkbox, FormField, IconButton, Select, TextInput } from '@/components/ui/ds';
import type { ColumnDef, Row } from './types';
import { CALC_KINDS, DEFAULT_BANDS, TODAY, buildCalcColumn, calcIsComplete, needsSecondOperand, newCalcId, operandType, type CalcColumnDef, type CalcKind } from './calcColumns';
import { cellDisplay } from './builderUtils';

const PRESET_HINT: Record<CalcKind, string> = {
  days_between: 'Negative means the second date is earlier. For "days overdue" put the due date first and Today second.',
  difference: 'First minus second.',
  ratio: 'Not defined when the second value is zero: those rows stay blank rather than showing 0 or 100%.',
  bucket: 'Rows with no value stay blank; they are not put in the lowest band.',
  concat: '',
};

/** Which source columns can fill an operand slot for this recipe. */
function operandOptions(kind: CalcKind, cols: ColumnDef[]): ColumnDef[] {
  const want = operandType(kind);
  if (want === 'date') return cols.filter((c) => c.type === 'date');
  if (want === 'number') return cols.filter((c) => c.type === 'number');
  return cols.filter((c) => c.type !== 'number');
}

function OperandSelect({ kind, value, onChange, cols, placeholder, label }: { kind: CalcKind; value: string; onChange: (v: string) => void; cols: ColumnDef[]; placeholder: string; label: string }) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {kind === 'days_between' && <option value={TODAY}>Today (when the report runs)</option>}
      {operandOptions(kind, cols).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
    </Select>
  );
}

export default function CalcColumnPanel({
  cols, defs, rows, onChange, onAddToReport, onDraftChange,
}: {
  /** Source columns a calculation may reference (never other calculations). */
  cols: ColumnDef[];
  defs: CalcColumnDef[];
  /** Sample rows for the preview. */
  rows: Row[];
  onChange: (next: CalcColumnDef[]) => void;
  /** Put a freshly saved field straight onto the report. */
  onAddToReport: (key: string) => void;
  /** Tells the sheet around it whether a field is being edited (so closing it asks first). */
  onDraftChange?: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<CalcColumnDef | null>(null);
  useEffect(() => { onDraftChange?.(draft !== null); }, [draft, onDraftChange]);

  const startNew = () => setDraft({ id: newCalcId(), label: '', kind: 'days_between', a: '', b: TODAY });
  const patch = (p: Partial<CalcColumnDef>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const preview = useMemo(() => {
    if (!draft || !calcIsComplete(draft)) return null;
    const col = buildCalcColumn(draft, (k) => cols.find((c) => c.key === k));
    return { values: rows.slice(0, 5).map((r) => cellDisplay(col, r)) };
  }, [draft, cols, rows]);

  const save = () => {
    if (!draft || !calcIsComplete(draft)) return;
    const i = defs.findIndex((d) => d.id === draft.id);
    onChange(i >= 0 ? defs.map((d) => (d.id === draft.id ? draft : d)) : [...defs, draft]);
    onAddToReport(`calc_${draft.id}`);
    setDraft(null);
  };
  const remove = (id: string) => {
    onChange(defs.filter((d) => d.id !== id));
    if (draft?.id === id) setDraft(null);
  };

  const kindMeta = CALC_KINDS.find((k) => k.kind === draft?.kind);
  const bands = draft ? (draft.bands ?? DEFAULT_BANDS) : [];

  return (
    <div className="flex flex-col gap-[16px]">
      <p className="m-0 text-ds-label text-ds-fg-muted">Built from the columns of this module. Filter, group and chart them like any other field.</p>

      {defs.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
          {defs.map((d) => (
            <li key={d.id} className="flex items-center gap-[4px] rounded-ds-control border border-ds-border bg-ds-surface pl-[8px]">
              <button type="button" onClick={() => setDraft(d)} className="min-h-ds-control min-w-0 flex-1 rounded-ds-control py-[4px] text-left text-ds-body text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring [overflow-wrap:anywhere]">
                {d.label}
                <span className="ml-[6px] text-ds-label text-ds-fg-muted">{CALC_KINDS.find((k) => k.kind === d.kind)?.label}</span>
              </button>
              <IconButton label={`Add ${d.label} to the report`} onClick={() => onAddToReport(`calc_${d.id}`)}><Plus aria-hidden /></IconButton>
              <IconButton label={`Delete ${d.label}`} onClick={() => remove(d.id)}><Trash2 aria-hidden /></IconButton>
            </li>
          ))}
        </ul>
      )}

      {!draft ? (
        <Button leftIcon={<Plus aria-hidden />} onClick={startNew}>New calculated field</Button>
      ) : (
        <div className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
          <FormField label="Field name" required>
            <TextInput value={draft.label} maxLength={80} placeholder="For example Days open" onChange={(e) => patch({ label: e.target.value })} autoComplete="off" />
          </FormField>
          <FormField label="What to calculate">
            <Select
              value={draft.kind}
              onChange={(e) => {
                const kind = e.target.value as CalcKind;
                patch({ kind, a: '', b: kind === 'days_between' ? TODAY : '' });           // operands are type-scoped: a change of kind invalidates them
              }}
            >
              {CALC_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </Select>
          </FormField>
          {kindMeta && <p className="m-0 text-ds-label text-ds-fg-muted">{kindMeta.hint}</p>}

          <OperandSelect kind={draft.kind} label={draft.kind === 'days_between' ? 'From' : 'First field'} value={draft.a} onChange={(a) => patch({ a })} cols={cols} placeholder={draft.kind === 'days_between' ? 'From' : 'Choose a field'} />
          {needsSecondOperand(draft.kind) && (
            <>
              <span className="text-ds-label text-ds-fg-muted">{draft.kind === 'days_between' ? 'to' : draft.kind === 'difference' ? 'minus' : draft.kind === 'ratio' ? 'divided by' : 'followed by'}</span>
              <OperandSelect kind={draft.kind} label={draft.kind === 'days_between' ? 'To' : 'Second field'} value={draft.b ?? ''} onChange={(b) => patch({ b })} cols={cols} placeholder={draft.kind === 'days_between' ? 'To' : 'Choose a field'} />
            </>
          )}

          {draft.kind === 'ratio' && <Checkbox label="Show as a percentage" checked={!!draft.asPercent} onChange={(e) => patch({ asPercent: e.target.checked })} />}

          {draft.kind === 'bucket' && (
            <fieldset className="m-0 flex flex-col gap-[8px] border-0 p-0">
              <legend className="p-0 text-ds-label text-ds-fg-muted">Bands</legend>
              {bands.map((b, i, arr) => (
                <div key={i} className="flex items-center gap-[6px]">
                  <span className="w-[56px] shrink-0 text-ds-label text-ds-fg-muted">{b.max == null ? 'above' : 'up to'}</span>
                  <TextInput
                    type="number"
                    aria-label={`Band ${i + 1} upper limit`}
                    className="w-[84px] shrink-0"
                    value={b.max ?? ''}
                    disabled={b.max == null}
                    onChange={(e) => {
                      const next = [...bands];
                      next[i] = { ...next[i], max: e.target.value === '' ? null : Number(e.target.value) };
                      patch({ bands: next });
                    }}
                  />
                  <TextInput
                    aria-label={`Band ${i + 1} name`}
                    className="min-w-0 flex-1"
                    value={b.label}
                    onChange={(e) => {
                      const next = [...bands];
                      next[i] = { ...next[i], label: e.target.value };
                      patch({ bands: next });
                    }}
                  />
                  {arr.length > 1 && <IconButton label={`Remove band ${i + 1}`} onClick={() => patch({ bands: bands.filter((_, j) => j !== i) })}><Trash2 aria-hidden /></IconButton>}
                </div>
              ))}
              <Button size="sm" className="self-start" leftIcon={<Plus aria-hidden />} onClick={() => patch({ bands: [...bands, { max: null, label: 'New band' }] })}>Add band</Button>
            </fieldset>
          )}

          {draft.kind === 'concat' && (
            <FormField label="Separator">
              <TextInput value={draft.separator ?? ' · '} onChange={(e) => patch({ separator: e.target.value })} />
            </FormField>
          )}

          {PRESET_HINT[draft.kind] && <p className="m-0 text-ds-label text-ds-fg-muted">{PRESET_HINT[draft.kind]}</p>}

          {preview && (
            <div className="rounded-ds-control border border-ds-border bg-ds-surface p-[8px]" role="status">
              <p className="m-0 text-ds-label text-ds-fg-muted">Preview, first {preview.values.length === 0 ? 'rows' : preview.values.length === 1 ? 'row' : `${preview.values.length} rows`}</p>
              <div className="mt-[4px] flex flex-wrap gap-[4px]">
                {preview.values.length === 0
                  ? <span className="text-ds-label text-ds-fg-muted">No rows loaded yet</span>
                  : preview.values.map((v, i) => <span key={i} className="rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] py-[2px] text-ds-label tabular-nums text-ds-fg-body">{v}</span>)}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-[8px]">
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" disabled={!calcIsComplete(draft)} onClick={save}>Save and add</Button>
          </div>
        </div>
      )}
    </div>
  );
}
