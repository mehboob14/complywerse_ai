// What the Controls explorer decides, apart from React so `node --test` pins it (controlsModel.test.ts): the row (one control of GET /automation/common/controls), the quick views and
// the number each shows, the sort, the board's columns, the search text, and the export. Nothing here makes a number up: every count is over the rows the server sent, the quick views
// are the same definitions the Overview's counters use (a failing control is `overall_status === 'failed'`; a test is overdue when the work item's `next_test_date` has passed), and
// a status word is the server's (lib/statuses/controls.ts).
import { parseUtc } from '../../../../../lib/serverTime.ts';
import { CONTROL_STATUS_ORDER, controlStatus } from '../../../../../lib/statuses/controls.ts';

/** One control as GET /automation/common/controls gives it (the fields the explorer reads). */
export interface ControlRow {
  control_id: string;
  title: string;
  category: string;
  domain?: string | null;
  sub_type?: string | null;
  requirements?: Record<string, ReadonlyArray<{ code: string }>> | null;
  requirement_count?: number;
  checks_count: number;
  overall_status: string;
  owner_user_id?: number | null;
  owner_name?: string | null;
  assigned_user_ids?: readonly number[] | null;
  ownership_status?: string | null;
  next_test_date?: string | null;
  next_due_at?: string | null;
  custom?: boolean;
  importance?: string | null;
}

/** A control with its place in the load: the explorer's numeric row id (the kit's rows are numbered, a control's own key is its code). */
export type Row = ControlRow & { i: number };

export const withIds = (controls: readonly ControlRow[]): Row[] => controls.map((c, i) => ({ ...c, i }));

/** The frameworks a control discharges requirements of (those with at least one requirement code). */
export function frameworksOf(row: ControlRow): string[] {
  const req = row.requirements ?? {};
  return Object.keys(req).filter((k) => (req[k] ?? []).length > 0);
}

export const NO_VALUE = '_none';
export const LATE_OWNER = 'late';

// ── the quick views ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const QUICK_IDS = ['all', 'failing', 'mine', 'unowned', 'overdue', 'automated'] as const;
export type QuickId = (typeof QUICK_IDS)[number];
export const QUICK_LABEL: Record<QuickId, string> = {
  all: 'All', failing: 'Failing', mine: 'Mine', unowned: 'Needs an owner', overdue: 'Tests overdue', automated: 'Automated',
};
export const QUICK_HINT: Record<QuickId, string> = {
  all: 'Every control in the list',
  failing: 'Controls whose automated checks are failing',
  mine: 'Controls you own or are assigned to',
  unowned: 'Controls nobody owns yet',
  overdue: 'Controls whose next test date has passed',
  automated: 'Controls an automated check can assert',
};

export interface Ctx { me: number | null; now: Date }

export const isMine = (r: ControlRow, me: number | null): boolean =>
  me != null && (r.owner_user_id === me || (r.assigned_user_ids ?? []).includes(me));

export function testOverdue(r: ControlRow, now: Date): boolean {
  const due = parseUtc(r.next_test_date);
  return due != null && due.getTime() < now.getTime();
}

export function inQuick(id: QuickId, r: ControlRow, ctx: Ctx): boolean {
  switch (id) {
    case 'failing': return r.overall_status === 'failed';
    case 'mine': return isMine(r, ctx.me);
    case 'unowned': return r.ownership_status === 'unowned';
    case 'overdue': return testOverdue(r, ctx.now);
    case 'automated': return r.sub_type === 'Automated';
    default: return true;
  }
}

export function quickCounts(rows: readonly ControlRow[], ctx: Ctx): Record<QuickId, number> {
  const out = { all: rows.length, failing: 0, mine: 0, unowned: 0, overdue: 0, automated: 0 } as Record<QuickId, number>;
  rows.forEach((r) => QUICK_IDS.forEach((id) => { if (id !== 'all' && inQuick(id, r, ctx)) out[id] += 1; }));
  return out;
}

// ── the board ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const BOARD_COLUMNS = [
  { id: 'failing', label: 'Failing', words: ['failed'] },
  { id: 'attention', label: 'Needs a look', words: ['expired', 'collection_failed', 'error', 'partial'] },
  { id: 'passing', label: 'Passing', words: ['passed'] },
  { id: 'waiting', label: 'Not tested yet', words: ['running', 'not_run', 'connect_one', 'unbound'] },
  { id: 'manual', label: 'Manual', words: ['manual'] },
] as const;
export type BoardId = (typeof BOARD_COLUMNS)[number]['id'];

/** The board column of a status word; a word nobody registered waits with the controls not tested yet. */
export const columnOf = (status: string): BoardId => (BOARD_COLUMNS.find((c) => (c.words as readonly string[]).includes(status))?.id ?? 'waiting');

/** The status words a board column holds (what "Show all N" filters the list by). */
export const wordsOf = (id: string): string[] => [...(BOARD_COLUMNS.find((c) => c.id === id)?.words ?? [])];

// ── sort ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SORT_KEYS = ['code', 'title', 'status', 'owner', 'next'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';
export interface Sort { key: SortKey; dir: SortDir }
export const DEFAULT_SORT: Sort = { key: 'code', dir: 'asc' };
export const SORT_LABEL: Record<SortKey, string> = { code: 'Code', title: 'Name', status: 'Status', owner: 'Owner', next: 'Next test' };
export const FIRST_DIR: Record<SortKey, SortDir> = { code: 'asc', title: 'asc', status: 'asc', owner: 'asc', next: 'asc' };

export function nextSort(cur: Sort, key: SortKey): Sort {
  if (cur.key !== key) return { key, dir: FIRST_DIR[key] };
  return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
}

const fold = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const natural = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const rank = (status: string): number => {
  const i = (CONTROL_STATUS_ORDER as readonly string[]).indexOf(status);
  return i < 0 ? CONTROL_STATUS_ORDER.length : i;
};

/** A sorted copy. An empty value sorts last in either direction; equal values keep the order of the load (the code), so a page never reshuffles on a re-render. */
export function sortControls(rows: readonly Row[], sort: Sort): Row[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const empty = (r: Row): boolean => (sort.key === 'owner' ? !r.owner_name : sort.key === 'next' ? !r.next_test_date : false);
  const value = (a: Row, b: Row): number => {
    switch (sort.key) {
      case 'code': return natural(a.control_id, b.control_id);
      case 'title': return natural(a.title, b.title);
      case 'status': return rank(a.overall_status) - rank(b.overall_status);
      case 'owner': return natural(a.owner_name ?? '', b.owner_name ?? '');
      case 'next': return (parseUtc(a.next_test_date)?.getTime() ?? 0) - (parseUtc(b.next_test_date)?.getTime() ?? 0);
      default: return 0;
    }
  };
  return rows.slice().sort((a, b) => {
    const ea = empty(a); const eb = empty(b);
    if (ea !== eb) return ea ? 1 : -1;
    const v = value(a, b) * sign;
    return v !== 0 ? v : natural(a.control_id, b.control_id) || a.i - b.i;
  });
}

// ── search ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a search reads: the code, the name, the domain, the owner and every requirement code of every framework (so "A.8.2" finds the controls that discharge it). */
export function haystack(r: ControlRow): string {
  const codes = Object.values(r.requirements ?? {}).flatMap((items) => items.map((x) => x.code));
  return fold([r.control_id, r.title, r.category, r.owner_name, ...codes].filter(Boolean).join(' '));
}
export const searchTerms = (q: string): string[] => fold(q.trim()).split(/\s+/).filter(Boolean);

// ── what a row says ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The word for a control's status; "Not run" for an empty one, as the server's own default reads. */
export const statusWord = (r: ControlRow): string => controlStatus.label(r.overall_status || 'not_run');

/** One line under a row's name: the domain and, when the control is the organisation's own, that. */
export function subline(r: ControlRow): string {
  return [r.category, r.custom ? 'Custom control' : ''].filter(Boolean).join(' · ');
}

// ── export ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A cell that a spreadsheet could take for a formula gets an apostrophe in front (=, +, -, @ and the control characters that hide them). */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const EXPORT_HEADERS = ['Code', 'Name', 'Domain', 'Type', 'Status', 'Owner', 'Frameworks', 'Checks', 'Next test', 'Origin'] as const;

export function toCsv(rows: readonly ControlRow[], names: { framework: (key: string) => string }): string {
  const lines = rows.map((r) => [
    r.control_id, r.title, r.category, r.sub_type ?? '', statusWord(r), r.owner_name ?? '', frameworksOf(r).map(names.framework).join('; '), r.checks_count, r.next_test_date ?? '', r.custom ? 'Custom' : 'SCF',
  ].map(csvCell).join(','));
  return [EXPORT_HEADERS.join(','), ...lines].join('\r\n');
}

export const exportName = (date: string, count: number, selection: boolean): string => `controls-${date}-${selection ? 'selection-' : ''}${count}.csv`;
