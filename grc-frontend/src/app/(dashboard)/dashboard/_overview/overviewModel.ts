// The Performance Overview's rules, without React, so `node --test` checks them (overviewModel.test.ts): the nine module definitions (which request answers
// each, who sees it, and how its answer becomes a card: MOVED VERBATIM from the old MainModuleCards.tsx and pinned against a frozen copy of the old code),
// where a request stands, what a card, a tile and the "where to act first" list show for each of those states, and the words that stand in for a chart.
// The page only draws what this decides. Nothing here computes a score: every score, band and target comes from the server's scorecards; the page's own
// arithmetic is what it always was (the mean of the module scores, the posture thresholds 70 / 50, the sum of the three overdue counts).
import { canRetry, statusOf } from '../../../../components/ui/ds/reportOutcome.ts';
import { SCORECARD_QUERY_KEYS } from '../../../../components/dashboard/scorecard-query-keys.ts';
import { formatCount } from '../../../../lib/format.ts';
import type { Tone } from '../../../../lib/status.ts';

// ── where a request stands ───────────────────────────────────────────────────
export type Load = 'loading' | 'error' | 'ready';

/** Where a request stands, from what React Query reports. An earlier answer still stands when a refresh fails. `null` is no answer: the module pages ask for
 *  the same scorecards under the same keys and some of them store null there when their own request failed (the old dashboard did too), and a stored null
 *  must never be read as "no data". */
export function loadOf(q: { status: 'pending' | 'error' | 'success'; data?: unknown }): Load {
  if (q.data === null) return 'error';
  if (q.status === 'success' || q.data !== undefined) return 'ready';
  return q.status === 'error' ? 'error' : 'loading';
}

/** React Query's retry for the page's requests: a refusal (invalid, not allowed, not found) is final and is said at once, the rest is tried once more.
 *  (They used to be swallowed into null, so nothing was ever retried and nothing was ever said.) */
export const retryDashboard = (failures: number, error: unknown): boolean => canRetry(error) && failures < 1;

/** A request that has not answered after this long says so (the client's own timeout is 15 minutes, so without a word a hung card is a blank one). */
export const SLOW_MS = 8000;

/** The server refused the request (not signed in, or not allowed): no Retry, and the card says "no access", not "couldn't load". */
export const isRefusal = (error: unknown): boolean => { const status = statusOf(error); return status === 401 || status === 403; };

// ── the nine modules ─────────────────────────────────────────────────────────
export type Sub = { label: string; score?: number | null };
export type Seg = { label: string; value: number; key?: string };
export type Viz = 'radar' | 'bars' | 'donut';

/** What a donut says: its caption, what a segment is (the table's first column) and what the module's total counts. */
export interface ChartInfo { title: string; by: string; unit: string }

export interface Card {
  score: number | null;
  /** the section scores, weakest first (the module's own cut: six for the scorecards, all the categories for Assessments) */
  subs: Sub[];
  /** how many section scores the module has, before any cut */
  subsTotal: number;
  segs?: Seg[];
  total?: number;
  note?: string | null;
  /** how serious the note is: danger for something overdue or critical, warning for something to look at, neutral for a count */
  noteTone?: Tone;
  pastSla?: number;
  hasData?: boolean;
  chart?: ChartInfo;
}

export interface ModuleDef {
  key: string;
  label: string;
  href: string;
  viz: Viz;
  /** the request that answers it (GET, relative to the API base) */
  path: string;
  /** shared with the module's own page: the same key is the same cached answer */
  queryKey?: readonly unknown[];
  /** any one of these opens the module (an administrator sees all); none listed: everyone */
  requiredPermissions?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: (d: any) => Card;
}

const r0 = (v: number) => Math.round(v);

/** The segments of a count-by-name answer: the names with something in them, the biggest first, at most `max`. */
export const dictSegs = (obj?: Record<string, number> | null, max = 5): Seg[] => {
  if (!obj) return [];
  return Object.entries(obj)
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([label, value]) => ({ label: label.replace(/_/g, ' '), value }));
};

/** Every section score of a scorecard (its performance components, else its sections), the weakest first; a section with no score sorts last. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sectionAll = (d: any): Sub[] => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comps: any[] = d?.performance?.components ?? Object.values(d?.sections ?? {});
  return (comps || [])
    .filter((c) => c && c.label)
    .map((c) => ({ label: c.label as string, score: (c.score ?? null) as number | null }))
    .sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
};

/** The six weakest (the module's own cut: it was always six). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sectionSubs = (d: any): Sub[] => sectionAll(d).slice(0, 6);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const MODULES: ModuleDef[] = [
  {
    key: 'governance', label: 'Governance', href: '/governance', viz: 'radar',
    path: '/governance/dashboard/documents-overview',
    queryKey: SCORECARD_QUERY_KEYS.governance,
    requiredPermissions: ['governance:policies:*'],
    map: (d) => { const all = sectionAll(d); return { score: d?.performance?.score ?? null, subs: all.slice(0, 6), subsTotal: all.length, hasData: d?.performance?.score != null }; },
  },
  {
    key: 'compliance', label: 'Compliance', href: '/compliance', viz: 'bars',
    path: '/compliance/policies/dashboard/sections-overview',
    queryKey: SCORECARD_QUERY_KEYS.compliance,
    requiredPermissions: ['compliance:frameworks:*', 'controls:control_library:*'],
    map: (d) => { const all = sectionAll(d); return { score: d?.performance?.score ?? null, subs: all.slice(0, 6), subsTotal: all.length, hasData: d?.performance?.score != null }; },
  },
  {
    key: 'assessments', label: 'Assessments', href: '/assessments', viz: 'bars',
    path: '/compliance/assessments/overview',
    queryKey: SCORECARD_QUERY_KEYS.assessments,
    requiredPermissions: ['compliance:assessments:*'],
    map: (d) => {
      const subs: Sub[] = (d?.categories ?? []).map((c: { category: string; score: number | null }) => ({ label: c.category, score: c.score })).sort((a: Sub, b: Sub) => (a.score ?? 999) - (b.score ?? 999));
      return {
        score: d?.performance?.score ?? null,
        subs,
        subsTotal: subs.length,
        pastSla: d?.attention?.overdue_gaps ?? 0,
        hasData: d?.performance?.score != null || (d?.categories?.length ?? 0) > 0,
      };
    },
  },
  {
    key: 'assets', label: 'Assets', href: '/assets', viz: 'radar',
    path: '/assets/inventory-overview',
    queryKey: SCORECARD_QUERY_KEYS.assets,
    requiredPermissions: ['assets:asset_inventory:*'],
    map: (d) => { const all = sectionAll(d); return { score: d?.performance?.score ?? null, subs: all.slice(0, 6), subsTotal: all.length, hasData: d?.performance?.score != null }; },
  },
  {
    key: 'issues', label: 'Issues & Incidents', href: '/issues', viz: 'bars',
    path: '/issue-management/dashboard/sections-overview',
    queryKey: SCORECARD_QUERY_KEYS.issues,
    requiredPermissions: ['issue_management:issues:*', 'erm:incidents:*'],
    map: (d) => {
      const all = sectionAll(d);
      const subs = all.slice(0, 6);
      const issueTotal = d?.sections?.issues?.counts?.total ?? 0;
      const incidentTotal = d?.sections?.incidents?.counts?.total ?? 0;
      const hasSectionScores = subs.some((s) => s.score != null);
      const hasRecords = issueTotal > 0 || incidentTotal > 0;
      const critical = (d?.attention_queue?.open_critical_incidents ?? 0) > 0;
      return {
        score: d?.performance?.score ?? null,
        subs,
        subsTotal: all.length,
        pastSla: d?.attention_queue?.sla_breached_issues ?? 0,
        note: critical
          ? plural(d.attention_queue.open_critical_incidents, 'critical incident')
          : hasRecords && d?.performance?.score == null
            ? `${plural(issueTotal, 'issue')} · ${plural(incidentTotal, 'incident')}`
            : null,
        noteTone: critical ? 'danger' : 'neutral',
        hasData: d?.performance?.score != null || hasSectionScores || hasRecords,
        segs: hasRecords && !hasSectionScores
          ? [
              ...(issueTotal > 0 ? [{ label: 'Issues', value: issueTotal }] : []),
              ...(incidentTotal > 0 ? [{ label: 'Incidents', value: incidentTotal }] : []),
            ]
          : undefined,
        total: issueTotal + incidentTotal,
        chart: { title: 'Issues and incidents', by: 'Kind', unit: 'records' },
      };
    },
  },
  {
    key: 'assurance', label: 'Control Testing & Assurance', href: '/control-library/assurance', viz: 'bars',
    path: '/control-library/assurance/sections-overview',
    queryKey: SCORECARD_QUERY_KEYS.assurance,
    requiredPermissions: ['controls:control_library:*'],
    map: (d) => {
      const all = sectionAll(d);
      const subs = all.slice(0, 6);
      const aq = d?.attention_queue ?? {};
      const active = d?.sections?.coverage?.counts?.active ?? 0;
      const overdue = aq.overdue_control_tests ?? 0;
      const untested = aq.controls_untested ?? 0;
      return {
        score: d?.performance?.score ?? null,
        subs,
        subsTotal: all.length,
        pastSla: overdue,
        note: overdue > 0
          ? `${overdue} overdue test${overdue === 1 ? '' : 's'}`
          : untested > 0
            ? `${untested} untested control${untested === 1 ? '' : 's'}`
            : active > 0
              ? `${active} active control${active === 1 ? '' : 's'}`
              : null,
        noteTone: overdue > 0 ? 'danger' : untested > 0 ? 'warning' : 'neutral',
        hasData: d?.performance?.score != null || active > 0 || subs.some((s) => s.score != null),
      };
    },
  },
  {
    key: 'frameworks', label: 'Frameworks', href: '/frameworks/manage', viz: 'donut',
    path: '/compliance/policies/dashboard/frameworks-aggregate',
    requiredPermissions: ['compliance:frameworks:*'],
    map: (d) => {
      const journeys = d?.by_framework ?? [];
      const segs: Seg[] = (d?.status_mix ?? []).map((s: { name: string; value: number; key?: string }) => ({ label: s.name, value: s.value, key: s.key }));
      const names = journeys
        .map((j: { framework_name?: string; name?: string }) => j.framework_name || j.name)
        .filter(Boolean)
        .slice(0, 2);
      return {
        score: null,
        subs: [],
        subsTotal: 0,
        segs,
        total: journeys.length,
        note: journeys.length
          ? names.length
            ? `${journeys.length} journeys · ${names.join(', ')}${journeys.length > names.length ? '…' : ''}`
            : `${journeys.length} certification journeys`
          : null,
        noteTone: 'neutral',
        hasData: journeys.length > 0,
        chart: { title: 'Controls by status, all journeys', by: 'Status', unit: 'certification journeys' },
      };
    },
  },
  {
    key: 'vendor-risk', label: 'Third-Party Vendor Risk', href: '/vendor-risk', viz: 'donut',
    path: '/vendor-risk/vendors/dashboard',
    requiredPermissions: ['erm:risks:*'],
    map: (d) => {
      const segs = dictSegs(d?.by_tier ?? d?.by_status);
      const expiring = d?.expiring_contracts?.length ?? 0;
      const incidents = (d?.open_incidents ?? 0) > 0;
      return {
        score: null,
        subs: [],
        subsTotal: 0,
        segs,
        total: d?.total_vendors ?? 0,
        note: incidents
          ? plural(d.open_incidents, 'open incident')
          : expiring > 0
            ? `${expiring} contract${expiring === 1 ? '' : 's'} expiring`
            : null,
        noteTone: incidents ? 'danger' : 'warning',
        hasData: (d?.total_vendors ?? 0) > 0,
        chart: d?.by_tier != null ? { title: 'Vendors by tier', by: 'Tier', unit: 'vendors' } : { title: 'Vendors by status', by: 'Status', unit: 'vendors' },
      };
    },
  },
  {
    key: 'bcm', label: 'Business Continuity', href: '/bcm', viz: 'donut',
    path: '/bcm/dashboard',
    requiredPermissions: ['bcm:dashboard:*', 'bcm:plans:*'],
    map: (d) => {
      const overdue = (d?.totals?.overdue_drills ?? 0) > 0;
      return {
        score: null,
        subs: [],
        subsTotal: 0,
        segs: dictSegs(d?.plans_by_status ?? d?.drills_by_status),
        total: d?.totals?.plans ?? 0,
        note: overdue
          ? `${d.totals.overdue_drills} overdue drill${d.totals.overdue_drills === 1 ? '' : 's'}`
          : (d?.totals?.active_plans ?? 0) > 0
            ? `${d.totals.active_plans} active plan${d.totals.active_plans === 1 ? '' : 's'}`
            : null,
        noteTone: overdue ? 'danger' : 'neutral',
        hasData: (d?.totals?.plans ?? 0) > 0 || (d?.totals?.drills ?? 0) > 0,
        chart: { title: d?.plans_by_status != null ? 'Plans by status' : 'Drills by status', by: 'Status', unit: 'plans' },
      };
    },
  },
];

export const MODULE_BY_KEY: Record<string, ModuleDef> = Object.fromEntries(MODULES.map((m) => [m.key, m]));

/** The request behind the Risk Posture tile (the ERM scorecard); the same key the Risk Management overview reads. */
export const RISK_PATH = '/erm/dashboard/sections-overview';
export const RISK_QUERY_KEY = SCORECARD_QUERY_KEYS.erm;
export const RISK_PERMISSIONS = ['erm:risks:*'];

/** The modules a person is shown: an administrator all of them, anyone else those whose rights they hold (a module that lists none is everyone's). */
export function visibleModules(isAdmin: boolean, hasAnyPermission: (permissions: string[]) => boolean): ModuleDef[] {
  return MODULES.filter((m) => {
    if (isAdmin) return true;
    if (!m.requiredPermissions?.length) return true;
    return hasAnyPermission(m.requiredPermissions);
  });
}

// ── a module's card ──────────────────────────────────────────────────────────
export type CardState = 'loading' | 'error' | 'denied' | 'ready';

export interface Feed { load: Load; data?: unknown; error?: unknown }

export interface ModuleView {
  def: ModuleDef;
  state: CardState;
  card: Card | null;
  /** the card has a score or section scores (a ring and rows), as against a count snapshot */
  scored: boolean;
  error?: unknown;
}

/** A card has a score of its own, or at least one section with one. */
export const isScored = (c: Card): boolean => c.score != null || (c.subs?.length > 0 && c.subs.some((s) => s.score != null));

/** The module's card from its answer; null when the answer cannot be read (a shape the rules do not know): the card then says it could not load. */
function cardOf(def: ModuleDef, data: unknown): Card | null {
  try {
    const card = def.map(data);
    return card && typeof card === 'object' ? card : null;
  } catch {
    return null;
  }
}

/** What one module's card is: waiting, failed, refused, or its answer read by the module's rules. A failure is never read as "no data". */
export function viewOf(def: ModuleDef, feed: Feed): ModuleView {
  if (feed.load === 'loading') return { def, state: 'loading', card: null, scored: false };
  if (feed.load === 'error') return { def, state: isRefusal(feed.error) ? 'denied' : 'error', card: null, scored: false, error: feed.error };
  const card = cardOf(def, feed.data);
  if (!card) return { def, state: 'error', card: null, scored: false, error: new Error('The answer was not in the shape this page reads.') };
  return { def, state: 'ready', card, scored: isScored(card) };
}

/** The six rows a scored card lists: the weakest sections first, and what the module has beyond them. */
export function cardRows(card: Card, max = 6): { rows: Sub[]; total: number } {
  const rows = card.subs.slice(0, max);
  return { rows, total: Math.max(card.subsTotal, card.subs.length) };
}

/** "Showing the 6 weakest of 10 sections" when the card lists fewer than the module has; '' when it lists them all. */
export function cutText(shown: number, total: number): string {
  return total > shown ? `Showing the ${shown} weakest of ${total} sections` : '';
}

/** A section score as the card prints it: "58%", or "No data" where the module has none (it was drawn as 0). */
export const scoreText = (score: number | null | undefined): string => (typeof score === 'number' && Number.isFinite(score) ? `${r0(score)}%` : 'No data');

/** The ring in words, for a screen reader. */
export function ringLabel(label: string, score: number | null, band: string): string {
  return score == null ? `${label}: no score yet.` : `${label} score ${r0(score)} out of 100, ${band}.`;
}

// ── the donut and its legend ─────────────────────────────────────────────────
export interface Slice { label: string; value: number; key?: string; /** a whole-number share of the donut, which adds to 100 */ share: number }

/** The legend of a donut: each segment with its share of the whole (the largest remainder rounds the shares so they add to 100). */
export function slices(segs: readonly Seg[] | undefined): Slice[] {
  const list = (segs ?? []).filter((s) => typeof s.value === 'number' && Number.isFinite(s.value) && s.value > 0);
  const total = list.reduce((n, s) => n + s.value, 0);
  if (total <= 0) return [];
  const raw = list.map((s) => (s.value / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((n, v) => n + v, 0);
  const order = raw.map((v, i) => ({ i, rest: v - Math.floor(v) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) { if (left <= 0) break; floors[i]++; left--; }
  return list.map((s, i) => ({ label: s.label, value: s.value, key: s.key, share: floors[i] }));
}

/** A legend row's figures: how many, and what share of the whole ("56 · 33%"). */
export const sliceText = (s: Slice): string => `${formatCount(s.value)} · ${s.share}%`;

/** The donut's numbers as the table a screen reader reads in its place. */
export function sliceTable(list: readonly Slice[], first: string): { columns: string[]; rows: Array<Array<string | number>> } {
  return { columns: [first, 'Count', 'Share'], rows: list.map((s) => [s.label, s.value, `${s.share}%`]) };
}

// ── the tiles ────────────────────────────────────────────────────────────────
/** The Risk Posture tile's word from the ERM risk score: 70 and above is low, 50 and above moderate, else elevated; null with no score. */
export function posture(riskScore: number | null | undefined): 'Low' | 'Moderate' | 'Elevated' | null {
  if (riskScore == null) return null;
  if (riskScore >= 70) return 'Low';
  if (riskScore >= 50) return 'Moderate';
  return 'Elevated';
}

/** The mean of the module scores, rounded; null when no module has a score yet. `scored` is how many scores went into it. */
export interface Readiness { overall: number | null; scored: number }

export function readiness(views: readonly ModuleView[]): Readiness {
  const scores = views.filter((v) => v.state === 'ready' && v.scored).map((v) => (v.card as Card).score).filter((s): s is number => s != null);
  return { overall: scores.length ? r0(scores.reduce((a, b) => a + b, 0) / scores.length) : null, scored: scores.length };
}

/** How many modules have data (a score or a count to show). */
export const modulesWithData = (views: readonly ModuleView[]): number => views.filter((v) => v.state === 'ready' && ((v.card as Card).score != null || (v.card as Card).hasData)).length;

/** A tile that sums or averages several requests: waiting for them, nothing to ask (the person is shown none of the modules it reads), every one failed,
 *  or an answer that says which modules it leaves out (`missing`: failed ones). */
export type TileOf<T> =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'error'; failed: string[] }
  | { state: 'ready'; value: T; missing: string[] };

const labelsOf = (views: readonly ModuleView[]): string[] => views.map((v) => v.def.label);

function tileOf<T>(views: readonly ModuleView[], value: (answered: ModuleView[]) => T): TileOf<T> {
  if (views.length === 0) return { state: 'none' };
  if (views.some((v) => v.state === 'loading')) return { state: 'loading' };
  const answered = views.filter((v) => v.state === 'ready');
  if (answered.length === 0) return { state: 'error', failed: labelsOf(views) };
  return { state: 'ready', value: value(answered), missing: labelsOf(views.filter((v) => v.state !== 'ready')) };
}

export const readinessTile = (views: readonly ModuleView[]): TileOf<Readiness> => tileOf(views, readiness);
export const modulesTile = (views: readonly ModuleView[]): TileOf<{ withData: number; visible: number }> => tileOf(views, (answered) => ({ withData: modulesWithData(answered), visible: views.length }));

/** The three counts the "Open items past SLA" tile adds up (each is one module's own overdue count). */
export const PAST_SLA_SOURCES = [
  { key: 'assessments', label: 'Overdue gaps' },
  { key: 'issues', label: 'SLA-breached issues' },
  { key: 'assurance', label: 'Overdue control tests' },
] as const;

export interface PastSla {
  total: number;
  parts: Array<{ key: string; label: string; href: string; value: number | null }>;
  /** the modules the person is not shown (their rights do not open them): their overdue counts are not part of the sum, and the tile says so */
  notShown: string[];
}

/** The tile's sum over the modules that answered, and each part (null for a module that did not answer or is not shown). The sum is the old one: every
 *  visible card's `pastSla ?? 0`. With no source shown the tile has nothing to say (the old tile said 0). */
export function pastSlaTile(views: readonly ModuleView[]): TileOf<PastSla> {
  const sources = views.filter((v) => PAST_SLA_SOURCES.some((s) => s.key === v.def.key));
  return tileOf(sources, (answered) => ({
    notShown: PAST_SLA_SOURCES.filter((s) => !sources.some((v) => v.def.key === s.key)).map((s) => MODULE_BY_KEY[s.key].label),
    total: answered.reduce((n, v) => n + ((v.card as Card).pastSla ?? 0), 0),
    parts: PAST_SLA_SOURCES.map((s) => {
      const view = views.find((v) => v.def.key === s.key);
      return { key: s.key, label: s.label, href: MODULE_BY_KEY[s.key].href, value: view && view.state === 'ready' ? (view.card as Card).pastSla ?? 0 : null };
    }),
  }));
}

/** The Risk Posture tile: the ERM scorecard's score through `posture`. `allowed` is the person's right to the risk register. */
export type PostureTile =
  | { state: 'denied' }
  | { state: 'loading' }
  | { state: 'error'; error: unknown; refused: boolean }
  | { state: 'ready'; score: number | null; word: 'Low' | 'Moderate' | 'Elevated' | null };

export function postureTile(allowed: boolean, feed: Feed): PostureTile {
  if (!allowed) return { state: 'denied' };
  if (feed.load === 'loading') return { state: 'loading' };
  if (feed.load === 'error') return { state: 'error', error: feed.error, refused: isRefusal(feed.error) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (feed.data as any)?.performance?.score;
  const score = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  return { state: 'ready', score, word: posture(score) };
}

// ── "where to act first" ─────────────────────────────────────────────────────
export interface Priority { module: string; moduleKey: string; href: string; label: string; score: number }

/** The lowest section scores across the modules that have a score: the old rule (a module with no score of its own is left out, whatever its sections say),
 *  the six weakest, and how many sections were in the running. */
export function priorities(views: readonly ModuleView[], max = 6): { rows: Priority[]; total: number } {
  const weak: Priority[] = [];
  views.forEach((v) => {
    if (v.state !== 'ready' || !v.scored) return;
    const card = v.card as Card;
    if (card.score == null) return;
    (card.subs || []).forEach((s) => {
      if (typeof s.score === 'number') weak.push({ module: v.def.label, moduleKey: v.def.key, href: v.def.href, label: s.label, score: s.score });
    });
  });
  weak.sort((a, b) => a.score - b.score);
  return { rows: weak.slice(0, max), total: weak.length };
}

/** "A", "A and B", "A, B and C"; with more than `max`: "A, B, C and 6 more" (a tile or a notice never prints nine names). */
export function listNames(labels: readonly string[], max = 3): string {
  if (labels.length <= 1) return labels.join('');
  if (labels.length <= max) return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `${labels.slice(0, max).join(', ')} and ${labels.length - max} more`;
}

/** The modules whose requests failed, for the line above the cards and its one Retry. */
export const failedViews = (views: readonly ModuleView[]): ModuleView[] => views.filter((v) => v.state === 'error' || v.state === 'denied');

/** The ones Retry can help (a refusal cannot be retried). */
export const retryableViews = (views: readonly ModuleView[]): ModuleView[] => views.filter((v) => v.state === 'error' && canRetry(v.error));
