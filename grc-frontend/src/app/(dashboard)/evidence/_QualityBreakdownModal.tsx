'use client';

/**
 * Shared "Quality breakdown" popup — the single source of truth for the AI
 * quality sub-score overlay. Used by BOTH the detail record page
 * (evidence/[id]) and the Workbench preview (evidence/_workspace/DetailPreview)
 * so the two are guaranteed identical (not just visually similar).
 *
 * Presentational only: callers pass the raw quality score + latest-assessment
 * record; colour helpers + normalisation live here.
 */

import { Brain, X, Loader2 } from 'lucide-react';

function num(v: unknown): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
// AI sub-scores arrive as either 0–1 or 0–100; normalise to a 0–100 integer.
function subPct(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

function qualityScoreColor(score: number | null) {
  if (score === null) return 'bg-slate-400';
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-amber-500';
  if (score >= 40) return 'bg-orange-500';
  return 'bg-rose-500';
}
function qualityScoreTextColor(score: number | null) {
  if (score === null) return 'text-slate-600';
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-amber-600';
  if (score >= 40) return 'text-orange-600';
  return 'text-rose-600';
}
function formatDateTime(dateString?: string | null) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

export default function QualityBreakdownModal({
  isOpen,
  onClose,
  qualityScore,
  assessment,
  ocrStatus,
  isAssessing,
}: QualityBreakdownModalProps) {
  if (!isOpen) return null;

  const summary = str(assessment?.content_summary);
  const assessedAt = str(assessment?.assessed_at);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Brain className="h-4 w-4 text-primary-600" /> Quality breakdown</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">
          {qualityScore !== null ? (
            <>
              <div className="mb-4 flex items-center gap-4">
                <div className={`text-4xl font-bold ${qualityScoreTextColor(qualityScore)}`}>{Math.round(qualityScore)}%</div>
                <div className="flex-1">
                  <div className="h-2 w-full rounded-full bg-slate-200"><div className={`h-2 rounded-full ${qualityScoreColor(qualityScore)}`} style={{ width: `${qualityScore}%` }} /></div>
                  <p className="mt-1 text-xs text-slate-500">Overall quality score</p>
                </div>
              </div>
              {assessment ? (
                <div className="space-y-3">
                  {([
                    { label: 'Relevance', v: assessment.relevance_score },
                    { label: 'Adequacy', v: assessment.adequacy_score },
                    { label: 'Confidence', v: assessment.confidence_score },
                    { label: 'Audit readiness', v: assessment.audit_readiness },
                  ]).map(({ label, v }) => {
                    const pct = subPct(v);
                    return (
                      <div key={label}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-slate-600">{label}</span>
                          <span className="font-medium text-slate-800">{pct == null ? '—' : `${pct}%`}</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-primary-500" style={{ width: `${pct ?? 0}%` }} /></div>
                      </div>
                    );
                  })}
                  {summary && (
                    <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600"><span className="font-medium text-slate-700">Summary: </span>{summary}</div>
                  )}
                  {assessedAt && <p className="mt-2 text-[11px] text-slate-400">Assessed {formatDateTime(assessedAt)}</p>}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Detailed sub-scores aren&apos;t available — run an AI assessment for the full breakdown.</p>
              )}
            </>
          ) : (
            <div className="py-6 text-center">
              {isAssessing || ocrStatus !== 'completed' ? (
                <>
                  <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-primary-400" />
                  <p className="text-sm text-slate-500">
                    {ocrStatus !== 'completed' ? 'Waiting for OCR to finish…' : 'AI assessment in progress…'}
                  </p>
                </>
              ) : (
                <>
                  <Brain className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                  <p className="text-sm text-slate-500">No quality score yet — the system assesses this automatically.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
