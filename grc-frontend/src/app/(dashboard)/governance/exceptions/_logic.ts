// What the Policy exceptions page decides, as plain functions (no React, no @/ imports) so `node --test` runs _logic.test.ts against
// them: the order of the rows, the pages, the CSV, what a search keeps, and how dates and counts are said. The page only draws.
import { parseUtc } from '../../../../lib/serverTime.ts';
import { clampPage, rangeLabel } from '../documents/_workspace/libraryFormat.ts';

// ─── What a row and a column have to offer ───────────────────────────────────────────────────────────────────────────────

/** The fields of an exception that the sort, the CSV and the search read; the page's own ExceptionItem has more. */
export interface ExceptionFields {
  title: string;
  status: string;
  priority: string;
  created_at: string;
  expiry_date: string | null;
  document_title?: string;
  policy_name?: string;
  requested_by?: string;
  requested_by_name?: string;
}

/** The part of a column that sorting and the CSV need; the page adds how it is drawn. */
export interface DataCol<T> {
  id: string;
  header: string;
  /** the raw field to sort by, as the shared table did: two numbers compare as numbers, anything else as text */
  sort?: (row: T) => string | number;
  /** the raw field for the CSV; a column without one is not exported */
  csv?: (row: T) => string;
}

type DataField = Required<Pick<DataCol<ExceptionFields>, 'header' | 'sort' | 'csv'>>;

/**
 * The columns that carry data, by id (the page adds the cell, the width and whether it can be hidden). Raw values on purpose, as the
 * shared table's export had them: the status as the server names it ("pending_approval"), the date as it was sent, "" for no expiry.
 */
export const DATA_COLS: Record<'title' | 'status' | 'priority' | 'created' | 'expiry', DataField> = {
  title: { header: 'Title', sort: (e) => e.title, csv: (e) => e.title },
  status: { header: 'Status', sort: (e) => e.status, csv: (e) => e.status },
  priority: { header: 'Priority', sort: (e) => e.priority, csv: (e) => e.priority },
  created: { header: 'Created', sort: (e) => e.created_at, csv: (e) => e.created_at },
  expiry: { header: 'Expiry', sort: (e) => e.expiry_date ?? '', csv: (e) => e.expiry_date ?? '' },
};

// ─── Order ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Sort = { id: string; dir: 'asc' | 'desc' } | null;

/** A click on a header: ascending, then descending, then off; another header starts again at ascending. */
export const nextSort = (s: Sort, id: string): Sort => (s?.id !== id ? { id, dir: 'asc' } : s.dir === 'asc' ? { id, dir: 'desc' } : null);

/**
 * The rows in the order the header asks. No sort, a column that is hidden (not in `cols`) or one with no key leaves them as they are
 * (the same array). Never reorders its input; rows with equal keys keep their order.
 */
export function sortRows<T>(rows: T[], cols: DataCol<T>[], sort: Sort): T[] {
  const key = sort && cols.find((c) => c.id === sort.id)?.sort;
  if (!sort || !key) return rows;
  return [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return sort.dir === 'asc' ? d : -d;
  });
}

// ─── Columns ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The columns to draw: the ones that always show (the title, the actions) and the ones not switched off in the Columns menu. */
export const shownCols = <C extends { id: string; always?: boolean }>(cols: C[], hidden: string[]): C[] =>
  cols.filter((c) => c.always || !hidden.includes(c.id));

/** The Columns menu ticking a column off, or on again. */
export const toggleHidden = (hidden: string[], id: string): string[] => (hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]);

/** Narrowest the table goes: the Title column keeps at least this much beside the other columns' fixed widths; below it the card scrolls sideways. */
export const TITLE_MIN_WIDTH = 240;
export const tableMinWidth = (cols: { width?: number }[]): number => TITLE_MIN_WIDTH + cols.reduce((n, c) => n + (c.width ?? 0), 0);

// ─── Pages ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const PAGE_SIZES = [10, 15, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 15;

export interface Pager {
  /** the page to show, inside the pages there are */
  page: number;
  pages: number;
  /** the slice of the list to draw: list.slice(start, end) */
  start: number;
  end: number;
  /** "1–15 of 40" */
  label: string;
}

/** Where a list of `total` rows stands when the person asked for page `pageNo` (1-based): a list that shrank leaves them on its last page. */
export function pagerOf(total: number, pageNo: number, pageSize: number): Pager {
  const page = clampPage(pageNo, pageSize, total);
  return { page, pages: Math.max(1, Math.ceil(total / pageSize)), start: (page - 1) * pageSize, end: page * pageSize, label: rangeLabel(page, pageSize, total) };
}

// ─── CSV ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The data columns given (those with a `csv`), in their order: a header line, then a line per row. Commas, quotes and line breaks are quoted. */
export function toCsv<T>(cols: DataCol<T>[], rows: T[]): string {
  const shown = cols.filter((c) => c.csv);
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [shown.map((c) => c.header).join(','), ...rows.map((r) => shown.map((c) => cell(c.csv!(r))).join(','))].join('\n');
}

// ─── Search, counts, dates ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a search keeps: the exceptions whose title, policy or requester has the words in it, in any case. A blank search keeps all of
 * them (the very same array). The policy is the document's title, else the policy's name; the requester is the name, else the user.
 */
export function searchExceptions<T extends ExceptionFields>(list: T[], term: string): T[] {
  if (!term.trim()) return list;
  const q = term.trim().toLowerCase();       // "vpn " (a trailing space) is "vpn"
  return list.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      (e.document_title || e.policy_name || '').toLowerCase().includes(q) ||
      (e.requested_by_name || e.requested_by || '').toLowerCase().includes(q),
  );
}

/** "12 exceptions", "1 exception", and "3 of 12 exceptions" while a search narrows them. */
export const countLabel = (shown: number, total: number, searching: boolean): string =>
  `${searching ? `${shown} of ${total}` : total} ${total === 1 ? 'exception' : 'exceptions'}`;

const DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "08 Nov 2026"; "—" for no date. The server's times have no zone and are UTC (parseUtc); a date set in a date field is the day it says. */
export function formatDate(dateStr: string | null | undefined): string {
  const at = parseUtc(dateStr);
  return at ? DATE.format(at) : '—';
}
