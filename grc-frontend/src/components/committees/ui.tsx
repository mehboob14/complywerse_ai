'use client';

// The few pieces the Committees screens (the home, the sheet, a meeting, Oversight Actions) share, on the design-system tokens and the kit (components/ui/ds).
// Page-local on purpose: a second module that needs one can promote it to the kit (see the report: "Kit gaps").
import { useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Button, StatusPill, useFieldControl } from '@/components/ui/ds';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import type { ConfirmOptions } from '@/components/ui/ds/useConfirm';
import { committeeApi } from '@/lib/api';
import {
  deactivateCommitteePlan, deactivatedLine, isOverdueAction, reactivatedLine, slaPill, whatStays, type SlaLike, type WhatStays,
} from '@/lib/committees';
import { EMPTY, truncate } from '@/lib/format';
import { actionStatus, committeeStatus, priority as priorityStatus, statusPill } from '@/lib/status';

/** Long text as a preview and the whole of it one press away (a 500-character agenda title, 20,000 characters of minutes). */
export function ClampedText({ text, max, className, buttonLabel }: { text: string; max: number; className?: string; buttonLabel?: string }) {
  const [open, setOpen] = useState(false);
  const cut = truncate(text, max);
  return (
    <span className={clsx('[overflow-wrap:anywhere]', className)}>
      {open || !cut.truncated ? text : cut.text}
      {cut.truncated && (
        <>
          {' '}
          <button
            type="button"
            aria-expanded={open}
            aria-label={buttonLabel ? `${open ? 'Show less of' : 'Show all of'} ${buttonLabel}` : undefined}
            onClick={() => setOpen(!open)}
            className="rounded-ds-control text-ds-label text-ds-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring"
          >
            {open ? 'Show less' : 'Show more'}
          </button>
        </>
      )}
    </span>
  );
}

/** A person picker (the searchable dropdown of the platform) with its caption. The picker's trigger names itself, so its caption is not a <label> for anything. */
export function PickerField({ label, required, optional, hint, className, children }: { label: string; required?: boolean; optional?: boolean; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={clsx('flex min-w-0 flex-col gap-[4px]', className)}>
      <span className="text-ds-label text-ds-fg">
        {label}
        {required ? (<><span aria-hidden="true" className="ml-[2px] text-ds-danger">*</span><span className="sr-only"> (required)</span></>) : optional ? <span className="ml-[4px] font-normal text-ds-fg-muted">(optional)</span> : null}
      </span>
      {children}
      {hint && <p className="break-words text-ds-label font-normal text-ds-fg-muted">{hint}</p>}
    </div>
  );
}

/** A file field on the kit's look: the browser's own picker (a keyboard and screen-reader user has it all), named by the FormField around it. */
export function FileInput({ accept, onPick }: { accept?: string; onPick: (file: File | null) => void }) {
  const a11y = useFieldControl();
  return (
    <input
      {...a11y}
      type="file"
      accept={accept}
      onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      className="block w-full min-w-0 text-ds-body text-ds-fg-body file:mr-[12px] file:h-ds-control file:cursor-pointer file:rounded-ds-control file:border file:border-ds-border-strong file:bg-ds-surface file:px-[12px] file:text-ds-body file:font-medium file:text-ds-fg-body hover:file:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
    />
  );
}

/** What the server said about a form that did not save, at the top of the form it is about (the toast says it too, but from the corner of the screen).
 *  `message` is already cleaned (errorMessage). */
export function FormProblem({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p role="alert" className="break-words rounded-ds-control border border-ds-danger-border bg-ds-danger-soft px-[12px] py-[8px] text-ds-body text-ds-danger">{message}</p>;
}

/** The footer of a drawer: Cancel, and the one action (a spinner while it is being saved). `form` is the id of the <form> the button submits. */
export function DrawerFooter({ onCancel, form, pending, label, pendingLabel, disabled }: {
  onCancel: () => void;
  form: string;
  pending: boolean;
  label: string;
  pendingLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-[8px]">
      <Button onClick={onCancel}>Cancel</Button>
      <Button type="submit" form={form} variant="primary" loading={pending} disabled={disabled}>{pending && pendingLabel ? pendingLabel : label}</Button>
    </div>
  );
}

/** A committee's state as a word: Active or Inactive (it has `is_active`, not a status column). */
export function CommitteeActivity({ active, size }: { active: boolean; size?: 'sm' | 'md' }) {
  return <StatusPill size={size} {...statusPill(committeeStatus, active ? 'active' : 'inactive')} />;
}

// ── Deactivate / Reactivate: the same two calls and the same question from the list and from the committee ─────────────────────────────────────────────
/** What stays when `committeeId` is deactivated, read just before the question is asked: the committee's own count of open actions and the number of its
 *  meetings still to come (scheduled, not yet past; naive UTC, as the server stores times). A request that fails is not 0: the question then says it
 *  without the number. */
async function readWhatStays(committeeId: number): Promise<WhatStays> {
  const now = new Date().toISOString().slice(0, 19);
  const [committee, meetings] = await Promise.allSettled([
    committeeApi.getCommittee(committeeId),
    committeeApi.getMeetings(committeeId, { status: 'scheduled', from_date: now, limit: 1 }),
  ]);
  return whatStays(committee.status === 'fulfilled' ? committee.value.data : null, meetings.status === 'fulfilled' ? meetings.value.data : null);
}

export interface ActivationTarget { id: number; name: string }

/** Deactivate (asked first, with what stays) and Reactivate (no question: it takes nothing away) for one committee at a time. Both are reported
 *  mutations: the toast comes after the server answered, a failure stays with the server's words (an open audit extension request says so in a 409) and a
 *  Retry where repeating can help. `invalidate` is the page's own queries; `onChanged` runs after the server confirmed. `confirm` is the page's useConfirm. */
export function useCommitteeActivation({ confirm, invalidate, onChanged, deactivatedNote }: {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  invalidate: ReadonlyArray<readonly unknown[]>;
  onChanged?: (committee: ActivationTarget, active: boolean) => void;
  /** a second line under "X is deactivated.", for a page where the committee leaves the list */
  deactivatedNote?: string;
}) {
  const [reading, setReading] = useState(false);
  const label = (c: ActivationTarget) => truncate(c.name, 60).text;
  const deactivation = useReportedMutation({
    mutationFn: (c: ActivationTarget) => committeeApi.deactivateCommittee(c.id),
    success: (_r, c) => (deactivatedNote ? { title: deactivatedLine(label(c)), message: deactivatedNote } : deactivatedLine(label(c))),
    failure: "Couldn't deactivate the committee",
    invalidate,
    onSuccess: (_r, c) => onChanged?.(c, false),
  });
  const reactivation = useReportedMutation({
    mutationFn: (c: ActivationTarget) => committeeApi.reactivateCommittee(c.id),
    success: (_r, c) => reactivatedLine(label(c)),
    failure: "Couldn't reactivate the committee",
    invalidate,
    onSuccess: (_r, c) => onChanged?.(c, true),
  });
  const askDeactivate = async (c: ActivationTarget) => {
    setReading(true);
    let stays: WhatStays;
    try { stays = await readWhatStays(c.id); } finally { setReading(false); }
    const plan = deactivateCommitteePlan(label(c), stays);
    // tone "danger" puts focus on Cancel, as for a department: a stray Enter does not switch a committee off (it is reversible, but other screens change)
    if (await confirm({ title: plan.title, message: plan.message, confirmLabel: plan.confirmLabel, tone: 'danger' })) deactivation.mutate(c);
  };
  return {
    askDeactivate,
    reactivate: (c: ActivationTarget) => reactivation.mutate(c),
    /** a question is being prepared or a call is on its way: the buttons wait */
    busy: reading || deactivation.isPending || reactivation.isPending,
  };
}

/** An action's status as a word, and "Overdue" beside it when the API says it is late (an open action past its due date is not "overdue" by status). */
export function ActionStatusPills({ action, size }: { action: { status: string; is_overdue?: boolean }; size?: 'sm' | 'md' }) {
  const late = isOverdueAction(action) && action.status !== 'overdue';
  return (
    <span className="inline-flex flex-wrap items-center gap-[4px]">
      <StatusPill size={size} {...statusPill(actionStatus, action.status)} />
      {late && <StatusPill size={size} tone="danger" label="Overdue" />}
    </span>
  );
}

/** An action's priority as a word (Critical, High, Medium, Low). */
export function PriorityTag({ value, size }: { value?: string | null; size?: 'sm' | 'md' }) {
  return <StatusPill size={size} {...statusPill(priorityStatus, value || 'medium')} />;
}

/** The SLA of Task Management as a pill, in the words its badge has always used; the dash when there is nothing to say. */
export function SlaTag({ sla, size }: { sla: SlaLike | null | undefined; size?: 'sm' | 'md' }) {
  const pill = slaPill(sla);
  if (!pill) return <span aria-label="No SLA" className="text-ds-body text-ds-fg-muted">{EMPTY}</span>;
  return <span title={pill.title} className="inline-flex"><StatusPill size={size} tone={pill.tone} label={pill.label} /></span>;
}
