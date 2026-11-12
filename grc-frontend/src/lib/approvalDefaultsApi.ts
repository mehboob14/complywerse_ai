// The requests of the approval defaults (`/governance/approval-defaults`, lib/approvalDefaults.ts has the shapes and the words) and of the list of who can be asked. A unit is
// its id, or 'org' for the whole organisation. Refusals are the server's own sentences (400 validation, 403 rights, 404, 409 when a lock above blocks a write): the screens
// show them as they are. Kept here, not in lib/api.ts, so the Directory, "Submit for review" and the exception form read one module.
import apiClient from './api';
import { parseAnswer, parseResolved, type DefaultsAnswer, type PersonType, type Resolved, type Subject, type Targets } from './approvalDefaults';
import type { RouteStageIn } from './approvalRoutes';

export type UnitRef = number | 'org';

/** The key every read of the defaults lives under: after a write, invalidate this one and every unit's answer and the overview are read again. */
export const DEFAULTS_KEY = ['approval-defaults'] as const;
export const OVERVIEW_KEY = [...DEFAULTS_KEY, 'overview'] as const;
export const defaultsKey = (unit: UnitRef) => [...DEFAULTS_KEY, 'unit', unit] as const;
export const resolveKey = (unit: number | null, subject: Subject | 'all') => [...DEFAULTS_KEY, 'resolve', unit, subject] as const;
export const targetsKey = (unit: UnitRef) => ['approval-targets', unit] as const;

const BASE = '/governance/approval-defaults';

export interface DefaultBody { people: { type: PersonType; id?: number }[]; route?: RouteStageIn[]; locked: boolean; is_active: boolean }

export async function readDefaults(unit: UnitRef): Promise<DefaultsAnswer> {
  const { data } = await apiClient.get(BASE, { params: { department_id: String(unit) } });
  const answer = parseAnswer(data);
  if (!answer) throw new Error('The defaults could not be read.');
  return answer;
}

export async function saveDefault(unit: UnitRef, subject: Subject, body: DefaultBody): Promise<unknown> {
  return (await apiClient.put(`${BASE}/${unit}/${subject}`, body)).data;
}

/** Back to inherited: the unit's own default for the subject is removed (a document already in review keeps the people it has). */
export async function revertDefault(unit: UnitRef, subject: Subject): Promise<unknown> {
  return (await apiClient.delete(`${BASE}/${unit}/${subject}`)).data;
}

/** Which units define their own default, for the badges: `{ units: { id: { subject: bool } }, organisation: { subject: bool } }` (unchecked: lib/approvalDefaults `withDefaults` reads it). */
export async function readOverview(): Promise<unknown> {
  return (await apiClient.get(`${BASE}/overview`)).data;
}

/** What a document or an exception of a unit (null: no unit, so the organisation) would get; anyone signed in may ask. */
export async function readResolved(unit: number | null, subject?: Subject): Promise<Resolved> {
  const { data } = await apiClient.get(`${BASE}/resolve`, { params: { department_id: unit === null ? 'org' : String(unit), ...(subject ? { subject } : {}) } });
  const resolved = parseResolved(data);
  if (!resolved) throw new Error('The defaults could not be read.');
  return resolved;
}

/** People, roles and departments that can be asked, and the two owners named for the unit (anyone signed in may ask). */
export async function readTargets(unit: UnitRef): Promise<Targets> {
  const { data } = await apiClient.get<Targets>('/governance/documents/signoff/targets', { params: unit === 'org' ? {} : { department_id: unit } });
  return data;
}
