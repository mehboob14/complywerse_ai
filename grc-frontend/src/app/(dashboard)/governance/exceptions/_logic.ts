// What the Policy exceptions page decides, as plain functions (no React, no @/ imports) so `node --test` runs _logic.test.ts against
// them: the order of the rows, the pages, the CSV, what a search keeps, and how dates and counts are said. The page only draws.
// Since the page moved onto the design-system kit (UX revamp, Phase 1, group D) this file also holds what only THIS page knows: what the server
// holds against what was loaded (the list is cut), which actions a row offers, what the form sends and how its dates are read, and what the charts
// are made of. How a header sorts, where the pages are drawn and how a date is written are the kit's (RegisterTable, Pager, lib/format).
import { parseUtc } from '../../../../lib/serverTime.ts';
import { NOT_SET, formatCount, formatDate as formatDay, formatDateTime as formatMoment } from '../../../../lib/format.ts';
import { exceptionStatus, type Tone } from '../../../../lib/status.ts';
import { clampPage, rangeLabel } from '../documents/_workspace/libraryFormat.ts';
import { toEditableText } from './_text.ts';
import type { SortState } from '../../../../components/ui/ds/tableModel.ts';

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
  /** the server sends the user's id (a number); older payloads a name */
  requested_by?: string | number;
  requested_by_name?: string;
  /** what the server really sends for the person's name */
  requester_name?: string;
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

/** The name the person asking is shown by: what the server sends (`requester_name`), else the older `requested_by_name`; '' when there is none. */
export const requesterOf = (e: Pick<ExceptionFields, 'requester_name' | 'requested_by_name'>): string => (e.requester_name || e.requested_by_name || '').trim();

/**
 * What a search keeps: the exceptions whose title, policy or requester has the words in it, in any case. A blank search keeps all of
 * them (the very same array). The policy is the document's title, else the policy's name; the requester is the name, else (older
 * payloads that carry a user name there) the user. The server's `requested_by` is the user's NUMBER: it is never searched, and never
 * called as text (it used to be, and a search that matched no title took the page down).
 */
export function searchExceptions<T extends ExceptionFields>(list: T[], term: string): T[] {
  if (!term.trim()) return list;
  const q = term.trim().toLowerCase();       // "vpn " (a trailing space) is "vpn"
  return list.filter(
    (e) =>
      String(e.title ?? '').toLowerCase().includes(q) ||
      (e.document_title || e.policy_name || '').toLowerCase().includes(q) ||
      (requesterOf(e) || (typeof e.requested_by === 'string' ? e.requested_by : '')).toLowerCase().includes(q),
  );
}

/**
 * "12 exceptions", "1 exception", and "3 of 12 exceptions" while a search narrows them. With `server` (serverList): a list the server cut says
 * how many are loaded out of how many there are ("100 of 172 exceptions", "100+ exceptions" when that is not known), and a search says
 * what it is searching ("3 of 100 loaded · 172 in all"): the search works on the loaded rows, never on the whole set.
 */
export function countLabel(shown: number, total: number, searching: boolean, server?: ServerList): string {
  if (!server?.cut) return `${searching ? `${shown} of ${total}` : total} ${total === 1 ? 'exception' : 'exceptions'}`;
  if (searching) return `${formatCount(shown)} of ${formatCount(total)} loaded${server.total != null ? ` · ${formatCount(server.total)} in all` : ''}`;
  return server.total != null ? `${formatCount(total)} of ${formatCount(server.total)} exceptions` : `${formatCount(total)}+ exceptions`;
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "08 Nov 2026"; "—" for no date. The server's times have no zone and are UTC (parseUtc); a date set in a date field is the day it says. */
export function formatDate(dateStr: string | null | undefined): string {
  const at = parseUtc(dateStr);
  return at ? DATE.format(at) : '—';
}

// ─── What the server holds: the list is cut ──────────────────────────────────────────────────────────────────────────────

/**
 * The most rows the server sends when none are asked for: `limit: int = 100` in policy_exception_router.list_exceptions (read only). The page
 * asks for no limit and the answer is a bare array with no total, so a list this long may be cut. The truth about how many there are comes from
 * GET /policy-exceptions/analytics (ExceptionCounts), which the page already loads.
 */
export const SERVER_LIMIT = 100;

/** The filters that go to the server (the only two it takes); '' is no filter. */
export interface Filters { status: string; priority: string }

/** The counts of GET /policy-exceptions/analytics: they cover every exception of the organisation, whatever the list was cut to. */
export interface ExceptionCounts { total: number; by_status: Record<string, number>; by_priority: Record<string, number> }

/** `cut`: the server holds more than was loaded. `total`: how many it holds for the filters in use, null when that cannot be known. */
export interface ServerList { cut: boolean; total: number | null }

/**
 * Whether the loaded rows are all there is, and how many there are in all. Fewer rows than the server sends at most is the whole list (and the count
 * is then always current). A full page is read against the counts: every exception, those with the status, or those with the priority; both filters
 * at once cannot be read from them (null: "100 or more"), nor can anything before they have loaded.
 */
export function serverList(loaded: number, filters: Filters, counts?: ExceptionCounts | null, limit: number = SERVER_LIMIT): ServerList {
  if (loaded < limit) return { cut: false, total: loaded };
  let held: number | null = null;
  if (counts && !(filters.status && filters.priority)) {
    held = filters.status ? counts.by_status?.[filters.status] ?? 0 : filters.priority ? counts.by_priority?.[filters.priority] ?? 0 : counts.total;
  }
  if (held == null || !Number.isFinite(held)) return { cut: true, total: null };
  const total = Math.max(held, loaded);                          // counts that are behind what is already on screen are out of date
  return { cut: total > loaded, total };
}

/** The notice above a cut list: what is shown out of what there is, and what the search, the sort and the CSV work on. null when nothing is cut. */
export function cutNotice(loaded: number, server: ServerList, filters: Filters): { title: string; detail: string } | null {
  if (!server.cut) return null;
  const n = formatCount(loaded);
  return {
    title: server.total != null ? `Showing ${n} of ${formatCount(server.total)} exceptions` : `Showing the first ${n} exceptions, there may be more`,
    detail: `Search, sort and CSV use these ${n} only.${filters.status && filters.priority ? '' : ' Pick a status or priority to narrow the list.'}`,
  };
}

/** What the CSV toast says: how many rows went into the file, and, for a cut list, that they are the loaded ones. */
export function csvDone(exported: number, loaded: number, server: ServerList): string {
  const rows = `${formatCount(exported)} ${exported === 1 ? 'exception' : 'exceptions'}`;
  if (!server.cut) return `Exported ${rows}`;
  return `Exported ${rows} from the ${formatCount(loaded)} loaded (${server.total != null ? `${formatCount(server.total)} in all` : 'more on the server'})`;
}

/** What GET answered, as a list: an array, or an object that holds one under `items`, `exceptions`, `documents` or `data`; [] for anything else. */
export function itemsOf<T = unknown>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const p = payload as Record<string, unknown> | null | undefined;
  for (const key of ['items', 'exceptions', 'documents', 'data']) if (Array.isArray(p?.[key])) return p![key] as T[];
  return [];
}

/** The loaded rows in the order a header asks (the values and the order are DATA_COLS's and sortRows's), a new array; the kit's SortState in. */
export function sortLoaded<T extends ExceptionFields>(rows: T[], sort: SortState): T[] {
  const cols: DataCol<T>[] = (Object.keys(DATA_COLS) as (keyof typeof DATA_COLS)[]).map((id) => ({ id, ...DATA_COLS[id] }));
  return sortRows(rows, cols, sort && { id: sort.key, dir: sort.dir });
}

// ─── What a row offers ───────────────────────────────────────────────────────────────────────────────────────────────────

export type RowActionKey = 'view' | 'edit' | 'submit' | 'approve' | 'reject' | 'revoke' | 'delete';

/** What the server says the person may do with a row (`can_*`, it refuses the rest) and the row's status. */
export interface RowRights { status: string; can_edit?: boolean; can_delete?: boolean; can_decide?: boolean }

/**
 * The actions in a row's ⋯ menu, in order: its details for everybody; change it, or send a draft for approval, for whom the server lets; approve or reject
 * what is pending, and revoke what is approved, for someone who may decide it (never its requester); delete a draft for whom the server lets.
 */
export function rowActionKeys(e: RowRights): RowActionKey[] {
  const out: RowActionKey[] = ['view'];
  if (e.can_edit) out.push('edit');
  if (e.status === 'draft' && e.can_edit) out.push('submit');
  if (e.status === 'pending_approval' && e.can_decide) out.push('approve', 'reject');
  if (e.status === 'approved' && e.can_decide) out.push('revoke');
  if (e.can_delete) out.push('delete');
  return out;
}

// ─── The form ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ExceptionForm {
  title: string;
  document_id: string | number;
  justification: string;
  risk_assessment: string;
  compensating_controls: string;
  priority: string;
  /** "YYYY-MM-DD" (a date field's value) or '' */
  effective_date: string;
  expiry_date: string;
  asset_ids: number[];
}

export const emptyForm = (): ExceptionForm => ({
  title: '', document_id: '', justification: '', risk_assessment: '', compensating_controls: '', priority: 'medium', effective_date: '', expiry_date: '', asset_ids: [],
});

/** A date field's value from what the server stored ("2026-11-15T08:22:49"): the day as written, "YYYY-MM-DD"; '' for none. A date field shows nothing for a value with a time. */
export const toDateInput = (value: string | null | undefined): string => /^\d{4}-\d{2}-\d{2}/.exec(String(value ?? ''))?.[0] ?? '';

/** What Edit starts with: the exception's own values, its long texts as tidy numbered lines, its dates as the day they are. */
export function formFrom(e: {
  title: string; document_id: number | null; justification?: unknown; risk_assessment?: unknown; compensating_controls?: unknown;
  priority?: string; effective_date?: string | null; expiry_date?: string | null; linked_asset_ids?: number[];
}): ExceptionForm {
  return {
    title: e.title,
    document_id: e.document_id || '',
    justification: toEditableText(e.justification),
    risk_assessment: toEditableText(e.risk_assessment),
    compensating_controls: toEditableText(e.compensating_controls),
    priority: e.priority || 'medium',
    effective_date: toDateInput(e.effective_date),
    expiry_date: toDateInput(e.expiry_date),
    asset_ids: e.linked_asset_ids || [],
  };
}

/** What a new exception starts with when it is raised against a policy, or from a suggestion (its title, its reason as the justification, its priority). */
export function formForPolicy(documentId: number, opts?: { title?: string; justification?: string; priority?: string }): ExceptionForm {
  return { ...emptyForm(), title: opts?.title || '', document_id: documentId || '', justification: toEditableText(opts?.justification), priority: opts?.priority || 'medium' };
}

/** Whether two forms hold the same: what decides that closing the drawer has something to lose. The assets compare as a set. */
export function sameForm(a: ExceptionForm, b: ExceptionForm): boolean {
  const ids = (f: ExceptionForm) => [...f.asset_ids].sort((x, y) => x - y).join(',');
  return a.title === b.title && String(a.document_id) === String(b.document_id) && a.justification === b.justification && a.risk_assessment === b.risk_assessment
    && a.compensating_controls === b.compensating_controls && a.priority === b.priority && a.effective_date === b.effective_date && a.expiry_date === b.expiry_date
    && ids(a) === ids(b);
}

/** What is missing before it can be saved: the title and the justification (blank or only spaces is missing). Only the missing ones are keys. */
export function formErrors(form: ExceptionForm): { title?: string; justification?: string } {
  const out: { title?: string; justification?: string } = {};
  if (!form.title.trim()) out.title = 'Enter a title';
  if (!form.justification.trim()) out.justification = 'Enter a justification';
  return out;
}

/**
 * What is sent. A new exception sends a date only when one is set, the policy only when one is chosen, as it always did. An edit also sends a date that
 * was emptied as null (the server clears it): the form now shows the dates the exception has, so emptying one has to mean something.
 */
export function payloadOf(form: ExceptionForm, editing: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: form.title,
    justification: form.justification,
    risk_assessment: form.risk_assessment,
    compensating_controls: form.compensating_controls,
    priority: form.priority,
  };
  if (form.document_id) payload.document_id = Number(form.document_id);
  if (form.effective_date) payload.effective_date = form.effective_date;
  else if (editing) payload.effective_date = null;
  if (form.expiry_date) payload.expiry_date = form.expiry_date;
  else if (editing) payload.expiry_date = null;
  payload.asset_ids = form.asset_ids;
  return payload;
}

// ─── Dates ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An effective, expiry or review date: a DAY (the server stores it as midnight), said as written whatever zone the viewer is in; "Not set" when it has none. */
export const dayText = (value: string | null | undefined): string => formatDay(value, { calendar: true, empty: NOT_SET });

/** A moment (created, approved, commented): the viewer's own day, "12 Nov 2026"; "—" when it is not there (the system records it, nobody sets it). */
export const momentDay = (value: string | null | undefined): string => formatDay(value);

/** The same moment with its time, "12 Nov 2026, 14:05", on the viewer's clock. */
export const momentText = (value: string | null | undefined): string => formatMoment(value);

// ─── The charts ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Slice { key: string; label: string; value: number; tone: Tone }

/** The status mix from the analytics' counts: the registry's words in its order, then any other word the server sent; a status with none is left out. */
export function statusSlices(byStatus?: Record<string, number> | null): Slice[] {
  const counts = byStatus ?? {};
  const known = exceptionStatus.words.filter((w) => counts[w] > 0);
  const other = Object.keys(counts).filter((k) => counts[k] > 0 && !exceptionStatus.has(k)).sort();
  return [...known, ...other].map((key) => ({ key, label: exceptionStatus.label(key), value: counts[key], tone: exceptionStatus.tone(key) }));
}

const AGING: ReadonlyArray<readonly [string, string, Tone]> = [
  ['0_30', '0–30d', 'success'], ['31_60', '31–60d', 'progress'], ['61_90', '61–90d', 'warning'], ['90_plus', '90d+', 'warning'], ['overdue', 'Overdue', 'danger'],
];

/** The open exceptions by age, all five bars (an empty bucket is a bar of nothing, not a missing one). */
export function agingBars(buckets?: Record<string, number> | null): Slice[] {
  return AGING.map(([key, label, tone]) => ({ key, label, value: Number(buckets?.[key]) || 0, tone }));
}

/** A chart in words, for a screen reader and for anyone who cannot tell the colours apart: "Status: Draft 54, Approved 40". */
export const chartAlt = (title: string, items: ReadonlyArray<{ label: string; value: number }>): string =>
  `${title}: ${items.length ? items.map((i) => `${i.label} ${i.value}`).join(', ') : 'none'}`;

/** The tone of "closed on time": 80% and over is good, 50% and over needs a look, below that is poor; nothing measured is neutral (not green). */
export const closedOnTimeTone = (pct: number | null | undefined): Tone => (pct == null || !Number.isFinite(pct) ? 'neutral' : pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'danger');
