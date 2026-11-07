'use client';

// Where a KRI's value stands between its zones, for the direction it has (lib/erm/kri.ts thresholdBar): lower-is-better runs green, amber, red; higher-is-better runs red,
// amber, green. The zones are named in words under the bar and the marker has a name, so the picture is never the only way to read it.
import { TONE } from '@/lib/status';
import { formatMetricValue } from '../../governance/_metrics/metricModel';
import { kriState, thresholdBar, thresholdWords, type KriLike } from '@/lib/erm/kri';
import { kriStatus } from '@/lib/statuses/monitoring';

const ZONE_TONE = { green: 'success', amber: 'warning', red: 'danger' } as const;

export function ThresholdBar({ kri, unit }: { kri: KriLike; unit?: string | null }) {
  const bar = thresholdBar(kri);
  const words = thresholdWords(kri, unit);
  if (!bar) return <p className="text-ds-label text-ds-fg-muted">{words}</p>;
  const state = kriState(kri);
  const value = formatMetricValue(kri.current_value, unit);
  return (
    <div className="min-w-0">
      <div
        role="img"
        aria-label={kri.current_value == null ? words : `${value}: ${kriStatus.label(state)}. ${words}`}
        className="relative flex h-[12px] w-full overflow-hidden rounded-full border border-ds-border"
      >
        {bar.zones.map((z) => (
          <span key={z.state} className="block h-full" style={{ width: `${z.to - z.from}%`, background: TONE[ZONE_TONE[z.state]].dot }} />
        ))}
        {bar.marker != null && <span className="absolute top-0 h-full w-[3px] -translate-x-1/2 bg-ds-fg shadow-[0_0_0_1px_var(--ds-surface)]" style={{ left: `${bar.marker}%` }} />}
      </div>
      <p className="mt-[4px] text-ds-label text-ds-fg-muted">{words}</p>
    </div>
  );
}
