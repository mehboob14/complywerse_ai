'use client';

/**
 * One Cyber Security assessment, from the first click to the questionnaire. It exists as a draft from the moment its subject is chosen; its stages (Scope,
 * People, Plan) are filled in as they become known, by whoever knows them, and save as they go. A readiness panel says what must still be filled before
 * Start, which copies the questions without their answers, keeps the scope and the facts of its assets as they were, and opens the questionnaire (the
 * same tab every assessment of its type has always had) as the last stage.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleDot, Circle, Lock, Play, Trash2 } from 'lucide-react';
import { PageHeading } from '@/components/ui/ds/PageHeading';
import { Button, EmptyState, ErrorState, Notice, ReadOnlyNote, SectionCard, SkeletonLines, StatusPill, useConfirm, useNotify } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import ASVSAssessmentTab from '../ASVSAssessmentTab';
import OwaspTestingTab from '../OwaspTestingTab';
import MobileAppSecurityTab from '../MobileAppSecurityTab';
import MaturityAssessmentTab from '../MaturityAssessmentTab';
import { PeopleStage, PlanStage, ScopeStage, type StageProps } from './ScopeForms';
import { fieldErrors, PHASE_LABEL, PHASE_TONE, stageOfCheck, STAGE_LABEL, STAGES, stageState, TYPE_INFO, unmet, type Stage } from './scopingModel';
import { refreshAssessmentLists, scopingApi, type Scope, type ScopePatch, type ScopeView } from './scopingApi';

const SHELL = 'mx-auto flex max-w-7xl flex-col gap-[16px]';

/** The questionnaire screen of a type, showing one assessment (without an id: the type's questionnaire). A scoped assessment may not upload over its questions: the workbook is the questionnaire's. */
export function QuestionnaireTab({ format, id, allowUpload }: { format: string; id?: number; allowUpload: boolean }) {
  switch (format) {
    case 'asvs_checklist': return <ASVSAssessmentTab assessmentId={id} allowUpload={allowUpload} />;
    case 'owasp_v4_testing_checklist': return <OwaspTestingTab assessmentId={id} allowUpload={allowUpload} />;
    case 'mobile_app_security': return <MobileAppSecurityTab assessmentId={id} allowUpload={allowUpload} />;
    default: return <MaturityAssessmentTab format={format} assessmentId={id} allowUpload={allowUpload} />;
  }
}

function StageRail({ view, current, onPick }: { view: ScopeView; current: Stage; onPick: (s: Stage) => void }) {
  const started = view.phase === 'in_progress';
  return (
    <nav aria-label="Stages of this assessment" className="flex gap-[4px] overflow-x-auto lg:flex-col lg:overflow-visible">
      {STAGES.map((stage) => {
        const state = stageState(view, stage);
        const locked = stage === 'assessment' && !started;
        const on = current === stage;
        const Icon = locked ? Lock : stage === 'assessment' ? CircleDot : state.done ? Check : Circle;
        return (
          <button key={stage} type="button" aria-current={on ? 'step' : undefined} disabled={locked} onClick={() => onPick(stage)}
            aria-label={stage === 'assessment' ? (locked ? `${STAGE_LABEL[stage]}, opens when started` : `${STAGE_LABEL[stage]}, ${view.total_items} questions`) : `${STAGE_LABEL[stage]}${state.missing > 0 ? `, ${state.missing} to do` : ', done'}`}
            className={`flex min-h-ds-control shrink-0 items-center gap-[8px] rounded-ds-control px-[10px] text-left text-ds-body focus-visible:outline-none focus-visible:shadow-ds-ring ${on ? 'bg-ds-primary-soft font-[600] text-ds-primary-text' : 'text-ds-fg-body enabled:hover:bg-ds-surface-hover'} ${locked ? 'text-ds-fg-muted' : ''}`}>
            <Icon aria-hidden className={`h-[16px] w-[16px] shrink-0 ${!locked && state.done && stage !== 'assessment' ? 'text-ds-success' : ''}`} strokeWidth={1.75} />
            <span>{STAGE_LABEL[stage]}</span>
            {stage !== 'assessment' && state.missing > 0 && <span className="ml-auto text-ds-label text-ds-fg-muted">{state.missing} to do</span>}
            {stage === 'assessment' && !locked && <span className="ml-auto text-ds-label text-ds-fg-muted">{view.total_items} questions</span>}
          </button>
        );
      })}
    </nav>
  );
}

function Readiness({ view, onJump, onStart, starting }: { view: ScopeView; onJump: (s: Stage) => void; onStart: () => void; starting: boolean }) {
  const { required, advice } = unmet(view.readiness);
  const done = (view.readiness?.checks ?? []).filter((c) => c.ok).length;
  return (
    <SectionCard id="ready" title="Ready to start?" meta={required.length ? `${required.length} required left` : 'Everything required is filled'}
      info="Starting copies the questions without their answers, keeps this scope and the facts of its assets as they are today, and opens the questionnaire.">
      <ul className="space-y-[6px]">
        {required.map((c) => (
          <li key={c.key}><button type="button" onClick={() => onJump(stageOfCheck(c.key))} className="flex w-full items-start gap-[8px] rounded-ds-control text-left text-ds-body text-ds-danger focus-visible:outline-none focus-visible:shadow-ds-ring"><Circle aria-hidden className="mt-[3px] h-[14px] w-[14px] shrink-0" strokeWidth={2} /><span>{c.label}{c.hint && <span className="block text-ds-label text-ds-fg-muted">{c.hint}</span>}</span></button></li>
        ))}
        {advice.map((c) => (
          <li key={c.key}><button type="button" onClick={() => onJump(stageOfCheck(c.key))} className="flex w-full items-start gap-[8px] rounded-ds-control text-left text-ds-body text-ds-fg-muted focus-visible:outline-none focus-visible:shadow-ds-ring"><Circle aria-hidden className="mt-[3px] h-[14px] w-[14px] shrink-0" strokeWidth={1.5} /><span>{c.label} <span className="text-ds-label">(advised)</span></span></button></li>
        ))}
        {done > 0 && <li className="flex items-center gap-[8px] text-ds-body text-ds-fg-muted"><Check aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-success" strokeWidth={2} />{done} {done === 1 ? 'item' : 'items'} done</li>}
      </ul>
      <Button variant="primary" fullWidth className="mt-[12px]" leftIcon={<Play aria-hidden />} loading={starting} disabled={!view.readiness?.ready} onClick={onStart}>Start assessment</Button>
    </SectionCard>
  );
}

export default function AssessmentWorkspace({ id }: { id: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const view = useQuery({ queryKey: ['scoping', id], queryFn: () => scopingApi.scope(id) });
  const [edits, setEdits] = useState<ScopePatch>({});
  const [stage, setStage] = useState<Stage | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const sent = useRef('');
  const failed = useRef('');                                                    // the edits the server refused: not sent again until they change (or the person says so)
  const opened = useRef<Stage | null>(null);                                    // the stage the page opened on, chosen once from the first answer

  const save = useMutation({
    mutationFn: (patch: ScopePatch) => { sent.current = JSON.stringify(patch); return scopingApi.save(id, patch); },
    onSuccess: (next) => {
      qc.setQueryData(['scoping', id], next);
      setErrors({}); setSaveError(null);
      setEdits((cur) => (JSON.stringify(cur) === sent.current ? {} : cur));        // what was typed while it saved stays, and is saved next
      refreshAssessmentLists(qc);
    },
    onError: (e) => { failed.current = sent.current; setErrors(fieldErrors(e)); setSaveError(errorMessage(e)); },
  });
  const pending = Object.keys(edits).length > 0;
  useEffect(() => {
    if (!pending || save.isPending || JSON.stringify(edits) === failed.current) return;
    const t = setTimeout(() => save.mutate(edits), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, save.isPending]);
  // leaving the page with something typed in the last moment: it is sent as the page goes
  const leaving = useRef({ id, edits });
  leaving.current = { id, edits };
  useEffect(() => () => {
    const { id: at, edits: left } = leaving.current;
    if (Object.keys(left).length > 0) scopingApi.save(at, left).then(() => refreshAssessmentLists(qc)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useMutation({
    mutationFn: async () => { if (pending) await scopingApi.save(id, edits); return scopingApi.start(id); },
    onSuccess: (next) => {
      qc.setQueryData(['scoping', id], next);
      setEdits({}); setStartError(null); setStage('assessment');
      refreshAssessmentLists(qc);
      notify.success(`${next.total_items} questions are open`, { title: 'Assessment started' });
    },
    onError: (e) => { setErrors(fieldErrors(e)); setStartError(errorMessage(e)); void qc.invalidateQueries({ queryKey: ['scoping', id] }); },
  });
  const discard = useMutation({
    mutationFn: () => scopingApi.remove(id),
    onSuccess: () => { refreshAssessmentLists(qc); router.push(back); },
    onError: (e) => notify.error(e, { title: 'Could not discard the draft' }),
  });

  const v = view.data;
  const info = v ? TYPE_INFO[v.assessment_format] : undefined;
  const back = `/cyber-security?tab=${info?.tab ?? ''}`;
  if (view.isLoading) return <div className={SHELL}><SkeletonLines lines={6} label="Loading the assessment" /></div>;
  if (view.isError || !v) {
    const gone = statusOf(view.error) === 404;                                    // deleted (from the questionnaire's own Delete) or never there
    return (
      <div className={SHELL}>
        <ErrorState title={gone ? 'This assessment is gone' : "Couldn't open the assessment"} message={errorMessage(view.error)} onRetry={canRetry(view.error) ? () => { void view.refetch(); } : undefined} />
        {gone && <div className="flex justify-center"><Button href="/cyber-security">Back to Cyber Security</Button></div>}
      </div>
    );
  }

  const started = v.phase === 'in_progress';
  const questionnaire = !v.scope_model;
  if (opened.current === null) opened.current = started ? 'assessment' : STAGES.find((s) => s !== 'assessment' && stageState(v, s).missing > 0) ?? 'scope';
  const current: Stage = stage ?? opened.current;
  const scope: Scope = { ...v.scope, ...(edits.scope ?? {}) };
  const props: StageProps = {
    view: v, scope, errors,
    ownerId: edits.owner_id ?? v.owner?.id ?? null,
    dueDate: 'due_date' in edits ? edits.due_date ?? null : v.due_date,
    onScope: (patch) => setEdits((e) => ({ ...e, scope: { ...(e.scope ?? {}), ...patch } })),
    onOwner: (owner) => setEdits((e) => ({ ...e, owner_id: owner })),
    onDue: (day) => setEdits((e) => ({ ...e, due_date: day })),
  };
  const ask = async () => {
    const yes = await confirm({ title: `Discard the draft “${v.name}”?`, message: 'Nothing was copied yet. The application or function and the scope entered so far are removed.', confirmLabel: 'Discard', tone: 'danger' });
    if (yes) discard.mutate();
  };

  if (questionnaire) {
    return (
      <div className={SHELL}>
        <PageHeading title={v.name} back={{ href: back, label: `Back to ${info?.label ?? 'assessments'}` }} chips={<StatusPill tone="neutral" label="Questionnaire" />} />
        <Notice tone="info" title="This is the questionnaire">The questions of {info?.label ?? 'this type'}, as uploaded. A new assessment is made from it for one {info?.subject ?? 'subject'}; its answers here are not part of those.</Notice>
        <QuestionnaireTab format={v.assessment_format} id={v.id} allowUpload />
        {confirmDialog}
      </div>
    );
  }

  return (
    <div className={SHELL}>
      <PageHeading title={v.name} back={{ href: back, label: `Back to ${info?.label ?? 'assessments'}` }}
        meta={v.phase === 'scoping' ? (save.isPending ? 'Saving…' : pending ? 'Unsaved changes' : 'Saved') : v.started_at ? `Started ${v.started_at.slice(0, 10)}` : undefined}
        chips={<><StatusPill tone={PHASE_TONE[v.phase ?? 'scoping']} label={PHASE_LABEL[v.phase ?? 'scoping']} /><StatusPill tone="neutral" label={v.family === 'process' ? 'Function or process' : 'Application'} /></>}
        actions={!started ? (
          <>
            <Button leftIcon={<Trash2 aria-hidden />} loading={discard.isPending} onClick={() => void ask()}>Discard draft</Button>
            {/* where the readiness card sits under the form (below xl), the way to start is up here too */}
            <Button variant="primary" className="xl:hidden" leftIcon={<Play aria-hidden />} loading={start.isPending} disabled={!v.readiness?.ready} onClick={() => start.mutate()}>Start assessment</Button>
          </>
        ) : undefined} />
      {saveError && (
        <Notice tone="danger" title="Couldn't save the last change" action={<Button size="sm" loading={save.isPending} onClick={() => { failed.current = ''; save.mutate(edits); }}>Try again</Button>}>{saveError}</Notice>
      )}
      {startError && <Notice tone="danger" title="Couldn't start">{startError}</Notice>}
      {v.subject_summary && started && <Notice tone="info" title="What this assessment is of">{v.subject_summary}</Notice>}
      <div className="grid gap-[16px] lg:grid-cols-[13rem_minmax(0,1fr)]">
        <StageRail view={v} current={current} onPick={setStage} />
        <div className={`grid min-w-0 gap-[16px] ${started || current === 'assessment' ? '' : 'xl:grid-cols-[minmax(0,1fr)_19rem]'}`}>
          <div className="min-w-0">
            {started && (current === 'scope' || current === 'plan') && (
              <div className="mb-[12px]">
                <ReadOnlyNote>Fixed since the start <InfoTip label="What can still change" text="The subject, level, period, exclusions and test rules were agreed before the questions opened, so they are shown as they were. Who takes part, the notes and the evidence plan can still change." /></ReadOnlyNote>
              </div>
            )}
            {current === 'scope' && <ScopeStage {...props} />}
            {current === 'people' && <PeopleStage {...props} />}
            {current === 'plan' && <PlanStage {...props} />}
            {current === 'assessment' && (started
              ? <QuestionnaireTab format={v.assessment_format} id={v.id} allowUpload={false} />
              : <EmptyState kind="firstUse" title="The questions open when you start" description="Fill the scope and the people, then press Start assessment." bare />)}
          </div>
          {!started && current !== 'assessment' && <aside className="min-w-0"><Readiness view={v} onJump={setStage} onStart={() => start.mutate()} starting={start.isPending} /></aside>}
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
