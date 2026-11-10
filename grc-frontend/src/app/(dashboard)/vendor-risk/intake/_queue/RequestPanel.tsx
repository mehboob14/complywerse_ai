'use client';

// The selected request, read in full and decided in place: its name and pills, who asked and when, what it is for, the data it would see, a notice when it may already be on record, and the
// actions of the person who decides it (Approve and create, Decline, Send back). Used beside the queue on a wide screen and inside a sheet on a narrow one.
import { ArrowRight, Check } from 'lucide-react';
import { Button, ChipList, ClampedText, Fact, FactList, StatusPill } from '@/components/ui/ds';
import type { RequestRow } from '../../_lib/intakeApi';
import { byline, decisionLine, decisionPill, draftLine, screeningPill, urgencyPill } from '../../_lib/intakeModel';
import DuplicateBox from '../_components/DuplicateBox';

export default function RequestPanel({ row, canReview, busy, onApprove, onDecline, onSendBack }: {
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
  const urgency = urgencyPill(row.urgency);
  const line = decisionLine(row.intake_status, row.decision);
  const isSupplier = row.intake_status === 'in_review' || row.intake_status === 'approved';
  const open = `/vendor-risk/intake/${row.id}`;
  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      <div className="flex min-w-0 flex-col gap-[4px]">
        <h3 dir="auto" className="min-w-0 break-words !text-ds-section !font-[600] !text-ds-fg [overflow-wrap:anywhere]">{row.name}</h3>
        <p dir="auto" className="min-w-0 break-words text-ds-body text-ds-fg-muted [overflow-wrap:anywhere]">{byline(row)}</p>
        <div className="mt-[4px] flex flex-wrap items-center gap-[8px]">
          <StatusPill tone={decision.tone} label={decision.label} />
          {(row.intake_status === 'submitted' || row.intake_status === 'draft') && <StatusPill tone={urgency.tone} label={urgency.label} />}
          {screening && <StatusPill tone={screening.tone} label={screening.label} />}
        </div>
      </div>

      <FactList min={200}>
        <Fact label="What it is for"><ClampedText text={row.purpose || 'No intended use given.'} lines={4} /></Fact>
        <Fact label="Data shared" empty="None named">{row.data_shared.length > 0 ? <ChipList label="data types" items={row.data_shared} /> : null}</Fact>
        {row.website && <Fact label="Website">{row.host || row.website}</Fact>}
        {row.intake_status === 'in_review' && row.stage?.label && <Fact label="Now at">{row.stage.label}</Fact>}
      </FactList>

      <DuplicateBox
        title="Already in the register"
        matches={row.duplicates}
        footnote={row.intake_status === 'submitted' ? 'Approving creates a duplicate unless these are different organisations.' : undefined}
      />

      {row.intake_status === 'draft' && <p className="text-ds-body text-ds-fg-muted">{draftLine(row.open_problems)}</p>}
      {line && <p className="text-ds-body text-ds-fg-body">{line}</p>}
      {row.intake_status === 'rejected' && row.decision?.reason && <p className="text-ds-body text-ds-fg-body">Reason: {row.decision.reason}</p>}

      <div className="flex flex-wrap items-center gap-[8px] border-t border-ds-border pt-[12px]">
        {row.intake_status === 'submitted' && (canReview ? (
          <>
            <Button variant="primary" leftIcon={<Check aria-hidden />} loading={busy} aria-label={`Approve and create ${row.name}`} onClick={onApprove}>Approve and create</Button>
            <Button variant="dangerOutline" disabled={busy} aria-label={`Decline ${row.name}`} onClick={onDecline}>Decline</Button>
            <Button disabled={busy} aria-label={`Send back ${row.name}`} onClick={onSendBack}>Send back</Button>
          </>
        ) : (
          <p className="text-ds-body text-ds-fg-muted">Needs someone with permission to review requests.</p>
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-[8px]">
          <Button href={open} variant={row.intake_status === 'draft' ? 'primary' : 'ghost'}>{row.intake_status === 'draft' ? 'Continue' : 'Open request'}</Button>
          {isSupplier && <Button href={`/vendor-risk/vendors/${row.id}`} variant="ghost" rightIcon={<ArrowRight aria-hidden />}>Open vendor</Button>}
        </span>
      </div>
    </div>
  );
}
