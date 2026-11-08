// Where a request of the Performance Overview stands, without React, so `node --test` checks it (overviewModel.test.ts). The rules of the page itself (the areas, the band,
// the weakest areas, Overall readiness) are in perfModel.ts and lib/perf/moduleFeeds.ts; this file keeps only the request-state primitives the Cyber Security KPI strip shares
// with the page (CyberKpis.tsx and kpiModel.ts import them from here).
import { canRetry, statusOf } from '../../../../components/ui/ds/reportOutcome.ts';

// ── where a request stands ───────────────────────────────────────────────────
export type Load = 'loading' | 'error' | 'ready';

/** Where a request stands, from what React Query reports. An earlier answer still stands when a refresh fails. `null` is no answer: the module pages ask for
 *  the same scorecards under the same keys and some of them store null there when their own request failed (the old dashboard did too), and a stored null
 *  must never be read as "no data". */
export function loadOf(q: { status: 'pending' | 'error' | 'success'; data?: unknown }): Load {
  if (q.data === null) return 'error';
  if (q.status === 'success' || q.data !== undefined) return 'ready';
  return q.status === 'error' ? 'error' : 'loading';
}

/** React Query's retry for the page's requests: a refusal (invalid, not allowed, not found) is final and is said at once, the rest is tried once more.
 *  (They used to be swallowed into null, so nothing was ever retried and nothing was ever said.) */
export const retryDashboard = (failures: number, error: unknown): boolean => canRetry(error) && failures < 1;

/** A request that has not answered after this long says so (the client's own timeout is 15 minutes, so without a word a hung card is a blank one). */
export const SLOW_MS = 8000;

/** The server refused the request (not signed in, or not allowed): no Retry, and the row says "no access", not "couldn't load". */
export const isRefusal = (error: unknown): boolean => { const status = statusOf(error); return status === 401 || status === 403; };
