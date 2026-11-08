// What the control workspace decides, apart from React so `node --test` pins it (workspaceModel.test.ts): the five tabs and the addresses that open them (every old ?tab= keeps
// working), the sections inside a tab, the ONE next step the header offers, the short facts of a control, the Run tests report, and the words of the Activity feed. Nothing here makes a
// number up: a count is the server's, a status word is lib/statuses/controls.ts, and "overdue" is the work item's `next_test_date` having passed.
import { parseUtc } from '../../../../../../lib/serverTime.ts';

// ── tabs ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const TABS = ['summary', 'testing', 'evidence', 'links', 'activity'] as const;
export type TabKey = (typeof TABS)[number];

export const TAB_LABEL: Record<TabKey, string> = { summary: 'Summary', testing: 'Testing', evidence: 'Evidence', links: 'Links', activity: 'Activity' };

/** The twelve tabs of the old page, and where each one's content is now. `tests`, `assurance`, `evidence` and `links` are linked from the Overview, the audit log, Reports, Connections and the
 *  notifications the server sends, so they must keep opening something that makes sense. */
export const TAB_ALIASES: Readonly<Record<string, TabKey>> = {
  overview: 'summary', fields: 'summary',
  assurance: 'testing', tests: 'testing',
  artifacts: 'evidence',
  risks: 'links', assets: 'links', regulatory: 'links', requirements: 'links',
  history: 'activity',
};

export const TESTING_SECTIONS = ['plan', 'automated', 'procedures', 'results', 'sampling'] as const;
export const EVIDENCE_SECTIONS = ['required', 'linked', 'collected', 'documents'] as const;
export const LINKS_SECTIONS = ['requirements', 'risks', 'assets', 'records', 'regulatory'] as const;
export type TestingSection = (typeof TESTING_SECTIONS)[number];
export type EvidenceSection = (typeof EVIDENCE_SECTIONS)[number];
export type LinksSection = (typeof LINKS_SECTIONS)[number];
export type SectionKey = TestingSection | EvidenceSection | LinksSection;

export const SECTION_LABEL: Record<SectionKey, string> = {
  plan: 'Plan', automated: 'Automated tests', procedures: 'Procedures', results: 'Results', sampling: 'Sampling',
  required: 'Required evidence', linked: 'Linked files', collected: 'Collected automatically', documents: 'Documents to produce',
  requirements: 'Requirements', risks: 'Risks', assets: 'Assets', records: 'Other records', regulatory: 'Regulatory',
};

/** The sections each tab holds, in reading order. */
export const SECTIONS_OF: Record<'testing' | 'evidence' | 'links', readonly SectionKey[]> = {
  testing: TESTING_SECTIONS, evidence: EVIDENCE_SECTIONS, links: LINKS_SECTIONS,
};

/** Where the sections of a tab are open when a person arrives. A link from the Overview ("Run tests", "Decide") or a Connections return opens the work it was about; the plain tab opens what
 *  people read first. A section named in the address (?section=) always wins. */
const OPEN_ON_ARRIVAL: Record<string, readonly SectionKey[]> = {
  tests: ['plan', 'automated'],
  assurance: ['results'],
  testing: ['results', 'plan'],
  artifacts: ['documents'],
  evidence: ['required', 'linked'],
  risks: ['risks'], assets: ['assets'], regulatory: ['regulatory'], requirements: ['requirements'],
  links: ['requirements', 'risks'],
};

/** What a working tab shows open the first time a person reaches it by its tab (not by a link that names the work). */
export const DEFAULT_OPEN: Record<'testing' | 'evidence' | 'links', readonly SectionKey[]> = {
  testing: ['results', 'plan'], evidence: ['required', 'linked'], links: ['requirements', 'risks'],
};

export interface Arrival { tab: TabKey; open: SectionKey[] }

/** The sections open when the page opens: the ones the address asked for in its tab, the defaults in the other tabs. */
export function initialOpen(a: Arrival): SectionKey[] {
  const out: SectionKey[] = [];
  (['testing', 'evidence', 'links'] as const).forEach((t) => out.push(...(a.tab === t && a.open.length ? a.open : DEFAULT_OPEN[t])));
  return out;
}

/** The tab and the open sections an address asks for. `tab` and `section` are the raw ?tab= and ?section= values. */
export function arrival(tab: string | null | undefined, section?: string | null): Arrival {
  const raw = (tab ?? '').trim().toLowerCase();
  const key: TabKey = (TABS as readonly string[]).includes(raw) ? (raw as TabKey) : TAB_ALIASES[raw] ?? 'summary';
  const own = key === 'summary' || key === 'activity' ? [] : SECTIONS_OF[key];
  const named = (section ?? '').trim().toLowerCase();
  if ((own as readonly string[]).includes(named)) return { tab: key, open: [named as SectionKey] };
  const open = OPEN_ON_ARRIVAL[raw] ?? OPEN_ON_ARRIVAL[key] ?? [];
  return { tab: key, open: open.filter((s) => (own as readonly string[]).includes(s)) as SectionKey[] };
}

/** The section an address asks to be scrolled to: one named in ?section=, or the work an old ?tab= was about when that work is not the first thing in its tab (assurance -> Results,
 *  risks -> Risks ...). A plain tab, and a link whose work is at the top (tests -> Plan), stays at the top. */
export function scrollTarget(tab: string | null | undefined, section?: string | null): SectionKey | null {
  const a = arrival(tab, section);
  if (!a.open.length || a.tab === 'summary' || a.tab === 'activity') return null;
  const named = (section ?? '').trim().toLowerCase();
  if (named && a.open[0] === named) return a.open[0];
  const raw = (tab ?? '').trim().toLowerCase();
  return ['assurance', 'artifacts', 'risks', 'assets', 'regulatory', 'requirements'].includes(raw) && a.open[0] !== SECTIONS_OF[a.tab][0] ? a.open[0] : null;
}

/** The address of a tab (and a section) of one control: what the header's next step and the Overview link to. */
export function controlAddress(code: string, tab?: TabKey, section?: SectionKey): string {
  const base = `/automation/soc2-controls/${encodeURIComponent(code)}`;
  const q: string[] = [];
  if (tab && tab !== 'summary') q.push(`tab=${tab}`);
  if (section) q.push(`section=${section}`);
  return q.length ? `${base}?${q.join('&')}` : base;
}

// ── the next step ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What the header offers as the one thing to do next. `go` says where: a tab (and section), or an act the page performs itself. */
export interface NextStep {
  id: 'decide' | 'fix' | 'owner' | 'overdue' | 'evidence' | 'connect' | 'test';
  text: string;
  /** the button's words; null when the person cannot take the step (the sentence still says what is wanted, so they can pass it on) */
  action: string | null;
  go: { tab: TabKey; section?: SectionKey } | { act: 'decide' | 'owner' | 'run' };
}

export interface StepInput {
  overall_status: string;
  checks_count: number;
  applicable: boolean;
  has_owner: boolean;
  pending_request: boolean;
  /** the signed-in person may rule on a pending request (holds the right and did not ask for it) */
  can_decide: boolean;
  can_assign: boolean;
  can_run: boolean;
  test_overdue: boolean;
  tested: boolean;
  evidence_missing: number;
  evidence_failing: number;
}

/** One rule, in this order: a decision waiting for the person, a failing control, no owner, a late test, evidence to add, a source to connect, a first test. Null when nothing needs anyone.
 *  A step the person cannot take is still named (they may pass it on) but never as a button they cannot press: the page draws `action` disabled when the right is missing. */
export function nextStep(i: StepInput): NextStep | null {
  if (i.pending_request && i.can_decide) {
    return { id: 'decide', text: 'Someone asked to change whether this control applies, and is waiting for a decision.', action: 'Decide', go: { act: 'decide' } };
  }
  if (!i.applicable) return null;
  if (i.overall_status === 'failed') {
    return { id: 'fix', text: 'An automated test is failing.', action: i.can_run ? 'Run the tests again' : 'See the tests', go: i.can_run ? { act: 'run' } : { tab: 'testing', section: 'automated' } };
  }
  if (!i.has_owner) {
    return { id: 'owner', text: 'Nobody owns this control yet.', action: i.can_assign ? 'Choose an owner' : null, go: { act: 'owner' } };
  }
  if (i.test_overdue) return { id: 'overdue', text: 'The next test is overdue.', action: 'Record a test', go: { tab: 'testing', section: 'results' } };
  if (i.evidence_failing > 0 || i.evidence_missing > 0) {
    const n = i.evidence_failing + i.evidence_missing;
    return { id: 'evidence', text: `${n} ${n === 1 ? 'piece of required evidence needs' : 'pieces of required evidence need'} attention.`, action: 'Open the evidence', go: { tab: 'evidence', section: 'required' } };
  }
  if (i.overall_status === 'connect_one') {
    return { id: 'connect', text: 'No source is connected, so no test can run by itself.', action: 'Connect a source', go: { tab: 'testing', section: 'automated' } };
  }
  if (!i.tested) return { id: 'test', text: 'This control has not been tested yet.', action: 'Record a test', go: { tab: 'testing', section: 'results' } };
  return null;
}

/** A test is overdue when its due date has passed (date-only or a moment: the viewer's today decides). */
export function testOverdue(nextTestDate: string | null | undefined, now: Date): boolean {
  const at = parseUtc(nextTestDate);
  return !!at && at.getTime() < now.getTime();
}

// ── Run tests ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface RunOutcome { title: string; ok: boolean; error?: string; status?: string }

export interface RunReport { tone: 'success' | 'warning' | 'error'; title: string; message: string }

/** What pressing "Run tests" says: how many ran, how many could not, and why the first could not. One report, never silence (P-4). */
export function runReport(outcomes: readonly RunOutcome[]): RunReport {
  const total = outcomes.length;
  const failedToRun = outcomes.filter((o) => !o.ok);
  const ran = total - failedToRun.length;
  if (total === 0) return { tone: 'warning', title: 'Nothing to run', message: 'No automated test reaches this control yet.' };
  if (ran === 0) {
    return { tone: 'error', title: 'No test could run', message: failedToRun[0].error || 'The tests could not be started. Try again.' };
  }
  const failing = outcomes.filter((o) => o.ok && (o.status === 'failed' || o.status === 'error')).length;
  const words = `${ran} of ${total} ${total === 1 ? 'test' : 'tests'} ran${failing ? `, ${failing} did not pass` : ''}.`;
  if (failedToRun.length > 0) {
    const first = failedToRun[0];
    return { tone: 'warning', title: `${failedToRun.length} ${failedToRun.length === 1 ? 'test' : 'tests'} could not run`, message: `${words} ${first.title ? `${first.title}: ` : ''}${first.error || 'it could not be started.'}` };
  }
  return { tone: 'success', title: 'Tests run', message: words };
}

// ── Activity ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface HistoryEvent { id?: number; action?: string | null; summary?: string | null; actor_name?: string | null; created_at?: string | null }

/** "procedure_update" -> "Procedure update": the fallback when the server wrote no sentence. */
export function actionWords(action: string | null | undefined): string {
  const t = String(action ?? '').replace(/[_\s-]+/g, ' ').trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : 'A change';
}

export interface FeedRow { key: string; what: string; who: string; at: string | null }

/** The feed, newest first (the server sends it so; a stable sort keeps ties as they came), each row a sentence, a person and a time. Never "User 12": a person with no name is "Someone". */
export function feedOf(events: readonly HistoryEvent[], limit?: number): FeedRow[] {
  const rows = events.map((e, i) => ({
    key: `${e.id ?? 'e'}-${i}`,
    what: (e.summary || '').trim() || actionWords(e.action),
    who: (e.actor_name || '').trim() || 'Someone',
    at: e.created_at ?? null,
    t: parseUtc(e.created_at)?.getTime() ?? 0,
    i,
  }));
  rows.sort((a, b) => b.t - a.t || a.i - b.i);
  return rows.slice(0, limit ?? rows.length).map(({ key, what, who, at }) => ({ key, what, who, at }));
}

/** The server cuts the feed at 100 rows and says nothing; the page says so when it is full. */
export const HISTORY_CAP = 100;
export const feedIsCut = (events: readonly unknown[]): boolean => events.length >= HISTORY_CAP;

// ── small facts ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** "Level 3 · Well defined" or null when the control has not been rated. */
export const MATURITY_NAMES = ['Not performed', 'Performed informally', 'Planned and tracked', 'Well defined', 'Quantitatively controlled', 'Continuously improving'] as const;
export const levelWords = (n: number | null | undefined): string | null => (n == null || n < 0 || n > 5 ? null : `Level ${n} · ${MATURITY_NAMES[n]}`);

/** How far a control is from its target maturity, in a sentence; null when it has not been rated. */
export function maturityGap(actual: number | null | undefined, target: number): string | null {
  if (actual == null) return null;
  if (actual >= target) return 'At or above the target.';
  const gap = target - actual;
  return `${gap} ${gap === 1 ? 'level' : 'levels'} below the target.`;
}

/** The suggestion a signed-off test supports on SCF's scale (satisfactory testing is the Level 3 bar). */
const FROM_DESIGNATION: Readonly<Record<string, number>> = { satisfactory: 3, alternative_control: 3, partial: 2, deficient: 1 };
export const suggestedLevel = (designation: string | null | undefined): number | null =>
  designation != null && Object.prototype.hasOwnProperty.call(FROM_DESIGNATION, designation) ? FROM_DESIGNATION[designation] : null;

/** The requirement codes of a framework in reading order: 6.3.2 before 11.2. */
export const byCode = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

/** "SOC 2 (4), ISO 27001 (12)": a count per framework, for a short line. */
export function groupCounts(groups: ReadonlyArray<{ label: string; count: number }>, shown = 3): string {
  const head = groups.slice(0, shown).map((g) => `${g.label} (${g.count})`).join(', ');
  return groups.length > shown ? `${head} and ${groups.length - shown} more` : head;
}
