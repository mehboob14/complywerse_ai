// Saved report definitions.
//
// Server-first (so reports can be shared with the team) with a localStorage fallback for the one case it is meant for: the server could not be reached (or answered with a fault), so a report
// the person just built is not lost. That copy is then sent again on the next list, and it is never invisible: every list says which items are on the server, which wait on this device and
// which the server REFUSED (a refusal is recorded and not sent again until the person asks; it would be refused every time).
//
// Two ways to write, for two kinds of caller:
//   persistSpec / removeSpec / duplicateSpec  the builder's: they never throw, they keep a local copy when the server did not take it, and say which ('server' | 'local'); a refusal is recorded.
//   putSpec / dropSpec / retrySpec            the library's: they THROW when the server did not take it (the caller shows the failure and Retry), and keep no local shadow of a report that
//                                             lives on the server (that copy was never shown and is lost on the next list).
// What a failure means (unreachable, denied, refused) is syncModel.ts.

import apiClient from '@/lib/api';
import type { ReportSpec } from './types';
import { classifySync, canSendAgain, syncStateOf, toResend, type SyncFailure, type SyncState } from '../_library/syncModel';
import { clearRefused, markRefused, refusedMap } from '../_library/syncStore';

const KEY = 'grc-report-specs';

export type SpecSource = 'server' | 'local';

/* ── local fallback ─────────────────────────────────────────────────────── */
function loadLocal(): ReportSpec[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? (raw as ReportSpec[]) : [];
  } catch { return []; }
}
function persistLocal(all: ReportSpec[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* quota */ }
}
function saveLocal(spec: ReportSpec): void {
  const all = loadLocal();
  const i = all.findIndex((s) => s.id === spec.id);
  if (i >= 0) all[i] = spec; else all.push(spec);
  persistLocal(all);
}
function deleteLocal(id: string): void {
  persistLocal(loadLocal().filter((s) => s.id !== id));
}

/* ── server ─────────────────────────────────────────────────────────────── */
interface ServerReport {
  slug: string; name: string; dataset: string;
  spec: Partial<ReportSpec>; is_shared: boolean; is_mine: boolean;
  updated_at?: string | null;
}

const toSpec = (r: ServerReport): ReportSpec => ({
  ...(r.spec as ReportSpec),
  id: r.slug,
  name: r.name,
  dataset: r.dataset,
  shared: !!r.is_shared,
  mine: r.is_mine !== false,
  updatedAt: r.updated_at ?? null,
});

const toBody = (spec: ReportSpec) => ({
  slug: spec.id, name: spec.name, dataset: spec.dataset,
  spec, is_shared: !!spec.shared,
});

export async function getSpec(id: string): Promise<{ spec: ReportSpec | null; source: SpecSource }> {
  try {
    const { data } = await apiClient.get(`/reporting/reports/${encodeURIComponent(id)}`);
    if (data?.slug) return { spec: toSpec(data as ServerReport), source: 'server' };
  } catch {
    /* fall through to local */
  }
  const local = loadLocal().find((s) => s.id === id) ?? null;
  return { spec: local, source: 'local' };
}

export interface SpecList {
  specs: ReportSpec[];
  /** 'server' when the list was read from the server; 'local' when it could not be (then `failure` says why) */
  source: SpecSource;
  /** set when the server could not be read */
  failure?: SyncFailure;
  /** the slugs the server holds; any other spec in `specs` is only on this device */
  onServer: string[];
  /** the slugs the server refused, with the HTTP status (kept in this browser) */
  refused: Record<string, number>;
}

/** The state of one spec of a list. */
export const stateOf = (list: SpecList, id: string): SyncState => syncStateOf(id, new Set(list.onServer), list.refused);

/** Every report the person can see (their own and the ones shared with them), plus the copies kept on this device. Copies the server does not have yet are sent now (it upserts by slug, so
 *  sending again never duplicates); one the server refuses is recorded and left alone; one it cannot take for now stays on the device. */
export async function listSpecsFull(): Promise<SpecList> {
  let serverSpecs: ReportSpec[];
  try {
    const { data } = await apiClient.get('/reporting/reports');
    serverSpecs = ((data?.reports || []) as ServerReport[]).map(toSpec);
  } catch (e) {
    return { specs: loadLocal(), source: 'local', failure: classifySync(e), onServer: [], refused: refusedMap() };
  }

  const serverIds = new Set(serverSpecs.map((s) => s.id));
  const local = loadLocal();
  const send = new Set(toResend(local, serverIds, refusedMap()));
  for (const s of local) {
    if (!send.has(s.id)) continue;
    try {
      await apiClient.post('/reporting/reports', toBody(s));
      deleteLocal(s.id);                                  // sent: the server's copy is the one that counts
      clearRefused(s.id);
      serverIds.add(s.id);
    } catch (e) {
      const failure = classifySync(e);
      if (!canSendAgain(failure)) markRefused(s.id, failure.status);
    }
  }
  const stillLocal = loadLocal().filter((s) => s.id && !serverIds.has(s.id));
  return { specs: [...serverSpecs, ...stillLocal], source: 'server', onServer: Array.from(serverIds), refused: refusedMap() };
}

/** Same list, in the shape the builder has always read (it also carries the sync fields). */
export const listSpecs = listSpecsFull;

export async function persistSpec(spec: ReportSpec): Promise<SpecSource> {
  try {
    await apiClient.post('/reporting/reports', toBody(spec));
    deleteLocal(spec.id);   // don't leave a stale local shadow of a synced report
    clearRefused(spec.id);
    return 'server';
  } catch (e) {
    const failure = classifySync(e);
    if (!canSendAgain(failure)) markRefused(spec.id, failure.status);   // the library shows it as "Not accepted" instead of looking saved
    saveLocal(spec);
    return 'local';
  }
}

/** Save a report on the server; throws when the server does not take it. No local copy is made. */
export async function putSpec(spec: ReportSpec): Promise<void> {
  await apiClient.post('/reporting/reports', toBody(spec));
  deleteLocal(spec.id);
  clearRefused(spec.id);
}

/** Delete a report on the server; throws when the server does not delete it. A report that is already gone (404) counts as deleted. */
export async function dropSpec(id: string): Promise<void> {
  try {
    await apiClient.delete(`/reporting/reports/${encodeURIComponent(id)}`);
  } catch (e) {
    if (classifySync(e).status !== 404) throw e;
  }
  deleteLocal(id);
  clearRefused(id);
}

/** Send the copy kept on this device to the server once, whatever was decided before; throws when the server does not take it (a refusal is recorded again). */
export async function retrySpec(id: string): Promise<void> {
  const copy = loadLocal().find((s) => s.id === id);
  if (!copy) return;
  clearRefused(id);
  try {
    await putSpec(copy);
  } catch (e) {
    const failure = classifySync(e);
    if (!canSendAgain(failure)) markRefused(id, failure.status);
    throw e;
  }
}

/** Forget the copy kept on this device (the person gave up on it). */
export function dropLocalSpec(id: string): void {
  deleteLocal(id);
  clearRefused(id);
}

/** Delete a report. Returns 'server' if the server confirmed the delete, else
 *  'local' (the caller may want to warn that a shared copy may persist). */
export async function removeSpec(id: string): Promise<SpecSource> {
  let source: SpecSource = 'local';
  try {
    await apiClient.delete(`/reporting/reports/${encodeURIComponent(id)}`);
    source = 'server';
  } catch {
    /* server unreachable or not-yours — fall through to clear any local copy */
  }
  deleteLocal(id);
  clearRefused(id);
  return source;
}

export function newSpecId(): string {
  return `rep_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Clone a report under a new id (always owned by the current user). */
export async function duplicateSpec(spec: ReportSpec, name?: string): Promise<{ spec: ReportSpec; source: SpecSource }> {
  const copy: ReportSpec = {
    ...spec,
    id: newSpecId(),
    name: name ?? `${spec.name || 'Untitled report'} (copy)`,
    shared: false,
    mine: true,
    updatedAt: new Date().toISOString(),
  };
  const source = await persistSpec(copy);
  return { spec: copy, source };
}
