'use client';

/**
 * Scope, People and Plan of a scoped assessment (one per application, function or system): the three forms of components/compliance/scoping/ScopeForms, one per tab, and for a
 * draft the "Ready to start?" card beside them. The state and the saving are useScoping's (the heading's Start and Discard use them too).
 */
import { Check, Circle, Play } from 'lucide-react';
import { Button, Notice, ReadOnlyNote, SectionCard } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { PeopleStage, PlanStage, ScopeStage } from '@/components/compliance/scoping/ScopeForms';
import { stageOfCheck, unmet, type Stage } from '@/components/compliance/scoping/scopingModel';
import type { ScopeView } from '@/components/compliance/scoping/scopingApi';
import type { Scoping } from './useScoping';

export type StageKey = Exclude<Stage, 'assessment'>;

function Readiness({ view, onJump, onStart, starting }: { view: ScopeView; onJump: (s: StageKey) => void; onStart: () => void; starting: boolean }) {
  const { required, advice } = unmet(view.readiness);
  const done = (view.readiness?.checks ?? []).filter((c) => c.ok).length;
  return (
    <SectionCard id="ready" title="Ready to start?" meta={required.length ? `${required.length} required left` : 'Everything required is filled'}
      info="Starting copies the questions without their answers, keeps this scope and the facts of its assets as they are today, and opens the questions.">
      <ul className="space-y-[6px]">
        {required.map((c) => (
          <li key={c.key}><button type="button" onClick={() => onJump(stageOfCheck(c.key))} className="flex min-h-ds-control w-full items-start gap-[8px] rounded-ds-control text-left text-ds-body text-ds-danger focus-visible:outline-none focus-visible:shadow-ds-ring"><Circle aria-hidden className="mt-[3px] h-[14px] w-[14px] shrink-0" strokeWidth={2} /><span>{c.label}{c.hint && <span className="block text-ds-label text-ds-fg-muted">{c.hint}</span>}</span></button></li>
        ))}
        {advice.map((c) => (
          <li key={c.key}><button type="button" onClick={() => onJump(stageOfCheck(c.key))} className="flex min-h-ds-control w-full items-start gap-[8px] rounded-ds-control text-left text-ds-body text-ds-fg-muted focus-visible:outline-none focus-visible:shadow-ds-ring"><Circle aria-hidden className="mt-[3px] h-[14px] w-[14px] shrink-0" strokeWidth={1.5} /><span>{c.label} <span className="text-ds-label">(advised)</span></span></button></li>
        ))}
        {done > 0 && <li className="flex items-center gap-[8px] text-ds-body text-ds-fg-muted"><Check aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-success" strokeWidth={2} />{done} {done === 1 ? 'item' : 'items'} done</li>}
      </ul>
      <Button variant="primary" fullWidth className="mt-[12px]" leftIcon={<Play aria-hidden />} loading={starting} disabled={!view.readiness?.ready} onClick={onStart}>Start assessment</Button>
    </SectionCard>
  );
}

export function ScopeTab({ stage, view, scoping, onJump }: { stage: StageKey; view: ScopeView; scoping: Scoping; onJump: (s: StageKey) => void }) {
  const started = view.phase === 'in_progress';
  const props = scoping.props;
  if (!props) return null;
  return (
    <div className={`grid min-w-0 gap-[16px] ${started ? '' : 'xl:grid-cols-[minmax(0,1fr)_19rem]'}`}>
      <div className="flex min-w-0 flex-col gap-[12px]">
        {scoping.saveError && (
          <Notice tone="danger" title="Couldn't save the last change" action={<Button size="sm" loading={scoping.saving} onClick={scoping.retry}>Try again</Button>}>{scoping.saveError}</Notice>
        )}
        {scoping.startError && <Notice tone="danger" title="Couldn't start">{scoping.startError}</Notice>}
        {started && stage !== 'people' && (
          <ReadOnlyNote>Fixed since the start <InfoTip label="What can still change" text="The subject, level, period, exclusions and test rules were agreed before the questions opened, so they are shown as they were. Who takes part, the notes and the evidence plan can still change." /></ReadOnlyNote>
        )}
        {stage === 'scope' && <ScopeStage {...props} />}
        {stage === 'people' && <PeopleStage {...props} />}
        {stage === 'plan' && <PlanStage {...props} />}
        <p className="text-ds-label text-ds-fg-muted" role="status">{scoping.saving ? 'Saving…' : scoping.pending ? 'Unsaved changes' : started ? '' : 'Saved'}</p>
      </div>
      {!started && <aside className="min-w-0"><Readiness view={view} onJump={onJump} onStart={scoping.start} starting={scoping.starting} /></aside>}
    </div>
  );
}
