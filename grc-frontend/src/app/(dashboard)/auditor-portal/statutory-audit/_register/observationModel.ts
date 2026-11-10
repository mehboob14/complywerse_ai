// Statutory Audit's observations, apart from React so `node --test` pins it (observationModel.test.ts): the rows and the answers the server gives, the organisation's own status
// levels and where an observation may be moved from each, the register's definition on the Facet explorer (facets, quick chips, sorts, board), the whole-list load, the CSV
// of the rows shown or ticked, and what a line of the history says in words (the server's own messages carry ids that a person has no use for).
import { buildSchema, type RegisterDef } from '../../../../../components/records/registerModel.ts';
import { levelPill, observationPriority, observationType } from '../../../../../lib/statuses/statutory.ts';
import { statusLabel } from '../../../../../lib/format.ts';

// ── what the server sends ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One of the organisation's status levels (Settings > Statuses; `GET /observations/meta` -> status_levels). */
export interface Level { key: string; label: string; order?: number; terminal?: boolean; tone?: string; clock?: 'runs' | 'paused'; escalate_after_days?: number | null }

/** Where an observation stands against the organisation's SLA (services/module_settings.sla_state), computed when it was read. */
export interface Sla {
  state: 'on_track' | 'due_soon' | 'breached' | 'paused' | 'closed' | 'no_due_date';
  days_overdue: number | null;
  due_in_days: number | null;
  target_days: number | null;
  due_date?: string | null;
  implied_due_date: boolean;
  escalated: boolean;
}

export interface FieldDef { key: string; label: string; type: string; required?: boolean; options?: string[]; help?: string; archived?: boolean }

export interface ObservationRow {
  id: number;
  code: string | null;
  title: string;
  description: string | null;
  observation_type: string;
  regulator_source: string | null;
  regulation_reference: string | null;
  priority: string;
  status: string;
  audit_period: string | null;
  /** a day, written as a DateTime ("2026-11-30T00:00:00"): its calendar day */
  due_date: string | null;
  management_response: string | null;
  notes: string | null;
  area_domain: string | null;
  category: string | null;
  owner_id: number | null;
  owner_name: string | null;
  created_by_name: string | null;
  closed_at: string | null;
  source_document_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  custom_values: Record<string, unknown> | null;
  sla: Sla | null;
  evidence_count: number;
  control_count: number;
  risk_count: number;
  issue_count: number;
  document_count: number;
  /** a copy of a regulator finding of the Issue Register, overwritten from it on every sync */
  mirrored: boolean;
  mirrored_issue_id: number | null;
}

export interface ObservationMeta {
  statuses?: string[];
  status_levels?: Level[];
  custom_fields?: FieldDef[];
  regulator_sources?: string[];
  audit_periods?: string[];
  categories?: string[];
  counts_by_status?: Record<string, number>;
}

export interface HistoryRow { id: number; activity_type: string; message: string | null; payload: Record<string, unknown> | null; user_name: string | null; created_at: string | null }

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export const TYPES = ['requirement', 'observation', 'finding', 'recommendation'] as const;
const NONE = 'none';

// ── status levels ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The platform's own order of moves (statutory_audit.py STATUS_TRANSITIONS; a test re-reads the server's table). */
export const BUILTIN_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  open: ['in_progress', 'complied', 'closed', 'cancelled'],
  in_progress: ['open', 'complied', 'closed', 'cancelled'],
  complied: ['in_progress', 'closed', 'open'],
  closed: ['open', 'in_progress'],
  cancelled: ['open'],
};

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The levels to show: the organisation's own, in its order; then any word a row holds that no level names (a level removed after rows used it), so a filter can always reach it. */
export function levelsOf(meta: ObservationMeta | undefined, rows: readonly Pick<ObservationRow, 'status'>[]): Level[] {
  const own = (meta?.status_levels ?? []).filter((l) => l && l.key);
  const out: Level[] = own.slice();
  const seen = new Set(out.map((l) => l.key));
  rows.forEach((r) => {
    if (r.status && !seen.has(r.status)) {
      seen.add(r.status);
      out.push({ key: r.status, label: levelPill([], r.status).label });
    }
  });
  return out;
}

export const isTerminal = (levels: readonly Level[], status: string | null | undefined): boolean => !!levels.find((l) => l.key === status)?.terminal;

/** Where an observation may be moved: what the server will accept. From one of the five built-in words to another the table above rules; a level the organisation added
 *  may be reached from anywhere and may be left for anywhere (the server lets it: `transition_status`). Never to the status it already has. */
export function nextStatuses(levels: readonly Level[], current: string | null | undefined): Level[] {
  const from = String(current ?? '');
  return levels.filter((l) => {
    if (l.key === from) return false;
    if (has(BUILTIN_TRANSITIONS, from) && has(BUILTIN_TRANSITIONS, l.key)) return BUILTIN_TRANSITIONS[from].includes(l.key);
    return true;
  });
}

// ── words for dates and the SLA ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const days = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;

/** "Overdue by 3 days", "Due today", "Due in 5 days", "On track, 40 days left", "Paused", "No due date"; '' when the observation is closed (the SLA no longer applies). */
export function slaText(sla: Sla | null | undefined, { escalated = true }: { escalated?: boolean } = {}): string {
  if (!sla || sla.state === 'closed') return '';
  switch (sla.state) {
    case 'breached': return `Overdue by ${days(sla.days_overdue ?? 0)}${escalated && sla.escalated ? ', escalated' : ''}`;
    case 'due_soon': return sla.due_in_days ? `Due in ${days(sla.due_in_days)}` : 'Due today';
    case 'on_track': return `On track, ${days(sla.due_in_days ?? 0)} left`;
    case 'paused': return 'Paused';
    default: return 'No due date';
  }
}

// ── the register's definition ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PRIORITY_RANK: Readonly<Record<string, number>> = { critical: 0, high: 1, medium: 2, low: 3 };

function distinct(rows: readonly ObservationRow[], pick: (r: ObservationRow) => string | null, noneLabel: string): Array<{ value: string; label: string }> {
  const seen = new Set<string>();
  let missing = false;
  rows.forEach((r) => { const v = (pick(r) ?? '').trim(); if (v) seen.add(v); else missing = true; });
  const list = Array.from(seen).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })).map((value) => ({ value, label: value }));
  return missing ? list.concat({ value: NONE, label: noneLabel }) : list;
}

const textOf = (v: string | null | undefined): string | null => ((v ?? '').trim() ? (v as string).trim() : null);

/** The register on the Facet explorer. `levels` are the organisation's own status levels (the facet, the board and the "open" chips follow them); `me` is the signed-in person for "Mine". */
export function observationDef(levels: readonly Level[], me: number | null): RegisterDef<ObservationRow> {
  const terminal = (r: ObservationRow): boolean => isTerminal(levels, r.status);
  const order = (status: string): number => { const at = levels.findIndex((l) => l.key === status); return at < 0 ? levels.length : at; };
  return {
    key: 'statutory-observation',
    noun: { one: 'observation', other: 'observations' },
    idOf: (r) => r.id,
    text: (r) => [r.code, r.title, r.description, r.regulator_source, r.regulation_reference, r.audit_period, r.category, r.area_domain, r.owner_name].filter(Boolean).join(' '),
    facets: [
      { key: 'status', label: 'Status', defaultOpen: true, values: (r) => [r.status], options: () => levels.map((l) => ({ value: l.key, label: levelPill(levels, l.key).label })) },
      { key: 'priority', label: 'Priority', defaultOpen: true, values: (r) => [r.priority], options: () => PRIORITIES.map((value) => ({ value, label: observationPriority.label(value) })) },
      { key: 'type', label: 'Type', values: (r) => [r.observation_type], options: () => TYPES.map((value) => ({ value, label: observationType.label(value) })) },
      { key: 'regulator', label: 'Regulator', searchable: true, limit: 7, values: (r) => [textOf(r.regulator_source) ?? NONE], options: (rows) => distinct(rows, (r) => r.regulator_source, 'No regulator') },
      { key: 'period', label: 'Period', searchable: true, limit: 7, values: (r) => [textOf(r.audit_period) ?? NONE], options: (rows) => distinct(rows, (r) => r.audit_period, 'No period') },
      { key: 'category', label: 'Category', searchable: true, limit: 7, values: (r) => [textOf(r.category) ?? NONE], options: (rows) => distinct(rows, (r) => r.category, 'No category') },
      {
        key: 'owner', label: 'Owner', searchable: true, limit: 7,
        values: (r) => [r.owner_id ? String(r.owner_id) : NONE],
        options: (rows) => {
          const seen = new Map<string, string>();
          rows.forEach((r) => { if (r.owner_id) seen.set(String(r.owner_id), r.owner_name || `User ${r.owner_id}`); });
          const list = Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1], 'en', { sensitivity: 'base' })).map(([value, label]) => ({ value, label }));
          return rows.some((r) => !r.owner_id) ? list.concat({ value: NONE, label: 'Unassigned' }) : list;
        },
      },
    ],
    quick: [
      { key: 'open', label: 'Open', test: (r) => !terminal(r), title: 'Not closed: every status that is not a final one' },
      { key: 'due30', label: 'Due in 30 days', test: (r) => !terminal(r) && !!r.sla && (r.sla.state === 'due_soon' || r.sla.state === 'on_track') && r.sla.due_in_days != null && r.sla.due_in_days >= 0 && r.sla.due_in_days <= 30, title: 'Not closed, and due within the next 30 days by its due date or SLA' },
      { key: 'overdue', label: 'Overdue', test: (r) => r.sla?.state === 'breached', title: 'Past its due date or SLA, and not closed: the same ones the SLA column marks' },
      ...(me != null ? [{ key: 'mine', label: 'Mine', test: (r: ObservationRow) => r.owner_id === me, title: 'Observations you own' }] : []),
      { key: 'mirrored', label: 'From the register', test: (r) => r.mirrored, title: 'Regulator findings kept here from the Issue Register' },
    ],
    sorts: [
      { key: 'updated', label: 'Last changed', firstDir: 'desc', value: (r) => r.updated_at },
      { key: 'code', label: 'Code', firstDir: 'asc', value: (r) => r.code },
      { key: 'title', label: 'Title', firstDir: 'asc', value: (r) => r.title },
      { key: 'status', label: 'Status', firstDir: 'asc', value: (r) => order(r.status) },
      { key: 'priority', label: 'Priority (worst first)', firstDir: 'asc', value: (r) => PRIORITY_RANK[r.priority] ?? 9 },
      { key: 'due', label: 'Due date', firstDir: 'asc', value: (r) => r.due_date },
      { key: 'regulator', label: 'Regulator', firstDir: 'asc', value: (r) => textOf(r.regulator_source) },
      { key: 'category', label: 'Category', firstDir: 'asc', value: (r) => textOf(r.category) },
      { key: 'owner', label: 'Owner', firstDir: 'asc', value: (r) => r.owner_name || null },
      { key: 'evidence', label: 'Evidence', firstDir: 'desc', value: (r) => r.evidence_count },
    ],
    defaultSort: { key: 'updated', dir: 'desc' },
    board: {
      label: 'Observations by status',
      columns: levels.map((l) => ({ id: l.key, label: levelPill(levels, l.key).label, test: (r: ObservationRow) => r.status === l.key })),
    },
    pageSize: 25,
  };
}

/** The address of the register (its facet names are fixed, so one schema serves every organisation). */
export const OBSERVATION_SCHEMA = buildSchema(observationDef([], 0));

/** How many records an observation links to, in all. */
export const linkedCount = (r: Pick<ObservationRow, 'control_count' | 'risk_count' | 'issue_count' | 'document_count'>): number =>
  (r.control_count || 0) + (r.risk_count || 0) + (r.issue_count || 0) + (r.document_count || 0);

// ── a mirrored observation ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What the Issue Register overwrites on every sync (audit_register/crosslinks.py sync_observation): these are read-only on a copy. The type (set when the copy is made), the notes,
 *  the extra fields, the evidence and the links are the person's own. */
export const MIRRORED_FIELDS = ['title', 'description', 'regulator_source', 'regulation_reference', 'priority', 'due_date', 'management_response', 'owner_id', 'area_domain', 'category', 'audit_period', 'source_document_name', 'status'] as const;

export const lockedField = (mirrored: boolean, field: string): boolean => mirrored && (MIRRORED_FIELDS as readonly string[]).includes(field);

// ── loading the whole list ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const PAGE = 500;
export const CAP = 5000;

export interface PageAnswer { items: ObservationRow[]; total: number }

/** Every observation, in pages: the register filters and counts in the browser, so it needs the whole list, and says when the server holds more than the cap. A failed page fails the load
 *  (never a short list passed off as the whole one). `fetchPage(skip, limit)` is one request. */
export async function loadAll(fetchPage: (skip: number, limit: number) => Promise<PageAnswer>, { page = PAGE, cap = CAP }: { page?: number; cap?: number } = {}): Promise<{ rows: ObservationRow[]; total: number }> {
  const first = await fetchPage(0, page);
  const rows = first.items.slice();
  const total = typeof first.total === 'number' ? first.total : rows.length;
  while (rows.length < Math.min(total, cap)) {
    const next = await fetchPage(rows.length, Math.min(page, cap - rows.length));
    if (next.items.length === 0) break;                       // the server has no more than it said: stop rather than ask for ever
    rows.push(...next.items);
  }
  const seen = new Set<number>();
  return { rows: rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))), total };       // a row moved by an edit between two pages is not shown twice
}

// ── export ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One cell: text made safe for a spreadsheet. A cell that begins with = + - @ (or a tab / carriage return) would be read as a formula, so it is written with a leading apostrophe;
 *  quotes, commas and line breaks are quoted. */
export function cell(value: string | number | null | undefined): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_HEADER = ['Code', 'Title', 'Type', 'Status', 'Priority', 'Regulator', 'Reference', 'Period', 'Category', 'Area', 'Owner', 'Due', 'SLA', 'Evidence', 'Linked records', 'From the register', 'Source document', 'Created', 'Last changed'] as const;
const DAY = (v: string | null | undefined): string => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

export function toCsv(rows: readonly ObservationRow[], levels: readonly Level[]): string {
  const lines = [CSV_HEADER.map(cell).join(',')];
  rows.forEach((r) => {
    lines.push([
      r.code, r.title, observationType.label(r.observation_type), levelPill(levels, r.status).label, observationPriority.label(r.priority), r.regulator_source, r.regulation_reference, r.audit_period,
      r.category, r.area_domain, r.owner_name, DAY(r.due_date), slaText(r.sla), r.evidence_count, linkedCount(r), r.mirrored ? 'Yes' : '', r.source_document_name, DAY(r.created_at), DAY(r.updated_at),
    ].map(cell).join(','));
  });
  return `${lines.join('\r\n')}\r\n`;
}

/** "statutory-audit-2026-11-10-84.csv" / "statutory-audit-selected-2026-11-10-3.csv" */
export const exportName = (day: string, count: number, selection: boolean): string => `statutory-audit-${selection ? 'selected-' : ''}${day}-${count}.csv`;

// ── the history in words ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const FIELD_WORDS: Readonly<Record<string, string>> = {
  title: 'the title', description: 'the description', observation_type: 'the type', regulator_source: 'the regulator', regulation_reference: 'the reference', priority: 'the priority',
  audit_period: 'the period', due_date: 'the due date', management_response: 'the management response', notes: 'the notes', area_domain: 'the area', category: 'the category',
  owner_id: 'the owner', custom_values: 'the additional fields', status: 'the status',
};

const A_THING: Readonly<Record<string, string>> = { evidence: 'a file', control: 'a control', risk: 'a risk', issue: 'an issue', document: 'a document' };

const joinWords = (parts: string[]): string => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/** What a line of the history says, in words a person can use: the server's own messages carry ids ("Linked control #5") and raw status words ("open -> in_progress"), so the
 *  line is told from what happened. `note` is what the person wrote with a status change. */
export function activityWords(h: Pick<HistoryRow, 'activity_type' | 'message' | 'payload'>, levels: readonly Level[]): { text: string; note: string | null } {
  const payload = h.payload ?? {};
  if (h.activity_type === 'status_change') {
    const from = typeof payload.from === 'string' ? payload.from : null;
    const to = typeof payload.to === 'string' ? payload.to : null;
    if (from && to) {
      const note = typeof payload.notes === 'string' && payload.notes.trim() ? payload.notes.trim() : null;
      return { text: `Moved from ${levelPill(levels, from).label} to ${levelPill(levels, to).label}`, note };
    }
  }
  if (h.activity_type === 'update') {
    const fields = Array.isArray(payload.fields) ? (payload.fields as unknown[]).filter((f): f is string => typeof f === 'string') : [];
    const named = Array.from(new Set(fields.map((f) => FIELD_WORDS[f]).filter(Boolean)));
    return { text: named.length ? `Changed ${joinWords(named)}` : 'Changed the observation', note: null };
  }
  const said = (h.message ?? '').trim();
  const bare = /^(Linked|Unlinked) (evidence|control|risk|issue|document) #\d+$/i.exec(said);
  if (bare) return { text: `${bare[1][0].toUpperCase()}${bare[1].slice(1).toLowerCase()} ${A_THING[bare[2].toLowerCase()]}`, note: null };
  const text = said.replace(/\s*#\d+\b/g, '').replace(/\s+/g, ' ').trim();
  return { text: text || statusLabel(h.activity_type), note: null };
}
