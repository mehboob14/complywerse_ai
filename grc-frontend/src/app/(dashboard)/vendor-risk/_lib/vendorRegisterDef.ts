// The Vendors register's definition (facets, quick chips, sorts, board), apart from React so `node --test` pins it (vendorRegisterDef.test.ts). The rows are
// GET /vendor-risk/vendors?lean=1 read whole: the fields a table shows, the server's own `next_action` and `grade`, and `lifecycle` (General's stage, residual and open
// findings: what the old Vendors > Assessments board drew, now the Board view of this register). The engine is components/records (the same one the Documents library
// and the issue register use); what the server decides (the next action, what "tiered" means, the order of "risk") is read, never worked out a second way.
// Names in the address: q, quick, view, sort(key:dir), page, id, and one per facet: tier status attention owner unit type stage pii class. `archived=1` is the page's
// own (it asks the server for the archived vendors instead). `migrateAddress` keeps every link the old register wrote working.
import { buildSchema, type RegisterDef } from '../../../../components/records/registerModel.ts';
import { vendorGrade, vendorLifecycle, vendorNextStep, vendorTier } from '../../../../lib/statuses/vendor.ts';
import { vendorClassification } from '../../../../lib/statuses/vendorRegister.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';
import { isBeforeToday } from './vendorRules.ts';
import { STAGES } from './lifecycleLogic.ts';

export interface VendorLifecycle {
  assessment_id: number;
  stage: string | null;
  version_no: number | null;
  residual_rating: string | null;
  residual_score: number | null;
  open_findings: number;
  open_critical: number;
}

export interface VendorRow {
  id: number;
  name: string;
  tier: string | null;
  status: string | null;
  vendor_type: string | null;
  industry: string | null;
  website: string | null;
  inherent_risk_score: number | null;
  residual_risk_score: number | null;
  risk_rating: string | null;
  data_access_level: string | null;
  contract_end_date: string | null;
  contract_value: number | null;
  next_reassessment_date: string | null;
  holds_personal_data: boolean | null;
  data_classification: string | null;
  owner_id: number | null;
  owner: { id: number; full_name: string; email?: string } | null;
  business_unit: { id: number; name: string } | null;
  archived_at: string | null;
  intake_status?: string | null;
  /** engagements still in use, General left out */
  open_engagements?: number;
  /** the one thing to do next, worked out on the server; null when nothing waits */
  next_action?: { code: string; label: string; link: string } | null;
  grade?: string | null;
  grade_score?: number | null;
  /** General's active lifecycle; null: none was started */
  lifecycle?: VendorLifecycle | null;
}

export const NONE = 'none';
export const NOT_STARTED = 'not_started';
export const NOT_TIERED = 'not_tiered';
export const UNKNOWN = 'unknown';

type Option = { value: string; label: string };

// ── what a row says ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Tiered by the one rule the server uses for "needs tiering": a score on the supplier. A tier on its own (the one a request starts with) is not a decision. */
export const isTiered = (v: { inherent_risk_score?: number | null }): boolean => typeof v.inherent_risk_score === 'number';
/** The tier a row is filtered and worded by: its tier once it has been tiered, else "not tiered". */
export const tierWord = (v: VendorRow): string => (isTiered(v) && v.tier ? v.tier.toLowerCase() : NOT_TIERED);
export const statusWord = (v: VendorRow): string => (v.status || '').toLowerCase() || NONE;
export const nextWord = (v: VendorRow): string => v.next_action?.code ?? NONE;
export const stageWord = (v: VendorRow): string => (v.lifecycle?.stage ? v.lifecycle.stage : NOT_STARTED);
export const ownerName = (v: VendorRow): string | null => v.owner?.full_name || null;
export const isArchived = (v: VendorRow): boolean => !!v.archived_at;
export const piiWord = (v: VendorRow): string => (v.holds_personal_data === true ? 'yes' : v.holds_personal_data === false ? 'no' : UNKNOWN);
/** A review date in the past is a late review, except for an archived vendor (nothing is expected of it). */
export const reviewIsLate = (v: VendorRow, now: Date = new Date()): boolean => !isArchived(v) && isBeforeToday(v.next_reassessment_date, now);

export const recordHref = (id: number): string => `/vendor-risk/vendors/${id}`;
/** The tiering popup opens from `tier=1`. */
export const tierHref = (id: number): string => `${recordHref(id)}?tab=lifecycle&tier=1`;
export const lifecycleHref = (id: number): string => `${recordHref(id)}?tab=lifecycle`;

/** A website as an address to open: with its scheme, or nothing when there is none. */
export function websiteHref(website?: string | null): string | null {
  const w = String(website ?? '').trim();
  if (!w) return null;
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}

/** The sub-line under a vendor's name: "Software · Marketing analytics". */
export const subline = (v: Pick<VendorRow, 'vendor_type' | 'industry'>): string =>
  [v.vendor_type, v.industry].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');

// ── the stages (the Board's columns) ─────────────────────────────────────────────────────────────────────────────────────

const SHORT: Record<string, string> = {
  intake: 'Intake', tiering: 'Tiering', dd_planning: 'Planning', questionnaire: 'Questionnaire', scoring: 'Scoring', findings: 'Findings',
  contracting: 'Contracting', approval: 'Approval', onboarding: 'Onboarding', monitoring: 'Monitoring', reassessment: 'Reassessment',
};
export const stageShort = (key?: string | null): string => (key === NOT_STARTED || !key ? 'Not started' : SHORT[key] ?? key);
export const stageLabel = (key?: string | null): string => (key === NOT_STARTED || !key ? 'Not started' : STAGES.find((s) => s.key === key)?.label ?? key);
/** "3 of 11 · Planning": where a vendor is in its lifecycle. */
export function stageProgress(key?: string | null): string {
  const at = STAGES.findIndex((s) => s.key === key);
  return at < 0 ? 'Not started' : `${at + 1} of ${STAGES.length} · ${stageShort(key)}`;
}

// ── sorts ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// Worst first, as the server has it (routers/vendors.py _TIER_RANK, _STATUS_RANK): critical, then a vendor nobody has tiered (an unanswered question), then high, medium, low.
const TIER_RANK = (v: VendorRow): number => (v.tier === 'critical' ? 0 : !isTiered(v) ? 1 : v.tier === 'high' ? 2 : v.tier === 'medium' ? 3 : v.tier === 'low' ? 4 : 5);
const STATUS_RANK: Record<string, number> = { suspended: 0, offboarded: 1, terminated: 2, requested: 3, onboarding: 4, active: 5, inactive: 6, retired: 7, rejected: 8 };
const ms = (iso?: string | null): number | null => parseUtc(iso)?.getTime() ?? null;
const pad = (n: number): string => String(n).padStart(2, '0');

/** The server's own order, "risk": worst tier first, the unowned first within a tier, then name. One text key so the engine's tie-break (the id) comes last. */
export const riskKey = (v: VendorRow): string => `${pad(TIER_RANK(v))}${v.owner_id ? '1' : '0'}${v.name.toLowerCase()}`;

// ── the definition ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface VendorCtx {
  /** the signed-in person (the "Mine" chip); null until it is known */
  me: number | null;
  /** the statuses the organisation names for its vendors (Settings), else the built-in ones */
  statuses?: Option[];
  /** the vendor types the organisation lists (Settings) */
  types?: Option[];
}

const BUILTIN_STATUSES = ['active', 'under_review', 'onboarding', 'offboarded', 'suspended'];
const TIERS = ['critical', 'high', 'medium', 'low', NOT_TIERED];
const CLASSES = ['public', 'internal', 'confidential', 'restricted'];

/** The given options in their order, then every other value the rows hold (so a filter can always reach a record), then "none" when a record has no value. */
function optionsFor(given: readonly Option[], seen: Array<string | null | undefined>, labelOf: (v: string) => string, noneLabel: string): Option[] {
  const known = new Set(given.map((o) => o.value));
  const extra = Array.from(new Set(seen.filter((v): v is string => !!v && !known.has(v)))).sort().map((value) => ({ value, label: labelOf(value) }));
  const out = given.concat(extra);
  return seen.some((v) => !v) ? out.concat({ value: NONE, label: noneLabel }) : out;
}

export function vendorDef(ctx: VendorCtx): RegisterDef<VendorRow> {
  const me = ctx.me;
  return {
    key: 'vendor',
    noun: { one: 'vendor', other: 'vendors' },
    idOf: (v) => v.id,
    text: (v) => [v.name, v.vendor_type, v.industry, v.website, ownerName(v), v.business_unit?.name, v.next_action ? vendorNextStep.label(v.next_action.code) : null].filter(Boolean).join(' '),
    facets: [
      { key: 'tier', label: 'Tier', defaultOpen: true, values: (v) => [tierWord(v)], options: () => TIERS.map((value) => ({ value, label: vendorTier.label(value) })) },
      {
        key: 'status', label: 'Status', defaultOpen: true, values: (v) => [statusWord(v)],
        options: (rows) => {
          const given = ctx.statuses?.length ? ctx.statuses : BUILTIN_STATUSES.map((value) => ({ value, label: vendorLifecycle.label(value) }));
          return optionsFor(given, rows.map((v) => v.status && v.status.toLowerCase()), (v) => vendorLifecycle.label(v), 'No status');
        },
      },
      {
        key: 'attention', label: 'Next step', defaultOpen: true, values: (v) => [nextWord(v)],
        options: () => vendorNextStep.words.map((value) => ({ value, label: vendorNextStep.label(value) })).concat({ value: NONE, label: 'Nothing outstanding' }),
      },
      {
        key: 'owner', label: 'Business owner', searchable: true, limit: 7, values: (v) => [v.owner ? String(v.owner.id) : NONE],
        options: (rows) => {
          const seen = new Map<string, string>();
          rows.forEach((v) => { if (v.owner) seen.set(String(v.owner.id), v.owner.full_name || `User ${v.owner.id}`); });
          const list = Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
          return rows.some((v) => !v.owner) ? list.concat({ value: NONE, label: 'Unassigned' }) : list;
        },
      },
      {
        key: 'unit', label: 'Business unit', searchable: true, limit: 7, values: (v) => [v.business_unit ? String(v.business_unit.id) : NONE],
        options: (rows) => {
          const seen = new Map<string, string>();
          rows.forEach((v) => { if (v.business_unit) seen.set(String(v.business_unit.id), v.business_unit.name); });
          const list = Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
          return rows.some((v) => !v.business_unit) ? list.concat({ value: NONE, label: 'No unit' }) : list;
        },
      },
      {
        key: 'type', label: 'Type', searchable: true, limit: 7, values: (v) => [v.vendor_type || NONE],
        options: (rows) => optionsFor(ctx.types ?? [], rows.map((v) => v.vendor_type), (v) => v, 'No type'),
      },
      {
        key: 'stage', label: 'Lifecycle stage', values: (v) => [stageWord(v)],
        options: () => [{ value: NOT_STARTED, label: 'Not started' }].concat(STAGES.map((s) => ({ value: s.key, label: s.label }))),
      },
      {
        key: 'pii', label: 'Personal data',
        values: (v) => [piiWord(v)],
        options: () => [{ value: 'yes', label: 'Holds personal data' }, { value: 'no', label: 'Holds none' }, { value: UNKNOWN, label: 'Not recorded' }],
      },
      {
        key: 'class', label: 'Data classification', values: (v) => [v.data_classification ? v.data_classification.toLowerCase() : NONE],
        options: (rows) => optionsFor(CLASSES.map((value) => ({ value, label: vendorClassification.label(value) })), rows.map((v) => v.data_classification && v.data_classification.toLowerCase()), (v) => vendorClassification.label(v), 'Not classified'),
      },
    ],
    quick: [
      { key: 'tiering', label: 'Needs tiering', test: (v) => v.next_action?.code === 'not_tiered', title: 'Nobody has tiered the vendor yet' },
      { key: 'overdue', label: 'Reassessment overdue', test: (v) => v.next_action?.code === 'reassessment_overdue', title: 'The vendor or one of its engagements was due for reassessment before today' },
      { key: 'lifecycle', label: 'In lifecycle', test: (v) => !!v.lifecycle, title: 'An assessment has started (what the old board showed first)' },
      { key: 'noowner', label: 'No owner', test: (v) => !v.owner && statusWord(v) !== 'retired', title: 'No business owner is named (a retired vendor is left out)' },
      ...(me != null ? [{ key: 'mine', label: 'Mine', test: (v: VendorRow) => v.owner_id === me, title: 'You are the business owner' }] : []),
    ],
    sorts: [
      { key: 'risk', label: 'Highest risk first', firstDir: 'asc', value: riskKey },
      { key: 'name', label: 'Name', firstDir: 'asc', value: (v) => v.name },
      { key: 'tier', label: 'Tier (worst first)', firstDir: 'asc', value: TIER_RANK },
      { key: 'status', label: 'Status', firstDir: 'asc', value: (v) => STATUS_RANK[statusWord(v)] ?? 9 },
      { key: 'grade', label: 'Grade (best first)', firstDir: 'asc', value: (v) => (v.grade ? v.grade : null) },
      { key: 'owner', label: 'Business owner', firstDir: 'asc', value: (v) => ownerName(v) },
      { key: 'next_reassessment', label: 'Next reassessment', firstDir: 'asc', value: (v) => ms(v.next_reassessment_date) },
      { key: 'annual_value', label: 'Annual value', firstDir: 'desc', value: (v) => (typeof v.contract_value === 'number' ? v.contract_value : null) },
    ],
    defaultSort: { key: 'risk', dir: 'asc' },
    board: {
      label: 'Vendors by lifecycle stage',
      columns: STAGES.map((s) => ({ id: s.key, label: stageShort(s.key), test: (v: VendorRow) => v.lifecycle?.stage === s.key })).concat({ id: NOT_STARTED, label: 'Not started', test: (v: VendorRow) => !v.lifecycle }),
    },
    pageSize: 25,
  };
}

export const VENDOR_SCHEMA = buildSchema(vendorDef({ me: 0 }));      // with a person, so every chip key is one the address may name

// ── the address ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const LEGACY_SORTS = ['risk', 'name', 'tier', 'status', 'grade', 'owner', 'next_reassessment', 'annual_value'];

/** The address the old register wrote, said the way this one reads it; null when it is already in the new form. Old: `owner=me` (now the Mine chip), `owner=unassigned`
 *  (now the owner facet's "none"), `pii=1` (now `pii=yes`), `sort=name&dir=desc` (now `sort=name:desc`). Everything else (q, tier, status, attention, type, unit, page,
 *  archived) means what it meant. */
export function migrateAddress(search: string): string | null {
  const params = new URLSearchParams(search);
  let changed = false;
  const owner = (params.get('owner') ?? '').trim();
  if (owner === 'me') {
    params.delete('owner');
    if (!params.get('quick')) params.set('quick', 'mine');
    changed = true;
  } else if (owner === 'unassigned') {
    params.set('owner', NONE);
    changed = true;
  }
  if (params.get('pii') === '1') { params.set('pii', 'yes'); changed = true; }
  const sort = (params.get('sort') ?? '').trim();
  if (params.has('dir') || (sort && !sort.includes(':'))) {
    if (LEGACY_SORTS.includes(sort)) params.set('sort', `${sort}:${params.get('dir') === 'desc' ? 'desc' : 'asc'}`);
    else params.delete('sort');
    params.delete('dir');
    changed = true;
  }
  return changed ? params.toString() : null;
}
