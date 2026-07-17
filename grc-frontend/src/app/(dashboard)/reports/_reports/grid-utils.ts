// Shared value/format/filter/sort helpers for the report grid + exporters.

import type { ColumnDef, ColumnFilter, FilterRule, FilterRules, Row, SortSpec } from './types';
import { OPERATORS } from './types';

/** A condition only counts once it has a column, an operator, and (for value
 *  operators) a non-blank value — so the builder's seeded empty row is ignored
 *  instead of reading as an active "contains ''" that matches everything. */
export function isActiveCondition(c: FilterRule): boolean {
  if (!c.col || !c.op) return false;
  if (c.op === 'empty' || c.op === 'notempty') return true;
  return c.value != null && String(c.value).trim() !== '';
}

/** Parse a yyyy-mm-dd filter value as LOCAL midnight (not UTC). Mixing a
 *  UTC-parsed date-only value with local-parsed row timestamps is what caused
 *  the negative-UTC off-by-one. Returns [y, m0, d] or null. */
function localYMD(value: string): [number, number, number] | null {
  const [y, mo, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !mo || !d) return null;
  return [y, mo - 1, d];
}

export function fmtDate(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function rawValue(col: ColumnDef, row: Row): unknown {
  return col.accessor ? col.accessor(row) : row[col.key];
}

/** Numeric value of a cell, or null when the cell is genuinely empty.
 *  Guards the `Number(null) === 0` / `Number('') === 0` trap: both are *finite*,
 *  so a naive Number()+isFinite filter counts blanks as zeros — which drags
 *  averages down and inflates the divisor. Blanks must be excluded, not zeroed. */
export function numericValue(col: ColumnDef, row: Row): number | null {
  const raw = rawValue(col, row);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;  // whitespace-only is empty, not 0
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function displayText(col: ColumnDef, row: Row): string {
  const raw = rawValue(col, row);
  if (col.format) return col.format(raw, row);
  if (col.type === 'date') return fmtDate(raw);
  if (raw == null) return '';
  return String(raw);
}

export function rowMatchesSearch(cols: ColumnDef[], row: Row, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return cols.some((c) => displayText(c, row).toLowerCase().includes(s));
}

/** Compute an absolute [from,to] window for a relative preset (evaluated now). */
export function relRange(rel: string): { from?: Date; to?: Date } {
  const now = new Date();
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const today = startOfDay(now);
  const daysAgo = (n: number) => startOfDay(new Date(Date.now() - n * 86400000));
  switch (rel) {
    case 'today': return { from: today, to: now };
    case 'last7': return { from: daysAgo(7), to: now };
    case 'last30': return { from: daysAgo(30), to: now };
    case 'last90': return { from: daysAgo(90), to: now };
    case 'thismonth': return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    case 'thisquarter': return { from: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1), to: now };
    case 'thisyear': return { from: new Date(now.getFullYear(), 0, 1), to: now };
    case 'next30': return { from: now, to: new Date(Date.now() + 30 * 86400000) };
    case 'overdue': return { to: today };
    default: return {};
  }
}

export function rowMatchesFilters(cols: ColumnDef[], row: Row, filters: Record<string, ColumnFilter>): boolean {
  for (const c of cols) {
    const f = filters[c.key];
    if (!f) continue;
    const raw = rawValue(c, row);
    const text = displayText(c, row);
    if (f.values && f.values.length && !f.values.includes(text)) return false;
    if (f.text && !text.toLowerCase().includes(f.text.toLowerCase())) return false;
    if (c.type === 'date' && (f.from || f.to || f.rel)) {
      const d = raw ? new Date(String(raw)) : null;
      if (!d || Number.isNaN(d.getTime())) return false;
      // Parse manual from/to as LOCAL day boundaries so the compare matches the
      // (local) row timestamps — see localYMD.
      const fromYMD = f.from ? localYMD(f.from) : null;
      const toYMD = f.to ? localYMD(f.to) : null;
      let from: Date | undefined = fromYMD ? new Date(fromYMD[0], fromYMD[1], fromYMD[2]) : undefined;
      let to: Date | undefined = toYMD ? new Date(toYMD[0], toYMD[1], toYMD[2], 23, 59, 59, 999) : undefined;
      if (f.rel) { const r = relRange(f.rel); if (r.from) from = r.from; if (r.to) to = r.to; }
      if (from && d < from) return false;
      if (to && d > to) return false;
    }
  }
  return true;
}

/** Evaluate one advanced-filter condition against a row. */
function evalCond(col: ColumnDef, row: Row, op: string, value: string): boolean {
  const text = displayText(col, row).toLowerCase();
  const v = (value || '').toLowerCase();
  // Numeric comparisons use numericValue so a blank/whitespace cell is *empty*,
  // not 0 — otherwise `< 5`, `= 0`, `≥ 0` all wrongly match un-scored rows.
  if (col.type === 'number' && op !== 'empty' && op !== 'notempty') {
    const nv = numericValue(col, row);
    const tv = Number(value);
    if (nv === null || !Number.isFinite(tv)) return false;   // blank never matches a numeric predicate
    switch (op) {
      case 'eq': return nv === tv;
      case 'neq': return nv !== tv;
      case 'gt': return nv > tv;
      case 'lt': return nv < tv;
      case 'gte': return nv >= tv;
      case 'lte': return nv <= tv;
      default: return false;
    }
  }
  switch (op) {
    case 'contains': return text.includes(v);
    case 'notcontains': return !text.includes(v);
    case 'eq': return text === v;
    case 'neq': return text !== v;
    case 'starts': return text.startsWith(v);
    case 'empty': return !text;
    case 'notempty': return !!text;
    case 'before': case 'after': case 'on': {
      const raw = rawValue(col, row);
      const d = raw ? new Date(String(raw)) : null;
      if (!d || Number.isNaN(d.getTime()) || !value) return false;
      const ymd = localYMD(value);
      if (!ymd) return false;
      const [y, mo, dd] = ymd;
      if (op === 'on') return d.getFullYear() === y && d.getMonth() === mo && d.getDate() === dd;
      if (op === 'before') return d < new Date(y, mo, dd);           // before local midnight of the day
      return d >= new Date(y, mo, dd + 1);                           // 'after' = strictly after the day
    }
    default: return true;
  }
}

/** Apply the advanced AND/OR builder to a row. */
export function rowMatchesRules(cols: ColumnDef[], row: Row, rules: FilterRules): boolean {
  const active = rules.conditions.filter(isActiveCondition);
  if (!active.length) return true;
  const results = active.map((c) => {
    const col = cols.find((x) => x.key === c.col);
    return col ? evalCond(col, row, c.op, c.value) : true;
  });
  return rules.logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
}

/** Plain-English summary of the active filters — so an exported report states
 *  which slice produced its numbers instead of presenting them unqualified. */
export function describeRules(cols: ColumnDef[], rules: FilterRules): string {
  const active = rules.conditions.filter(isActiveCondition);
  if (!active.length) return 'None';
  return active.map((c) => {
    const col = cols.find((x) => x.key === c.col);
    const ops = OPERATORS[col?.type || 'text'] || OPERATORS.text;
    const opLabel = ops.find((o) => o.key === c.op)?.label ?? c.op;
    const needsValue = c.op !== 'empty' && c.op !== 'notempty';
    return `${col?.label ?? c.col} ${opLabel}${needsValue && c.value ? ` “${c.value}”` : ''}`;
  }).join(rules.logic === 'AND' ? ' and ' : ' or ');
}

/** Group rows by a column's display value (sorted by group label). */
export function groupRows(col: ColumnDef, rows: Row[]): { key: string; rows: Row[] }[] {
  const map = new Map<string, Row[]>();
  for (const r of rows) { const k = displayText(col, r) || '—'; (map.get(k) ?? map.set(k, []).get(k)!).push(r); }
  return Array.from(map.entries()).map(([key, rs]) => ({ key, rows: rs })).sort((a, b) => a.key.localeCompare(b.key));
}

/** Aggregate a numeric column over a set of rows (sum or avg). */
export function aggregate(col: ColumnDef, rows: Row[]): string {
  const nums = rows.map((r) => numericValue(col, r)).filter((n): n is number => n !== null);
  if (!nums.length) return '';
  const sum = nums.reduce((a, b) => a + b, 0);
  return col.agg === 'avg' ? (sum / nums.length).toFixed(1) : String(sum);
}

export function compareRows(cols: ColumnDef[], a: Row, b: Row, sorts: SortSpec[]): number {
  for (const s of sorts) {
    const col = cols.find((c) => c.key === s.key);
    if (!col) continue;
    let cmp = 0;
    if (col.type === 'number') {
      // Blanks sort to the end (asc) instead of being coerced to 0 and
      // interleaving with real zeros/negatives.
      const av = numericValue(col, a); const bv = numericValue(col, b);
      if (av === null && bv === null) cmp = 0;
      else if (av === null) cmp = 1;
      else if (bv === null) cmp = -1;
      else cmp = av - bv;
    } else if (col.type === 'date') {
      const av = rawValue(col, a); const bv = rawValue(col, b);
      const ad = av ? new Date(String(av)).getTime() : 0;
      const bd = bv ? new Date(String(bv)).getTime() : 0;
      cmp = (ad || 0) - (bd || 0);
    } else {
      cmp = displayText(col, a).localeCompare(displayText(col, b));
    }
    if (cmp !== 0) return s.dir === 'asc' ? cmp : -cmp;
  }
  return 0;
}

/** Distinct display values for a column — powers multi-select filters. */
export function distinctValues(col: ColumnDef, rows: Row[]): string[] {
  const set = new Set<string>();
  for (const r of rows) { const t = displayText(col, r); if (t) set.add(t); }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
