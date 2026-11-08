'use client';

// The Overview tab: what a person needs to judge the file at a glance. The description, then maturity, validity, who has it, its type and where it came from; the AI's summary with what is
// missing and how to raise it; and what the file is linked to, by kind, each a way into the Linked tab. Every part says what became of its request (the counts are a dash with a Retry when
// they could not be read, never 0).
import { Link2, ShieldCheck } from 'lucide-react';
import { Button, ChipList, ClampedText, CountRow, ErrorState, Fact, FactList, PersonChip, ProgressBar, SectionCard, SkeletonLines, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { maturityLevel } from '@/lib/statuses/evidence';
import { ExpiryText, ReviewChip } from '../../_workspace/lib';
import { maturityOf, typeLabel, type ReviewWord } from '../../_workspace/evidenceModel';
import { safeDetail } from '@/lib/apiError';
import { MaturityLists } from './ReviewParts';
import { LINK_LABEL, LINK_TYPES, linkedTotal, type LinkType } from './linkModel';
import type { EvidenceDetail } from './recordTypes';
import type { ReviewState } from '../../_review';

const MUTED = 'text-ds-fg-muted';
const TONE = { strong: 'success', fair: 'primary', weak: 'warning', poor: 'danger', unrated: 'primary' } as const;

export interface LinkedSummary {
  state: 'loading' | 'error' | 'ready';
  counts?: Record<LinkType, number>;
  error?: unknown;
  onRetry?: () => void;
  frameworks: string[];
}

export function OverviewTab({ evidence, score, word, review, linked, canEdit, canLink, onTab, onOpenLinked, onBreakdown, onEdit, onRateAgain, rating }: {
  evidence: EvidenceDetail;
  score: number | null;
  word: ReviewWord;
  review: ReviewState | undefined;
  linked: LinkedSummary;
  canEdit: boolean;
  canLink: boolean;
  onTab: (tab: 'ai' | 'linked') => void;
  onOpenLinked: (type: LinkType) => void;
  onBreakdown: () => void;
  onEdit: () => void;
  onRateAgain: () => void;
  rating: boolean;
}) {
  const level = maturityOf(score);
  const a = evidence.latest_assessment;
  const gaps = a?.gap_analysis?.gaps;
  const todo = a?.recommendations?.length ? a.recommendations : a?.gap_analysis?.recommendations;
  const why = word === 'failed' || word === 'stopped' || word === 'unavailable' ? safeDetail(review?.error ?? evidence.ai_review?.error) : '';
  const hasDates = evidence.collection_date || evidence.expiry_date;
  const total = linked.counts ? linkedTotal(linked.counts) : null;

  return (
    <div className="flex flex-col gap-[16px]">
      {evidence.description && <ClampedText text={evidence.description} lines={3} />}

      <FactList variant="boxed" min={180}>
        <Fact label="Maturity">
          {score != null ? (
            <span className="flex flex-col items-start gap-[6px]">
              <span className="flex flex-wrap items-center gap-[8px]">
                <span className="text-ds-section tabular-nums text-ds-fg">{score}%</span>
                <StatusPill size="sm" {...statusPill(maturityLevel, level)} />
              </span>
              <ProgressBar value={score} label="Maturity" showValue={false} tone={TONE[level]} className="w-full" />
              <Button variant="link" size="sm" onClick={onBreakdown}>View breakdown</Button>
            </span>
          ) : <ReviewChip score={null} review={review} ocrStalled={review?.ocr_stalled} />}
        </Fact>
        <Fact label="Validity" empty="Not set">
          {hasDates || evidence.expiry_date ? (
            <span className="flex flex-col items-start gap-[2px]">
              <span>{formatDate(evidence.collection_date, { calendar: true, empty: 'Not set' })} → {formatDate(evidence.expiry_date, { calendar: true, empty: 'Not set' })}</span>
              <ExpiryText expiry={evidence.expiry_date} />
            </span>
          ) : canEdit ? <Button variant="link" size="sm" onClick={onEdit}>Set an expiry date</Button> : null}
        </Fact>
        <Fact label="Owner" empty="Unassigned">{evidence.owner_name || evidence.uploader_name ? <PersonChip name={evidence.owner_name || evidence.uploader_name} /> : null}</Fact>
        <Fact label="Type">{typeLabel(evidence.evidence_type)}</Fact>
        <Fact label="Source system" empty="Not set">{evidence.source_system}</Fact>
      </FactList>

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SectionCard
          id="ai-summary" title="AI summary"
          actions={score != null ? <Button variant="link" size="sm" onClick={() => onTab('ai')}>Open the AI review</Button> : undefined}
        >
          {score != null ? (
            <div className="flex flex-col gap-[12px]">
              <ClampedText text={a?.content_summary || evidence.content_summary || 'No summary available.'} lines={5} />
              <MaturityLists gaps={gaps} recommendations={todo} />
            </div>
          ) : (
            <div className="flex flex-col items-start gap-[8px]">
              <ReviewChip score={null} review={review} ocrStalled={review?.ocr_stalled} />
              {why && <p className="break-words text-ds-body text-ds-fg-body">{why}</p>}
              {word === 'none' && <p className={`text-ds-body ${MUTED}`}>Every uploaded file is rated by AI automatically; the rating appears here.</p>}
              {(word === 'failed' || word === 'stopped') && <Button loading={rating} onClick={onRateAgain}>Try again</Button>}
              <Button variant="link" size="sm" onClick={() => onTab('ai')}>See where the review stands</Button>
            </div>
          )}
        </SectionCard>

        <SectionCard
          id="linked-records" title="Linked records" meta={total != null ? `${total} in all` : undefined}
          actions={canLink ? <Button size="sm" leftIcon={<Link2 aria-hidden />} onClick={() => onTab('linked')}>Link records</Button> : undefined}
        >
          {linked.state === 'loading' && <SkeletonLines lines={5} label="Loading what is linked" />}
          {linked.state === 'error' && (
            <ErrorState compact title="Couldn't load what is linked" message={errorMessage(linked.error)} onRetry={canRetry(linked.error) ? linked.onRetry : undefined} />
          )}
          {linked.state === 'ready' && linked.counts && (
            <>
              <ul className="m-0 list-none p-0">
                {LINK_TYPES.filter((t) => linked.counts![t] > 0).map((t) => (
                  <CountRow key={t} label={LINK_LABEL[t]} count={linked.counts![t]} onClick={() => onOpenLinked(t)} />
                ))}
              </ul>
              {total === 0 && <p className={`text-ds-body ${MUTED}`}>Nothing is linked to this file yet.</p>}
              {linked.frameworks.length > 0 && (
                <div className="mt-[12px] flex flex-col gap-[6px] border-t border-ds-border pt-[12px]">
                  <h3 className={`flex items-center gap-[6px] !text-ds-label !font-[600] ${MUTED}`}><ShieldCheck aria-hidden className="h-[14px] w-[14px]" />Frameworks it supports</h3>
                  <ChipList label="frameworks" items={linked.frameworks} shown={3} />
                </div>
              )}
            </>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
