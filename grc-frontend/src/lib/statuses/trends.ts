// The words of the Trends board (app/(dashboard)/reports/trends): where a figure stands against its target. The server's four words (the catalog's rag_status) said in full, on the same tone model as the
// other registries (status.ts). A word nobody registered is neutral with its own readable label. The pill always carries the label: the colour is never the only thing that says it.
//
// Tones: success = on target, warning = watch (past the target, inside the warning level), danger = off target, neutral = no target to measure against (a count with no direction, or nobody set one).
import { defineStatuses } from '../status.ts';

export const trendStatus = defineStatuses('trend status', {
  ok: { tone: 'success', label: 'On target' },
  warn: { tone: 'warning', label: 'Watch' },
  critical: { tone: 'danger', label: 'Off target' },
  none: { tone: 'neutral', label: 'No target' },
});

/** Whether the advanced analytics tool is set up for the organisation (Reports > Analytics). Not being set up is a state for an administrator to change, not a failure: a warning, not danger. */
export const analyticsConnection = defineStatuses('analytics connection', {
  ready: { tone: 'success', label: 'Connected' },
  not_set_up: { tone: 'warning', label: 'Not set up yet' },
});
