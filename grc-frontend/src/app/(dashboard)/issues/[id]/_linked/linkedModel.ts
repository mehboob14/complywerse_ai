// The Linked records tab of an issue, apart from React (linkedModel.test.ts): the nine kinds of record an issue links to, what each row says and opens, which id the server's REMOVE route wants
// (it is the record's id for six kinds and the link row's own id for controls and documents: the older page never unlinked, so nothing used these), what an ADD sends, and which candidates
// are already linked. A task is read-only here: no route links a task from an issue (a promoted action keeps its twin in Task Management).
import { issueSeverity } from '../../../../../lib/statuses/issues.ts';

export type FamilyKey = 'vulns' | 'risks' | 'assets' | 'controls' | 'evidence' | 'vendors' | 'projects' | 'governance' | 'tasks';

/** The `link_counts` of GET /issues/{id} (the older keys, and tasks / projects / governance, which are newer). */
export interface LinkCounts {
  vulnerabilities?: number; risks?: number; assets?: number; controls?: number; evidence?: number; vendors?: number;
  projects?: number; governance?: number; tasks?: number; actions?: number; comments?: number;
}

export interface Family {
  key: FamilyKey;
  /** the heading, plural */
  label: string;
  /** "Add a risk" */
  noun: string;
  count: keyof LinkCounts;
  /** a person may add records of this kind from here */
  canAdd: boolean;
  /** the key of the Create issue form's list loader that feeds the picker (components/issue-management/linkLoaders), where one list is enough */
  loader?: string;
}

export const FAMILIES: readonly Family[] = [
  { key: 'vulns', label: 'Vulnerabilities', noun: 'vulnerability', count: 'vulnerabilities', canAdd: true, loader: 'linked_vulnerability_ids' },
  { key: 'risks', label: 'Risks', noun: 'risk', count: 'risks', canAdd: true, loader: 'linked_risk_ids' },
  { key: 'assets', label: 'Assets', noun: 'asset', count: 'assets', canAdd: true, loader: 'linked_asset_ids' },
  { key: 'controls', label: 'Controls', noun: 'control', count: 'controls', canAdd: true },
  { key: 'evidence', label: 'Evidence', noun: 'evidence item', count: 'evidence', canAdd: true, loader: 'linked_evidence_ids' },
  { key: 'vendors', label: 'Vendors', noun: 'vendor', count: 'vendors', canAdd: true, loader: 'linked_vendor_ids' },
  { key: 'projects', label: 'Projects', noun: 'project', count: 'projects', canAdd: true, loader: 'linked_is_project_ids' },
  { key: 'governance', label: 'Documents and policy statements', noun: 'document or policy statement', count: 'governance', canAdd: true },
  { key: 'tasks', label: 'Tasks', noun: 'task', count: 'tasks', canAdd: false },
];
export const familyOf = (key: FamilyKey): Family => FAMILIES.find((f) => f.key === key) as Family;

export const countOf = (counts: LinkCounts | undefined, family: Family): number => counts?.[family.count] ?? 0;
/** The number on the tab: every linked record, of every kind. */
export const linkedTotal = (counts: LinkCounts | undefined): number => FAMILIES.reduce((n, f) => n + countOf(counts, f), 0);
/** The kinds that have something linked: only these are read when the tab opens. */
export const familiesWithRecords = (counts: LinkCounts | undefined): Family[] => FAMILIES.filter((f) => countOf(counts, f) > 0);

type Row = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dot = (...parts: Array<string | null | undefined>): string | null => parts.filter(Boolean).join(' · ') || null;
const word = (v: unknown): string | null => { const t = text(v); return t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ') : null; };

/** What the server's remove route is given: `id` is the record's id, or the link row's id for controls and documents. */
export interface Unlink { family: FamilyKey; id: number }
export interface LinkedRow {
  key: string;
  title: string;
  sub: string | null;
  /** where the record opens; null when it has no page of its own */
  href: string | null;
  unlink: Unlink | null;
  /** a severity word, for the kinds that carry one */
  severity: string | null;
}

/** One row of GET /issues/{id}/links/<family>, as a person reads it. A record that was deleted under the link still has a row: "A risk". */
export function linkedRow(family: FamilyKey, r: Row): LinkedRow {
  const key = `${family}-${String(r.id ?? r.task_id ?? r.target_id ?? '')}`;
  const base = { key, severity: null as string | null };
  switch (family) {
    case 'vulns': {
      const id = num(r.vulnerability_id);
      const title = text(r.title) ?? text(r.vuln_id) ?? 'A vulnerability';
      return { ...base, title, sub: dot(text(r.title) ? text(r.vuln_id) : null, r.kev_flag ? 'Known exploited' : null, num(r.cvss_score) != null ? `CVSS ${num(r.cvss_score)}` : null), href: id ? `/cyber-assurance/vulnerabilities/${id}` : null, unlink: id ? { family, id } : null, severity: text(r.severity) };
    }
    case 'risks': {
      const id = num(r.risk_id);
      return { ...base, title: text(r.title) ?? 'A risk', sub: dot(word(r.status), num(r.residual_score) != null ? `Residual ${Math.round(num(r.residual_score) as number)}` : null), href: id ? `/erm/risks/${id}` : null, unlink: id ? { family, id } : null };
    }
    case 'assets': {
      const id = num(r.asset_id);
      return { ...base, title: text(r.name) ?? 'An asset', sub: dot(word(r.type), word(r.criticality)), href: id ? `/cyber-assurance/assets/${id}` : null, unlink: id ? { family, id } : null };
    }
    case 'controls': {
      const id = num(r.control_id);
      const link = num(r.id);
      const type = text(r.target_type);
      const href = id && type === 'internal' ? `/erm/internal-controls/${id}` : id && type === 'normalized' ? `/control-library/${id}` : null;
      return { ...base, title: text(r.name) ?? (text(r.code) ? `Control ${text(r.code)}` : 'A control'), sub: dot(text(r.name) ? text(r.code) : null, type === 'internal' ? 'Internal control' : type === 'normalized' ? 'Library control' : 'Framework control'), href, unlink: link ? { family, id: link } : null };
    }
    case 'evidence': {
      const id = num(r.evidence_id);
      return { ...base, title: text(r.name) ?? 'An evidence item', sub: word(r.relationship_type), href: id ? `/evidence/${id}` : null, unlink: id ? { family, id } : null };
    }
    case 'vendors': {
      const id = num(r.vendor_id);
      return { ...base, title: text(r.name) ?? 'A vendor', sub: dot(text(r.contract_reference) ? `Contract ${text(r.contract_reference)}` : null, text(r.breach_clause) ? `Clause ${text(r.breach_clause)}` : null), href: id ? `/vendor-risk/vendors/${id}` : null, unlink: id ? { family, id } : null };
    }
    case 'projects': {
      const id = num(r.is_project_id);
      return { ...base, title: text(r.name) ?? 'A project', sub: dot(word(r.status), word(r.health)), href: id ? `/is-projects/${id}` : null, unlink: id ? { family, id } : null };
    }
    case 'governance': {
      const link = num(r.id);
      const target = num(r.target_id);
      const statement = text(r.target_type) === 'policy_statement';
      return { ...base, title: text(r.title) ?? (statement ? 'A policy statement' : 'A document'), sub: dot(statement ? 'Policy statement' : 'Document', text(r.code)), href: !statement && target ? `/governance/documents/${target}` : null, unlink: link ? { family, id: link } : null };
    }
    case 'tasks': {
      const id = num(r.task_id) ?? num(r.id);
      return { ...base, title: text(r.title) ?? 'A task', sub: dot(text(r.status), text(r.priority), r.from_action ? 'From a corrective action' : null), href: id ? `/tasks/${id}` : null, unlink: null };
    }
  }
}

/** The body of the ADD call for what the picker chose. Controls and documents come as `<kind>:<id>` (the picker mixes two lists); the rest are the record's id. */
export function addBody(family: FamilyKey, value: string): Record<string, unknown> | null {
  const [kind, raw] = value.includes(':') ? [value.split(':')[0], value.split(':')[1]] : ['', value];
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) return null;
  switch (family) {
    case 'vulns': return { vulnerability_id: id };
    case 'risks': return { risk_id: id };
    case 'assets': return { asset_id: id };
    case 'evidence': return { evidence_id: id };
    case 'vendors': return { vendor_id: id };
    case 'projects': return { is_project_id: id };
    case 'controls': return kind === 'internal' || kind === 'normalized' ? { target_type: kind, control_id: id } : null;
    case 'governance': return kind === 'governance_document' || kind === 'policy_statement' ? { target_type: kind, target_id: id } : null;
    case 'tasks': return null;
  }
}

/** The picker values of what is already linked, so the picker does not offer it again. */
export function linkedValues(family: FamilyKey, rows: ReadonlyArray<Row>): Set<string> {
  const out = new Set<string>();
  rows.forEach((r) => {
    const pick = (v: unknown, prefix = '') => { const id = num(v); if (id != null) out.add(`${prefix}${id}`); };
    if (family === 'vulns') pick(r.vulnerability_id);
    else if (family === 'risks') pick(r.risk_id);
    else if (family === 'assets') pick(r.asset_id);
    else if (family === 'evidence') pick(r.evidence_id);
    else if (family === 'vendors') pick(r.vendor_id);
    else if (family === 'projects') pick(r.is_project_id);
    else if (family === 'controls') pick(r.control_id, `${text(r.target_type) ?? ''}:`);
    else if (family === 'governance') pick(r.target_id, `${text(r.target_type) ?? ''}:`);
  });
  return out;
}

/** Where the record an issue was raised from opens, for the sources that have a page of their own; null for the rest (an automated check, an import, a vendor review ...). */
export function sourceHref(sourceType?: string | null, sourceId?: number | null): string | null {
  const id = typeof sourceId === 'number' && sourceId > 0 ? sourceId : null;
  if (!id) return null;
  switch (sourceType) {
    case 'vulnerability': return `/cyber-assurance/vulnerabilities/${id}`;
    case 'risk': return `/erm/risks/${id}`;
    case 'asset': return `/cyber-assurance/assets/${id}`;
    case 'is_project': return `/is-projects/${id}`;
    case 'governance_document': return `/governance/documents/${id}`;
    case 'control_internal': return `/erm/internal-controls/${id}`;
    default: return null;
  }
}

/** The severity word of a row, as the shared pill reads it. */
export const rowSeverity = (row: LinkedRow): string | null => (row.severity && issueSeverity.has(row.severity.toLowerCase()) ? row.severity.toLowerCase() : null);
