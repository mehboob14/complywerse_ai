'use client';

// Calculated-column editor. Three dropdowns and a name — the recipe set in
// ./calcColumns is chosen so that is enough to express what GRC reports
// actually ask for (days open, days overdue, inherent minus residual, coverage
// %, banded scores), without a formula language or an expression editor.
//
// The live preview is the whole point of the panel: a derived field is easy to
// define backwards (from/to reversed, numerator/denominator swapped), and the
// only reliable way to notice is to see it evaluated against real rows before
// it joins the report.

import { useMemo, useState } from 'react';
import { Calculator, Check, Plus, Trash2, X } from 'lucide-react';
import type { ColumnDef, Row } from './types';
import {
  CALC_KINDS, DEFAULT_BANDS, TODAY, buildCalcColumn, calcIsComplete,
  needsSecondOperand, newCalcId, operandType,
  type CalcColumnDef, type CalcKind,
} from './calcColumns';
import { cellDisplay } from './builderUtils';

const PRESET_HINT: Record<CalcKind, string> = {
  days_between: 'Negative means the second date is earlier — for "days overdue" put the due date first and Today second.',
  difference: 'First minus second.',
  ratio: 'Undefined when the second value is zero — those rows stay blank rather than showing 0 or 100%.',
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

function OperandSelect({
  kind, value, onChange, cols, placeholder,
}: {
  kind: CalcKind;
  value: string;
  onChange: (v: string) => void;
  cols: ColumnDef[];
  placeholder: string;
}) {
  const options = operandOptions(kind, cols);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
    >
      <option value="">{placeholder}</option>
      {kind === 'days_between' && <option value={TODAY}>Today (when the report runs)</option>}
      {options.map((c) => (
        <option key={c.key} value={c.key}>{c.label}</option>
      ))}
    </select>
  );
}

export default function CalcColumnPanel({
  cols, defs, rows, onChange, onClose, onAddToReport,
}: {
  /** Source columns a calculation may reference (never other calculations). */
  cols: ColumnDef[];
  defs: CalcColumnDef[];
  /** Sample rows for the preview. */
  rows: Row[];
  onChange: (next: CalcColumnDef[]) => void;
  onClose: () => void;
  /** Put a freshly saved field straight onto the report. */
  onAddToReport: (key: string) => void;
}) {
  const [draft, setDraft] = useState<CalcColumnDef | null>(null);

  const startNew = () => setDraft({ id: newCalcId(), label: '', kind: 'days_between', a: '', b: TODAY });
  const patch = (p: Partial<CalcColumnDef>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const preview = useMemo(() => {
    if (!draft || !calcIsComplete(draft)) return null;
    const col = buildCalcColumn(draft, (k) => cols.find((c) => c.key === k));
    const sample = rows.slice(0, 5);
    return { col, values: sample.map((r) => cellDisplay(col, r)) };
  }, [draft, cols, rows]);

  const save = () => {
    if (!draft || !calcIsComplete(draft)) return;
    const i = defs.findIndex((d) => d.id === draft.id);
    const next = i >= 0 ? defs.map((d) => (d.id === draft.id ? draft : d)) : [...defs, draft];
    onChange(next);
    onAddToReport(`calc_${draft.id}`);
    setDraft(null);
  };

  const remove = (id: string) => {
    onChange(defs.filter((d) => d.id !== id));
    if (draft?.id === id) setDraft(null);
  };

  const kindMeta = CALC_KINDS.find((k) => k.kind === draft?.kind);

  return (
    <>
      <div className="fixed inset-0 z-30 bg-slate-900/20" onClick={onClose} />
      <div className="absolute bottom-0 right-0 top-0 z-40 flex w-[min(100%,26rem)] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Calculator className="h-4 w-4 text-slate-400" /> Calculated fields
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Built from columns in this report. Filter, group and chart them like any other field.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {defs.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {defs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
                >
                  <button
                    type="button"
                    onClick={() => setDraft(d)}
                    className="min-w-0 flex-1 truncate text-left text-xs font-medium text-slate-700 hover:text-primary-700"
                  >
                    {d.label}
                    <span className="ml-1.5 text-[10px] font-normal text-slate-400">
                      {CALC_KINDS.find((k) => k.kind === d.kind)?.label}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddToReport(`calc_${d.id}`)}
                    title="Add to the report"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-primary-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(d.id)}
                    title="Delete"
                    className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!draft ? (
            <button
              type="button"
              onClick={startNew}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-3 text-xs font-semibold text-slate-600 hover:border-primary-400 hover:text-primary-700"
            >
              <Plus className="h-3.5 w-3.5" /> New calculated field
            </button>
          ) : (
            <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <input
                value={draft.label}
                onChange={(e) => patch({ label: e.target.value })}
                placeholder="Field name — e.g. Days open"
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium"
              />

              <select
                value={draft.kind}
                onChange={(e) => {
                  const kind = e.target.value as CalcKind;
                  // Operands are type-scoped, so a kind change invalidates them.
                  patch({ kind, a: '', b: kind === 'days_between' ? TODAY : '' });
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                {CALC_KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>{k.label}</option>
                ))}
              </select>
              {kindMeta && <p className="text-[11px] text-slate-500">{kindMeta.hint}</p>}

              <div className="flex items-center gap-1.5">
                <OperandSelect
                  kind={draft.kind}
                  value={draft.a}
                  onChange={(a) => patch({ a })}
                  cols={cols}
                  placeholder={draft.kind === 'days_between' ? 'From…' : 'Field…'}
                />
                {needsSecondOperand(draft.kind) && (
                  <>
                    <span className="shrink-0 text-[11px] font-semibold text-slate-400">
                      {draft.kind === 'days_between' ? '→' : draft.kind === 'difference' ? '−' : draft.kind === 'ratio' ? '÷' : '+'}
                    </span>
                    <OperandSelect
                      kind={draft.kind}
                      value={draft.b ?? ''}
                      onChange={(b) => patch({ b })}
                      cols={cols}
                      placeholder={draft.kind === 'days_between' ? 'To…' : 'Field…'}
                    />
                  </>
                )}
              </div>

              {draft.kind === 'ratio' && (
                <label className="flex items-center gap-2 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={!!draft.asPercent}
                    onChange={(e) => patch({ asPercent: e.target.checked })}
                  />
                  Show as a percentage
                </label>
              )}

              {draft.kind === 'bucket' && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Bands</p>
                  {(draft.bands ?? DEFAULT_BANDS).map((b, i, arr) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="w-16 shrink-0 text-[11px] text-slate-500">
                        {b.max == null ? 'above' : 'up to'}
                      </span>
                      <input
                        type="number"
                        value={b.max ?? ''}
                        disabled={b.max == null}
                        onChange={(e) => {
                          const bands = [...(draft.bands ?? DEFAULT_BANDS)];
                          bands[i] = { ...bands[i], max: e.target.value === '' ? null : Number(e.target.value) };
                          patch({ bands });
                        }}
                        className="w-16 rounded border border-slate-300 px-1.5 py-1 text-xs disabled:bg-slate-100"
                      />
                      <input
                        value={b.label}
                        onChange={(e) => {
                          const bands = [...(draft.bands ?? DEFAULT_BANDS)];
                          bands[i] = { ...bands[i], label: e.target.value };
                          patch({ bands });
                        }}
                        className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1 text-xs"
                      />
                      {arr.length > 1 && (
                        <button
                          type="button"
                          onClick={() => patch({ bands: (draft.bands ?? DEFAULT_BANDS).filter((_, j) => j !== i) })}
                          className="rounded p-1 text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => patch({ bands: [...(draft.bands ?? DEFAULT_BANDS), { max: null, label: 'New band' }] })}
                    className="text-[11px] font-medium text-primary-700 hover:underline"
                  >
                    + Add band
                  </button>
                </div>
              )}

              {draft.kind === 'concat' && (
                <input
                  value={draft.separator ?? ' · '}
                  onChange={(e) => patch({ separator: e.target.value })}
                  placeholder="Separator"
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              )}

              {PRESET_HINT[draft.kind] && (
                <p className="text-[11px] leading-snug text-slate-500">{PRESET_HINT[draft.kind]}</p>
              )}

              {preview && (
                <div className="rounded-lg border border-slate-200 bg-white p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Preview · first {preview.values.length} row{preview.values.length === 1 ? '' : 's'}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {preview.values.length === 0 ? (
                      <span className="text-[11px] text-slate-400">No rows loaded yet</span>
                    ) : (
                      preview.values.map((v, i) => (
                        <span key={i} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-700">
                          {v}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!calcIsComplete(draft)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-40"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={3} /> Save &amp; add
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
