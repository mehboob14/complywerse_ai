'use client';

/*
 * TrajectoryPanel — the asset-detail "Trajectory" tab (activeTab === 'trajectory'),
 * restyled to match the delivered Overview design language (_overview-design.tsx).
 *
 * PRESENTATION ONLY. The tab delegates the actual diagram to <TrajectoryMap>, which
 * fetches its own data (react-query key ['asset-trajectory', assetId]) and owns every
 * capability the tab has today — the filter chips, legend, refresh, auto-refresh, and
 * the loading / error / empty ("Nothing linked yet") states. That component is kept
 * verbatim; this panel only re-clothes the surrounding tab header in the design tokens
 * (white CARD, #0d5c48 accent, #8a948b / #aab2a8 muted labels, pill chip). Both
 * GuideMarker annotations (n=1 "asset.trajWhy", n=2 "asset.trajAudience") are preserved.
 *
 * Drop-in: default export. Parent passes only `assetId` — mirroring the exact scope the
 * tab already had (it too rendered a heading + <TrajectoryMap assetId={assetId} />).
 */

import React from 'react';
import nextDynamic from 'next/dynamic';
import { Network, Loader2 } from 'lucide-react';
import { GuideMarker } from '@/components/guide';

// Delivered-design primitives (mirrors _overview-design.tsx module consts verbatim).
const SHADOW = 'shadow-[0_1px_2px_rgba(18,45,36,0.05),0_12px_26px_-18px_rgba(18,45,36,0.22)]';
const CARD = `bg-white border border-[#e6e9e3] rounded-2xl overflow-hidden ${SHADOW}`;

// Same client-only dynamic import the tab used (ReactFlow can't SSR); named export.
// This is code-splitting, not data fetching — the query inside TrajectoryMap is untouched.
const TrajectoryMap = nextDynamic(
  () => import('../_components/TrajectoryMap').then((m) => m.TrajectoryMap),
  {
    ssr: false,
    loading: () => (
      <div className={CARD + ' flex h-[500px] items-center justify-center'}>
        <div className="flex items-center gap-2 text-[#8a948b]">
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
    <div className="font-['Public_Sans',system-ui,sans-serif] text-[#1a2b24] [font-feature-settings:'ss01'] flex flex-col gap-4">
      {/* HEADER CARD — same title, description and GuideMarkers, in the delivered card idiom */}
      <div className={CARD}>
        <div className="flex items-start justify-between gap-3 px-5 py-[15px]">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[15px] font-extrabold tracking-[-0.01em] text-[#1a2b24]">
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-[#e8f2ec] text-[#0d5c48]">
                <Network className="h-4 w-4" strokeWidth={1.75} />
              </span>
              Risk trajectory
              <GuideMarker id="asset.trajWhy" n={1} />
            </h2>
            <p className="mt-1.5 text-[11.5px] leading-snug text-[#aab2a8]">
              Asset → Vulnerability → Risk. Click a node to trace its sub-chain.
              <GuideMarker id="asset.trajAudience" n={2} />
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[#c3ead2] bg-[#e7f6ee] px-2.5 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.03em] text-[#0f7a5c]">
            Live · auto-refresh
          </span>
        </div>
      </div>

      {/* DIAGRAM — child owns its own fetch, toolbar filters, legend, refresh and empty-state */}
      <TrajectoryMap assetId={assetId} />
    </div>
  );
}
