'use client';

// One request, as a card: it needs reading, not scanning. Name and who asked, the pills (urgency, screening, decision), what it is
// for, the data it would see, a box when it may already be on record, and the actions of the person who decides it.
import Link from 'next/link';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { BTN, BTN_DANGER, BTN_PRIMARY, StatusPill, tones } from '../../_ui';
import type { RequestRow } from '../../_lib/intakeApi';
import { URGENCY_WORD, byline, decisionLine, decisionPill, screeningPill } from '../../_lib/intakeModel';
import DuplicateBox from './DuplicateBox';

const LINK = 'rounded-sm text-[13px] font-medium text-[#0f766e] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

export default function RequestCard({ row, canReview, busy, onApprove, onDecline, onSendBack }: {
  row: RequestRow;
  /** may pick requests up, decline them and send them back */
  canReview: boolean;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
  onSendBack: () => void;
}) {
  const decision = decisionPill(row.intake_status);
  const screening = screeningPill(row.screening);
  const line = decisionLine(row.intake_status, row.decision);
  const open = `/vendor-risk/intake/${row.id}`;
  const isSupplier = row.intake_status === 'in_review' || row.intake_status === 'approved';

  return (
    <article aria-label={row.name} className="rounded-xl border border-[#d5dbe1] bg-[#fff] p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="break-words text-[16px] font-semibold leading-6 text-[#1f2933]">
            <Link href={open} className="rounded-sm hover:text-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">{row.name}</Link>
          </h2>
          <p className="text-[13px] leading-5 text-[#586472]">{byline(row)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatusPill variant="inline" tone={tones.urgency(row.urgency)}>{URGENCY_WORD[row.urgency] ?? URGENCY_WORD.normal}</StatusPill>
          {screening && <StatusPill variant="inline" tone={screening.tone}>{screening.label}</StatusPill>}
          <StatusPill tone={decision.tone}>{decision.label}</StatusPill>
        </div>
      </div>

      <p className="mt-3 text-[14px] leading-5 text-[#26323d]">{row.purpose || 'No intended use given.'}</p>

      {row.data_shared.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase leading-4 tracking-wide text-[#64707e]">Data shared</span>
          {row.data_shared.map((d) => (
            <span key={d} className="rounded-md bg-[#f0f2f5] px-2 py-0.5 text-[12px] font-medium leading-4 text-[#566072]">{d}</span>
          ))}
        </div>
      )}

      <DuplicateBox title="Already in the register" matches={row.duplicates}
        footnote={row.intake_status === 'submitted' ? 'Approving creates a duplicate unless these are different organisations.' : undefined} />

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#e1e6eb] pt-4">
        {row.intake_status === 'submitted' && (canReview ? (
          <>
            <button type="button" onClick={onApprove} disabled={busy} aria-label={`Approve and create ${row.name}`} className={BTN_PRIMARY}>
              {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Check aria-hidden className="h-4 w-4" strokeWidth={2.25} />}
              Approve and create
            </button>
            <button type="button" onClick={onDecline} disabled={busy} aria-label={`Decline ${row.name}`} className={BTN_DANGER}>Decline</button>
            <button type="button" onClick={onSendBack} disabled={busy} aria-label={`Send back ${row.name}`} className={BTN}>Send back</button>
          </>
        ) : (
          <p className="text-[13px] leading-5 text-[#586472]">Needs someone with permission to review requests.</p>
        ))}
        {row.intake_status === 'draft' && (
          <p className="text-[13px] leading-5 text-[#586472]">
            {row.open_problems ? `${row.open_problems} ${row.open_problems === 1 ? 'answer' : 'answers'} to go` : 'Ready to submit'}
          </p>
        )}
        {line && <p className="text-[13px] leading-5 text-[#26323d]">{line}</p>}
        {row.intake_status === 'in_review' && row.stage?.label && <p className="text-[13px] leading-5 text-[#586472]">Now at {row.stage.label}</p>}
        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href={open} className={LINK}>{row.intake_status === 'draft' ? 'Continue' : 'Open request'}</Link>
          {isSupplier && (
            <Link href={`/vendor-risk/vendors/${row.id}`} className={`${LINK} inline-flex items-center gap-1`}>
              Open vendor <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          )}
        </span>
      </div>
      {row.intake_status === 'rejected' && row.decision?.reason && (
        <p className="mt-3 text-[13px] leading-5 text-[#586472]">Reason: {row.decision.reason}</p>
      )}
    </article>
  );
}
