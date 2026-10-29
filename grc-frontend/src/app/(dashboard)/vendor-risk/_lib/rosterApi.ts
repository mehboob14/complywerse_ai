// The calls of the Roster page (backend vendor_risk/tpra/roster.py): who the workflow asks and tells at each review stage.
// Each change answers with the whole roster, so the page takes its next state from the answer.

import { apiClient } from '@/lib/api';
import type { RosterPayload } from './rosterModel';

export const rosterKey = ['tprm-roster'] as const;

export const rosterApi = {
  get: () => apiClient.get<RosterPayload>('/vendor-risk/roster'),
  add: (role: string, userId: number) => apiClient.post<RosterPayload>(`/vendor-risk/roster/${role}/members`, { user_id: userId }),
  remove: (role: string, userId: number) => apiClient.delete<RosterPayload>(`/vendor-risk/roster/${role}/members/${userId}`),
};
