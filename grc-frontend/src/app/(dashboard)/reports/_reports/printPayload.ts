// Hand-off between the Report Builder and the /reports/print route.
// localStorage (not sessionStorage) because print opens in a NEW TAB, and
// sessionStorage is per-tab — the payload would arrive empty.

import type { ReportSpec } from './types';

const KEY = 'grc-report-print';

export function stashPrintSpec(spec: ReportSpec): void {
  try { localStorage.setItem(KEY, JSON.stringify(spec)); } catch { /* quota */ }
}

export function readPrintSpec(): ReportSpec | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ReportSpec) : null;
  } catch { return null; }
}
