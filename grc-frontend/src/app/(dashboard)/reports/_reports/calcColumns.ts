// Calculated columns — user-defined fields derived from other columns.
//
// The whole feature rides on `ColumnDef.accessor`, which the grid, filters,
// sorting, grouping, charts, the Dashboard cards and every exporter already
// read through. A calculated column is therefore just a synthesised ColumnDef
// appended to the catalog: nothing downstream needs to know it isn't a real
// field, and there is no second code path to keep in step.
//
// Recipes, not a formula language. GRC reporting wants days open, days
// overdue, inherent minus residual, coverage %, and banding a score — five
// shapes that three dropdowns can express. An expression parser would need an
// editor, autocomplete, validation and error surfacing before a single user
// could type a working formula, so it would cost far more UI than it earns.
// ponytail: recipe set, not an expression language — add a parser only when a
// real request cannot be phrased as one of these.
//
// Evaluation reuses grid-utils so a calculated column treats blanks exactly
// like a real one: `numericValue` returns null (not 0) for an empty cell, and
// every recipe propagates null rather than inventing a zero. A "days open" of
// 0 for rows with no start date would read as opened-today.

import type { ColumnDef, Row } from './types';
// Explicit extension so `node --test calcColumns.test.ts` can load this module
// directly (Node's ESM resolver is fully-specified). Webpack resolves it the
// same either way. Keeping the blank-vs-zero guard in grid-utils rather than
// forking it here is the whole reason this import exists.
import { numericValue, rawValue } from './grid-utils.ts';

/** Operand sentinel: evaluate against the day the report is run. */
export const TODAY = '__today__';

export type CalcKind = 'days_between' | 'difference' | 'ratio' | 'bucket' | 'concat';

export interface CalcBand {
  /** Upper bound, inclusive. The final band is open-ended when `max` is null. */
  max: number | null;
  label: string;
}

export interface CalcColumnDef {
  id: string;
  label: string;
  kind: CalcKind;
  a: string;
  b?: string;
  /** ratio: render as a percentage rather than a raw quotient. */
  asPercent?: boolean;
  /** ratio / difference: decimal places (default 1 for ratio, 0 for whole numbers). */
  decimals?: number;
  /** bucket: ascending bands. */
  bands?: CalcBand[];
  /** concat: text placed between the two values. */
  separator?: string;
}

export const CALC_PREFIX = 'calc_';
export const calcKey = (id: string) => `${CALC_PREFIX}${id}`;
export const isCalcKey = (key: string) => key.startsWith(CALC_PREFIX);

export const CALC_KINDS: { kind: CalcKind; label: string; hint: string }[] = [
  { kind: 'days_between', label: 'Days between', hint: 'Days from one date to another — use Today for age or overdue' },
  { kind: 'difference', label: 'Difference', hint: 'First number minus the second — e.g. inherent minus residual' },
  { kind: 'ratio', label: 'Ratio / percentage', hint: 'First number divided by the second' },
  { kind: 'bucket', label: 'Band a number', hint: 'Turn a score into labelled ranges you can group and chart by' },
  { kind: 'concat', label: 'Join text', hint: 'Two fields in one column' },
];

const COLUMN_TYPE: Record<CalcKind, ColumnDef['type']> = {
  days_between: 'number',
  difference: 'number',
  ratio: 'number',
  bucket: 'badge',
  concat: 'text',
};

/** Whether an operand slot takes a date, a number, or text. Drives which
 *  columns the picker offers, so a user can't build `title ÷ severity`. */
export function operandType(kind: CalcKind): 'date' | 'number' | 'text' {
  if (kind === 'days_between') return 'date';
  if (kind === 'concat') return 'text';
  return 'number';
}

export function needsSecondOperand(kind: CalcKind): boolean {
  return kind !== 'bucket';
}

const DAY_MS = 86_400_000;

/** Midnight local for a cell value, or null when it isn't a date.
 *  Day-bucketed to match how grid-utils compares dates, so "days overdue"
 *  never changes by one depending on the time of day a row was stamped. */
function dayStart(v: unknown): number | null {
  if (v === TODAY) {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  }
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const DEFAULT_BANDS: CalcBand[] = [
  { max: 4, label: 'Low' },
  { max: 9, label: 'Medium' },
  { max: 15, label: 'High' },
  { max: null, label: 'Critical' },
];

function bandFor(n: number, bands: CalcBand[]): string {
  for (const b of bands) {
    if (b.max == null || n <= b.max) return b.label;
  }
  return bands[bands.length - 1]?.label ?? '';
}

/** A missing or malformed definition must not throw inside a render. */
export function calcIsComplete(def: CalcColumnDef): boolean {
  if (!def.label?.trim() || !def.a) return false;
  if (needsSecondOperand(def.kind) && !def.b) return false;
  if (def.kind === 'bucket' && !(def.bands ?? DEFAULT_BANDS).length) return false;
  return true;
}

/** Turn a definition into a real column. `resolve` looks up the operand
 *  columns; an operand that no longer exists (module switched, column removed)
 *  yields an empty cell rather than a crash or a fabricated zero. */
export function buildCalcColumn(
  def: CalcColumnDef,
  resolve: (key: string) => ColumnDef | undefined,
): ColumnDef {
  const type = COLUMN_TYPE[def.kind];
  const colA = def.a === TODAY ? undefined : resolve(def.a);
  const colB = def.b === TODAY ? undefined : resolve(def.b ?? '');

  const num = (key: string | undefined, col: ColumnDef | undefined, row: Row): number | null => {
    if (!key || !col) return null;
    return numericValue(col, row);
  };
  const dateOf = (key: string | undefined, col: ColumnDef | undefined, row: Row): number | null => {
    if (key === TODAY) return dayStart(TODAY);
    if (!col) return null;
    return dayStart(rawValue(col, row));
  };
  const textOf = (col: ColumnDef | undefined, row: Row): string => {
    if (!col) return '';
    const v = rawValue(col, row);
    return v == null ? '' : String(v);
  };

  const accessor = (row: Row): unknown => {
    switch (def.kind) {
      case 'days_between': {
        const from = dateOf(def.a, colA, row);
        const to = dateOf(def.b, colB, row);
        if (from == null || to == null) return null;
        return Math.round((to - from) / DAY_MS);
      }
      case 'difference': {
        const a = num(def.a, colA, row);
        const b = num(def.b, colB, row);
        if (a == null || b == null) return null;
        return a - b;
      }
      case 'ratio': {
        const a = num(def.a, colA, row);
        const b = num(def.b, colB, row);
        // Dividing by zero is undefined, not infinite and not 100%.
        if (a == null || b == null || b === 0) return null;
        const q = a / b;
        return def.asPercent ? q * 100 : q;
      }
      case 'bucket': {
        const a = num(def.a, colA, row);
        if (a == null) return null;
        return bandFor(a, def.bands ?? DEFAULT_BANDS);
      }
      case 'concat': {
        const a = textOf(colA, row);
        const b = textOf(colB, row);
        const sep = def.separator ?? ' · ';
        if (!a && !b) return null;
        return [a, b].filter(Boolean).join(sep);
      }
      default:
        return null;
    }
  };

  const decimals = def.decimals ?? (def.kind === 'ratio' && !def.asPercent ? 2 : def.kind === 'ratio' ? 1 : 0);

  return {
    key: calcKey(def.id),
    label: def.label,
    type,
    width: type === 'number' ? 120 : 180,
    align: type === 'number' ? 'right' : 'left',
    // Averaging a derived per-row number is the useful default; summing a
    // percentage or an age is not.
    agg: type === 'number' ? 'avg' : undefined,
    accessor,
    ...(type === 'number'
      ? {
          format: (v: unknown) => {
            if (v == null || v === '') return '';
            const n = Number(v);
            if (!Number.isFinite(n)) return '';
            const s = decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
            return def.kind === 'ratio' && def.asPercent ? `${s}%` : s;
          },
        }
      : {}),
  };
}

/** Every valid definition in a spec, as columns. */
export function buildCalcColumns(
  defs: CalcColumnDef[] | undefined,
  resolve: (key: string) => ColumnDef | undefined,
): ColumnDef[] {
  return (defs ?? []).filter(calcIsComplete).map((d) => buildCalcColumn(d, resolve));
}

export function newCalcId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export { DEFAULT_BANDS };
