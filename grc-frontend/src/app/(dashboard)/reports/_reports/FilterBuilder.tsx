'use client';

// The filter rules of a report: an AND/OR list of conditions (field, condition, value), the pick list for a field that has a few values, shortcuts for a count of zero, and the staged Apply / Reset the
// report uses so the (possibly large) server query runs once, not on every keystroke. It lives in the rail's Filters section. Logic is unchanged from the builder it replaced (filter-utils.ts decides
// which operator and which control a column gets); the markup is the kit's: tokens, 12px text, 44px targets on a phone, every control named.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { clsx } from 'clsx';
import { Button, Checkbox, IconButton, SegmentedControl, Select, TextInput } from '@/components/ui/ds';
import type { ColumnDef, FilterRules, Row } from './types';
import { FILTER_TYPE_HINT, OPERATORS } from './types';
import { EMPTY_TOKEN, decodeMultiValue, defaultOpForColumn, emptyCount, encodeMultiValue, facetOptions, isCountColumn, isFacetableColumn } from './filter-utils';

const CHIP = 'inline-flex min-h-ds-control-sm items-center rounded-full border px-[10px] text-ds-label focus-visible:outline-none focus-visible:shadow-ds-ring';
const NO_VALUE = ['empty', 'notempty', 'linked', 'notlinked'];

export default function FilterBuilder({
  cols, rows, rules, onChange, staged = false, onApply, onReset, dirty = false, lookupCols,
}: {
  cols: ColumnDef[];
  rows: Row[];
  rules: FilterRules;
  onChange: (rules: FilterRules) => void;
  staged?: boolean;
  onApply?: () => void;
  onReset?: () => void;
  dirty?: boolean;
  /** Broader catalog for resolving labels/types of fields kept after deselection. */
  lookupCols?: ColumnDef[];
}) {
  const uid = useId();
  const ruleId = useRef(0);
  const seeded = useRef(false);
  const [facetQ, setFacetQ] = useState<Record<string, string>>({});

  const resolveCol = (key: string) => cols.find((x) => x.key === key) || lookupCols?.find((x) => x.key === key);

  /** Selected columns for new picks; keep a stale option only for this rule's current field. */
  const fieldOptionsFor = (currentKey: string): ColumnDef[] => {
    const list = [...cols];
    if (currentKey && !cols.some((c) => c.key === currentKey)) list.push(resolveCol(currentKey) ?? { key: currentKey, label: currentKey, type: 'text' });
    return list;
  };

  const opsFor = (col?: ColumnDef) => {
    const base = OPERATORS[col?.type || 'text'] || OPERATORS.text;
    // Free-text fields: hide multi-select ops (they stay available for facets / badge).
    if (col?.type === 'text' && !isFacetableColumn(col, rows)) return base.filter((o) => o.key !== 'in' && o.key !== 'notin');
    return base;
  };
  const defaultOpFor = (col?: ColumnDef) => defaultOpForColumn(col, rows);

  // Open with one empty condition so the section is never a dead end.
  useEffect(() => {
    if (seeded.current || rules.conditions.length || !cols.length) return;
    seeded.current = true;
    const col0 = cols.find((c) => c.type !== 'linkage') || cols[0];
    onChange({ ...rules, conditions: [{ id: `r${ruleId.current++}`, col: col0?.key || '', op: defaultOpFor(col0), value: '' }] });
  }, [rules, cols, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => {
    if (!cols.length) return;
    const col0 = cols.find((c) => c.type !== 'linkage') || cols[0];
    onChange({ ...rules, conditions: [...rules.conditions, { id: `r${ruleId.current++}`, col: col0?.key || '', op: defaultOpFor(col0), value: '' }] });
  };
  const update = (id: string, p: Partial<{ col: string; op: string; value: string }>) => onChange({ ...rules, conditions: rules.conditions.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const remove = (id: string) => onChange({ ...rules, conditions: rules.conditions.filter((c) => c.id !== id) });

  const toggleMulti = (id: string, token: string) => {
    const rule = rules.conditions.find((c) => c.id === id);
    if (!rule) return;
    const cur = new Set(decodeMultiValue(rule.value));
    if (cur.has(token)) cur.delete(token); else cur.add(token);
    update(id, { op: rule.op === 'notin' ? 'notin' : 'in', value: encodeMultiValue(Array.from(cur)) });   // `in` when picking; keep `notin` if the person chose it
  };

  const regularCols = useMemo(() => cols.filter((c) => c.type !== 'linkage'), [cols]);
  const linkCols = useMemo(() => cols.filter((c) => c.type === 'linkage'), [cols]);

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <SegmentedControl
          label="How the rules combine"
          name={`rules-logic-${uid}`}
          options={[{ value: 'AND', label: 'Match all' }, { value: 'OR', label: 'Match any' }]}
          value={rules.logic}
          onChange={(logic) => onChange({ ...rules, logic })}
        />
        {rules.conditions.length > 0 && <Button size="sm" variant="ghost" onClick={() => onChange({ logic: rules.logic, conditions: [] })}>Clear rules</Button>}
      </div>

      {!cols.length && <p className="m-0 rounded-ds-control border border-dashed border-ds-border-strong px-[12px] py-[8px] text-ds-label text-ds-fg-muted">Choose a module first so the fields can be filtered.</p>}

      <div className="flex flex-col gap-[8px]">
        {rules.conditions.map((c, i) => {
          const fieldOpts = fieldOptionsFor(c.col);
          const col = resolveCol(c.col);
          const ops = opsFor(col);
          const opList = ops.some((o) => o.key === c.op) ? ops : [...ops, { key: c.op, label: c.op }];
          const noVal = NO_VALUE.includes(c.op);
          const facet = col ? (col.type === 'badge' || isFacetableColumn(col, rows)) && (c.op === 'in' || c.op === 'notin' || c.op === 'eq' || c.op === 'neq') : false;
          const multiMode = c.op === 'in' || c.op === 'notin';
          const selected = multiMode ? decodeMultiValue(c.value) : [];
          const options = col && facet ? facetOptions(col, rows) : [];
          const blanks = col && facet ? emptyCount(col, rows) : 0;
          const q = (facetQ[c.id] || '').trim().toLowerCase();
          const shown = q ? options.filter((v) => v.toLowerCase().includes(q)) : options;
          const where = i === 0 ? 'When' : rules.logic === 'AND' ? 'And' : 'Or';

          return (
            <div key={c.id} role="group" aria-label={`Rule ${i + 1}`} className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[8px]">
              <div className="flex items-center justify-between gap-[8px]">
                <span className="text-ds-label text-ds-fg-muted">{where}</span>
                <IconButton label={`Remove rule ${i + 1}`} onClick={() => remove(c.id)}><X aria-hidden /></IconButton>
              </div>
              <Select
                aria-label="Field"
                value={c.col}
                onChange={(e) => {
                  const nc = resolveCol(e.target.value) || fieldOpts.find((x) => x.key === e.target.value);
                  update(c.id, { col: e.target.value, op: defaultOpFor(nc), value: '' });
                }}
              >
                {regularCols.length > 0 && (
                  <optgroup label="Fields">{fieldOpts.filter((x) => x.type !== 'linkage').map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>
                )}
                {(linkCols.length > 0 || fieldOpts.some((x) => x.type === 'linkage')) && (
                  <optgroup label="Link checks">{fieldOpts.filter((x) => x.type === 'linkage').map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>
                )}
              </Select>
              <Select
                aria-label="Condition"
                title={FILTER_TYPE_HINT[col?.type || 'text']}
                value={c.op}
                onChange={(e) => {
                  const nextOp = e.target.value;
                  // Switching into multi-select from a single value keeps the pick.
                  if ((nextOp === 'in' || nextOp === 'notin') && c.value && !c.value.startsWith('[')) { update(c.id, { op: nextOp, value: encodeMultiValue([c.value]) }); return; }
                  if (nextOp !== 'in' && nextOp !== 'notin' && (c.op === 'in' || c.op === 'notin')) {
                    update(c.id, { op: nextOp, value: decodeMultiValue(c.value).find((x) => x !== EMPTY_TOKEN) || '' });
                    return;
                  }
                  update(c.id, { op: nextOp });
                }}
              >
                {opList.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </Select>

              {!noVal && !facet && col?.type === 'date' && <TextInput type="date" aria-label="Date" value={c.value} onChange={(e) => update(c.id, { value: e.target.value })} />}
              {!noVal && !facet && col?.type === 'number' && <TextInput type="number" aria-label="Number" placeholder="Number" value={c.value} onChange={(e) => update(c.id, { value: e.target.value })} />}
              {!noVal && !facet && col?.type !== 'date' && col?.type !== 'number' && col?.type !== 'linkage' && (
                <TextInput aria-label="Value" placeholder="Value" value={c.value} onChange={(e) => update(c.id, { value: e.target.value })} autoComplete="off" />
              )}
              {noVal && col?.type === 'linkage' && <span className="text-ds-label text-ds-fg-muted">{c.op === 'notlinked' ? 'No linked records' : 'At least one link'}</span>}

              {isCountColumn(col) && !noVal && (
                <div className="flex flex-wrap gap-[6px]">
                  <button type="button" aria-pressed={c.op === 'eq' && c.value === '0'} onClick={() => update(c.id, { op: 'eq', value: '0' })} className={clsx(CHIP, c.op === 'eq' && c.value === '0' ? 'border-transparent bg-ds-primary text-ds-on-primary' : 'border-ds-border-strong bg-ds-surface text-ds-fg-body hover:bg-ds-surface-hover')}>None (0)</button>
                  <button type="button" aria-pressed={c.op === 'gt' && c.value === '0'} onClick={() => update(c.id, { op: 'gt', value: '0' })} className={clsx(CHIP, c.op === 'gt' && c.value === '0' ? 'border-transparent bg-ds-primary text-ds-on-primary' : 'border-ds-border-strong bg-ds-surface text-ds-fg-body hover:bg-ds-surface-hover')}>Has links (1 or more)</button>
                </div>
              )}

              {facet && col && !noVal && (
                <div className="flex flex-col gap-[6px]">
                  {(c.op === 'eq' || c.op === 'neq') && <p className="m-0 text-ds-label text-ds-fg-muted">To pick several values, change the condition to “is any of”.</p>}
                  {multiMode ? (
                    <>
                      {options.length > 8 && (
                        <TextInput type="search" aria-label="Find a value" placeholder="Find a value" value={facetQ[c.id] || ''} onChange={(e) => setFacetQ((prev) => ({ ...prev, [c.id]: e.target.value }))} leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />} autoComplete="off" />
                      )}
                      <div role="group" aria-label="Values" className="max-h-[176px] overflow-y-auto rounded-ds-control border border-ds-border bg-ds-surface px-[8px]">
                        <FacetRow checked={selected.includes(EMPTY_TOKEN)} onToggle={() => toggleMulti(c.id, EMPTY_TOKEN)} label="(none / blank)" hint={blanks > 0 ? String(blanks) : undefined} />
                        {shown.length === 0
                          ? <p className="m-0 px-[4px] py-[8px] text-ds-label text-ds-fg-muted">{options.length === 0 ? 'No values in the data yet.' : 'No values match.'}</p>
                          : shown.map((v) => <FacetRow key={v} checked={selected.includes(v)} onToggle={() => toggleMulti(c.id, v)} label={v} />)}
                      </div>
                      {selected.length > 0 && <span className="text-ds-label text-ds-fg-muted">{selected.length} selected{selected.includes(EMPTY_TOKEN) ? ', includes blank' : ''}</span>}
                    </>
                  ) : (
                    <Select aria-label="Value" value={c.value} onChange={(e) => update(c.id, { value: e.target.value })}>
                      <option value="">Choose a value</option>
                      {options.map((v) => <option key={v} value={v}>{v}</option>)}
                    </Select>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-[8px]">
        <Button leftIcon={<Plus aria-hidden />} disabled={!cols.length} onClick={add}>Add rule</Button>
        {staged && (
          <>
            <Button variant="primary" disabled={!dirty} onClick={onApply}>Apply filters</Button>
            <Button variant="ghost" onClick={onReset}>Reset</Button>
          </>
        )}
      </div>
      {staged && dirty && <p role="status" className="m-0 text-ds-label text-ds-warning">The rules have changed. Apply them to refresh the rows.</p>}
    </div>
  );
}

function FacetRow({ checked, onToggle, label, hint }: { checked: boolean; onToggle: () => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-[8px]">
      <Checkbox label={<span className="[overflow-wrap:anywhere]">{label}</span>} checked={checked} onChange={onToggle} />
      {hint != null && <span className="shrink-0 text-ds-label tabular-nums text-ds-fg-muted">{hint}</span>}
    </div>
  );
}
