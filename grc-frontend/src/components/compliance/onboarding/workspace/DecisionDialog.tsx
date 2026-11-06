'use client';

/**
 * The three decisions that need words: Approve (an optional note), Reopen (a reason) and Mark underway (a kind and a reason). Submit needs none, so it has no
 * dialog. The server decides who may do each (approve and override are rights of their own); a refusal says which right is missing, and nothing is pretended.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, FormField, Notice, Select, Textarea } from '@/components/ui/ds';
import { onboardingApi, problemOf, type OnboardingView, type Register, type UnderwayKind } from '@/lib/frameworkOnboarding';
import { actionRefusal, errorsByField, reasonProblem } from './workspaceModel';

export type Decision = 'approve' | 'reopen' | 'underway';

const WORDS: Record<Decision, { title: string; action: string; done: string }> = {
  approve: { title: 'Approve onboarding', action: 'Approve', done: 'Approved. The onboarding is locked and the journey may start.' },
  reopen: { title: 'Reopen onboarding', action: 'Reopen', done: 'Reopened as a draft. A journey that is running keeps running.' },
  underway: { title: 'Mark underway', action: 'Mark underway', done: 'Marked underway. The journey may start; what is open stays listed.' },
};

export default function DecisionDialog({ id, decision, framework, meta, flush, onClose, onDone }: {
  id: number;
  decision: Decision;
  framework: string;
  meta: Register['meta'];
  /** saves what was typed in the last moment, so the decision is made on the answers the person sees */
  flush: () => Promise<unknown>;
  onClose: () => void;
  onDone: (view: OnboardingView, message: string) => void;
}) {
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<UnderwayKind | ''>('');
  const words = WORDS[decision];
  const min = decision === 'reopen' ? meta.min_reopen_reason : meta.min_underway_reason;
  const needsReason = decision !== 'approve';

  const send = useMutation({
    mutationFn: async () => {
      await flush();
      if (decision === 'approve') return onboardingApi.approve(id, note.trim());
      if (decision === 'reopen') return onboardingApi.reopen(id, reason.trim());
      return onboardingApi.underway(id, kind as UnderwayKind, reason.trim());
    },
    onSuccess: (view) => onDone(view, words.done),
  });
  const problem = send.error ? problemOf(send.error) : null;
  const fieldErrors = problem ? errorsByField(problem) : {};
  const ready = decision === 'approve' || (reasonProblem(reason, min) === null && (decision === 'reopen' || kind !== ''));
  const dirty = note.trim() !== '' || reason.trim() !== '';
  const refusal = problem ? actionRefusal(decision, problem) : null;

  return (
    <AnimatedModal
      isOpen onClose={onClose} size="lg" dirty={dirty}
      title={decision === 'underway'
        ? <span className="inline-flex items-center gap-[4px]">{words.title}<InfoTip label="About marking underway" text="Use it for a framework that is already running. The journey may start now, the onboarding stays open for editing, and what is missing stays listed. You can approve it later, when everything is done." /></span>
        : words.title}
      subtitle={framework}
      footer={(
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={send.isPending} disabled={!ready} onClick={() => send.mutate()}>{words.action}</Button>
        </div>
      )}
    >
      <div className="space-y-[16px] px-[20px] py-[16px]">
        {decision === 'approve' && (
          <FormField label="Note" optional hint="Kept in the history.">
            <Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          </FormField>
        )}
        {decision === 'underway' && (
          <FormField label="Kind" required error={fieldErrors.kind}>
            <Select placeholder="Choose" value={kind} onChange={(e) => setKind(e.target.value as UnderwayKind | '')}>
              {meta.underway_kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
          </FormField>
        )}
        {needsReason && (
          <FormField label="Reason" required hint={reasonProblem(reason, min) ?? 'Long enough.'} error={fieldErrors.reason}>
            <Textarea rows={4} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus={decision === 'reopen'} />
          </FormField>
        )}
        {problem && (
          <Notice tone="danger" title="Couldn't do that">
            {refusal}
            {problem.checks.length > 0 && <ul className="mt-[4px] list-disc pl-[18px]">{problem.checks.map((c) => <li key={c.key}>{c.label}</li>)}</ul>}
          </Notice>
        )}
      </div>
    </AnimatedModal>
  );
}
