'use client';

export const dynamic = 'force-dynamic';

// RCSA > a unit (one business unit's self-assessment in one campaign): the form the assessor completes and the screen the reviewer decides on, ONE page for both.
//   assessor   opening an own unit that has not started starts it (no Start button, no key to look for); the questions are a table with the controls in the row; every change is saved
//              as it is made ("Saved 14:02" is the server's word, not a guess); Submit lists what is still empty and goes through a plain question; after it the form is read only.
//   reviewer   the same table read only with the answers that need a look first; a sticky bar to Approve, Send back (a comment is required) or Reject (says it closes the unit); the trail.
//   anyone     the unit's status in words, what happens next, the findings raised on it, the history.
// Contract: answers are saved under the field names the API stores (lib/rcsa/answers.savePayload) — the old form sent other names and nothing was kept. Rules of what each state offers:
// lib/rcsa/rules.ts (the server's state machine, never widened). Requests: the unit's detail, its findings, and the writes (start, save, submit, approve / return / reject, evidence).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Flag, RotateCw, Send, XCircle } from 'lucide-react';
import { rcsaApi } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import {
  Button, ErrorState, Notice, ProgressBar, ReadOnlyNote, SectionCard, SegmentedControl, Select, Skeleton, SkeletonRows, StatusPill, useConfirm, useNotify, useReportedMutation,
} from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate, formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { assessmentStatus, findingSeverity, findingStatus } from '@/lib/statuses/rcsa';
import { answerFromServer, completion, needsLook, sections, sortedQuestions, type Answer, type Question, type ServerAnswer } from '@/lib/rcsa/answers';
import { canEdit, canStart, decisionDone, decisions, inReview, readOnlyReason, standing, submitAsk, type Decision } from '@/lib/rcsa/rules';
import { riskText, controlText } from '@/lib/rcsa/scores';
import { DecisionSheet } from '../../_parts/DecisionSheet';
import { FindingSheet } from '../../_parts/FindingSheet';
import { KEYS, useRcsaRights } from '../../_parts/rcsaData';
import { NoRcsaAccess } from '../../_parts/NoRcsaAccess';
import { QuestionRow } from './_parts/QuestionRow';
import { ReviewTrail, type Step } from './_parts/ReviewTrail';
import { useAnswers } from './_parts/useAnswers';
import type { EvidenceFile } from './_parts/EvidenceCell';

interface Detail {
  id: number; campaign_id: number; campaign_name: string | null; business_unit: string | null; business_unit_id: number | null; assessor_name: string | null; assessor_id: number | null;
  status: string; due_date: string | null; template_name: string | null; campaign_status: string | null; current_approval_tier: number; total_tiers: number;
  submitted_at: string | null; completed_at: string | null; overall_risk_score: number | null; overall_control_score: number | null;
  questions: Question[]; responses: ServerAnswer[]; approval_history: Step[]; viewer_may_review: boolean; viewer_is_assessor: boolean;
}
interface Finding { id: number; title: string; severity: string; status: string; assessment_id: number }

export default function UnitPage() {
  const params = useParams();
  const raw = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const id = Number(raw);
  const valid = Number.isFinite(id) && id > 0;
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: KEYS.unit(id), queryFn: async () => (await rcsaApi.getAssessment(id)).data as Detail, enabled: valid, retry: (n, e) => n < 1 && statusOf(e) !== 404 && statusOf(e) !== 403 });
  const data = detail.data;

  // the assessor's first visit starts the unit; the server's start is the same call the old Assessments list made
  const started = useRef(false);
  const start = useReportedMutation({
    mutationFn: () => rcsaApi.startAssessment(id),
    failure: "The unit couldn't be started",
    toast: 'errors',
    invalidate: [KEYS.unit(id), KEYS.work],
  });
  useEffect(() => {
    if (data && data.viewer_is_assessor && canStart({ status: data.status, campaignStatus: data.campaign_status }) && !started.current) {
      started.current = true;
      start.mutate();
    }
  }, [data, start]);

  if (!valid) return <ErrorState title="This unit doesn't exist" message="Check the address, or open the unit from your worklist." />;
  if (detail.isLoading) return (
    <div className="flex flex-col gap-[16px]" aria-busy="true">
      <Skeleton className="h-[32px] w-[40%]" />
      <Skeleton className="h-[24px] w-[70%]" />
      <SkeletonRows rows={6} columns={3} label="Loading the unit" />
    </div>
  );
  if (detail.isError && statusOf(detail.error) === 403) return <NoRcsaAccess what="this unit" />;
  if (detail.isError || !data) {
    const gone = statusOf(detail.error) === 404;
    return (
      <ErrorState
        title={gone ? "This unit doesn't exist" : "Couldn't load the unit"}
        message={gone ? 'It may have been deleted with its campaign, or you may not have access to it.' : errorMessage(detail.error)}
        onRetry={!gone && canRetry(detail.error) ? () => { void detail.refetch(); } : undefined}
      />
    );
  }
  return <UnitBody key={`${data.id}:${data.status}:${data.campaign_status}`} data={data} starting={start.isPending} startFailed={start.isError} onRetryStart={() => start.mutate()} reload={() => queryClient.invalidateQueries({ queryKey: KEYS.unit(id) })} />;
}

function UnitBody({ data, starting, startFailed, onRetryStart, reload }: { data: Detail; starting: boolean; startFailed: boolean; onRetryStart: () => void; reload: () => unknown }) {
  const router = useRouter();
  const notify = useNotify();
  const rights = useRcsaRights();
  const { confirm, confirmDialog } = useConfirm();
  const unitName = [data.business_unit || 'Unit', data.campaign_name].filter(Boolean).join(' · ');
  const facts = { status: data.status, campaignStatus: data.campaign_status };
  const editable = canEdit(facts) && data.viewer_is_assessor && !starting;
  const reviewer = data.viewer_may_review;
  const role = reviewer ? 'reviewer' : data.viewer_is_assessor ? 'assessor' : 'reader';

  const questions = useMemo(() => sortedQuestions(data.questions), [data.questions]);
  const initial = useMemo(() => Object.fromEntries(data.responses.map((r) => [r.question_id, answerFromServer(r)])) as Record<number, Answer>, [data.responses]);
  const api = useAnswers(data.id, questions, initial, editable);
  const [evidence, setEvidence] = useState<Record<number, EvidenceFile[]>>(() => Object.fromEntries(data.responses.filter((r) => (r.evidence ?? []).length > 0).map((r) => [r.question_id, r.evidence as EvidenceFile[]])));
  const done = completion(questions, api.answers);
  const [attempted, setAttempted] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [finding, setFinding] = useState<{ suggestion?: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'look' | null>(null);

  const findings = useQuery({ queryKey: [...KEYS.findings, 'unit', data.id], queryFn: async () => (await rcsaApi.getFindings({ assessment_id: data.id, limit: 200 })).data as Finding[] });
  const looks = useMemo(() => new Map(questions.map((q) => [q.id, needsLook(q, api.answers[q.id])])), [questions, api.answers]);
  const lookCount = Array.from(looks.values()).filter(Boolean).length;
  const reading = !editable && reviewer && inReview(data.status);
  const shownFilter = filter ?? (reading && lookCount > 0 ? 'look' : 'all');
  const parts = sections(questions, api.answers)
    .map((s) => ({ ...s, shown: shownFilter === 'look' ? s.questions.filter((q) => looks.get(q.id)) : s.questions }))
    .filter((s) => s.shown.length > 0);
  const numbers = new Map(questions.map((q, i) => [q.id, i + 1]));
  const canRaise = (editable) || reviewer || rights.manage;

  const submit = useReportedMutation({
    mutationFn: () => rcsaApi.submitAssessment(data.id),
    success: () => ({ title: 'Submitted for review', message: 'The reviewer has been asked. You will see their decision here and on your worklist.' }),
    failure: "The unit couldn't be submitted",
    invalidate: [KEYS.work, KEYS.summary, KEYS.campaigns, KEYS.campaign(data.campaign_id)],
    onSuccess: () => { void reload(); },
  });
  const decide = useReportedMutation({
    mutationFn: ({ d, comments }: { d: Decision; comments: string }) => (d === 'approve' ? rcsaApi.approveAssessment(data.id, { comments }) : d === 'return' ? rcsaApi.returnAssessment(data.id, { comments }) : rcsaApi.rejectAssessment(data.id, { comments })),
    success: (_, v) => decisionDone(v.d, unitName),
    failure: "The decision wasn't recorded",
    toast: 'success',
    invalidate: [KEYS.work, KEYS.summary, KEYS.campaigns, KEYS.campaign(data.campaign_id)],
    onSuccess: () => { setDecision(null); void reload(); router.push('/erm/rcsa'); },
  });

  const onSubmit = async () => {
    setAttempted(true);
    if (!(await api.flush())) { notify.error(api.error ?? "Your answers couldn't be saved.", { title: "Fix this before submitting", fallback: 'Your answers are not saved yet.' }); return; }
    const ask = submitAsk(done.missing.length);
    if (!(await confirm({ title: ask.title, message: ask.message, confirmLabel: ask.confirmLabel }))) return;
    submit.mutate();
  };

  const pill = statusPill(assessmentStatus, data.status);
  const reason = readOnlyReason(facts);
  const saveWords = api.state === 'saving' ? 'Saving…' : api.state === 'unsaved' ? 'Saving soon…' : api.state === 'saved' && api.savedAt ? `Saved ${formatDateTime(api.savedAt)}` : '';

  return (
    <div className="flex flex-col gap-[16px] pb-[64px]">
      <PageHeader
        variant="page"
        title={unitName}
        back={reviewer || rights.manage ? { href: `/erm/rcsa/campaigns/${data.campaign_id}`, label: 'Back to the campaign' } : { href: '/erm/rcsa', label: 'Back to your worklist' }}
        meta={[data.template_name, data.due_date ? `due ${formatDate(data.due_date, { calendar: true })}` : null, data.assessor_name ? `assessor ${data.assessor_name}` : 'no assessor yet'].filter(Boolean).join(' · ')}
        chips={(
          <>
            <StatusPill {...pill} />
            {inReview(data.status) && data.total_tiers > 1 && <StatusPill tone="neutral" label={`Step ${Math.max(data.current_approval_tier, 1)} of ${data.total_tiers}`} />}
            {data.overall_risk_score != null && <StatusPill tone="neutral" label={`Residual ${riskText(data.overall_risk_score)}`} />}
            {data.overall_control_score != null && <StatusPill tone="neutral" label={`Controls ${controlText(data.overall_control_score)}`} />}
          </>
        )}
        actions={editable ? (
          <Button variant="primary" leftIcon={<Send aria-hidden />} loading={submit.isPending} onClick={() => { void onSubmit(); }}>Submit for review</Button>
        ) : (
          <Button leftIcon={<Flag aria-hidden />} onClick={() => setFinding({})} disabled={!canRaise}>Raise a finding</Button>
        )}
      />

      <Notice tone={data.status === 'requires_changes' || data.status === 'rejected' ? 'warning' : 'info'} title={standing({ ...facts, tier: data.current_approval_tier, total: data.total_tiers }, role)}>
        {data.status === 'requires_changes' ? lastReturn(data.approval_history) : undefined}
      </Notice>
      {rights.manage && !data.assessor_id && canStart(facts) && !starting && (
        <Notice tone="info" title="Nobody is assigned to this unit" action={<Button onClick={onRetryStart}>Take this unit</Button>}>
          The assessor of a unit cannot be changed afterwards. Whoever starts it becomes its assessor: take it if you will answer it yourself.
        </Notice>
      )}
      {startFailed && (
        <Notice tone="danger" title="This unit couldn't be started" action={<Button leftIcon={<RotateCw aria-hidden />} onClick={onRetryStart}>Retry</Button>}>
          You can read it, but you cannot answer until it starts.
        </Notice>
      )}

      {editable ? (
        <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px] rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[8px]">
          <ProgressBar className="min-w-[200px] flex-1" value={done.percent} label="Required questions answered" valueText={`${formatCount(done.answeredRequired)} of ${formatCount(done.required)} required answered`} tone={done.percent >= 100 ? 'success' : 'primary'} />
          <span role="status" aria-live="polite" className="text-ds-label text-ds-fg-muted">
            {api.state === 'error' ? (
              <span className="inline-flex flex-wrap items-center gap-[8px] text-ds-danger">
                <span className="font-[600]">Not saved. {api.error}</span>
                <Button size="sm" leftIcon={<RotateCw aria-hidden />} onClick={() => { void api.flush(); }}>Retry</Button>
              </span>
            ) : saveWords}
          </span>
        </div>
      ) : reason ? (
        <ReadOnlyNote>{reason}</ReadOnlyNote>
      ) : null}

      {reading && (
        <div className="flex flex-wrap items-center gap-[12px]">
          <SegmentedControl<'all' | 'look'>
            label="Which answers to show" name="rcsa-look" value={shownFilter} onChange={setFilter}
            options={[{ value: 'look', label: `Needs a look ${formatCount(lookCount)}` }, { value: 'all', label: `All answers ${formatCount(questions.length)}` }]}
          />
          {shownFilter === 'look' && lookCount === 0 && <span className="text-ds-body text-ds-fg-muted">Nothing stands out: every answer looks fine.</span>}
        </div>
      )}

      <div className="grid items-start gap-[16px] lg:grid-cols-[200px_minmax(0,1fr)]">
        <SectionJump parts={parts.map((s) => ({ name: s.name, answered: s.answered, required: s.required }))} />
        <div className="flex min-w-0 flex-col gap-[16px]">
          {parts.length === 0 && <p className="rounded-ds-card border border-dashed border-ds-border-strong bg-ds-surface px-[16px] py-[24px] text-center text-ds-body text-ds-fg-muted">{questions.length === 0 ? 'This questionnaire has no questions.' : 'No answer matches.'}</p>}
          {parts.map((s, i) => (
            <SectionCard key={s.name} id={`section-${i}`} title={s.name} meta={s.required > 0 ? `${formatCount(s.answered)} of ${formatCount(s.required)} required answered` : `${formatCount(s.questions.length)} questions`}>
              <ul aria-label={s.name} className="m-0 -mx-[16px] -mb-[16px] list-none border-t border-ds-border p-0">
                {s.shown.map((q) => (
                  <QuestionRow
                    key={q.id}
                    assessmentId={data.id}
                    question={q}
                    number={numbers.get(q.id) ?? 0}
                    answer={api.answers[q.id]}
                    editable={editable}
                    onChange={(next, wait) => api.change(q.id, next, wait)}
                    onBlur={() => { void api.flush(); }}
                    evidence={evidence[q.id] ?? []}
                    onEvidence={(next) => setEvidence((prev) => ({ ...prev, [q.id]: next }))}
                    look={reading ? looks.get(q.id) ?? null : null}
                    missing={attempted && editable && done.missing.includes(q.id)}
                    canRaise={canRaise}
                    onRaise={() => setFinding({ suggestion: q.question_text.slice(0, 120) })}
                  />
                ))}
              </ul>
            </SectionCard>
          ))}
          {shownFilter === 'look' && lookCount > 0 && lookCount < questions.length && (
            <p className="text-ds-body text-ds-fg-muted">{`${formatCount(questions.length - lookCount)} answers look fine and are hidden. `}<Button variant="link" size="sm" onClick={() => setFilter('all')}>Show all answers</Button></p>
          )}

          <SectionCard id="findings" title="Findings" meta={findings.data ? `${formatCount(findings.data.length)} raised on this unit` : undefined} actions={canRaise ? <Button size="sm" leftIcon={<Flag aria-hidden />} onClick={() => setFinding({})}>Raise a finding</Button> : undefined}>
            {findings.isLoading && <SkeletonRows rows={2} columns={2} label="Loading the findings" />}
            {findings.isError && <ErrorState compact title="Couldn't load the findings" message={errorMessage(findings.error)} onRetry={() => { void findings.refetch(); }} />}
            {findings.data && findings.data.length === 0 && <p className="text-ds-body text-ds-fg-muted">No finding has been raised on this unit.</p>}
            {findings.data && findings.data.length > 0 && (
              <ul className="m-0 flex list-none flex-col p-0">
                {findings.data.map((f) => {
                  const sev = statusPill(findingSeverity, f.severity);
                  const st = statusPill(findingStatus, f.status);
                  return (
                    <li key={f.id} className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] border-t border-ds-border py-[8px] first:border-t-0">
                      <a href={`/erm/rcsa/findings?open=${f.id}`} className="min-h-ds-control min-w-0 flex-1 content-center text-ds-body font-[500] text-ds-fg underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring [overflow-wrap:anywhere]">{f.title}</a>
                      <StatusPill size="sm" {...sev} />
                      <StatusPill size="sm" {...st} />
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          <SectionCard id="history" title="History" info="Who submitted, approved, sent back or rejected this unit, and what they wrote.">
            <ReviewTrail steps={data.approval_history} totalTiers={data.total_tiers} />
          </SectionCard>
        </div>
      </div>

      {decisions(facts, reviewer).length > 0 && (
        <div role="region" aria-label="Your decision" className="sticky bottom-0 z-10 -mx-[4px] flex flex-wrap items-center justify-between gap-[12px] rounded-ds-card border border-ds-border-strong bg-ds-surface px-[16px] py-[12px] shadow-ds-pop">
          <span className="min-w-0 text-ds-body text-ds-fg">{`Your decision${data.total_tiers > 1 ? ` · step ${Math.max(data.current_approval_tier, 1)} of ${data.total_tiers}` : ''}`}</span>
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button variant="dangerOutline" leftIcon={<XCircle aria-hidden />} onClick={() => setDecision('reject')}>Reject</Button>
            <Button leftIcon={<RotateCw aria-hidden />} onClick={() => setDecision('return')}>Send back</Button>
            <Button variant="primary" leftIcon={<Check aria-hidden />} onClick={() => setDecision('approve')}>Approve</Button>
          </div>
        </div>
      )}

      <DecisionSheet decision={decision} unit={unitName} pending={decide.isPending} error={decide.error} onClose={() => { setDecision(null); decide.reset(); }} onDecide={(comments) => decision && decide.mutate({ d: decision, comments })} />
      <FindingSheet key={finding ? `open:${finding.suggestion ?? ''}` : 'closed'} open={finding !== null} assessmentId={data.id} unit={unitName} suggestion={finding?.suggestion} onClose={() => setFinding(null)} />
      {confirmDialog}
    </div>
  );
}

/** What the reviewer wrote when they sent the unit back: the last "returned" step. */
function lastReturn(steps: Step[]): string | undefined {
  const last = steps.slice().reverse().find((s) => s.action === 'returned');
  return last?.comments ? `${last.performer_name ?? 'The reviewer'} wrote: ${last.comments}` : undefined;
}

/** The sections of the form to jump between: a column on a wide window, a select on a narrow one. */
function SectionJump({ parts }: { parts: Array<{ name: string; answered: number; required: number }> }) {
  if (parts.length < 2) return <div className="hidden lg:block" />;
  const go = (i: number) => document.getElementById(`section-${i}`)?.scrollIntoView({ block: 'start' });
  return (
    <>
      <nav aria-label="Sections of the form" className="sticky top-[64px] hidden rounded-ds-card border border-ds-border bg-ds-surface p-[8px] lg:block">
        <ul className="m-0 flex list-none flex-col p-0">
          {parts.map((s, i) => (
            <li key={s.name}>
              <a href={`#section-${i}`} className="flex min-h-ds-control items-center justify-between gap-[8px] rounded-ds-control px-[8px] text-ds-body text-ds-fg-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring">
                <span className="min-w-0 [overflow-wrap:anywhere]">{s.name}</span>
                {s.required > 0 && <span className={`shrink-0 text-ds-label tabular-nums ${s.answered >= s.required ? 'text-ds-success' : 'text-ds-fg-muted'}`}>{`${s.answered}/${s.required}`}</span>}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="lg:hidden">
        <Select aria-label="Jump to a section" placeholder="Jump to a section" value="" onChange={(e) => { if (e.target.value !== '') go(Number(e.target.value)); }}>
          {parts.map((s, i) => <option key={s.name} value={i}>{s.required > 0 ? `${s.name} (${s.answered}/${s.required})` : s.name}</option>)}
        </Select>
      </div>
    </>
  );
}
