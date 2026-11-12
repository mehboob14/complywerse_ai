'use client';

/**
 * "Compliance programme": what an approved (or underway) onboarding started in compliance execution, and what it only proposes. Four blocks, never mixed:
 * Started (the journey with its link, the controls loaded and none assessed, the scope), Proposed (the people named under Ownership, the one button that makes the
 * programme owner owner of the controls nobody owns), Offered as evidence (the items of "What exists", each a claim with its source, date and how far anyone has
 * checked it), and one line for what has not started. Nothing here is a compliance result. The server decides what starts (`programme.py`); this lists its answer.
 */
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, RefreshCw } from 'lucide-react';
import { Button, Disclosure, Fact, FactList, Notice, SectionCard, SkeletonLines, StatusPill, useReportedMutation } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatDate } from '@/lib/format';
import { onboardingApi, ONBOARDING_KEYS, refreshOnboarding, type ProgrammeCandidate, type ProgrammeView } from '@/lib/frameworkOnboarding';
import { journeyWords } from '../register/registerModel';
import { recordFacts, VERIFICATION_TONE } from './existingModel';
import { controlsWords, NOT_STARTED_WORDS, ownerAction, personWords, scopeWords } from './programmeModel';

const HEAD = 'text-ds-label font-[600] text-ds-fg';
const BLOCK = 'flex min-w-0 flex-col gap-[8px] border-t border-ds-border pt-[12px] first:border-t-0 first:pt-0';
const LINK = 'text-ds-primary-text underline focus-visible:outline-none focus-visible:shadow-ds-ring';
const VERIFICATION_WORDS: Record<ProgrammeCandidate['verification_status'], string> = { declared: 'Declared', evidence_received: 'Document attached', reviewed: 'Reviewed', verified: 'Verified' };
const date = (iso: string | null): string => (iso ? formatDate(iso, { calendar: true }) : '');

function Candidate({ c }: { c: ProgrammeCandidate }) {
  const facts = recordFacts(c, date);
  return (
    <li className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[10px]">
      <div className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[6px]">
        <div className="min-w-0">
          <p className="break-words text-ds-body font-[600] text-ds-fg">{c.assessment_type}</p>
          {facts && <p className="break-words text-ds-label text-ds-fg-muted">{facts}</p>}
          <p className="break-words text-ds-label text-ds-fg-muted">{c.source}{c.created_by ? ` by ${c.created_by}` : ''}</p>
        </div>
        <StatusPill tone={VERIFICATION_TONE[c.verification_status]} label={VERIFICATION_WORDS[c.verification_status] ?? c.verification_status} size="sm" />
      </div>
      <p className="mt-[4px] break-words text-ds-label text-ds-fg-muted">{c.has_document ? c.files.map((f) => f.name).join(', ') : 'No document yet'}</p>
    </li>
  );
}

function Started({ p }: { p: ProgrammeView }) {
  const s = p.scope;
  const j = p.journey;
  const detail = s && (s.departments.length + s.systems.length + s.locations.length + s.third_parties.length + s.processes.length + s.hosting.length + s.exclusions.length > 0 || s.statement);
  return (
    <div className={BLOCK}>
      <p className={HEAD}>Started</p>
      <FactList min={200}>
        <Fact label="Journey">
          {j ? <><Link href={`/frameworks/${j.id}`} className={LINK}>{j.name}</Link><span className="block text-ds-label text-ds-fg-muted">{journeyWords({ id: j.id, status: j.status })} · {j.made_here ? 'Made from this onboarding' : 'Already running, linked'}</span></> : null}
        </Fact>
        <Fact label="Controls">{p.controls ? controlsWords(p.controls) : null}</Fact>
        <Fact label="Target date" empty="Not set">{j?.target_date ? date(j.target_date) : null}</Fact>
        <Fact label="Scope">{s ? scopeWords(s) : null}</Fact>
      </FactList>
      {s && detail && (
        <Disclosure label="Scope details" level={4} region={false}>
          <div className="flex flex-col gap-[12px] pt-[8px]">
            <FactList min={200}>
              {s.departments.length > 0 && <Fact label="Departments">{s.departments.map((x) => x.name).join(', ')}</Fact>}
              {s.systems.length > 0 && <Fact label="Systems">{s.systems.map((x) => x.name).join(', ')}</Fact>}
              {s.locations.length > 0 && <Fact label="Locations">{s.locations.map((x) => x.name).join(', ')}</Fact>}
              {s.third_parties.length > 0 && <Fact label="Third parties">{s.third_parties.map((x) => x.name).join(', ')}</Fact>}
              {s.processes.length > 0 && <Fact label="Processes">{s.processes.map((x) => (x.owner ? `${x.process} (${x.owner})` : x.process)).join(', ')}</Fact>}
              {s.hosting.length > 0 && <Fact label="Hosting">{s.hosting.join(', ')}</Fact>}
            </FactList>
            {s.exclusions.length > 0 && (
              <div className="min-w-0">
                <p className="text-ds-label text-ds-fg-muted">Exclusions</p>
                <ul className="mt-[2px] list-disc space-y-[2px] pl-[18px] text-ds-body text-ds-fg">{s.exclusions.map((x) => <li key={x.item} className="break-words">{x.item}: {x.reason}</li>)}</ul>
              </div>
            )}
            {s.statement && <Fact label="Scope statement">{s.statement}</Fact>}
          </div>
        </Disclosure>
      )}
    </div>
  );
}

function Proposed({ p, applying, onApply }: { p: ProgrammeView; applying: boolean; onApply: () => void }) {
  const prop = p.proposals;
  const action = ownerAction(p.owner);
  const nobody = !prop || (prop.people.length === 0 && prop.teams.length === 0 && !prop.assessor);
  return (
    <div className={BLOCK}>
      <div className="flex items-center gap-[4px]">
        <p className={HEAD}>Proposed</p>
        <InfoTip label="About proposed" text="Named under Ownership. Nothing is assigned until you apply it, and an owner a control already has is never replaced." />
      </div>
      {nobody ? <p className="text-ds-body text-ds-fg-muted">Nobody was named under Ownership.</p> : (
        <FactList min={200}>
          {prop?.people.map((x) => <Fact key={x.role} label={x.role}>{personWords(x)}</Fact>)}
          {prop && prop.teams.length > 0 && <Fact label="Control teams">{prop.teams.map((t) => t.name).join(', ')}</Fact>}
          {prop?.assessor && <Fact label="Independent review">{prop.assessor}</Fact>}
        </FactList>
      )}
      {action.shown && (
        <div className="flex flex-col items-start gap-[4px]">
          <Button size="sm" disabled={!action.enabled} loading={applying} aria-describedby={action.reason ? 'programme-owner-why' : undefined} onClick={onApply}>{action.label}</Button>
          {action.reason && <p id="programme-owner-why" className="text-ds-label text-ds-fg-muted">{action.reason}</p>}
        </div>
      )}
    </div>
  );
}

/** The programme's read and its two writes, held by the page so the header's button and the card share one answer. */
export function useProgramme(onboardingId: number, enabled: boolean) {
  const qc = useQueryClient();
  const key = ONBOARDING_KEYS.programme(onboardingId);
  const query = useQuery({ queryKey: key, queryFn: () => onboardingApi.programme(onboardingId), enabled });
  const settle = (next: ProgrammeView) => { qc.setQueryData(key, next); refreshOnboarding(qc); for (const k of ['certifications', 'compliance-frameworks-aggregate']) void qc.invalidateQueries({ queryKey: [k] }); };
  const start = useReportedMutation({
    mutationFn: () => onboardingApi.startProgramme(onboardingId),
    success: (next) => (next.changed ? 'Compliance programme started' : 'Already up to date'),
    failure: "Couldn't start the compliance programme", onSuccess: settle,
  });
  const apply = useReportedMutation({
    mutationFn: () => onboardingApi.applyProgrammeOwner(onboardingId),
    success: (next) => (next.changed ? `Owner assigned to ${next.changed} ${next.changed === 1 ? 'control' : 'controls'}` : 'Every control has an owner already'),
    failure: "Couldn't make the owner", onSuccess: settle,
  });
  return { query, start, apply, enabled };
}

export default function ProgrammeCard({ programme }: { programme: ReturnType<typeof useProgramme> }) {
  const { query: q, start, apply, enabled } = programme;
  if (!enabled) return null;
  if (q.isLoading) return <SectionCard id="programme" title="Compliance programme"><SkeletonLines lines={4} label="Loading the compliance programme" /></SectionCard>;
  const p = q.data;
  if (q.isError || !p) return <SectionCard id="programme" title="Compliance programme"><Notice tone="danger" title="Couldn't load it">{errorMessage(q.error)}</Notice></SectionCard>;
  const gone = p.started && !p.journey;
  const info = 'Starts the journey and loads the framework\'s controls, records your scope, proposes owners and lists what already exists as evidence candidates. Nothing is assessed or marked compliant.';

  if (!p.started || gone) {
    return (
      <SectionCard id="programme" title="Compliance programme" meta={gone ? 'Journey deleted' : 'Not started'} info={info}>
        <div className="flex flex-col items-start gap-[8px]">
          {p.note && <Notice tone="warning" title="The journey is gone">{p.note}</Notice>}
          {!p.can_start && p.why_not && <p className="text-ds-body text-ds-fg-muted">{p.why_not}</p>}
          <Button variant="primary" leftIcon={<Play aria-hidden />} disabled={!p.can_start} loading={start.isPending} onClick={() => start.mutate()}>{gone ? 'Start again' : 'Start compliance programme'}</Button>
        </div>
      </SectionCard>
    );
  }
  return (
    <SectionCard
      id="programme" title="Compliance programme" meta="Started" info={info}
      actions={p.can_start ? <Button size="sm" leftIcon={<RefreshCw aria-hidden />} loading={start.isPending} onClick={() => start.mutate()}>Refresh</Button> : undefined}
    >
      <div className="flex flex-col gap-[12px]">
        <Started p={p} />
        <Proposed p={p} applying={apply.isPending} onApply={() => apply.mutate()} />
        <div className={BLOCK}>
          <div className="flex items-center gap-[4px]">
            <p className={HEAD}>Offered as evidence</p>
            <InfoTip label="About offered evidence" text="Items from What exists. They are claims, not evidence: use one by attaching its document to a control in the journey." />
          </div>
          {p.candidates.length === 0 ? <p className="text-ds-body text-ds-fg-muted">Nothing was listed under What exists.</p> : (
            <ul aria-label="Offered as evidence" className="space-y-[8px]">{p.candidates.map((c) => <Candidate key={c.id} c={c} />)}</ul>
          )}
        </div>
        <div className={BLOCK}>
          <p className={HEAD}>Not started</p>
          <p className="text-ds-body text-ds-fg-muted">{NOT_STARTED_WORDS}</p>
        </div>
      </div>
    </SectionCard>
  );
}
