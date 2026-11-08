'use client';

// The one request behind "evidence for this control": which files are linked to the control the address names (controlScope.ts says how to read the address). Asked only when the
// address names a control; a failure is the Library's to say, with Retry, never an unfiltered list drawn as if it were the control's.
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { RETRY_AFTER, retryRead } from './libraryData';
import type { ControlAnswer, ControlScope } from './controlScope';

export const CONTROL_SCOPE_KEY = 'evidence-by-control';

export function useControlScope(scope: ControlScope | null) {
  return useQuery({
    queryKey: [CONTROL_SCOPE_KEY, scope?.kind ?? null, scope?.ref ?? null],
    queryFn: async () => (await apiClient.get('/evidence-mgmt/links/by-control', { params: { ref: scope?.ref, kind: scope?.kind } })).data as ControlAnswer,
    enabled: scope !== null,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
  });
}
