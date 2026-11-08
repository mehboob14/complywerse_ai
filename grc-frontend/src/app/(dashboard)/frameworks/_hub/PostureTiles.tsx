'use client';

/**
 * The posture of the journeys, as four tiles above the Journeys list: how many have work in them, how ready they are, how much is implemented, and how many are due. Every figure is the journey
 * model's (hubTiles over the journey function's own `progress`): Ready counts a requirement only when its APPROVED evidence meets what it asks for, out-of-scope requirements are left out,
 * verified ones are counted once, and a finished or cancelled journey is not counted. The old gauge used "any approved evidence", the aggregate's own not-applicable rule and an unweighted
 * mean beside a weighted gauge. A request that failed draws no tiles (the list under them says so once, with Retry: it is the same request); a journey whose payload had no figures is said, not counted as 0.
 */
import { StatTile } from '@/components/ui/ds';
import { formatCount, formatPercent } from '@/lib/format';
import { readinessBandWords } from '@/lib/statuses/frameworkJourney';
import { hubTiles, type HubTiles, type JourneyItem } from './hubModel';

const INFO_READY = 'Requirements whose approved evidence meets what they ask for, out of the requirements in scope, over every journey with work in it. A file nobody has approved does not count; a requirement put out of scope is left out.';
const INFO_DONE = 'Requirements marked implemented or verified (counted once), out of the requirements in scope, over every journey with work in it.';

export interface PostureTilesProps {
  journeys: readonly JourneyItem[] | undefined;
  loading: boolean;
  error: unknown;
  /** the address that opens the list on the journeys that need attention */
  attentionHref: string;
}

export function PostureTiles({ journeys, loading, error, attentionHref }: PostureTilesProps) {
  const failed = !journeys && !!error;
  const t: HubTiles | null = journeys ? hubTiles(journeys) : null;
  if (t && t.counted + t.missing + t.completed === 0) return null;                        // no journey yet: the list says so
  if (failed) return null;                                                                 // the list under the tiles says it once, with Retry (the same request): four tiles saying it too is noise
  const none = t !== null && t.counted === 0;                                             // only finished journeys, or none with figures: nothing to share out
  const band = t ? readinessBandWords.label(t.band) : '';
  return (
    <section aria-label="Where the journeys stand" className="grid min-w-0 grid-cols-2 gap-[12px] xl:grid-cols-4">
      <StatTile
        label="Active journeys" value={t ? formatCount(t.counted + t.missing) : null} loading={loading && !t}
        note={t ? [t.completed > 0 ? `${formatCount(t.completed)} completed` : null, t.missing > 0 ? `${formatCount(t.missing)} without figures` : null].filter(Boolean).join(' · ') || undefined : undefined}
        info="Journeys that still have work in them: not completed and not cancelled."
      />
      <StatTile
        label="Ready" value={t && !none ? formatPercent(t.readyPct) : null} progress={t && !none ? t.readyPct : null} loading={loading && !t}
        note={t && !none ? `${band} · ${formatCount(t.approved)} of ${formatCount(t.applicable)} requirements` : undefined} info={INFO_READY}
      />
      <StatTile
        label="Implemented" value={t && !none ? formatPercent(t.implementedPct) : null} progress={t && !none ? t.implementedPct : null} loading={loading && !t}
        note={t && !none ? `${formatCount(t.implemented)} of ${formatCount(t.applicable)} requirements` : undefined} info={INFO_DONE}
      />
      <StatTile
        label="Due in 30 days" value={t ? formatCount(t.dueSoon) : null} unit={t ? (t.dueSoon === 1 ? 'journey' : 'journeys') : undefined} loading={loading && !t}
        tone={t && t.overdue > 0 ? 'danger' : 'default'} note={t ? (t.overdue > 0 ? `${formatCount(t.overdue)} overdue` : 'None overdue') : undefined}
        info="Journeys with work in them whose target date is within 30 days or has passed."
        link={t && t.dueSoon > 0 ? { href: attentionHref, label: `${t.dueSoon} journeys due. Show the ones that need attention` } : undefined}
      />
    </section>
  );
}
