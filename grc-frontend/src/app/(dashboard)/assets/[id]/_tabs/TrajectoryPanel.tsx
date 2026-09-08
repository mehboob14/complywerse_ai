'use client';

/*
 * TrajectoryPanel — the asset-detail "Trajectory" tab (activeTab === 'trajectory'),
 * restyled to the product's real mint-teal design tokens (Trajectory.html mock).
 *
 * PRESENTATION ONLY. The tab delegates the actual diagram to <TrajectoryMap>, which
 * fetches its own data (react-query key ['asset-trajectory', assetId]) and owns every
 * capability the tab has today — the filter chips, legend, refresh, auto-refresh, and
 * the loading / error / empty ("Nothing linked yet") states. That component is kept
 * verbatim; this panel only re-clothes the surrounding header card in the mint-teal
 * tokens (--ac-soft #E4F8F2 / --ac-strong #12A085, white card, #E8ECEE border/15px
 * radius). Poppins is already the app's default body font (see layout.tsx), so no
 * font override is needed here. Both GuideMarker annotations (n=1 "asset.trajWhy",
 * n=2 "asset.trajAudience") are preserved.
 *
 * Reconciling the mock vs. the real component: Trajectory.html shows summary tiles,
 * a risk-over-time SVG line chart and a recent-events timeline. None of that is
 * backed by real data — getTrajectory() (backend assets_router.py) returns a
 * point-in-time Asset→Vulnerability→Risk graph (nodes + edges + a stats object),
 * with no scan-history / dated score series anywhere in the payload. Per the "don't
 * fabricate backend data" rule, those three mock sections are intentionally NOT
 * reproduced — the real ReactFlow graph stays the one and only (primary) view. If a
 * history endpoint is added later, a time-series card can be composed here from it.
 *
 * Drop-in: default export. Parent passes only `assetId` — mirroring the exact scope the
 * tab already had (it too rendered a heading + <TrajectoryMap assetId={assetId} />).
 */

import React from 'react';
import nextDynamic from 'next/dynamic';
import { Network, Loader2 } from 'lucide-react';
import { GuideMarker } from '@/components/guide';

// Mint-teal card recipe — matches Trajectory.html's .card (1px #E8ECEE border, 15px
// radius, 0 1px 2px rgba(16,24,40,.04) shadow).
const CARD = 'bg-white border border-[#E8ECEE] rounded-[15px] shadow-[0_1px_2px_rgba(16,24,40,0.04)]';

// Same client-only dynamic import the tab used (ReactFlow can't SSR); named export.
// This is code-splitting, not data fetching — the query inside TrajectoryMap is untouched.
const TrajectoryMap = nextDynamic(
  () => import('../_components/TrajectoryMap').then((m) => m.TrajectoryMap),
  {
    ssr: false,
    loading: () => (
      <div className={CARD + ' flex h-[500px] items-center justify-center'}>
        <div className="flex items-center gap-2 text-[#8A95A1]">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-[13px] font-medium">Building trajectory map…</span>
        </div>
      </div>
    ),
  },
);

export interface TrajectoryPanelProps {
  /** Asset primary key — the only value the tab had in scope; TrajectoryMap fetches the rest. */
  assetId: number;
}

export default function TrajectoryPanel({ assetId }: TrajectoryPanelProps) {
  return (
    <div className="flex flex-col gap-4 text-[#0F1F2B]">
      {/* HEADER CARD — same title, description and GuideMarkers, in the mint-teal .ch card idiom */}
      <div className={CARD}>
        <div className="flex items-start justify-between gap-3 px-4 py-[13px]">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[12.5px] font-semibold tracking-[-.01em] text-[#0F1F2B]">
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-[#E4F8F2] text-[#12A085]">
                <Network className="h-4 w-4" strokeWidth={1.75} />
              </span>
              Risk trajectory
              <GuideMarker id="asset.trajWhy" n={1} />
            </h2>
            <p className="mt-1.5 text-[12px] leading-snug text-[#8A95A1]">
              Asset → Vulnerability → Risk. Click a node to trace its sub-chain.
              <GuideMarker id="asset.trajAudience" n={2} />
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[6px] bg-[#E7F5EE] px-2 py-[2px] text-[10.5px] font-semibold text-[#1F7A54]">
            <i className="inline-block h-[6px] w-[6px] rounded-full bg-[#1F7A54]" />
            Live · auto-refresh
          </span>
        </div>
      </div>

      {/* DIAGRAM — child owns its own fetch, toolbar filters, legend, refresh and empty-state.
          No time-series card here: see file header — getTrajectory() carries no history to plot. */}
      <TrajectoryMap assetId={assetId} />
    </div>
  );
}
