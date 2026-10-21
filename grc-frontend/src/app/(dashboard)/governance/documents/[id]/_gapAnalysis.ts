// The gap analysis view's plain logic (_GapAnalysisView.tsx).

type Run = {
  id: number; status?: string | null; uploaded_framework_id?: number | null; framework_name?: string | null; started_at?: string | null;
  document_version?: string | null;
};

const newer = (a: Run, b: Run) => (a.started_at || '') > (b.started_at || '') || ((a.started_at || '') === (b.started_at || '') && a.id > b.id);

/** Each framework's newest run, newest first. */
function newestPerFramework<T extends Run>(runs: T[]): T[] {
  const newest = new Map<string, T>();
  for (const r of runs) {
    const key = r.uploaded_framework_id != null ? `id:${r.uploaded_framework_id}` : `name:${r.framework_name || r.id}`;
    const seen = newest.get(key);
    if (!seen || newer(r, seen)) newest.set(key, r);
  }
  return Array.from(newest.values()).sort((a, b) => (newer(a, b) ? -1 : 1));
}

/** The runs to show as failed: each framework's newest run, when it failed (a later run that worked, or still runs, replaces it).
 *  Newest first. */
export function lastFailedRuns<T extends Run>(runs: T[]): T[] {
  return newestPerFramework(runs).filter((r) => r.status === 'failed');
}

/** The results made on another version of the document than its current one: each framework's newest run, when it finished on a
 *  version it recorded that is not the current one (a newer run still running or failed replaces it; runs made before the
 *  version was recorded say nothing). Newest first: the first one's version is the one to name. */
export function outdatedRuns<T extends Run>(runs: T[], currentVersion?: string | null): T[] {
  if (!currentVersion) return [];
  return newestPerFramework(runs).filter((r) => r.status === 'completed' && !!r.document_version && r.document_version !== currentVersion);
}

/** A framework's type as people read it: "best_practice" -> "Best practice", "international_standard" -> "International standard". */
export function frameworkTypeLabel(type?: string | null): string {
  const t = String(type || '').replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
