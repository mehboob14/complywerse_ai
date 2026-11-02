/**
 * Shared, framework-free helpers for the Software Licenses register: enums,
 * status → tone mapping, date / expiry maths, sort + filter predicates and the
 * entitlement form model. Nothing here touches React state or the network.
 *
 * Honesty rule carried through the whole module: a status string the UI does not
 * recognise is shown verbatim (humanised, neutral grey) — never coerced into
 * "compliant" or "non-compliant" on a guess.
 */
import type { CSSProperties } from 'react';
import type { LicenseEntitlement, LicenseEntitlementInput } from '@/cyber-assurance/lib/api';
import { BAND, SEV, T, type Tone } from '../../dashboard/_components/kit';

/* ─── permissions ───────────────────────────────────────────────────────
   The license module has no permission namespace of its own yet (the API only
   requires a signed-in user), so the UI rides on the IT-asset inventory
   permissions — same audience. One place to change if a dedicated `licenses:*`
   namespace is added. */
export const LICENSE_PERMS = {
  view: 'assets:asset_inventory:*',
  create: 'assets:asset_inventory:create',
  edit: 'assets:asset_inventory:edit',
  delete: 'assets:asset_inventory:delete',
} as const;

/* ─── enums (mirror the backend vocabulary) ─────────────────────────────── */
export type Option = { value: string; label: string };

export const LICENSE_TYPES: Option[] = [
  { value: 'perpetual', label: 'Perpetual' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'volume', label: 'Volume (VL)' },
  { value: 'oem', label: 'OEM' },
  { value: 'saas', label: 'SaaS' },
  { value: 'open_source', label: 'Open source' },
  { value: 'trial', label: 'Trial' },
];

export const LICENSE_METRICS: Option[] = [
  { value: 'per_device', label: 'Per device' },
  { value: 'per_user_named', label: 'Per user (named)' },
  { value: 'per_user_concurrent', label: 'Per user (concurrent)' },
  { value: 'per_core', label: 'Per core' },
  { value: 'per_socket', label: 'Per socket' },
  { value: 'per_processor', label: 'Per processor' },
  { value: 'per_cal', label: 'Per CAL' },
  { value: 'per_installation', label: 'Per installation' },
  { value: 'usage', label: 'Usage-based' },
];

/** What each metric means in licensing terms (a definition, not a claim about how ComplyVerse counts). */
export const METRIC_HINT: Record<string, string> = {
  per_device: 'Counted per device the software is installed on.',
  per_user_named: 'Counted per named user, however many devices they use.',
  per_user_concurrent: 'Counted by the peak number of simultaneous users.',
  per_core: 'Counted per CPU core on the hosts that run the software.',
  per_socket: 'Counted per physical CPU socket on the hosts that run it.',
  per_processor: 'Counted per processor on the hosts that run the software.',
  per_cal: 'Client Access License: counted per user or device that connects to the server.',
  per_installation: 'Counted per installation of the software.',
  usage: 'Metered by actual usage (calls, hours, GB) rather than by seats.',
};

/** Metrics an installed-software scan cannot count — the backend reports these as "not measured". */
export const UNMEASURED_METRICS = ['per_cal', 'per_user_concurrent', 'usage'];

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'PKR', 'AED', 'SAR'];

export const humanize = (s?: string | null): string => {
  const t = String(s ?? '').replace(/[_-]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};
export const optionLabel = (list: Option[], value?: string | null): string =>
  list.find((o) => o.value === value)?.label ?? (humanize(value) || '—');

/** The option list plus the record's current value when it is not a known one — so
    editing a row never silently rewrites a type/metric/currency this UI doesn't list. */
export const withCurrent = (list: Option[], current?: string | null): Option[] =>
  current && !list.some((o) => o.value === current) ? [...list, { value: current, label: humanize(current) }] : list;

/* ─── status ────────────────────────────────────────────────────────────── */
export type StatusKey =
  | 'compliant' | 'active' | 'over_deployed' | 'under_licensed' | 'unlicensed'
  | 'expiring' | 'expired' | 'over_licensed' | 'not_measured' | 'pending' | 'retired' | 'unknown';

const STATUS_ALIAS: Record<string, StatusKey> = {
  compliant: 'compliant', licensed: 'compliant',
  active: 'active',
  over_deployed: 'over_deployed', overdeployed: 'over_deployed', non_compliant: 'over_deployed', noncompliant: 'over_deployed',
  under_licensed: 'under_licensed', underlicensed: 'under_licensed',
  unlicensed: 'unlicensed', unmanaged: 'unlicensed',
  expiring: 'expiring', expiring_soon: 'expiring',
  expired: 'expired',
  over_licensed: 'over_licensed', overlicensed: 'over_licensed', surplus: 'over_licensed', shelfware: 'over_licensed',
  not_measured: 'not_measured', notmeasured: 'not_measured',
  pending: 'pending',
  retired: 'retired', inactive: 'retired',
};

/** Canonical form of a raw status string — also the value filters compare against, so two
    spellings of the same status filter together and two unrecognised ones stay distinct. */
export const normStatus = (s?: string | null): string => String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

export const statusKey = (s?: string | null): StatusKey => STATUS_ALIAS[normStatus(s)] ?? 'unknown';

const GOOD = { c: BAND.contained.c, ink: BAND.contained.ink, bg: BAND.contained.bg };
const TONES: Record<StatusKey, Tone> = {
  compliant: { ...GOOD, label: 'Compliant' },
  active: { ...GOOD, label: 'Active' },
  over_deployed: { ...SEV.critical, label: 'Over-deployed' },
  under_licensed: { ...SEV.critical, label: 'Under-licensed' },
  unlicensed: { ...SEV.critical, label: 'Unlicensed' },
  expiring: { ...SEV.medium, label: 'Expiring' },
  expired: { ...SEV.high, label: 'Expired' },
  over_licensed: { ...SEV.low, label: 'Over-licensed' },
  not_measured: { ...SEV.info, label: 'Not measured' },
  pending: { ...SEV.info, label: 'Pending' },
  retired: { ...SEV.info, label: 'Retired' },
  unknown: { ...SEV.info, label: 'Unknown' },
};

/** Plain-language meaning of each status, shown as a tooltip on the pill. */
const STATUS_HINT: Partial<Record<StatusKey, string>> = {
  compliant: 'The licenses owned cover what is installed.',
  over_deployed: 'More is installed than is licensed.',
  under_licensed: 'More is installed than is licensed.',
  unlicensed: 'Installed, with no entitlement on record.',
  expiring: 'A licence or its support ends within 90 days.',
  expired: 'No live entitlement — the term has ended.',
  over_licensed: 'Well more is owned than is installed — surplus that could be reclaimed.',
  not_measured: "This metric (CALs, concurrent users, usage) can't be counted from installed-software scans, so no position is computed.",
  pending: "The term hasn't started yet, so it isn't counted.",
  retired: 'Retired — excluded from every figure.',
};
export const statusHint = (s?: string | null): string | undefined => STATUS_HINT[statusKey(s)];

export function statusTone(s?: string | null): Tone {
  const k = statusKey(s);
  return k === 'unknown' && s ? { ...TONES.unknown, label: humanize(s) } : TONES[k];
}

/** Worst-first ordering for the default sort. */
const SEVERITY: Record<StatusKey, number> = {
  over_deployed: 0, under_licensed: 1, unlicensed: 2, expired: 3, expiring: 4, over_licensed: 5,
  not_measured: 6, pending: 7, unknown: 8, active: 9, compliant: 10, retired: 11,
};
export const statusRank = (s?: string | null): number => SEVERITY[statusKey(s)];

/** True when scans cannot count this product's metric — so consumed / position must not be shown as figures. */
export const isUnmeasured = (x: { measured?: boolean; status?: string | null }): boolean =>
  x.measured === false || statusKey(x.status) === 'not_measured';

/* ─── dates ─────────────────────────────────────────────────────────────── */
/** 'YYYY-MM-DD…' → that calendar day at local midnight (no timezone shift of the day). */
export function parseDay(s?: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(String(s));
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole days from today to that day (negative = in the past). */
export function daysUntil(s?: string | null): number | null {
  const d = parseDay(s);
  if (!d) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export const fmtDate = (s?: string | null): string => {
  const d = parseDay(s);
  return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
};

/** Value for <input type="date">. */
export const dateInput = (s?: string | null): string => (s ? String(s).slice(0, 10) : '');

/** "in 12d" / "expired 4d ago" with a colour that escalates as the date nears. */
export function relativeDay(s?: string | null): { text: string; color: string; bold: boolean } | null {
  const n = daysUntil(s);
  if (n == null) return null;
  if (n < 0) return { text: `expired ${-n}d ago`, color: T.danger, bold: true };
  if (n === 0) return { text: 'expires today', color: T.danger, bold: true };
  if (n <= 30) return { text: `in ${n}d`, color: T.warning, bold: true };
  if (n <= 90) return { text: `in ${n}d`, color: T.warning, bold: false };
  return { text: n < 730 ? `in ${Math.round(n / 30)}mo` : `in ${Math.round(n / 365)}y`, color: T.muted, bold: false };
}

/** Days to the nearer of the licence expiry and the maintenance / support expiry. */
export function earliestDays(e: Pick<LicenseEntitlement, 'expiry_date' | 'maintenance_expiry'>): number | null {
  const a = daysUntil(e.expiry_date);
  const b = daysUntil(e.maintenance_expiry);
  return a == null ? b : b == null ? a : Math.min(a, b);
}

/* ─── filters + sort ────────────────────────────────────────────────────── */
export type ExpiryFilter = 'any' | 'expired' | '30' | '60' | '90' | 'none';
export const EXPIRY_OPTIONS: { value: ExpiryFilter; label: string }[] = [
  { value: 'any', label: 'Any expiry' },
  { value: 'expired', label: 'Already expired' },
  { value: '30', label: 'Expiring within 30 days' },
  { value: '60', label: 'Expiring within 60 days' },
  { value: '90', label: 'Expiring within 90 days' },
  { value: 'none', label: 'No expiry date' },
];

export function matchesExpiry(e: Pick<LicenseEntitlement, 'expiry_date' | 'maintenance_expiry'>, f: ExpiryFilter): boolean {
  if (f === 'any') return true;
  const d = earliestDays(e);
  if (f === 'none') return d == null;
  if (d == null) return false;
  if (f === 'expired') return d < 0;
  return d >= 0 && d <= Number(f);
}

export type SortKey =
  | 'publisher' | 'product' | 'edition' | 'type' | 'metric'
  | 'entitled' | 'consumed' | 'position' | 'status' | 'expiry' | 'cost';
export type SortState = { key: SortKey; dir: 'asc' | 'desc' };

function sortValue(e: LicenseEntitlement, key: SortKey): string | number | null {
  switch (key) {
    case 'publisher': return e.publisher || null;
    case 'product': return e.product || null;
    case 'edition': return e.edition || null;
    case 'type': return optionLabel(LICENSE_TYPES, e.license_type);
    case 'metric': return optionLabel(LICENSE_METRICS, e.license_metric);
    case 'entitled': return e.total_quantity ?? null;
    case 'consumed': return isUnmeasured(e) ? null : e.consumed ?? null;
    case 'position': return isUnmeasured(e) ? null : e.position ?? null;
    case 'status': return e.status ? statusRank(e.status) : null;
    case 'expiry': return earliestDays(e);
    case 'cost': return e.unit_cost ?? null;
  }
}

/** Empty values sort last in either direction; ties fall back to publisher → product. */
export function compareEntitlements(a: LicenseEntitlement, b: LicenseEntitlement, s: SortState): number {
  const va = sortValue(a, s.key);
  const vb = sortValue(b, s.key);
  if (va == null && vb != null) return 1;
  if (va != null && vb == null) return -1;
  let c = 0;
  if (va != null && vb != null) {
    c = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
    if (s.dir === 'desc') c = -c;
  }
  return c !== 0 ? c : `${a.publisher} ${a.product}`.localeCompare(`${b.publisher} ${b.product}`, undefined, { sensitivity: 'base' });
}

/** The currency most entitlements are priced in — the fallback for money shown where the API gives none. */
export function dominantCurrency(rows: Array<{ currency?: string | null }>): string {
  const count: Record<string, number> = {};
  rows.forEach((r) => { const c = (r.currency || 'USD').toUpperCase(); count[c] = (count[c] ?? 0) + 1; });
  let best = 'USD';
  let n = 0;
  Object.keys(count).forEach((c) => { if (count[c] > n) { best = c; n = count[c]; } });
  return best;
}

/* ─── form model ────────────────────────────────────────────────────────── */
export type EntitlementForm = {
  publisher: string; product: string; edition: string;
  license_type: string; license_metric: string; total_quantity: string;
  unit_cost: string; currency: string;
  purchase_date: string; start_date: string; expiry_date: string; maintenance_expiry: string;
  po_reference: string; contract_reference: string; reseller: string; notes: string;
  software_key: string;
};
export type FormErrors = Partial<Record<keyof EntitlementForm, string>>;

export const emptyForm = (over: Partial<EntitlementForm> = {}): EntitlementForm => ({
  publisher: '', product: '', edition: '',
  license_type: 'subscription', license_metric: 'per_device', total_quantity: '1',
  unit_cost: '', currency: 'USD',
  purchase_date: '', start_date: '', expiry_date: '', maintenance_expiry: '',
  po_reference: '', contract_reference: '', reseller: '', notes: '',
  software_key: '',
  ...over,
});

export const formFromEntitlement = (e: LicenseEntitlement): EntitlementForm => ({
  publisher: e.publisher ?? '', product: e.product ?? '', edition: e.edition ?? '',
  license_type: e.license_type || 'subscription', license_metric: e.license_metric || 'per_device',
  total_quantity: String(e.total_quantity ?? 1),
  unit_cost: e.unit_cost == null ? '' : String(e.unit_cost),
  currency: (e.currency || 'USD').toUpperCase(),
  purchase_date: dateInput(e.purchase_date), start_date: dateInput(e.start_date),
  expiry_date: dateInput(e.expiry_date), maintenance_expiry: dateInput(e.maintenance_expiry),
  po_reference: e.po_reference ?? '', contract_reference: e.contract_reference ?? '',
  reseller: e.reseller ?? '', notes: e.notes ?? '',
  software_key: e.software_key ?? '',
});

/** `minQty` is 1 for a new line; an existing line already stored with 0 may keep it, so it can still be edited. */
export function validateForm(f: EntitlementForm, minQty = 1): FormErrors {
  const err: FormErrors = {};
  if (!f.publisher.trim()) err.publisher = 'Publisher is required.';
  if (!f.product.trim()) err.product = 'Product is required.';
  const q = Number(f.total_quantity);
  if (f.total_quantity.trim() === '' || !Number.isInteger(q) || q < minQty) {
    err.total_quantity = minQty > 0 ? 'Enter a whole number of at least 1.' : 'Enter a whole number, 0 or more.';
  }
  if (f.unit_cost.trim() !== '' && !(Number.isFinite(Number(f.unit_cost)) && Number(f.unit_cost) >= 0)) err.unit_cost = 'Enter a cost of 0 or more.';
  if (f.start_date && f.expiry_date && f.expiry_date < f.start_date) err.expiry_date = 'Expiry is before the start date.';
  return err;
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/** `includeSoftwareKey` is false when editing a record the API did not report a key for —
    sending an empty one would clear a key set elsewhere (PUT only changes the keys it is sent). */
export const formToInput = (f: EntitlementForm, includeSoftwareKey = true): LicenseEntitlementInput => ({
  publisher: f.publisher.trim(),
  product: f.product.trim(),
  edition: orNull(f.edition),
  license_type: f.license_type,
  license_metric: f.license_metric,
  total_quantity: Math.trunc(Number(f.total_quantity)),
  unit_cost: f.unit_cost.trim() === '' ? null : Number(f.unit_cost),
  currency: (f.currency || 'USD').toUpperCase(),
  purchase_date: orNull(f.purchase_date),
  start_date: orNull(f.start_date),
  expiry_date: orNull(f.expiry_date),
  maintenance_expiry: orNull(f.maintenance_expiry),
  po_reference: orNull(f.po_reference),
  contract_reference: orNull(f.contract_reference),
  reseller: orNull(f.reseller),
  notes: orNull(f.notes),
  ...(includeSoftwareKey ? { software_key: orNull(f.software_key) } : null),
});

/** FastAPI `detail` is a string for HTTPException and a list of {loc,msg} for validation errors. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d) => {
        const item = d as { loc?: unknown[]; msg?: string };
        const field = Array.isArray(item.loc) && item.loc.length ? String(item.loc[item.loc.length - 1]) : '';
        return item.msg ? (field ? `${humanize(field)}: ${item.msg}` : item.msg) : String(d);
      })
      .join('; ');
  }
  const msg = (e as { message?: string } | null)?.message;
  return msg || fallback;
}

/* ─── shared inline styles (match lenses.tsx tables, with the register's bolder header) ─── */
export const TH: CSSProperties = {
  padding: '9px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase',
  color: T.ink2, background: '#EEF1F5', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap',
  textAlign: 'left', position: 'sticky', top: 0, zIndex: 1,
};
export const TD: CSSProperties = {
  padding: '9px 10px', fontSize: 12.5, color: T.text, borderBottom: '1px solid #F1F3F7', verticalAlign: 'middle',
};
