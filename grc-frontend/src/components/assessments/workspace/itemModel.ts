// The controls of one assessment as the workspace works with them: one shape for every type, the editing draft, the patch the server is sent, the filters, the order,
// the groups, and the due date and gap rules of the server (backend `modules/assessments/scoring.py`: `_target_date`, and the checklist/ASVS `gaps`).
// Pure (`node --test itemModel.test.ts`); relative imports with the .ts extension.
import { norm } from '../../../lib/status.ts';
import { CONTROL_STATUS_ORDER } from '../../../lib/statuses/assessments.ts';

export interface Assignee { type: 'user' | 'team'; id: number; name: string }

/** A control as `GET /compliance/assessments/<id>` sends it (`items`). Only what the workspace reads. */
export interface RawItem {
  id: number;
  item_number?: string | null;
  area_domain?: string | null;
  control_description?: string | null;
  compliance_status?: string | null;
  maturity_score?: number | null;
  risk_rating?: string | null;
  gaps_identified?: string | null;
  proposed_solution?: string | null;
  responsible_party?: string | null;
  timeline?: string | null;
  priority?: string | null;
  evidence_reference?: string | null;
  remarks?: string | null;
  remediation_status?: string | null;
  target_date?: string | null;
  closed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  evidence_count?: number | null;
  assignees?: Assignee[] | null;
  ai_evidence_recommendation?: string | null;
}

export type ControlStatus = (typeof CONTROL_STATUS_ORDER)[number];
export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type Remediation = 'open' | 'in_progress' | 'closed';

export const PRIORITIES: readonly Priority[] = ['critical', 'high', 'medium', 'low'];
export const REMEDIATIONS: readonly Remediation[] = ['open', 'in_progress', 'closed'];
export const PRIORITY_LABEL: Record<Priority, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
export const UNCATEGORIZED = 'Uncategorized';

export interface WorkItem {
  id: number;
  number: string;
  domain: string;
  description: string;
  status: ControlStatus;
  /** '' when none is recorded */
  priority: Priority | '';
  remediation: Remediation | '';
  gap: string;
  fix: string;
  /** the workbook's free-text "responsible" cell */
  responsible: string;
  /** the workbook's own due-date text ("Q3-2025", "2022"): shown, never edited as a date */
  timeline: string;
  evidenceReference: string;
  remarks: string;
  riskRating: string;
  maturity: number | null;
  targetDate: string | null;
  closedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  evidenceCount: number;
  assignees: Assignee[];
}

const isStatus = (s: string): s is ControlStatus => (CONTROL_STATUS_ORDER as readonly string[]).includes(s);
const isPriority = (s: string): s is Priority => (PRIORITIES as readonly string[]).includes(s);
const isRemediation = (s: string): s is Remediation => (REMEDIATIONS as readonly string[]).includes(s);

/** A control from the server: statuses read in any case or spacing ("Partially Complied", "In Progress"), an answer nobody gave is "not answered", an empty domain is Uncategorized. */
export function normaliseItem(raw: RawItem): WorkItem {
  const status = norm(raw.compliance_status);
  const priority = norm(raw.priority);
  const remediation = norm(raw.remediation_status);
  return {
    id: raw.id,
    number: (raw.item_number ?? '').trim(),
    domain: (raw.area_domain ?? '').trim() || UNCATEGORIZED,
    description: (raw.control_description ?? '').trim(),
    status: isStatus(status) ? status : 'in_progress',
    priority: isPriority(priority) ? priority : '',
    remediation: isRemediation(remediation) ? remediation : '',
    gap: raw.gaps_identified ?? '',
    fix: raw.proposed_solution ?? '',
    responsible: (raw.responsible_party ?? '').trim(),
    timeline: (raw.timeline ?? '').trim(),
    evidenceReference: raw.evidence_reference ?? '',
    remarks: raw.remarks ?? '',
    riskRating: (raw.risk_rating ?? '').trim(),
    maturity: typeof raw.maturity_score === 'number' ? raw.maturity_score : null,
    targetDate: raw.target_date ?? null,
    closedAt: raw.closed_at ?? null,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
    evidenceCount: raw.evidence_count ?? 0,
    assignees: raw.assignees ?? [],
  };
}

// ── the server's rules for a gap and its due date ────────────────────────────────
export interface SlaDays { critical_days: number; high_days: number; medium_days: number; low_days: number; due_soon_days: number }
export const DEFAULT_SLA_DAYS: SlaDays = { critical_days: 30, high_days: 60, medium_days: 90, low_days: 180, due_soon_days: 30 };
const DAY = 86_400_000;

const ms = (s: string | null): number | null => {
  if (!s) return null;
  const text = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : /(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`;     // the server's times are naive UTC
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : t;
};

/** A gap, as the checklist and ASVS scorers count it: someone recorded remediation on it, or it is not complied. */
export function isGap(item: WorkItem): boolean {
  return item.remediation !== '' || item.status === 'not_complied';
}
export const isOpenGap = (item: WorkItem): boolean => isGap(item) && !item.closedAt;

/** When the control is due, in epoch milliseconds: its own target date, else the day it was raised plus the days of its priority (medium when none). The server's `_target_date`. */
export function dueMs(item: WorkItem, days: SlaDays = DEFAULT_SLA_DAYS): number | null {
  const own = ms(item.targetDate);
  if (own !== null) return own;
  const raised = ms(item.createdAt);
  if (raised === null) return null;
  const by: Record<string, number> = { critical: days.critical_days, high: days.high_days, medium: days.medium_days, low: days.low_days };
  return raised + (by[item.priority] ?? days.medium_days) * DAY;
}

// ── editing ─────────────────────────────────────────────────────────────────────
/** What the drawer edits: text for every field ('' = empty). `targetDate` is a calendar day "2026-12-31". */
export interface ItemDraft {
  status: ControlStatus;
  priority: Priority | '';
  remediation: Remediation | '';
  domain: string;
  description: string;
  gap: string;
  fix: string;
  targetDate: string;
  responsible: string;
  timeline: string;
  evidenceReference: string;
  riskRating: string;
  remarks: string;
  maturity: string;
}

export function draftOf(item: WorkItem): ItemDraft {
  return {
    status: item.status, priority: item.priority, remediation: item.remediation,
    domain: item.domain === UNCATEGORIZED ? '' : item.domain,
    description: item.description, gap: item.gap, fix: item.fix,
    targetDate: item.targetDate ? item.targetDate.slice(0, 10) : '',
    responsible: item.responsible, timeline: item.timeline, evidenceReference: item.evidenceReference,
    riskRating: item.riskRating, remarks: item.remarks, maturity: item.maturity === null ? '' : String(item.maturity),
  };
}

/** The JSON body of `PUT /compliance/assessments/items/<id>`: only the fields that changed. An empty string clears a text field; `target_date` and `remediation_status` accept null. */
export interface ItemPatch {
  compliance_status?: string;
  priority?: string;
  remediation_status?: string | null;
  area_domain?: string;
  control_description?: string;
  gaps_identified?: string;
  proposed_solution?: string;
  target_date?: string | null;
  responsible_party?: string;
  timeline?: string;
  evidence_reference?: string;
  risk_rating?: string;
  remarks?: string;
  maturity_score?: number | null;
}

/** The patch from the item as it was to the draft as it is. `remarks` is never sent for a format that keeps structured data there. */
export function patchOf(item: WorkItem, draft: ItemDraft, { structuredRemarks = false }: { structuredRemarks?: boolean } = {}): ItemPatch {
  const was = draftOf(item);
  const out: ItemPatch = {};
  const same = (a: string, b: string): boolean => a.trim() === b.trim();
  if (draft.status !== was.status) out.compliance_status = draft.status;
  if (draft.priority !== was.priority) out.priority = draft.priority;
  if (draft.remediation !== was.remediation) out.remediation_status = draft.remediation === '' ? null : draft.remediation;
  if (!same(draft.domain, was.domain)) out.area_domain = draft.domain.trim() || UNCATEGORIZED;
  if (!same(draft.description, was.description)) out.control_description = draft.description.trim();
  if (!same(draft.gap, was.gap)) out.gaps_identified = draft.gap.trim();
  if (!same(draft.fix, was.fix)) out.proposed_solution = draft.fix.trim();
  if (draft.targetDate !== was.targetDate) out.target_date = draft.targetDate === '' ? null : draft.targetDate;
  if (!same(draft.responsible, was.responsible)) out.responsible_party = draft.responsible.trim();
  if (!same(draft.timeline, was.timeline)) out.timeline = draft.timeline.trim();
  if (!same(draft.evidenceReference, was.evidenceReference)) out.evidence_reference = draft.evidenceReference.trim();
  if (!same(draft.riskRating, was.riskRating)) out.risk_rating = draft.riskRating.trim();
  if (!structuredRemarks && !same(draft.remarks, was.remarks)) out.remarks = draft.remarks.trim();
  if (draft.maturity !== was.maturity) out.maturity_score = draft.maturity === '' ? null : Number(draft.maturity);
  return out;
}

export const hasChanges = (patch: ItemPatch): boolean => Object.keys(patch).length > 0;

/** What stops a save: the control needs its words. */
export function draftProblem(draft: ItemDraft): string {
  if (!draft.description.trim()) return 'The control needs a description.';
  if (draft.maturity !== '' && !/^[0-5]$/.test(draft.maturity)) return 'Maturity is a number from 0 to 5.';
  return '';
}

// ── filters, order, groups ──────────────────────────────────────────────────────
export type EvidenceFilter = 'any' | 'with' | 'without';
export type OwnerFilter = 'any' | 'unassigned';

export interface ItemFilters {
  q: string;
  status: string[];
  priority: string[];
  domain: string[];
  evidence: EvidenceFilter;
  owner: OwnerFilter;
  /** only open gaps (the Remediation tab's list, and a click on "open gaps") */
  gaps: boolean;
}
export const NO_FILTERS: ItemFilters = { q: '', status: [], priority: [], domain: [], evidence: 'any', owner: 'any', gaps: false };

export function activeFilterCount(f: ItemFilters): number {
  return (f.q.trim() ? 1 : 0) + (f.status.length ? 1 : 0) + (f.priority.length ? 1 : 0) + (f.domain.length ? 1 : 0) + (f.evidence !== 'any' ? 1 : 0) + (f.owner !== 'any' ? 1 : 0) + (f.gaps ? 1 : 0);
}

export function filterItems(items: readonly WorkItem[], f: ItemFilters): WorkItem[] {
  const q = f.q.trim().toLowerCase();
  return items.filter((it) => {
    if (q && !(`${it.number} ${it.description} ${it.domain} ${it.gap} ${it.responsible} ${it.assignees.map((a) => a.name).join(' ')}`.toLowerCase().includes(q))) return false;
    if (f.status.length && !f.status.includes(it.status)) return false;
    if (f.priority.length && !f.priority.includes(it.priority || 'none')) return false;
    if (f.domain.length && !f.domain.includes(it.domain)) return false;
    if (f.evidence === 'with' && it.evidenceCount === 0) return false;
    if (f.evidence === 'without' && it.evidenceCount > 0) return false;
    if (f.owner === 'unassigned' && (it.assignees.length > 0 || it.responsible)) return false;
    if (f.gaps && !isOpenGap(it)) return false;
    return true;
  });
}

export type SortKey = 'number' | 'status' | 'priority' | 'due' | 'evidence';
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: Sort = { key: 'number', dir: 'asc' };
const NATURAL = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const STATUS_RANK: Record<string, number> = { not_complied: 0, partially_complied: 1, in_progress: 2, complied: 3, na: 4 };
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, '': 4 };

/** A new array in the order asked for; ties keep the workbook order (ids ascending), so the order is stable. "Due" puts the open gaps first, soonest first. */
export function sortItems(items: readonly WorkItem[], sort: Sort, days: SlaDays = DEFAULT_SLA_DAYS): WorkItem[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const value = (it: WorkItem): number => {
    if (sort.key === 'status') return STATUS_RANK[it.status];
    if (sort.key === 'priority') return PRIORITY_RANK[it.priority];
    if (sort.key === 'evidence') return it.evidenceCount;
    return isOpenGap(it) ? dueMs(it, days) ?? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER;
  };
  return items.slice().sort((a, b) => {
    const byKey = sort.key === 'number' ? NATURAL.compare(a.number, b.number) : value(a) - value(b);
    return byKey !== 0 ? byKey * sign : a.id - b.id;
  });
}

export interface DomainGroup { domain: string; items: WorkItem[]; complied: number; answered: number }

/** The controls grouped by domain, domains in the order the workbook lists them. `answered` counts every control somebody answered (anything but "not answered"). */
export function groupByDomain(items: readonly WorkItem[]): DomainGroup[] {
  const groups = new Map<string, DomainGroup>();
  for (const it of items) {
    let g = groups.get(it.domain);
    if (!g) { g = { domain: it.domain, items: [], complied: 0, answered: 0 }; groups.set(it.domain, g); }
    g.items.push(it);
    if (it.status === 'complied') g.complied += 1;
    if (it.status !== 'in_progress') g.answered += 1;
  }
  return Array.from(groups.values());
}

export const domainsOf = (items: readonly WorkItem[]): string[] => groupByDomain(items).map((g) => g.domain);

export function statusCounts(items: readonly WorkItem[]): Record<ControlStatus, number> {
  const out: Record<ControlStatus, number> = { complied: 0, partially_complied: 0, not_complied: 0, in_progress: 0, na: 0 };
  for (const it of items) out[it.status] += 1;
  return out;
}

/** The control before and after `id` in the list that is shown (the drawer's Previous / Next), null at the ends or when `id` is not listed. */
export function neighbours(items: readonly WorkItem[], id: number | null): { prev: WorkItem | null; next: WorkItem | null } {
  const at = items.findIndex((i) => i.id === id);
  return at < 0 ? { prev: null, next: null } : { prev: items[at - 1] ?? null, next: items[at + 1] ?? null };
}
