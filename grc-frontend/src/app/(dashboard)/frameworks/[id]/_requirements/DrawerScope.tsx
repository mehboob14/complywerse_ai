'use client';

// The Scope tab of the requirement drawer: whether the requirement counts, every request to change that (who asked, why, who decided and what they said) and the one button to ask.
// The server saves EVERY such request as waiting for a reviewer and changes the requirement only when one approves it, so the tab says that in words. Asking has never needed a right
// (the server lets any signed-in person); deciding is the Scope & decisions tab, which the people who may edit frameworks can open from here.
import { ErrorState, SkeletonRows, StatusPill } from '@/components/ui/ds';
import { Button } from '@/components/ui/ds';
import { safeDetail, apiErrorText } from '@/lib/apiError';
import { formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { requirementScope } from '@/lib/statuses/frameworkRequirements';
import { scopeDecision } from '@/lib/statuses/frameworkJourney';
import { scopeEffect } from '@/lib/journeyModel';
import { decisionsOf, type ReqRow } from './reqModel';
import type { ScopeRecord } from '../_workspace/ScopeTab';

interface Props {
  row: ReqRow;
  /** the uploaded framework's id: without it the journey has no scope decisions */
  appFwId: number | null;
  records: readonly ScopeRecord[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  canEdit: boolean;
  busy: boolean;
  onAsk: (applicable: boolean) => void;
  onGoScope: () => void;
}

export function DrawerScope({ row, appFwId, records, loading, error, onRetry, canEdit, busy, onAsk, onGoScope }: Props) {
  const own = decisionsOf(row, records);
  const waiting = own.some((r) => r.status === 'pending');
  const pill = <StatusPill tone={requirementScope.tone(row.inScope ? 'in_scope' : 'out_of_scope')} label={requirementScope.label(row.inScope ? 'in_scope' : 'out_of_scope')} />;
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        {pill}
        <span className="text-ds-body text-ds-fg-body">{row.inScope ? 'It counts in every figure of the journey.' : 'It is left out of every figure of the journey.'}</span>
      </div>
      {!appFwId ? (
        <p className="m-0 text-ds-body text-ds-fg-muted">This journey is not linked to a framework in the library, so its requirements have no scope decisions.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button
              disabled={waiting || busy}
              title={waiting ? 'A request is already waiting for a reviewer' : undefined}
              onClick={() => onAsk(!row.inScope)}
            >
              {row.inScope ? 'Ask to put out of scope' : 'Ask to put back in scope'}
            </Button>
            {waiting && canEdit && <Button variant="link" onClick={onGoScope}>Decide it in Scope & decisions</Button>}
            {waiting && !canEdit && <span className="text-ds-label text-ds-fg-muted">A request is waiting for a reviewer.</span>}
          </div>
          <section aria-label="Requests about this requirement">
            <h3 className="m-0 mb-[8px] !text-ds-body !font-[600] !text-ds-fg">Requests</h3>
            {loading ? <SkeletonRows rows={2} columns={2} label="Loading the requests" /> : error ? (
              <ErrorState compact title="Couldn't load the requests" message={safeDetail(apiErrorText(error, 'Please try again.'))} onRetry={onRetry} />
            ) : own.length === 0 ? (
              <p className="m-0 text-ds-body text-ds-fg-muted">Nobody has asked to change the scope of this requirement.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
                {own.map((r) => (
                  <li key={r.id} className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
                    <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
                      <span className="min-w-0 flex-1 text-ds-body font-[500] text-ds-fg">{r.is_applicable ? 'Asked to put it back in scope' : 'Asked to put it out of scope'}</span>
                      <StatusPill size="sm" {...statusPill(scopeDecision, r.status)} />
                    </div>
                    <p className="m-0 mt-[2px] text-ds-label text-ds-fg-muted">{[r.requested_by_name, r.requested_at ? formatDateTime(r.requested_at) : null].filter(Boolean).join(' · ')}</p>
                    {r.justification && <p className="m-0 mt-[6px] break-words text-ds-body text-ds-fg-body">{r.justification}</p>}
                    {r.status !== 'pending' && (r.reviewed_by_name || r.review_comment) && (
                      <p className="m-0 mt-[6px] break-words text-ds-label text-ds-fg-muted">{[r.reviewed_by_name ? `Decided by ${r.reviewed_by_name}${r.reviewed_at ? `, ${formatDateTime(r.reviewed_at)}` : ''}` : null, r.review_comment].filter(Boolean).join('. ')}</p>
                    )}
                    <p className="m-0 mt-[6px] text-ds-label text-ds-fg-muted">{scopeEffect(r, row.inScope)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
