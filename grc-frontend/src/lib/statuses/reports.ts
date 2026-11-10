// The words of the Reports library and Dashboards (app/(dashboard)/reports): where a saved report lives, who can see it, and what a dashboard tile says when it cannot draw its report. One registry per
// kind of word, on the same tone model as the other registries (status.ts). A word nobody registered is neutral with its own readable label.
//
// Tones: success = safe on the server, warning = needs a look (kept on this device only, partial data), danger = the server said no, progress = shared on, neutral = at rest.
import { defineStatuses } from '../status.ts';

/** Where a saved report or dashboard is kept. `device` = only in this browser (the server could not be reached), `refused` = the server answered but did not accept it. */
export const reportSync = defineStatuses('saved report', {
  synced: { tone: 'success', label: 'Saved' },
  device: { tone: 'warning', label: 'This device only' },
  refused: { tone: 'danger', label: 'Not accepted' },
});

/** Who can open a saved report or dashboard. `shared_with_me` is someone else's, shared with the organisation. */
export const reportVisibility = defineStatuses('report visibility', {
  private: { tone: 'neutral', label: 'Only you' },
  shared: { tone: 'progress', label: 'Shared' },
  shared_with_me: { tone: 'neutral', label: 'Shared with you' },
});

/** What a dashboard tile says when it cannot draw its report (the words are the tile's own title line). */
export const tileState = defineStatuses('dashboard tile', {
  missing: { tone: 'warning', label: 'Report not available' },
  no_module: { tone: 'neutral', label: 'No access to this module' },
  error: { tone: 'danger', label: "Couldn't load" },
  partial: { tone: 'warning', label: 'Part of the data' },
});
