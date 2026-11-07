// Pure helpers behind the in-app report preview: which columns to break a dataset down by,
// and the KPI cards derived from those breakdowns. No React, no I/O — self-checked by
// grc-frontend/scripts/reportInsights.selfcheck.mjs (run: node scripts/reportInsights.selfcheck.mjs, Node 22.18+).

export interface Slice { name: string; value: number }
export type Breakdowns = Record<string, Slice[]>;
export interface Kpi { label: string; value: string; tone?: 'danger' | 'warn' | 'good' }

// Columns worth grouping by, per dataset (first two feed the charts). Anything not listed
// falls back to its first badge-typed filterable columns.
const BREAKDOWN_COLS: Record<string, string[]> = {
  vulnerabilities: ['severity', 'status', 'kev_flag'],
  assets: ['internet_facing', 'criticality', 'asset_type', 'status', 'cde_environment'],
  cis_results: ['status'],
  helpdesk_tickets: ['status_category', 'agreement_status'],
};

// A rich dashboard shows MANY breakdown cards at once (like the Vuln / Inventory
// dashboards), so take the curated columns first then fill with any remaining
// badge-typed (low-cardinality enum) columns the schema offers, up to this cap.
const MAX_BREAKDOWNS = 6;

/** Group-by columns for a dataset — curated first, then schema badge columns, capped. */
export function breakdownColumns(dataset: string, filterable: Record<string, string>): string[] {
  const curated = (BREAKDOWN_COLS[dataset] ?? []).filter((c) => c in filterable);
  const badges = Object.keys(filterable).filter((c) => filterable[c] === 'badge' && !curated.includes(c));
  return [...curated, ...badges].slice(0, MAX_BREAKDOWNS);
}

// One-line C-level context under each breakdown card's title (matches the Vuln
// dashboard cards). Unlisted columns fall back to a generic sentence.
const COLUMN_BLURB: Record<string, string> = {
  severity: 'How damaging each finding is if it were exploited.',
  status: 'Where each item sits in its remediation lifecycle.',
  kev_flag: 'Findings CISA confirms are being exploited in the wild.',
  criticality: 'Business importance assigned to each asset.',
  internet_facing: 'Whether each asset is reachable from the public internet (external vs internal).',
  origin_source: 'How each asset entered the inventory — network scan vs external (EASM).',
  cde_environment: 'Whether the asset sits in PCI cardholder-data scope.',
  asset_type: 'The kind of asset — application, infrastructure, cloud, data…',
  status_category: 'The help-desk stage each ticket is in.',
  agreement_status: 'Whether tickets are within their SLA agreement.',
  owner: 'Who each item is assigned to.',
  owner_name: 'Who each item is assigned to.',
  assignee: 'Who each item is assigned to.',
  department: 'Which part of the organisation owns each item.',
};
export const columnBlurb = (col: string, noun: string): string =>
  COLUMN_BLURB[col] ?? `Distribution of ${noun} by ${col.replace(/_/g, ' ')}.`;

/** An honest 0-100 headline score where the dataset has one derivable from the counts
 *  (CIS pass rate today); null for datasets with no natural score — never fabricated. */
export function coverageScore(dataset: string, b: Breakdowns): number | null {
  if (dataset !== 'cis_results') return null;
  const pass = sum(b.status, (n) => n.startsWith('pass'));
  const fail = sum(b.status, (n) => n.startsWith('fail'));
  return pass + fail > 0 ? Math.round((pass / (pass + fail)) * 100) : null;
}

/** Make an aggregate group key readable: null → Unknown, booleans → Yes/No. */
export function sliceName(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'Unknown';
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return String(v);
}

const sum = (slices: Slice[] | undefined, test: (name: string) => boolean) =>
  (slices ?? []).filter((s) => test(s.name.toLowerCase())).reduce((n, s) => n + s.value, 0);
const is = (...names: string[]) => (n: string) => names.includes(n);
const fmt = (n: number) => n.toLocaleString('en-US');

function vulnKpis(total: number, b: Breakdowns): Kpi[] {
  const sev = b.severity;
  return [
    { label: 'Total findings', value: fmt(total) },
    { label: 'Critical', value: fmt(sum(sev, is('critical'))), tone: 'danger' },
    { label: 'High', value: fmt(sum(sev, is('high'))), tone: 'warn' },
    { label: 'Medium / Low', value: fmt(sum(sev, is('medium', 'low'))) },
    { label: 'Known exploited (KEV)', value: fmt(sum(b.kev_flag, is('yes', 'true'))), tone: 'danger' },
  ];
}

function assetKpis(total: number, b: Breakdowns): Kpi[] {
  // External = internet-facing assets (the "By Internet Facing" breakdown). origin_source is
  // NOT groupable server-side (aggregate returns skipped_group_by), so the old
  // sum(b.origin_source, is('easm')) was always 0 — the bug that read "0 External / 249 Internal"
  // while the By-Internet-Facing card showed Yes 247. yes() matches Yes/true/1 case-insensitively.
  const yes = (n: string) => /^(yes|true|1)$/i.test(n);
  const external = sum(b.internet_facing, yes);
  return [
    { label: 'Total assets', value: fmt(total) },
    { label: 'External', value: fmt(external) },
    { label: 'Internal', value: fmt(Math.max(0, total - external)) },
    { label: 'PCI scope', value: fmt(sum(b.cde_environment, yes)) },
  ];
}

function cisKpis(total: number, b: Breakdowns): Kpi[] {
  const pass = sum(b.status, (n) => n.startsWith('pass'));
  const fail = sum(b.status, (n) => n.startsWith('fail'));
  const decided = pass + fail;
  const pct = decided ? Math.round((pass / decided) * 100) : 0;
  return [
    { label: 'Total checks', value: fmt(total) },
    { label: 'Passed', value: fmt(pass), tone: 'good' },
    { label: 'Failed', value: fmt(fail), tone: 'danger' },
    { label: 'Pass rate', value: decided ? `${pct}%` : '—', tone: pct >= 80 ? 'good' : 'warn' },
  ];
}

/** Total + the biggest groups of the first breakdown (helpdesk statuses, or any other dataset). */
function genericKpis(total: number, b: Breakdowns, cols: string[], noun: string): Kpi[] {
  const top = [...(b[cols[0]] ?? [])].sort((x, y) => y.value - x.value).slice(0, 3);
  return [{ label: `Total ${noun}`, value: fmt(total) }, ...top.map((s) => ({ label: s.name, value: fmt(s.value) }))];
}

// What one row of each dataset *is* — the noun on the "Total …" KPI and the
// distribution cards' labels (e.g. "128 findings · by status"). Anything else → rows.
const DATASET_NOUN: Record<string, string> = {
  vulnerabilities: 'findings', assets: 'assets', cis_results: 'checks', discovery: 'devices',
  software_inventory: 'software', pentest_findings: 'findings', pentest_scans: 'scans',
  ctem_scopes: 'scopes', sbp_inventory: 'assets', helpdesk_tickets: 'tickets',
  licenses: 'licenses', risk_posture: 'assets',
};
export const datasetNoun = (dataset: string): string => DATASET_NOUN[dataset] ?? 'rows';

/** KPI cards for a dataset. `total` is the filtered row count; `b` maps column → grouped counts. */
export function buildKpis(dataset: string, total: number, b: Breakdowns, cols: string[], noun = 'rows'): Kpi[] {
  switch (dataset) {
    case 'vulnerabilities': return vulnKpis(total, b);
    case 'assets': return assetKpis(total, b);
    case 'cis_results': return cisKpis(total, b);
    default: return genericKpis(total, b, cols, noun);
  }
}

/** Largest `n` slices by value; the remainder is folded into one "Other" slice so charts stay readable. */
export function topSlices(slices: Slice[], n = 8): Slice[] {
  const sorted = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= n) return sorted;
  const rest = sorted.slice(n - 1).reduce((t, s) => t + s.value, 0);
  return [...sorted.slice(0, n - 1), { name: 'Other', value: rest }];
}
