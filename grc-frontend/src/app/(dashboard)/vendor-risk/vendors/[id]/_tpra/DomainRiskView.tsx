'use client';

// Per-assessment residual risk breakdown across the ten risk domains. Reads the
// saved domain_scores on the assessment (written by the scoring engine) — no
// extra fetch. Pure display.

import type { TpraAssessment, DomainScore } from './types';
import { DOMAIN_LABELS, DOMAIN_KEYS, tierBadge } from './constants';

function barColor(rating?: string): string {
  switch ((rating || '').toLowerCase()) {
    case 'critical': return 'bg-ds-danger';
    case 'high': return 'bg-ds-warning';
    case 'medium': return 'bg-ds-warning';
    case 'low': return 'bg-ds-success';
    default: return 'bg-ds-border-strong';
  }
}

// A domain counts as "scored" only when it has a real residual value.
function isScored(d?: DomainScore | null): boolean {
  return !!d && d.residual != null;
}

export default function DomainRiskView({ assessment }: { assessment: TpraAssessment }) {
  const scores = assessment.domain_scores || {};
  // Coverage = scored / total active (canonical) domains.
  const total = DOMAIN_KEYS.length;
  const scoredCount = DOMAIN_KEYS.filter((k) => isScored(scores[k])).length;
  const coverage = total > 0 ? Math.round((scoredCount / total) * 100) : 0;
  const hasAny = scoredCount > 0;
  const incomplete = hasAny && scoredCount < total;

  return (
    <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13px] font-[600] text-ds-fg">Residual risk by domain</h3>
          {/* Assessment coverage — scored vs total active domains. */}
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-medium ${
 incomplete ? 'border-ds-border-strong bg-ds-warning-soft text-ds-warning' : 'border-ds-border bg-ds-surface-subtle text-ds-fg-body'
 }`}
            title={`${scoredCount} of ${total} risk domains have been scored`}
          >
            Coverage: {scoredCount}/{total} ({coverage}%)
          </span>
        </div>
        {assessment.residual_rating && (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-medium ${tierBadge(assessment.residual_rating)}`}>
            Overall: {assessment.residual_rating}{assessment.residual_score != null ? ` (${assessment.residual_score})` : ''}
          </span>
        )}
      </div>

      {incomplete && (
        <p className="mb-3 rounded-ds-card border border-ds-border-strong bg-ds-warning-soft px-2.5 py-1.5 text-[12px] text-ds-warning">
          Only {scoredCount} of {total} domains are scored — the overall rating reflects partial coverage. Unscored domains are shown as <span className="font-medium">Not assessed</span>, not low-risk.
        </p>
      )}

      {!hasAny ? (
        <p className="rounded-ds-card border border-dashed border-ds-border-strong bg-ds-surface-subtle p-[16px] text-[12px] text-ds-fg-muted">
          Not scored yet. Run scoring on the Risk Analysis &amp; Scoring stage to populate per-domain residual ratings.
        </p>
      ) : (
        <div className="space-y-2.5">
          {DOMAIN_KEYS.map((key) => {
            const d = scores[key];
            const scored = isScored(d);
            const residual = scored ? d!.residual : null;
            const pct = residual != null ? Math.max(2, Math.min(100, residual)) : 0;
            return (
              <div key={key} className="grid grid-cols-[9rem_1fr_auto] items-center gap-2">
                <span className={`truncate text-[12px] ${scored ? 'text-ds-fg-body' : 'text-ds-fg-muted'}`} title={DOMAIN_LABELS[key]}>{DOMAIN_LABELS[key]}</span>
                <div className={`h-2 overflow-hidden rounded-full ${scored ? 'bg-ds-surface-hover' : 'bg-ds-surface-hover'}`} role="img"
                  aria-label={`${DOMAIN_LABELS[key]} residual ${scored ? d!.rating : 'not assessed'}`}>
                  {scored ? (
                    <div className={`h-full rounded-full ${barColor(d!.rating)}`} style={{ width: `${pct}%` }} />
                  ) : (
                    // Neutral hatched track — visibly distinct from an empty (low) bar.
                    <div className="h-full w-full bg-[repeating-linear-gradient(45deg,#e2e8f0_0,#e2e8f0_3px,transparent_3px,transparent_6px)]" />
                  )}
                </div>
                {scored ? (
                  <span className={`inline-flex w-24 justify-center rounded-full border px-1.5 py-0.5 text-[12px] font-medium ${tierBadge(d!.rating)}`}>
                    {d!.rating}
                  </span>
                ) : (
                  <span className="inline-flex w-24 justify-center rounded-full border border-ds-border bg-ds-surface-subtle px-1.5 py-0.5 text-[12px] font-medium text-ds-fg-muted">
                    Not assessed
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
