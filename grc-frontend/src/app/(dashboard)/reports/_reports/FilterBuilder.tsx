'use client';

// Advanced AND/OR condition builder. Shared by the Explore grid and the Report
// Builder so filtering behaves and reads identically in both.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import type { ColumnDef, FilterRules, Row } from './types';
import { FILTER_TYPE_HINT, OPERATORS } from './types';
import {
  EMPTY_TOKEN,
  decodeMultiValue,
  defaultOpForColumn,
  emptyCount,
  encodeMultiValue,
  facetOptions,
  isCountColumn,
  isFacetableColumn,
} from './filter-utils';

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
  const [facetQ, setFacetQ] = useState<Record<string, string>>({});

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

  const opsFor = (col?: ColumnDef) => {
    const base = OPERATORS[col?.type || 'text'] || OPERATORS.text;
    // Free-text fields: hide multi-select ops (they stay available for facets / badge).
    if (col?.type === 'text' && !isFacetableColumn(col, rows)) {
      return base.filter((o) => o.key !== 'in' && o.key !== 'notin');
    }
    return base;
  };

  const defaultOpFor = (col?: ColumnDef) => defaultOpForColumn(col, rows);

  // Open with one empty condition so the panel is never a dead end.
  useEffect(() => {
    if (seeded.current || rules.conditions.length || !cols.length) return;
    seeded.current = true;
    const col0 = cols.find((c) => c.type !== 'linkage') || cols[0];
    onChange({
      ...rules,
      conditions: [{ id: `r${ruleId.current++}`, col: col0?.key || '', op: defaultOpFor(col0), value: '' }],
    });
  }, [rules, cols, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => {
    if (!cols.length) return;
    const col0 = cols.find((c) => c.type !== 'linkage') || cols[0];
    onChange({
      ...rules,
      conditions: [...rules.conditions, { id: `r${ruleId.current++}`, col: col0?.key || '', op: defaultOpFor(col0), value: '' }],
    });
  };
  const update = (id: string, p: Partial<{ col: string; op: string; value: string }>) =>
    onChange({ ...rules, conditions: rules.conditions.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const remove = (id: string) => onChange({ ...rules, conditions: rules.conditions.filter((c) => c.id !== id) });

  const toggleMulti = (id: string, token: string) => {
    const rule = rules.conditions.find((c) => c.id === id);
    if (!rule) return;
    const cur = new Set(decodeMultiValue(rule.value));
    if (cur.has(token)) cur.delete(token);
    else cur.add(token);
    const next = Array.from(cur);
    // Prefer `in` when picking values; keep notin if user already chose it.
    const op = rule.op === 'notin' ? 'notin' : 'in';
    update(id, { op, value: encodeMultiValue(next) });
  };

  const sel = 'rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-primary-500 focus:outline-none';

  const regularCols = useMemo(() => cols.filter((c) => c.type !== 'linkage'), [cols]);
  const linkCols = useMemo(() => cols.filter((c) => c.type === 'linkage'), [cols]);

  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-3 ${compact ? '' : 'mb-3'}`}>
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rules</span>
          <div className="inline-flex overflow-hidden rounded-md border border-slate-200 bg-slate-50">
            {(['AND', 'OR'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onChange({ ...rules, logic: l })}
                className={`px-2 py-1 text-[11px] font-semibold ${
                  rules.logic === l ? 'bg-primary-500 text-[#0a0a0a]' : 'text-slate-500 hover:bg-white'
                }`}
              >
                {l === 'AND' ? 'Match ALL' : 'Match ANY'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rules.conditions.length > 0 && (
            <button
              type="button"
              onClick={() => onChange({ logic: rules.logic, conditions: [] })}
              className="text-[11px] font-medium text-slate-400 hover:text-rose-600"
            >
              Clear all
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close filters" className="rounded p-0.5 text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {staged && dirty && (
        <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
          Filters changed — click Apply to refresh results.
        </p>
      )}

      {!cols.length && (
        <p className="mb-2 rounded-md border border-dashed border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] leading-snug text-slate-500">
          Choose a module first so filter fields are available.
        </p>
      )}

      <div className="space-y-2">
        {rules.conditions.map((c, i) => {
          const fieldOpts = fieldOptionsFor(c.col);
          const col = resolveCol(c.col);
          const ops = opsFor(col);
          const opList = ops.some((o) => o.key === c.op)
            ? ops
            : [...ops, { key: c.op, label: c.op }];
          const noVal = ['empty', 'notempty', 'linked', 'notlinked'].includes(c.op);
          const facet = col ? (col.type === 'badge' || isFacetableColumn(col, rows)) && (c.op === 'in' || c.op === 'notin' || c.op === 'eq' || c.op === 'neq') : false;
          const multiMode = c.op === 'in' || c.op === 'notin';
          const selected = multiMode ? decodeMultiValue(c.value) : [];
          const options = col && facet ? facetOptions(col, rows) : [];
          const blanks = col && facet ? emptyCount(col, rows) : 0;
          const q = (facetQ[c.id] || '').trim().toLowerCase();
          const filteredOpts = q ? options.filter((v) => v.toLowerCase().includes(q)) : options;
          const countCol = isCountColumn(col);
          const typeHint = FILTER_TYPE_HINT[col?.type || 'text'];

          return (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
              <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'text-[11px]' : ''}`}>
                <span className="w-9 shrink-0 text-right text-[11px] font-medium text-slate-400">
                  {i === 0 ? 'When' : rules.logic === 'AND' ? 'and' : 'or'}
                </span>
                <select
                  value={c.col}
                  onChange={(e) => {
                    const nc = resolveCol(e.target.value) || fieldOpts.find((x) => x.key === e.target.value);
                    update(c.id, {
                      col: e.target.value,
                      op: defaultOpFor(nc),
                      value: '',
                    });
                  }}
                  className={`${sel} min-w-0 max-w-[10rem] flex-1`}
                >
                  {regularCols.length > 0 && (
                    <optgroup label="Fields">
                      {fieldOpts.filter((x) => x.type !== 'linkage').map((x) => (
                        <option key={x.key} value={x.key}>{x.label}</option>
                      ))}
                    </optgroup>
                  )}
                  {(linkCols.length > 0 || fieldOpts.some((x) => x.type === 'linkage')) && (
                    <optgroup label="Link checks">
                      {fieldOpts.filter((x) => x.type === 'linkage').map((x) => (
                        <option key={x.key} value={x.key}>{x.label}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <select
                  value={c.op}
                  onChange={(e) => {
                    const nextOp = e.target.value;
                    // Switching into multi-select from a single eq value preserves the pick.
                    if ((nextOp === 'in' || nextOp === 'notin') && c.value && !c.value.startsWith('[')) {
                      update(c.id, { op: nextOp, value: encodeMultiValue([c.value]) });
                      return;
                    }
                    if (nextOp !== 'in' && nextOp !== 'notin' && (c.op === 'in' || c.op === 'notin')) {
                      const first = decodeMultiValue(c.value).find((x) => x !== EMPTY_TOKEN) || '';
                      update(c.id, { op: nextOp, value: first });
                      return;
                    }
                    update(c.id, { op: nextOp });
                  }}
                  className={sel}
                  title={typeHint}
                >
                  {opList.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>

                {!noVal && !facet && col?.type === 'date' && (
                  <input
                    type="date"
                    value={c.value}
                    onChange={(e) => update(c.id, { value: e.target.value })}
                    className={sel}
                  />
                )}
                {!noVal && !facet && col?.type === 'number' && (
                  <input
                    type="number"
                    value={c.value}
                    onChange={(e) => update(c.id, { value: e.target.value })}
                    placeholder="Number"
                    className={`${sel} min-w-[5rem] flex-1`}
                  />
                )}
                {!noVal && !facet && col?.type !== 'date' && col?.type !== 'number' && col?.type !== 'linkage' && (
                  <input
                    value={c.value}
                    onChange={(e) => update(c.id, { value: e.target.value })}
                    placeholder="Value"
                    className={`${sel} min-w-[6rem] flex-1`}
                  />
                )}
                {noVal && col?.type === 'linkage' && (
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
                    {c.op === 'notlinked' ? 'No linked records' : 'At least one link'}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  aria-label="Remove this filter rule"
                  className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Count shortcuts — none linked / has links */}
              {countCol && !noVal && (
                <div className="mt-2 flex flex-wrap gap-1.5 pl-10">
                  <QuickChip
                    active={c.op === 'eq' && c.value === '0'}
                    onClick={() => update(c.id, { op: 'eq', value: '0' })}
                  >
                    None (0)
                  </QuickChip>
                  <QuickChip
                    active={c.op === 'gt' && c.value === '0'}
                    onClick={() => update(c.id, { op: 'gt', value: '0' })}
                  >
                    Has links (≥1)
                  </QuickChip>
                </div>
              )}

              {/* Facet multi-select */}
              {facet && col && !noVal && (
                <div className="mt-2 space-y-1.5 border-t border-slate-200/80 pt-2 pl-0 sm:pl-10">
                  {(c.op === 'eq' || c.op === 'neq') && (
                    <p className="text-[10px] text-slate-500">
                      Tip: switch to <span className="font-semibold">is any of</span> to pick several values.
                    </p>
                  )}
                  {multiMode && (
                    <>
                      {options.length > 8 && (
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-2 top-1.5 h-3 w-3 text-slate-400" />
                          <input
                            value={facetQ[c.id] || ''}
                            onChange={(e) => setFacetQ((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            placeholder="Find a value…"
                            className="w-full rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-[11px] focus:border-primary-500 focus:outline-none"
                          />
                        </div>
                      )}
                      <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1">
                        <FacetRow
                          checked={selected.includes(EMPTY_TOKEN)}
                          onToggle={() => toggleMulti(c.id, EMPTY_TOKEN)}
                          label="(none / blank)"
                          hint={blanks > 0 ? String(blanks) : undefined}
                          muted
                        />
                        {filteredOpts.length === 0 ? (
                          <p className="px-2 py-2 text-[11px] text-slate-400">
                            {options.length === 0 ? 'No values in the current data yet.' : 'No matches.'}
                          </p>
                        ) : (
                          filteredOpts.map((v) => (
                            <FacetRow
                              key={v}
                              checked={selected.includes(v)}
                              onToggle={() => toggleMulti(c.id, v)}
                              label={v}
                            />
                          ))
                        )}
                      </div>
                      {selected.length > 0 && (
                        <p className="text-[10px] text-slate-500">
                          {selected.length} selected
                          {selected.includes(EMPTY_TOKEN) ? ' · includes blank' : ''}
                        </p>
                      )}
                    </>
                  )}
                  {!multiMode && (
                    <select
                      value={c.value}
                      onChange={(e) => update(c.id, { value: e.target.value })}
                      className={`${sel} w-full`}
                    >
                      <option value="">Select…</option>
                      <option value="">(none — use “is empty”)</option>
                      {options.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={add}
        disabled={!cols.length}
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-500 hover:border-primary-400 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-3 w-3" /> Add rule
      </button>

      {staged && (
        <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3">
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

function QuickChip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? 'border-primary-300 bg-primary-500 text-[#0a0a0a]'
          : 'border-slate-200 bg-white text-slate-600 hover:border-primary-400 hover:text-primary-700'
      }`}
    >
      {children}
    </button>
  );
}

function FacetRow({
  checked,
  onToggle,
  label,
  hint,
  muted,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
        checked ? 'bg-primary-50 text-primary-900' : 'text-slate-700 hover:bg-slate-50'
      } ${muted ? 'italic text-slate-500' : ''}`}
    >
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
          checked ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'
        }`}
      >
        {checked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint != null && <span className="shrink-0 tabular-nums text-slate-400">{hint}</span>}
    </button>
  );
}
