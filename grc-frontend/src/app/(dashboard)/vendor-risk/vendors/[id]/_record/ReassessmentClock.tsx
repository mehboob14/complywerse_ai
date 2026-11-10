'use client';

// When each engagement of the vendor is next reviewed, and how often its tier says it should be. The cadence is the vendor policy's
// (Policy page), or the engagement's own when it set one: the words here are read from there, never written in.
import { failed } from './recordData';
import { StatusPill, TierBadge } from './recordUi';
import RecordPanel from './RecordPanel';
import { ErrorState, Skeleton } from '@/components/ui/ds';
import { fmt } from '../../../_ui/fmt';
import { useEngagements } from '../../../_lib/engagementsApi';
import { usePolicyCadence } from '../../../_lib/vendorRecordApi';
import { cadenceFor, cadenceLabel, isTiered, openScopes, reviewClock, type Scope } from '../../../_lib/vendorRecordModel';

const ORDER = ['critical', 'high', 'medium', 'low'];
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

export default function ReassessmentClock({ vendorId, vendor }: { vendorId: number; vendor: Record<string, any> | undefined }) {
  const { data, isLoading, isError, error, refetch } = useEngagements(vendorId);
  const policy = usePolicyCadence().data;

  // Without the engagements (an archived vendor has none to list) the vendor's own date is the one there is.
  const scopes: Scope[] = data ? openScopes(data.items) : vendor ? [{
    id: null, is_general: true, name: 'General', tier: vendor.tier, inherent_risk_score: vendor.inherent_risk_score,
    next_reassessment_date: vendor.next_reassessment_date, reassessment_cadence_days: vendor.reassessment_cadence_days,
  }] : [];
  const several = scopes.length > 1;
  const byTier = policy ? ORDER.filter((t) => policy[t]).map((t) => `${cap(t)} ${cadenceLabel(policy[t])}`).join(', ') : '';

  return (
    <RecordPanel title="Reassessment" info={byTier ? `By tier: ${byTier}.` : undefined}>
      {isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : failed({ isError, error }) && !data ? (
        <ErrorState compact title="Couldn’t load the review dates" onRetry={() => { void refetch(); }} />
      ) : scopes.length === 0 ? (
        <p className="text-[13px] leading-5 text-ds-fg-muted">No date until the engagement is tiered.</p>
      ) : (
        <ul className="divide-y divide-ds-border">
          {scopes.map((e) => {
            const tiered = isTiered(e);
            const clock = reviewClock(e.next_reassessment_date);
            const days = cadenceFor(e, policy);
            return (
              <li key={e.id ?? 'general'} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">
                {several && <span className="min-w-[8rem] text-[13px] font-medium leading-5 text-ds-fg">{e.name}</span>}
                {clock ? (
                  <>
                    <StatusPill tone={clock.tone}>{clock.label}</StatusPill>
                    <span className="text-[13px] leading-5 text-ds-fg-body">{fmt.date(e.next_reassessment_date)}</span>
                  </>
                ) : (
                  <span className="text-[13px] leading-5 text-ds-fg-muted">{tiered ? 'No review date set.' : 'No date until the engagement is tiered.'}</span>
                )}
                {tiered && (
                  <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] leading-4 text-ds-fg-muted">
                    <TierBadge tier={e.tier} variant="dot" suffix="cadence" />
                    {days ? <>· {cadenceLabel(days)}</> : null}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </RecordPanel>
  );
}
