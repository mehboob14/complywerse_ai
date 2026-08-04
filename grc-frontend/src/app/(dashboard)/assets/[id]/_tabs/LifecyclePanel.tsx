'use client';

/*
 * LifecyclePanel — asset-detail "Lifecycle" tab, restyled to the delivered
 * design language (see ../_overview-design.tsx, rendered by the Overview tab).
 *
 * PRESENTATION ONLY. This is a drop-in replacement for the LifecyclePanel that
 * lived in ../_components/AssetWorkTabs.tsx — same props, same data sources, same
 * capabilities (state rail, lifecycle fields, "Change state" action, the honest
 * "not journalled" note, and every GuideMarker). Nothing is fetched or mutated
 * here; the parent passes `asset` and an optional `onTransition` callback exactly
 * as before.
 *
 * The Overview design's primitives (Cell / Stat / CARD) are NOT exported from
 * _overview-design.tsx, so the load-bearing tokens are replicated locally, 1:1
 * with that file's values, so this tab reads as one system with Overview.
 */

import React from 'react';
import { GitBranch } from 'lucide-react';
import { GuideMarker, useGuide } from '@/components/guide';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Lifecycle progression — kept identical to the prior panel so state ordering,
// "done" shading and the highlighted current step are unchanged.
const LIFECYCLE_ORDER = ['planned', 'procured', 'deployed', 'active', 'maintenance', 'decommissioned', 'disposed'];

/* ── design tokens, replicated verbatim from _overview-design.tsx ── */
const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";
const SHADOW = 'shadow-[0_1px_2px_rgba(18,45,36,0.05),0_12px_26px_-18px_rgba(18,45,36,0.22)]';
const CARD = `bg-white border border-[#e6e9e3] rounded-2xl overflow-hidden ${SHADOW}`;

// Label-over-value field, matching the Overview design's `Cell`. Empty values
// render as an italic "Not set" in the muted tone, exactly like Overview.
function Cell({ label, value, mono, wide }: { label: React.ReactNode; value?: React.ReactNode; mono?: boolean; wide?: boolean }) {
  const empty = value === '—' || value === '' || value == null;
  const v = empty ? 'Not set' : value;
  return (
    <div className={'min-w-0' + (wide ? ' sm:col-span-2' : '')}>
      <div className="text-[10px] font-bold tracking-[0.05em] uppercase text-[#8a948b] mb-0.5">{label}</div>
      <div
        className={(mono ? MONO + ' text-[12px]' : 'text-[13px]') + ' break-words leading-snug'}
        style={{ color: empty ? '#97a19a' : '#1a2b24', fontStyle: empty ? 'italic' : undefined, overflowWrap: 'anywhere' }}
      >
        {v}
      </div>
    </div>
  );
}

export default function LifecyclePanel({ asset, onTransition }: { asset: any; onTransition?: () => void }) {
  const { enabled: guideEnabled } = useGuide();
  const current = (asset.lifecycle_state || asset.status || '').toLowerCase();
  const idx = LIFECYCLE_ORDER.indexOf(current);

  const decommissioned = asset.decommissioned_at ? new Date(asset.decommissioned_at).toLocaleDateString() : null;
  const eol = asset.eol_date ? new Date(asset.eol_date).toLocaleDateString() : null;
  const replacedBy = asset.replacement_asset_name ?? (asset.replacement_asset_id ? `#${asset.replacement_asset_id}` : null);

  return (
    <div className="font-['Public_Sans',system-ui,sans-serif] text-[#1a2b24] [font-feature-settings:'ss01']">

      {/* LIFECYCLE CARD */}
      <div className={CARD}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#eceee8]">
          <div className="flex gap-2.5 min-w-0">
            <GitBranch className="h-[18px] w-[18px] shrink-0 mt-px" strokeWidth={2} style={{ color: '#0d5c48' }} />
            <div className="min-w-0">
              <div className="text-[15px] font-extrabold tracking-[-0.01em] flex items-center gap-1.5">
                Lifecycle <GuideMarker id="asset.lifecycleWhy" n={1} />
              </div>
              <div className="text-[11.5px] text-[#aab2a8] mt-px">Where this asset sits in its life, and how it got there.</div>
            </div>
          </div>
          {onTransition && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={onTransition}
                className="text-[12.5px] font-semibold px-3.5 py-2 rounded-lg whitespace-nowrap border bg-[#0d5c48] text-white border-[#0d5c48]"
              >
                Change state
              </button>
              <GuideMarker id="asset.lifecycleTransition" n={2} />
            </div>
          )}
        </div>

        <div className="px-5 py-[18px]">
          {/* STATE RAIL */}
          {guideEnabled && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <GuideMarker id="asset.lifecycleStates" n={3} />
            </div>
          )}
          <div className="flex gap-1 flex-wrap mb-5">
            {LIFECYCLE_ORDER.map((s, i) => {
              const done = idx >= 0 && i <= idx;
              const isNow = i === idx;
              const cls = isNow
                ? 'bg-[#0d5c48] text-white border-[#0d5c48]'
                : done
                  ? 'bg-[#e7f6ee] text-[#0f7a5c] border-[#c3ead2]'
                  : 'bg-[#f4f7f3] text-[#97a19a] border-[#e6e9e3]';
              return (
                <div
                  key={s}
                  className={'flex-[1_1_88px] text-center rounded-lg border capitalize px-2 py-[9px] ' + cls}
                  style={{ fontSize: 11.5, fontWeight: isNow ? 700 : 600 }}
                >
                  {s}
                </div>
              );
            })}
          </div>

          {/* FIELDS */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-5 gap-y-3.5">
            <Cell label="Current state" value={current ? current.charAt(0).toUpperCase() + current.slice(1) : null} />
            <Cell label="Environment" value={asset.environment} />
            <Cell label="Decommissioned at" value={decommissioned} />
            <Cell label="Retirement reason" value={asset.retirement_reason} />
            <Cell label="Replaced by" value={replacedBy} />
            <Cell
              label={<span className="inline-flex items-center gap-1.5">End of life <GuideMarker id="asset.lifecycleEol" n={4} /></span>}
              value={eol}
            />
          </div>
        </div>
      </div>

      {/* HONEST "NOT STORED" NOTE — lifecycle changes are not journalled.
          A transition history table does not exist, so rather than a permanent
          empty "Transition history" placeholder, this states the gap plainly,
          in the delivered warn-callout style. */}
      <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-[#f0dcae] bg-[#fdf7ea] px-3.5 py-2.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#d9a441] mt-1.5 shrink-0" />
        <div className="text-[12px] text-[#7a5a12] leading-snug">
          <b>Lifecycle changes are not journalled.</b> The transition endpoint moves the asset to its new
          state but writes no history row, so there is no record of who changed it, when, or from what.
          A transition table is needed before this timeline can be real.
        </div>
      </div>

      {guideEnabled && (
        <div className="mt-2">
          <GuideMarker id="asset.lifecycleReplacement" n={5} />
        </div>
      )}
    </div>
  );
}
