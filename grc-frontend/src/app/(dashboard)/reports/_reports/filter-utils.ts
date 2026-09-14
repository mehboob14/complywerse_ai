// Faceted / multi-value filter helpers for Quick export + explore grid.

import type { ColumnDef, Row } from './types';

/** Sentinel stored inside an `in` / `notin` value list = blank / unassigned. */
export const EMPTY_TOKEN = '__EMPTY__';

const FACET_HINT =
  /(status|state|owner|assignee|category|type|tier|severity|priority|maturity|stage|format|closed|stale|flag|facing|breached|kev|source|workflow|requester|uploader)/i;

/** Encode multi-select values for FilterRule.value (JSON array of strings). */
export function encodeMultiValue(values: string[]): string {
  const cleaned = values.map((v) => String(v)).filter((v) => v.length > 0);
  return JSON.stringify(cleaned);
}

/** Decode FilterRule.value — JSON array, legacy `|` join, or single string. */
export function decodeMultiValue(raw: string | undefined | null): string[] {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x)).filter((x) => x.length > 0);
      }
    } catch {
      /* fall through */
    }
  }
  if (s.includes('|')) {
    return s.split('|').map((x) => x.trim()).filter(Boolean);
  }
  return [s];
}

function cellText(col: ColumnDef, row: Row): string {
  const raw = col.accessor ? col.accessor(row) : row[col.key];
  if (col.format) return col.format(raw, row) || '';
  if (raw == null) return '';
  return String(raw);
}

function cellEmpty(col: ColumnDef, row: Row): boolean {
  const raw = col.accessor ? col.accessor(row) : row[col.key];
  const text = cellText(col, row);
  return !text && (raw == null || String(raw).trim() === '');
}

/** Status / owner / type-style fields — offer multi-select facets. */
export function isFacetableColumn(col: ColumnDef | undefined | null, rows: Row[] = []): boolean {
  if (!col) return false;
  if (col.type === 'badge') return true;
  if (col.type === 'linkage' || col.type === 'number' || col.type === 'date') return false;
  if (FACET_HINT.test(col.key) || FACET_HINT.test(col.label || '')) return true;
  if (!rows.length) return false;
  const vals = facetOptions(col, rows);
  // Low-cardinality text only — free-text titles stay as contains.
  return vals.length > 0 && vals.length <= 48 && vals.length <= Math.max(8, rows.length * 0.6);
}

/** Numeric link / mapping counts — "none linked" ≈ equals 0. */
export function isCountColumn(col: ColumnDef | undefined | null): boolean {
  if (!col || col.type !== 'number') return false;
  const k = col.key || '';
  const label = col.label || '';
  if (/_count$/i.test(k) || /_(links|mappings)_count$/i.test(k)) return true;
  if (/linked/i.test(k) || /linked/i.test(label)) return true;
  if (/\bcount\b/i.test(label) && !/^id$/i.test(k)) return true;
  return false;
}

export function facetOptions(col: ColumnDef, rows: Row[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const t = cellText(col, r);
    if (t) set.add(t);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** How many rows have a blank value for this column (for the "(none)" chip). */
export function emptyCount(col: ColumnDef, rows: Row[]): number {
  let n = 0;
  for (const r of rows) {
    if (cellEmpty(col, r)) n += 1;
  }
  return n;
}

export function defaultOpForColumn(col: ColumnDef | undefined | null, rows: Row[] = []): string {
  if (!col) return 'contains';
  if (col.type === 'linkage') return 'notlinked';
  if (col.type === 'number') return 'eq';
  if (col.type === 'date') return 'on';
  if (col.type === 'badge' || isFacetableColumn(col, rows)) return 'in';
  return 'contains';
}

/** Filters that must run after enrich / in the browser (not pure SQL on the base table). */
export function isClientSideFilter(
  colKey: string,
  op: string,
  resolveCol?: (key: string) => ColumnDef | undefined,
): boolean {
  if (op === 'linked' || op === 'notlinked') return true;
  if (
    colKey.startsWith('linkpresence_')
    || colKey.startsWith('link_')
    || colKey.startsWith('xmod_')
  ) return true;
  const col = resolveCol?.(colKey);
  if (isCountColumn(col)) return true;
  // Display-name enrichments (owner_name etc.) aren't real SQL columns.
  if (/_name$/i.test(colKey) && colKey !== 'name') return true;
  return false;
}
