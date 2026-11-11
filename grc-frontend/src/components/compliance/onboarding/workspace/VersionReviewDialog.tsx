'use client';

/**
 * The review of a framework change, in one dialog: what changed (the server's words), what it affects (the answers and decisions that are stale and why, the
 * new questions, the controls, the programs and the work on them), then the decision (still correct, reopen to change, start for the later entry) and why.
 * Looking changes nothing; the decision is recorded and never edits an answer, the approved snapshot, an assessment or evidence. The server decides who may
 * take each decision (confirming is an approval, reopening is the override right, starting a draft is editing) and says which right is missing.
 */
import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, FormField, Notice, Textarea } from '@/components/ui/ds';
import { onboardingApi, problemOf, type OnboardingView, type Register, type VersionControl, type VersionOutcome, type VersionReviewResult } from '@/lib/frameworkOnboarding';
import { countsSentence, jumpFor, journeyImpact, MIN_NOTE, noteProblem, OUTCOME_DONE, outcomesOf, reviewRefusal, staleByStep } from './versionModel';

const HEAD = 'text-ds-label font-[600] text-ds-fg';
const MUTED = 'text-ds-label text-ds-fg-muted';
const JUMP = 'min-w-0 break-words rounded-ds-control text-left text-ds-body font-[600] text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring';
const ACTION: Record<VersionOutcome, string> = { confirmed: 'Record', changes_needed: 'Reopen', start_new_version: 'Start' };

function Section({ title, info, children }: { title: string; info?: string; children: ReactNode }) {
  return (
    <section className="space-y-[8px]">
      <h3 className="flex items-center gap-[6px] text-ds-body font-[600] text-ds-fg">{title}{info && <InfoTip text={info} label={`About ${title.toLowerCase()}`} />}</h3>
      {children}
    </section>
  );
}

function ControlList({ title, items }: { title: string; items: readonly VersionControl[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-[4px]">
      <p className={HEAD}>{title}</p>
      <ul className="list-disc space-y-[2px] pl-[18px] text-ds-body text-ds-fg-body">
        {items.map((c, i) => <li key={`${c.reference}-${i}`} className="break-words">{c.reference}{c.title ? `: ${c.title}` : ''}</li>)}
      </ul>
    </div>
  );
}

export default function VersionReviewDialog({ id, view, meta, steps, flush, onClose, onJump, onDone }: {
  id: number;
  view: OnboardingView;
  meta: Register['meta'] | undefined;
  steps: ReadonlyArray<{ key: string }>;
  /** saves what was typed in the last moment, so the review is made on the answers the person sees */
  flush: () => Promise<unknown>;
  onClose: () => void;
  /** opens a step (and a field of it; '' for the step itself) and the dialog goes away */
  onJump: (stage: string, field: string) => void;
  onDone: (result: VersionReviewResult, message: string) => void;
}) {
  const v = view.version;
  const outcomes = outcomesOf(view);
  const min = meta?.min_review_note ?? MIN_NOTE;
  const [outcome, setOutcome] = useState<VersionOutcome | ''>('');
  const [note, setNote] = useState('');
  const group = useId();
  const legend = `${group}-legend`;

  const send = useMutation({
    mutationFn: async () => { await flush(); return onboardingApi.versionReview(id, outcome as VersionOutcome, note.trim()); },
    onSuccess: (result) => onDone(result, OUTCOME_DONE[outcome as VersionOutcome]),
  });
  const problem = send.error ? problemOf(send.error) : null;
  const ready = outcome !== '' && noteProblem(note, min) === null;
  const go = (stage: string, field: string) => { onClose(); onJump(stage, field); };
  const counts = countsSentence(v);
  const groups = staleByStep(v.stale.answers);
  const ctl = v.controls;
  const ctlTotal = ctl.added + ctl.removed + ctl.changed;
  const impact = v.impact;

  return (
    <AnimatedModal
      isOpen onClose={onClose} size="xl" dirty={note.trim() !== ''}
      title="Review changes" subtitle={view.framework.label || view.framework.name || undefined}
      footer={(
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={send.isPending} disabled={!ready} onClick={() => send.mutate()}>{outcome ? ACTION[outcome] : 'Record'}</Button>
        </div>
      )}
    >
      <div className="space-y-[20px] px-[20px] py-[16px]">
        <Section title="What changed">
          <ul className="list-disc space-y-[2px] pl-[18px] text-ds-body text-ds-fg-body">{v.reasons.map((r) => <li key={r.code} className="break-words">{r.text}</li>)}</ul>
          <p className={MUTED}>
            {counts ? `It affects ${counts}. ` : ''}Nothing was changed: the approved answers, the approval and the work on the framework are as they were.
          </p>
        </Section>

        {groups.length > 0 && (
          <Section title="Answers to look at" info="Each answer was right for the version this was approved under. It may not fit the questions now asked.">
            <div className="space-y-[12px]">
              {groups.map((g) => (
                <div key={g.step} className="space-y-[4px]">
                  <p className={HEAD}>{g.label}</p>
                  <ul className="space-y-[6px]">
                    {g.items.map((a) => {
                      const jump = jumpFor(a, steps);
                      return (
                        <li key={a.ref} className="min-w-0">
                          {jump ? <button type="button" onClick={() => go(jump.stage, jump.field)} className={JUMP}>{a.label}</button> : <span className="break-words text-ds-body font-[600] text-ds-fg">{a.label}</span>}
                          <span className={MUTED}>{a.answer ? `: ${a.answer}` : ''}</span>
                          <ul className="list-disc pl-[18px] text-ds-body text-ds-fg-body">{a.reasons.map((r) => <li key={r.code} className="break-words">{r.text}</li>)}</ul>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        )}

        {v.stale.decisions.length > 0 && (
          <Section title="Decisions to confirm" info="A decision is an answer that other questions depend on, such as where the framework applies, or the version in use.">
            <ul className="space-y-[10px]">
              {v.stale.decisions.map((d) => (
                <li key={d.ref} className="min-w-0">
                  <span className="break-words text-ds-body font-[600] text-ds-fg">{d.label}</span>
                  <span className={MUTED}>{d.answer ? `: ${d.answer}` : ''}</span>
                  <ul className="list-disc pl-[18px] text-ds-body text-ds-fg-body">
                    {d.reasons.map((r) => <li key={r.code} className="break-words">{r.text}</li>)}
                    {d.affects.map((a) => <li key={a.ref} className="break-words">{a.now === 'asked' ? 'Now asked' : 'No longer asked'}: {a.label}{a.now === 'not asked' && a.answered ? ' (it has an answer)' : ''}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {v.stale.new_questions.length > 0 && (
          <Section title="New questions">
            <ul className="space-y-[6px]">
              {v.stale.new_questions.map((q) => {
                const jump = jumpFor({ ref: q.ref, step: q.step, reasons: [] }, steps);
                return (
                  <li key={q.ref} className="min-w-0">
                    {jump ? <button type="button" onClick={() => go(jump.stage, jump.field)} className={JUMP}>{q.label}</button> : <span className="break-words text-ds-body font-[600] text-ds-fg">{q.label}</span>}
                    <span className={MUTED}>{` (${q.level}, ${q.step_label}). ${q.why}`}</span>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {v.stale.gate.length > 0 && (
          <Section title="Checks">
            <ul className="list-disc space-y-[2px] pl-[18px] text-ds-body text-ds-fg-body">{v.stale.gate.map((g) => <li key={g.label} className="break-words">{g.label}: {g.text}</li>)}</ul>
          </Section>
        )}

        {ctlTotal > 0 && (
          <Section title="Controls">
            <p className="text-ds-body text-ds-fg-body">{[ctl.added && `${ctl.added} added`, ctl.removed && `${ctl.removed} removed`, ctl.changed && `${ctl.changed} reworded`].filter(Boolean).join(', ')}.</p>
            <ControlList title="Added" items={ctl.sample.added} />
            <ControlList title="Removed" items={ctl.sample.removed} />
            <ControlList title="Reworded" items={ctl.sample.changed} />
          </Section>
        )}

        {impact && (
          <Section title="Programs and work" info="Only listed here. A change to the framework never changes an assessment, a status or evidence.">
            {impact.journeys.length === 0 ? <p className="text-ds-body text-ds-fg-body">No journey runs on this framework yet.</p> : (
              <ul className="space-y-[6px]">
                {impact.journeys.map((j) => (
                  <li key={j.id} className="min-w-0 text-ds-body text-ds-fg-body">
                    <Link href={`/frameworks/${j.id}`} className={JUMP}>{j.name}</Link>{` ${journeyImpact(j)}.`}
                  </li>
                ))}
              </ul>
            )}
            <p className={MUTED}>
              Kept as they were: {impact.kept.snapshots} compliance {impact.kept.snapshots === 1 ? 'snapshot' : 'snapshots'} and {impact.kept.evidence_files} evidence {impact.kept.evidence_files === 1 ? 'file' : 'files'}.
            </p>
          </Section>
        )}

        <fieldset aria-labelledby={legend} className="min-w-0 space-y-[8px] border-0 p-0">
          <legend id={legend} className="mb-[4px] p-0 text-ds-body font-[600] text-ds-fg">What do you want to do?</legend>
          <div role="radiogroup" aria-labelledby={legend} className="grid gap-[8px]">
            {outcomes.map((o) => (
              <label key={o.value} className="relative block cursor-pointer">
                <input type="radio" name={group} value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value)} className="peer sr-only" />
                <span className="flex min-w-0 flex-col rounded-ds-control border border-ds-border-strong bg-ds-surface px-[12px] py-[8px] hover:bg-ds-surface-hover peer-checked:border-ds-primary peer-checked:bg-ds-primary-soft peer-focus-visible:shadow-ds-ring">
                  <span className="text-ds-body font-[600] text-ds-fg">{o.label}</span>
                  <span className="text-ds-label text-ds-fg-muted">{o.text}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <FormField label="Why" required hint={noteProblem(note, min) ?? 'Long enough. It is kept in the history.'}>
          <Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>

        <div aria-live="polite">
          {problem && (
            <Notice tone="danger" title="Couldn't record it">
              {reviewRefusal(outcome, problem)}
            </Notice>
          )}
        </div>
      </div>
    </AnimatedModal>
  );
}
