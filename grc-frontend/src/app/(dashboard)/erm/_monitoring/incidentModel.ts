// The incident register's definition (facets, quick chips, sorts, board), apart from React (`incidentModel.test.ts`). The rows are GET /erm/incidents (newest first, read whole).
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, isOpenIncident, linkedTotal, resolvedThisMonth } from '../../../../lib/erm/incident.ts';
import { incidentStatus, severity } from '../../../../lib/statuses/monitoring.ts';
import { buildSchema, type RegisterDef } from '../../../../components/records/registerModel.ts';

export interface IncidentRow {
  id: number;
  title: string;
  description?: string | null;
  incident_date: string;
  discovered_date?: string | null;
  severity: string;
  status: string;
  financial_impact?: number | null;
  operational_impact?: string | null;
  root_cause?: string | null;
  corrective_actions?: string | null;
  lessons_learned?: string | null;
  risk_id?: number | null;
  risk_title?: string | null;
  assigned_to?: number | null;
  assignee_name?: string | null;
  resolved_at?: string | null;
  tags?: string[] | null;
  link_counts?: Record<string, number> | null;
}

const NONE = 'none';
export const SEVERITY_RANK: Readonly<Record<string, number>> = { critical: 0, high: 1, medium: 2, low: 3 };

export const linked = (i: IncidentRow): number => linkedTotal(i.link_counts);

/** Which board column holds a status: the model's `contained` and the page's `mitigating` are one column; a word nobody listed goes with the closed ones. */
const columnOf = (status: string): string => (status === 'contained' ? 'mitigating' : (INCIDENT_STATUSES as readonly string[]).includes(status) ? status : 'closed');

export function incidentDef(me: number | null): RegisterDef<IncidentRow> {
  return {
    key: 'incident',
    noun: { one: 'incident', other: 'incidents' },
    idOf: (i) => i.id,
    text: (i) => [i.title, i.risk_title, i.assignee_name, i.description, i.root_cause, ...(i.tags ?? [])].filter(Boolean).join(' '),
    facets: [
      { key: 'status', label: 'Status', defaultOpen: true, values: (i) => [i.status], options: () => INCIDENT_STATUSES.map((value) => ({ value, label: incidentStatus.label(value) })) },
      { key: 'severity', label: 'Severity', defaultOpen: true, values: (i) => [i.severity], options: () => INCIDENT_SEVERITIES.map((value) => ({ value, label: severity.label(value) })) },
      {
        key: 'assignee', label: 'Assigned to', searchable: true, limit: 7,
        values: (i) => [i.assigned_to ? String(i.assigned_to) : NONE],
        options: (rows) => {
          const seen = new Map<string, string>();
          rows.forEach((i) => { if (i.assigned_to) seen.set(String(i.assigned_to), i.assignee_name || `User ${i.assigned_to}`); });
          const list = Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
          return rows.some((i) => !i.assigned_to) ? list.concat({ value: NONE, label: 'Unassigned' }) : list;
        },
      },
      {
        key: 'risk', label: 'Risk', searchable: true, limit: 7,
        values: (i) => [i.risk_id ? String(i.risk_id) : NONE],
        options: (rows) => {
          const seen = new Map<string, string>();
          rows.forEach((i) => { if (i.risk_id) seen.set(String(i.risk_id), i.risk_title || `Risk ${i.risk_id}`); });
          const list = Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
          return rows.some((i) => !i.risk_id) ? list.concat({ value: NONE, label: 'Not linked to a risk' }) : list;
        },
      },
      {
        key: 'tag', label: 'Tag', searchable: true, limit: 7,
        values: (i) => i.tags ?? [],
        options: (rows) => Array.from(new Set(rows.flatMap((i) => i.tags ?? []))).sort().map((value) => ({ value, label: value })),
      },
    ],
    quick: [
      { key: 'open', label: 'Open', test: (i) => isOpenIncident(i.status), title: 'Not yet resolved or closed' },
      { key: 'severe', label: 'Critical or high, open', test: (i) => isOpenIncident(i.status) && (i.severity === 'critical' || i.severity === 'high'), title: 'The Overview counts the same ones' },
      { key: 'investigating', label: incidentStatus.label('investigating'), test: (i) => i.status === 'investigating' },
      { key: 'resolved', label: 'Resolved this month', test: (i, now) => resolvedThisMonth(i, now) },
      { key: 'unassigned', label: 'Unassigned', test: (i) => !i.assigned_to },
      ...(me != null ? [{ key: 'mine', label: 'Mine', test: (i: IncidentRow) => i.assigned_to === me }] : []),
    ],
    sorts: [
      { key: 'date', label: 'Incident date', firstDir: 'desc', value: (i) => i.incident_date },
      { key: 'severity', label: 'Severity (worst first)', firstDir: 'asc', value: (i) => SEVERITY_RANK[i.severity] ?? 9 },
      { key: 'status', label: 'Status', firstDir: 'asc', value: (i) => (INCIDENT_STATUSES as readonly string[]).indexOf(i.status) },
      { key: 'title', label: 'Title', firstDir: 'asc', value: (i) => i.title },
      { key: 'assignee', label: 'Assigned to', firstDir: 'asc', value: (i) => i.assignee_name || null },
      { key: 'impact', label: 'Financial impact', firstDir: 'desc', value: (i) => i.financial_impact ?? null },
      { key: 'linked', label: 'Linked records', firstDir: 'desc', value: (i) => linked(i) },
    ],
    defaultSort: { key: 'date', dir: 'desc' },
    board: {
      label: 'Incidents by status',
      columns: INCIDENT_STATUSES.map((id) => ({ id, label: incidentStatus.label(id), test: (i: IncidentRow) => columnOf(i.status) === id })),
    },
    pageSize: 25,
  };
}

export const INCIDENT_SCHEMA = buildSchema(incidentDef(0))   // with a person, so every chip key is one the address may name;
