'use client';

// Advanced AND/OR condition builder. Shared by the Explore grid and the Report
// Builder so filtering behaves and reads identically in both.

import { useEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import type { ColumnDef, FilterRules, Row } from './types';
import { FILTER_TYPE_HINT, OPERATORS } from './types';
import { distinctValues } from './grid-utils';

export default function FilterBuilder({
  cols, rows, rules, onChange, onClose, compact = false,
  staged = false, onApply, onReset, dirty = false,
  lookupCols,
}: {
  cols: ColumnDef[];
  rows: Row[];
  rules: FilterRules;
  onChange: (rules: FilterRules) => void;
  onClose?: () => void;
  compact?: boolean;
  staged?: boolean;
  onApply?: () => void;
  onReset?: () => void;
  dirty?: boolean;
  /** Broader catalog for resolving labels/types of fields kept after deselection. */
  lookupCols?: ColumnDef[];
}) {
  const ruleId = useRef(0);
  const seeded = useRef(false);

  const resolveCol = (key: string) =>
    cols.find((x) => x.key === key)
    || lookupCols?.find((x) => x.key === key);

  /** Selected columns for new picks; keep a stale option only for this rule's current field. */
  const fieldOptionsFor = (currentKey: string): ColumnDef[] => {
    const list = [...cols];
    if (currentKey && !cols.some((c) => c.key === currentKey)) {
      const stale = resolveCol(currentKey);
      list.push(stale ?? { key: currentKey, label: currentKey, type: 'text' });
    }
    return list;
  };

  const opsFor = (col?: ColumnDef) => OPERATORS[col?.type || 'text'] || OPERATORS.text;

  const defaultOpFor = (col?: ColumnDef) => opsFor(col)[0]?.key || 'contains';

  // Open with one empty condition so the panel is never a dead end.
  // Seed a type-valid default op (not always `contains`, which breaks date/number/badge).
  useEffect(() => {
    if (seeded.current || rules.conditions.length || !cols.length) return;
    seeded.current = true;
    const col0 = cols[0];
    onChange({
      ...rules,
      conditions: [{ id: `r${ruleId.current++}`, col: col0?.key || '', op: defaultOpFor(col0), value: '' }],
    });
  }, [rules, cols, onChange]);

  const add = () => {
    if (!cols.length) return;
    const col0 = cols[0];
    onChange({
      ...rules,
      conditions: [...rules.conditions, { id: `r${ruleId.current++}`, col: col0?.key || '', op: defaultOpFor(col0), value: '' }],
    });
  };
  const update = (id: string, p: Partial<{ col: string; op: string; value: string }>) =>
    onChange({ ...rules, conditions: rules.conditions.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const remove = (id: string) => onChange({ ...rules, conditions: rules.conditions.filter((c) => c.id !== id) });

  const sel = 'rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-primary-500 focus:outline-none';

  return (
    <div className={`rounded-xl border border-primary-200 bg-primary-50/40 p-3 ${compact ? '' : 'mb-3'}`}>
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Filters</span>
          <div className="inline-flex overflow-hidden rounded-md border border-slate-200 bg-white">
            {(['AND', 'OR'] as const).map((l) => (
              <button key={l} onClick={() => onChange({ ...rules, logic: l })}
                className={`px-2 py-1 text-[11px] font-semibold ${rules.logic === l ? 'bg-primary-500 text-[#0a0a0a]' : 'text-slate-500 hover:bg-slate-50'}`}>
                {l === 'AND' ? 'Match ALL' : 'Match ANY'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rules.conditions.length > 0 && (
            <button
              onClick={() => onChange({ logic: rules.logic, conditions: [] })}
              className="text-[11px] font-medium text-slate-400 hover:text-rose-600"
            >
              Clear all
            </button>
          )}
          {onClose && <button onClick={onClose} aria-label="Close filters" className="rounded p-0.5 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>}
        </div>
      </div>

      <p className="mb-2 text-[10px] leading-snug text-slate-500">
        Choose a column, how to compare it, and a value (for example Status is Open).
        Comparison options follow the column type — text gets contains, numbers get greater/less than, dates get before/after.
        Use Match ALL when every rule must be true, or Match ANY when one matching rule is enough.
      </p>

      {staged && dirty && (
        <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
          You changed filters — click Apply filters to update the report.
        </p>
      )}

      {!cols.length && (
        <p className="mb-2 rounded-md border border-dashed border-slate-200 bg-white/70 px-2 py-1.5 text-[10px] leading-snug text-slate-500">
          Select columns first so you can choose which fields to filter on.
        </p>
      )}

      <div className="space-y-1.5">
        {rules.conditions.map((c, i) => {
          const fieldOpts = fieldOptionsFor(c.col);
          const col = resolveCol(c.col);
          const ops = opsFor(col);
          // Keep a stale op visible if a saved report used one no longer listed for this type.
          const opList = ops.some((o) => o.key === c.op)
            ? ops
            : [...ops, { key: c.op, label: c.op }];
          const noVal = ['empty', 'notempty', 'linked', 'notlinked'].includes(c.op);
          const typeHint = FILTER_TYPE_HINT[col?.type || 'text'];
          return (
            <div key={c.id} className="space-y-0.5">
              <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'text-[11px]' : ''}`}>
                <span className="w-10 shrink-0 text-right text-[11px] font-medium text-slate-400">{i === 0 ? 'When' : rules.logic === 'AND' ? 'and' : 'or'}</span>
                <select value={c.col} onChange={(e) => {
                  const nc = resolveCol(e.target.value) || fieldOpts.find((x) => x.key === e.target.value);
                  const nops = opsFor(nc);
                  update(c.id, {
                    col: e.target.value,
                    op: nops.some((o) => o.key === c.op) ? c.op : nops[0].key,
                    value: '',
                  });
                }} className={`${sel} min-w-0 max-w-[9rem] flex-1`}>
                  {fieldOpts.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
                <select value={c.op} onChange={(e) => update(c.id, { op: e.target.value })} className={sel} title={typeHint}>
                  {opList.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                {!noVal && (col?.type === 'date' ? (
                  <input type="date" value={c.value} onChange={(e) => update(c.id, { value: e.target.value })} className={sel} />
                ) : col?.type === 'badge' ? (
                  <select value={c.value} onChange={(e) => update(c.id, { value: e.target.value })} className={`${sel} min-w-[7rem] flex-1`}>
                    <option value="">Select…</option>
                    {distinctValues(col, rows).map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                ) : (
                  <input value={c.value} onChange={(e) => update(c.id, { value: e.target.value })} type={col?.type === 'number' ? 'number' : 'text'}
                    placeholder={col?.type === 'number' ? 'Enter a number' : 'Enter a value'} className={`${sel} min-w-[6rem] flex-1`} />
                ))}
                <button onClick={() => remove(c.id)} aria-label="Remove this filter rule" className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={add}
        disabled={!cols.length}
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-500 hover:border-primary-400 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:text-slate-500"
      >
        <Plus className="h-3 w-3" /> Add another rule
      </button>

      {staged && (
        <div className="mt-3 flex items-center gap-2 border-t border-primary-200/60 pt-3">
          <button
            type="button"
            onClick={onApply}
            disabled={!dirty}
            className="inline-flex flex-1 items-center justify-center rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply filters
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
