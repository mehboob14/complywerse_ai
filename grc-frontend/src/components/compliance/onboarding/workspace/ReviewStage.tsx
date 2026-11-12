'use client';

/**
 * The last stage: what is still open (required first, advice after, each put right where it is filled), the decision buttons the state allows and why one
 * is off, the AI gap review, and the history in plain words. The rules (what is required, what is ready) are the server's; this lists its answer.
 */
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Check, Circle } from 'lucide-react';
import { Button, Notice, SectionCard } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { formatRelative } from '@/lib/format';
import type { Check as ReadinessCheck, OnboardingView, Problem } from '@/lib/frameworkOnboarding';
import { actionRefusal, eventSentence, jumpOf, openCount, splitChecks, type Actions, type Stage } from './workspaceModel';
import type { Decision } from './DecisionDialog';

const HEAD = 'text-ds-label font-[600] text-ds-fg';
const ROW = 'flex w-full items-start gap-[8px] rounded-ds-control text-left text-ds-body focus-visible:outline-none focus-visible:shadow-ds-ring';

function CheckRow({ check, stages, onJump }: { check: ReadinessCheck; stages: readonly Stage[]; onJump: (stage: string, field: string) => void }) {
  const jump = jumpOf(check, stages);
  const tone = check.required ? 'text-ds-danger' : 'text-ds-fg-muted';
  const inline = check.hint && check.kind !== 'field';                                 // a field's help is its note: behind an (i); a rule's or the profile's hint is what to do
  const body = (
    <>
      <Circle aria-hidden className="mt-[3px] h-[14px] w-[14px] shrink-0" strokeWidth={check.required ? 2 : 1.5} />
      <span className="min-w-0 break-words">{check.label}{inline && <span className="block text-ds-label text-ds-fg-muted">{check.hint}</span>}</span>
    </>
  );
  return (
    <li className="flex items-start gap-[4px]">
      {jump.kind === 'field' && <button type="button" onClick={() => onJump(jump.stage, jump.field)} className={`${ROW} ${tone}`}>{body}</button>}
      {jump.kind === 'stage' && <button type="button" onClick={() => onJump(jump.stage, '')} className={`${ROW} ${tone}`}>{body}</button>}
      {jump.kind === 'none' && <div className={`${ROW} ${tone}`}>{body}</div>}
      {check.kind === 'field' && check.hint && <InfoTip text={check.hint} label={`About ${check.label.toLowerCase()}`} />}
    </li>
  );
}

function CheckGroup({ title, checks, stages, onJump }: { title: string; checks: readonly ReadinessCheck[]; stages: readonly Stage[]; onJump: (stage: string, field: string) => void }) {
  const { required, advice, done } = splitChecks(checks);
  return (
    <div className="flex flex-col gap-[6px]">
      <p className={HEAD}>{title}</p>
      {required.length > 0 && <p className="text-ds-label text-ds-fg-muted">Required: {required.length} open</p>}
      <ul className="space-y-[6px]">{required.map((c) => <CheckRow key={c.key} check={c} stages={stages} onJump={onJump} />)}</ul>
      {advice.length > 0 && <p className="mt-[4px] text-ds-label text-ds-fg-muted">Advised</p>}
      <ul className="space-y-[6px]">{advice.map((c) => <CheckRow key={c.key} check={c} stages={stages} onJump={onJump} />)}</ul>
      {done.length > 0 && (
        <p className="flex items-center gap-[8px] text-ds-body text-ds-fg-muted"><Check aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-success" strokeWidth={2} />{done.length} done</p>
      )}
      {checks.length === 0 && <p className="text-ds-body text-ds-fg-muted">Nothing is asked here.</p>}
    </div>
  );
}

function History({ view }: { view: OnboardingView }) {
  const [all, setAll] = useState(false);
  const stepLabel = (key: string) => view.steps.find((s) => s.key === key)?.label ?? null;
  const events = all ? view.events : view.events.slice(0, 8);
  return (
    <SectionCard id="history" title="History" meta={view.events.length > 0 ? `${view.events.length} ${view.events.length === 1 ? 'event' : 'events'}` : undefined}>
      {view.events.length === 0 ? <p className="text-ds-body text-ds-fg-muted">Nothing has happened yet.</p> : (
        <ol className="space-y-[8px]">
          {events.map((e, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-[12px]">
              <span className="min-w-0 break-words text-ds-body text-ds-fg-body">{eventSentence(e, stepLabel)}</span>
              <span className="shrink-0 text-ds-label text-ds-fg-muted">{formatRelative(e.at)}</span>
            </li>
          ))}
        </ol>
      )}
      {view.events.length > 8 && <Button size="sm" className="mt-[10px]" onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all ${view.events.length}`}</Button>}
    </SectionCard>
  );
}

const LABEL: Record<'submit' | Decision, string> = { submit: 'Submit for approval', approve: 'Approve', reopen: 'Reopen', underway: 'Mark underway' };
const PRIMARY: ReadonlyArray<'submit' | Decision> = ['submit', 'approve'];

export default function ReviewStage({ view, stages, actions, submitting, submitProblem, onSubmit, onDecision, onJump, gapReview, programme }: {
  view: OnboardingView;
  stages: readonly Stage[];
  actions: Actions;
  submitting: boolean;
  submitProblem: Problem | null;
  onSubmit: () => void;
  onDecision: (d: Decision) => void;
  onJump: (stage: string, field: string) => void;
  /** the AI gap review, when the page may change answers */
  gapReview: ReactNode;
  /** the compliance programme card (an approved or underway onboarding starts it); null before that */
  programme?: ReactNode;
}) {
  const r = view.readiness;
  const open = openCount(r);
  const buttons = (['submit', 'approve', 'reopen', 'underway'] as const).filter((k) => actions[k].shown);
  return (
    <div className="grid min-w-0 gap-[16px] xl:grid-cols-[minmax(0,1fr)_22rem]">
      {programme}
      <SectionCard
        id="readiness" title="Readiness" meta={open > 0 ? `${open} required open` : 'Everything required is in'}
        info="Required items hold the onboarding back; advice does not. Each item takes you to where it is filled."
      >
        <div className="flex flex-col gap-[16px]">
          <CheckGroup title="This framework" checks={r.checks} stages={stages} onJump={onJump} />
        </div>
      </SectionCard>

      <aside className={`flex min-w-0 flex-col gap-[16px] xl:col-start-2 xl:row-start-1 ${programme ? 'xl:row-span-3' : 'xl:row-span-2'}`}>
        <SectionCard
          id="decision" title="Decision"
          info="Submit when everything required is in. Approving locks the answers and lets the journey start; it needs the approve right. Mark underway is for a framework that is already running."
        >
          <div className="flex flex-col gap-[10px]">
            {buttons.map((k) => {
              const a = actions[k];
              const why = `decision-${k}-why`;
              return (
                <div key={k} className="flex flex-col gap-[4px]">
                  <Button
                    variant={PRIMARY.includes(k) ? 'primary' : 'secondary'} fullWidth disabled={!a.enabled} aria-describedby={a.reason ? why : undefined}
                    loading={k === 'submit' && submitting} onClick={() => (k === 'submit' ? onSubmit() : onDecision(k))}
                  >{LABEL[k]}</Button>
                  {a.reason && <p id={why} className="text-ds-label text-ds-fg-muted">{a.reason}</p>}
                </div>
              );
            })}
            {buttons.length === 0 && <p className="text-ds-body text-ds-fg-muted">Nothing to decide.</p>}
            {view.reopened_count > 0 && <p className="text-ds-label text-ds-fg-muted">Reopened {view.reopened_count} {view.reopened_count === 1 ? 'time' : 'times'}.</p>}
            {submitProblem && (
              <Notice tone="danger" title="Couldn't submit">
                {actionRefusal('submit', submitProblem)}
                {submitProblem.checks.length > 0 && <ul className="mt-[4px] list-disc pl-[18px]">{submitProblem.checks.map((c) => <li key={c.key}>{c.label}</li>)}</ul>}
              </Notice>
            )}
          </div>
        </SectionCard>
        {gapReview}
      </aside>

      <History view={view} />
    </div>
  );
}
