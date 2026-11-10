// What Administration > Connected systems decides, apart from React so `node --test` pins it (connectedModel.test.ts): the four kinds of connection (scanners, cloud
// security feeds, business tools, evidence sources), how each kind's own fields become one row of the register (a name, a type, one health word, when it last ran), the
// counts, the filter and the order, what "Connect a system" can offer, and the page's state in its address. The words of health are lib/statuses/connections.ts.
//
// Each kind comes from its own endpoint with its own fields (scanners: GET /integrations/connections, cloud: GET /cloud-connectors, tools: GET /connectors,
// evidence: GET /automation/soc2/catalog); a small adapter per kind is all that is shared. Nothing here ever sees a credential: none of those endpoints returns one.
import { oneOf, text } from '../../../../lib/addressState.ts';
import { isActive, readingOf, type Connector } from '../evidence-collectors/connectionsModel.ts';

export type Kind = 'scanners' | 'cloud' | 'tools' | 'evidence';
export const KINDS: readonly Kind[] = ['scanners', 'cloud', 'tools', 'evidence'];
export const KIND_LABEL: Record<Kind, string> = { scanners: 'Scanners', cloud: 'Cloud security', tools: 'Business tools', evidence: 'Evidence sources' };
export const KIND_ONE: Record<Kind, string> = { scanners: 'Scanner', cloud: 'Cloud security', tools: 'Business tool', evidence: 'Evidence source' };
export const KIND_BLURB: Record<Kind, string> = {
  scanners: 'Vulnerability scanners that feed hosts and findings into the vulnerability register.',
  cloud: 'Cloud security services that feed findings and assets into the vulnerability register.',
  tools: 'Ticketing, monitoring, collaboration, ratings and discovery services this platform works with.',
  evidence: 'The systems evidence is collected from; their checks run daily and the controls they cover read passing or failing.',
};

export type Health = 'healthy' | 'degraded' | 'failing' | 'never_run' | 'paused';
/** Failing first, then a look, then not run, healthy, paused last: the order of the register when nobody has sorted it. */
export const HEALTH_RANK: Record<Health, number> = { failing: 0, degraded: 1, never_run: 2, healthy: 3, paused: 4 };

export type StatusFilter = 'all' | 'attention' | 'paused';
export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'attention', 'paused'];
export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = { all: 'Any status', attention: 'Needs attention', paused: 'Paused' };

export interface ConnectedRow {
  /** `${kind}:${id}`: unique across the four kinds */
  key: string;
  kind: Kind;
  id: number | string;
  name: string;
  /** what it is: "Rapid7 Nexpose", "AWS Inspector v2", "ServiceNow", "GitHub" */
  type: string;
  /** the provider code: the logo and the way back to the raw record */
  provider: string;
  /** a second line that tells two of one type apart (a scanner's console address); null when there is none */
  detail: string | null;
  health: Health;
  /** when it last ran or was last checked (an ISO value from the server, naive UTC) */
  lastRun: string | null;
  /** the last failure in plain words, when the server kept one */
  problem: string | null;
}

// ── small helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const w = (s: string | null | undefined): string => String(s ?? '').trim().toLowerCase();
const FAILED = ['error', 'failed', 'failing'];
const PARTIAL = ['partial', 'degraded'];

/** The address of a console without the scheme and trailing slash: "https://nexpose.corp.example/" -> "nexpose.corp.example". */
export function hostOf(url: string | null | undefined): string {
  return String(url ?? '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '');
}

/** The words of a failure for a person: the server may start with the name of a program error ("ConnectionError: …"), may name one inside the sentence ("NoCredentialsError") and may name a
 *  setting (CONNECTOR_MASTER_KEY); the first is dropped, the second is spaced out ("no credentials error"), the third reads "a server setting", and the rest is cut at 240 characters. */
export function plainProblem(raw: string | null | undefined): string | null {
  const clean = String(raw ?? '').trim()
    .replace(/^[A-Za-z_][\w.]*(?:Error|Exception|Failure)\s*:\s*/, '')
    .replace(/\b(?:[A-Z][a-z0-9]+){1,}(?:Error|Exception)\b/g, (m) => m.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase())
    .replace(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g, 'a server setting')
    .replace(/\s+/g, ' ');
  if (!clean) return null;
  return clean.length > 240 ? `${clean.slice(0, 237).trimEnd()}…` : clean;
}

/** One health word from what a kind knows: switched off, a failed status / run / check, a partial one, nothing proven yet, or fine. */
export function healthOf(i: { active: boolean; status?: string | null; sync?: string | null; check?: string | null; proven: boolean }): Health {
  if (!i.active || w(i.status) === 'deactivated') return 'paused';
  if (FAILED.includes(w(i.status)) || FAILED.includes(w(i.sync)) || FAILED.includes(w(i.check))) return 'failing';
  if (PARTIAL.includes(w(i.sync)) || PARTIAL.includes(w(i.check))) return 'degraded';
  return i.proven ? 'healthy' : 'never_run';
}

// ── scanners ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ScannerRaw {
  id: number;
  connection_name: string;
  integration_type: string;
  console_url: string;
  console_port: number;
  is_active: boolean;
  status: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  consecutive_failures?: number;
}

export const SCANNER_TYPES = ['nexpose', 'nessus'] as const;
export const SCANNER_LABEL: Record<string, string> = { nexpose: 'Rapid7 Nexpose', nessus: 'Tenable Nessus' };

/** GET /integrations/connections returns EVERY connection of the tenant, evidence collectors and business tools included (they share one table): only these two types are scanners. */
export const isScanner = (c: { integration_type: string }): boolean => (SCANNER_TYPES as readonly string[]).includes(w(c.integration_type));

export function scannerRows(list: readonly ScannerRaw[]): ConnectedRow[] {
  return list.filter(isScanner).map((c): ConnectedRow => ({
    key: `scanners:${c.id}`, kind: 'scanners', id: c.id, name: c.connection_name,
    type: SCANNER_LABEL[w(c.integration_type)] ?? c.integration_type, provider: w(c.integration_type),
    detail: hostOf(c.console_url) || null,
    // a connection that was paused and then resumed keeps the status "deactivated" until its next test or sync: it is not paused any more
    health: healthOf({ active: c.is_active, status: c.is_active && w(c.status) === 'deactivated' ? null : c.status, sync: c.last_sync_status, proven: Boolean(c.last_sync_at) }),
    lastRun: c.last_sync_at, problem: null,
  }));
}

/** What a finished scanner sync added, said as a sentence from the counters the server recorded ("3 hosts added, 12 updated; 40 findings added, 5 closed."). */
export function scannerSyncSentence(stats: Record<string, unknown> | null | undefined): string {
  const n = (k: string): number => { const v = Number(stats?.[k]); return Number.isFinite(v) && v > 0 ? v : 0; };
  const part = (items: Array<[number, string]>): string[] => items.filter(([count]) => count > 0).map(([count, word]) => `${count} ${word}`);
  const hosts = part([[n('assets_new'), 'added'], [n('assets_updated'), 'updated']]);
  const findings = part([[n('vulns_new'), 'added'], [n('vulns_updated'), 'updated'], [n('vulns_closed'), 'closed'], [n('vulns_reopened'), 'reopened']]);
  const out: string[] = [];
  if (hosts.length) out.push(`Hosts: ${hosts.join(', ')}`);
  if (findings.length) out.push(`Findings: ${findings.join(', ')}`);
  if (n('errors_count')) out.push(`${n('errors_count')} ${n('errors_count') === 1 ? 'error' : 'errors'}`);
  return out.length ? `${out.join('; ')}.` : 'Nothing changed.';
}

/** Every counter of a sync as [readable name, value], nested groups flattened ("ai_mapping" + "findings_sent" -> "ai mapping findings sent"). For the details, not the first line. */
export function syncCounters(stats: Record<string, unknown> | null | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  Object.keys(stats ?? {}).forEach((key) => {
    const val = (stats as Record<string, unknown>)[key];
    const add = (name: string, v: unknown) => out.push([name.replace(/_/g, ' '), v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)]);
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) Object.keys(val as Record<string, unknown>).forEach((k) => add(`${key} ${k}`, (val as Record<string, unknown>)[k]));
    else add(key, val);
  });
  return out;
}

// ── cloud security ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CloudRaw {
  id: number;
  provider: string;
  display_name: string;
  description?: string | null;
  is_active: boolean;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
  last_sync_error?: string | null;
  last_health_check_at?: string | null;
  last_health_status?: string | null;
}

export const CLOUD_LABEL: Record<string, string> = { aws_inspector: 'AWS Inspector v2', azure_defender: 'Microsoft Defender for Cloud', gcp_scc: 'Google Cloud Security Command Center' };

export function cloudRows(list: readonly CloudRaw[]): ConnectedRow[] {
  return list.map((c): ConnectedRow => {
    const later = [c.last_sync_at, c.last_health_check_at].filter(Boolean).sort().pop() ?? null;
    return {
      key: `cloud:${c.id}`, kind: 'cloud', id: c.id, name: c.display_name, type: CLOUD_LABEL[c.provider] ?? c.provider, provider: c.provider, detail: null,
      health: healthOf({ active: c.is_active, sync: c.last_sync_status, check: c.last_health_status, proven: Boolean(later) }),
      lastRun: later, problem: plainProblem(c.last_sync_error),
    };
  });
}

// ── business tools ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ToolRaw {
  id: number;
  provider: string;
  provider_label: string;
  category: string;
  connection_name: string;
  console_url: string;
  is_active: boolean;
  status: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  sync_schedule?: string;
  has_credentials?: boolean;
  provider_config?: Record<string, unknown>;
}

export function toolRows(list: readonly ToolRaw[]): ConnectedRow[] {
  return list.map((c): ConnectedRow => ({
    key: `tools:${c.id}`, kind: 'tools', id: c.id, name: c.connection_name, type: c.provider_label || c.provider, provider: c.provider,
    detail: hostOf(c.console_url) || null,
    // a tool that passed its test when it was saved is connected even if nothing has synced yet
    health: healthOf({ active: c.is_active, status: c.status, sync: c.last_sync_status, proven: Boolean(c.last_sync_at) || w(c.status) === 'connected' }),
    lastRun: c.last_sync_at, problem: null,
  }));
}

// ── evidence sources ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Only the evidence sources that are connected are rows (the catalogue lists 124 and most are not); the connect catalogue offers the rest. */
export function evidenceRows(list: readonly Connector[]): ConnectedRow[] {
  return list.filter(isActive).map((c): ConnectedRow => {
    const r = readingOf(c);
    const health: Health = r.kind === 'connected' ? (r.health === 'failing' ? 'failing' : r.health === 'never_run' ? 'never_run' : 'healthy') : 'never_run';
    return {
      key: `evidence:${c.id}`, kind: 'evidence', id: c.id, name: c.name, type: c.name, provider: c.provider ?? c.id, detail: null,
      health, lastRun: c.last_run?.started_at ?? null, problem: null,
    };
  });
}

// ── logos ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const LOGO: Record<string, string> = { aws_inspector: 'aws', azure_defender: 'azure', gcp_scc: 'gcp', nessus: 'tenable', ms_teams: 'teams' };
/** The file under public/connectors/ (without .svg) that is this provider's mark; one that has no file falls back to initials in BrandLogo. */
export const logoOf = (provider: string): string => LOGO[provider] ?? provider;

// ── counts, filter, order ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Counts { total: number; byKind: Record<Kind, number>; attention: number; failing: number; paused: number }

export function countsOf(rows: readonly ConnectedRow[]): Counts {
  const byKind: Record<Kind, number> = { scanners: 0, cloud: 0, tools: 0, evidence: 0 };
  let attention = 0; let failing = 0; let paused = 0;
  rows.forEach((r) => {
    byKind[r.kind] += 1;
    if (r.health === 'failing') { failing += 1; attention += 1; } else if (r.health === 'degraded') attention += 1;
    if (r.health === 'paused') paused += 1;
  });
  return { total: rows.length, byKind, attention, failing, paused };
}

const fold = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface View { kind: Kind | 'all'; query: string; status: StatusFilter }

/** The rows a kind, a search and a status leave, in the register's order: failing first, then by name. */
export function visibleRows(rows: readonly ConnectedRow[], v: View): ConnectedRow[] {
  const q = fold(v.query.trim());
  return rows
    .filter((r) => (v.kind === 'all' || r.kind === v.kind)
      && (v.status === 'all' || (v.status === 'attention' ? r.health === 'failing' || r.health === 'degraded' : r.health === 'paused'))
      && (!q || fold(r.name).includes(q) || fold(r.type).includes(q) || fold(r.detail ?? '').includes(q)))
    .sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || a.name.localeCompare(b.name));
}

/** "14 systems · 2 need attention · 1 paused": the line under the title. */
export function summaryLine(c: Counts): string {
  const parts = [`${c.total} ${c.total === 1 ? 'system' : 'systems'}`];
  if (c.attention) parts.push(`${c.attention} ${c.attention === 1 ? 'needs' : 'need'} attention`);
  if (c.paused) parts.push(`${c.paused} paused`);
  return parts.join(' · ');
}

// ── what "Connect a system" offers ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CatalogueEntry {
  key: string;
  kind: Kind;
  provider: string;
  label: string;
  blurb: string;
  /** the tool category (a tool's group in the catalogue); '' for the other kinds */
  group: string;
  /** how many of this one are connected already */
  connected: number;
}

const SCANNER_ENTRIES = [
  { provider: 'nexpose', label: 'Rapid7 Nexpose / InsightVM', blurb: 'Hosts and findings from your Rapid7 console, with the keys of a read-only user.' },
  { provider: 'nessus', label: 'Tenable Nessus', blurb: 'Findings from Nessus or Tenable.io with an API key pair.' },
] as const;

const CLOUD_BLURB: Record<string, string> = {
  aws_inspector: 'Findings from AWS Inspector through a role in your account. No AWS access key is stored.',
  azure_defender: 'Findings from Microsoft Defender for Cloud through a read-only service principal.',
  gcp_scc: 'Findings from Google Cloud Security Command Center (Premium) through a read-only service account.',
};

/** The groups of business tools, in the order the catalogue shows them. */
export const TOOL_GROUPS: ReadonlyArray<{ key: string; label: string; blurb: string }> = [
  { key: 'ticketing', label: 'Ticketing', blurb: 'Push vulnerabilities and exceptions to your service desk, with status kept in step.' },
  { key: 'siem', label: 'Monitoring', blurb: 'Pull signs of active exploitation to raise the priority of a vulnerability.' },
  { key: 'pentest', label: 'Penetration testing', blurb: 'Pull confirmed exploit sessions to raise the priority of a vulnerability.' },
  { key: 'collab', label: 'Collaboration', blurb: 'Post alerts to channels and schedule committee meetings.' },
  { key: 'transcribe', label: 'Transcription', blurb: 'Pull meeting transcripts to draft committee minutes.' },
  { key: 'easm_source', label: 'Attack surface', blurb: 'Public internet data for asset discovery and supplier scans.' },
  { key: 'security_rating', label: 'Security ratings', blurb: "Read each supplier's rating from a ratings service." },
  { key: 'saas_discovery', label: 'SaaS discovery', blurb: 'Bring the apps your people use into Shadow SaaS for a decision.' },
  { key: 'web_gateway', label: 'Web gateway', blurb: 'Block the domain of an app that third-party risk denies.' },
  { key: 'code_search', label: 'Code search', blurb: "Search public code for suppliers' and your own domains beside words like password." },
];

export const toolGroupLabel = (key: string): string => TOOL_GROUPS.find((g) => g.key === key)?.label ?? key.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

export interface ToolProviderRaw { provider: string; label: string; category: string; description: string }
export interface CloudProviderRaw { provider: string; label: string; framework?: string }

export function catalogueOf(src: {
  cloudProviders: readonly CloudProviderRaw[]; toolProviders: readonly ToolProviderRaw[]; evidence: readonly Connector[]; connected: readonly ConnectedRow[];
}): CatalogueEntry[] {
  const have = new Map<string, number>();
  src.connected.forEach((r) => have.set(`${r.kind}:${r.provider}`, (have.get(`${r.kind}:${r.provider}`) ?? 0) + 1));
  const n = (kind: Kind, provider: string): number => have.get(`${kind}:${provider}`) ?? 0;
  const out: CatalogueEntry[] = [];
  SCANNER_ENTRIES.forEach((s) => out.push({ key: `scanners:${s.provider}`, kind: 'scanners', provider: s.provider, label: s.label, blurb: s.blurb, group: '', connected: n('scanners', s.provider) }));
  src.cloudProviders.filter((p) => (p.framework || 'cloud_connector') === 'cloud_connector').forEach((p) => out.push({
    key: `cloud:${p.provider}`, kind: 'cloud', provider: p.provider, label: CLOUD_LABEL[p.provider] ?? p.label, blurb: CLOUD_BLURB[p.provider] ?? '', group: '', connected: n('cloud', p.provider),
  }));
  const order = (cat: string): number => { const i = TOOL_GROUPS.findIndex((g) => g.key === cat); return i < 0 ? 99 : i; };
  src.toolProviders.slice().sort((a, b) => order(a.category) - order(b.category) || a.label.localeCompare(b.label)).forEach((p) => out.push({
    key: `tools:${p.provider}`, kind: 'tools', provider: p.provider, label: p.label, blurb: p.description, group: p.category, connected: n('tools', p.provider),
  }));
  // an evidence source that cannot collect yet is not offered: there is nothing to connect (the full list stays on Controls Automation > Connections)
  src.evidence.filter((c) => c.supported && c.provider).slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((c) => out.push({
    key: `evidence:${c.provider}`, kind: 'evidence', provider: c.provider as string, label: c.name, blurb: '', group: c.category, connected: c.connected ? 1 : 0,
  }));
  return out;
}

/** The catalogue a kind chip and a search leave, in catalogue order. */
export function visibleCatalogue(entries: readonly CatalogueEntry[], v: { kind: Kind | 'all'; query: string }): CatalogueEntry[] {
  const q = fold(v.query.trim());
  return entries.filter((e) => (v.kind === 'all' || e.kind === v.kind) && (!q || fold(e.label).includes(q) || fold(e.provider).includes(q) || fold(e.blurb).includes(q)));
}

/** The entry a `?provider=` link means: the first kind that has that provider code. */
export const entryForProvider = (entries: readonly CatalogueEntry[], provider: string): CatalogueEntry | undefined => {
  const p = w(provider);
  return p ? entries.find((e) => w(e.provider) === p) : undefined;
};

// ── the page's state in its address ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** ?kind=scanners&q=prod&status=attention, and the links that already exist: ?provider=<code> opens the connect form for that provider, ?connector=<id> opens an evidence source,
 *  ?return=<path> says where Back goes from it. */
export const CONNECTIONS_SCHEMA = {
  kind: oneOf(['all', ...KINDS] as const, 'all'),
  q: text(),
  status: oneOf(STATUS_FILTERS, 'all'),
  provider: text(),
  connector: text(),
  return: text(),
};
