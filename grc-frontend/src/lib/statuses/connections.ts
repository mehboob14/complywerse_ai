// The words of Administration > Connected systems: how a connected system reads in the register, whatever kind it is (a scanner, a cloud security feed, a business
// tool, an evidence source). One vocabulary, so the register can sort and count across the four kinds. The adapters that turn each kind's own fields into
// these words are in app/(dashboard)/admin/connections/connectedModel.ts. Built with defineStatuses; node --test src/lib/statuses/connections.test.ts.
import { defineStatuses } from '../status.ts';

/** healthy = the last run worked; degraded = it ran but not cleanly (partial, or a health check that is not ok); failing = the last run or check failed;
 *  never_run = connected and nothing has run yet; paused = switched off on purpose (it keeps its settings and does nothing). */
export const connectionHealth = defineStatuses('connection health', {
  healthy: { tone: 'success', label: 'Healthy' },
  degraded: { tone: 'warning', label: 'Needs a look' },
  failing: { tone: 'danger', label: 'Failing' },
  never_run: { tone: 'neutral', label: 'Not run yet' },
  paused: { tone: 'neutral', label: 'Paused' },
});

export const CONNECTION_REGISTRIES = { connectionHealth } as const;
