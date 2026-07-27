/** Shared React Query defaults for TPRM screens — avoids endless spinners on tab hops. */
export const TPRM_QUERY_OPTS = {
  retry: 1,
  staleTime: 30_000,
  refetchOnWindowFocus: false,
} as const;
