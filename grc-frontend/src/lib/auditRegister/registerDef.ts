// The Issue Register's definition (facets, quick chips, sorts, board) apart from React (`registerDef.test.ts`). The rows are GET /issue-management/issues/audit-register/rows, read whole
// (the server caps it at 5,000 and says the real total in the X-Total-Count header). The status, the aging and the days past due are the SERVER's (summary.effective_status: the client's own
// definition, never recomputed here); the chips and the header count use ONE pass over the rows (`registerCounts`), so a chip, the head and the table can never disagree.
import { buildSchema, type RegisterDef } from '../../components/records/registerModel.ts';
import { oneOf } from '../addressState.ts';
import { truncate } from '../format.ts';
import { STATUS_ORDER, findingSource, findingStatus, riskRating } from '../statuses/auditRegister.ts';

/** One finding as the register lists it. The first block is what the server always sent; the second are the fields this pass added (older servers leave them out: false/null). */
export interface RegisterRow {
  issue_id: number;
  code: string | null;
  source: string;
  record_type: string;
  regulator: string | null;
  report: string | null;
  report_key: string | null;
  report_prefill: Record<string, unknown>;
  added_in_platform: boolean;
  reference: string | null;
  title: string | null;
  risk_rating: string | null;
  lob: string | null;
  owner: string | null;
  owner_id: number | null;
  owner_name: string | null;
  affected_hosts: string | null;
  edited: boolean;
  target_date: string | null;
  revised_target_date: string | null;
  ia_status: string | null;
  remediation_status: string | null;
  validation_status: string | null;
  validation_pass_fail: string | null;
  aged_status: string | null;
  days_past_due: number | null;
  status: string;
  workflow_state: string | null;
  deleted?: boolean;
  deleted_at?: string | null;
  /** the signed-in person owns it */
  mine?: boolean;
  /** submitted by the owner and waiting for Audit Services */
  awaiting_validation?: boolean;
  /** the day it was submitted (or the register first had it): how long it has waited */
  waiting_since?: string | null;
  /** an extension request is waiting for the Audit Committee */
  extension_requested?: boolean;
}

export const NONE = 'none';
export const UNMATCHED = 'unmatched';

export const isOpen = (r: RegisterRow): boolean => r.status !== 'CD';
export const isPastDue = (r: RegisterRow): boolean => r.status === 'PD';
export const isAwaiting = (r: RegisterRow): boolean => r.awaiting_validation === true && isOpen(r);
export const isMine = (r: RegisterRow): boolean => r.mine === true && isOpen(r);
export const hasOwnerToMap = (r: RegisterRow): boolean => !!(r.owner && r.owner.trim()) && !r.owner_id;
/** The date the finding is held to: the revised one when an extension moved it. */
export const dueOf = (r: RegisterRow): string | null => r.revised_target_date || r.target_date || null;
export const ownerName = (r: RegisterRow): string | null => r.owner_name || (r.owner && r.owner.trim()) || null;
/** The report as a person reads it: "OCC · Report of Examination". */
export const reportLabel = (r: RegisterRow): string | null => {
  const text = [r.regulator, r.report].filter((x) => x && x.trim()).join(' · ');
  return text || null;
};
/** The sheet a new finding is added on, from the source it came from (the client's own entry templates). */
export const ENTRY_TEMPLATE_OF: Record<string, string> = {
  regulator: 'regulatory', mercadien: 'ia_mercadien', ey: 'ia_ey_issue', it_pen: 'it_pen', self_id: 'self_id', credit_review: 'credit_review',
};
export const sourceWord = (source: string | null | undefined): string => findingSource.label(source || 'unassigned');
export const statusWord = (r: RegisterRow): string => findingStatus.label(r.status);
/** The finding's number as the client writes it, else its platform code. */
export const referenceOf = (r: RegisterRow): string | null => r.reference || r.code || null;

/** A calendar day ("2026-03-31") as milliseconds, null when it is not one. */
export function dayMs(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
/** Whole calendar days from `iso` to `today` (a Date: the viewer's own day), null when `iso` is not a day. */
export function daysSince(iso: string | null | undefined, today: Date): number | null {
  const then = dayMs(iso);
  if (then === null) return null;
  return Math.max(0, Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - then) / 86400000));
}

export interface RegisterCounts { total: number; open: number; pastDue: number; awaiting: number; extension: number; mine: number }
/** The numbers of the head and the chips, from the rows themselves. */
export function registerCounts(rows: readonly RegisterRow[]): RegisterCounts {
  const open = rows.filter(isOpen);
  return {
    total: rows.length,
    open: open.length,
    pastDue: rows.filter(isPastDue).length,
    awaiting: rows.filter(isAwaiting).length,
    extension: rows.filter((r) => r.extension_requested === true && isOpen(r)).length,
    mine: rows.filter(isMine).length,
  };
}

type Option = { value: string; label: string };

function distinct(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== ''))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
}

const RISK_ORDER = ['critical', 'high', 'moderate', 'medium', 'low'];
const riskKey = (r: RegisterRow): string => (r.risk_rating || '').trim().toLowerCase();
const riskRank = (r: RegisterRow): number => { const i = RISK_ORDER.indexOf(riskKey(r)); return i < 0 ? 9 : i; };

/** The report a finding belongs to, as a facet value: the server's report key, else its text. */
const reportValue = (r: RegisterRow): string => r.report_key || reportLabel(r) || NONE;

export function registerDef(): RegisterDef<RegisterRow> {
  return {
    key: 'audit-register',
    noun: { one: 'finding', other: 'findings' },
    idOf: (r) => r.issue_id,
    text: (r) => [referenceOf(r), r.code, r.title, ownerName(r), r.owner, reportLabel(r), r.lob, sourceWord(r.source), r.risk_rating].filter(Boolean).join(' '),
    facets: [
      { key: 'source', label: 'Source', defaultOpen: true, values: (r) => [r.source || 'unassigned'], options: (rows) => {
        const seen = new Set(rows.map((r) => r.source || 'unassigned'));
        return findingSource.words.filter((w) => seen.has(w)).concat(Array.from(seen).filter((w) => !findingSource.has(w)).sort()).map((value) => ({ value, label: findingSource.label(value) }));
      } },
      { key: 'status', label: 'Status', defaultOpen: true, values: (r) => [r.status || 'unstated'], options: (rows) => {
        const seen = new Set(rows.map((r) => r.status || 'unstated'));
        const known: string[] = STATUS_ORDER.filter((s) => seen.has(s));
        return known.concat(Array.from(seen).filter((s) => !known.includes(s)).sort()).map((value) => ({ value, label: findingStatus.label(value) }));
      } },
      { key: 'risk', label: 'Risk', values: (r) => [riskKey(r) || NONE], options: (rows) => {
        const seen = distinct(rows.map(riskKey));
        const ordered = seen.sort((a, b) => (RISK_ORDER.indexOf(a) < 0 ? 9 : RISK_ORDER.indexOf(a)) - (RISK_ORDER.indexOf(b) < 0 ? 9 : RISK_ORDER.indexOf(b)));
        const list: Option[] = ordered.map((value) => ({ value, label: riskRating.label(value) }));
        return rows.some((r) => !riskKey(r)) ? list.concat({ value: NONE, label: 'No rating' }) : list;
      } },
      { key: 'report', label: 'Report', searchable: true, limit: 7, values: (r) => [reportValue(r)], options: (rows) => {
        const seen = new Map<string, string>();
        rows.forEach((r) => { const v = reportValue(r); if (v !== NONE && !seen.has(v)) seen.set(v, truncate(reportLabel(r) || v, 70).text); });
        const list = Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1], 'en', { numeric: true })).map(([value, label]): Option => ({ value, label }));
        return rows.some((r) => reportValue(r) === NONE) ? list.concat({ value: NONE, label: 'No report' }) : list;
      } },
      { key: 'lob', label: 'Line of business', searchable: true, limit: 7, values: (r) => [r.lob && r.lob.trim() ? r.lob.trim() : NONE], options: (rows) => {
        const list = distinct(rows.map((r) => r.lob && r.lob.trim())).map((value): Option => ({ value, label: value }));
        return rows.some((r) => !(r.lob && r.lob.trim())) ? list.concat({ value: NONE, label: 'No line of business' }) : list;
      } },
      { key: 'owner', label: 'Owner', searchable: true, limit: 7, values: (r) => [r.owner_id ? String(r.owner_id) : hasOwnerToMap(r) ? UNMATCHED : NONE], options: (rows) => {
        const people = new Map<string, string>();
        rows.forEach((r) => { if (r.owner_id) people.set(String(r.owner_id), r.owner_name || `Person ${r.owner_id}`); });
        const list = Array.from(people.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]): Option => ({ value, label }));
        if (rows.some(hasOwnerToMap)) list.push({ value: UNMATCHED, label: 'Not matched to a person' });
        if (rows.some((r) => !r.owner_id && !hasOwnerToMap(r))) list.push({ value: NONE, label: 'No owner' });
        return list;
      } },
    ],
    quick: [
      { key: 'mine', label: 'Mine', test: (r) => isMine(r), title: 'Open findings you own' },
      { key: 'awaiting', label: 'Awaiting validation', test: (r) => isAwaiting(r), title: 'Submitted by the owner and waiting for Audit Services to validate' },
      { key: 'pastdue', label: 'Past due', test: (r) => isPastDue(r), title: 'Open after the agreed (or revised) target date, by the client\'s definition' },
      { key: 'extension', label: 'Extension asked', test: (r) => r.extension_requested === true && isOpen(r), title: 'An extension request waits for the Audit Committee' },
      { key: 'open', label: 'Open', test: (r) => isOpen(r), title: 'Everything that is not closed' },
    ],
    sorts: [
      // open findings first: the longest past due on top, then the soonest target; closed ones last
      { key: 'attention', label: 'Needs attention first', firstDir: 'asc', value: attentionValue },
      { key: 'ref', label: 'Issue #', firstDir: 'asc', value: (r) => referenceOf(r) },
      { key: 'due', label: 'Target date', firstDir: 'asc', value: (r) => dayMs(dueOf(r)) },
      { key: 'risk', label: 'Risk (worst first)', firstDir: 'asc', value: (r) => riskRank(r) },
      { key: 'status', label: 'Status', firstDir: 'asc', value: (r) => { const i = (STATUS_ORDER as readonly string[]).indexOf(r.status); return i < 0 ? 99 : i; } },
      { key: 'owner', label: 'Owner', firstDir: 'asc', value: (r) => ownerName(r) },
      { key: 'source', label: 'Source', firstDir: 'asc', value: (r) => sourceWord(r.source) },
      { key: 'title', label: 'Title', firstDir: 'asc', value: (r) => r.title },
    ],
    defaultSort: { key: 'attention', dir: 'asc' },
    board: {
      label: 'Findings by status',
      columns: STATUS_ORDER.map((id) => ({ id, label: findingStatus.label(id), test: (r: RegisterRow) => (r.status || 'unstated') === id })),
    },
    pageSize: 25,
  };
}

/** Open and past due (longest first) before open and not yet due (soonest target first) before closed. */
export function attentionValue(r: RegisterRow): number {
  if (!isOpen(r)) return 3e13;
  const late = r.days_past_due && r.days_past_due > 0 ? r.days_past_due : 0;
  if (late > 0) return 1e13 - late;
  return 2e13 + (dayMs(dueOf(r)) ?? 9e12);
}

/** The address a person who owns findings opens on: "Mine". Everyone else opens on all of them. */
export const REGISTER_SCHEMA = buildSchema(registerDef());
export const OWNER_SCHEMA = { ...REGISTER_SCHEMA, quick: oneOf(['all'].concat(registerDef().quick.map((c) => c.key)), 'mine') };
