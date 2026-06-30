'use client';

// Per-assessment residual risk breakdown across the ten risk domains. Reads the
// saved domain_scores on the assessment (written by the scoring engine) — no
// extra fetch. Pure display.

import type { TpraAssessment } from './types';
import { DOMAIN_LABELS, DOMAIN_KEYS, tierBadge } from './constants';

function barColor(rating?: string): string {
  switch ((rating || '').toLowerCase()) {
    case 'critical': return 'bg-red-500';
    case 'high': return 'bg-orange-500';
    case 'medium': return 'bg-amber-400';
    case 'low': return 'bg-emerald-500';
    default: return 'bg-gray-300';
  }
}

export default function DomainRiskView({ assessment }: { assessment: TpraAssessment }) {
  const scores = assessment.domain_scores || {};
  const hasAny = Object.keys(scores).length > 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Residual risk by domain</h3>
        {assessment.residual_rating && (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tierBadge(assessment.residual_rating)}`}>
            Overall: {assessment.residual_rating}{assessment.residual_score != null ? ` (${assessment.residual_score})` : ''}
          </span>
        )}
      </div>

      {!hasAny ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-xs text-gray-500">
          Not scored yet. Run scoring on the Risk Analysis &amp; Scoring stage to populate per-domain residual ratings.
        </p>
      ) : (
        <div className="space-y-2.5">
          {DOMAIN_KEYS.map((key) => {
            const d = scores[key];
            const residual = d?.residual ?? null;
            const pct = residual != null ? Math.max(2, Math.min(100, residual)) : 0;
            return (
              <div key={key} className="grid grid-cols-[9rem_1fr_auto] items-center gap-2">
                <span className="truncate text-xs text-gray-600" title={DOMAIN_LABELS[key]}>{DOMAIN_LABELS[key]}</span>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100" role="img"
                  aria-label={`${DOMAIN_LABELS[key]} residual ${d ? d.rating : 'not scored'}`}>
                  {d ? <div className={`h-full rounded-full ${barColor(d.rating)}`} style={{ width: `${pct}%` }} /> : null}
                </div>
                {d ? (
                  <span className={`inline-flex w-16 justify-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${tierBadge(d.rating)}`}>
                    {d.rating}
                  </span>
                ) : (
                  <span className="w-16 text-center text-[10px] text-gray-400">n/a</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
