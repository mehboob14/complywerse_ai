'use client';

// The summary of a report: calculations (a count, a total, an average, the lowest, the highest), optionally broken down by a field. It lives in the rail's Summary section (it used to be a modal). Logic is
// unchanged: aggregate-utils.ts decides which calculation suits which field; the first calculation seeds one sensible breakdown in the workspace. Markup is the kit's.
import { Plus, Trash2, X } from 'lucide-react';
import { Button, Checkbox, IconButton, Select } from '@/components/ui/ds';
import type { AggFn, ColumnDef, Measure } from './types';
import { AGG_OPTIONS, aggOptionsForField, dimensionCandidates, fieldsForAgg, isNumericMeasureField, measureLabel, newMeasureId, numericMeasureFields } from './aggregate-utils';

/** One-click calculations, in the order people reach for them. */
const QUICK_ADDS: { agg: AggFn; label: string }[] = [
  { agg: 'count', label: 'Count rows' },
  { agg: 'count_distinct', label: 'Count unique' },
  { agg: 'sum', label: 'Total' },
  { agg: 'avg', label: 'Average' },
  { agg: 'min', label: 'Lowest' },
  { agg: 'max', label: 'Highest' },
];

export default function SummarizePanel({
  cols, lookupCols, dimensions, measures, onDimensionsChange, onMeasuresChange, onClear,
}: {
  /** Selected/visible columns — offered in add-new group-by / calculation pickers. */
  cols: ColumnDef[];
  /** Broader catalog for labels of fields kept after deselection. */
  lookupCols?: ColumnDef[];
  dimensions: string[];
  measures: Measure[];
  onDimensionsChange: (keys: string[]) => void;
  onMeasuresChange: (measures: Measure[]) => void;
  onClear: () => void;
}) {
  const resolveCol = (key: string) => cols.find((c) => c.key === key) || lookupCols?.find((c) => c.key === key);
  const dimOptions = dimensionCandidates(cols);
  const numericFields = numericMeasureFields(cols);
  const hasSetup = dimensions.length > 0 || measures.length > 0;

  const addDimension = (key: string) => {
    if (!key || dimensions.includes(key)) return;
    onDimensionsChange([...dimensions, key]);
  };
  const removeDimension = (key: string) => onDimensionsChange(dimensions.filter((k) => k !== key));

  /** Quick add seeds a valid field so the column appears immediately. */
  const addQuick = (agg: AggFn) => {
    const opt = AGG_OPTIONS.find((o) => o.key === agg);
    const pool = opt?.numericOnly ? numericFields : fieldsForAgg(agg, cols);
    const key = opt?.needsField ? (pool[0]?.key ?? '') : '';
    onMeasuresChange([...measures, { id: newMeasureId(measures), key, agg }]);
  };
  const patchMeasure = (id: string, patch: Partial<Measure>) => onMeasuresChange(measures.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const removeMeasure = (id: string) => onMeasuresChange(measures.filter((m) => m.id !== id));

  const quickDisabled = (agg: AggFn) => {
    const opt = AGG_OPTIONS.find((o) => o.key === agg);
    if (!opt?.needsField) return false;
    return opt.numericOnly ? numericFields.length === 0 : cols.length === 0;
  };

  const preview = measures.length === 0
    ? 'Nothing yet. Add a calculation.'
    : `${measures.map((m) => measureLabel(m, m.key ? (resolveCol(m.key)?.label ?? m.key) : '')).join(' · ')}${dimensions.length ? `, one row per ${dimensions.map((k) => resolveCol(k)?.label ?? k).join(' › ')}` : ', one total row'}`;

  return (
    <div className="flex flex-col gap-[16px]">
      <section aria-label="Calculations" className="flex flex-col gap-[8px]">
        <p className="m-0 text-ds-label text-ds-fg-muted">
          Each calculation becomes a column.
          {numericFields.length === 0 && cols.length > 0 ? ' Total and Average need a number column: none is selected yet.' : ''}
        </p>
        <div className="flex flex-wrap gap-[6px]">
          {QUICK_ADDS.map((q) => (
            <Button key={q.agg} size="sm" leftIcon={<Plus aria-hidden />} disabled={quickDisabled(q.agg)} onClick={() => addQuick(q.agg)}>{q.label}</Button>
          ))}
        </div>

        {measures.map((m, i) => {
          const fieldCol = m.key ? resolveCol(m.key) : undefined;
          const fieldOpts = fieldsForAgg(m.agg, cols, m.key, resolveCol);
          const aggOpts = aggOptionsForField(fieldCol, m.agg);
          const showField = m.agg !== 'count' || !!m.key;
          const showPct = m.agg === 'count' || m.agg === 'count_distinct';
          return (
            <div key={m.id} role="group" aria-label={`Calculation ${i + 1}`} className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[8px]">
              <div className="flex items-center gap-[8px]">
                <Select
                  aria-label="What to calculate"
                  className="min-w-0 flex-1"
                  value={m.agg}
                  onChange={(e) => {
                    const agg = e.target.value as AggFn;
                    const opt = AGG_OPTIONS.find((o) => o.key === agg);
                    let nextKey = opt && !opt.needsField ? '' : m.key;
                    if (opt?.numericOnly && !isNumericMeasureField(resolveCol(nextKey))) nextKey = numericFields[0]?.key ?? '';
                    patchMeasure(m.id, { agg, key: nextKey, pctOfTotal: agg === 'count' || agg === 'count_distinct' ? m.pctOfTotal : false });
                  }}
                >
                  {aggOpts.map((o) => <option key={o.key} value={o.key} title={o.hint}>{o.label}</option>)}
                </Select>
                <IconButton label={`Remove calculation ${i + 1}`} onClick={() => removeMeasure(m.id)}><Trash2 aria-hidden /></IconButton>
              </div>
              {showField ? (
                <Select
                  aria-label="Column to calculate on"
                  value={m.key}
                  onChange={(e) => {
                    const key = e.target.value;
                    const opt = AGG_OPTIONS.find((o) => o.key === m.agg);
                    if (key && opt?.numericOnly && !isNumericMeasureField(resolveCol(key))) { patchMeasure(m.id, { key, agg: 'count_distinct' }); return; }
                    patchMeasure(m.id, { key });
                  }}
                >
                  <option value="">{m.agg === 'count' ? 'All rows' : 'Choose a column'}</option>
                  {fieldOpts.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </Select>
              ) : <span className="text-ds-label text-ds-fg-muted">All matching rows</span>}
              {showPct && <Checkbox label="Also show each group's share of the total" checked={!!m.pctOfTotal} onChange={(e) => patchMeasure(m.id, { pctOfTotal: e.target.checked })} />}
            </div>
          );
        })}
      </section>

      <section aria-label="Break down by" className="flex flex-col gap-[8px]">
        <p className="m-0 text-ds-label text-ds-fg-muted">Break down by (optional): one row per value, for example Status or Owner. Leave empty for a single total.</p>
        {dimensions.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap gap-[6px] p-0">
            {dimensions.map((key) => (
              <li key={key} className="inline-flex min-h-ds-control-sm items-center gap-[2px] rounded-full border border-ds-border-strong bg-ds-primary-soft pl-[10px] text-ds-label text-ds-primary-text">
                {resolveCol(key)?.label ?? key}
                <IconButton label={`Stop breaking down by ${resolveCol(key)?.label ?? key}`} onClick={() => removeDimension(key)}><X aria-hidden /></IconButton>
              </li>
            ))}
          </ul>
        )}
        <Select aria-label="Add a breakdown field" value="" disabled={!dimOptions.length} onChange={(e) => addDimension(e.target.value)}>
          <option value="">{cols.length ? 'Add a breakdown field' : 'Select columns first'}</option>
          {dimOptions.filter((c) => !dimensions.includes(c.key)).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </Select>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className="m-0 min-w-0 flex-1 text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{preview}</p>
        {hasSetup && <Button size="sm" variant="ghost" onClick={onClear}>Clear summary</Button>}
      </div>
    </div>
  );
}
