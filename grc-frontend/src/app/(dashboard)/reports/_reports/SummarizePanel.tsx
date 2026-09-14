'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
import type { AggFn, ColumnDef, Measure } from './types';
import {
  AGG_OPTIONS,
  aggOptionsForField,
  dimensionCandidates,
  fieldsForAgg,
  isNumericMeasureField,
  measureLabel,
  newMeasureId,
  numericMeasureFields,
} from './aggregate-utils';

/** One-click calculations, in the order people reach for them. */
const QUICK_ADDS: { agg: AggFn; label: string }[] = [
  { agg: 'count', label: 'Count rows' },
  { agg: 'count_distinct', label: 'Count unique' },
  { agg: 'sum', label: 'Total' },
  { agg: 'avg', label: 'Average' },
  { agg: 'min', label: 'Lowest' },
  { agg: 'max', label: 'Highest' },
];

/** Summary builder — pick calculations, optionally break them down by a field. */
export default function SummarizePanel({
  cols,
  lookupCols,
  dimensions,
  measures,
  onDimensionsChange,
  onMeasuresChange,
  onClose,
  onClear,
}: {
  /** Selected/visible columns — offered in add-new group-by / calculation pickers. */
  cols: ColumnDef[];
  /** Broader catalog for labels of fields kept after deselection. */
  lookupCols?: ColumnDef[];
  dimensions: string[];
  measures: Measure[];
  onDimensionsChange: (keys: string[]) => void;
  onMeasuresChange: (measures: Measure[]) => void;
  onClose: () => void;
  onClear: () => void;
}) {
  const resolveCol = (key: string) =>
    cols.find((c) => c.key === key)
    || lookupCols?.find((c) => c.key === key);

  const dimOptions = dimensionCandidates(cols);
  const numericFields = numericMeasureFields(cols);
  const hasSetup = dimensions.length > 0 || measures.length > 0;

  const addDimension = (key: string) => {
    if (!key || dimensions.includes(key)) return;
    onDimensionsChange([...dimensions, key]);
  };
  const removeDimension = (key: string) => {
    onDimensionsChange(dimensions.filter((k) => k !== key));
  };

  /** Quick add seeds a valid field so the column appears immediately. */
  const addQuick = (agg: AggFn) => {
    const opt = AGG_OPTIONS.find((o) => o.key === agg);
    const pool = opt?.numericOnly ? numericFields : fieldsForAgg(agg, cols);
    const key = opt?.needsField ? (pool[0]?.key ?? '') : '';
    onMeasuresChange([...measures, { id: newMeasureId(measures), key, agg }]);
  };
  const patchMeasure = (id: string, patch: Partial<Measure>) => {
    onMeasuresChange(measures.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };
  const removeMeasure = (id: string) => {
    onMeasuresChange(measures.filter((m) => m.id !== id));
  };

  const quickDisabled = (agg: AggFn) => {
    const opt = AGG_OPTIONS.find((o) => o.key === agg);
    if (!opt?.needsField) return false;
    return opt.numericOnly ? numericFields.length === 0 : cols.length === 0;
  };

  const preview = measures.length === 0
    ? 'Nothing yet — add a calculation.'
    : `${measures.map((m) => measureLabel(m, m.key ? (resolveCol(m.key)?.label ?? m.key) : '')).join(' · ')}`
      + (dimensions.length
        ? ` — one row per ${dimensions.map((k) => resolveCol(k)?.label ?? k).join(' › ')}`
        : ' — one total row');

  const sel =
    'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-primary-500 focus:outline-none';

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="lg"
      title="Summarize"
      subtitle="Turn rows into counts, averages, and totals"
      headerAccessory={
        hasSetup ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-rose-600"
          >
            Clear all
          </button>
        ) : null
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-slate-500" title={preview}>{preview}</p>
          <button
            type="button"
            onClick={onClose}
            className="cw-btn-primary inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium"
          >
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-6 px-5 py-5">
        {/* Calculations */}
        <section>
          <h3 className="text-sm font-semibold text-slate-900">Calculations</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Each one becomes a column.
            {numericFields.length === 0 && cols.length > 0
              ? ' Total / Average need a number column — none selected yet.'
              : ''}
          </p>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {QUICK_ADDS.map((q) => (
              <button
                key={q.agg}
                type="button"
                onClick={() => addQuick(q.agg)}
                disabled={quickDisabled(q.agg)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-primary-400 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-700"
              >
                <Plus className="h-3 w-3" /> {q.label}
              </button>
            ))}
          </div>

          {measures.length > 0 && (
            <div className="mt-3 space-y-2">
              {measures.map((m) => {
                const fieldCol = m.key ? resolveCol(m.key) : undefined;
                const fieldOpts = fieldsForAgg(m.agg, cols, m.key, resolveCol);
                const aggOpts = aggOptionsForField(fieldCol, m.agg);
                const showField = m.agg !== 'count' || !!m.key;
                const showPct = m.agg === 'count' || m.agg === 'count_distinct';
                return (
                  <div key={m.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={m.agg}
                        title="What to calculate"
                        onChange={(e) => {
                          const agg = e.target.value as AggFn;
                          const opt = AGG_OPTIONS.find((o) => o.key === agg);
                          let nextKey = opt && !opt.needsField ? '' : m.key;
                          if (opt?.numericOnly && !isNumericMeasureField(resolveCol(nextKey))) {
                            nextKey = numericFields[0]?.key ?? '';
                          }
                          patchMeasure(m.id, {
                            agg,
                            key: nextKey,
                            pctOfTotal: agg === 'count' || agg === 'count_distinct' ? m.pctOfTotal : false,
                          });
                        }}
                        className={`${sel} min-w-[9rem] font-medium`}
                      >
                        {aggOpts.map((o) => (
                          <option key={o.key} value={o.key} title={o.hint}>{o.label}</option>
                        ))}
                      </select>
                      {showField ? (
                        <select
                          value={m.key}
                          onChange={(e) => {
                            const key = e.target.value;
                            const opt = AGG_OPTIONS.find((o) => o.key === m.agg);
                            if (key && opt?.numericOnly && !isNumericMeasureField(resolveCol(key))) {
                              patchMeasure(m.id, { key, agg: 'count_distinct' });
                              return;
                            }
                            patchMeasure(m.id, { key });
                          }}
                          className={`${sel} min-w-0 flex-1`}
                        >
                          <option value="">{m.agg === 'count' ? 'All rows' : 'Pick a column…'}</option>
                          {fieldOpts.map((c) => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-500">All matching rows</span>
                      )}
                      {showPct && (
                        <label
                          className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-slate-600"
                          title="Add a second column with each group's share of the total"
                        >
                          <input
                            type="checkbox"
                            checked={!!m.pctOfTotal}
                            onChange={(e) => patchMeasure(m.id, { pctOfTotal: e.target.checked })}
                            className="rounded border-slate-300"
                          />
                          % of total
                        </label>
                      )}
                      <button
                        type="button"
                        onClick={() => removeMeasure(m.id)}
                        aria-label="Remove this calculation"
                        className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Break down by */}
        <section>
          <h3 className="text-sm font-semibold text-slate-900">
            Break down by <span className="font-normal text-slate-400">(optional)</span>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            One row per value — for example Status or Owner. Leave empty for a single total.
          </p>

          {dimensions.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {dimensions.map((key) => (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-800"
                >
                  {resolveCol(key)?.label ?? key}
                  <button
                    type="button"
                    onClick={() => removeDimension(key)}
                    aria-label={`Stop breaking down by ${resolveCol(key)?.label ?? key}`}
                    className="rounded-full p-0.5 hover:bg-primary-100 hover:text-rose-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <select
            value=""
            disabled={!dimOptions.length}
            onChange={(e) => {
              addDimension(e.target.value);
              e.target.value = '';
            }}
            className={`mt-2.5 w-full ${sel} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <option value="">
              {cols.length ? '+ Add a breakdown field…' : 'Select columns first'}
            </option>
            {dimOptions
              .filter((c) => !dimensions.includes(c.key))
              .map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
          </select>
        </section>
      </div>
    </AnimatedModal>
  );
}
