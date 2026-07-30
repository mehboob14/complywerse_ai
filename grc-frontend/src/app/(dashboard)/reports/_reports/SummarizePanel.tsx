'use client';

import { Plus, Trash2 } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
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

/** Centered summary builder — group-by + calculations for totals and breakdowns. */
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
  const hasSetup = dimensions.length > 0 || measures.length > 0;

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

  const fieldClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="lg"
      title="Create a summary"
      subtitle="Turn your list into totals and breakdowns — like a simple Excel pivot"
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
          <p className="text-xs text-slate-500">
            {measures.length === 0
              ? 'Add at least one calculation, then click Done.'
              : dimensions.length === 0
                ? 'One overall total for the filtered list.'
                : `Breakdown by ${dimensions.length} field${dimensions.length === 1 ? '' : 's'}.`}
          </p>
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
        {/* How it works */}
        <ol className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
          {[
            { n: '1', t: 'Filters first', d: 'Only matching rows are counted.' },
            { n: '2', t: 'Optional split', d: 'Group by Status, Owner, etc.' },
            { n: '3', t: 'Pick a number', d: 'How many, Average, Add up…' },
          ].map((s) => (
            <li key={s.n} className="flex gap-2.5">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[11px] font-semibold text-white">
                {s.n}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800">{s.t}</p>
                <p className="text-[11px] leading-snug text-slate-500">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>

        {!cols.length && (
          <p className="rounded-lg border border-dashed border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            Select columns first (use <span className="font-semibold">Columns</span> in the toolbar).
            You need at least one column before you can group or calculate.
          </p>
        )}

        {/* Step: Group by */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-white">
              A
            </span>
            <h3 className="text-sm font-semibold text-slate-900">Group results by</h3>
            <span className="text-xs font-normal text-slate-400">(optional)</span>
          </div>
          <p className="mb-3 text-sm leading-relaxed text-slate-600">
            Split the list into buckets — for example by <span className="font-medium">Status</span> or{' '}
            <span className="font-medium">Priority</span>. Leave empty if you only want{' '}
            <span className="font-medium">one overall total</span>.
          </p>

          {dimensions.length === 0 && cols.length > 0 && (
            <p className="mb-2 rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
              No grouping yet — you will get a single overall total.
            </p>
          )}

          <div className="space-y-2">
            {dimensions.map((key, idx) => {
              const col = resolveCol(key);
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-500">
                    {idx + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                    {col?.label ?? key}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeDimension(key)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    aria-label={`Stop grouping by ${col?.label ?? key}`}
                  >
                    <Trash2 className="h-4 w-4" />
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
            className={`mt-2 ${fieldClass}`}
          >
            <option value="">{cols.length ? '+ Add a grouping column…' : 'Select columns first'}</option>
            {dimOptions
              .filter((c) => !dimensions.includes(c.key))
              .map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
          </select>
        </section>

        {/* Step: Numbers */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-white">
              B
            </span>
            <h3 className="text-sm font-semibold text-slate-900">Numbers to show</h3>
          </div>
          <p className="mb-3 text-sm leading-relaxed text-slate-600">
            Choose what to calculate. Start with <span className="font-medium">How many</span> for a simple count.
            Use <span className="font-medium">Add up / Average / Lowest / Highest</span> only with a number column.
            {!hasNumeric && cols.length > 0 && (
              <> No number columns are selected yet — only How many and Count unique are available.</>
            )}
          </p>

          <div className="space-y-3">
            {measures.map((m) => {
              const fieldCol = m.key ? resolveCol(m.key) : undefined;
              const needsField = m.agg !== 'count' || !!m.key;
              const fieldOpts = fieldsForAgg(m.agg, cols, m.key, resolveCol);
              const aggOpts = aggOptionsForField(fieldCol, m.agg);
              const visibleAggOpts = (!m.key && !hasNumeric)
                ? aggOpts.filter((o) => !o.numericOnly || o.key === m.agg)
                : aggOpts;
              const showPct = m.agg === 'count' || m.agg === 'count_distinct';
              return (
                <div key={m.id} className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <select
                      value={m.agg}
                      onChange={(e) => {
                        const agg = e.target.value as Measure['agg'];
                        const opt = AGG_OPTIONS.find((o) => o.key === agg);
                        const pctOk = agg === 'count' || agg === 'count_distinct';
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
                      className="min-w-[9.5rem] rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-medium focus:border-primary-500 focus:outline-none"
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
                          if (key && opt?.numericOnly && !isNumericMeasureField(col)) {
                            patchMeasure(m.id, { key, agg: 'count_distinct' });
                            return;
                          }
                          patchMeasure(m.id, { key });
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-primary-500 focus:outline-none"
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
                      <span className="min-w-0 flex-1 self-center truncate text-sm text-slate-500">
                        All matching rows
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeMeasure(m.id)}
                      className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-white hover:text-rose-600"
                      aria-label="Remove this calculation"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {showPct && (
                    <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs text-slate-600">
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
            disabled={!cols.length}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:border-primary-400 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            Add a calculation
          </button>
        </section>

        {measures.length === 0 && cols.length > 0 && (
          <p className="rounded-xl border border-sky-100 bg-sky-50 px-3.5 py-3 text-sm leading-relaxed text-sky-900">
            Tip: add <span className="font-semibold">How many</span> for a count.
            For a breakdown, also group by a field like Priority under step A.
          </p>
        )}
      </div>
    </AnimatedModal>
  );
}
