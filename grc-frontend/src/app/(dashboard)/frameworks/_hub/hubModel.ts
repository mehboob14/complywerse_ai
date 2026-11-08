// The Frameworks hub's rules, apart from React so `node --test` can pin them (hubModel.test.ts): the rows of the two registers (Journeys: a row per journey; Library: a row per
// framework of the library, joined to its journey and its onboarding), the one state of a row, the quick views and what each counts, who needs attention, the order of a list, the
// search, the board, the one next step of a row, and the figures of the posture tiles. Every readiness / implemented / due number comes from lib/journeyModel.ts (F-readiness):
// this file never works one out for itself. A journey whose payload has no `progress` has no figures ("Not recorded"), never zeros.
import { statusLabel } from '../../../../lib/format.ts';
import {
  isActiveJourney, journeyNumbers, portfolioNumbers, readinessBand, targetState,
  type JourneyNumbers, type JourneyProgressPayload, type PortfolioNumbers, type ReadinessBand, type TargetState,
} from '../../../../lib/journeyModel.ts';
import { frameworkState } from '../../../../lib/statuses/frameworkHub.ts';
import { groupBoard, type BoardColumn, type BoardColumnDef } from '../../../../components/records/explorerModel.ts';

export type Scope = 'journeys' | 'library';
/** The value of "nothing recorded" in the facets that offer it. */
export const NONE = 'none';

// ── what the server sends ────────────────────────────────────────────────────────────────────────────────────────────────
/** One row of GET /framework-upload/upload (the library). */
export interface LibraryItem {
  id: number;
  name: string;
  version?: string | null;
  framework_type?: string | null;
  upload_status?: string | null;
  is_shared?: boolean;
  created_at?: string | null;
  parsed_controls_count?: number | null;
  classification?: string | null;
  classification_reasoning?: string | null;
  framework_purpose?: string | null;
  framework_scope?: string | null;
  framework_objectives?: string[] | null;
  target_audience?: string | null;
  certification_body?: string | null;
  certification_validity_period?: string | null;
  certification_levels?: unknown[] | null;
  required_artifacts?: unknown;
  regulatory_authority?: string | null;
  compliance_deadline?: string | null;
  penalty_for_non_compliance?: string | null;
  adoption_approach?: unknown;
}

/** One row of GET /certifications (a journey, with the journey function's `progress`). */
export interface JourneyItem {
  id: number;
  framework_id?: number | null;
  uploaded_framework_id?: number | null;
  name: string;
  status: string;
  target_date?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  progress?: JourneyProgressPayload | null;
}

export type OnboardingStateWord = 'not_started' | 'draft' | 'ready' | 'complete' | 'underway';
/** The part of a row of GET /compliance/framework-onboarding the hub reads. */
export interface OnboardingRow {
  uploaded_framework_id: number;
  onboarding_id: number | null;
  state: OnboardingStateWord;
  progress: { done: number; total: number } | null;
}

// ── names ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The library calls a framework "ISO 27001 Certification"; the hub says "ISO 27001" (the word is the kind's, shown as a chip). */
export const stripCertificationPostfix = (value?: string | null): string => (value ?? '').replace(/\s+certification\s*$/i, '').trim();

/** What the library classified a framework as: certification, compliance, regulatory, regulation, voluntary, policy ... (the word itself); 'other' when it has none. */
export type Kind = string;
export const OTHER_KIND = 'other';
export const kindOf = (classification?: string | null): Kind => (classification ?? '').trim().toLowerCase().replace(/\s+/g, '_') || OTHER_KIND;
export const kindLabel = (kind: Kind): string => (kind === OTHER_KIND ? 'Not classified' : statusLabel(kind));
/** certification and compliance first (the two the platform has always known), then the others by name, "Not classified" last. */
export const compareKinds = (a: Kind, b: Kind): number => {
  const rank = (k: Kind) => (k === 'certification' ? 0 : k === 'compliance' ? 1 : k === OTHER_KIND ? 3 : 2);
  return rank(a) - rank(b) || a.localeCompare(b);
};

const TYPE_LABEL: Record<string, string> = { iso: 'ISO', nist: 'NIST', pci_dss: 'PCI DSS', soc2: 'SOC 2', gdpr: 'GDPR', hipaa: 'HIPAA', cobit: 'COBIT', other: 'Custom' };
export const typeKey = (value?: string | null): string => (value ?? '').trim().toLowerCase() || 'other';
export const typeLabel = (key: string): string => TYPE_LABEL[key] ?? statusLabel(key);

/** Who stands behind the framework: the certification body of a certification, the regulator of a compliance framework (else whichever is recorded). */
export function authorityOf(fw: Pick<LibraryItem, 'classification' | 'certification_body' | 'regulatory_authority'>): string | null {
  const body = (fw.certification_body ?? '').trim();
  const regulator = (fw.regulatory_authority ?? '').trim();
  return (kindOf(fw.classification) === 'certification' ? body || regulator : regulator || body) || null;
}

// ── the library: what is listed ─────────────────────────────────────────────────────────────────────────────────────────
/** A framework can start a journey only once it is read: these upload states (the Manage page and the picker listed the same four). */
const LISTABLE = ['completed', 'published', 'parsed', 'classified'];
export const isListable = (fw: Pick<LibraryItem, 'upload_status'>): boolean => LISTABLE.indexOf((fw.upload_status ?? '').toLowerCase()) >= 0;

const UPLOAD_PRIORITY: Record<string, number> = { classified: 7, published: 6, completed: 5, parsed: 4, classifying: 3, text_extracted: 2, draft: 1 };
const when = (iso?: string | null): number => { const t = new Date(iso || 0).getTime(); return Number.isFinite(t) ? t : 0; };

/** One framework per name and version: the better-read copy wins, the newer one breaks a tie (as the Manage page and the onboarding register do). */
export function dedupeFrameworks<T extends Pick<LibraryItem, 'name' | 'version' | 'upload_status' | 'created_at'>>(items: readonly T[]): T[] {
  const kept = new Map<string, T>();
  items.forEach((fw) => {
    const key = `${stripCertificationPostfix(fw.name).toLowerCase()}::${(fw.version ?? '').toLowerCase()}`;
    const have = kept.get(key);
    if (!have) { kept.set(key, fw); return; }
    const a = UPLOAD_PRIORITY[(have.upload_status ?? '').toLowerCase()] || 0;
    const b = UPLOAD_PRIORITY[(fw.upload_status ?? '').toLowerCase()] || 0;
    if (b > a || (b === a && when(fw.created_at) >= when(have.created_at))) kept.set(key, fw);
  });
  return Array.from(kept.values());
}

/** The frameworks of the library the hub lists, and how many it leaves out because they are not read yet (said on the page, never silently). */
export function listedLibrary<T extends LibraryItem>(items: readonly T[]): { listed: T[]; notReady: number } {
  const unique = dedupeFrameworks(items);
  return { listed: unique.filter(isListable), notReady: unique.filter((fw) => !isListable(fw)).length };
}

// ── journeys ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The library framework a journey belongs to (journeys are stored with `uploaded_framework_id`; `framework_id` is the older column). */
export const frameworkIdOf = (j: Pick<JourneyItem, 'uploaded_framework_id' | 'framework_id'>): number | null => j.uploaded_framework_id ?? j.framework_id ?? null;

/** The journey that stands for a framework: the newest one that still has work in it, else the newest of all (a completed one). */
export function currentJourney(list: readonly JourneyItem[]): JourneyItem | null {
  const newest = (a: JourneyItem, b: JourneyItem) => when(b.started_at) - when(a.started_at) || b.id - a.id;
  const sorted = list.slice().sort(newest);
  return sorted.find((j) => isActiveJourney(j.status)) ?? sorted[0] ?? null;
}

// ── rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface HubRow {
  scope: Scope;
  /** the journey (Journeys) or the framework (Library) */
  id: number;
  name: string;
  version: string | null;
  typeKey: string;
  kind: Kind;
  authority: string | null;
  /** the requirements the library holds for the framework; null for a journey the library did not list */
  requirements: number | null;
  /** one word of frameworkState */
  state: string;
  /** under the state pill: where the onboarding is */
  stateNote: string | null;
  frameworkId: number | null;
  /** the journey that stands for the row */
  journey: JourneyItem | null;
  /** its figures, from the journey function; null when there is no journey or its payload has none */
  numbers: JourneyNumbers | null;
  target: TargetState;
  startedAt: string | null;
  onboarding: OnboardingRow | null;
  /** false: a journey of a framework the library did not list (deleted, or not read): kind and authority are unknown */
  inLibrary: boolean;
  shared: boolean;
}

const NO_TARGET: TargetState = { day: null, days: null, state: 'none' };

function fromLibrary(fw: LibraryItem | undefined): Pick<HubRow, 'version' | 'typeKey' | 'kind' | 'authority' | 'requirements' | 'inLibrary' | 'shared'> {
  if (!fw) return { version: null, typeKey: 'other', kind: 'other', authority: null, requirements: null, inLibrary: false, shared: false };
  return {
    version: (fw.version ?? '').trim() || null, typeKey: typeKey(fw.framework_type), kind: kindOf(fw.classification), authority: authorityOf(fw),
    requirements: typeof fw.parsed_controls_count === 'number' ? fw.parsed_controls_count : null, inLibrary: true, shared: !!fw.is_shared,
  };
}

/** A row per journey, each with the facts of its framework. */
export function journeyRows(journeys: readonly JourneyItem[], library: readonly LibraryItem[] | null, today: Date = new Date()): HubRow[] {
  const byId = new Map<number, LibraryItem>();
  (library ?? []).forEach((fw) => byId.set(fw.id, fw));
  return journeys.map((j) => {
    const fid = frameworkIdOf(j);
    return {
      scope: 'journeys' as const, id: j.id, name: stripCertificationPostfix(j.name) || j.name || 'Untitled journey', frameworkId: fid, journey: j,
      state: j.status, stateNote: null, numbers: journeyNumbers(j.progress), target: targetState(j.target_date, j.status, today), startedAt: j.started_at ?? null,
      onboarding: null, ...fromLibrary(fid == null ? undefined : byId.get(fid)),
    };
  });
}

/** Where a framework without a journey stands: the stage of its onboarding. `register` null: it could not be read, so the stage is not known. */
export function stageOf(ob: OnboardingRow | null | undefined, registerKnown: boolean): { state: string; note: string | null } {
  if (!registerKnown) return { state: 'unknown', note: null };
  switch (ob?.state) {
    case 'draft': return { state: 'onboarding', note: ob.progress && ob.progress.total > 0 ? `${ob.progress.done} of ${ob.progress.total} required answers` : 'Draft' };
    case 'ready': return { state: 'onboarding', note: 'Waiting for approval' };
    case 'complete': return { state: 'ready', note: 'Onboarding approved' };
    case 'underway': return { state: 'ready', note: 'Marked as already underway' };
    default: return { state: 'idle', note: null };
  }
}

/** A row per framework of the library, joined to the journey that stands for it and to its onboarding. */
export function libraryRows(library: readonly LibraryItem[], journeys: readonly JourneyItem[], register: readonly OnboardingRow[] | null, today: Date = new Date()): HubRow[] {
  const journeysOf = new Map<number, JourneyItem[]>();
  journeys.forEach((j) => { const fid = frameworkIdOf(j); if (fid != null) journeysOf.set(fid, (journeysOf.get(fid) ?? []).concat(j)); });
  const obOf = new Map<number, OnboardingRow>();
  (register ?? []).forEach((r) => obOf.set(r.uploaded_framework_id, r));
  return library.map((fw) => {
    const journey = currentJourney(journeysOf.get(fw.id) ?? []);
    const ob = obOf.get(fw.id) ?? null;
    const stage = journey ? { state: journey.status, note: null } : stageOf(ob, register !== null);
    return {
      scope: 'library' as const, id: fw.id, name: stripCertificationPostfix(fw.name) || fw.name || 'Untitled framework', frameworkId: fw.id, journey,
      state: stage.state, stateNote: stage.note, numbers: journey ? journeyNumbers(journey.progress) : null,
      target: journey ? targetState(journey.target_date, journey.status, today) : NO_TARGET, startedAt: journey?.started_at ?? null, onboarding: ob, ...fromLibrary(fw),
    };
  });
}

// ── the quick views ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const JOURNEY_QUICK = ['all', 'attention', 'in_progress', 'not_started', 'on_hold', 'completed'] as const;
export const LIBRARY_QUICK = ['all', 'idle', 'onboarding', 'ready', 'running', 'completed'] as const;
export const QUICK_IDS = ['all', 'attention', 'in_progress', 'not_started', 'on_hold', 'completed', 'idle', 'onboarding', 'ready', 'running'] as const;
export type QuickId = (typeof QUICK_IDS)[number];
export const QUICK_LABEL: Record<QuickId, string> = {
  all: 'All', attention: 'Needs attention', in_progress: 'In progress', not_started: 'Not started', on_hold: 'On hold', completed: 'Completed',
  idle: 'No journey yet', onboarding: 'Onboarding', ready: 'Ready to start', running: 'Running',
};
export const quickFor = (scope: Scope): readonly QuickId[] => (scope === 'journeys' ? JOURNEY_QUICK : LIBRARY_QUICK);

/** A journey with work in it that is late, due within 30 days or on hold: what a person should look at first. */
export function needsAttention(row: Pick<HubRow, 'journey' | 'state' | 'target'>): boolean {
  if (!row.journey || !isActiveJourney(row.journey.status)) return false;
  return row.target.state === 'overdue' || row.target.state === 'soon' || row.journey.status === 'on_hold';
}

export function inQuick(id: QuickId, row: HubRow): boolean {
  switch (id) {
    case 'all': return true;
    case 'attention': return needsAttention(row);
    case 'running': return row.state === 'in_progress' || row.state === 'not_started' || row.state === 'on_hold';
    default: return row.state === id;
  }
}

export function quickCounts(rows: readonly HubRow[], scope: Scope): Record<string, number> {
  const out: Record<string, number> = {};
  quickFor(scope).forEach((id) => { out[id] = rows.reduce((n, r) => n + (inQuick(id, r) ? 1 : 0), 0); });
  return out;
}

// ── the order of a list ──────────────────────────────────────────────────────────────────────────────────────────────────
export const SORT_KEYS = ['attention', 'name', 'ready', 'implemented', 'target', 'started', 'state', 'authority', 'requirements'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export const SORTS_OF: Record<Scope, readonly SortKey[]> = {
  journeys: ['attention', 'name', 'ready', 'implemented', 'target', 'started'],
  library: ['name', 'state', 'authority', 'requirements'],
};
export const DEFAULT_SORT: Record<Scope, Sort> = { journeys: { key: 'attention', dir: 'asc' }, library: { key: 'name', dir: 'asc' } };
export const SORT_LABEL: Record<SortKey, string> = {
  attention: 'Needs attention first', name: 'Name', ready: 'Ready', implemented: 'Implemented', target: 'Target date', started: 'Started', state: 'State', authority: 'Authority', requirements: 'Requirements',
};
/** The direction a column starts in when it is first pressed: the most pressing end of the list is the top. */
export const FIRST_DIR: Record<SortKey, 'asc' | 'desc'> = {
  attention: 'asc', name: 'asc', ready: 'asc', implemented: 'asc', target: 'asc', started: 'desc', state: 'asc', authority: 'asc', requirements: 'desc',
};

/** The sort the address asks for when the page can do it, else the page's own default (a key of the other register is no sort here). */
export const sortFor = (scope: Scope, asked: Sort | null): Sort => (asked && SORTS_OF[scope].indexOf(asked.key) >= 0 ? asked : DEFAULT_SORT[scope]);

/** The next order when a header is pressed: a new column starts in its first direction, the same column turns round, a second turn goes back to the default. */
export function nextSort(scope: Scope, current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: FIRST_DIR[key] };
  if (current.dir === FIRST_DIR[key]) return { key, dir: FIRST_DIR[key] === 'asc' ? 'desc' : 'asc' };
  return DEFAULT_SORT[scope];
}

const STATE_ORDER = ['in_progress', 'on_hold', 'not_started', 'ready', 'onboarding', 'idle', 'completed', 'cancelled', 'unknown'];
const rankOf = (order: readonly string[], v: string): number => { const at = order.indexOf(v); return at < 0 ? order.length : at; };

/** 0 late, 1 due within 30 days, 2 on hold, 3 other work in progress, 4 finished: the order of "Needs attention first". */
export function attentionRank(row: Pick<HubRow, 'journey' | 'state' | 'target'>): number {
  if (!row.journey || !isActiveJourney(row.journey.status)) return 4;
  if (row.target.state === 'overdue') return 0;
  if (row.target.state === 'soon') return 1;
  return row.journey.status === 'on_hold' ? 2 : 3;
}

/** The rows in the order asked for. A row without the value goes last whichever way the column runs; ties fall back to the name, then the id. */
export function sortRows(rows: readonly HubRow[], sort: Sort): HubRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const value = (r: HubRow): string | number | null => {
    switch (sort.key) {
      case 'attention': return attentionRank(r);
      case 'ready': return r.numbers ? r.numbers.readyPct : null;
      case 'implemented': return r.numbers ? r.numbers.implementedPct : null;
      case 'target': return r.target.days;
      case 'started': return r.startedAt ? when(r.startedAt) : null;
      case 'state': return rankOf(STATE_ORDER, r.state);
      case 'authority': return r.authority ? r.authority.toLowerCase() : null;
      case 'requirements': return r.requirements;
      default: return r.name.toLowerCase();
    }
  };
  const byName = (a: HubRow, b: HubRow) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id - b.id;
  // inside "needs attention first", the least ready journey comes first
  const tieBreak = (a: HubRow, b: HubRow) => (sort.key === 'attention' ? (a.numbers?.readyPct ?? 101) - (b.numbers?.readyPct ?? 101) : 0) || byName(a, b);
  return rows.slice().sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return tieBreak(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    if (x === y) return tieBreak(a, b);
    if (typeof x === 'string' && typeof y === 'string') return x.localeCompare(y, undefined, { numeric: true }) * sign || tieBreak(a, b);
    return ((x as number) < (y as number) ? -1 : 1) * sign;
  });
}

// ── search ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What the search looks at: the name, the framework's type, kind, authority and version, and the state in words. */
export const haystack = (r: HubRow): string =>
  `${r.name} ${r.journey ? r.journey.name : ''} ${typeLabel(r.typeKey)} ${kindLabel(r.kind)} ${r.authority ?? ''} ${r.version ?? ''} ${frameworkState.label(r.state)}`.toLowerCase();
export const searchTerms = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);

// ── the board ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The columns of the board by state; a column nobody is in is left out when it is not one of the core ones (Cancelled, Not known). */
export function boardColumns(scope: Scope, rows: readonly HubRow[]): BoardColumn<HubRow>[] {
  const word = (s: string) => frameworkState.label(s);
  const defs: BoardColumnDef<HubRow>[] = scope === 'journeys'
    ? [
      { id: 'not_started', label: word('not_started'), test: (r) => r.state === 'not_started' },
      { id: 'in_progress', label: word('in_progress'), test: (r) => r.state === 'in_progress' },
      { id: 'on_hold', label: word('on_hold'), test: (r) => r.state === 'on_hold' },
      { id: 'completed', label: word('completed'), test: (r) => r.state === 'completed' },
    ]
    : [
      { id: 'idle', label: word('idle'), test: (r) => r.state === 'idle' },
      { id: 'onboarding', label: word('onboarding'), test: (r) => r.state === 'onboarding' },
      { id: 'ready', label: word('ready'), test: (r) => r.state === 'ready' },
      { id: 'running', label: QUICK_LABEL.running, test: (r) => inQuick('running', r) },
      { id: 'completed', label: word('completed'), test: (r) => r.state === 'completed' },
    ];
  const taken = new Set(defs.map((d) => d.id));
  const optional: BoardColumnDef<HubRow>[] = [
    { id: 'cancelled', label: word('cancelled'), test: (r) => r.state === 'cancelled' },
    { id: 'unknown', label: word('unknown'), test: (r) => r.state === 'unknown' },
  ];
  const extra = optional.filter((d) => !taken.has(d.id) && rows.some((r) => d.test(r)));
  return groupBoard(rows, defs.concat(extra));
}

// ── the one next step of a row ───────────────────────────────────────────────────────────────────────────────────────────
export type NextStep =
  | { kind: 'open'; label: string; href: string }
  | { kind: 'onboarding'; label: string; frameworkId: number; onboardingId: number | null; href: string | null }
  | { kind: 'start'; label: string; frameworkId: number };

export const journeyHref = (id: number): string => `/frameworks/${id}`;
export const onboardingHref = (id: number): string => `/frameworks/onboarding/${id}`;

/** What a row offers as its main button: a journey opens; a framework without one goes to the next stage of the gate (start the onboarding, continue it, or start the journey). */
export function nextStep(row: HubRow): NextStep | null {
  if (row.journey) return { kind: 'open', label: 'Open journey', href: journeyHref(row.journey.id) };
  if (row.scope === 'journeys' || row.frameworkId == null) return null;
  const ob = row.onboarding;
  if (row.state === 'idle') return { kind: 'onboarding', label: 'Start onboarding', frameworkId: row.frameworkId, onboardingId: null, href: null };
  if (row.state === 'onboarding' && ob?.onboarding_id != null) {
    return { kind: 'onboarding', label: ob.state === 'draft' ? 'Continue onboarding' : 'Open onboarding', frameworkId: row.frameworkId, onboardingId: ob.onboarding_id, href: onboardingHref(ob.onboarding_id) };
  }
  return { kind: 'start', label: 'Start journey', frameworkId: row.frameworkId };
}

/** A framework whose journeys are all finished may start a new one (a new certification cycle): the server allows it, and the old Manage page offered it. */
export const canStartAnother = (row: HubRow): boolean => row.scope === 'library' && !!row.journey && !isActiveJourney(row.journey.status) && row.frameworkId != null;

// ── the target date in words ─────────────────────────────────────────────────────────────────────────────────────────────
const days = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;
/** "Overdue by 3 days", "Due in 12 days", "Due today"; nothing when the date is far off, absent, or the journey is finished. */
export function dueText(t: Pick<TargetState, 'days' | 'state'>): string | null {
  if (t.days === null) return null;
  if (t.state === 'overdue') return `Overdue by ${days(-t.days)}`;
  if (t.state === 'soon') return t.days === 0 ? 'Due today' : `Due in ${days(t.days)}`;
  return null;
}

/** Today as the date input holds it ("2026-11-08"), in the viewer's own calendar (toISOString would be the UTC day and could be yesterday or tomorrow). */
export function todayDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ── the posture tiles ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface HubTiles {
  /** journeys with work in them that have figures, and those that have none (said, not counted as zero) */
  counted: number;
  missing: number;
  completed: number;
  readyPct: number;
  band: ReadinessBand;
  implementedPct: number;
  implemented: number;
  /** requirements whose approved evidence meets what they ask for (the numerator of Ready) */
  approved: number;
  applicable: number;
  open: number;
  /** active journeys with a target within 30 days, and the late ones among them */
  dueSoon: number;
  overdue: number;
}

export function hubTiles(journeys: readonly JourneyItem[], today: Date = new Date()): HubTiles {
  const p: PortfolioNumbers = portfolioNumbers(journeys);
  const active = journeys.filter((j) => isActiveJourney(j.status));
  const states = active.map((j) => targetState(j.target_date, j.status, today).state);
  return {
    counted: p.journeys, missing: p.missing, completed: journeys.length - active.length, readyPct: p.readyPct, band: readinessBand(p.journeys > 0 ? p.readyPct : null),
    implementedPct: p.implementedPct, implemented: p.implemented, approved: p.approved, applicable: p.applicable, open: p.open,
    dueSoon: states.filter((s) => s === 'overdue' || s === 'soon').length, overdue: states.filter((s) => s === 'overdue').length,
  };
}

/** The line under the heading: true totals, never the length of a page. */
export function headMeta(journeys: number | null, library: number | null): string {
  const part = (n: number | null, one: string, other: string) => (n === null ? null : `${n} ${n === 1 ? one : other}`);
  return [part(journeys, 'journey', 'journeys'), library === null ? null : `${library} in the library`].filter(Boolean).join(' · ');
}

/** The words of a state for a screen reader and a tooltip. */
export const stateWords = (state: string): string => frameworkState.label(state) || statusLabel(state);
