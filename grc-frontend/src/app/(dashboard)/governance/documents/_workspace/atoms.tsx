'use client';

/**
 * The small things the library draws more than once (a table cell, a card and the details panel say the same thing the same way): the attestation ring, the review-date
 * line, a framework chip. Written on the design-system tokens: 12px at the least, only --ds colours (a chip's tint is one of the six status tones, by its name, as an inline
 * style), dates through lib/format.ts: a review date is a DAY, so it is the day as written, whatever the viewer's zone.
 */
import type { CSSProperties, ReactNode } from 'react';
import { EMPTY, formatDate } from '@/lib/format';
import { TONE, type Tone } from '@/lib/status';
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
  if (pct == null) return <span className="text-ds-body text-ds-fg-muted" title="No acknowledgement requested" aria-label="No acknowledgement requested">{EMPTY}</span>;
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
        <span className="block text-ds-body font-[600] tabular-nums text-ds-fg">{value}%</span>
        {hasCounts && <span className="block text-ds-label tabular-nums text-ds-fg-muted">{done}/{total}</span>}
      </span>
    </span>
  );
}

// ─── Review date ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const TONE_OF: Record<ReviewBucket | 'none', { text: string; dot: string }> = {
  overdue: { text: 'text-ds-danger', dot: 'bg-ds-danger' },
  due_soon: { text: 'text-ds-warning', dot: 'bg-ds-warning' },
  ok: { text: 'text-ds-success', dot: 'bg-ds-success' },
  unscheduled: { text: 'text-ds-fg-muted', dot: 'bg-ds-border-control' },
  none: { text: 'text-ds-fg-muted', dot: 'bg-ds-border-control' },
};
export const reviewTone = (bucket: ReviewBucket | null) => TONE_OF[bucket ?? 'none'];

/** A day for a cell, the drawer and the card: "12 Nov 2026" (the empty string for none). A Date from parseUtc is read by its UTC day, as the date is written. */
export const shortDate = (d: Date | null): string => formatDate(d, { calendar: true, empty: '' });

/** The date, and under it how far off it is ("5 d overdue" in red, "in 12 d" in amber). Documents a review is not owed on (a draft) show the planned date, quietly;
 *  none at all shows a dash. */
export function ReviewDate({ doc, now, compact = false }: { doc: Pick<LibDoc, 'status' | 'version_in_force' | 'next_review_date'>; now?: Date; compact?: boolean }) {
  const s = reviewState(doc, now);
  const tone = reviewTone(s.bucket);
  if (!s.due) {
    return s.label ? <span className={`text-ds-body ${tone.text}`} title={s.long}>{s.label}</span> : <span className="text-ds-body text-ds-fg-muted" aria-label="No review date"><span aria-hidden>{EMPTY}</span></span>;
  }
  const day = formatDate(doc.next_review_date, { calendar: true });
  const label = s.long ? `${day}, ${s.long}` : day;
  return (
    <span className="inline-flex flex-col leading-tight" title={label}>
      <span className={`whitespace-nowrap text-ds-body ${s.bucket ? 'font-[600] text-ds-fg' : 'text-ds-fg-muted'}`}>{day}</span>
      {s.label && !compact && (
        <span className={`inline-flex items-center gap-1 text-ds-label ${tone.text}`}>
          <span className={`h-[6px] w-[6px] rounded-full ${tone.dot}`} aria-hidden />
          {s.label}
        </span>
      )}
    </span>
  );
}

// ─── Framework chip ──────────────────────────────────────────────────────────────────────────────────────────────────────

const CHIP_TONES: Tone[] = ['progress', 'success', 'pending', 'warning', 'danger', 'neutral'];
/** One of the status tones by the framework's name, so the same framework is the same colour everywhere (a marker, not a meaning). */
export function chipTone(label: string): Tone {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return CHIP_TONES[h % CHIP_TONES.length];
}
export const chipStyle = (label: string, known = true): CSSProperties => {
  const t = TONE[known ? chipTone(label) : 'neutral'];
  return { background: t.tint, color: t.text, borderColor: t.border };
};

/** One framework's short label as a tinted chip; the full name is its tooltip. A framework the list does not know is grey, "#id". */
export function FrameworkChip({ chip, onClick, active = false, children }: { chip: Chip; onClick?: () => void; active?: boolean; children?: ReactNode }) {
  // shrinkable (two chips share a narrow cell: each gives way, with an ellipsis, before one is cut off); the label is its own span, because text-overflow does not
  // apply to the text of a flex container
  const base = `inline-flex h-[24px] min-w-[3rem] max-w-[7.5rem] shrink items-center rounded-ds-control border px-[6px] text-ds-label leading-none ${active ? 'shadow-[0_0_0_2px_var(--ds-primary)]' : ''}`;
  const label = <><span className="min-w-0 truncate">{chip.label}</span>{children}</>;
  if (!onClick) return <span className={base} style={chipStyle(chip.label, chip.known)} title={chip.name}>{label}</span>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={`${chip.name} — show the documents mapped to it`}
      style={chipStyle(chip.label, chip.known)}
      className={`${base} hover:brightness-95 focus-visible:outline-none focus-visible:shadow-ds-ring`}
    >
      {label}
    </button>
  );
}
