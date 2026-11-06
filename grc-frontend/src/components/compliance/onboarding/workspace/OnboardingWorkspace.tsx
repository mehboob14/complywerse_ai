'use client';

/**
 * One framework's onboarding, from the first answer to the approval. It exists as a draft from the moment it is started; its stages (the framework's steps,
 * then Review) are filled in as the answers become known and save as they go: the page waits a moment after the last change, sends it, and stops when the
 * server refuses it (the field says why, "Try again" sends it again); what is still typed when the person leaves is sent as the page goes. Review lists what
 * is open and holds the decisions: Submit, Approve, Reopen, Mark underway. An approved onboarding is locked until it is reopened.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { PageHeading } from '@/components/ui/ds/PageHeading';
import { Button, ErrorState, Notice, ReadOnlyNote, SectionCard, SkeletonLines, StatusPill, useAddressState, useNotify } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { text } from '@/lib/addressState';
import { formatDate } from '@/lib/format';
import { onboardingApi, ONBOARDING_KEYS, problemOf, refreshOnboarding, STATE_LABEL, type OnboardingView, type Problem, type Refs, type Register, type Step } from '@/lib/frameworkOnboarding';
import { FRAMEWORK_FLOWS } from '@/app/(dashboard)/frameworks/[id]/_data/frameworkFlows';
import { journeyWords, STATE_TONE } from '../register/registerModel';
import AiPanel from './AiPanel';
import DecisionDialog, { type Decision } from './DecisionDialog';
import ReviewStage from './ReviewStage';
import StageStrip, { panelId, tabId } from './StageStrip';
import StepFields, { fieldBoxId, type FieldContext } from './StepFields';
import {
  actionRefusal, actionsOf, aiKindsAfter, bannerOf, editsByStep, errorsByField, fieldRef, isLockedRefusal, labelOfRef, mergeRefs, needsDepartments, neighbours, openingStage,
  refusalLines, resolveStage, REVIEW, stageCount, stagesOf, valueOf, type AiChange, type Edits,
} from './workspaceModel';

const SHELL = 'mx-auto flex max-w-7xl flex-col gap-[16px]';
const SCHEMA = { step: text() };
const EMPTY_REFS: Refs = { users: {}, assets: {}, vendors: {}, departments: {} };
/** Until the register has answered, the dialogs use the server's own limits (the server checks them again). */
const FALLBACK_META: Register['meta'] = {
  underway_kinds: ['Running before onboarding existed', 'Certified or attested outside the platform', 'Regulator-mandated start', 'Other'],
  min_underway_reason: 20, min_reopen_reason: 10,
};

interface SaveProblem { message: string; lines: string[]; locked: boolean }

export default function OnboardingWorkspace({ id }: { id: number }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const key = ONBOARDING_KEYS.detail(id);
  const view = useQuery({ queryKey: key, queryFn: () => onboardingApi.detail(id) });
  const register = useQuery({ queryKey: ONBOARDING_KEYS.register, queryFn: onboardingApi.register, staleTime: 60_000 });
  const v = view.data;
  const profile = useQuery({ queryKey: ONBOARDING_KEYS.profile, queryFn: onboardingApi.profile, enabled: !!v && needsDepartments(v.steps) });
  const [address, setAddress] = useAddressState(SCHEMA);
  const [edits, setEdits] = useState<Edits>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveProblem, setSaveProblem] = useState<SaveProblem | null>(null);
  const [extraRefs, setExtraRefs] = useState<Partial<Refs>>({});
  const [dialog, setDialog] = useState<Decision | null>(null);
  const tabsBase = useId();
  const sent = useRef('');
  const failed = useRef('');                                                    // the edits the server refused: not sent again until they change (or the person says so)
  const opened = useRef<string | null>(null);                                   // the stage the page opened on, chosen once from the first answer
  const focusAfter = useRef<{ stage: string; field: string | null } | null>(null);
  const stepsRef = useRef<Step[]>([]);
  stepsRef.current = v?.steps ?? [];
  const locked = v?.locked ?? false;

  const save = useMutation({
    mutationFn: async (payload: Edits) => {
      sent.current = JSON.stringify(payload);
      let last: OnboardingView | null = null;
      for (const [step, values] of Object.entries(editsByStep(payload))) last = await onboardingApi.saveAnswers(id, step, values);
      return last as OnboardingView;
    },
    onSuccess: (next) => {
      qc.setQueryData(key, next);
      setErrors({}); setSaveProblem(null);
      setEdits((cur) => (JSON.stringify(cur) === sent.current ? {} : cur));        // what was typed while it saved stays, and is saved next
      void qc.invalidateQueries({ queryKey: ONBOARDING_KEYS.register });
    },
    onError: (e) => {
      failed.current = sent.current;
      const p = problemOf(e);
      setErrors(errorsByField(p));
      if (isLockedRefusal(p)) {                                                   // approved by someone meanwhile: nothing more can be saved
        setEdits({});
        void qc.invalidateQueries({ queryKey: key });
        setSaveProblem({ message: p.message, lines: [], locked: true });
      } else {
        setSaveProblem({ message: actionRefusal('edit', p), lines: refusalLines(p, (ref) => labelOfRef(ref, stepsRef.current)), locked: false });
      }
    },
  });
  const pending = Object.keys(edits).length > 0;
  useEffect(() => {
    if (!pending || save.isPending || locked || JSON.stringify(edits) === failed.current) return;
    const t = setTimeout(() => save.mutate(edits), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, save.isPending, locked]);
  // leaving the page with something typed in the last moment: it is sent as the page goes
  const leaving = useRef({ id, edits });
  leaving.current = { id, edits };
  useEffect(() => () => {
    const { id: at, edits: left } = leaving.current;
    const steps = editsByStep(left);
    if (Object.keys(steps).length === 0) return;
    void (async () => {
      try { for (const [step, values] of Object.entries(steps)) await onboardingApi.saveAnswers(at, step, values); void qc.invalidateQueries({ queryKey: ONBOARDING_KEYS.register }); } catch { /* the person has left: nothing to tell */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = async () => { if (Object.keys(edits).length > 0) await save.mutateAsync(edits); };
  const done = (next: OnboardingView, message: string) => { qc.setQueryData(key, next); refreshOnboarding(qc); notify.success(message); };
  const submit = useMutation({
    mutationFn: async () => { await flush(); return onboardingApi.submit(id); },
    onSuccess: (next) => done(next, 'Submitted. It waits for approval.'),
  });
  const submitProblem: Problem | null = submit.error ? problemOf(submit.error) : null;

  const stages = useMemo(() => (v ? stagesOf(v.steps) : []), [v]);
  if (v && opened.current === null) opened.current = openingStage(stages, v.readiness);
  const current = v ? resolveStage(stages, address.step, opened.current ?? REVIEW) : REVIEW;
  // a field (or the top of a stage) comes into view and takes focus: after Next, Back or a jump from a check
  const focusTarget = (stage: string, field: string | null) => {
    const target = field ? document.getElementById(fieldBoxId(tabsBase, stage, field)) : document.getElementById(panelId(tabsBase, stage));
    if (!target) return;
    target.scrollIntoView({ block: field ? 'center' : 'start' });
    (field ? target.querySelector<HTMLElement>('input, select, textarea, button, [tabindex="0"]') ?? target : target).focus({ preventScroll: true });
  };
  const pickStage = (stage: string) => setAddress({ step: stage });                // a tab: focus stays on the tab
  const goStage = (stage: string, to: string | null = null) => {
    const field = to || null;                           // '' = the stage itself
    if (stage === current) { focusTarget(stage, field); return; }
    focusAfter.current = { stage, field };
    setAddress({ step: stage });
  };
  useEffect(() => {
    const f = focusAfter.current;
    if (!f || f.stage !== current) return;
    focusAfter.current = null;
    focusTarget(f.stage, f.field);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (view.isLoading) return <div className={SHELL}><SkeletonLines lines={6} label="Loading the onboarding" /></div>;
  if (view.isError || !v) {
    const gone = statusOf(view.error) === 404;                                    // never there, or in another organisation
    return (
      <div className={SHELL}>
        <ErrorState title={gone ? 'This onboarding is gone' : "Couldn't open the onboarding"} message={errorMessage(view.error)} onRetry={canRetry(view.error) ? () => { void view.refetch(); } : undefined} />
        <div className="flex justify-center"><Button href="/frameworks/onboarding">Back to onboarding</Button></div>
      </div>
    );
  }

  const change = (step: string, field: string, value: unknown) => {
    const ref = fieldRef(step, field);
    setEdits((e) => ({ ...e, [ref]: value }));
    setErrors((e) => { if (!(ref in e)) return e; const rest = { ...e }; delete rest[ref]; return rest; });
  };
  const applyAi = (c: AiChange) => change(c.step, c.field, c.value);
  const retry = () => { failed.current = ''; save.mutate(edits); };

  const ctx: FieldContext = {
    refs: mergeRefs(v.refs, extraRefs),
    onRefs: (patch) => setExtraRefs((cur) => mergeRefs(mergeRefs(EMPTY_REFS, cur), patch)),
    orgRows: v.org_rows,
    departments: profile.data?.departments ?? [],
    readOnly: locked,
  };
  const title = v.framework.label || v.framework.name || 'Framework';
  const actions = actionsOf(v.state, v.readiness);
  const banner = bannerOf(v, (iso) => (iso ? formatDate(iso) : ''));
  const phaseOne = v.framework.flow_id ? FRAMEWORK_FLOWS.find((f) => f.id === v.framework.flow_id)?.phases[0]?.name : undefined;
  const step = v.steps.find((s) => s.key === current);
  const { prev, next } = neighbours(stages, current);
  const aiAfter = (stepKey: string) => (fieldKey: string): ReactNode => (locked ? null : aiKindsAfter(v.steps, stepKey, fieldKey).map((k) => (
    <AiPanel key={k} id={id} kind={k} current={valueOf(v.answers, edits, stepKey, fieldKey)} steps={v.steps} onAccept={applyAi} onJump={goStage} />
  )));

  return (
    <div className={SHELL}>
      <PageHeading
        title={title} info={v.framework.summary ?? undefined}
        back={{ href: '/frameworks/onboarding', label: 'Back to onboarding' }}
        meta={locked ? <ReadOnlyNote>Locked <InfoTip label="Why it is locked" text="It is approved. Reopen it to change an answer." /></ReadOnlyNote> : <span role="status" aria-live="polite">{save.isPending ? 'Saving…' : pending ? 'Unsaved changes' : 'Saved'}</span>}
        chips={<><StatusPill tone={STATE_TONE[v.state]} label={STATE_LABEL[v.state]} />{v.framework.family_label && <StatusPill tone="neutral" label={v.framework.family_label} />}</>}
      />
      {(v.journey || phaseOne) && (
        <p className="text-ds-label text-ds-fg-muted">
          {v.journey
            ? <>Journey: {journeyWords(v.journey)}. <Link href={`/frameworks/${v.journey.id}`} className="text-ds-primary-text underline focus-visible:outline-none focus-visible:shadow-ds-ring">Open the journey</Link></>
            : <>Journey starts at: {phaseOne}</>}
        </p>
      )}
      {banner && (
        <Notice tone={banner.tone} role="status" title={banner.title}
          action={banner.action === 'reopen' ? <Button size="sm" onClick={() => setDialog('reopen')}>Reopen</Button> : banner.action === 'review' ? <Button size="sm" onClick={() => goStage(REVIEW)}>Review</Button> : undefined}>
          {banner.text}
        </Notice>
      )}
      {saveProblem && (
        <Notice tone="danger" title={saveProblem.locked ? 'Approved and locked' : "Couldn't save the last change"}
          action={saveProblem.locked ? undefined : <Button size="sm" loading={save.isPending} onClick={retry}>Try again</Button>}>
          {saveProblem.message}
          {saveProblem.lines.length > 0 && <ul className="mt-[4px] list-disc pl-[18px]">{saveProblem.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
        </Notice>
      )}
      <StageStrip base={tabsBase} stages={stages} readiness={v.readiness} current={current} onPick={pickStage} />
      <div role="tabpanel" id={panelId(tabsBase, current)} aria-labelledby={tabId(tabsBase, current)} tabIndex={0} className="min-w-0 focus-visible:outline-none focus-visible:shadow-ds-ring">
        {step ? (
          <SectionCard id={`step-${step.key}`} title={step.label} meta={stageCount(v.readiness, step.key).words}>
            <StepFields step={step} view={v} edits={edits} errors={errors} ctx={ctx} base={tabsBase} onChange={change} after={aiAfter(step.key)} />
            <div className="mt-[20px] flex flex-wrap items-center justify-between gap-[8px]">
              <div>{prev && <Button onClick={() => goStage(prev.key)}>Back: {prev.label}</Button>}</div>
              {next && <Button variant="primary" rightIcon={<ArrowRight aria-hidden />} onClick={() => goStage(next.key)}>Next: {next.label}</Button>}
            </div>
          </SectionCard>
        ) : (
          <ReviewStage
            view={v} stages={stages} actions={actions} submitting={submit.isPending} submitProblem={submitProblem}
            onSubmit={() => submit.mutate()} onDecision={setDialog} onJump={goStage}
            gapReview={locked ? null : (
              <SectionCard id="gaps" title="Gap review" info="AI reads the draft the way an auditor would and lists what they would ask next. It never changes an answer.">
                <AiPanel id={id} kind="gap_review" current={null} steps={v.steps} onAccept={applyAi} onJump={goStage} />
              </SectionCard>
            )}
          />
        )}
      </div>
      {dialog && (
        <DecisionDialog
          id={id} decision={dialog} framework={title} meta={register.data?.meta ?? FALLBACK_META} flush={flush}
          onClose={() => setDialog(null)} onDone={(next, message) => { done(next, message); setDialog(null); }}
        />
      )}
    </div>
  );
}
