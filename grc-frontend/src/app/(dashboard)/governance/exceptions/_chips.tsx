'use client';

// Two small chips the Exceptions page draws in more than one place: the kind of a document ("Standard") and what a row of "Waiting for me" waits for
// ("Decide": the person's decision; "Implement": the compensating controls, once it is approved). The words are _logic.ts's (docTypeLabel, waitingKindLabel).
import { StatusPill } from '@/components/ui/ds';
import type { Tone } from '@/lib/status';
import { docTypeLabel, waitingKindLabel } from './_logic';

/** The kind of a document as a quiet chip; nothing when the kind is not known. */
export function TypeChip({ type }: { type: string | null | undefined }) {
  const label = docTypeLabel(type);
  if (!label) return null;
  return (
    <span className="inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] text-ds-label text-ds-fg-body">
      <span className="truncate">{label}</span>
    </span>
  );
}

const WAITING_TONE: Record<string, Tone> = { decision: 'pending', implementation: 'progress' };
const WAITING_TITLE: Record<string, string> = { decision: 'Waits for your decision', implementation: 'Waits for you to carry it out' };

/** "Decide" or "Implement" for a row that waits for the person; nothing for any other row. */
export function WaitingChip({ kind }: { kind: string | null | undefined }) {
  const label = waitingKindLabel(kind);
  if (!label || !kind) return null;
  return (
    <span title={WAITING_TITLE[kind]} className="inline-flex max-w-full">
      <span className="sr-only">{WAITING_TITLE[kind]}: </span>
      <StatusPill size="sm" tone={WAITING_TONE[kind]} label={label} />
    </span>
  );
}
