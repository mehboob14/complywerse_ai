'use client';

// The change at a glance: the journey (where it stands, what is next), what needs attention as links that open the right tab already filtered, the circular in a few lines, and the facts,
// editable where a person would want to correct them (the date fields save when they are left, not on every keystroke). The closure card says how far the work is and opens the Close sheet.
import { useMemo } from 'react';
import { CheckCircle2, ChevronRight, Lock, Sparkles } from 'lucide-react';
import { Button, ClampedText, ErrorState, Fact, FactList, ProgressBar, SectionCard, SkeletonRows } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatDate } from '@/lib/format';
import { useLinks, useObligations, useTasks } from '../_lib/data';
import { closeState, dueWords, figuresOf, isFinished, journeyOf, regulatorName } from '../_lib/regulatoryModel';
import type { ChangeRow } from '../_lib/types';
import { DateField, PersonPicker } from '../_parts/shared';
import { JourneyStrip } from './_head';

type Go = (tab: 'overview' | 'obligations' | 'assessments' | 'tasks', patch?: Record<string, string | number | boolean>) => void;

interface Row { key: string; n: number; text: string; tone: 'danger' | 'warning' | 'neutral'; go: () => void }

export default function OverviewTab({ change, today, onGo, onUpdate, onClose }: { change: ChangeRow; today: Date; onGo: Go; onUpdate: (data: Record<string, unknown>) => void; onClose: () => void }) {
  const obligations = useObligations(change.id);
  const links = useLinks(change.id);
  const tasks = useTasks(change.id);
  const ready = !!obligations.data && !!links.data && !!tasks.data;
  const failed = [obligations, links, tasks].find((q) => q.isError && !q.data);

  const f = useMemo(() => figuresOf(obligations.data ?? [], links.data ?? [], tasks.data ?? [], change, today), [obligations.data, links.data, tasks.data, change, today]);
  const steps = useMemo(() => journeyOf(change, f), [change, f]);
  const finished = isFinished(change.status);
  const state = closeState(change, tasks.data ?? []);
  const eff = dueWords(change.effective_date, today);

  const attention: Row[] = [
    { key: 'late', n: f.late, text: f.late === 1 ? 'task is past due' : 'tasks are past due', tone: 'danger' as const, go: () => onGo('tasks', { late: true }) },
    { key: 'check', n: f.toCheck, text: f.toCheck === 1 ? 'obligation to check against the circular\'s wording' : 'obligations to check against the circular\'s wording', tone: 'warning' as const, go: () => onGo('obligations', { check: true }) },
    { key: 'suggestions', n: f.suggestions, text: f.suggestions === 1 ? 'control suggestion to confirm or reject' : 'control suggestions to confirm or reject', tone: 'warning' as const, go: () => onGo('obligations', { control: 'review' }) },
    { key: 'notAssessed', n: f.notAssessed, text: f.notAssessed === 1 ? 'obligation not yet assessed for compliance' : 'obligations not yet assessed for compliance', tone: 'neutral' as const, go: () => onGo('obligations', { compliance: 'not_assessed' }) },
    { key: 'none', n: f.withoutControl, text: f.withoutControl === 1 ? 'obligation without a control' : 'obligations without a control', tone: 'neutral' as const, go: () => onGo('obligations', { control: 'none' }) },
    { key: 'gaps', n: f.gaps, text: f.gaps === 1 ? 'impact assessment with a gap' : 'impact assessments with a gap', tone: 'danger' as const, go: () => onGo('assessments', { gaps: true }) },
    { key: 'unassigned', n: f.unassigned, text: f.unassigned === 1 ? 'open task with nobody assigned' : 'open tasks with nobody assigned', tone: 'neutral' as const, go: () => onGo('tasks', { who: 'none' }) },
  ].filter((r) => r.n > 0);

  const analysis = change.analysis?.status === 'done' ? change.analysis : null;
  const tone = { danger: 'text-ds-danger', warning: 'text-ds-warning', neutral: 'text-ds-fg' } as const;

  return (
    <div className="flex flex-col gap-[16px]">
      {ready && <JourneyStrip steps={steps} onGo={(tab) => onGo(tab)} />}
      {!ready && !failed && <SkeletonRows rows={2} columns={6} label="Loading where this change stands" />}
      {failed && <ErrorState compact title="Couldn't load what this change holds" message={errorMessage(failed.error)} onRetry={canRetry(failed.error) ? () => { [obligations, links, tasks].forEach((q) => { if (q.isError) void q.refetch(); }); } : undefined} />}

      <div className="grid items-start gap-[16px] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-[16px]">
          <SectionCard id="says" title="What the circular says">
            <ClampedText text={change.description} lines={4} />
            {!change.description && <p className="m-0 mt-[4px] text-ds-label text-ds-fg-muted">The summary is written when the AI reads the circular.</p>}
          </SectionCard>

          <SectionCard id="attention" title="Needs attention" meta={ready ? `${attention.length} ${attention.length === 1 ? 'thing' : 'things'}` : undefined}>
            {!ready ? <SkeletonRows rows={3} columns={2} label="Loading" /> : attention.length === 0 ? (
              <p className="m-0 flex items-center gap-[8px] px-[4px] py-[4px] text-ds-body text-ds-fg-muted">
                <CheckCircle2 aria-hidden className="h-[16px] w-[16px] text-ds-success" /> Nothing is waiting on anyone right now.
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {attention.map((a) => (
                  <li key={a.key}>
                    <button type="button" onClick={a.go} className="flex min-h-ds-control w-full items-center gap-[8px] rounded-ds-control px-[8px] text-left text-ds-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring">
                      <span className={`font-[600] tabular-nums ${tone[a.tone]}`}>{a.n}</span>
                      <span className="min-w-0 flex-1 text-ds-fg-body">{a.text}</span>
                      <ChevronRight aria-hidden className="h-[16px] w-[16px] text-ds-fg-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="flex min-w-0 flex-col gap-[16px]">
          <SectionCard id="facts" title="Details">
            <FactList min={140}>
              <Fact label="Regulator">{regulatorName(change.source)}</Fact>
              <Fact label="Reference">{change.reference_number}</Fact>
              <Fact label="Published"><DateField label="Published" value={change.publication_date} onCommit={(day) => onUpdate({ published_date: day })} /></Fact>
              <Fact label="Takes effect">
                <DateField label="Takes effect" value={change.effective_date} onCommit={(day) => onUpdate({ effective_date: day })} />
                {eff && !finished && (
                  <span className={`block text-ds-label ${eff.late ? 'text-ds-danger' : 'text-ds-fg-muted'}`}>{eff.late ? `In force for ${eff.text.replace(' late', '')}` : `Takes effect ${eff.text}`}</span>
                )}
              </Fact>
              <Fact label="Owner" empty="Unassigned"><PersonPicker label="Owner" value={change.assigned_to} fallbackName={change.assignee_name} onChange={(id) => onUpdate({ assigned_to: id })} placeholder="Nobody yet" /></Fact>
              <Fact label="Recorded">{`${formatDate(change.created_at)}${change.creator_name ? ` by ${change.creator_name}` : ''}`}</Fact>
              {analysis && (
                <Fact label="AI reading">
                  <span className="flex items-start gap-[6px]"><Sparkles aria-hidden className="mt-[2px] h-[14px] w-[14px] shrink-0 text-ds-primary-text" />
                    <span>{`Read in full${analysis.seconds ? ` in ${analysis.seconds < 90 ? `${analysis.seconds} s` : `${Math.round(analysis.seconds / 60)} min`}` : ''}: ${analysis.counts?.obligations ?? 0} obligations, ${analysis.counts?.verified ?? 0} word for word`}</span></span>
                </Fact>
              )}
            </FactList>
          </SectionCard>

          <SectionCard id="closure" title="Closure">
            {finished ? (
              <p className="m-0 flex items-center gap-[6px] text-ds-body text-ds-success"><CheckCircle2 aria-hidden className="h-[16px] w-[16px]" />{`Closed${change.closed_at ? ` ${formatDate(change.closed_at)}` : ''}${change.closed_by_name ? ` by ${change.closed_by_name}` : ''}`}</p>
            ) : (
              <>
                <ProgressBar value={f.tasks > 0 ? Math.round((f.tasksDone / f.tasks) * 100) : 0} label="Tasks completed" valueText={f.tasks > 0 ? `${f.tasksDone} of ${f.tasks} tasks done` : 'No tasks yet'} tone={f.late > 0 ? 'danger' : 'success'} />
                <p className="m-0 mt-[6px] text-ds-label text-ds-fg-muted">
                  {state.kind === 'ready' ? 'Every task is done: the change can be closed.' : state.kind === 'no_tasks' ? 'A change closes when its tasks are done. Add the first task.' : state.kind === 'open_tasks' ? `${state.open} ${state.open === 1 ? 'task is' : 'tasks are'} left.` : 'Move it to Under assessment first.'}
                </p>
                <Button className="mt-[8px]" leftIcon={<Lock aria-hidden />} onClick={onClose}>Close this change…</Button>
              </>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

