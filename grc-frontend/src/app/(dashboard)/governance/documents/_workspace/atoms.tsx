'use client';

/**
 * The small things the library draws more than once (a table cell and the detail drawer say the same thing the same way): the
 * attestation ring, the review-date line, a framework chip. Colours are explicit hex classes on purpose: the platform's CSS repaints
 * slate/white inside the dashboard, and a bare <p>/<td> gets its own size and colour (PITFALLS: grc-frontend UI).
 */
import type { ReactNode } from 'react';
import { categoryTint } from './lib';
import { reviewState, type FrameworkChip as Chip, type LibDoc, type ReviewBucket } from './libraryModel';

// ─── Attestation ring ────────────────────────────────────────────────────────────────────────────────────────────────────

const RING = { good: '#059669', warn: '#d97706', bad: '#e11d48', track: '#e1e6eb' };
export const attestationColour = (pct: number) => (pct >= 90 ? RING.good : pct >= 70 ? RING.warn : RING.bad);

/** A ring filled to the %, with the number beside it (and "4/5" under it when the counts are known); "Not requested" without a campaign. */
export function AttestationRing({ pct, done, total, size = 28, showCounts = true }: {
  pct: number | null | undefined;
  done?: number;
  total?: number;
  size?: number;
  showCounts?: boolean;
}) {
  if (pct == null) return <span className="text-[12px] text-[#586472]" title="No acknowledgement has been requested for this document">Not requested</span>;
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const hasCounts = showCounts && done != null && total != null && total > 0;
  return (
    <span className="inline-flex items-center gap-2" title={hasCounts ? `${done} of ${total} acknowledged` : `${value}% acknowledged`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={RING.track} strokeWidth={3} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={attestationColour(value)} strokeWidth={3} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <span className="leading-tight">
        <span className="block text-[13px] font-semibold tabular-nums text-[#1f2933]">{value}%</span>
        {hasCounts && <span className="block text-[11px] tabular-nums text-[#586472]">{done}/{total}</span>}
      </span>
    </span>
  );
}

// ─── Review date ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const TONE: Record<ReviewBucket | 'none', { text: string; dot: string }> = {
  overdue: { text: 'text-[#b42318]', dot: 'bg-[#e11d48]' },
  due_soon: { text: 'text-[#b45309]', dot: 'bg-[#f59e0b]' },
  ok: { text: 'text-[#047857]', dot: 'bg-[#10b981]' },
  unscheduled: { text: 'text-[#586472]', dot: 'bg-[#cbd5e1]' },
  none: { text: 'text-[#586472]', dot: 'bg-[#cbd5e1]' },
};
export const reviewTone = (bucket: ReviewBucket | null) => TONE[bucket ?? 'none'];

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const shortDate = (d: Date | null) => (d ? dateFmt.format(d) : '');

/** The date, and under it how far off it is ("Overdue by 5 days" in red, "Due in 12 days" in amber). Documents a review is not owed on
 *  (a draft) show the planned date, quietly; none at all shows a dash. */
export function ReviewDate({ doc, now, compact = false }: { doc: Pick<LibDoc, 'status' | 'version_in_force' | 'next_review_date'>; now?: Date; compact?: boolean }) {
  const s = reviewState(doc, now);
  const tone = reviewTone(s.bucket);
  if (!s.due) {
    return s.label ? <span className={`text-[12px] ${tone.text}`}>{s.label}</span> : <span className="text-[13px] text-[#9aa5b1]" aria-label="No review date">—</span>;
  }
  const label = s.label ? `${shortDate(s.due)}, ${s.label}` : shortDate(s.due);
  return (
    <span className="inline-flex flex-col leading-tight" title={label}>
      <span className={`text-[13px] ${s.bucket ? 'font-medium text-[#1f2933]' : 'text-[#586472]'}`}>{shortDate(s.due)}</span>
      {s.label && !compact && (
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${tone.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
          {s.label}
        </span>
      )}
    </span>
  );
}

// ─── Framework chip ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** One framework's short label as a tinted chip; the full name is its tooltip. A framework the list does not know is grey, "#id". */
export function FrameworkChip({ chip, onClick, active = false, children }: { chip: Chip; onClick?: () => void; active?: boolean; children?: ReactNode }) {
  const tint = chip.known ? categoryTint(chip.label).soft : 'bg-slate-100 text-slate-600';
  const base = `inline-flex h-5 max-w-[7.5rem] shrink-0 items-center truncate rounded-md px-1.5 text-[11px] font-semibold leading-none ${tint} ${active ? 'ring-1 ring-[#0f766e]' : ''}`;
  if (!onClick) return <span className={base} title={chip.name}>{chip.label}{children}</span>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={`${chip.name} — show the documents mapped to it`}
      className={`${base} hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]`}
    >
      {chip.label}{children}
    </button>
  );
}
