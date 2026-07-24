// Saved report definitions.
//
// Server-first (so reports can be shared with the team) with a localStorage
// fallback, because the /reporting/reports endpoints only exist after the
// backend is restarted. Until then the feature degrades to private, local
// reports rather than breaking.
//
// Sync is CONTINUOUS and idempotent, not once: on every listSpecs, any local
// spec the server doesn't yet have is re-pushed (the server upserts by slug, so
// re-pushing never duplicates). This means a report saved locally during a
// transient server blip is picked up automatically once the server recovers —
// it is never silently orphaned.

import apiClient from '@/lib/api';
import type { ReportSpec } from './types';

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

export async function listSpecs(): Promise<{ specs: ReportSpec[]; source: SpecSource }> {
  let serverSpecs: ReportSpec[];
  try {
    const { data } = await apiClient.get('/reporting/reports');
    serverSpecs = ((data?.reports || []) as ServerReport[]).map(toSpec);
  } catch {
    return { specs: loadLocal(), source: 'local' };   // server unreachable → local only
  }

  // Re-push any local specs the server doesn't have yet (idempotent upsert),
  // then drop the ones that made it up. Anything that still fails stays local
  // and is merged into the list so it's never invisible.
  const serverIds = new Set(serverSpecs.map((s) => s.id));
  const local = loadLocal();
  const stillLocal: ReportSpec[] = [];
  for (const s of local) {
    if (!s.id || serverIds.has(s.id)) continue;
    try {
      await apiClient.post('/reporting/reports', toBody(s));
      const all = loadLocal().filter((x) => x.id !== s.id);  // synced → remove local copy
      persistLocal(all);
    } catch {
      stillLocal.push(s);
    }
  }
  return { specs: [...serverSpecs, ...stillLocal], source: 'server' };
}

export async function persistSpec(spec: ReportSpec): Promise<SpecSource> {
  try {
    await apiClient.post('/reporting/reports', toBody(spec));
    deleteLocal(spec.id);   // don't leave a stale local shadow of a synced report
    return 'server';
  } catch {
    saveLocal(spec);
    return 'local';
  }
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
