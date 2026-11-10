// What the Findings register works out from its address and its rows: the state the address holds (scope, search, facets, quick views, sort, the finding open in the drawer), which
// findings pass, the live counts of the facet rail (the engine of components/records), the chips that say what is on, the sort, what a row says (due countdown, who, where it came from)
// and the CSV of what is shown. Pure, so `node --test` runs findingsModel.test.ts against it. The register loads every finding of the module once, whole, and this runs over all of them.
//
// The address (every old link keeps working): ?scope=open|accepted|closed|all (without it: open), ?severity=critical (and any of the facets), ?domain=, ?overdue=1 (a quick view now), ?q=, ?sort=,
// ?open=<finding id>. `?page=` is no longer read (the list is not paged by the server any more); it is left alone in the address.

import { flag, integer, listOf, oneOf, sortOf, text, type SortValue } from '../../../../lib/addressState.ts';
import { toCsv } from '../../../../lib/rcsa/csv.ts';
import { formatDate, formatRelative } from '../../../../lib/format.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';
import { indexRows, type Chosen, type FacetIndex, type FacetSpec, type Rule } from '../../../../components/records/facetEngine.ts';
import type { RegisterRow } from './findingsApi.ts';
import { DOMAIN_KEYS, DOMAIN_LABELS } from './tprmShared.ts';
import { isOpen, sourceLabel } from './findingCardModel.ts';

export type RegisterFinding = RegisterRow;

export type Scope = 'open' | 'accepted' | 'closed' | 'all';
export const SCOPES: Array<{ value: Scope; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];
export const asScope = (value: string | null | undefined): Scope => (SCOPES.some((s) => s.value === value) ? (value as Scope) : 'open');

/** Open here is open and in remediation (what the server's `scope=open` is); accepted and closed are decisions. */
const scopeOf = (status: string): 'open' | 'accepted' | 'closed' => (isOpen(status) ? 'open' : status === 'accepted' ? 'accepted' : 'closed');

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export const NO_OWNER = 'none';
export const NO_ENGAGEMENT = 'general';

// ── the address ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type QuickId = 'blocking' | 'overdue' | 'mine' | 'unowned' | 'critical' | 'fixing';
export const QUICK_IDS: readonly QuickId[] = ['blocking', 'overdue', 'mine', 'unowned', 'critical', 'fixing'];
export const QUICK_LABEL: Record<QuickId, string> = {
  blocking: 'Blocking approval', overdue: 'Overdue', mine: 'Mine', unowned: 'Unowned', critical: 'Critical', fixing: 'In remediation',
};
export const QUICK_HINT: Record<QuickId, string> = {
  blocking: 'Open findings that hold a supplier’s approval until they are fixed, accepted or closed',
  overdue: 'Open findings whose fix is past its date',
  mine: 'Open findings you own',
  unowned: 'Open findings nobody owns yet',
  critical: 'Open findings of critical severity',
  fixing: 'Findings with a fix under way',
};

export type SortKey = 'severity' | 'finding' | 'vendor' | 'status' | 'due' | 'owner' | 'raised';
export const SORT_KEYS: readonly SortKey[] = ['severity', 'finding', 'vendor', 'status', 'due', 'owner', 'raised'];
export const SORT_LABEL: Record<SortKey, string> = { severity: 'Severity', finding: 'Finding', vendor: 'Vendor', status: 'Status', due: 'Fix due', owner: 'Owner', raised: 'Raised' };
export const DEFAULT_SORT: { key: SortKey; dir: 'asc' | 'desc' } = { key: 'severity', dir: 'desc' };

/** Defined once, outside any component (useAddressState reads the address again for a new schema). */
export const FINDINGS_SCHEMA = {
  scope: oneOf(SCOPES.map((s) => s.value), 'open' as Scope),
  q: text(),
  severity: listOf(SEVERITIES),
  domain: listOf(DOMAIN_KEYS),
  source: listOf(),
  owner: listOf(),
  vendor: listOf(),
  eng: listOf(),
  quick: listOf(QUICK_IDS),
  sort: sortOf(SORT_KEYS, DEFAULT_SORT as SortValue),
  open: integer(0, { min: 1 }),
  overdue: flag(),                                  // the old "Overdue only": now the Overdue quick view; taken out of the address by the first change
};

export interface Filters {
  scope: Scope; search: string;
  severity: string[]; domain: string[]; source: string[]; owner: string[]; vendor: string[]; engagement: string[];
  quick: QuickId[];
}

export const NO_FILTERS: Filters = { scope: 'open', search: '', severity: [], domain: [], source: [], owner: [], vendor: [], engagement: [], quick: [] };

export interface AddressState {
  scope: Scope; q: string; severity: string[]; domain: string[]; source: string[]; owner: string[]; vendor: string[]; eng: string[]; quick: string[];
  sort: SortValue; open: number; overdue: boolean;
}

export function pageOf(a: AddressState): { filters: Filters; sort: { key: SortKey; dir: 'asc' | 'desc' }; openId: number | null } {
  const quick = (a.quick as QuickId[]).concat(a.overdue && !a.quick.includes('overdue') ? ['overdue' as QuickId] : []);
  return {
    filters: { scope: a.scope, search: a.q, severity: a.severity, domain: a.domain, source: a.source, owner: a.owner, vendor: a.vendor, engagement: a.eng, quick },
    sort: (a.sort ?? DEFAULT_SORT) as { key: SortKey; dir: 'asc' | 'desc' },
    openId: a.open || null,
  };
}

/** The names a change of filters is about (a patch, so two changes in one event compose); the old `overdue` flag is cleared as soon as anything changes. */
export const filtersPatch = (f: Filters): Partial<AddressState> => ({
  scope: f.scope, q: f.search, severity: f.severity, domain: f.domain, source: f.source, owner: f.owner, vendor: f.vendor, eng: f.engagement, quick: f.quick, overdue: false,
});

/** How many filters are on: a search, a facet value, a quick view (the scope is a view, not a filter). */
export function filterCount(f: Filters): number {
  return f.severity.length + f.domain.length + f.source.length + f.owner.length + f.vendor.length + f.engagement.length + f.quick.length + (f.search.trim() ? 1 : 0);
}
export const isFiltering = (f: Filters): boolean => filterCount(f) > 0;

// ── what a finding is, for the filters ──────────────────────────────────────────────────────────────────────────────────

export const isBlocking = (r: RegisterRow): boolean => isOpen(r.status) && !!r.is_blocking;
export const isLate = (r: RegisterRow): boolean => isOpen(r.status) && !!r.overdue;

export function inQuick(id: QuickId, r: RegisterRow, me: number | null): boolean {
  switch (id) {
    case 'blocking': return isBlocking(r);
    case 'overdue': return isLate(r);
    case 'mine': return me != null && isOpen(r.status) && r.owner?.id === me;
    case 'unowned': return isOpen(r.status) && !r.owner;
    case 'critical': return isOpen(r.status) && r.severity === 'critical';
    case 'fixing': return r.status === 'in_remediation';
  }
}

export type FacetKey = 'severity' | 'domain' | 'owner' | 'vendor' | 'source' | 'engagement';
/** The facets in the order the rail lists them. */
export const RAIL_ORDER: readonly FacetKey[] = ['severity', 'domain', 'owner', 'vendor', 'source', 'engagement'];
export const FACET_TITLE: Record<FacetKey, string> = { severity: 'Severity', domain: 'Domain', owner: 'Owner', vendor: 'Vendor', source: 'Source', engagement: 'About' };
export const OPEN_AT_FIRST: readonly FacetKey[] = ['severity', 'owner', 'vendor'];
export const SEARCHABLE: readonly FacetKey[] = ['owner', 'vendor', 'engagement', 'domain'];

/** The facets over the rows. `scope` is an engine facet the rail does not list: the Open | Accepted | Closed | All switch reads its live counts from it. */
export function findingSpecs(): FacetSpec<RegisterRow>[] {
  return [
    { key: 'scope', values: (r) => [scopeOf(r.status)] },
    { key: 'severity', values: (r) => [r.severity] },
    { key: 'domain', values: (r) => [r.domain] },
    { key: 'owner', values: (r) => [r.owner ? String(r.owner.id) : NO_OWNER] },
    { key: 'vendor', values: (r) => [String(r.vendor_id)] },
    { key: 'source', values: (r) => [r.source || 'manual'] },
    { key: 'engagement', values: (r) => [r.engagement ? String(r.engagement.id) : NO_ENGAGEMENT] },
  ];
}

const fold = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** What a search looks in: the finding, the vendor, the owner, the severity and status, the domain and where it came from. */
export const haystack = (r: RegisterRow): string =>
  fold([r.title, r.vendor_name, r.owner?.name, r.severity, r.status.replace(/_/g, ' '), DOMAIN_LABELS[r.domain], sourceLabel(r.source), r.engagement?.name].filter(Boolean).join(' '));
export const searchTerms = (q: string): string[] => fold(q).split(/\s+/).filter(Boolean);

export const indexFindings = (rows: readonly RegisterRow[]): FacetIndex<RegisterRow> => indexRows(rows, findingSpecs(), haystack);

export function chosenOf(f: Filters): Chosen {
  return {
    scope: f.scope === 'all' ? [] : [f.scope], severity: f.severity, domain: f.domain, owner: f.owner, vendor: f.vendor, source: f.source, engagement: f.engagement,
  };
}

/** What every finding must pass besides the facets: the search words, and every quick view that is on. */
export function ruleOf(f: Filters, me: number | null): Rule<RegisterRow> {
  return {
    terms: searchTerms(f.search),
    extra: f.quick.length > 0 ? (r) => f.quick.every((id) => inQuick(id, r, me)) : undefined,
  };
}

// ── the options of the rail ──────────────────────────────────────────────────────────────────────────────────────────────

export interface Option { value: string; label: string; title?: string }

const byLabel = (a: Option, b: Option): number => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });

/** The options of every facet: the ones with a finding in the rows (a vendor nobody has a finding on is not offered), the words a person reads. */
export function railOptions(rows: readonly RegisterRow[]): Record<FacetKey, Option[]> {
  const owners = new Map<string, string>();
  const vendors = new Map<string, string>();
  const engagements = new Map<string, string>();
  const sources = new Set<string>();
  const domains = new Set<string>();
  rows.forEach((r) => {
    if (r.owner) owners.set(String(r.owner.id), r.owner.name?.trim() || 'A former colleague');
    vendors.set(String(r.vendor_id), r.vendor_name?.trim() || 'A vendor no longer here');
    if (r.engagement) engagements.set(String(r.engagement.id), r.engagement.name?.trim() || 'An engagement no longer here');
    sources.add(r.source || 'manual');
    domains.add(r.domain);
  });
  const list = (m: Map<string, string>): Option[] => Array.from(m, ([value, label]) => ({ value, label })).sort(byLabel);
  return {
    severity: SEVERITIES.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
    domain: DOMAIN_KEYS.filter((k) => domains.has(k)).map((v) => ({ value: v, label: DOMAIN_LABELS[v] })).concat(Array.from(domains).filter((k) => !DOMAIN_KEYS.includes(k)).map((v) => ({ value: v, label: sourceLabelFor(v) }))),
    owner: list(owners).concat([{ value: NO_OWNER, label: 'Unassigned' }]),
    vendor: list(vendors),
    source: Array.from(sources).map((v) => ({ value: v, label: sourceLabel(v) })).sort(byLabel),
    engagement: [{ value: NO_ENGAGEMENT, label: 'The vendor itself' }].concat(list(engagements)),
  };
}
const sourceLabelFor = (s: string): string => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Options in the order the rail draws them: the ones with findings, and a chosen one kept (dimmed, count 0) while it is chosen. */
export function orderedOptions(options: readonly Option[], chosen: readonly string[], count: (value: string) => number): Option[] {
  const have = options.filter((o) => count(o.value) > 0 || chosen.includes(o.value));
  return have.length ? have : options.slice();
}

// ── chips ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Chip { key: string; label: string; group: FacetKey | 'search' | 'quick'; value?: string }

export function filterChips(f: Filters, options: Record<FacetKey, Option[]>): Chip[] {
  const chips: Chip[] = [];
  if (f.search.trim()) chips.push({ key: 'search', group: 'search', label: `Search: ${f.search.trim()}` });
  f.quick.forEach((q) => chips.push({ key: `quick:${q}`, group: 'quick', value: q, label: QUICK_LABEL[q] }));
  RAIL_ORDER.forEach((g) => f[g].forEach((v) => {
    const o = options[g].find((x) => x.value === v);
    chips.push({ key: `${g}:${v}`, group: g, value: v, label: `${FACET_TITLE[g]}: ${o?.label ?? v}` });
  }));
  return chips;
}

export function removeChip(f: Filters, chip: Chip): Filters {
  if (chip.group === 'search') return { ...f, search: '' };
  if (chip.group === 'quick') return { ...f, quick: f.quick.filter((q) => q !== chip.value) };
  return { ...f, [chip.group]: (f[chip.group] as string[]).filter((v) => v !== chip.value) } as Filters;
}

/** A facet value chosen or taken away (the rail's check box); a facet key of the rail is a key of the filters, but for the engagement. */
export function toggleFacet(f: Filters, facet: string, value: string): Filters {
  const key = facet as FacetKey;
  const cur = f[key];
  return { ...f, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
}

// ── sorting ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const when = (iso: string | null | undefined): number => parseUtc(iso)?.getTime() ?? Number.POSITIVE_INFINITY;
const STATUS_RANK: Record<string, number> = { open: 0, in_remediation: 1, accepted: 2, closed: 3 };
const collate = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The findings in the order asked: the default is the worst first, then the one that is late or due soonest, then the newest. A tie ends with the newest first. Never reorders its argument. */
export function sortFindings(rows: readonly RegisterRow[], sort: { key: SortKey; dir: 'asc' | 'desc' }): RegisterRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const cmp = (a: RegisterRow, b: RegisterRow): number => {
    switch (sort.key) {
      case 'severity': return (SEVERITY_RANK[a.severity] ?? 0) - (SEVERITY_RANK[b.severity] ?? 0) || Number(isLate(a)) - Number(isLate(b)) || when(b.due_date) - when(a.due_date);
      case 'finding': return collate.compare(a.title || '', b.title || '');
      case 'vendor': return collate.compare(a.vendor_name || '', b.vendor_name || '');
      case 'status': return (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
      case 'due': {                                                  // nothing due comes last whichever way it runs
        const x = when(a.due_date);
        const y = when(b.due_date);
        if (x === y) return 0;
        if (x === Number.POSITIVE_INFINITY) return 2 * sign;
        if (y === Number.POSITIVE_INFINITY) return -2 * sign;
        return x - y;
      }
      case 'owner': {                                                // nobody comes last whichever way it runs
        if (!a.owner !== !b.owner) return (a.owner ? -2 : 2) * sign;
        return collate.compare(a.owner?.name || '', b.owner?.name || '');
      }
      case 'raised': return when(a.created_at) - when(b.created_at);
    }
  };
  return [...rows].sort((a, b) => sign * cmp(a, b) || b.id - a.id);
}

// ── what a row says ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DueView { text: string; title: string; late: boolean }

/** The fix-due cell: a countdown ("in 9 days", "12 days ago"), the date for the tooltip, and red only while the finding is open and late (the server's overdue flag, else the date itself). Nothing due: a dash. */
export function dueView(f: { due_date?: string | null; status: string; overdue?: boolean }, today: Date = new Date()): DueView {
  if (!f.due_date) return { text: '—', title: '', late: false };
  const text = formatRelative(f.due_date, today, { calendar: true });
  return { text: text || '—', title: formatDate(f.due_date, { calendar: true }), late: isOpen(f.status) && (typeof f.overdue === 'boolean' ? f.overdue : text.endsWith(' ago')) };
}

/** "until 5 Mar 2026" under an accepted finding's status. */
export const acceptedLine = (f: { status: string; accepted_until?: string | null }): string | null =>
  f.status === 'accepted' && f.accepted_until ? `until ${formatDate(f.accepted_until, { calendar: true })}` : null;

export const vendorHref = (f: { vendor_id: number }): string => `/vendor-risk/vendors/${f.vendor_id}?tab=findings`;
/** The finding on its supplier's Findings tab: the page that holds the depth the drawer does not (the lifecycle, the other findings). */
export const recordHref = (f: { vendor_id: number; id: number }): string => `/vendor-risk/vendors/${f.vendor_id}?tab=findings&finding=${f.id}`;

/** "12 findings · 2 blocking approval": what the head says about what is open, from the whole register. */
export function headLine(rows: readonly RegisterRow[]): string {
  const open = rows.filter((r) => isOpen(r.status)).length;
  const blocking = rows.filter(isBlocking).length;
  return `${open.toLocaleString('en-US')} open${blocking > 0 ? ` · ${blocking.toLocaleString('en-US')} blocking approval` : ''}`;
}

/** What an empty list says: nothing in this scope at all, or nothing matching the filters. */
export function emptyCopy(scope: Scope, filtered: boolean): { title: string; hint: string } {
  if (filtered) return { title: 'No findings match', hint: 'Loosen a filter, or search for other words.' };
  if (scope === 'open') return { title: 'No open findings', hint: 'Findings are raised from questionnaire scoring, document reviews, missed service levels and by hand.' };
  return { title: 'Nothing in this view', hint: 'Try another view.' };
}

// ── export ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const CSV_HEADER = ['Severity', 'Finding', 'Vendor', 'Domain', 'Status', 'Fix due', 'Owner', 'Source', 'About', 'Blocks approval', 'Raised'];

/** The CSV of the findings shown, in the order shown: the words of the screen, a date as written, a cell that starts like a formula made harmless. */
export function csvOf(rows: readonly RegisterRow[]): string {
  return toCsv(CSV_HEADER, rows.map((r) => [
    r.severity, r.title || 'Untitled finding', r.vendor_name || '', DOMAIN_LABELS[r.domain] || r.domain, r.status.replace(/_/g, ' '), r.due_date ? formatDate(r.due_date, { calendar: true }) : '',
    r.owner?.name || '', sourceLabel(r.source), r.engagement?.name || 'The vendor itself', r.is_blocking ? 'Yes' : 'No', r.created_at ? formatDate(r.created_at) : '',
  ]));
}

export const exportName = (today: Date = new Date()): string => `vendor-findings-${today.toISOString().slice(0, 10)}.csv`;

