'use client';

// Full gallery layout (same glyphs as ChartViewStrip) — used when a larger
// picker is preferable to the compact strip.

import { CHART_GROUPS, CHART_TYPES } from './PivotChart';
import type { ChartKind } from './types';
import ChartViewStrip from './ChartViewStrip';

/** Re-export the strip as the gallery so both entry points stay in sync.
 *  Callers that want the compact strip import ChartViewStrip directly. */
export default function ChartViewGallery(props: {
  view: 'table' | ChartKind;
  onChange: (v: 'table' | ChartKind) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-semibold text-slate-700">Report views</p>
        <span className="text-[10px] font-medium text-slate-400">
          Table + {CHART_TYPES.length} charts · {CHART_GROUPS.length} groups
        </span>
      </div>
      <ChartViewStrip {...props} />
    </div>
  );
}
