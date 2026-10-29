'use client';

// The strip over the workspace: the lifecycle chart (eleven clickable segments, a "Now" marker, how many are settled, how many
// checks stand open) and the tier (score, badge, the button that tiers or re-tiers, the scale with the score on it).
import { TONE, ThresholdRuler, TierBadge, BTN, BTN_PRIMARY } from '@/app/(dashboard)/vendor-risk/_ui';
import { clsx } from 'clsx';
import { STAGES, chartFacts, segments, stageName, type Check, type Segment, type StageFact } from '../../../_lib/lifecycleLogic';
import type { HeldPolicy } from '../../../_lib/lifecycleApi';

const FILL: Record<Segment, string> = {
  done: TONE.success.dot,
  current: TONE.progress.dot,
  blocked: TONE.warning.dot,
  skipped: 'rgba(100,116,139,0.4)',
  upcoming: '#e3e8ee',
};

export function LifecycleChart({ stages, current, checks, cycle, selected, onSelect }: {
  stages: StageFact[];
  current: string | null;
  checks: Check[] | null | undefined;
  cycle: number | null;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const facts = chartFacts(stages, current, checks);
  const bars = segments(stages, current, facts.toClear > 0);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-[#586472]">Lifecycle</span>
          <span className="text-[15px] font-semibold leading-6 text-[#1f2933]">{facts.label}</span>
          {facts.toClear > 0 && (
            <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: TONE.warning.tint, color: TONE.warning.text }}>
              {facts.toClear} to clear
            </span>
          )}
        </div>
        <span className="text-[13px] tabular-nums text-[#586472]">{facts.settled}/{STAGES.length}{cycle ? ` · Cycle ${cycle}` : ''}</span>
      </div>
      <ol className="mt-7 flex gap-1" aria-label="Lifecycle progress">
        {bars.map((b, i) => (
          <li key={b.key} className="relative min-w-0 flex-1">
            {(b.state === 'current' || b.state === 'blocked') && (
              <>
                <span className="absolute -top-[22px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[#1f2933] px-1.5 py-0.5 text-[11px] font-bold leading-none text-[#fff]">Now</span>
                <span aria-hidden className="absolute -top-[7px] left-1/2 h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[4px] border-x-transparent border-t-[#1f2933]" />
              </>
            )}
            <button
              type="button"
              onClick={() => onSelect(b.key)}
              aria-label={`${String(i + 1).padStart(2, '0')} ${stageName(b.key)}, ${b.state === 'upcoming' ? 'to go' : b.state}`}
              aria-current={b.key === selected ? 'true' : undefined}
              title={stageName(b.key)}
              className={clsx('block h-3 w-full rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] focus-visible:ring-offset-1',
                b.key === selected && 'ring-2 ring-[#1f2933] ring-offset-1')}
              style={{ background: FILL[b.state] }}
            />
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[12px] leading-4 text-[#64707e]">
        Done {facts.done}{facts.skipped > 0 ? ` · Skipped ${facts.skipped}` : ''} · To go {facts.toGo}
      </p>
    </div>
  );
}

export function TierHalf({ tier, score, policy, canTier, blockedWhy, onTier, onOpenTiering }: {
  tier: string | null | undefined;
  score: number | null | undefined;
  policy: HeldPolicy | null;
  canTier: boolean;
  /** why the tier cannot change now (an exit is under way) */
  blockedWhy: string | null | undefined;
  onTier: () => void;
  onOpenTiering: () => void;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-[13px] font-semibold text-[#586472]">Tier</span>
          <button type="button" onClick={onOpenTiering} className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]" title="Go to tiering">
            {typeof score === 'number' && <span className="text-[24px] font-semibold leading-7 tabular-nums text-[#1f2933]">{Math.round(score * 10) / 10}</span>}
            <TierBadge tier={tier} />
          </button>
        </div>
        {canTier && (
          <span title={blockedWhy || undefined}>
            <button type="button" className={tier ? BTN : BTN_PRIMARY} disabled={!!blockedWhy} onClick={onTier}>
              {tier ? 'Re-tier' : 'Tier engagement'}
            </button>
          </span>
        )}
      </div>
      <div className="mt-3">
        {policy?.thresholds
          ? <ThresholdRuler score={typeof score === 'number' ? score : null} thresholds={policy.thresholds} compact showNext />
          : <p className="text-[13px] leading-5 text-[#64707e]">Not tiered</p>}
      </div>
    </div>
  );
}
