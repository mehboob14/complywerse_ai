'use client';

/**
 * Client-side lifecycle timeline for the evidence detail page. Derives its
 * steps purely from fields already on the loaded evidence record — no extra
 * query. Steps whose date is null are omitted (except the final Approval step,
 * which always renders, showing "Awaiting · Pending" until approved).
 *
 * Charter: single teal brand (primary-*), emerald=done / slate=awaiting dots,
 * hairline borders, no gradients, lucide strokeWidth 1.75.
 */

export interface TimelineEvidence {
  uploaded_at: string | null;
  uploader_name: string | null;
  ocr_processed_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  quality_score: number | null;
  latest_assessment: { assessed_at: string | null } | null;
}

interface Step {
  key: string;
  label: string;
  meta: string | null;
  date: string | null;
  done: boolean;
}

export default function EvidenceTimeline({
  evidence,
  fmtDateTime,
}: {
  evidence: TimelineEvidence;
  fmtDateTime: (d?: string | null) => string;
}) {
  const qualityPct =
    evidence.quality_score == null
      ? null
      : evidence.quality_score <= 1
      ? Math.round(evidence.quality_score * 100)
      : Math.round(evidence.quality_score);

  const assessedAt = evidence.latest_assessment?.assessed_at ?? null;

  const raw: Step[] = [
    {
      key: 'uploaded',
      label: 'Uploaded',
      meta: evidence.uploaded_at
        ? `${fmtDateTime(evidence.uploaded_at)}${evidence.uploader_name ? ` · ${evidence.uploader_name}` : ''}`
        : null,
      date: evidence.uploaded_at,
      done: !!evidence.uploaded_at,
    },
    {
      key: 'ocr',
      label: 'Text extracted',
      meta: evidence.ocr_processed_at ? fmtDateTime(evidence.ocr_processed_at) : null,
      date: evidence.ocr_processed_at,
      done: !!evidence.ocr_processed_at,
    },
    {
      key: 'assessed',
      label: 'AI assessed',
      meta: assessedAt
        ? `${fmtDateTime(assessedAt)}${qualityPct != null ? ` · ${qualityPct}%` : ''}`
        : null,
      date: assessedAt,
      done: !!assessedAt,
    },
    {
      key: 'submitted',
      label: 'Submitted for review',
      meta: evidence.submitted_at ? fmtDateTime(evidence.submitted_at) : null,
      date: evidence.submitted_at,
      done: !!evidence.submitted_at,
    },
    {
      key: 'approval',
      label: 'Approval',
      meta: evidence.approved_at ? `Approved ${fmtDateTime(evidence.approved_at)}` : 'Awaiting · Pending',
      date: evidence.approved_at,
      done: !!evidence.approved_at,
    },
  ];

  // Omit dateless steps except the final Approval step (always shown).
  const steps = raw.filter((s) => s.key === 'approval' || s.date);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      {/* Horizontal lifecycle stepper: dots joined by connector lines, labels
          left-aligned beneath each dot. Green = done, hollow slate = awaiting. */}
      <ol className="flex items-start">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          return (
            <li key={step.key} className={`relative min-w-0 ${isLast ? 'flex-none' : 'flex-1'}`}>
              <div className="flex items-center">
                <span
                  className={`relative z-10 h-3.5 w-3.5 shrink-0 rounded-full ${
                    step.done ? 'bg-emerald-500' : 'border-2 border-slate-300 bg-white'
                  }`}
                  aria-hidden
                />
                {!isLast && (
                  <span
                    className={`h-0.5 w-full ${step.done ? 'bg-emerald-500' : 'bg-slate-200'}`}
                    aria-hidden
                  />
                )}
              </div>
              <div className="mt-2 pr-3">
                <p className={`truncate text-sm font-medium ${step.done ? 'text-slate-800' : 'text-slate-500'}`}>
                  {step.label}
                </p>
                {step.meta && <p className="mt-0.5 truncate text-xs text-slate-500">{step.meta}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
