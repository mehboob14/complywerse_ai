'use client';

// The Decision sheet: ONE sheet for every "approve or turn down" an auditor takes. It shows what is being decided (a subject line, a few facts, and whatever
// context the page hands in: the requirement's text, a file to preview, the reason someone gave), the decision already recorded (who, when, their note),
// a note field, and two buttons. Turning down asks for the note (the rule is a prop: the Issue Register's validation has its own); every other word is a prop
// too, so the register can say "Pass" and "Send back" where the Portal says "Approve" and "Turn down". It does not save anything: the page owns the request
// (a useReportedMutation with toast: 'success'), gives the sheet `busy` while it runs and `error` (plain words) when it failed, and the sheet keeps the note so
// "Try again" sends the same decision again. `closedReason` replaces the buttons by the sentence that says why this one cannot be decided here.
//
//   <DecisionSheet open={!!row} onClose={close} title="Review file" subject={row.file_name} facts={[{ label: 'Requirement', value: ref }]}
//     previous={row.decided} busy={save.isPending ? save.variables?.decision : null} error={save.isError ? errorMessage(save.error) : null}
//     onDecide={(decision, remarks) => save.mutate({ id: row.id, decision, remarks })}>…context…</DecisionSheet>
//
// Built on the kit's Sheet (right-hand sheet from 640px, bottom sheet under it; focus trap, Escape, focus back, "Discard changes?" when a note was typed).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button, FactList, Fact, FormField, Notice, Sheet, StatusPill, Textarea } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { decisionWord } from '@/lib/statuses/auditPortal';
import { cleanRemarks, previousLine, remarksProblem, ruleOf, type Decision, type PreviousDecision, type RemarksRule } from './decisionModel';

export interface DecisionSheetProps {
  open: boolean;
  onClose: () => void;
  /** what is being done: "Review file", "Decide a scope request" */
  title: string;
  subtitle?: ReactNode;
  /** what is being decided, as one line (the file's name, the requirement) */
  subject: ReactNode;
  /** a few facts about it, as label and value; a value left empty says "—" */
  facts?: ReadonlyArray<{ label: string; value?: ReactNode }>;
  /** the context the decision rests on: the requirement's text, the reason, a file to open */
  children?: ReactNode;
  /** the decision already recorded: shown above the note field ("Approved by Ada Admin on 12 Nov 2026") with the note that came with it */
  previous?: PreviousDecision | null;
  approveLabel?: string;
  rejectLabel?: string;
  /** the note field: its label, a hint, and when it must be written */
  remarks?: Partial<RemarksRule> & { label?: string; hint?: string };
  /** this one cannot be decided here: the buttons give way to this sentence (a scope request that was already decided) */
  closedReason?: string | null;
  /** the decision being saved right now: its button shows the spinner and both ignore presses */
  busy?: Decision | null;
  /** plain words for a save that failed; shown above the buttons with "Try again" */
  error?: string | null;
  onDecide: (decision: Decision, remarks: string) => void;
  /** one more link or button beside the two (Open in Frameworks) */
  extra?: ReactNode;
}

export function DecisionSheet({
  open, onClose, title, subtitle, subject, facts, children, previous, approveLabel = 'Approve', rejectLabel = 'Turn down', remarks: remarksProp,
  closedReason, busy = null, error, onDecide, extra,
}: DecisionSheetProps) {
  const rule = ruleOf(remarksProp);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<{ decision: Decision; text: string } | null>(null);
  const last = useRef<Decision | null>(null);
  const saving = busy !== null;
  // a sheet that opens on another record starts with an empty note; the sheet that stays open on a failed save keeps it
  useEffect(() => { if (!open) { setNote(''); setProblem(null); last.current = null; } }, [open]);

  const decide = (decision: Decision) => {
    if (saving) return;
    const text = remarksProblem(decision, note, rule);
    if (text) { setProblem({ decision, text }); return; }
    setProblem(null);
    last.current = decision;
    onDecide(decision, cleanRemarks(note));
  };

  const before = previousLine(previous, (word) => decisionWord.label(word));
  const noteLabel = remarksProp?.label ?? 'Note';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      width="md"
      dirty={!saving && cleanRemarks(note).length > 0}
      footer={closedReason ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-[8px]">
          <span className="text-ds-body text-ds-fg-muted">{closedReason}</span>
          <span className="flex flex-wrap items-center gap-[8px]">{extra}<Button onClick={onClose}>Close</Button></span>
        </div>
      ) : (
        <div className="flex w-full flex-wrap items-center justify-between gap-[8px]">
          <span className="flex flex-wrap items-center gap-[8px]">{extra}</span>
          <span className="flex flex-wrap items-center gap-[8px]">
            <Button leftIcon={<XCircle aria-hidden />} loading={busy === 'rejected'} disabled={saving && busy !== 'rejected'} onClick={() => decide('rejected')}>{rejectLabel}</Button>
            <Button variant="primary" leftIcon={<CheckCircle2 aria-hidden />} loading={busy === 'approved'} disabled={saving && busy !== 'approved'} onClick={() => decide('approved')}>{approveLabel}</Button>
          </span>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <p className="min-w-0 break-words text-ds-section font-[600] text-ds-fg [overflow-wrap:anywhere]">{subject}</p>

        {facts && facts.length > 0 && (
          <FactList min={140}>
            {facts.map((f) => <Fact key={f.label} label={f.label}>{f.value}</Fact>)}
          </FactList>
        )}

        {children}

        {previous && before && (
          <div className="flex flex-col gap-[4px] rounded-ds-card border border-ds-border bg-ds-surface-hover px-[12px] py-[8px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <StatusPill size="sm" {...statusPill(decisionWord, previous.decision)} />
              <span className="text-ds-body text-ds-fg">{before}</span>
            </div>
            {previous.remarks && <p className="whitespace-pre-wrap break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{previous.remarks}</p>}
          </div>
        )}

        {!closedReason && (
          <FormField
            label={noteLabel}
            optional={rule.requiredFor === 'none'}
            required={rule.requiredFor === 'both'}
            hint={remarksProp?.hint ?? (rule.requiredFor === 'rejected' ? `Needed to turn it down. ${previous ? 'Saving replaces the decision above.' : 'It is kept with your decision.'}` : 'It is kept with your decision.')}
            error={problem?.text ?? null}
          >
            <Textarea
              value={note}
              rows={4}
              maxLength={rule.max}
              disabled={saving}
              onChange={(e) => { setNote(e.target.value); if (problem) setProblem(null); }}
            />
          </FormField>
        )}

        {error && (
          <Notice tone="danger" title="The decision was not saved" action={<Button disabled={saving} onClick={() => last.current && decide(last.current)}>Try again</Button>}>
            {error}
          </Notice>
        )}
      </div>
    </Sheet>
  );
}

export default DecisionSheet;
