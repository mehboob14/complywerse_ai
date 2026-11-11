'use client';

// The implementation of an approved exception (D62), after the last approval of an exception whose requester chose an implementer (D67): where it stands ("Waiting for compensating
// controls", "In progress", "Implemented", "Cancelled"), who is asked (any one of them can carry it out), the due day with an overdue mark, a warning when nobody who
// can act is left, and, once it is done, who did it and their note. The compensating controls are its `children` (_ControlsPanel.tsx). The person asked (`can_complete`,
// the server's flag) gets "Mark implemented": a note, then the server decides. Marking needs a control (the server's 400 is shown as it is); when some potential risks
// have no control the server answers 409 with a question, which is asked in a box of its own ("Mark implemented anyway") and sends `confirm_uncovered` only on a yes.
// Words: _approval.ts. Without an implementer chosen on the exception nothing here is drawn.
import { useId, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { CheckCircle2, Clock } from 'lucide-react';
import { policyExceptionApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { AnimatedModal } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, FormField, Notice, StatusPill, Textarea, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { implementationDue, implementationTone, implementationWord, implementedLine, implementerLine } from './_approval';
import { uncoveredQuestion } from './_riskText';
import { LIST_KEYS, type ExceptionItem } from './_types';

/** The note, then Mark implemented. */
function MarkDialog({ exception, onClose }: { exception: ExceptionItem; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const complete = useReportedMutation({
    mutationFn: (v: { note: string; anyway: boolean }) =>
      policyExceptionApi.completeImplementation(exception.id, { note: v.note || undefined, ...(v.anyway ? { confirm_uncovered: true } : {}) }),
    success: 'Marked implemented',
    failure: 'Not marked implemented',
    toast: 'success',                                                      // a refusal is said in the dialog, or asked as a question: not twice
    invalidate: [...LIST_KEYS, ['exception-comments']],                    // marking it writes a line into the comments, which the open details show
    onSuccess: onClose,
    onError: (error, v) => {
      const question = uncoveredQuestion(error);
      if (question === null) { setProblem(errorMessage(error)); return; }
      setProblem(null);
      void askAnyway(question, v.note);
    },
  });
  // the server's question, in its own words, in a box of its own: only a yes sends confirm_uncovered
  const askAnyway = async (question: string, note: string) => {
    if (await confirm({ title: 'Some risks are not covered', message: question, confirmLabel: 'Mark implemented anyway' })) complete.mutate({ note, anyway: true });
  };
  return (
    <>
      <AnimatedModal
        isOpen
        onClose={onClose}
        size="md"
        title="Mark implemented"
        subtitle={<span title={exception.title}>{truncate(exception.title, 120).text}</span>}
        dirty={note.trim() !== ''}
        footer={(
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" leftIcon={<CheckCircle2 aria-hidden />} loading={complete.isPending} onClick={() => { setProblem(null); complete.mutate({ note: note.trim(), anyway: false }); }}>Mark implemented</Button>
          </div>
        )}
      >
        <div className="flex flex-col gap-[12px] px-[20px] py-[16px]">
          {problem && <Notice tone="danger">{problem}</Notice>}
          <FormField label="Note" optional info="Shown in the comments, with your name.">
            <Textarea rows={4} maxLength={4000} value={note} onChange={(ev) => setNote(ev.target.value)} />
          </FormField>
        </div>
      </AnimatedModal>
      {confirmDialog}
    </>
  );
}

export function ImplementationPanel({ exception: e, children }: { exception: ExceptionItem; children?: ReactNode }) {
  const headingId = useId();
  const [marking, setMarking] = useState(false);
  const impl = e.implementation;
  if (!impl) return null;
  const who = implementerLine(impl);
  const due = implementationDue(impl);
  const done = implementedLine(impl);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border p-[12px]">
      <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
        <h3 id={headingId} className="!text-ds-section !text-ds-fg">Implementation</h3>
        <StatusPill size="sm" tone={implementationTone(impl.state)} label={implementationWord(impl.state)} />
      </div>

      <div aria-live="polite" className="flex flex-col gap-[4px] empty:hidden">
        {who && (
          <p className={clsx('flex items-center gap-[6px] text-ds-body', impl.stalled ? 'text-ds-danger' : 'text-ds-fg')}>
            <Clock aria-hidden strokeWidth={1.75} className="h-[16px] w-[16px] shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{who}</span>
            {impl.stalled && <InfoTip label="About nobody can act" text="Everyone asked to implement it is gone or not active. Ask an administrator for help." />}
          </p>
        )}
        {due && <span className={clsx('text-ds-label', impl.overdue ? 'text-ds-danger' : 'text-ds-fg-muted')}>{due}</span>}
        {done && <span className="text-ds-body text-ds-fg">{done}</span>}
        {impl.state === 'done' && impl.note && <p className="whitespace-pre-wrap text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{impl.note}</p>}
      </div>

      {children}

      {impl.can_complete && (
        <div role="group" aria-label="What you can do" className="flex flex-wrap items-center justify-end gap-[8px] border-t border-ds-border pt-[12px]">
          <Button variant="primary" leftIcon={<CheckCircle2 aria-hidden />} onClick={() => setMarking(true)}>Mark implemented</Button>
        </div>
      )}
      {marking && <MarkDialog exception={e} onClose={() => setMarking(false)} />}
    </section>
  );
}
