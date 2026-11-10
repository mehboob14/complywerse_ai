// Hand-off between the report workspace (or the library's download) and the /reports/print route.
// localStorage (not sessionStorage) carries it because print opens in a NEW TAB, and sessionStorage is per-tab: the payload would arrive empty. The print tab takes the report ONCE: it moves it into
// its own sessionStorage and removes the shared copy, so a refresh of that tab still prints the same report and no other tab can pick up (and print) a report that was left for someone else.

import type { ReportSpec } from './types';

const KEY = 'grc-report-print';

export function stashPrintSpec(spec: ReportSpec): void {
  try { localStorage.setItem(KEY, JSON.stringify(spec)); } catch { /* quota */ }
}

export function readPrintSpec(): ReportSpec | null {
  try {
    const own = sessionStorage.getItem(KEY);                  // this tab already took its report (a refresh)
    if (own) return JSON.parse(own) as ReportSpec;
  } catch { /* no tab storage: fall through to the hand-off */ }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    try { sessionStorage.setItem(KEY, raw); } catch { /* the report prints now; a refresh will not find it */ }
    return JSON.parse(raw) as ReportSpec;
  } catch { return null; }
}
