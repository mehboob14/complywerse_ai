// What the Register works out from its address and its rows: the filters and the page the address names (and the address a change
// of filter makes), the server's sort and its three-click header cycle, which columns show, what a row's cells say. Pure, so
// `node --test` runs registerModel.test.ts against it. Names in the address: q, attention, tier, status, type, owner, pii, unit,
// archived, sort, dir, page (a filter's change always returns to page 1).

import { fmt } from '../_ui/fmt.ts';
import type { Tone } from '../_ui/tones.ts';
import type { ParamPatch } from '../_ui/urlParams.ts';
import { ATTENTION_CODES, attentionTone } from './attention.ts';

export const PAGE_SIZE = 25;
export const TIERS = ['critical', 'high', 'medium', 'low'] as const;

// ── sorting ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SortKey = 'name' | 'tier' | 'status' | 'grade' | 'owner' | 'next_reassessment' | 'annual_value';
export const SORT_KEYS: readonly SortKey[] = ['name', 'tier', 'status', 'grade', 'owner', 'next_reassessment', 'annual_value'];

/** `key: null` is the server's own order (`sort=risk`: worst tier first, the unowned first within a tier). */
export interface Sort { key: SortKey | null; dir: 'asc' | 'desc' }

/** A header click: another column starts ascending; the same one goes descending, then back to the server's own order. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: 'asc' };
}

export const ariaSort = (current: Sort, key: SortKey): 'ascending' | 'descending' | 'none' =>
  current.key !== key ? 'none' : current.dir === 'asc' ? 'ascending' : 'descending';

// ── filters, page and the address ────────────────────────────────────────────────────────────────────────────────────────

export interface Filters {
  q: string;
  attention: string[];
  tier: string[];
  status: string[];
  type: string | null;
  owner: string | null;
  pii: boolean;
  unit: string[];
  archived: boolean;
}
export interface RegisterState extends Filters { sort: Sort; page: number }

interface Reader { get(key: string): string | null; getAll(key: string): string[] }

const once = (values: string[]): string[] => Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));

/** The state an address names. What it cannot make sense of (an unknown tier, a page of "abc") is left out, never guessed. */
export function readState(p: Reader): RegisterState {
  const owner = (p.get('owner') ?? '').trim();
  const key = SORT_KEYS.find((k) => k === p.get('sort')) ?? null;
  const page = Number.parseInt(p.get('page') ?? '', 10);
  return {
    q: (p.get('q') ?? '').trim(),
    attention: once(p.getAll('attention')).filter((c) => ATTENTION_CODES.includes(c)),
    tier: once(p.getAll('tier')).filter((t) => (TIERS as readonly string[]).includes(t)),
    status: once(p.getAll('status')),
    type: (p.get('type') ?? '').trim() || null,
    owner: owner === 'me' || owner === 'unassigned' || /^\d+$/.test(owner) ? owner : null,
    pii: p.get('pii') === '1',
    unit: once(p.getAll('unit')).filter((u) => /^\d+$/.test(u)),
    archived: p.get('archived') === '1',
    sort: { key, dir: key && p.get('dir') === 'desc' ? 'desc' : 'asc' },
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** The address change for a change of filter(s): the ones named are set (empty removes), the page goes back to 1. */
export function filterPatch(change: Partial<Filters>): ParamPatch {
  const out: ParamPatch = { page: null };
  if ('q' in change) out.q = change.q?.trim() || null;
  if ('attention' in change) out.attention = change.attention ?? [];
  if ('tier' in change) out.tier = change.tier ?? [];
  if ('status' in change) out.status = change.status ?? [];
  if ('type' in change) out.type = change.type || null;
  if ('owner' in change) out.owner = change.owner || null;
  if ('pii' in change) out.pii = change.pii ? '1' : null;
  if ('unit' in change) out.unit = change.unit ?? [];
  if ('archived' in change) out.archived = change.archived ? '1' : null;
  return out;
}

/** "Clear filters": every filter and the page (the sort stays, it is not a filter). */
export const CLEAR_FILTERS: ParamPatch = filterPatch({ q: '', attention: [], tier: [], status: [], type: null, owner: null, pii: false, unit: [], archived: false });

export const sortPatch = (sort: Sort): ParamPatch => ({ sort: sort.key, dir: sort.key && sort.dir === 'desc' ? 'desc' : null, page: null });

export function hasFilters(f: Filters): boolean {
  return !!(f.q || f.attention.length || f.tier.length || f.status.length || f.type || f.owner || f.pii || f.unit.length || f.archived);
}

/** The query the server is asked: one page, in the sort the address names (risk order without one). */
export function listParams(s: RegisterState): Record<string, string | number | boolean | Array<string | number> | undefined> {
  return {
    search: s.q || undefined,
    tier: s.tier.length ? s.tier : undefined,
    status: s.status.length ? s.status : undefined,
    attention: s.attention.length ? s.attention : undefined,
    vendor_type: s.type ?? undefined,
    owner: s.owner ?? undefined,
    holds_personal_data: s.pii ? true : undefined,
    business_unit_id: s.unit.length ? s.unit.map(Number) : undefined,
    archived_only: s.archived ? true : undefined,
    sort: s.sort.key ?? 'risk',
    dir: s.sort.dir,
    skip: (s.page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  };
}

// ── columns ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ColumnId = 'vendor' | 'tier' | 'status' | 'next_action' | 'grade' | 'owner' | 'business_unit' | 'classification'
  | 'next_reassessment' | 'annual_value' | 'risk_rating' | 'lifecycle' | 'data_access' | 'contract_end';

export interface Column {
  id: ColumnId;
  label: string;
  /** the sort a click on its header asks the server for */
  sort?: SortKey;
  right?: boolean;
  /** shown whatever the chooser says */
  always?: boolean;
  /** shown until the person hides it */
  shown: boolean;
}

// Verity's columns first, then Compliverse's own (they start hidden: what it had, one click away).
export const COLUMNS: Column[] = [
  { id: 'vendor', label: 'Vendor', sort: 'name', always: true, shown: true },
  { id: 'tier', label: 'Tier', sort: 'tier', shown: true },
  { id: 'status', label: 'Status', sort: 'status', shown: true },
  { id: 'next_action', label: 'Blocker / next action', always: true, shown: true },
  { id: 'grade', label: 'Grade', sort: 'grade', shown: true },
  { id: 'owner', label: 'Business owner', sort: 'owner', shown: true },
  { id: 'business_unit', label: 'Business unit', shown: false },
  { id: 'classification', label: 'Classification', shown: false },
  { id: 'next_reassessment', label: 'Next reassessment', sort: 'next_reassessment', shown: true },
  { id: 'annual_value', label: 'Annual value', sort: 'annual_value', right: true, shown: false },
  { id: 'risk_rating', label: 'Risk rating', shown: false },
  { id: 'lifecycle', label: 'Lifecycle', shown: false },
  { id: 'data_access', label: 'Data access', shown: false },
  { id: 'contract_end', label: 'Contract end', shown: false },
];

/** Where the chooser's pick is kept (this browser only). */
export const COLUMNS_KEY = 'compliverse.vendors.columns';

const inOrder = (ids: Iterable<string>): ColumnId[] => {
  const want = new Set(ids);
  return COLUMNS.filter((c) => c.always || want.has(c.id)).map((c) => c.id);
};

export const defaultColumns = (): ColumnId[] => inOrder(COLUMNS.filter((c) => c.shown).map((c) => c.id));

/** The columns a stored pick names, in the table's order, with the ones that cannot be hidden. Anything unreadable is the default. */
export function parseColumns(raw: string | null | undefined): ColumnId[] {
  try {
    const list: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(list) || !list.every((x) => typeof x === 'string')) return defaultColumns();
    return inOrder(list);
  } catch {
    return defaultColumns();
  }
}

export const toggleColumn = (visible: ColumnId[], id: ColumnId): ColumnId[] =>
  COLUMNS.find((c) => c.id === id)?.always ? inOrder(visible) : inOrder(visible.includes(id) ? visible.filter((v) => v !== id) : [...visible, id]);

/** "5/12" for the chooser's button: the columns that can be hidden, how many show. */
export function columnCount(visible: ColumnId[]): { shown: number; total: number } {
  const optional = COLUMNS.filter((c) => !c.always);
  return { shown: optional.filter((c) => visible.includes(c.id)).length, total: optional.length };
}

// ── what a row says ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Tiered by the one rule the server uses for "needs tiering": a score on the supplier. A tier on its own (the one a request
 *  starts with) is not a decision. */
export const isTiered = (v: { inherent_risk_score?: number | null }): boolean => typeof v.inherent_risk_score === 'number';

export interface NextActionCell {
  kind: 'archived' | 'none' | 'action';
  label: string;
  href: string | null;
  tone: Tone;
}

/** The blocker cell: the server's one next action, in its colour family; "Nothing outstanding" when none waits. */
export function nextActionCell(v: { archived_at?: string | null; next_action?: { code: string; label: string; link: string } | null }): NextActionCell {
  if (v.archived_at) return { kind: 'archived', label: 'Archived', href: null, tone: 'neutral' };
  if (!v.next_action) return { kind: 'none', label: 'Nothing outstanding', href: null, tone: 'success' };
  return { kind: 'action', label: v.next_action.label, href: v.next_action.link, tone: attentionTone(v.next_action.code) };
}

/** Verity's colours for a classification: public and internal grey, confidential amber, restricted red. */
export function classificationTone(value?: string | null): Tone {
  const v = String(value ?? '').trim().toLowerCase();
  return v === 'restricted' ? 'danger' : v === 'confidential' ? 'warning' : 'neutral';
}

/** A day picked on a form is stored as a moment at midnight ("2027-01-31T00:00:00"): shown as the viewer's own day it would slip to
 *  the 30th west of UTC, so it is read as the day it was written. Any other moment (a computed review date) stays a moment. */
export function asDay(value?: string | null): string | null {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}T00:00:00(\.0+)?$/.test(text) ? text.slice(0, 10) : text || null;
}

/** Whether a stored date is behind us (a date with no time is that calendar day). */
export const isPast = (date?: string | null, today?: Date): boolean => fmt.countdown(date, today).endsWith(' ago');

/** The sub-line under a vendor's name: "Vendor · Monitoring". */
export const vendorSubline = (v: { vendor_type?: string | null; industry?: string | null }): string =>
  [v.vendor_type, v.industry].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');

export const recordHref = (id: number): string => `/vendor-risk/vendors/${id}`;
/** C3: the lifecycle opens the tiering popup (`tier=1`). */
export const tierHref = (id: number): string => `${recordHref(id)}?tab=lifecycle&tier=1`;
export const lifecycleHref = (id: number): string => `${recordHref(id)}?tab=lifecycle`;

/** A website as an address to open: with its scheme, or nothing when there is none. */
export function websiteHref(website?: string | null): string | null {
  const w = String(website ?? '').trim();
  if (!w) return null;
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}
