'use client';

// Every questionnaire of the organisation (archived ones included: the Library hides them on request, the builder's "From library" offers them as sources), read once under ONE key for the Library, the Send
// sheet and the builder. The answer is `{ items, total }`: `total` is the server's, so a list cut at 500 says so instead of pretending to be whole.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import { questionnairesApi, templatesKey } from '../../_lib/questionnairesApi';

export const ALL_TEMPLATES_KEY = [...templatesKey, 'all'] as const;

export function useTemplates() {
  return useQuery({
    queryKey: ALL_TEMPLATES_KEY,
    queryFn: async () => (await questionnairesApi.list(true)).data,
    placeholderData: keepPreviousData,
    ...TPRM_QUERY_OPTS,
  });
}
