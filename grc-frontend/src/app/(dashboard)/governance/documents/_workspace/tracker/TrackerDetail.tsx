'use client';

// The detail of ONE document in the Tracker, drawn when its row is opened (and only then: the workflow is asked of the server at that moment, one document at a time). From the top: the
// blocker in words with how long it has waited, the life cycle as a stepper with the dates, then every step in order with what the platform knows (the owner and author; each stage of the
// route with each person's state, due date and how long; the changes asked for or proposed and who they wait for; the published version and its review date; the attestation campaign and
// how far it is; who has not read it yet; the exceptions) and the other facts a person looks for. A part the server has not answered says "loading" or "could not be loaded" with Retry in
// the sections that read it, and never a made-up figure. The links are the ones that exist: the document, its workflow, its change log. The rules are detailModel.ts (tested).
import { useMemo } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Button, ErrorState, ProgressBar, StatusPill } from '@/components/ui/ds';
import type { TrackerLine } from '@/lib/documentTrackerApi';
import type { GovDoc } from '../lib';
import type { Lookups } from '../libraryModel';
import { dayOf, type TrackerContext } from '../libraryTracker';
import { TrackerStepper } from './TrackerStepper';
import { detailBlocker, sectionsOf, stepsOf, tabHref, type DetailInput, type Part, type People, type Row, type Section, type Source, type StageBlock } from './detailModel';
import { ageOf } from './lineModel';
import { useDocDetail, type DetailRetry } from './useTrackerData';

const TONE_TEXT: Record<string, string> = { danger: 'text-ds-danger', warning: 'text-ds-warning', success: 'text-ds-success', progress: 'text-ds-primary-text' };

function Facts({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null;
  const toneClass = (tone: Row['tone'], plain: string) => (tone ? clsx('font-[600]', TONE_TEXT[tone] ?? 'text-ds-fg') : plain);
  const labelled = rows.filter((r) => r.label);
  return (
    <>
      {labelled.length > 0 && (
        <dl className="m-0 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-[12px] gap-y-[4px]">
          {labelled.map((r, i) => (
            <div key={`${r.label}-${i}`} className="contents">
              <dt className="text-ds-label text-ds-fg-muted">{r.label}</dt>
              <dd className={clsx('m-0 min-w-0 text-ds-body [overflow-wrap:anywhere]', toneClass(r.tone, 'text-ds-fg-body'))}>{r.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {rows.filter((r) => !r.label).map((r, i) => <p key={`${r.text}-${i}`} className={clsx('m-0 text-ds-body [overflow-wrap:anywhere]', toneClass(r.tone, 'text-ds-fg-muted'))}>{r.text}</p>)}
    </>
  );
}

function PeopleList({ people, label }: { people: StageBlock['people']; label: string }) {
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col p-0">
      {people.map((p, i) => (
        <li key={`${p.name}-${i}`} className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px] border-t border-ds-border py-[4px] first:border-t-0">
          <span className="min-w-0 flex-1 basis-[8rem] text-ds-body text-ds-fg [overflow-wrap:anywhere]">{p.name}</span>
          <StatusPill size="sm" tone={p.tone} label={p.word} />
          {p.note && <span className="min-w-0 basis-full text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{p.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function Stage({ stage }: { stage: StageBlock }) {
  return (
    <div className="min-w-0 rounded-ds-control border border-ds-border p-[8px]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px]">
        <span className="min-w-0 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{stage.name}</span>
        <StatusPill size="sm" tone={stage.tone} label={stage.word} />
        {stage.progress && <span className="text-ds-label text-ds-fg-muted">{stage.progress}</span>}
      </div>
      {stage.rule && <p className="m-0 mt-[2px] text-ds-label text-ds-fg-muted">{stage.rule}</p>}
      {stage.people.length > 0 && <div className="mt-[4px]"><PeopleList people={stage.people} label={`${stage.name}: people`} /></div>}
    </div>
  );
}

function NamedPeople({ people }: { people: People }) {
  return (
    <div className="mt-[8px] min-w-0">
      <p className="m-0 text-ds-label font-[600] text-ds-fg-muted">{people.heading}</p>
      <PeopleList people={people.people} label={people.heading} />
      {people.more > 0 && <p className="m-0 mt-[2px] text-ds-label text-ds-fg-muted">{`+${people.more} more`}</p>}
    </div>
  );
}

const STEP_PILL: Record<string, 'success' | 'progress' | 'neutral' | 'warning'> = { done: 'success', here: 'progress', next: 'neutral', off: 'neutral' };

function SectionView({ section, parts, retry }: { section: Section; parts: Pick<DetailInput, 'signoff' | 'lifecycle' | 'proposals' | 'campaigns' | 'exceptions'>; retry: DetailRetry }) {
  const { step } = section;
  const wait = section.sources.filter((s): s is keyof DetailRetry => s !== 'row').map((s) => ({ source: s, part: parts[s] as Part<unknown> }));
  const loading = wait.some((w) => w.part.state === 'loading');
  const failed = wait.filter((w) => w.part.state === 'failed');
  return (
    <section aria-labelledby={`sec-${section.id}`} className={clsx('min-w-0 rounded-ds-card border p-[12px]', step?.state === 'here' ? 'border-ds-primary' : 'border-ds-border', step?.state === 'off' && 'bg-ds-surface-subtle')}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px]">
        <h4 id={`sec-${section.id}`} className="m-0 min-w-0 !text-ds-body !font-[600] !text-ds-fg">{section.title}</h4>
        {step && <StatusPill size="sm" tone={step.problem ? 'warning' : STEP_PILL[step.state]} label={step.state === 'next' && !step.word ? 'Not yet' : step.word} />}
        {step?.date && <span className="text-ds-label text-ds-fg-muted">{dayOf(step.date)}</span>}
      </div>
      <div className="mt-[8px] flex min-w-0 flex-col gap-[8px]">
        {section.stages.map((st, i) => <Stage key={`${st.name}-${i}`} stage={st} />)}
        <Facts rows={section.rows} />
        {section.bar && <ProgressBar value={section.bar.pct} label={`${section.title}: acknowledged`} valueText={section.bar.label} tone={section.bar.tone === 'progress' ? 'primary' : (section.bar.tone as 'success' | 'warning')} className="max-w-[360px]" />}
        {section.people && <NamedPeople people={section.people} />}
        {loading && <p role="status" className="m-0 text-ds-label text-ds-fg-muted">Loading</p>}
        {failed.map((f) => <ErrorState key={f.source} compact title={`Couldn't load ${SOURCE_WORDS[f.source]}`} onRetry={retry[f.source as keyof DetailRetry]} className="!p-0" />)}
      </div>
    </section>
  );
}

const SOURCE_WORDS: Record<Source, string> = { row: '', signoff: 'the workflow', lifecycle: 'the acknowledgements', campaigns: 'the attestation', proposals: 'the proposed changes', exceptions: 'the exceptions' };

export interface TrackerDetailProps {
  doc: GovDoc;
  line?: TrackerLine | null;
  ctx: TrackerContext;
  lookups: Lookups;
  /** the page of the document (a modified click opens a new tab) */
  href: string;
  onOpen: (doc: GovDoc) => void;
}

export function TrackerDetail({ doc, line, ctx, lookups, href, onOpen }: TrackerDetailProps) {
  const { parts, retry } = useDocDetail(doc, true, lookups);
  const input: DetailInput = useMemo(() => ({ doc, line, ...parts }), [doc, line, parts]);
  const blocker = useMemo(() => detailBlocker(input, ctx), [input, ctx]);
  const steps = useMemo(() => stepsOf(input, ctx), [input, ctx]);
  const sections = useMemo(() => sectionsOf(input, ctx), [input, ctx]);
  const age = ageOf(blocker, ctx.now);
  const Icon = blocker.tone === 'danger' ? AlertCircle : blocker.tone === 'warning' ? AlertTriangle : blocker.tone === 'success' ? CheckCircle2 : Clock;
  return (
    <div className="flex min-w-0 flex-col gap-[12px] border-t border-ds-border bg-ds-surface-subtle p-[12px]">
      {blocker.text && (
        <div className={clsx('flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[4px] rounded-ds-card border bg-ds-surface px-[12px] py-[8px]', blocker.tone === 'danger' ? 'border-ds-danger-border' : 'border-ds-border')}>
          <Icon aria-hidden className={clsx('h-[16px] w-[16px] shrink-0', TONE_TEXT[blocker.tone] ?? 'text-ds-fg-muted')} strokeWidth={1.75} />
          <span className="min-w-0 flex-1 basis-[12rem] text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{blocker.text}</span>
          {age && <StatusPill size="sm" tone={age.tone} label={blocker.late ? `Late ${age.label}` : age.label} />}
        </div>
      )}
      <div className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><TrackerStepper steps={steps} label={`${doc.title}: life cycle`} /></div>
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-[12px]">
        {sections.map((s) => <SectionView key={s.id} section={s} parts={parts} retry={retry} />)}
      </div>
      <div className="flex flex-wrap items-center gap-[8px]">
        <Button href={href}>Open the document</Button>
        <Button variant="ghost" href={tabHref(href, 'approvals')}>Open its workflow</Button>
        <Button variant="ghost" href={tabHref(href, 'versions')}>Change log</Button>
        <Button variant="ghost" onClick={() => onOpen(doc)}>Quick look</Button>
      </div>
    </div>
  );
}
