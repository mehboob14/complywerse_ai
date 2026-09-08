'use client';

/*
 * LifecyclePanel — asset-detail "Lifecycle" tab, restyled to the mint-teal
 * mock (asset-record-mocks/Lifecycle.html: stepper + current-state summary +
 * transition history card).
 *
 * PRESENTATION ONLY. Same props, same data sources, same capabilities (state
 * rail, lifecycle fields, "Transition state" action, the honest "not
 * journalled" note, and every GuideMarker) as the previous version — only the
 * render changed. Nothing is fetched or mutated here; the parent passes
 * `asset` and an optional `onTransition` callback exactly as before.
 *
 * The mock's stepper shows 5 illustrative stages; the real LIFECYCLE_ORDER
 * has 7 (it's kept verbatim from the prior panel), so the stepper below is
 * driven by the real constant, not the mock's literal labels. The mock also
 * shows a fabricated transition log — there is no backend journal for that,
 * so the "Transition history" card carries the same honest note the prior
 * panel had, instead of invented rows.
 */

import React from 'react';
import { GitBranch, Check } from 'lucide-react';
import { GuideMarker, useGuide } from '@/components/guide';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Lifecycle progression — kept identical to the prior panel so state ordering,
// "done" shading and the highlighted current step are unchanged.
const LIFECYCLE_ORDER = ['planned', 'procured', 'deployed', 'active', 'maintenance', 'decommissioned', 'disposed'];

/* ── mint-teal tokens, matching Lifecycle.html exactly ── */
const AC = '#17B898';
const AC_STRONG = '#12A085';
const AC_SOFT = '#E4F8F2';
const AMBER_BG = '#FBF2DF';
const AMBER_TX = '#7A5A12';
const AMBER_BORDER = '#F0DCAE';
const AMBER_DOT = '#D9A441';
const AMBER_CHIP = '#9A6410';
const INK = '#0F1F2B';
const SEC = '#3A4653';
const MUTED = '#8A95A1';
const FAINT = '#AEB8C2';
const BORDER = '#E8ECEE';

const CARD = 'bg-white border border-[#E8ECEE] rounded-[15px] shadow-[0_1px_2px_rgba(16,24,40,.04)]';
const CH = 'flex items-center gap-2.5 px-4 py-[13px] border-b border-[#F0F3F5]';

function fmt(d?: string | null): string | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Label-over-value tile, matching the mock's `.stat-tile`. Empty values
// render as an italic "Not set" in the faint tone — never fabricated.
function StatTile({ label, value, chip }: { label: React.ReactNode; value?: React.ReactNode; chip?: React.ReactNode }) {
  const empty = value == null || value === '';
  return (
    <div className="bg-[#F7F9FA] rounded-[11px] px-[13px] py-[11px] min-w-0">
      <span className="block text-[10.5px] mb-[3px]" style={{ color: MUTED }}>{label}</span>
      <b
        className="block text-[13px] truncate"
        style={empty ? { color: FAINT, fontWeight: 500, fontStyle: 'italic' } : { color: INK, fontWeight: 600 }}
      >
        {empty ? 'Not set' : value}
        {!empty && chip}
      </b>
    </div>
  );
}

export default function LifecyclePanel({ asset, onTransition }: { asset: any; onTransition?: () => void }) {
  const { enabled: guideEnabled } = useGuide();
  const current = (asset.lifecycle_state || asset.status || '').toLowerCase();
  const idx = LIFECYCLE_ORDER.indexOf(current);
  const n = LIFECYCLE_ORDER.length;
  const pct = (i: number) => ((i + 0.5) / n) * 100;

  const decommissioned = fmt(asset.decommissioned_at);
  const eol = fmt(asset.eol_date);
  const eolPastDue = !!(asset.eol_date && new Date(asset.eol_date).getTime() < Date.now());
  const replacedBy = asset.replacement_asset_name ?? (asset.replacement_asset_id ? `#${asset.replacement_asset_id}` : null);
  const currentLabel = current ? current.charAt(0).toUpperCase() + current.slice(1) : null;

  return (
    <div className="text-[13.5px] leading-[1.5]" style={{ fontFamily: 'var(--font-poppins), Poppins, system-ui, sans-serif', color: INK }}>

      {/* ===== LIFECYCLE STEPPER ===== */}
      <div className={CARD + ' mb-3.5'}>
        <div className={CH}>
          <GitBranch className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} style={{ color: AC_STRONG }} />
          <div className="flex-1 min-w-0">
            <h4 className="text-[13.5px] font-semibold flex items-center gap-1.5">
              Lifecycle state <GuideMarker id="asset.lifecycleWhy" n={1} />
            </h4>
            <span className="block text-[11px] mt-px" style={{ color: MUTED }}>
              Where this asset sits in its life, and how it got there.
            </span>
          </div>
          {onTransition && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={onTransition}
                className="h-[34px] px-3.5 rounded-[10px] text-[12px] font-semibold whitespace-nowrap border"
                style={{ background: AC, borderColor: AC, color: '#06342B' }}
              >
                Transition state
              </button>
              <GuideMarker id="asset.lifecycleTransition" n={2} />
            </div>
          )}
        </div>

        <div className="px-5 pt-[22px] pb-2">
          {guideEnabled && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <GuideMarker id="asset.lifecycleStates" n={3} />
            </div>
          )}
          <div className="relative grid" style={{ gridTemplateColumns: `repeat(${n},1fr)` }}>
            <div
              className="absolute h-[2px] top-[14px]"
              style={{ left: `${pct(0)}%`, width: `${Math.max(0, (idx >= 0 ? pct(idx) : pct(0)) - pct(0))}%`, background: AC }}
            />
            <div
              className="absolute h-[2px] top-[14px]"
              style={{ left: `${idx >= 0 ? pct(idx) : pct(0)}%`, right: `${100 - pct(n - 1)}%`, background: BORDER }}
            />
            {LIFECYCLE_ORDER.map((s, i) => {
              const done = idx >= 0 && i < idx;
              const isNow = idx >= 0 && i === idx;
              return (
                <div key={s} className="relative z-10 text-center">
                  {done ? (
                    <span
                      className="w-7 h-7 rounded-full grid place-items-center mx-auto border-[3px] border-white"
                      style={{ background: AC, boxShadow: `0 0 0 1px ${BORDER}` }}
                    >
                      <Check className="w-[13px] h-[13px]" strokeWidth={2.8} style={{ color: '#06342B' }} />
                    </span>
                  ) : isNow ? (
                    <span
                      className="w-8 h-8 rounded-full grid place-items-center mx-auto border-[3px] -mt-0.5"
                      style={{ background: '#fff', borderColor: AC, boxShadow: '0 2px 8px rgba(23,184,152,.32)' }}
                    >
                      <span className="w-[10px] h-[10px] rounded-full block" style={{ background: AC }} />
                    </span>
                  ) : (
                    <span className="w-7 h-7 rounded-full block mx-auto border-2" style={{ background: '#fff', borderColor: BORDER }} />
                  )}
                  <div
                    className="mt-2 capitalize"
                    style={isNow ? { fontSize: 11.5, fontWeight: 700, color: AC_STRONG } : done ? { fontSize: 11, fontWeight: 600, color: SEC } : { fontSize: 11, color: FAINT }}
                  >
                    {s}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ===== CURRENT STATE SUMMARY ===== */}
      <div className={CARD + ' mb-3.5'}>
        <div className={CH}>
          <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: AC_STRONG }} />
          <h4 className="text-[12.5px] font-semibold flex-1">Current state</h4>
        </div>
        <div className="px-[18px] pt-[14px] pb-4">
          <div className="flex items-center gap-3 rounded-[11px] px-4 py-3 mb-3" style={{ background: AC_SOFT }}>
            <span className="w-[10px] h-[10px] rounded-full shrink-0" style={{ background: AC_STRONG }} />
            {currentLabel ? (
              <div className="text-[18px] font-bold" style={{ color: AC_STRONG }}>{currentLabel}</div>
            ) : (
              <div className="text-[14px] font-medium italic" style={{ color: FAINT }}>Not set</div>
            )}
          </div>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
            <StatTile label="Environment" value={asset.environment} />
            <StatTile
              label={<span className="inline-flex items-center gap-1.5">End of life <GuideMarker id="asset.lifecycleEol" n={4} /></span>}
              value={eol}
              chip={eol && eolPastDue ? (
                <span
                  className="ml-1.5 align-[1px] inline-block px-[6px] py-[1px] rounded-[6px] font-semibold"
                  style={{ fontSize: 9, background: AMBER_BG, color: AMBER_CHIP }}
                >
                  Past due
                </span>
              ) : null}
            />
            <StatTile label="Decommissioned at" value={decommissioned} />
            <StatTile label="Retirement reason" value={asset.retirement_reason} />
            <StatTile label="Replaced by" value={replacedBy} />
          </div>
        </div>
      </div>

      {/* ===== TRANSITION HISTORY =====
          The mock shows a fabricated timeline; there is no backend journal
          for lifecycle transitions (the transition endpoint writes no history
          row), so this card carries that fact plainly instead of invented
          rows — same honest note the prior panel had. */}
      <div className={CARD}>
        <div className={CH}>
          <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: AC_STRONG }} />
          <h4 className="text-[12.5px] font-semibold flex-1">Transition history</h4>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5" style={{ borderColor: AMBER_BORDER, background: AMBER_BG }}>
            <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: AMBER_DOT }} />
            <div className="text-[12px] leading-snug" style={{ color: AMBER_TX }}>
              <b>Lifecycle changes are not journalled.</b> The transition endpoint moves the asset to its new
              state but writes no history row, so there is no record of who changed it, when, or from what.
              A transition table is needed before this timeline can be real.
            </div>
          </div>
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
