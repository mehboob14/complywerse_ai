// The Audit log's rules as pure functions apart from React, so `node --test` can pin them (auditModel.test.ts): the filters kept in the address, the request they make,
// the module and sub-module a row belongs to, the plain sentence a row reads as, what a request changed in words, the people to pick from, and the CSV of a filtered set.
//
// The module and sub-module labels (MODULE_LABELS ... enrichDescription) are the page's own tables moved here unchanged: the log stores URL paths for older rows and
// the sidebar's module for newer ones, and both must read as the same place. Dates the filters send are LOCAL calendar days (the old page took the UTC day, so
// "Today" at 01:00 in Karachi asked for yesterday: G12 P-15). The server's times are naive UTC (parseUtc); the export writes them as UTC and says so in its header.
import { integer, oneOf, text } from '../../../../lib/addressState.ts';
import { formatDateTime } from '../../../../lib/format.ts';
import { auditAction, auditChange } from '../../../../lib/statuses/adminAuditAi.ts';

/** One row of GET /admin/audit-logs. */
export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  user_name: string;
  action: string;
  resource_type: string;
  resource_id: number | null;
  module?: string | null;
  submodule?: string | null;
  feature?: string | null;
  description: string;
  details: Record<string, unknown>;
  method?: string;
  path?: string;
  status_code?: number;
  duration_ms?: number | null;
  ip_address: string | null;
  timestamp: string;
  ai_summary?: string | null;
}

export const PAGE_SIZE = 50;
/** The export asks for this many rows a request and stops at the cap: a filtered set bigger than that is narrowed first (said on the page). */
export const EXPORT_PAGE = 250;
export const EXPORT_CAP = 5000;

// ── the date presets ─────────────────────────────────────────────────────────

export const PRESETS = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: 'last_7_days', label: 'Last 7 days' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'last_90_days', label: 'Last 90 days' },
  { key: 'year_to_date', label: 'Year to date' },
  { key: 'last_year', label: 'Last 12 months' },
] as const;
export type PresetKey = (typeof PRESETS)[number]['key'];
export const PRESET_KEYS: readonly PresetKey[] = PRESETS.map((p) => p.key);
export const presetLabel = (key: string): string => PRESETS.find((p) => p.key === key)?.label ?? 'All time';

const pad = (n: number): string => String(n).padStart(2, '0');
/** The viewer's calendar day as the server wants it: YYYY-MM-DD from the LOCAL date (toISOString gives the UTC day). */
export const localDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day (2026-02-30 is none). */
export function isDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

/** The days a preset stands for: the same spans the page always offered (7 days = today and the 6 before), counted on the viewer's calendar. */
export function presetRange(key: string, now: Date): { start_date?: string; end_date?: string } {
  const to = localDay(now);
  const back = (days: number) => { const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days); return localDay(from); };
  switch (key) {
    case 'today': return { start_date: to, end_date: to };
    case 'last_7_days': return { start_date: back(6), end_date: to };
    case 'last_30_days': return { start_date: back(29), end_date: to };
    case 'last_90_days': return { start_date: back(89), end_date: to };
    case 'year_to_date': return { start_date: localDay(new Date(now.getFullYear(), 0, 1)), end_date: to };
    case 'last_year': return { start_date: localDay(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())), end_date: to };
    default: return {};
  }
}

// ── the filters, kept in the address ─────────────────────────────────────────

/** ?action=&module=&submodule=&person=&range=&from=&to=&page=. A chosen From / To (custom days) outranks the preset. */
export const AUDIT_SCHEMA = {
  action: text(),
  module: text(),
  submodule: text(),
  person: text(),
  range: oneOf(PRESET_KEYS, 'all' as PresetKey),
  from: text(),
  to: text(),
  page: integer(1, { min: 1 }),
};

export interface AuditFilters { action: string; module: string; submodule: string; person: string; range: PresetKey; from: string; to: string; page: number }

/** How many filters narrow the log (the Clear button and the empty state's wording). Paging is not a filter. */
export function activeFilterCount(f: AuditFilters): number {
  const range = f.from || f.to ? 1 : f.range !== 'all' ? 1 : 0;
  return [f.action, f.module, f.submodule, f.person].filter(Boolean).length + range;
}

/** The days the log is asked for: custom days when either is a real day, else the preset's. A day that is no day is dropped (the server answers 400 to one). */
export function daysOf(f: AuditFilters, now: Date): { start_date?: string; end_date?: string } {
  const start = isDay(f.from) ? f.from : undefined;
  const end = isDay(f.to) ? f.to : undefined;
  if (start || end) return { ...(start ? { start_date: start } : {}), ...(end ? { end_date: end } : {}) };
  return presetRange(f.range, now);
}

export interface AuditQuery {
  limit: number; offset: number; action?: string; module?: string; submodule?: string; user_id?: number; start_date?: string; end_date?: string;
}

/** The request for a page of the log. A sub-module is only sent with its module (a sub-module on its own would mean nothing to the server). */
export function queryOf(f: AuditFilters, now: Date, { limit = PAGE_SIZE, offset }: { limit?: number; offset?: number } = {}): AuditQuery {
  const person = Number(f.person);
  return {
    limit,
    offset: offset ?? (Math.max(1, f.page) - 1) * limit,
    ...(f.action ? { action: f.action } : {}),
    ...(f.module ? { module: f.module } : {}),
    ...(f.module && f.submodule ? { submodule: f.submodule } : {}),
    ...(f.person && Number.isInteger(person) && person > 0 ? { user_id: person } : {}),
    ...daysOf(f, now),
  };
}

/** The same filters on a stable text key, so a query never mixes two filter sets (and a late answer for an older set is recognised). */
export const filterKey = (q: AuditQuery): string => JSON.stringify([q.action, q.module, q.submodule, q.user_id, q.start_date, q.end_date, q.offset, q.limit]);

// ── modules and sub-modules ──────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  erm: 'Risks & ERM',
  evidence: 'Evidence',
  'evidence-mgmt': 'Evidence',
  governance: 'Governance',
  compliance: 'Compliance',
  'vuln-management': 'Vulnerability Mgmt',
  vulnerabilities: 'Vulnerability Mgmt',
  frameworks: 'Frameworks',
  'framework-upload': 'Frameworks',
  certifications: 'Certifications',
  admin: 'Administration',
  auth: 'Authentication',
  'vendor-risk': 'Vendor Risk',
  vendor_risk: 'Vendor Risk',
  tasks: 'Critical Tasks',
  'critical-tasks': 'Critical Tasks',
  assets: 'Assets',
  'control-library': 'Control Library',
  controls: 'Controls',
  dashboard: 'Dashboard',
  'workflow-engine': 'Workflow Engine',
  workflow: 'Workflow Engine',
  chatbot: 'AI Assistant',
  complychat: 'AI Assistant',
  integrations: 'Integrations',
  'auditor-portal': 'Auditor Portal',
  'auditor-portal/statutory-audit': 'Statutory Audit',
  audits: 'Auditor Portal',
  'is-projects': 'IS Projects',
  reports: 'Reports',
  documents: 'Documents',
  system: 'System',
  risks: 'Risks & ERM',
  // Issue Management — URL prefix `/issue-management/...` from the
  // issue_management module routers.
  'issue-management': 'Issue Management',
  // Audit Issue Register — its own rows (resource_type) and its requests
  // under /issue-management/issues/audit-register (see deriveModuleContext).
  'audit-register': 'Audit Register',
  'audit-register-import': 'Audit Register',
  // Criticality Assessments — `/criticality-assessments/...` for the
  // ISCA + IACA endpoints under Asset Management.
  'criticality-assessments': 'Criticality Assessments',
  // CIS Compliance Plugins — `/compliance-plugins/...` (library
  // listing, runs, benchmark-mappings, library-tree, scan-all, ingest).
  'compliance-plugins': 'CIS Compliance Plugins',
  // Connect Wizard — `/connect-wizard/...` (issue-token, status poll,
  // windows/linux script download, handshake).
  'connect-wizard': 'Connect Wizard',
  // Compliance Agents — `/agents/...` (enrollment, installer downloads,
  // results push, revoke, scan-now-push).
  agents: 'Compliance Agents',
  // Controls Automation — `/automation/...` and `/scf/...` requests, and the
  // business events it writes (testing, evidence, maturity, scope, collectors).
  automation: 'Controls Automation',
  scf: 'Controls Automation',
  controls_automation: 'Controls Automation',
  control_testing: 'Controls Automation',
  control_evidence: 'Controls Automation',
  control_maturity: 'Controls Automation',
  scf_control_state: 'Controls Automation',
  scf_scope: 'Controls Automation',
  scf_audit_period: 'Controls Automation',
  evidence_collector: 'Evidence Collectors',
};

const SUBMODULE_LABELS: Record<string, string> = {
  // ERM
  risks: 'Risks',
  kris: 'KRIs',
  incidents: 'Incidents',
  'mitigation-actions': 'Mitigation Actions',
  'internal-controls': 'Internal Controls',
  reviews: 'Reviews',
  appetite: 'Risk Appetite',
  rcsa: 'RCSA',
  'risk-assessments': 'Risk Assessments',
  'framework-risk-assessments': 'Framework Risk Assessments',
  scales: 'Scoring Scales',
  dependencies: 'Risk Dependencies',
  // Governance
  documents: 'Documents',
  'gap-analysis': 'Gap Analysis',
  attestations: 'Attestations',
  'attestation-campaigns': 'Attestation Campaigns',
  committees: 'Committees',
  'regulatory-changes': 'Regulatory Changes',
  'regulatory-feeds': 'Regulatory Feeds',
  workflows: 'Workflows',
  'workflow-templates': 'Workflow Templates',
  mappings: 'Mappings',
  exceptions: 'Exceptions',
  applicability: 'Applicability',
  versions: 'Document Versions',
  // Compliance
  policies: 'Policies',
  statements: 'Policy Statements',
  assessments: 'Assessments',
  // Evidence
  'cross-links': 'Cross-Module Links',
  'audit-packages': 'Audit Packages',
  // Vulnerability
  vulnerabilities: 'Findings',
  sla: 'SLA Config',
  departments: 'Departments',
  // Vendor risk
  vendors: 'Vendors',
  questionnaires: 'Questionnaires',
  'questionnaire-templates': 'Questionnaire Templates',
  // Admin
  users: 'Users',
  roles: 'Roles',
  permissions: 'Permissions',
  organization: 'Organization',
  'audit-logs': 'Audit Logs',
  // AI / cross-cutting
  ai: 'AI Assistant',
  // Workflow engine
  definitions: 'Definitions',
  instances: 'Instances',
  notifications: 'Notifications',
  'escalation-configs': 'Escalation Configs',
  // Frameworks
  parser: 'Parser',
  controls: 'Controls',
  alignment: 'Alignment',
  // Issue Management (URL: /issue-management/{issues|actions|comments|links|...})
  issues: 'Issues',
  actions: 'CAPA Actions',
  comments: 'Comments',
  links: 'Linked Items',
  matrices: 'Severity & Classification Matrices',
  'automation-flags': 'Automation Flags',
  'by-source': 'By Source',
  'from-source': 'Auto-Create from Source',
  // Criticality Assessments
  'info-system': 'Information System Assessments',
  'infra-asset': 'Infrastructure Asset Assessments',
  'by-asset': 'By Asset',
  coverage: 'Coverage Stats',
  // CIS Compliance Plugins (URL: /compliance-plugins/{runs|benchmarks|ingest|...})
  runs: 'Plugin Runs',
  benchmarks: 'Benchmarks',
  ingest: 'CIS PDF Ingest',
  'benchmark-mappings': 'Benchmark Mappings',
  'library-tree': 'Library Tree',
  'os-registry': 'OS Registry',
  'match-preview': 'Match Preview',
  'normalise-os': 'OS Normalisation',
  'classify-stream': 'Classification Stream',
  'classification-stats': 'Classification Stats',
  'review-queue': 'Review Queue',
  'review-bulk': 'Bulk Review',
  'scan-all': 'Scan-All',
  'per-asset-coverage': 'Per-Asset Coverage',
  'per-user-summary': 'Per-User Summary',
  'assets-overview': 'Assets Overview',
  'import-json': 'Import JSON',
  // Plugin-level paths nested under /compliance-plugins/{id}/{action}
  'control-mappings': 'Plugin Control Mappings',
  'asset-scope': 'Plugin Asset Scope',
  schedule: 'Plugin Schedule',
  // Compliance Agents (URL: /agents/{enroll|heartbeat|results|installer.*|...})
  enroll: 'Agent Enrollment',
  heartbeat: 'Agent Heartbeat',
  results: 'Agent Results',
  jobs: 'Agent Jobs Poll',
  revoke: 'Agent Revoke',
  'bulk-enroll': 'Bulk Enrollment',
  'fetch-creds': 'Collector Credentials Fetch',
  'scan-now-push': 'Scan-Now Push',
  // Per-OS installer download endpoints
  'installer.cmd': 'Windows Installer Download',
  'installer.sh': 'Linux Installer Download',
  'installer.command': 'macOS Installer Download',
  'installer.msi': 'Installer (MSI placeholder)',
  'installer.deb': 'Installer (DEB placeholder)',
  'installer.rpm': 'Installer (RPM placeholder)',
  'installer.pkg': 'Installer (PKG placeholder)',
  // Connect Wizard (URL: /connect-wizard/{issue-token|status|windows|linux|handshake})
  'issue-token': 'Issue Wizard Token',
  status: 'Wizard Status Poll',
  windows: 'Wizard Windows Script',
  linux: 'Wizard Linux Script',
  handshake: 'Wizard Handshake',
  // Connections under compliance-plugins
  connections: 'Connections',
  'connections-scope': 'Connection Scope',
  // Controls Automation
  'soc2-controls': 'Common Controls',
  common: 'Common Controls',
  soc2: 'Automated Checks',
  scopes: 'Scope',
  'custom-controls': 'Custom Controls',
  'audit-periods': 'Audit Periods',
  assurance: 'Assurance',
  'my-work': 'My Work',
};

const SUB_ENTITY_MODULES = new Set([
  'erm', 'evidence-mgmt', 'vuln-management',
  'control-library', 'governance', 'compliance', 'vendor-risk',
  'workflow-engine', 'framework-upload', 'auditor-portal',
  // Phase-2 additions — both surfaces nest resources under module prefix.
  'issue-management', 'criticality-assessments',
  // CIS additions — all three modules nest resources under the
  // top-level URL prefix (e.g. /compliance-plugins/runs/...).
  'compliance-plugins', 'connect-wizard', 'agents',
  'automation', 'scf',
]);

export function titleCase(s: string): string {
  return s
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function deriveModuleContext(log: AuditLogEntry): { module: string; submodule: string | null } {
  if (log.module) {
    const sub = log.submodule && log.submodule !== log.module ? log.submodule : null;
    return { module: log.module, submodule: sub };
  }
  const path = log.path || '';
  const normalized = path.replace(/^\/grc/, '').replace(/^\//, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) {
    const fallback = log.resource_type ? MODULE_LABELS[log.resource_type] || titleCase(log.resource_type) : 'System';
    return { module: fallback, submodule: null };
  }
  if (normalized.startsWith('issue-management/issues/audit-register')) {
    return { module: MODULE_LABELS['audit-register'], submodule: null };
  }
  const moduleKey = parts[0];
  const moduleLabel = MODULE_LABELS[moduleKey] || titleCase(moduleKey);
  let submodule: string | null = null;
  // Sub-module = second segment when it isn't a numeric id, but only for
  // modules whose URL structure actually nests resources (most do).
  if (SUB_ENTITY_MODULES.has(moduleKey) && parts.length > 1 && !/^\d+$/.test(parts[1])) {
    const subKey = parts[1];
    submodule = SUBMODULE_LABELS[subKey] || titleCase(subKey);
  }
  // Avoid showing the same label twice (e.g. module=Documents, sub=Documents).
  if (submodule && submodule.toLowerCase() === moduleLabel.toLowerCase()) {
    submodule = null;
  }
  return { module: moduleLabel, submodule };
}

/**
 * Append module / sub-module context to the backend's description if it
 * doesn't already mention them, so each row reads as a self-contained
 * sentence ("Updated risk #5 — in Risks & ERM"). We only append when the
 * description doesn't already reference the module (e.g. for actions like
 * "Ran gap analysis on document #3 against framework "ISO 27001"" the
 * extra "in Governance" hint would be noise).
 */
export function enrichDescription(log: AuditLogEntry): string {
  const base = log.description || `${titleCase(log.action || 'action')} on ${log.resource_type || 'record'}`;
  const ctx = deriveModuleContext(log);
  const moduleLabel = ctx.submodule || ctx.module;
  if (!moduleLabel || moduleLabel === 'System') return base;
  const lower = base.toLowerCase();
  if (lower.includes(moduleLabel.toLowerCase())) return base;
  // Some backend phrasings already say "in <module>" — don't double up.
  if (/\bin\s+\w/.test(lower) && (lower.includes('module') || lower.includes('framework') || lower.includes('document'))) {
    return base;
  }
  return `${base} — in ${moduleLabel}`;
}


// ── what a request changed, in words ─────────────────────────────────────────

/** What the request committed to the database (backend audit_changes). */
export interface DbChangeRecord {
  op: 'created' | 'updated' | 'deleted';
  table: string;
  id?: number | string | Array<number | string> | null;
  name?: string;
  fields?: Record<string, unknown>;
}
export interface DbChanges { records?: DbChangeRecord[]; more?: number }

const sentence = (words: string): string => { const t = words.trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };

/** "grc_risk_reviews" -> "Risk review", "evidence" -> "Evidence": the record's kind in the person's words (no table prefix, no plural). */
export function recordKind(table: string): string {
  const base = String(table || '').replace(/^grc_/, '').replace(/[_-]+/g, ' ').trim();
  if (!base) return 'Record';
  const singular = base.endsWith('ies') ? `${base.slice(0, -3)}y` : base.endsWith('ses') || base.endsWith('ss') || base.endsWith('us') ? base : base.endsWith('s') ? base.slice(0, -1) : base;
  return sentence(singular);
}

/** A field of a stored record, in words: "owner_id" -> "Owner", "next_review_date" -> "Next review date". */
export function fieldLabel(field: string): string {
  const base = String(field || '').replace(/_id$/, '').replace(/[_-]+/g, ' ').trim();
  return sentence(base || field);
}

/** Housekeeping columns that say nothing a person acts on. */
const HIDDEN_FIELDS = new Set(['created_at', 'updated_at', 'modified_at', 'created_by', 'updated_by', 'modified_by', 'tenant_id', 'password_hash', 'hashed_password']);
export const isShownField = (field: string): boolean => !HIDDEN_FIELDS.has(field);

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;
export const VALUE_MAX = 200;

/** A stored value in words: nothing is "—", true/false Yes/No, a date "12 Nov 2026, 14:05", a list its items, long text cut (the full text stays in `full`). */
export function valueText(value: unknown): { text: string; full: string; cut: boolean } {
  let full: string;
  if (value === null || value === undefined || value === '') full = '—';
  else if (typeof value === 'boolean') full = value ? 'Yes' : 'No';
  else if (typeof value === 'string' && ISO.test(value.trim())) full = formatDateTime(value.trim());
  else if (typeof value === 'string') full = value;
  else if (Array.isArray(value)) full = value.length ? value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ') : '—';
  else if (typeof value === 'object') full = JSON.stringify(value);
  else full = String(value);
  const cut = full.length > VALUE_MAX;
  return { text: cut ? `${full.slice(0, VALUE_MAX - 1).trimEnd()}…` : full, full, cut };
}

export interface ChangeLine { field: string; label: string; before: ReturnType<typeof valueText> | null; after: ReturnType<typeof valueText> }
export interface ChangeBlock { key: string; op: string; opLabel: string; kind: string; name: string | null; lines: ChangeLine[] }

/** The records a request changed, ready to draw: the kind of record, what was done to it, and each field old -> new (an update's [old, new] pair) or its value. */
export function changeBlocks(changes: DbChanges | null | undefined): { blocks: ChangeBlock[]; more: number } {
  const records = changes?.records ?? [];
  const blocks = records.map((rec, i) => ({
    key: `${rec.table}-${i}`,
    op: rec.op,
    opLabel: auditChange.label(rec.op),
    kind: recordKind(rec.table),
    name: rec.name ? String(rec.name) : null,
    lines: Object.keys(rec.fields ?? {}).filter(isShownField).map((field) => {
      const value = (rec.fields as Record<string, unknown>)[field];
      const pair = rec.op === 'updated' && Array.isArray(value) && value.length === 2;
      return {
        field, label: fieldLabel(field),
        before: pair ? valueText((value as unknown[])[0]) : null,
        after: valueText(pair ? (value as unknown[])[1] : value),
      };
    }),
  }));
  return { blocks, more: Math.max(0, Number(changes?.more || 0)) };
}

/** The "request details" of a row, kept behind the Technical details control: what an auditor checks, not what a reader needs. Empty parts are left out. */
export function technicalRows(log: AuditLogEntry): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (log.method) rows.push(['Request', `${log.method} ${log.path || ''}`.trim()]);
  else if (log.path) rows.push(['Request', log.path]);
  if (log.status_code) rows.push(['Result code', String(log.status_code)]);
  if (log.duration_ms != null) rows.push(['Took', `${log.duration_ms} ms`]);
  if (log.ip_address) rows.push(['From address', log.ip_address]);
  const agent = log.details?.user_agent;
  if (agent) rows.push(['Browser', String(agent)]);
  if (log.resource_type) rows.push(['Record type', log.resource_type]);
  if (log.resource_id) rows.push(['Record number', String(log.resource_id)]);
  if (log.feature) rows.push(['Function', String(log.feature)]);
  return rows;
}

/** The summary already written for a row: the list returns it inside `details` (the server keeps it at changes.ai_summary), not as a field of its own. */
export function cachedSummary(log: Pick<AuditLogEntry, 'ai_summary' | 'details'>): string | null {
  const own = typeof log.ai_summary === 'string' ? log.ai_summary.trim() : '';
  const kept = typeof log.details?.ai_summary === 'string' ? (log.details.ai_summary as string).trim() : '';
  return own || kept || null;
}

/** The request body of a row, when there is one, as readable JSON. */
export function payloadText(log: AuditLogEntry): string | null {
  const req = log.details?.request as Record<string, unknown> | null | undefined;
  return req && typeof req === 'object' && Object.keys(req).length > 0 ? JSON.stringify(req, null, 2) : null;
}

// ── people to pick from ──────────────────────────────────────────────────────

export interface PersonOption { id: number; label: string }

/** The people the log can be narrowed to: every user the administrator may list, plus anyone who appears on the rows in hand but is not on that list (a person who
 *  left, or a viewer who may not list users): sorted by name, once each. */
export function personOptions(users: ReadonlyArray<{ id: number; display_name?: string | null; username?: string | null }>, rows: ReadonlyArray<Pick<AuditLogEntry, 'user_id' | 'user_name'>>): PersonOption[] {
  const byId = new Map<number, string>();
  users.forEach((u) => { if (u && Number.isInteger(u.id)) byId.set(u.id, String(u.display_name || u.username || `User ${u.id}`)); });
  rows.forEach((r) => { if (r.user_id && !byId.has(r.user_id) && r.user_name) byId.set(r.user_id, r.user_name); });
  return Array.from(byId.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
}

// ── the export ───────────────────────────────────────────────────────────────

/** How the export proceeds for a filtered set of `total` rows: the rows it will write, the requests it will make and whether the cap cuts it. */
export function exportPlan(total: number): { rows: number; requests: number; capped: boolean } {
  const rows = Math.min(Math.max(0, total), EXPORT_CAP);
  return { rows, requests: Math.ceil(rows / EXPORT_PAGE), capped: total > EXPORT_CAP };
}

/** A cell that a spreadsheet would run as a formula starts with a quote, as the server's own exports do (backend _csv_safe). */
const safeCell = (value: string): string => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
export const csvCell = (value: unknown): string => {
  const text = safeCell(value === null || value === undefined ? '' : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const CSV_HEADER = ['When (UTC)', 'Who', 'What was done', 'Module', 'Sub-module', 'What happened', 'Record type', 'Record number'] as const;

/** "2026-11-08 14:02:11": the stored UTC time, to the second (the table shows the viewer's clock; a file for an auditor keeps the exact stored time). */
export const utcStamp = (iso: string | null | undefined): string => (iso ? String(iso).replace('T', ' ').replace(/(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/, '').slice(0, 19) : '');

/** The file's text: a header and a line a row, cells escaped, lines joined with CRLF as spreadsheets expect. */
export function auditCsv(rows: readonly AuditLogEntry[]): string {
  const lines = rows.map((log) => {
    const ctx = deriveModuleContext(log);
    return [
      utcStamp(log.timestamp), log.user_name, auditAction.label(log.action), ctx.module, ctx.submodule || '', enrichDescription(log), log.resource_type || '', log.resource_id ?? '',
    ].map(csvCell).join(',');
  });
  return [CSV_HEADER.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
}

export const exportFileName = (now: Date): string => `audit-log-${localDay(now)}.csv`;

/** The same rows twice when two pages overlap (a row written between two requests shifts the offset): one row once, in the order first met. */
export function uniqueRows(rows: readonly AuditLogEntry[]): AuditLogEntry[] {
  const seen = new Set<number>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}
