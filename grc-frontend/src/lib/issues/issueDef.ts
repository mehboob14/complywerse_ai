// The issue register's definition (facets, quick chips, sorts, board), apart from React (`issueDef.test.ts`). The rows are GET /issue-management/issues?lean=1 (read whole): no
// description, but the server's own is_open / overdue_days / actions_done / actions_open. The chips use the words.ts rules against ONE clock (the frame's `now`), so a row, a chip
// and the header's count can never disagree about what is open or late.
import { buildSchema, type RegisterDef } from '../../components/records/registerModel.ts';
import { parseUtc } from '../serverTime.ts';
import { issueCategory, issueSeverity, issueSource, issueState, issueType } from '../statuses/issues.ts';
import {
  ISSUE_CATEGORY_OPTIONS, ISSUE_SEVERITIES, ISSUE_STATES, ISSUE_TYPE_OPTIONS, daysLate, isAwaitingClosure, isIssueLate, isOpenIssue, isSerious, severityRank, sourceWord, stateOf,
} from './words.ts';

export interface PersonRef { id: number; display_name?: string | null; username?: string | null; email?: string | null }

export interface IssueRow {
  id: number;
  code?: string | null;
  title: string;
  description?: string | null;
  severity?: string | null;
  issue_type?: string | null;
  category?: string | null;
  status?: string | null;
  workflow_state?: string | null;
  owner?: PersonRef | null;
  reporter?: PersonRef | null;
  assignee?: PersonRef | null;
  source_type?: string | null;
  source_id?: number | null;
  detected_at?: string | null;
  due_date?: string | null;
  target_closure_date?: string | null;
  closed_at?: string | null;
  created_at?: string | null;
  sla_breached?: boolean;
  overdue_days?: number | null;
  is_open?: boolean;
  action_count?: number;
  actions_done?: number;
  actions_open?: number;
}

export const NONE = 'none';
export const personName = (p?: PersonRef | null): string | null => (p ? p.display_name || p.username || p.email || null : null);
/** The code an issue is known by; an issue the creators gave none is "ISS-" and its number (the people never see the bare id). */
export const codeOf = (i: IssueRow): string => i.code || `ISS-${i.id}`;
export const stateWord = (i: IssueRow): string => stateOf(i.workflow_state);
export const openOf = (i: IssueRow): boolean => isOpenIssue(i.workflow_state);
/** Whole days past the target date of an open issue (1 or more), else null. */
export const lateDays = (i: IssueRow, now: Date): number | null => (isIssueLate(i.workflow_state, i.target_closure_date, now) ? daysLate(i.target_closure_date, now) : null);
export const isLate = (i: IssueRow, now: Date): boolean => lateDays(i, now) !== null;
const ms = (iso?: string | null): number | null => parseUtc(iso)?.getTime() ?? null;

export interface IssueCounts { total: number; open: number; late: number; serious: number; awaiting: number }
/** The numbers of the head and the chips, from the rows themselves. */
export function issueCounts(rows: readonly IssueRow[], now: Date): IssueCounts {
  const open = rows.filter(openOf);
  return {
    total: rows.length,
    open: open.length,
    late: rows.filter((i) => isLate(i, now)).length,
    serious: open.filter((i) => isSerious(i.severity)).length,
    awaiting: open.filter((i) => isAwaitingClosure(i.workflow_state)).length,
  };
}

type Option = { value: string; label: string };
/** The registry's words in their order, then any other value the rows hold (so a filter can always reach a record), then "none" when a record has no value. */
function optionsFor(registered: readonly Option[], seen: Array<string | null | undefined>, labelOf: (v: string) => string, noneLabel: string): Option[] {
  const known = new Set(registered.map((o) => o.value));
  const extra = Array.from(new Set(seen.filter((v): v is string => !!v && !known.has(v)))).sort().map((value) => ({ value, label: labelOf(value) }));
  const out = registered.concat(extra);
  return seen.some((v) => !v) ? out.concat({ value: NONE, label: noneLabel }) : out;
}

function peopleOptions(rows: readonly IssueRow[], of: (i: IssueRow) => PersonRef | null | undefined, noneLabel: string): Option[] {
  const seen = new Map<string, string>();
  rows.forEach((i) => { const p = of(i); if (p) seen.set(String(p.id), personName(p) || `User ${p.id}`); });
  const list = Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  return rows.some((i) => !of(i)) ? list.concat({ value: NONE, label: noneLabel }) : list;
}

export function issueDef(me: number | null): RegisterDef<IssueRow> {
  return {
    key: 'issue',
    noun: { one: 'issue', other: 'issues' },
    idOf: (i) => i.id,
    text: (i) => [codeOf(i), i.title, personName(i.assignee), personName(i.owner), sourceWord(i.source_type), issueType.label(i.issue_type), issueCategory.label(i.category)].filter(Boolean).join(' '),
    facets: [
      { key: 'state', label: 'State', defaultOpen: true, values: (i) => [stateWord(i)], options: () => ISSUE_STATES.map((value) => ({ value, label: issueState.label(value) })) },
      {
        key: 'severity', label: 'Severity', defaultOpen: true,
        values: (i) => [i.severity ? i.severity.toLowerCase() : NONE],
        options: (rows) => optionsFor(ISSUE_SEVERITIES.map((value) => ({ value, label: issueSeverity.label(value) })), rows.map((i) => i.severity && i.severity.toLowerCase()), (v) => issueSeverity.label(v), 'No severity'),
      },
      {
        key: 'type', label: 'Type', values: (i) => [i.issue_type || NONE],
        options: (rows) => optionsFor(ISSUE_TYPE_OPTIONS, rows.map((i) => i.issue_type), (v) => issueType.label(v), 'No type'),
      },
      {
        key: 'category', label: 'Category', values: (i) => [i.category || NONE],
        options: (rows) => optionsFor(ISSUE_CATEGORY_OPTIONS, rows.map((i) => i.category), (v) => issueCategory.label(v), 'No category'),
      },
      {
        key: 'source', label: 'Raised from', searchable: true, limit: 7, values: (i) => [i.source_type || 'manual'],
        options: (rows) => Array.from(new Set(rows.map((i) => i.source_type || 'manual'))).map((value) => ({ value, label: issueSource.label(value) })).sort((a, b) => a.label.localeCompare(b.label)),
      },
      { key: 'assignee', label: 'Assigned to', searchable: true, limit: 7, values: (i) => [i.assignee ? String(i.assignee.id) : NONE], options: (rows) => peopleOptions(rows, (i) => i.assignee, 'Unassigned') },
      { key: 'owner', label: 'Owner', searchable: true, limit: 7, values: (i) => [i.owner ? String(i.owner.id) : NONE], options: (rows) => peopleOptions(rows, (i) => i.owner, 'No owner') },
    ],
    quick: [
      { key: 'open', label: 'Open', test: (i) => openOf(i), title: 'New, triage, in progress, resolution or closure review: not yet closed or cancelled' },
      ...(me != null ? [{ key: 'mine', label: 'Mine', test: (i: IssueRow) => openOf(i) && i.assignee?.id === me, title: 'Open and assigned to you' }] : []),
      { key: 'late', label: 'Late', test: (i, now) => isLate(i, now), title: 'The target date has passed and the issue is still open' },
      { key: 'serious', label: 'Critical or high', test: (i) => openOf(i) && isSerious(i.severity), title: 'Open issues of critical or high severity: the ones the scorecard counts' },
      { key: 'closing', label: 'Awaiting closure', test: (i) => isAwaitingClosure(i.workflow_state), title: 'In closure review: waiting for someone to approve it' },
      { key: 'unassigned', label: 'Unassigned', test: (i) => openOf(i) && !i.assignee, title: 'Open and nobody is assigned' },
      { key: 'contract', label: 'Contract', test: (i) => i.category === 'contract', title: 'Contract compliance issues' },
    ],
    sorts: [
      // open issues first, the most overdue (the soonest target) on top, issues with no target date after the dated ones; closed and cancelled last
      { key: 'attention', label: 'Needs attention first', firstDir: 'asc', value: (i) => (openOf(i) ? ms(i.target_closure_date) ?? 8e15 : 9e15) },
      { key: 'created', label: 'Raised', firstDir: 'desc', value: (i) => ms(i.created_at) },
      { key: 'severity', label: 'Severity (worst first)', firstDir: 'asc', value: (i) => severityRank(i.severity) },
      { key: 'state', label: 'State', firstDir: 'asc', value: (i) => (ISSUE_STATES as readonly string[]).indexOf(stateWord(i)) },
      { key: 'due', label: 'Target date', firstDir: 'asc', value: (i) => ms(i.target_closure_date) },
      { key: 'title', label: 'Title', firstDir: 'asc', value: (i) => i.title },
      { key: 'code', label: 'Code', firstDir: 'asc', value: (i) => codeOf(i) },
      { key: 'assignee', label: 'Assigned to', firstDir: 'asc', value: (i) => personName(i.assignee) },
      { key: 'actions', label: 'Open actions', firstDir: 'desc', value: (i) => i.actions_open ?? 0 },
    ],
    defaultSort: { key: 'attention', dir: 'asc' },
    board: {
      label: 'Issues by state',
      columns: [
        ...ISSUE_STATES.slice(0, 5).map((id) => ({ id, label: issueState.label(id), test: (i: IssueRow) => stateWord(i) === id })),
        { id: 'closed', label: 'Closed or cancelled', test: (i: IssueRow) => !openOf(i) },
      ],
    },
    pageSize: 25,
  };
}

export const ISSUE_SCHEMA = buildSchema(issueDef(0));   // with a person, so every chip key is one the address may name
