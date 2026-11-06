'use client';

// The ticks of a record explorer. They belong to one set of matches: when the matches change (a filter, a search, a refresh after a bulk action) the ticks go, so a bulk action never
// reaches a record the person can no longer see. The one exception is what a bulk action could NOT do (a move that failed for some): those stay ticked through the first change
// that follows, for a few seconds, so the person can try them again. The state is adjusted while rendering (not in an effect), so a stale tick is never drawn.
import { useState } from 'react';

const NONE: ReadonlySet<number> = new Set<number>();
const KEEP_MS = 10_000;

export function useSelection(matchKey: string) {
  const [selected, setSelected] = useState<ReadonlySet<number>>(NONE);
  const [seen, setSeen] = useState(matchKey);
  const [kept, setKept] = useState<{ ids: number[]; until: number } | null>(null);
  if (seen !== matchKey) {
    setSeen(matchKey);
    setSelected(kept && kept.until > Date.now() ? new Set(kept.ids) : NONE);
    setKept(null);
  }
  return {
    selected,
    set: setSelected,
    clear: () => setSelected(NONE),
    /** these ids stay ticked through the next change of the matches */
    keep: (ids: number[]) => setKept(ids.length > 0 ? { ids, until: Date.now() + KEEP_MS } : null),
  };
}
