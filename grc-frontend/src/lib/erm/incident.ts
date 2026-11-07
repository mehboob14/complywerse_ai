// The Incidents register's numbers and words, apart from React. The four tiles used to read `investigating` and `resolved_this_month` from the dashboard
// endpoint, which has never sent them (two tiles were always 0); they are counted from what the server does send: `by_status` of GET /erm/incidents/dashboard
// and the `resolved_at` of the incidents themselves. `node --test src/lib/erm/incident.test.ts`.
import { parseUtc } from '../serverTime.ts';

/** The words the page offers, in order. The model comment lists `contained` where the page says `mitigating`; both are kept as they were written. */
export const INCIDENT_STATUSES = ['open', 'investigating', 'mitigating', 'resolved', 'closed'] as const;
export const INCIDENT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

/** Not yet resolved or closed: what the Overview counts as open (`inc_open`). */
export const isOpenIncident = (status?: string | null): boolean => status !== 'resolved' && status !== 'closed';

export interface IncidentDashboard { total_incidents?: number; by_status?: Record<string, number>; by_severity?: Record<string, number>; total_financial_impact?: number; open_incidents?: number }

export interface IncidentTiles {
  /** open + investigating: the server's `open_incidents` */
  open: number;
  investigating: number;
  /** incidents whose resolution date falls in the current calendar month */
  resolvedThisMonth: number;
  totalImpact: number;
}

export function incidentTiles(dashboard: IncidentDashboard | undefined, incidents: ReadonlyArray<{ status?: string | null; resolved_at?: string | null }>, now: Date = new Date()): IncidentTiles {
  const by = dashboard?.by_status ?? {};
  const resolvedThisMonth = incidents.filter((i) => {
    const at = parseUtc(i.resolved_at ?? undefined);
    return !!at && at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
  }).length;
  return {
    open: dashboard?.open_incidents ?? (by.open ?? 0) + (by.investigating ?? 0),
    investigating: by.investigating ?? 0,
    resolvedThisMonth,
    totalImpact: dashboard?.total_financial_impact ?? 0,
  };
}

const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** A money amount as a plain grouped number ("1,250,000"). No currency symbol: the platform does not know the organisation's currency (the old tile said "$0K"). */
export const formatImpact = (n: number | null | undefined): string => (typeof n === 'number' && Number.isFinite(n) ? GROUPED.format(n) : '—');

/** "3 linked" in words: assets, vulnerabilities, risks and evidence the incident points at (the server's `link_counts`). */
export function linkedTotal(counts: Record<string, number> | null | undefined): number {
  return Object.values(counts ?? {}).reduce((n, v) => n + (typeof v === 'number' ? v : 0), 0);
}

// ── the form: what is sent, and what must not be sent ──
export type LinkKey = 'linked_asset_ids' | 'linked_vulnerability_ids' | 'linked_risk_ids' | 'linked_evidence_ids';
export type LinkSet = Record<LinkKey, number[]>;
export const LINK_KEYS: readonly LinkKey[] = ['linked_asset_ids', 'linked_vulnerability_ids', 'linked_risk_ids', 'linked_evidence_ids'];
export type LinksState = 'not_needed' | 'loading' | 'ready' | 'failed';

/**
 * Whether the form may be saved. The server REPLACES an incident's links whenever a link key is in the request (an empty list too, incident_links.py), so a save made
 * before the links were read, or after the read failed, would delete them all. An existing incident can be saved only once its links are in (state `ready`); a new one
 * has none to lose.
 */
export const mayBeSaved = (isNew: boolean, links: LinksState): boolean => isNew || links === 'ready';

/** The link part of the payload: the four lists after a successful read (or for a new incident); nothing at all otherwise, so the server leaves the links alone. */
export function linkPayload(isNew: boolean, links: LinksState, set: LinkSet): Partial<LinkSet> {
  return isNew || links === 'ready' ? { ...set } : {};
}

/** Tags typed as "a, b; c" -> ["a","b","c"] (the page's comma or semicolon rule). */
export const parseTags = (raw: string): string[] => raw.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
