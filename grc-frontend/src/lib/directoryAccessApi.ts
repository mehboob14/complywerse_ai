// The Access tab of a folder's Properties: the requests of the cascading rights (backend `services/department_rights.py`, routes in `routers/admin_departments_router.py`). Reading who has
// access is open to anyone signed in; picking, giving, changing and taking back access need the manage level on the unit (or the right to administer the organisation).
// What the answers hold is read by app/(dashboard)/governance/documents/_workspace/folders/accessModel.ts, which tolerates a backend that leaves a field out.
import apiClient from '@/lib/api';

/** The cache key of every read of the Access tab (the list, the picker): a change to a unit's people or rights makes them all out of date. */
export const ACCESS_KEY = ['directory-access'] as const;

const base = (departmentId: number) => `/admin/departments/${departmentId}`;

export const directoryAccessApi = {
  /** everyone with a way in and why, the unit's own grants, and the grants it inherits: `{ people, grants, inherited_grants }` */
  access: (departmentId: number) => apiClient.get<unknown>(`${base(departmentId)}/access`),
  /** the people and roles a grant on this unit can name (the first 25 of each that match `q`): `{ people, roles }` */
  principals: (departmentId: number, q: string) => apiClient.get<unknown>(`${base(departmentId)}/principals`, { params: q ? { q } : {} }),
  /** give a person or a role a level on the unit and everything under it; `none` blocks what a unit above gave. A row that exists takes the new level. */
  setGrant: (departmentId: number, body: { principal_type: 'user' | 'role'; principal_id: number; level: 'none' | 'view' | 'edit' | 'manage' }) =>
    apiClient.put<unknown>(`${base(departmentId)}/grants`, body),
  /** take a row off the unit: what it gave, or blocked, comes from the units above again */
  removeGrant: (departmentId: number, grantId: number) => apiClient.delete<{ message: string; id: number }>(`${base(departmentId)}/grants/${grantId}`),
};
