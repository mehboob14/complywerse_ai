'use client';

// The AI review tab: where the review stands while it runs (or why it did not), then the rating in full: the summary, what is missing and how to raise it, what the file was rated
// against, and the framework clauses the AI matched it to, each with a Link. The rating's detail and the clause suggestions are read when the tab opens (the Overview shows the score and
// the summary from the record itself). Every request says what became of it, with a Retry.
import { useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import { Button, ClampedText, ErrorState, Notice, SkeletonLines, SkeletonRows, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDateTime } from '@/lib/format';
import { MatchingNote, MaturityLists, RatedAgainst, ReviewProgressCard } from './ReviewParts';
import { bandOf, matchPct } from './linkModel';
import type { AiLinkStatus, ClauseMapping, EvidenceDetail, LatestAssessment } from './recordTypes';
import type { ReviewState } from '../../_review';

const MUTED = 'text-ds-fg-muted';
const SHOWN = 10;
const COVERAGE = { full: 'success', partial: 'warning', minimal: 'warning', none: 'danger' } as const;
interface Source<T> { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

export function AiReviewTab({ evidence, review, rating, clauses, linkStatus, working, onRateAgain, onMatchAgain, onReadAgain, reading, onBreakdown, onLinkClause, linkingClause, running }: {
  evidence: EvidenceDetail;
  review: ReviewState | undefined;
  rating: Source<LatestAssessment | null>;
  clauses: Source<ClauseMapping[]>;
  linkStatus: Source<AiLinkStatus>;
  working: boolean;
  onRateAgain: () => void;
  onMatchAgain: () => void;
  onReadAgain: () => void;
  reading: boolean;
  onBreakdown: () => void;
  onLinkClause: (clause: ClauseMapping) => void;
  /** the clause whose link request is running */
  linkingClause: ClauseMapping | null;
  running: boolean;
}) {
  const [shown, setShown] = useState(SHOWN);
  const a = rating.data ?? null;
  const fallback = evidence.latest_assessment;
  if (rating.isPending && !fallback) return <SkeletonLines lines={8} label="Loading the AI review" />;
  if (rating.isError && !fallback) {
    return <ErrorState compact title="Couldn't load the AI review" message={errorMessage(rating.error)} onRetry={canRetry(rating.error) ? () => { void rating.refetch(); } : undefined} />;
  }
  if (!a && !fallback) {
    return <ReviewProgressCard review={review ?? evidence.ai_review} ocrStatus={evidence.ocr_status} onAgain={onRateAgain} again={working} onReadAgain={onReadAgain} reading={reading} />;
  }

  const summary = a?.content_summary ?? fallback?.content_summary ?? evidence.content_summary;
  const gaps = a?.compliance_gaps ?? fallback?.gap_analysis?.gaps;
  const todo = a?.recommendations ?? fallback?.recommendations ?? fallback?.gap_analysis?.recommendations;
  const assessedAt = a?.assessed_at ?? fallback?.assessed_at;
  const list = clauses.data ?? [];
  const linkedKeys = linkStatus.data?.linked_controls ?? {};
  const isLinked = (c: ClauseMapping) => !!linkedKeys[`${c.framework_name}:${c.control_id}`];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <h2 className="!text-ds-section !text-ds-fg">AI quality assessment</h2>
        <div className="flex flex-wrap items-center gap-[8px]">
          <span className={`text-ds-label ${MUTED}`}>{running ? 'Assessing…' : assessedAt ? `Assessed ${formatDateTime(assessedAt)}` : ''}</span>
          <Button size="sm" onClick={onBreakdown}>Score breakdown</Button>
        </div>
      </div>

      <section aria-labelledby="ai-summary-h">
        <h3 id="ai-summary-h" className={`mb-[4px] !text-ds-label !font-[600] ${MUTED}`}>Content summary</h3>
        <div className="rounded-ds-card bg-ds-surface-hover px-[12px] py-[10px]"><ClampedText text={summary || 'No summary available.'} lines={6} /></div>
      </section>

      <MaturityLists gaps={gaps} recommendations={todo} />
      <RatedAgainst checks={review?.checks} />
      <MatchingNote review={review} onMatchAgain={onMatchAgain} again={working} />

      <section aria-labelledby="ai-clauses-h" className="flex flex-col gap-[8px]">
        <div>
          <h3 id="ai-clauses-h" className="!text-ds-section !text-ds-fg">Suggested clause mappings</h3>
          <p className={`text-ds-label ${MUTED}`}>Check each one, then link the ones that fit.</p>
        </div>
        {clauses.isPending ? <SkeletonRows rows={3} columns={2} label="Loading the clause suggestions" /> : clauses.isError ? (
          <ErrorState compact title="Couldn't load the clause suggestions" message={errorMessage(clauses.error)} onRetry={canRetry(clauses.error) ? () => { void clauses.refetch(); } : undefined} />
        ) : list.length === 0 ? (
          <p className={`text-ds-body ${MUTED}`}>No framework clauses were matched to this file.</p>
        ) : (
          <>
            {linkStatus.isError && <Notice tone="warning" action={<Button size="sm" onClick={() => { void linkStatus.refetch(); }}>Retry</Button>}>Which of these are already linked could not be loaded.</Notice>}
            <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
              {list.slice(0, shown).map((c) => {
                const linked = isLinked(c);
                const busy = linkingClause === c;
                const pct = matchPct(c.confidence);
                return (
                  <li key={`${c.framework_name}:${c.control_id}:${c.clause_reference}`} className="rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[10px]">
                    <div className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[6px]">
                      <div className="min-w-0 flex-1 basis-[16rem]">
                        <div className="flex flex-wrap items-center gap-[6px]">
                          <span className="text-ds-label font-[600] text-ds-fg">{c.framework_name}</span>
                          <span className={`text-ds-label ${MUTED}`}>{c.control_id}</span>
                          <StatusPill size="sm" tone={COVERAGE[(c.coverage_type || '').toLowerCase() as keyof typeof COVERAGE] ?? 'neutral'} label={`${(c.coverage_type || 'unknown').replace(/^\w/, (x) => x.toUpperCase())} coverage`} />
                          {pct > 0 && <StatusPill size="sm" tone={bandOf(pct) === 'strong' ? 'success' : 'neutral'} label={`${formatCount(pct)}% confidence`} />}
                        </div>
                        <p dir="auto" className="mt-[4px] break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{c.control_title}</p>
                      </div>
                      {linked
                        ? <StatusPill tone="success" label="Linked" />
                        : <Button size="sm" leftIcon={<Plus aria-hidden />} loading={busy} disabled={!!linkingClause && !busy} onClick={() => onLinkClause(c)}>Link</Button>}
                    </div>
                    {c.clause_reference && c.clause_reference !== c.control_title && (
                      <div className="mt-[6px]"><h4 className={`!text-ds-label !font-[600] ${MUTED}`}>Requirement</h4><ClampedText text={c.clause_reference} lines={2} /></div>
                    )}
                    {c.matching_rationale && (
                      <div className="mt-[6px]"><h4 className={`!text-ds-label !font-[600] ${MUTED}`}>Why this evidence matches</h4><ClampedText text={c.matching_rationale} lines={3} /></div>
                    )}
                  </li>
                );
              })}
            </ul>
            {list.length > shown && (
              <div><Button onClick={() => setShown((n) => n + SHOWN * 2)}>Show more ({formatCount(list.length - shown)} left)</Button></div>
            )}
            {linkedCount(list, isLinked) > 0 && <p className={`flex items-center gap-[6px] text-ds-label ${MUTED}`}><CheckCircle2 aria-hidden className="h-[14px] w-[14px] text-ds-success" />{formatCount(linkedCount(list, isLinked))} of {formatCount(list.length)} linked</p>}
          </>
        )}
      </section>
    </div>
  );
}

const linkedCount = (list: readonly ClauseMapping[], isLinked: (c: ClauseMapping) => boolean) => list.filter(isLinked).length;
