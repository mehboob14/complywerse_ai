/** The one line under a document's "Mapped against" frameworks, in this order: a run going on, what went wrong with the last try,
 *  nothing to map against (no framework saved, none picked), then how the last run went. */
export type ScopeLine = 'running' | 'error' | 'none' | 'completed' | 'failed' | 'skipped' | null;

export function scopeLine(i: {
  running: boolean; error: string; saved: number; picked: number;
  last?: { status?: string; statements?: number | null; message?: string } | null;
}): ScopeLine {
  if (i.running) return 'running';
  if (i.error) return 'error';
  if (!i.saved && !i.picked) return 'none';
  const s = i.last?.status;
  if (s === 'completed' && i.last?.statements != null) return 'completed';
  if (s === 'failed') return 'failed';
  if (s === 'skipped' && i.last?.message) return 'skipped';
  return null;
}
