// Where a saved report or dashboard lives, as pure functions apart from React and axios so `node --test` pins them (syncModel.test.ts): what a failed request means (the server
// could not be reached, it refused, the person is not allowed), which local copies are worth sending again, and the plain words for each case. savedReports.ts and dashboards.ts
// carry the browser storage and the requests; the decisions are here, once, for both.

export type SyncState = 'synced' | 'device' | 'refused';

/** unreachable = no answer, a server fault, a busy server (trying again can help); denied = 401 or 403; refused = any other 4xx (the server read it and said no). */
export type SyncFailureKind = 'unreachable' | 'denied' | 'refused';
export interface SyncFailure { kind: SyncFailureKind; status: number | null }

type HttpError = { response?: { status?: number } };

/** What a failed request tells: the HTTP status when the server answered, else null (no answer at all). */
export function classifySync(error: unknown): SyncFailure {
  const raw = (error as HttpError | null | undefined)?.response?.status;
  const status = typeof raw === 'number' ? raw : null;
  if (status === null || status >= 500 || status === 408 || status === 425 || status === 429) return { kind: 'unreachable', status };
  if (status === 401 || status === 403) return { kind: 'denied', status };
  return { kind: 'refused', status };
}

/** Whether sending the same thing again can come out differently. */
export const canSendAgain = (f: SyncFailure): boolean => f.kind === 'unreachable';

/** The failure in the words a person reads; `what` is the thing that was being done ("save the report", "delete the dashboard"). */
export function failureWords(f: SyncFailure, what: string): string {
  if (f.kind === 'denied') return `Your role does not allow you to ${what}.`;
  if (f.kind === 'refused') return `The server did not accept the request to ${what}.`;
  return `The server could not be reached, so it was not possible to ${what}. Try again in a moment.`;
}

/** The local copies of saved items that are worth sending to the server again: not on the server already, and not ones it has refused (they would be refused every time). */
export function toResend(local: readonly { id: string }[], onServer: ReadonlySet<string>, refused: Readonly<Record<string, number>>): string[] {
  return local.map((s) => s.id).filter((id) => !!id && !onServer.has(id) && !(id in refused));
}

/** The state of one item in a list: on the server, kept on this device (waiting to be sent), or refused by the server. */
export function syncStateOf(id: string, onServer: ReadonlySet<string>, refused: Readonly<Record<string, number>>): SyncState {
  if (onServer.has(id)) return 'synced';
  return id in refused ? 'refused' : 'device';
}

/** The refused map after the server refused `id` with `status` / after it stopped mattering (the item was sent, deleted or sent again). */
export const withRefused = (map: Readonly<Record<string, number>>, id: string, status: number | null): Record<string, number> => ({ ...map, [id]: status ?? 0 });
export function withoutRefused(map: Readonly<Record<string, number>>, id: string): Record<string, number> {
  const next: Record<string, number> = { ...map };
  delete next[id];
  return next;
}

/** A refused map read back from storage: only { id: number } pairs survive. */
export function readRefused(raw: string | null): Record<string, number> {
  try {
    const value = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, number> = {};
    Object.keys(value).forEach((k) => { if (typeof value[k] === 'number') out[k] = value[k]; });
    return out;
  } catch { return {}; }
}

/** The line above a list that has items waiting on this device: "2 reports are only on this device." (null when none). */
export function deviceLine(counts: { device: number; refused: number }, noun: { one: string; other: string }): string | null {
  const parts: string[] = [];
  if (counts.device > 0) parts.push(`${counts.device} ${counts.device === 1 ? noun.one : noun.other} ${counts.device === 1 ? 'is' : 'are'} only on this device and will be saved when the server can be reached.`);
  if (counts.refused > 0) parts.push(`${counts.refused} ${counts.refused === 1 ? noun.one : noun.other} could not be saved because the server did not accept ${counts.refused === 1 ? 'it' : 'them'}.`);
  return parts.length ? parts.join(' ') : null;
}
