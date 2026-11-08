'use client';

// "Waiting for you": the first thing the Journey tab (or the Overview tab of a framework with no authored flow) says. Your own open requirements
// (critical first), evidence nobody has reviewed and scope decisions waiting for a reviewer, each with its one action. The rules are
// waitingForMe in lib/journeyModel.ts. A list that could not be loaded says so: it is never drawn as "nothing is waiting".
import { CountRow, ErrorState, SectionCard, SkeletonRows, WorkRow } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import type { ControlLite, ScopeRecordLite, Waiting } from '@/lib/journeyModel';
import { requirementState } from '@/lib/statuses/frameworkJourney';
import type { ScopeRecord } from './ScopeTab';

type Control = ControlLite & { id: number; control_code?: string; control_name?: string; approved_evidence_count?: number; required_evidence_count?: number };

interface Props {
  waiting: Waiting<ScopeRecord & ScopeRecordLite, Control>;
  canReview: boolean;
  controlsLoading: boolean;
  controlsFailed: boolean;
  scopeLoading: boolean;
  scopeFailed: boolean;
  onOpenRequirement: (control: any) => void;
  goTab: (tab: string) => void;
  onRetry?: () => void;
  /** 'Requirements' or 'Controls' */
  entityLabelPlural: string;
}

export default function NextForMe({ waiting, canReview, controlsLoading, controlsFailed, scopeLoading, scopeFailed, onOpenRequirement, goTab, onRetry, entityLabelPlural }: Props) {
  const loading = controlsLoading || (canReview && scopeLoading);
  const failed = controlsFailed || (canReview && scopeFailed);
  const total = waiting.total;

  return (
    <SectionCard
      id="waiting"
      title="Waiting for you"
      meta={loading || failed ? undefined : total === 0 ? undefined : `${formatCount(total)} ${total === 1 ? 'item' : 'items'}`}
      info="Your own open requirements (critical first), and, if you may review, the evidence and scope decisions nobody has looked at yet."
    >
      {loading ? (
        <SkeletonRows rows={3} />
      ) : failed ? (
        <ErrorState compact title="Couldn't load what is waiting for you" message="Part of this page did not load. Nothing here is a count of zero." onRetry={onRetry} />
      ) : total === 0 ? (
        <p className="text-ds-body text-ds-fg-muted">Nothing is waiting for you on this journey.</p>
      ) : (
        <div className="space-y-[12px]">
          <ul className="flex flex-wrap gap-[8px]">
            <CountRow layout="chip" label={`Your ${entityLabelPlural.toLowerCase()}`} count={waiting.mine.length} onClick={() => goTab('controls')} />
            {canReview && <CountRow layout="chip" label="Evidence to review" count={waiting.evidenceToReview} onClick={() => goTab('controls')} />}
            {canReview && <CountRow layout="chip" label="Scope decisions" count={waiting.decisions.length} onClick={() => goTab('scope')} />}
          </ul>
          <ul className="divide-y divide-ds-border">
            {waiting.mine.slice(0, 4).map((c) => {
              const required = c.required_evidence_count ?? 0;
              return (
                <WorkRow
                  key={`m${c.id}`}
                  kind={c.is_critical ? { label: 'Critical', tone: 'danger' } : { label: 'Yours', tone: 'progress' }}
                  title={`${c.control_code ?? ''} ${c.control_name ?? ''}`.trim()}
                  onOpen={() => onOpenRequirement(c)}
                  context={`${requirementState.label(c.status)}${required > 0 ? ` · ${c.approved_evidence_count ?? 0} of ${required} evidence approved` : ''}`}
                  action={{ label: 'Open', onClick: () => onOpenRequirement(c) }}
                />
              );
            })}
            {waiting.toReview.slice(0, 3).map(({ control: c, evidence }) => (
              <WorkRow
                key={`e${c.id}`}
                kind={{ label: 'Review evidence', tone: 'pending' }}
                title={`${c.control_code ?? ''} ${c.control_name ?? ''}`.trim()}
                onOpen={() => onOpenRequirement(c)}
                context={`${formatCount(evidence)} ${evidence === 1 ? 'file' : 'files'} waiting for approval`}
                action={{ label: 'Review', onClick: () => onOpenRequirement(c) }}
              />
            ))}
            {waiting.decisions.slice(0, 3).map((r) => (
              <WorkRow
                key={`d${r.id}`}
                kind={{ label: 'Scope decision', tone: 'pending' }}
                title={`${r.control_reference ?? ''} ${r.control_title ?? ''}`.trim() || 'A requirement'}
                onOpen={() => goTab('scope')}
                context={r.is_applicable ? 'Asked to put it in scope' : 'Asked to put it out of scope'}
                requester={{ name: r.requested_by_name, role: 'Asked by' }}
                action={{ label: 'Review', onClick: () => goTab('scope') }}
              />
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
