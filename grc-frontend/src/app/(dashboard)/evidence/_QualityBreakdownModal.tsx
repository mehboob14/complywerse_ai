'use client';

/**
 * The "Maturity breakdown" dialog: the single source of the AI maturity overlay, used by BOTH the item page (evidence/[id]) and the Workbench preview, so the two
 * are identical. Presentational: callers pass the raw score and the latest-assessment record. A dialog of the kit's AnimatedModal: it is named, focus goes in
 * and back, Escape closes it. Props are unchanged (the item page passes them).
 */
import { Loader2 } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
import { ProgressBar, StatusPill } from '@/components/ui/ds';
import { formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { maturityLevel } from '@/lib/statuses/evidence';
import { maturityOf, normPct, type MaturityWord } from './_workspace/evidenceModel';

const num = (v: unknown): number | null => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const TONE: Record<MaturityWord, 'success' | 'primary' | 'warning' | 'danger'> = { strong: 'success', fair: 'primary', weak: 'warning', poor: 'danger', unrated: 'primary' };

export interface QualityBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Overall quality score, 0–100 (null = not assessed yet). */
  qualityScore: number | null;
  /** Latest-assessment record (sub-scores + summary + assessed_at). */
  assessment?: Record<string, unknown> | null;
  /** For the empty-state messaging. */
  ocrStatus?: string | null;
  isAssessing?: boolean;
}

function Notes({ title, items, tone }: { title: string; items: string[]; tone: 'warning' | 'success' }) {
  if (!items.length) return null;
  return (
    <div className={`rounded-ds-card border p-[12px] ${tone === 'warning' ? 'border-ds-border bg-ds-warning-soft' : 'border-ds-border bg-ds-success-soft'}`}>
      <p className="text-ds-label font-[600] text-ds-fg">{title}</p>
      <ul className="mt-[6px] flex list-disc flex-col gap-[4px] pl-[18px] text-ds-body text-ds-fg-body">{items.map((t, i) => <li key={i} className="break-words">{t}</li>)}</ul>
    </div>
  );
}

export default function QualityBreakdownModal({ isOpen, onClose, qualityScore, assessment, ocrStatus, isAssessing }: QualityBreakdownModalProps) {
  const summary = str(assessment?.content_summary);
  const assessedAt = str(assessment?.assessed_at);
  // The two lists come flat from the assessment endpoint and inside `gap_analysis` from the evidence record.
  const analysis = (assessment?.gap_analysis ?? {}) as { gaps?: string[]; recommendations?: string[] };
  const gaps = ((assessment?.compliance_gaps as string[] | undefined) ?? analysis.gaps ?? []).filter(Boolean);
  const todo = ((assessment?.recommendations as string[] | undefined)?.length ? (assessment?.recommendations as string[]) : analysis.recommendations ?? []).filter(Boolean);
  const pct = qualityScore === null ? null : Math.round(qualityScore);
  const level = maturityOf(pct);

  return (
    <AnimatedModal isOpen={isOpen} onClose={onClose} size="md" title="Maturity breakdown" subtitle="How mature this file is as audit evidence">
      <div className="flex flex-col gap-[16px] p-[20px]">
        {pct !== null ? (
          <>
            <div className="flex items-center gap-[16px]">
              <span className="text-[32px] font-[600] leading-[40px] tabular-nums text-ds-fg">{pct}%</span>
              <div className="min-w-0 flex-1">
                <ProgressBar value={pct} label="Overall maturity" tone={TONE[level]} showValue={false} />
                <div className="mt-[4px]"><StatusPill size="sm" {...statusPill(maturityLevel, level)} /></div>
              </div>
            </div>
            {assessment ? (
              <>
                <div className="flex flex-col gap-[10px]">
                  {([
                    { label: 'Relevance', v: assessment.relevance_score },
                    { label: 'Adequacy', v: assessment.adequacy_score },
                    { label: 'Confidence', v: assessment.confidence_score },
                    { label: 'Audit readiness', v: assessment.audit_readiness },
                  ]).map(({ label, v }) => (
                    <div key={label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-[12px]">
                      <span className="text-ds-body text-ds-fg-body">{label}</span>
                      <ProgressBar value={normPct(num(v))} label={label} />
                    </div>
                  ))}
                </div>
                {summary && <p className="rounded-ds-card bg-ds-surface-hover p-[12px] text-ds-body text-ds-fg-body"><span className="font-[600] text-ds-fg">Summary: </span>{summary}</p>}
                <Notes title="What's missing" items={gaps} tone="warning" />
                <Notes title="How to raise it" items={todo} tone="success" />
                {assessedAt && <p className="text-ds-label text-ds-fg-muted">Assessed {formatDateTime(assessedAt)}</p>}
              </>
            ) : (
              <p className="text-ds-body text-ds-fg-muted">The detailed scores are not available yet. Run the AI review for the full breakdown.</p>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-[8px] py-[24px] text-center">
            {isAssessing || ocrStatus !== 'completed' ? (
              <>
                <Loader2 aria-hidden className="h-[28px] w-[28px] animate-spin text-ds-primary-text motion-reduce:animate-none" strokeWidth={1.75} />
                <p role="status" className="text-ds-body text-ds-fg-muted">{ocrStatus !== 'completed' ? 'Waiting for the file to be read…' : 'The AI is rating this file…'}</p>
              </>
            ) : (
              <p className="text-ds-body text-ds-fg-muted">Not rated yet. Every uploaded file is rated by AI automatically.</p>
            )}
          </div>
        )}
      </div>
    </AnimatedModal>
  );
}
