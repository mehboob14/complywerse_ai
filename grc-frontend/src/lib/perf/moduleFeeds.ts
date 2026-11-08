// What the Performance Overview knows about each area of the platform, apart from React so `node --test` pins it (moduleFeeds.test.ts): which request answers it, who is
// shown it, and how its answer becomes the few figures the page draws (a score and its server grade, the target the server scored against, the sections, the counters
// that need attention, one line for an area that has no score). The page owns none of the numbers: a score, a grade and a target are the module's scorecard's, a counter is
// the definition (label, address, tone) the module's own Overview already uses, imported here read-only so the two pages cannot disagree. Nothing is computed that a module
// did not compute, except the one step every score needs to be a word: `gradeOf`, which is the server's own cut (85 / 70 / 50) for the payloads that send no grade.
import { SCORECARD_QUERY_KEYS } from '../../components/dashboard/scorecard-query-keys.ts';
import { navPermissions } from '../../components/layout/navAccess.ts';
import { ATTENTION as COMPLIANCE_ATTENTION, SECTION_HREF as COMPLIANCE_SECTION_HREF, journeyRows, portfolioLine, targetOf } from '../../components/compliance/overview/overviewModel.ts';
import { ATTENTION as GOVERNANCE_ATTENTION } from '../../app/(dashboard)/governance/_overview/overviewModel.ts';
import { ATTENTION as RISK_ATTENTION } from '../../app/(dashboard)/erm/_overview/overviewModel.ts';
import { TARGET as ASSESSMENTS_TARGET, countersOf as assessmentCounters } from '../../app/(dashboard)/assessments/_overview/overviewModel.ts';
import { countersOf as bcmCounters } from '../../app/(dashboard)/bcm/_overview/overviewModel.ts';
import { tiles as vendorTiles } from '../../app/(dashboard)/vendor-risk/_lib/overviewModel.ts';
import { COUNTERS as AUTOMATION_COUNTERS } from '../../app/(dashboard)/automation/overview/_overview/overviewModel.ts';
import { tasksHref } from '../../app/(dashboard)/tasks/taskTabs.ts';
import { isActiveJourney, portfolioNumbers } from '../journeyModel.ts';
import { formatCount, formatPercent } from '../format.ts';
import type { Tone } from '../status.ts';

// ── the words of a score ─────────────────────────────────────────────────────
export type Grade = 'excellent' | 'good' | 'fair' | 'poor';
export const GRADES: readonly Grade[] = ['excellent', 'good', 'fair', 'poor'];

/** The server's cut, written in every scorecard (governance/compliance/ERM/issues/assets/assurance dashboards): 85 excellent, 70 good, 50 fair, below poor. */
export const GRADE_LINES = { excellent: 85, good: 70, fair: 50 } as const;

export function gradeOf(score: number | null | undefined): Grade | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return score >= GRADE_LINES.excellent ? 'excellent' : score >= GRADE_LINES.good ? 'good' : score >= GRADE_LINES.fair ? 'fair' : 'poor';
}

const gradeWord = (raw: unknown): Grade | null => {
  const g = String(raw ?? '').trim().toLowerCase();
  return GRADES.find((x) => x === g) ?? null;
};

// ── the requests ─────────────────────────────────────────────────────────────
export type FeedKey =
  | 'governance' | 'compliance' | 'erm' | 'assessments' | 'assets' | 'issues' | 'assurance'
  | 'journeys' | 'vendors' | 'bcm' | 'tasks' | 'evidence' | 'automation';

export interface FeedDef {
  key: FeedKey;
  /** the module page's own key: the same key is the same cached answer, so opening the module after this page asks for nothing */
  queryKey: readonly unknown[];
  /** GET, relative to the API base */
  path: string;
  params?: Record<string, string>;
}

export const FEEDS: Record<FeedKey, FeedDef> = {
  governance: { key: 'governance', queryKey: SCORECARD_QUERY_KEYS.governance, path: '/governance/dashboard/documents-overview' },
  compliance: { key: 'compliance', queryKey: SCORECARD_QUERY_KEYS.compliance, path: '/compliance/policies/dashboard/sections-overview' },
  erm: { key: 'erm', queryKey: SCORECARD_QUERY_KEYS.erm, path: '/erm/dashboard/sections-overview' },
  assessments: { key: 'assessments', queryKey: SCORECARD_QUERY_KEYS.assessments, path: '/compliance/assessments/overview' },
  assets: { key: 'assets', queryKey: SCORECARD_QUERY_KEYS.assets, path: '/assets/inventory-overview' },
  issues: { key: 'issues', queryKey: SCORECARD_QUERY_KEYS.issues, path: '/issue-management/dashboard/sections-overview' },
  assurance: { key: 'assurance', queryKey: SCORECARD_QUERY_KEYS.assurance, path: '/control-library/assurance/sections-overview' },
  // the journeys list the Compliance Overview and the Auditor Portal read (it replaces the frameworks aggregate, which loaded every journey with its evidence)
  journeys: { key: 'journeys', queryKey: ['certifications'], path: '/certifications' },
  // the Vendor Overview's own request (the old page read /vendors/dashboard, another endpoint with other numbers)
  vendors: { key: 'vendors', queryKey: ['tprm-dashboard', 'portfolio'], path: '/vendor-risk/tpra/dashboard', params: { scope: 'portfolio' } },
  bcm: { key: 'bcm', queryKey: ['bcm-dashboard'], path: '/bcm/dashboard' },
  // scoped by the server to the tasks the person may see
  tasks: { key: 'tasks', queryKey: ['critical-tasks', 'reports-summary'], path: '/critical-tasks/reports/summary' },
  evidence: { key: 'evidence', queryKey: ['ev-ws-summary'], path: '/evidence-mgmt/items/dashboard/summary' },
  automation: { key: 'automation', queryKey: ['common-overview', 'in_scope'], path: '/automation/common/overview', params: { scope: 'in_scope' } },
};

// ── what a read gives the page ───────────────────────────────────────────────
export interface Counter {
  key: string;
  label: string;
  /** the records it counts, or the page that lists them */
  href: string;
  tone: Tone;
  /** null: the answer carried no such number (a dash, never 0) */
  value: number | null;
}

export interface SectionRead { key: string; label: string; score: number | null }

export interface ModuleRead {
  score: number | null;
  grade: Grade | null;
  /** the target the server scored against; null when the answer has none */
  target: number | null;
  /** the organisation changed the weights or the target (top-level `customized` of the scorecard); null when the server does not say */
  customized: boolean | null;
  sections: SectionRead[];
  counters: Counter[];
  /** one line for an area with no score ("3 active journeys · 68% ready") */
  headline: string | null;
}

const EMPTY_READ: ModuleRead = { score: null, grade: null, target: null, customized: null, sections: [], counters: [], headline: null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const positive = (v: unknown): number | null => { const n = num(v); return n !== null && n > 0 ? n : null; };
const plural = (n: number, one: string, many: string = `${one}s`): string => `${formatCount(n)} ${n === 1 ? one : many}`;

type CounterDef = Pick<Counter, 'key' | 'label' | 'href' | 'tone'>;
const counterDef = (list: ReadonlyArray<CounterDef>, key: string): CounterDef => {
  const found = list.find((c) => c.key === key);
  if (!found) throw new Error(`the module model has no counter "${key}"`);
  return { key: found.key, label: found.label, href: found.href, tone: found.tone };
};
const withValue = (def: CounterDef, value: unknown): Counter => ({ ...def, value: num(value) });

/** The sections of a scorecard: its performance components, else its sections (each with a label), in the order the server sends them. */
function sectionsOf(d: Raw): SectionRead[] {
  const comps: Raw[] = d?.performance?.components ?? Object.values(d?.sections ?? {});
  return (Array.isArray(comps) ? comps : [])
    .filter((c) => c && c.label)
    .map((c) => ({ key: String(c.key ?? c.label), label: String(c.label), score: num(c.score) }));
}

/** The score, grade, target and sections of a scorecard payload. The grade is the server's (derived by the server's own cut where a payload sends none);
 *  the target is the top-level `target` where the server sends one, else the tuned target every component carries. */
function scorecardRead(d: Raw): ModuleRead {
  const score = num(d?.performance?.score);
  return {
    ...EMPTY_READ,
    score,
    grade: score === null ? null : gradeWord(d?.performance?.grade) ?? gradeOf(score),
    target: positive(d?.target) ?? targetOf(d?.performance),
    customized: typeof d?.customized === 'boolean' ? d.customized : null,
    sections: sectionsOf(d),
  };
}

const queue = (d: Raw): Raw => (d?.attention_queue && typeof d.attention_queue === 'object' ? d.attention_queue : {});
const queueCounters = (d: Raw, defs: ReadonlyArray<CounterDef>): Counter[] => defs.map((def) => withValue(def, queue(d)[def.key]));

const govDef = (key: string) => counterDef(GOVERNANCE_ATTENTION, key);
const complianceDef = (key: string) => counterDef(COMPLIANCE_ATTENTION, key);
const riskDef = (key: string) => counterDef(RISK_ATTENTION, key);

/** The counters an area hands the band, in the words and with the addresses of the module's own Overview (Risk Management's are its own: the Issues scorecard's critical incidents are the same count). */
const ISSUE_COUNTERS: CounterDef[] = [
  { key: 'sla_breached_issues', label: 'SLA-breached issues', href: '/issues', tone: 'danger' },
  riskDef('open_critical_incidents'),
];
const RISK_COUNTERS: CounterDef[] = [riskDef('critical_open_risks'), riskDef('red_kris')];

// ── the areas ────────────────────────────────────────────────────────────────
export type AreaKind = 'score' | 'count' | 'link';

export interface Area {
  key: string;
  label: string;
  /** where the row opens: the area's Overview (or its front page) */
  href: string;
  kind: AreaKind;
  /** the request that answers it; null: a link only (the area's pages are not this page's to summarise) */
  feed: FeedKey | null;
  /** any one of these opens the area (an administrator sees all). The sidebar's rights, except where the SERVER is stricter: Issues and Business Continuity */
  gate: readonly string[];
  /** reads the answer of `feed`; throws when it is not in a shape this knows (the row then says it could not be read) */
  read?: (payload: Raw) => ModuleRead;
  /** where a section of this area is worked on, when its sections have addresses of their own */
  sectionHref?: (sectionKey: string) => string | undefined;
}

const sidebar = (href: string): readonly string[] => navPermissions(href);

export const AREAS: readonly Area[] = [
  {
    key: 'governance', label: 'Governance', href: '/governance', kind: 'score', feed: 'governance', gate: sidebar('/governance'),
    read: (d) => ({ ...scorecardRead(d), counters: queueCounters(d, [govDef('overdue_reviews'), govDef('overdue_attestations')]) }),
  },
  {
    key: 'compliance', label: 'Compliance', href: '/compliance', kind: 'score', feed: 'compliance', gate: sidebar('/compliance'),
    read: (d) => ({ ...scorecardRead(d), counters: queueCounters(d, [complianceDef('controls_without_evidence')]) }),
    sectionHref: (key) => COMPLIANCE_SECTION_HREF[key],
  },
  {
    key: 'risk', label: 'Risk Management', href: '/erm', kind: 'score', feed: 'erm', gate: sidebar('/erm'),
    read: (d) => ({ ...scorecardRead(d), counters: queueCounters(d, RISK_COUNTERS) }),
  },
  {
    key: 'assessments', label: 'Assessments', href: '/assessments', kind: 'score', feed: 'assessments', gate: sidebar('/assessments'),
    read: (d) => {
      const score = num(d?.performance?.score);
      // the definition (label, address, tone) is the Assessments Overview's; the number is read here, so an answer without the block gives a dash
      const overdue = assessmentCounters({ attention: {} } as Parameters<typeof assessmentCounters>[0], undefined).find((c) => c.key === 'overdue');
      if (!overdue) throw new Error('the Assessments Overview has no overdue counter');
      return {
        ...EMPTY_READ,
        score,
        grade: score === null ? null : gradeWord(d?.performance?.grade) ?? gradeOf(score),
        // the Assessments Overview's own target (its ring says "target 85"): the payload carries none
        target: ASSESSMENTS_TARGET,
        sections: (Array.isArray(d?.categories) ? d.categories : []).map((c: Raw) => ({ key: String(c.category), label: String(c.category), score: num(c.score) })),
        counters: [{ key: `assessments_${overdue.key}`, label: overdue.label, href: overdue.href, tone: overdue.tone, value: num(d?.attention?.overdue_gaps) }],
      };
    },
  },
  {
    key: 'assets', label: 'IT Assets', href: '/cyber-assurance/assets', kind: 'score', feed: 'assets', gate: sidebar('/cyber-assurance/assets'),
    read: (d) => scorecardRead(d),
  },
  {
    key: 'issues', label: 'Issues & Incidents', href: '/issues', kind: 'score', feed: 'issues',
    // the server answers the Issues scorecard to issue_management:issues:view only: a person with just erm:incidents:* was shown a card the server refused
    gate: sidebar('/issues'),
    read: (d) => ({ ...scorecardRead(d), counters: queueCounters(d, ISSUE_COUNTERS) }),
  },
  {
    key: 'assurance', label: 'Control Testing & Assurance', href: '/control-library/assurance', kind: 'score', feed: 'assurance', gate: ['controls:control_library:*'],
    read: (d) => ({ ...scorecardRead(d), counters: queueCounters(d, [complianceDef('overdue_control_tests')]) }),
  },
  {
    key: 'frameworks', label: 'Frameworks', href: '/frameworks', kind: 'count', feed: 'journeys', gate: sidebar('/frameworks'),
    read: (list) => {
      const rows = journeyList(list);
      const active = rows.filter((r) => isActiveJourney(r.status)).length;
      const line = portfolioLine(rows);
      const late = journeyRows(rows).filter((r) => r.active && r.target.state === 'overdue').length;
      const counted = portfolioNumbers(rows).journeys;
      return {
        ...EMPTY_READ,
        headline: rows.length === 0
          ? 'No framework journeys yet'
          : `${plural(active, 'active journey')}${counted > 0 ? ` · ${formatPercent(line.ready)} ready` : ''}`,
        counters: [{ key: 'journeys_late', label: 'Journeys past their target date', href: '/frameworks', tone: 'danger', value: late }],
      };
    },
  },
  {
    key: 'vendors', label: 'Third-Party Vendor Risk', href: '/vendor-risk', kind: 'count', feed: 'vendors', gate: sidebar('/vendor-risk'),
    read: (d) => {
      const tiles = vendorTiles(d as Parameters<typeof vendorTiles>[0], 'portfolio');
      const pick = (key: string): Counter => {
        const t = tiles.find((x) => x.key === key);
        if (!t) throw new Error(`the Vendor Overview has no tile "${key}"`);
        return { key: `vendor_${t.key}`, label: t.label, href: t.href, tone: t.tone, value: t.value };
      };
      const active = num(d?.kpis?.active_vendors);
      return { ...EMPTY_READ, headline: active === null ? null : plural(active, 'active vendor'), counters: [pick('overdue'), pick('critical')] };
    },
  },
  {
    key: 'bcm', label: 'Business Continuity', href: '/bcm', kind: 'count', feed: 'bcm',
    // the server answers /bcm/dashboard to bcm:dashboard:view only; the sidebar also admits plans and drills
    gate: ['bcm:dashboard:*'],
    read: (d) => {
      const all = bcmCounters(d as Parameters<typeof bcmCounters>[0]);
      const pick = (key: string): Counter => {
        const c = all.find((x) => x.key === key);
        if (!c) throw new Error(`the Business Continuity Overview has no counter "${key}"`);
        return { key: `bcm_${c.key}`, label: c.label, href: c.href, tone: c.tone, value: c.value };
      };
      const plans = num(d?.totals?.plans);
      return { ...EMPTY_READ, headline: plans === null ? null : `${plural(plans, 'plan')} · ${plural(num(d?.totals?.drills) ?? 0, 'drill')}`, counters: [pick('overdue-drills'), pick('reviews-due')] };
    },
  },
  {
    key: 'tasks', label: 'Task Management', href: '/tasks', kind: 'count', feed: 'tasks', gate: sidebar('/tasks'),
    read: (d) => {
      const total = num(d?.total);
      return {
        ...EMPTY_READ,
        headline: total === null ? null : `${plural(total, 'task')} you can see`,
        counters: [{ key: 'tasks_overdue', label: 'Overdue tasks', href: tasksHref('all', { due: ['overdue'] }), tone: 'danger', value: num(d?.overdue) }],
      };
    },
  },
  {
    key: 'evidence', label: 'Evidence Management', href: '/evidence', kind: 'count', feed: 'evidence', gate: sidebar('/evidence'),
    read: (d) => {
      const total = num(d?.total_count);
      const waiting = num(d?.pending_review_count);
      return {
        ...EMPTY_READ,
        headline: total === null ? null : `${plural(total, 'item')}${waiting ? ` · ${formatCount(waiting)} waiting for review` : ''}`,
        // a file past its validity, worked out when it is read (the Compliance Overview's definition: the stored flag the scorecard counts is set by nobody)
        counters: [withValue(complianceDef('evidence_lapsed'), num(d?.lapsed_count) ?? num(d?.stale_count))],
      };
    },
  },
  {
    key: 'regulatory', label: 'Regulatory Changes', href: '/governance/regulatory-changes', kind: 'count', feed: 'compliance', gate: sidebar('/governance/regulatory-changes'),
    read: (d) => ({ ...EMPTY_READ, counters: queueCounters(d, [complianceDef('regulatory_overdue_tasks')]) }),
  },
  {
    key: 'automation', label: 'Controls Automation', href: '/automation/overview', kind: 'count', feed: 'automation', gate: sidebar('/automation/overview'),
    read: (d) => {
      const failing = counterDef(AUTOMATION_COUNTERS, 'failed');
      const sources = counterDef(AUTOMATION_COUNTERS, 'sources');
      const withChecks = num(d?.automation?.controls_with_checks);
      const library = num(d?.library?.controls);
      return {
        ...EMPTY_READ,
        headline: withChecks === null || library === null ? null : `${formatCount(withChecks)} of ${plural(library, 'control')} have automated checks`,
        counters: [{ ...withValue(failing, d?.automation?.posture?.failed), key: 'automation_failed' }, { ...withValue(sources, d?.collection?.counts?.failing), key: 'automation_sources' }],
      };
    },
  },
  {
    key: 'auditor', label: 'Auditor Portal', href: '/auditor-portal', kind: 'count', feed: 'journeys', gate: sidebar('/auditor-portal'),
    read: (list) => {
      const n = journeyList(list).length;
      return { ...EMPTY_READ, headline: n === 0 ? 'No certification journeys yet' : `${plural(n, 'certification journey')} to review` };
    },
  },
  { key: 'access-reviews', label: 'Access Reviews', href: '/compliance/access-reviews', kind: 'link', feed: null, gate: sidebar('/compliance/access-reviews') },
  { key: 'cyber', label: 'Cybersecurity Assurance', href: '/cyber-assurance/dashboard', kind: 'link', feed: null, gate: sidebar('/cyber-assurance/dashboard') },
];

export const AREA_BY_KEY: Record<string, Area> = Object.fromEntries(AREAS.map((a) => [a.key, a]));

type JourneyLike = Parameters<typeof portfolioLine>[0];
/** The journeys list under `['certifications']`: an array, or an object that wraps one (the Compliance Overview reads it the same way). */
export function journeyList(data: unknown): NonNullable<JourneyLike> {
  if (Array.isArray(data)) return data as NonNullable<JourneyLike>;
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    for (const k of ['items', 'data', 'results', 'certifications']) if (Array.isArray(o[k])) return o[k] as NonNullable<JourneyLike>;
  }
  return [];
}

/** Who is shown an area: an administrator all of them, anyone else those whose rights they hold. */
export function areasFor(isAdmin: boolean, hasAnyPermission: (permissions: string[]) => boolean): Area[] {
  return AREAS.filter((a) => isAdmin || (a.gate.length > 0 && hasAnyPermission(a.gate.slice())));
}

/** The requests an access needs: each feed once, only when an area that is shown reads it. */
export function feedsFor(areas: readonly Area[]): FeedKey[] {
  const keys: FeedKey[] = [];
  areas.forEach((a) => { if (a.feed && keys.indexOf(a.feed) < 0) keys.push(a.feed); });
  return keys;
}

/** An area's answer read by its own rules; null when the answer is not in the shape the rules know (the row then says it could not be read). */
export function readArea(area: Area, payload: unknown): ModuleRead | null {
  if (!area.read) return null;
  try {
    const read = area.read(payload);
    return read && typeof read === 'object' ? read : null;
  } catch {
    return null;
  }
}
