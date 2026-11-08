// What "Issues on a record" (the card), "Create issue" (the button and its drawer) and the "N open" badge decide, apart from React so `node --test` can pin it (embedModel.test.ts):
// which records can raise an issue, what the form starts with, what it sends, what it checks, what severity and deadline it announces, which rows the card draws and how late they are,
// where "View all" goes, and what the badge says. The server's rules (routers/auto_create.py, routers/by_source.py) are the ones written down here.
import { parseUtc } from '../../lib/serverTime.ts';

// ── the records that can have issues ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Every record type the card and the badge can list issues for (routers/by_source.py SOURCE_DISPATCH + the incident). */
export type PanelSource =
  | 'vulnerability' | 'risk' | 'asset'
  | 'control_framework' | 'control_parsed' | 'control_normalized' | 'control_internal'
  | 'evidence' | 'vendor' | 'is_project'
  | 'governance_document' | 'policy_statement'
  | 'risk_incident';

/** The record types an issue can be raised from by a person (routers/auto_create.py): evidence and vendors are not wired in, an IS project's card is a list. */
export type CreatableSource = Exclude<PanelSource, 'evidence' | 'vendor' | 'is_project'>;

const LIST_ONLY: readonly string[] = ['evidence', 'vendor', 'is_project'];
export const canCreateFrom = (source: string): source is CreatableSource => !LIST_ONLY.includes(source);

/** What the record is called in a sentence ("Linked to this risk"). */
const NOUN: Record<PanelSource, string> = {
  vulnerability: 'vulnerability', risk: 'risk', asset: 'asset',
  control_framework: 'control', control_parsed: 'control', control_normalized: 'control', control_internal: 'control',
  evidence: 'evidence item', vendor: 'vendor', is_project: 'project',
  governance_document: 'document', policy_statement: 'policy statement', risk_incident: 'incident',
};
export const sourceNoun = (source: string): string => (NOUN as Record<string, string>)[source] ?? 'record';

/** What type and category a new issue starts with when the page gave none, by where it is raised from; no source is the Issues page's own default. */
export function sourceDefaults(source?: string | null): { issue_type: string; category: string } {
  switch (source) {
    case 'risk': return { issue_type: 'non_conformance', category: 'operations' };
    case 'asset': return { issue_type: 'incident', category: 'operations' };
    case 'risk_incident': return { issue_type: 'incident', category: 'operations' };
    case 'is_project': return { issue_type: 'process_gap', category: 'operations' };
    case 'governance_document': case 'policy_statement': return { issue_type: 'non_conformance', category: 'regulatory' };
    case 'control_framework': case 'control_parsed': case 'control_normalized': case 'control_internal': return { issue_type: 'non_conformance', category: 'regulatory' };
    default: return { issue_type: 'incident', category: 'security' };
  }
}

// ── the form ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The ten kinds of record a new issue can be linked to in the form, with the body key POST /issues and POST /issues/from-source read each from. */
export const LINK_FAMILIES = [
  { key: 'linked_vulnerability_ids', label: 'Vulnerabilities' },
  { key: 'linked_risk_ids', label: 'Risks' },
  { key: 'linked_task_ids', label: 'Tasks' },
  { key: 'linked_is_project_ids', label: 'Projects' },
  { key: 'linked_asset_ids', label: 'Assets' },
  { key: 'linked_internal_control_ids', label: 'Controls' },
  { key: 'linked_governance_document_ids', label: 'Documents' },
  { key: 'linked_policy_statement_ids', label: 'Policy statements' },
  { key: 'linked_evidence_ids', label: 'Evidence' },
  { key: 'linked_vendor_ids', label: 'Vendors' },
] as const;
export type LinkKey = (typeof LINK_FAMILIES)[number]['key'];
export type LinkPicks = Record<LinkKey, string[]>;
export const NO_LINKS = (): LinkPicks => LINK_FAMILIES.reduce((all, f) => ({ ...all, [f.key]: [] as string[] }), {} as LinkPicks);

/** What a page may pre-fill (the props the consumers already pass). */
export interface Presets {
  title?: string; description?: string; impact?: string; urgency?: string; category?: string; issue_type?: string;
}

export interface Draft {
  title: string; description: string; issue_type: string; category: string; impact: string; urgency: string;
  override: string; overrideReason: string; assignee: string | null; due: string; links: LinkPicks;
}

/** What the form starts with when it opens: the page's presets first, else the source's defaults, else medium impact and urgency. */
export function initialDraft(source: string | null | undefined, presets: Presets = {}): Draft {
  const d = sourceDefaults(source);
  return {
    title: presets.title ?? '', description: presets.description ?? '',
    issue_type: presets.issue_type || d.issue_type, category: presets.category || d.category,
    impact: presets.impact || 'medium', urgency: presets.urgency || 'medium',
    override: '', overrideReason: '', assignee: null, due: '', links: NO_LINKS(),
  };
}

const sameLinks = (a: LinkPicks, b: LinkPicks): boolean => LINK_FAMILIES.every((f) => a[f.key].join(',') === b[f.key].join(','));
/** Something was typed or chosen since the form opened (the panel then asks "Discard changes?"). */
export function isDirty(opened: Draft, now: Draft): boolean {
  const { links: l1, ...rest1 } = opened;
  const { links: l2, ...rest2 } = now;
  return (Object.keys(rest1) as Array<keyof typeof rest1>).some((k) => rest1[k] !== rest2[k]) || !sameLinks(l1, l2);
}

export const TITLE_MAX = 255;
export interface DraftErrors { title?: string; overrideReason?: string }
export function draftErrors(d: Draft): DraftErrors {
  const out: DraftErrors = {};
  if (!d.title.trim()) out.title = 'Enter a title.';
  else if (d.title.trim().length > TITLE_MAX) out.title = `Keep the title under ${TITLE_MAX} characters.`;
  if (d.override && !d.overrideReason.trim()) out.overrideReason = 'Say why the severity is changed.';
  return out;
}

/** The body of POST /issues (no source) or POST /issues/from-source (the caller adds `source_type` and `source_id`). Empty optional fields are left out; empty link lists too. */
export function createBody(d: Draft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: d.title.trim(), description: d.description, impact: d.impact, urgency: d.urgency, issue_type: d.issue_type, category: d.category,
  };
  if (d.override) { body.severity_override = d.override; body.severity_override_reason = d.overrideReason.trim(); }
  if (d.assignee) body.assignee_id = Number(d.assignee);
  if (d.due) body.due_date = d.due;
  for (const f of LINK_FAMILIES) if (d.links[f.key].length) body[f.key] = d.links[f.key].map(Number);
  return body;
}

export const linkCount = (links: LinkPicks): number => LINK_FAMILIES.reduce((n, f) => n + links[f.key].length, 0);

// ── the severity the form announces ───────────────────────────────────────────────────────────────────────────────────────────────────────
export interface MatrixCell { impact: string; urgency: string; severity: string; sla_resolve_hours: number }

/** The severity (and the hours to resolve it) the tenant's matrix gives this impact and urgency; null while the matrix is not read. */
export function severityPreview(cells: readonly MatrixCell[] | null | undefined, impact: string, urgency: string): { severity: string; hours: number } | null {
  const cell = (cells ?? []).find((c) => c.impact === impact && c.urgency === urgency);
  return cell ? { severity: cell.severity, hours: cell.sla_resolve_hours } : null;
}

/** "24 hours", "3 days", "3 weeks": the time the matrix allows, said the way a person plans. */
export function hoursWords(hours: number): string {
  const h = Math.max(1, Math.round(hours));
  if (h < 48) return h === 1 ? '1 hour' : `${h} hours`;
  if (h < 14 * 24) return `${Math.round(h / 24)} days`;
  return `${Math.round(h / (7 * 24))} weeks`;
}

// ── the card ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A row of GET /by-source/{type}/{id}. `overdue` and `assignee_name` are the server's newer fields; a server that does not send them reads `sla_breached`. */
export interface IssueRow {
  id: number; code: string | null; title: string; severity: string | null; workflow_state: string;
  sla_breached?: boolean; overdue?: boolean; target_closure_date: string | null; assignee_name?: string | null; created_at?: string | null;
}
export interface BySourcePayload {
  source_type?: string; source_id?: number;
  open: IssueRow[]; closed: IssueRow[]; total_open: number; total_closed: number; critical_open: number;
}

/** Rows the card draws before "View all". */
export const PANEL_ROWS = 5;
const DAY = 86_400_000;

/** "Overdue 3 d" for an open issue past its target date; "Overdue" when the date is not known or passed today; null when it is not late. */
export function lateWords(row: IssueRow, now: number): string | null {
  if (!(row.overdue ?? row.sla_breached)) return null;
  const target = parseUtc(row.target_closure_date);
  if (!target) return 'Overdue';
  const days = Math.floor((now - target.getTime()) / DAY);
  return days >= 1 ? `Overdue ${days} d` : 'Overdue';
}

export interface PanelRowView { id: number; code: string | null; title: string; severity: string | null; state: string; late: string | null; assignee: string | null }
export interface PanelView { rows: PanelRowView[]; hidden: number; totalOpen: number; criticalOpen: number; totalClosed: number; closedRows: PanelRowView[] }

const rowView = (r: IssueRow, now: number): PanelRowView => ({
  id: r.id, code: r.code, title: r.title, severity: r.severity, state: r.workflow_state || 'new', late: lateWords(r, now), assignee: r.assignee_name?.trim() || null,
});

/** What the card draws from the answer: the first rows, the server's TRUE totals (never the length of the rows it was sent), and how many open ones are not drawn. */
export function panelView(data: BySourcePayload, now: number): PanelView {
  const rows = (data.open ?? []).slice(0, PANEL_ROWS).map((r) => rowView(r, now));
  return {
    rows, hidden: Math.max(0, data.total_open - rows.length), totalOpen: data.total_open, criticalOpen: data.critical_open, totalClosed: data.total_closed,
    closedRows: (data.closed ?? []).map((r) => rowView(r, now)),
  };
}

/** Where "View all" goes: the Issues register filtered to this record (the register reads `linked=<type>:<id>`). One place, so the register's key is changed once. */
export const viewAllHref = (source: string, id: number): string => `/issues/register?linked=${encodeURIComponent(source)}:${id}`;

// ── the badge ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Counts { total_open: number; critical_open: number; total_closed: number }

/** The "N open" pill, or null when it is hidden (zero issues and `hideWhenZero`). Red when a critical issue is open, amber when anything is open. */
export function badgeView(counts: Counts, hideWhenZero = true): { label: string; tone: 'danger' | 'warning' | 'neutral'; name: string } | null {
  const open = counts.total_open;
  if (hideWhenZero && open === 0) return null;
  const crit = counts.critical_open;
  return {
    label: `${open} open`,
    tone: crit > 0 ? 'danger' : open > 0 ? 'warning' : 'neutral',
    name: `${open} open issue${open === 1 ? '' : 's'}${crit > 0 ? `, ${crit} critical` : ''}`,
  };
}

// ── what a failed create says ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The headline of the toast after a create: the issue's own code when it has one ("Issue ISS-0042 created"). */
export const createdMessage = (code?: string | null): string => (code ? `Issue ${code} created` : 'Issue created');
