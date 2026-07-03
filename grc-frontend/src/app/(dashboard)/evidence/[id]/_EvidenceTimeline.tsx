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

import { Clock } from 'lucide-react';

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
      label: 'OCR extracted',
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
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Clock className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
        Lifecycle
      </h3>
      <ol className="relative space-y-4">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          return (
            <li key={step.key} className="relative flex gap-3">
              {/* connector line */}
              {!isLast && (
                <span
                  className="absolute left-[5px] top-4 h-full w-px bg-slate-200"
                  aria-hidden
                />
              )}
              <span
                className={`relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                  step.done ? 'bg-emerald-500' : 'bg-slate-300'
                }`}
                aria-hidden
              />
              <div className="min-w-0">
                <p className={`text-sm font-medium ${step.done ? 'text-slate-800' : 'text-slate-500'}`}>
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
