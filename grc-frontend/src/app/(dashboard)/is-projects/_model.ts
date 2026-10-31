// The rules of the Projects pages with no React in them, so `node --test _model.test.ts` can pin them: the option lists the selects offer, the calculations
// the old pages made inline (moved here word for word: the budget share, the health score, the load of a team member, the colour thresholds), the words a
// chart says for a screen reader, the shape of every form (what it starts with, what it needs, what it sends) and how a list is asked for in pages.
// Nothing here talks to the server or to the DOM. The status words and their tones are lib/projectStatus.ts; dates and counts are lib/format.ts.
import { EMPTY, NOT_SET, formatCount, formatDate } from '../../../lib/format.ts';
import type { Tone } from '../../../lib/status.ts';
import { projectStatus } from '../../../lib/projectStatus.ts';

// ── what the selects offer ───────────────────────────────────────────────────────────────────────────────────────────
export const STATUSES = ['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
export const CATEGORIES = ['Infrastructure', 'Application Security', 'Compliance', 'Risk Remediation', 'Training', 'DR/BCP', 'Other'];
export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
export const HEALTH_OPTIONS = ['On Track', 'At Risk', 'Off Track'];
export const TASK_STATUSES = ['To Do', 'In Progress', 'In Review', 'Done', 'Blocked'];
export const TEAM_ROLES = ['Project Manager', 'Lead', 'Member', 'Reviewer'];
export const RISK_TYPES = ['Risk', 'Issue', 'Blocker', 'Dependency'];
export const SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low'];
export const MILESTONE_STATUSES = ['Pending', 'In Progress', 'Completed', 'Delayed'];
export const RISK_STATUSES = ['Open', 'Mitigated', 'Closed', 'Resolved'];
export const BUDGET_CATEGORIES = ['Hardware', 'Software', 'Licenses', 'Consulting', 'Personnel', 'Training', 'Infrastructure', 'Other'];
export const BUDGET_STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'];
export const COVERAGE_STATUSES = ['Planned', 'In Progress', 'Implemented', 'Verified', 'Not Applicable'];
export const LESSON_CATEGORIES = ['Recommendation', 'Process', 'Technical', 'People', 'Vendor', 'Communication', 'Planning'];
export const IMPACTS = ['Critical', 'High', 'Medium', 'Low'];
export const DEP_TYPES = ['internal', 'external'];
export const DEP_DIRECTIONS = ['depends_on', 'blocks', 'related_to'];
export const DEP_STATUSES = ['Active', 'Resolved', 'Blocked', 'Cancelled'];

// ── the tabs, and what the address calls them (?tab=) ───────────────────────────────────────────────────────────────────
export const LIST_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'projects', label: 'Projects' },
  { key: 'my-projects', label: 'My Projects' },
] as const;
export type ListTab = (typeof LIST_TABS)[number]['key'];
export const LIST_TAB_KEYS: readonly ListTab[] = LIST_TABS.map((t) => t.key);

export const DETAIL_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'team', label: 'Team' },
  { key: 'risks', label: 'Risks & Issues' },
  { key: 'updates', label: 'Updates' },
  { key: 'documents', label: 'Documents' },
  { key: 'budget', label: 'Budget & Financials' },
  { key: 'compliance', label: 'Compliance Mapping' },
  { key: 'lessons', label: 'Lessons Learned' },
  { key: 'dependencies', label: 'Dependencies' },
] as const;
export type DetailTab = (typeof DETAIL_TABS)[number]['key'];
export const DETAIL_TAB_KEYS: readonly DetailTab[] = DETAIL_TABS.map((t) => t.key);

// ── a project, as the list and the dashboard receive it ──────────────────────────────────────────────────────────────────
export interface ISProject {
  id: number;
  name: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  health: string;
  project_owner_name: string | null;
  sponsor: string | null;
  department: string | null;
  start_date: string | null;
  target_end_date: string | null;
  budget_estimated: number;
  budget_actual: number;
  completion_percentage: number;
  milestones_count: number;
  tasks_count: number;
  team_count: number;
  open_risks_count: number;
  created_at: string | null;
  updated_at: string | null;
}

/** What a change to a project refreshes: the list (its keys start with 'is-projects'), the Overview's three requests and My Projects. The old pages refreshed the
 *  list only, so the Overview and My Projects showed the old numbers for up to a minute (the cache's staleTime). */
export const PROJECT_KEYS: ReadonlyArray<readonly unknown[]> = [['is-projects'], ['is-projects-dashboard'], ['is-projects-enhanced-analytics'], ['is-projects-health-trend'], ['is-projects-my']];

// ── asking for the list ─────────────────────────────────────────────────────────────────────────────────────────────
export interface ListFilters { status: string; category: string; priority: string; health: string; owner: string; search: string }
export const NO_FILTERS: ListFilters = { status: '', category: '', priority: '', health: '', owner: '', search: '' };
export const filtersActive = (f: ListFilters): boolean => Object.keys(f).some((k) => String(f[k as keyof ListFilters]).trim() !== '');

/** The server pages at 50 unless asked (and at most 200): the old page never asked, so it showed the first 50 and said nothing. */
export const PAGE_SIZES = [25, 50, 100, 200];
export const DEFAULT_PAGE_SIZE = 50;

/** The query of the list: the same names as before (status, category, priority, health, search, owner_name; each only when set) plus the page asked for. */
export function listParams(f: ListFilters, page: number, pageSize: number): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.status) p.status = f.status;
  if (f.category) p.category = f.category;
  if (f.priority) p.priority = f.priority;
  if (f.health) p.health = f.health;
  if (f.search.trim()) p.search = f.search.trim();
  if (f.owner) p.owner_name = f.owner;
  p.page = String(Math.max(1, Math.floor(page) || 1));
  p.page_size = String(PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE);
  return p;
}

/** What the list answered: the rows of this page and the TRUE total (`total` is the server's count of every project the filters match). */
export function readProjectPage(data: unknown): { items: ISProject[]; total: number } {
  const d = (data && typeof data === 'object' ? data : {}) as { items?: unknown; total?: unknown };
  const items = Array.isArray(d.items) ? (d.items as ISProject[]) : [];
  return { items, total: typeof d.total === 'number' && d.total >= items.length ? d.total : items.length };
}

// ── numbers the pages show ───────────────────────────────────────────────────────────────────────────────────────────────
/** A bar's fill: 0 to 100 whatever is stored (a stored 150 or -5 must not draw outside its track). */
export function clampPercent(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}

/** "$12.5M", "$75K", "$1.2K", "$500", "$0"; "—" when there is no number. The old pages' units (K, M) with one decimal and no trailing ".0" (they printed "$2.0M" on
 *  one page and "$75K" on another); the platform's formatCompact is not used because it rounds $12.5M to "13M", too coarse for a budget. */
export function money(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return EMPTY;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const one = (x: number): string => String(Math.round(x * 10) / 10);
  if (abs >= 1e6 || Math.round(abs / 100) / 10 >= 1000) return `${sign}$${one(abs / 1e6)}M`;       // (999,950 rounds up into the next unit, as formatCompact does)
  if (abs >= 1e3) return `${sign}$${one(abs / 1e3)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/** An estimate nobody entered is stored as 0: say "Not set" rather than "$0". */
export const estimateText = (n: number | null | undefined): string => (typeof n === 'number' && n > 0 ? money(n) : NOT_SET);

/** The share of the estimate spent (the detail page's `budgetUtil`): a whole percent, 0 when there is no estimate. */
export function budgetShare(estimated: number | null | undefined, actual: number | null | undefined): number {
  const e = estimated ?? 0;
  return e > 0 ? Math.round(((actual ?? 0) / e) * 100) : 0;
}

/** The Overview's budget bar: above 90 danger, above 70 warning. */
export const utilizationTone = (pct: number): Tone => (pct > 90 ? 'danger' : pct > 70 ? 'warning' : 'success');
/** A project's burn rate and its own budget bar: above 100 danger, above 80 warning. */
export const burnTone = (pct: number): Tone => (pct > 100 ? 'danger' : pct > 80 ? 'warning' : 'success');
/** The health score's colour: from 70 success, from 40 warning. */
export const scoreTone = (score: number): Tone => (score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger');

/** The share of projects On Track, as the Overview computes it: On Track over every project counted (1 when there are none, so it is 0, not NaN). */
export function healthScore(distribution: Record<string, number> | null | undefined): number {
  const hd = distribution ?? {};
  const total = Object.keys(hd).reduce((a, k) => a + (hd[k] || 0), 0) || 1;
  return Math.round(((hd['On Track'] || 0) / total) * 100);
}

/** A team member's load: 25 points per project, 100 at most. */
export const loadPercent = (totalProjects: number): number => Math.min((totalProjects || 0) * 25, 100);
export const loadTone = (pct: number): Tone => (pct >= 100 ? 'danger' : pct >= 75 ? 'warning' : pct >= 50 ? 'progress' : 'success');
export const LOAD_LEGEND: Array<{ label: string; tone: Tone }> = [
  { label: 'Low', tone: 'success' }, { label: 'Medium', tone: 'progress' }, { label: 'High', tone: 'warning' }, { label: 'Overloaded', tone: 'danger' },
];

/** The alignment matrix's colour for a framework status, by the words it contains (as before): compliant/met/complete, partial/progress, gap/non/fail, else mapped. */
export function frameworkTone(status: string): Tone {
  const s = String(status ?? '').toLowerCase();
  if (s.includes('compliant') || s.includes('met') || s.includes('complete')) return 'success';
  if (s.includes('partial') || s.includes('progress')) return 'warning';
  if (s.includes('gap') || s.includes('non') || s.includes('fail')) return 'danger';
  return 'progress';
}
export const FRAMEWORK_LEGEND: Array<{ label: string; tone: Tone }> = [
  { label: 'Compliant', tone: 'success' }, { label: 'Partial', tone: 'warning' }, { label: 'Gap', tone: 'danger' }, { label: 'Mapped', tone: 'progress' },
];

// ── the Overview's chart data and the words a chart says ───────────────────────────────────────────────────────────────────────
export interface Slice { name: string; value: number }
export interface TrendPoint { date: string; on_track: number; at_risk: number; off_track: number; total: number; health_score: number }

const sum = (rows: Slice[]): number => rows.reduce((a, r) => a + (r.value || 0), 0);
const plural = (n: number, one: string, many: string): string => `${formatCount(n)} ${n === 1 ? one : many}`;

/** The status donut's slices: the word the project pages say, its tone (so a slice is the colour of its pill) and its share of the total, rounded as before. */
export function statusSlices(dist: Slice[] | null | undefined): Array<{ key: string; label: string; value: number; percent: number; tone: Tone }> {
  const rows = dist ?? [];
  const total = sum(rows);
  return rows.map((r) => ({ key: r.name, label: projectStatus.label(r.name), value: r.value, percent: total > 0 ? Math.round((r.value / total) * 100) : 0, tone: projectStatus.tone(r.name) }));
}

/** "150 projects by status: In progress 32 (21%), On hold 30 (20%)." */
export function statusSummary(dist: Slice[] | null | undefined): string {
  const slices = statusSlices(dist);
  if (slices.length === 0) return 'No projects by status.';
  return `${plural(sum(dist ?? []), 'project', 'projects')} by status: ${slices.map((s) => `${s.label} ${formatCount(s.value)} (${s.percent}%)`).join(', ')}.`;
}

/** "150 projects by category: Compliance 21, Infrastructure 30." */
export function categorySummary(dist: Slice[] | null | undefined): string {
  const rows = dist ?? [];
  if (rows.length === 0) return 'No projects by category.';
  return `${plural(sum(rows), 'project', 'projects')} by category: ${rows.map((r) => `${r.name} ${formatCount(r.value)}`).join(', ')}.`;
}

/** "Health score over 3 snapshots: 50% on 28 Oct 2026, 52% on 29 Oct 2026, 54% on 30 Oct 2026." With one snapshot or none the trend is not drawn. */
export function trendSummary(trend: TrendPoint[] | null | undefined): string {
  const t = trend ?? [];
  if (t.length === 0) return 'No health snapshots yet.';
  if (t.length === 1) return `One health snapshot so far: ${t[0].health_score}% on track on ${formatDate(t[0].date, { calendar: true })}.`;
  return `Health score over ${t.length} snapshots: ${t.map((p) => `${p.health_score}% on ${formatDate(p.date, { calendar: true })}`).join(', ')}.`;
}

/** The first `max` burn-rate rows (the Overview lists 8). */
export function burnRows<T>(rows: T[] | null | undefined, max = 8): T[] { return (rows ?? []).slice(0, max); }

/** The heatmap's members (the first 10) and its columns: the first 6 distinct project names across those members, in order of appearance. */
export function heatmapOf<M extends { projects: Array<{ project_name: string }> }>(team: M[] | null | undefined): { members: M[]; columns: string[] } {
  const members = (team ?? []).slice(0, 10);
  const names: string[] = [];
  members.forEach((m) => m.projects.forEach((p) => { if (names.indexOf(p.project_name) < 0) names.push(p.project_name); }));
  return { members, columns: names.slice(0, 6) };
}

/** The alignment matrix: its columns are the frameworks, its rows the first 8 projects that map to any, each cell the project's status word (or "Mapped"). */
export function alignmentOf(alignment: Record<string, Array<{ project_id: number; project_name: string; status: string }>> | null | undefined, maxRows = 8) {
  const frameworks = Object.keys(alignment ?? {});
  const byProject = new Map<number, { id: number; name: string; cells: Record<string, string> }>();
  frameworks.forEach((fw) => (alignment as Record<string, Array<{ project_id: number; project_name: string; status: string }>>)[fw].forEach((p) => {
    if (!byProject.has(p.project_id)) byProject.set(p.project_id, { id: p.project_id, name: p.project_name, cells: {} });
    (byProject.get(p.project_id) as { cells: Record<string, string> }).cells[fw] = p.status || 'Mapped';
  }));
  return { frameworks, rows: Array.from(byProject.values()).slice(0, maxRows) };
}

// ── people and risks the pickers offer (the detail page's own normalising, unchanged) ─────────────────────────────────────────────────
export interface TenantUserOption { id: number; displayName: string; email: string }
export interface TenantRiskOption { id: number; title: string; description: string; severity: string; mitigation: string; ownerName: string }

export function normalizeSeverity(value: unknown): string {
  if (typeof value === 'number') {
    if (value >= 16) return 'Critical';
    if (value >= 12) return 'High';
    if (value >= 6) return 'Medium';
    return 'Low';
  }
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'critical') return 'Critical';
  if (raw === 'high') return 'High';
  if (raw === 'medium') return 'Medium';
  if (raw === 'low') return 'Low';
  return 'Medium';
}

export function normalizeTenantUser(raw: unknown): TenantUserOption | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const nested = row.user && typeof row.user === 'object' ? (row.user as Record<string, unknown>) : null;
  const id = Number(row.id ?? row.user_id ?? nested?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const email = String(row.email ?? nested?.email ?? '').trim();
  const displayName = String((row.display_name ?? row.username ?? nested?.display_name ?? nested?.username ?? email) || `User ${id}`).trim();
  return { id, displayName: displayName || `User ${id}`, email };
}

/** The tenant's users, one per id, by name. */
export function tenantUsersOf(raw: unknown[]): TenantUserOption[] {
  const byId = new Map<number, TenantUserOption>();
  raw.forEach((row) => { const u = normalizeTenantUser(row); if (u) byId.set(u.id, u); });
  return Array.from(byId.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function tenantRisksOf(rows: Array<Record<string, unknown>>, usersById: Map<number, TenantUserOption>): TenantRiskOption[] {
  const out: TenantRiskOption[] = [];
  for (const row of rows) {
    const id = Number(row?.id);
    const title = String(row?.title || '').trim();
    if (!Number.isFinite(id) || id <= 0 || !title) continue;
    const ownerFromId = Number(row?.owner_id ?? row?.business_owner_id);
    const ownerFromUser = Number.isFinite(ownerFromId) ? usersById.get(ownerFromId)?.displayName : '';
    out.push({
      id, title,
      description: String(row?.description || '').trim(),
      severity: normalizeSeverity(row?.severity ?? row?.risk_level ?? row?.residual_score),
      mitigation: String(row?.treatment_plan ?? row?.mitigation ?? '').trim(),
      ownerName: String(row?.owner_name ?? row?.business_owner_name ?? ownerFromUser ?? '').trim(),
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** The people whose name or email contains what was typed. */
export function matchUsers(users: TenantUserOption[], typed: string): TenantUserOption[] {
  const term = typed.trim().toLowerCase();
  return term ? users.filter((u) => u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)) : users;
}

/** The risks the picker lists: at most 20, filtered by what was typed in their title or description. */
export function matchRisks(risks: TenantRiskOption[], typed: string, max = 20): TenantRiskOption[] {
  const term = typed.trim().toLowerCase();
  return (term ? risks.filter((r) => r.title.toLowerCase().includes(term) || r.description.toLowerCase().includes(term)) : risks).slice(0, max);
}

// ── the record forms of the detail page ────────────────────────────────────────────────────────────────────────────────────────
export type RecordKind = 'milestone' | 'task' | 'team' | 'risk' | 'update' | 'document' | 'budget' | 'compliance' | 'lesson' | 'dependency';
export type RecordForm = Record<string, string>;

/** What each form starts with: the values the old "Add ..." buttons put in `modalForm`. An update starts at the project's own health. */
export function blankForm(kind: RecordKind, health = 'On Track'): RecordForm {
  switch (kind) {
    case 'milestone': return { name: '', description: '', target_date: '', status: 'Pending', completion_percentage: '0', deliverables: '' };
    case 'task': return { title: '', description: '', assignee_name: '', priority: 'Medium', status: 'To Do', due_date: '', progress: '0', dependencies: '' };
    case 'team': return { user_id: '', user_name: '', email: '', role: 'Member', responsibilities: '' };
    case 'risk': return { linked_risk_id: '', title: '', description: '', type: 'Risk', severity: 'Medium', mitigation: '', owner_user_id: '', owner_name: '' };
    case 'update': return { health_status: health, what_was_done: '', whats_planned: '', blockers: '', notes: '' };
    case 'document': return { title: '', description: '', document_type: 'Reference', url: '' };
    case 'budget': return { category: 'Hardware', description: '', amount: '', status: 'Pending', approved_by: '', notes: '', date: '' };
    case 'compliance': return { framework_name: '', control_id: '', control_name: '', coverage_status: 'Planned', requirement_description: '', deliverable: '', notes: '' };
    case 'lesson': return { title: '', description: '', category: 'Recommendation', impact: 'Medium' };
    default: return { dependency_type: 'internal', dependent_project_name: '', external_dependency: '', description: '', status: 'Active', direction: 'depends_on', impact_if_delayed: '', expected_date: '' };
  }
}

/** The day of a stored date ("2026-03-15T00:00:00" -> "2026-03-15"), which is what a date field can show; '' for none. */
export const isoDay = (value: unknown): string => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '');

type Row = Record<string, unknown>;
const text = (v: unknown): string => (v == null ? '' : String(v));

/** An existing budget line, compliance mapping, lesson or dependency in the shape of its form (the old buttons did the same copy, with the day cut for a date field). */
export function formFromItem(kind: 'budget' | 'compliance' | 'lesson' | 'dependency', item: Row): RecordForm {
  if (kind === 'budget') return { category: text(item.category), description: text(item.description), amount: text(item.amount), status: text(item.status), approved_by: text(item.approved_by), notes: text(item.notes), date: isoDay(item.date) };
  if (kind === 'compliance') {
    return { framework_name: text(item.framework_name), control_id: text(item.control_id), control_name: text(item.control_name), coverage_status: text(item.coverage_status), requirement_description: text(item.requirement_description), deliverable: text(item.deliverable), notes: text(item.notes) };
  }
  if (kind === 'lesson') return { title: text(item.title), description: text(item.description), category: text(item.category) || 'Recommendation', impact: text(item.impact) || 'Medium' };
  return {
    dependency_type: text(item.dependency_type), dependent_project_name: text(item.dependent_project_name), external_dependency: text(item.external_dependency), description: text(item.description),
    status: text(item.status), direction: text(item.direction) || 'depends_on', impact_if_delayed: text(item.impact_if_delayed), expected_date: isoDay(item.expected_date),
  };
}

/** One text per line, trimmed, blank lines dropped (deliverables, task dependencies, linked risks, controls and frameworks). */
export const lines = (s: string | null | undefined): string[] => String(s ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

/** A percent box: empty means 0 (as it always did), anything else must be a number from 0 to 100. */
const between0and100 = (s: string): boolean => s.trim() === '' || (Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 100);

/** What stops a form being saved, by field: only what the form itself marks as required, a percent that is not 0 to 100, and a Control ID that is not a whole number
 *  (the server stores it in an integer column: anything else, a blank included, used to answer 500 with nothing on screen). */
export function recordErrors(kind: RecordKind, form: RecordForm): Record<string, string> {
  const e: Record<string, string> = {};
  const need = (key: string, message: string) => { if (!(form[key] ?? '').trim()) e[key] = message; };
  if (kind === 'milestone') { need('name', 'Enter a name'); if (!between0and100(form.completion_percentage ?? '')) e.completion_percentage = 'Enter a number from 0 to 100'; }
  if (kind === 'task') { need('title', 'Enter a title'); if (!between0and100(form.progress ?? '')) e.progress = 'Enter a number from 0 to 100'; }
  if (kind === 'team' && !(form.user_id ?? '')) e.user_id = 'Choose a person';
  if (kind === 'risk') need('title', 'Enter a title');
  if (kind === 'document') need('title', 'Enter a title');
  if (kind === 'budget') need('description', 'Enter a description');
  if (kind === 'lesson') need('title', 'Enter a title');
  if (kind === 'compliance') {
    need('framework_name', 'Enter a framework');
    need('control_name', 'Enter a control name');
    if ((form.control_id ?? '').trim() && !/^\d+$/.test(form.control_id.trim())) e.control_id = 'Enter a whole number, or leave it empty';
  }
  return e;
}

/** What each form sends. Same keys and values as the old save buttons built; the one change is the compliance Control ID: a whole number, or null when empty
 *  (the old form sent "" for an empty box, which the server could not store). */
export function recordPayload(kind: RecordKind, form: RecordForm, users: Map<number, TenantUserOption>): Record<string, unknown> {
  switch (kind) {
    case 'milestone': {
      const { deliverables, ...rest } = form;
      return { ...rest, completion_percentage: parseFloat(form.completion_percentage || '0'), deliverables: lines(deliverables) };
    }
    case 'task': {
      const { dependencies, ...rest } = form;
      return { ...rest, progress: parseFloat(form.progress || '0'), dependencies: lines(dependencies) };
    }
    case 'team': {
      const selected = users.get(Number(form.user_id || 0));
      return { ...form, user_id: selected?.id || Number(form.user_id || 0) || undefined, user_name: selected?.displayName || form.user_name || '', email: selected?.email || form.email || '' };
    }
    case 'risk': {
      const selectedOwner = users.get(Number(form.owner_user_id || 0));
      const { owner_user_id, linked_risk_id, ...rest } = form;
      void owner_user_id; void linked_risk_id;
      return { ...rest, owner_name: selectedOwner?.displayName || form.owner_name || '' };
    }
    case 'budget': return { ...form, amount: parseFloat(form.amount || '0') };
    case 'compliance': return { ...form, control_id: form.control_id.trim() ? Number(form.control_id.trim()) : null };
    default: return { ...form };
  }
}

/** The multipart body of a document added with a file: the file, then the title, description and type when they have words (as before). */
export function documentFields(form: RecordForm): Array<[string, string]> {
  return (['title', 'description', 'document_type'] as const).filter((k) => form[k]).map((k) => [k, String(form[k])]);
}

// ── the project itself: the create form and the edit form ──────────────────────────────────────────────────────────────────────────────
export interface NewProjectForm {
  name: string; description: string; category: string; priority: string;
  project_owner_id: number | null; project_owner_name: string; sponsor_id: number | null; sponsor: string; department: string;
  start_date: string; target_end_date: string; budget_estimated: string; business_justification: string;
}
export const blankProject = (): NewProjectForm => ({
  name: '', description: '', category: 'Other', priority: 'Medium', project_owner_id: null, project_owner_name: '', sponsor_id: null, sponsor: '', department: '',
  start_date: '', target_end_date: '', budget_estimated: '', business_justification: '',
});

export function newProjectErrors(f: NewProjectForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = 'Enter a project name';
  return e;
}

/** What the old "Create Project" button sent: the owner's id only when one was picked (the server makes the creator the owner otherwise). */
export function newProjectPayload(f: NewProjectForm): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: f.name, description: f.description, category: f.category, priority: f.priority, project_owner_name: f.project_owner_name, sponsor: f.sponsor,
    department: f.department, start_date: f.start_date, target_end_date: f.target_end_date, business_justification: f.business_justification,
    budget_estimated: f.budget_estimated ? parseFloat(f.budget_estimated) : 0,
  };
  if (f.project_owner_id) payload.project_owner_id = f.project_owner_id;
  return payload;
}

export interface EditProjectForm {
  name: string; description: string; status: string; health: string; priority: string; category: string; project_owner_name: string; sponsor: string; department: string;
  budget_estimated: string; budget_actual: string; completion_percentage: string; business_justification: string; start_date: string; target_end_date: string;
  linked_risks_text: string; linked_controls_text: string; linked_frameworks_text: string;
}

/** The edit form of a project (what the old Edit button copied into `editForm`; the number boxes start empty for 0, as they did). */
export function editFormOf(p: Row): EditProjectForm {
  const n = (v: unknown): string => (v ? String(v) : '');
  const list = (v: unknown): string => (Array.isArray(v) ? v.join('\n') : '');
  return {
    name: text(p.name), description: text(p.description), status: text(p.status), health: text(p.health), priority: text(p.priority), category: text(p.category),
    project_owner_name: text(p.project_owner_name), sponsor: text(p.sponsor), department: text(p.department),
    budget_estimated: n(p.budget_estimated), budget_actual: n(p.budget_actual), completion_percentage: n(p.completion_percentage), business_justification: text(p.business_justification),
    start_date: text(p.start_date).split('T')[0], target_end_date: text(p.target_end_date).split('T')[0],
    linked_risks_text: list(p.linked_risks), linked_controls_text: list(p.linked_controls), linked_frameworks_text: list(p.linked_frameworks),
  };
}

export function editErrors(f: EditProjectForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = 'Enter a project name';
  if (f.completion_percentage.trim() && !(Number(f.completion_percentage) >= 0 && Number(f.completion_percentage) <= 100)) e.completion_percentage = 'Enter a number from 0 to 100';
  return e;
}

/** What the old "Save Changes" button sent (numbers parsed with `|| 0`, the linked lists split by line, the category sent as it was). */
export function editPayload(f: EditProjectForm): Record<string, unknown> {
  const { linked_risks_text, linked_controls_text, linked_frameworks_text, ...rest } = f;
  return {
    ...rest,
    budget_estimated: parseFloat(f.budget_estimated) || 0,
    budget_actual: parseFloat(f.budget_actual) || 0,
    completion_percentage: parseFloat(f.completion_percentage) || 0,
    linked_risks: lines(linked_risks_text),
    linked_controls: lines(linked_controls_text),
    linked_frameworks: lines(linked_frameworks_text),
  };
}

/** The two forms are the same when every field is. */
export function sameForm<T extends object>(a: T, b: T): boolean {
  return (Object.keys(a) as Array<keyof T>).every((k) => a[k] === b[k]);
}
