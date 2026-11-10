'use client';

// The small pieces a vendor is drawn with in the register's table, cards, board and drawer: the pills (always with their words, never a colour alone) and the date of the next review.
import { StatusPill } from '@/components/ui/ds';
import { EMPTY, formatDate, formatRelative } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { vendorGrade, vendorLifecycle, vendorNextStep, vendorTier } from '@/lib/statuses/vendor';
import { vendorClassification } from '@/lib/statuses/vendorRegister';
import { isArchived, reviewIsLate, statusWord, tierWord, type VendorRow } from '../../_lib/vendorRegisterDef';

const MUTED = 'text-ds-fg-muted';

export function TierPill({ v }: { v: VendorRow }) {
  return <StatusPill size="sm" {...statusPill(vendorTier, tierWord(v))} />;
}

export function StatusWord({ v }: { v: VendorRow }) {
  return isArchived(v) ? <StatusPill size="sm" tone="neutral" label="Archived" /> : <StatusPill size="sm" {...statusPill(vendorLifecycle, statusWord(v))} />;
}

export function GradePill({ v }: { v: VendorRow }) {
  return v.grade ? <StatusPill size="sm" {...statusPill(vendorGrade, v.grade)} /> : <span className={`text-ds-body ${MUTED}`}><span aria-hidden>{EMPTY}</span><span className="sr-only">Not graded</span></span>;
}

export function ClassPill({ v }: { v: VendorRow }) {
  return v.data_classification ? <StatusPill size="sm" {...statusPill(vendorClassification, v.data_classification.toLowerCase())} /> : null;
}

/** What the vendor waits on, in the server's words (it adds the grade to "Weak grade D"); "Nothing outstanding" when nothing waits. */
export function NextStep({ v }: { v: VendorRow }) {
  if (isArchived(v)) return <span className={`text-ds-body ${MUTED}`}>Archived</span>;
  if (!v.next_action) return <span className={`text-ds-body ${MUTED}`}>Nothing outstanding</span>;
  return <StatusPill size="sm" tone={vendorNextStep.tone(v.next_action.code)} label={v.next_action.label || vendorNextStep.label(v.next_action.code)} />;
}

/** The next review: the day as written, and how far away (or late) it is when it is late: the lateness is in words as well as in colour. */
export function ReviewDate({ v, now, stacked = true }: { v: VendorRow; now: Date; stacked?: boolean }) {
  if (!v.next_reassessment_date) return <span className={`text-ds-body ${MUTED}`}><span aria-hidden>{EMPTY}</span><span className="sr-only">No review date</span></span>;
  const late = reviewIsLate(v, now);
  return (
    <span className={`${stacked ? 'block' : 'inline'} whitespace-nowrap text-ds-body ${late ? 'text-ds-danger' : 'text-ds-fg-body'}`}>
      {formatDate(v.next_reassessment_date, { calendar: true })}
      {late && <span className={`${stacked ? 'block' : 'ml-[6px] inline'} text-ds-label`}>{formatRelative(v.next_reassessment_date, now, { calendar: true })}</span>}
    </span>
  );
}
