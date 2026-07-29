'use client';

import { Plus, Trash2, X } from 'lucide-react';
import type { ColumnDef, Measure } from './types';
import {
  AGG_OPTIONS,
  aggOptionsForField,
  dimensionCandidates,
  fieldsForAgg,
  isNumericMeasureField,
  newMeasureId,
  numericMeasureFields,
} from './aggregate-utils';

/** Group-by + calculation editor for turning detail rows into totals and breakdowns. */
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
  const hasNumeric = numericFields.length > 0;

  const addDimension = (key: string) => {
    if (!key || dimensions.includes(key)) return;
    onDimensionsChange([...dimensions, key]);
  };
  const removeDimension = (key: string) => {
    onDimensionsChange(dimensions.filter((k) => k !== key));
  };

  const addMeasure = () => {
    onMeasuresChange([
      ...measures,
      { id: newMeasureId(measures), key: '', agg: 'count' },
    ]);
  };
  const patchMeasure = (id: string, patch: Partial<Measure>) => {
    onMeasuresChange(measures.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };
  const removeMeasure = (id: string) => {
    onMeasuresChange(measures.filter((m) => m.id !== id));
  };

  return (
    <div className="absolute left-3 top-[7.25rem] z-40 w-[min(100%-1.5rem,26rem)] rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
        <div className="min-w-0 pr-2">
          <p className="text-sm font-semibold text-slate-800">Create a summary</p>
          <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
            Turn a long list into totals and breakdowns — for example, how many issues are open by priority,
            or the average risk score by category.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(dimensions.length > 0 || measures.length > 0) && (
            <button
              type="button"
              onClick={onClear}
              className="text-[11px] font-medium text-slate-400 hover:text-rose-600"
            >
              Clear
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-600" aria-label="Close summary panel">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="max-h-[min(70vh,520px)] space-y-4 overflow-y-auto p-3">
        <p className="rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2 text-[10px] leading-snug text-slate-600">
          Any filters you set above are applied first, then these totals are calculated on the matching rows.
        </p>

        {!cols.length && (
          <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-2.5 py-2 text-[10px] leading-snug text-slate-500">
            Select columns first (use Columns or Add data). You need at least one column before you can group or calculate.
          </p>
        )}

        {/* Group by */}
        <section>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Group results by
          </p>
          <p className="mb-2 text-[10px] leading-snug text-slate-400">
            Use text fields like Status or Owner to split results.
            Leave empty if you only want one overall total for the whole list.
          </p>
          {dimensions.length === 0 && cols.length > 0 && (
            <p className="mb-2 text-[10px] italic text-slate-400">
              No grouping yet — you will get a single overall total.
            </p>
          )}
          <div className="space-y-1.5">
            {dimensions.map((key) => {
              const col = resolveCol(key);
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
                    {col?.label ?? key}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeDimension(key)}
                    className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-rose-600"
                    aria-label={`Stop grouping by ${col?.label ?? key}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
          <select
            value=""
            disabled={!cols.length}
            onChange={(e) => {
              addDimension(e.target.value);
              e.target.value = '';
            }}
            className="mt-2 w-full rounded-lg border border-dashed border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600 focus:border-primary-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            <option value="">{cols.length ? '+ Group by a column…' : 'Select columns first'}</option>
            {dimOptions
              .filter((c) => !dimensions.includes(c.key))
              .map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
          </select>
        </section>

        {/* Calculations */}
        <section>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Numbers to show
          </p>
          <p className="mb-2 text-[10px] leading-snug text-slate-400">
            Pick How many for any list. Use Add up / Average / Lowest / Highest only after choosing a number column.
            {!hasNumeric && cols.length > 0 && (
              <> No number columns are selected yet — only How many and Count unique are available.</>
            )}
          </p>
          <div className="space-y-2">
            {measures.map((m) => {
              const fieldCol = m.key ? resolveCol(m.key) : undefined;
              const needsField = m.agg !== 'count' || !!m.key;
              const fieldOpts = fieldsForAgg(m.agg, cols, m.key, resolveCol);
              const aggOpts = aggOptionsForField(fieldCol, m.agg);
              // When no field yet, hide numeric-only calcs if there are no number columns to pick.
              const visibleAggOpts = (!m.key && !hasNumeric)
                ? aggOpts.filter((o) => !o.numericOnly || o.key === m.agg)
                : aggOpts;
              const showPct = m.agg === 'count' || m.agg === 'count_distinct';
              return (
                <div key={m.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="flex items-start gap-1.5">
                    <select
                      value={m.agg}
                      onChange={(e) => {
                        const agg = e.target.value as Measure['agg'];
                        const opt = AGG_OPTIONS.find((o) => o.key === agg);
                        const pctOk = agg === 'count' || agg === 'count_distinct';
                        // Drop a non-numeric field when switching to Add up / Average / etc.
                        let nextKey = opt && !opt.needsField ? '' : m.key;
                        if (opt?.numericOnly && nextKey) {
                          const col = resolveCol(nextKey);
                          if (!isNumericMeasureField(col)) nextKey = '';
                        }
                        patchMeasure(m.id, {
                          agg,
                          key: nextKey,
                          pctOfTotal: pctOk ? m.pctOfTotal : false,
                        });
                      }}
                      title="What to calculate"
                      className="w-[8.25rem] shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs font-medium focus:border-primary-500 focus:outline-none"
                    >
                      {visibleAggOpts.map((o) => (
                        <option key={o.key} value={o.key} title={o.hint}>{o.label}</option>
                      ))}
                    </select>
                    {(m.agg !== 'count' || needsField) && (
                      <select
                        value={m.key}
                        onChange={(e) => {
                          const key = e.target.value;
                          const col = key ? resolveCol(key) : undefined;
                          const opt = AGG_OPTIONS.find((o) => o.key === m.agg);
                          // If user picks a text field while on a numeric calc, fall back to Count unique.
                          if (key && opt?.numericOnly && !isNumericMeasureField(col)) {
                            patchMeasure(m.id, { key, agg: 'count_distinct' });
                            return;
                          }
                          patchMeasure(m.id, { key });
                        }}
                        className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs focus:border-primary-500 focus:outline-none"
                      >
                        <option value="">
                          {m.agg === 'count' ? 'All matching rows' : 'Which column?'}
                        </option>
                        {fieldOpts.map((c) => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </select>
                    )}
                    {m.agg === 'count' && !m.key && (
                      <span className="min-w-0 flex-1 self-center truncate text-xs text-slate-500">
                        All matching rows
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeMeasure(m.id)}
                      className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-white hover:text-rose-600"
                      aria-label="Remove this calculation"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {showPct && (
                    <label className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                      <input
                        type="checkbox"
                        checked={!!m.pctOfTotal}
                        onChange={(e) => patchMeasure(m.id, { pctOfTotal: e.target.checked })}
                        className="rounded border-slate-300"
                      />
                      Also show as % of the overall total
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={addMeasure}
            className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-600 hover:border-primary-400 hover:text-primary-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Add a calculation
          </button>
        </section>

        {measures.length === 0 && (
          <p className="rounded-lg border border-sky-100 bg-sky-50 px-2.5 py-2 text-[10px] leading-snug text-sky-800">
            Add a calculation above to see totals. Start with <span className="font-semibold">How many</span> for a
            simple count, or pick a number column and use <span className="font-semibold">Average</span> or{' '}
            <span className="font-semibold">Add up</span>, then group by a category for a breakdown.
          </p>
        )}
      </div>
    </div>
  );
}
