// The browser-side memory of which saved reports and dashboards the server REFUSED (the map { id: HTTP status } in localStorage), so a copy kept on this device is not sent again on every list. The
// decisions are in syncModel.ts; this only reads and writes the storage, and every access is guarded (a private window, blocked site data or a full quota must not break the page).
import { readRefused, withRefused, withoutRefused } from './syncModel';

const KEY = 'grc-report-sync-refused';

export function refusedMap(): Record<string, number> {
  try { return readRefused(localStorage.getItem(KEY)); } catch { return {}; }
}

function write(map: Record<string, number>): void {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* storage unavailable: the item is simply tried again next time */ }
}

export function markRefused(id: string, status: number | null): void {
  write(withRefused(refusedMap(), id, status));
}

export function clearRefused(id: string): void {
  const map = refusedMap();
  if (id in map) write(withoutRefused(map, id));
}
