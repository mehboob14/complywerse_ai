// What the Controls Automation Overview decides, apart from React so `node --test` pins it (overviewModel.test.ts): the counters of the band (each opens the explorer on exactly what it counts), the
// person's own prioritised work built from what exists (their controls, N/A reviews waiting on them, artifacts to write), the posture bar, the framework bars, the sources, the setup journey and
// the trend. No number is redefined (audit G10 section 5): "Automated checks" is `controls_with_checks`, the posture bar's total is the library's control count, a framework bar is
// `pct(requirements, requirement_total || requirements)`, an overdue test is the work item's next test date having passed. A number whose source failed is a state of its own, never 0.
import { CONTROL_STATUS_ORDER, controlStatus } from '../../../../../lib/statuses/controls.ts';
import type { Tone } from '../../../../../lib/status.ts';
import { explorerHref } from '../../soc2-controls/_explorer/controlsAddress.ts';
import { isMine, testOverdue, type ControlRow } from '../../soc2-controls/_explorer/controlsModel.ts';

// ── the payload (GET /automation/common/overview), the fields this page reads ────────────────────────────────────────────

export interface DomainRow { domain: string; identifier: string | null; controls: number; material: number; with_checks: number; with_evidence: number; frameworks: number; tracked: number; implemented: number; objectives: number }
export interface FrameworkRow { key: string; label: string; controls: number; requirements: number; requirement_total: number | null; counts: Record<string, number>; inferred: number; inferred_pct: number }
export interface ConnectorCategory {
  category: string; connected: boolean; connected_providers: { provider: string; label: string }[]; providers: { provider: string; label: string; connected: boolean; bindings: number }[];
  controls_reachable: number; controls_waiting: number;
}
export interface CollectionRow {
  plugin_key: string; title: string | null; provider: string | null; state: 'healthy' | 'stale' | 'failing' | 'never_run'; last_success_at: string | null; days_since_success: number | null;
  last_attempt_at: string | null; error: string | null; controls_affected: number;
}
export interface Overview {
  release: string;
  scope_status?: string;
  scope?: { frameworks?: { key: string; label: string }[]; applicable_count?: number; total_count?: number };
  library: { controls: number; domains: number; material: number; orphans: number; objectives: number; custom?: number; by_domain: DomainRow[] };
  automation: { controls_with_checks: number; checks_bound: number; plugins_enabled: number; plugins_run: number; last_run_at: string | null; posture: Record<string, number> };
  connector_categories: ConnectorCategory[];
  collection: { connectors: CollectionRow[]; counts: Record<string, number>; stale_after_days: number };
  frameworks: FrameworkRow[];
  crosswalk: { rows: number; by_match_mode: Record<string, number>; reviewed: number };
  evidence: { controls_with_set: number; artifacts: number; by_method: Record<string, number>; top_owners: { owner: string; artifacts: number }[] };
  assurance: {
    tracked: number; assigned: number; implemented: number; tested: number; effective: number; partially_effective: number; ineffective: number; overdue: number; evidence_pending: number; source: string;
  };
  trend: { date: string; tested: number; effective: number; assigned: number; overdue: number }[];
}

/** GET /scf/my-work: the controls a person owns or is assigned, the N/A reviews waiting on them, overdue re-attestations and the artifacts they have to write. */
export interface MyWorkItem { scf_id?: string; name?: string | null; reason?: string | null; next_due_at?: string | null; control_ref?: string | null; id?: number; status?: string | null; framework_key?: string | null }
export interface MyWork { controls: MyWorkItem[]; na_reviews: MyWorkItem[]; overdue: MyWorkItem[]; artifacts: MyWorkItem[] }

export const pct = (a: number, b: number): number => (b ? Math.round((a / b) * 100) : 0);

// ── the counters ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CounterDef { key: string; label: string; href: string; tone: Tone }

/** The band, in the order the person should look: what is wrong now, then what is late, then what has nobody, then the queues. Each opens what it counts. */
export const COUNTERS: readonly CounterDef[] = [
  { key: 'failed', label: 'Failing', href: explorerHref({ quick: 'failing' }), tone: 'danger' },
  { key: 'expired', label: 'Expired', href: explorerHref({ status: ['expired'] }), tone: 'warning' },
  { key: 'collection_failed', label: 'Not collected', href: explorerHref({ status: ['collection_failed'] }), tone: 'warning' },
  { key: 'overdue', label: 'Tests overdue', href: explorerHref({ quick: 'overdue' }), tone: 'warning' },
  { key: 'unowned', label: 'Needs an owner', href: explorerHref({ quick: 'unowned' }), tone: 'warning' },
  { key: 'reviews', label: 'Mapping reviews', href: '/automation/soc2-controls/review', tone: 'neutral' },
  { key: 'sources', label: 'Sources failing', href: '/admin/evidence-collectors?show=failing', tone: 'danger' },
];

export type CounterState = 'ready' | 'loading' | 'error' | 'none';
export interface CounterView { state: CounterState; value?: number }

/** A count over the controls of the list: loading while it loads, an error when it failed (never 0), else the number. */
export function listCounter(rows: readonly ControlRow[] | undefined, loading: boolean, failed: boolean, now: Date, key: string): CounterView {
  if (failed) return { state: 'error' };
  if (loading || !rows) return { state: 'loading' };
  const n = rows.reduce((c, r) => c + (
    key === 'overdue' ? (testOverdue(r, now) ? 1 : 0)
      : key === 'unowned' ? (r.ownership_status === 'unowned' ? 1 : 0)
        : (r.overall_status === key ? 1 : 0)), 0);
  return { state: 'ready', value: n };
}

export function plainCounter(value: number | undefined | null, loading: boolean, failed: boolean): CounterView {
  if (failed) return { state: 'error' };
  if (loading) return { state: 'loading' };
  return typeof value === 'number' ? { state: 'ready', value } : { state: 'none' };
}

// ── the person's own work ────────────────────────────────────────────────────────────────────────────────────────────────

export interface WorkItem {
  key: string;
  kind: { label: string; tone: Tone };
  title: string;
  context: string;
  href: string;
  action: { label: string; href: string };
  /** naive UTC from the server; null: no date */
  due: string | null;
  overdue: boolean;
}

export const controlHref = (code: string, tab?: string): string => `/automation/soc2-controls/${encodeURIComponent(code)}${tab ? `?tab=${tab}` : ''}`;
const named = (code: string, name?: string | null): string => (name ? `${code} · ${name}` : code);

/** Everything that waits for the person, most urgent first: a decision somebody is waiting for, a control of theirs that fails, a test or a review that is late, a result that is expired or could not be collected,
 *  then the artifacts they have to write. One row a control, its reasons in the context line. */
export function buildWork(s: { me: number | null; now: Date; rows: readonly ControlRow[]; myWork: MyWork | undefined }): WorkItem[] {
  const out: { rank: number; item: WorkItem }[] = [];
  (s.myWork?.na_reviews ?? []).forEach((r) => {
    if (!r.scf_id) return;
    out.push({
      rank: 0,
      item: {
        key: `na-${r.scf_id}`, kind: { label: 'To decide', tone: 'pending' }, title: named(r.scf_id, r.name), context: `Asked to mark it not applicable${r.reason ? `: ${r.reason}` : ''}`, href: controlHref(r.scf_id, 'tests'),
        action: { label: 'Decide', href: controlHref(r.scf_id, 'tests') }, due: null, overdue: false,
      },
    });
  });
  s.rows.filter((r) => isMine(r, s.me)).forEach((r) => {
    const reasons: string[] = [];
    let rank = 9;
    if (r.overall_status === 'failed') { reasons.push('Failing checks'); rank = Math.min(rank, 1); }
    const late = testOverdue(r, s.now);
    if (late) { reasons.push('Test overdue'); rank = Math.min(rank, 2); }
    if (r.ownership_status === 'overdue') { reasons.push('Your review date has passed'); rank = Math.min(rank, 2); }
    if (r.overall_status === 'expired') { reasons.push('Result expired'); rank = Math.min(rank, 3); }
    if (r.overall_status === 'collection_failed') { reasons.push('Not collected'); rank = Math.min(rank, 3); }
    if (reasons.length === 0) return;
    const failing = r.overall_status === 'failed';
    out.push({
      rank,
      item: {
        key: `control-${r.control_id}`,
        kind: failing ? { label: 'Failing', tone: 'danger' } : late || r.ownership_status === 'overdue' ? { label: 'Overdue', tone: 'danger' } : { label: 'Needs a look', tone: 'warning' },
        title: named(r.control_id, r.title), context: reasons.join(' · '), href: controlHref(r.control_id), action: { label: failing ? 'Open' : late ? 'Test' : 'Open', href: controlHref(r.control_id, failing || late ? 'tests' : undefined) },
        // a date is shown only when it is the reason the row is here: a failing control with a test due next year has no date to read
        due: late ? r.next_test_date ?? null : r.ownership_status === 'overdue' ? r.next_due_at ?? null : null, overdue: late || r.ownership_status === 'overdue',
      },
    });
  });
  (s.myWork?.artifacts ?? []).forEach((a) => {
    const code = String(a.scf_id || a.control_ref || '');
    if (!code) return;
    out.push({
      rank: 5,
      item: {
        key: `artifact-${a.id ?? code}-${a.name ?? ''}`, kind: { label: 'Evidence', tone: 'progress' }, title: a.name || code, context: `For ${code}${a.status ? ` · ${String(a.status).replace(/_/g, ' ')}` : ''}`, href: controlHref(code, 'evidence'),
        action: { label: 'Open', href: controlHref(code, 'evidence') }, due: null, overdue: false,
      },
    });
  });
  return out.map((x, i) => ({ ...x, i })).sort((a, b) => a.rank - b.rank || a.item.title.localeCompare(b.item.title, undefined, { numeric: true }) || a.i - b.i).map((x) => x.item);
}

// ── the posture bar ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PostureSlice { key: string; label: string; value: number; tone: Tone; href: string }

/** The posture object as slices in the order of CONTROL_STATUS_ORDER (what needs a person first); a word the model does not know keeps its own label after them. The bar's total is the library's control count. */
export function postureSlices(posture: Record<string, number>): PostureSlice[] {
  const known = (CONTROL_STATUS_ORDER as readonly string[]).filter((k) => (posture[k] ?? 0) > 0);
  const unknown = Object.keys(posture).filter((k) => !(CONTROL_STATUS_ORDER as readonly string[]).includes(k) && posture[k] > 0);
  return known.concat(unknown).map((k) => ({ key: k, label: controlStatus.label(k), value: posture[k], tone: controlStatus.tone(k), href: explorerHref({ status: [k] }) }));
}

// ── frameworks, sources, evidence, implementation, trend ────────────────────────────────────────────────────────────────

export interface FrameworkBar { key: string; label: string; controls: number; requirements: number; total: number; mappedPct: number; accountedPct: number }

/** The formula the page has always used: green is `requirements / (requirement_total || requirements)`, grey is the requirements accounted for but not mappable (other party + out of scope). */
export function frameworkBars(rows: readonly FrameworkRow[]): FrameworkBar[] {
  return rows.map((f) => {
    const total = f.requirement_total || f.requirements;
    return { key: f.key, label: f.label, controls: f.controls, requirements: f.requirements, total, mappedPct: pct(f.requirements, total), accountedPct: pct((f.counts?.other_party || 0) + (f.counts?.out_of_scope || 0), total) };
  });
}

export const CATEGORY_LABEL: Record<string, string> = {
  scm: 'Source control', identity: 'Identity provider', cloud: 'Cloud', observability: 'Observability', security: 'Security tooling', productivity: 'Work management', comms: 'Communications',
  email: 'Email', incident: 'Incident response', hr: 'HR system', mdm: 'Device management', itsm: 'IT service management', crm: 'CRM', data: 'Data platform', payments: 'Payments', ai: 'AI platform', other: 'Other',
};

/** Which connector category to connect next, ranked by the controls waiting on it (a tenant needs any ONE source per category, not every source): unconnected first, the most waiting first. */
export function rankedCategories(cats: readonly ConnectorCategory[]): ConnectorCategory[] {
  return cats.slice().sort((a, b) => Number(a.connected) - Number(b.connected) || b.controls_waiting - a.controls_waiting || b.controls_reachable - a.controls_reachable || a.category.localeCompare(b.category));
}

/** The collectors that need a look: failing first, then stale; the healthy ones are only counted. */
export function collectorsToWatch(rows: readonly CollectionRow[]): CollectionRow[] {
  const order: Record<string, number> = { failing: 0, stale: 1, healthy: 2, never_run: 3 };
  return rows.filter((r) => r.state === 'failing' || r.state === 'stale').sort((a, b) => order[a.state] - order[b.state] || b.controls_affected - a.controls_affected);
}

/** The latest `n` snapshots (the server returns up to 30, oldest first) and how many are not shown. */
export function latestTrend<T>(trend: readonly T[], n = 8): { shown: T[]; hidden: number } {
  const shown = trend.slice(-n);
  return { shown, hidden: trend.length - shown.length };
}

// ── the setup journey (the empty state of the cockpit) ──────────────────────────────────────────────────────────────────

export interface SetupStep { key: string; label: string; done: boolean; href: string; action: string }

/** Four things a tenant does once: choose frameworks, give controls owners, connect a source, run the first tests. Where a step is done is read from what exists, not from a flag. */
export function setupSteps(o: { frameworksChosen: boolean; owned: number | null; sourcesConnected: number; checksRun: number }): SetupStep[] {
  return [
    { key: 'scope', label: 'Choose your frameworks', done: o.frameworksChosen, href: '/automation/soc2-controls?configure=scope', action: 'Configure scope' },
    { key: 'owners', label: 'Give controls an owner', done: (o.owned ?? 0) > 0, href: '/automation/soc2-controls?quick=unowned', action: 'Assign owners' },
    { key: 'source', label: 'Connect a source', done: o.sourcesConnected > 0, href: '/admin/evidence-collectors', action: 'Connect' },
    { key: 'tests', label: 'Run the first tests', done: o.checksRun > 0, href: '/admin/evidence-collectors?show=active', action: 'Run tests' },
  ];
}

/** The setup card is drawn while something of it is open AND no source is connected (a tenant that connected one has begun; a tenant of manual controls only is not nagged for the rest). */
export const showSetup = (steps: readonly SetupStep[]): boolean => steps.some((s) => !s.done) && !steps.find((s) => s.key === 'source')?.done;
