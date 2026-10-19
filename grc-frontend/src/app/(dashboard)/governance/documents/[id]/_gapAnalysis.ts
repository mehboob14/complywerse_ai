// The gap analysis view's plain logic (_GapAnalysisView.tsx).

type Run = { id: number; status?: string | null; uploaded_framework_id?: number | null; framework_name?: string | null; started_at?: string | null };

const newer = (a: Run, b: Run) => (a.started_at || '') > (b.started_at || '') || ((a.started_at || '') === (b.started_at || '') && a.id > b.id);

/** The runs to show as failed: each framework's newest run, when it failed (a later run that worked, or still runs, replaces it).
 *  Newest first. */
export function lastFailedRuns<T extends Run>(runs: T[]): T[] {
  const newest = new Map<string, T>();
  for (const r of runs) {
    const key = r.uploaded_framework_id != null ? `id:${r.uploaded_framework_id}` : `name:${r.framework_name || r.id}`;
    const seen = newest.get(key);
    if (!seen || newer(r, seen)) newest.set(key, r);
  }
  return Array.from(newest.values()).filter((r) => r.status === 'failed').sort((a, b) => (newer(a, b) ? -1 : 1));
}

/** A framework's type as people read it: "best_practice" -> "Best practice", "international_standard" -> "International standard". */
export function frameworkTypeLabel(type?: string | null): string {
  const t = String(type || '').replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
