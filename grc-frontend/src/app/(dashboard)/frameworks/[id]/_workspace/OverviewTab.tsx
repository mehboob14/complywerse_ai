'use client';

// The Overview tab, now for EVERY framework (a framework with an authored flow used to lose it, and with it the charts, the critical-clause analysis
// and the AI overview): the charts, the critical-clause analysis (a button, never run for you), the 3-year roadmap of a phased framework, the
// framework's AI overview or certification timeline, key figures and what needs attention.
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Sparkles } from 'lucide-react';
import apiClient, { certificationsApi } from '@/lib/api';
import {
  AccordionRow, Button, EmptyState, ErrorState, Fact, FactList, SectionCard, SkeletonRows, StatusPill,
} from '@/components/ui/ds';
import { apiErrorText, safeDetail } from '@/lib/apiError';
import { formatCount, formatDate, formatPercent } from '@/lib/format';
import { roadmapOf, type ActivityItem, type JourneyNumbers, type Waiting } from '@/lib/journeyModel';
import JourneyCharts from './JourneyCharts';
import LabelledBar from './LabelledBar';
import NextForMe from './NextForMe';
import RecentActivity from './RecentActivity';
import { useAnalyzeCritical, useGeneratePhases } from './useJourneyActions';

interface Props {
  journeyId: number;
  journey: any;
  controls: any[] | undefined;
  numbers: JourneyNumbers | null;
  canEdit: boolean;
  isCertification: boolean;
  entityLabelPlural: string;
  criteriaState: Record<number, Record<string, boolean>>;
  onOpenRequirement: (control: any) => void;
  /** the Journey tab is not there (no authored flow): this tab carries the waiting band and the recent activity */
  showWaiting: boolean;
  waiting: Waiting<any, any>;
  controlsLoading: boolean;
  controlsFailed: boolean;
  scopeLoading: boolean;
  scopeFailed: boolean;
  activity: ActivityItem[];
  goTab: (tab: string) => void;
}

export default function OverviewTab(p: Props) {
  return (
    <div className="space-y-[16px]">
      {p.showWaiting && (
        <NextForMe
          waiting={p.waiting} canReview={p.canEdit} controlsLoading={p.controlsLoading} controlsFailed={p.controlsFailed}
          scopeLoading={p.scopeLoading} scopeFailed={p.scopeFailed} onOpenRequirement={p.onOpenRequirement} goTab={p.goTab} entityLabelPlural={p.entityLabelPlural}
        />
      )}
      <JourneyCharts journeyId={p.journeyId} />
      <CriticalPanel journeyId={p.journeyId} canEdit={p.canEdit} />
      <Roadmap controls={p.controls} criteriaState={p.criteriaState} onOpenRequirement={p.onOpenRequirement} />
      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-3">
        <div className="space-y-[16px] lg:col-span-2">
          {p.isCertification ? <Timeline journeyId={p.journeyId} journey={p.journey} canEdit={p.canEdit} /> : <AiOverview overview={p.journey?.framework_overview} />}
        </div>
        <div className="space-y-[16px]">
          <KeyFigures journeyId={p.journeyId} numbers={p.numbers} controls={p.controls} entityLabelPlural={p.entityLabelPlural} />
        </div>
      </div>
      {p.showWaiting && <RecentActivity items={p.activity} scopeFailed={p.scopeFailed} goTab={p.goTab} />}
    </div>
  );
}

// ── critical clauses ─────────────────────────────────────────────────────────

function CriticalPanel({ journeyId, canEdit }: { journeyId: number; canEdit: boolean }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['critical-controls', journeyId],
    queryFn: async () => (await certificationsApi.getCriticalControls(journeyId)).data as {
      analyzed_at: string | null;
      items: Array<{ parsed_control_id: number; control_code: string; title: string; reason?: string | null }>;
    },
  });
  const analyze = useAnalyzeCritical(journeyId);
  const items = data?.items ?? [];
  const analyzed = !!data?.analyzed_at;
  const button = canEdit && (
    <Button leftIcon={<Sparkles aria-hidden />} loading={analyze.isPending} onClick={() => analyze.mutate()}>
      {analyzed || items.length ? 'Run the analysis again' : 'Run AI analysis'}
    </Button>
  );
  return (
    <SectionCard
      id="critical"
      title="Critical clauses"
      meta={isLoading || error ? undefined : analyzed ? `${formatCount(items.length)} flagged · analysed ${formatDate(data?.analyzed_at)}` : 'Not analysed yet'}
      info="AI scans the framework for clauses that need special care. A flagged clause can leave the scope only with a reviewer's approval."
      actions={button || undefined}
    >
      {isLoading ? (
        <SkeletonRows rows={2} />
      ) : error ? (
        <ErrorState compact title="Couldn't load the critical clauses" message={safeDetail(apiErrorText(error, 'Please try again.'))} onRetry={() => { void refetch(); }} />
      ) : !analyzed && items.length === 0 ? (
        <p className="text-ds-body text-ds-fg-muted">{canEdit ? 'Run the AI analysis to flag the clauses that need special care.' : 'The analysis has not been run yet. Someone who may edit frameworks can run it.'}</p>
      ) : items.length === 0 ? (
        <p className="text-ds-body text-ds-fg-muted">No critical clauses were identified for this framework.</p>
      ) : (
        <ul className="space-y-[8px]">
          {items.map((c) => (
            <li key={c.parsed_control_id} className="flex items-start gap-[8px] text-ds-body text-ds-fg-body">
              <AlertTriangle aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 text-ds-danger" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 break-words"><span className="font-[600] text-ds-fg">{c.control_code}</span> {c.title}{c.reason ? <span className="text-ds-fg-muted"> · {c.reason}</span> : null}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ── the 3-year roadmap (phased frameworks) ───────────────────────────────────

function Roadmap({ controls, criteriaState, onOpenRequirement }: { controls: any[] | undefined; criteriaState: Record<number, Record<string, boolean>>; onOpenRequirement: (c: any) => void }) {
  const roadmap = roadmapOf(controls, (c: any) => criteriaState[c.id]);
  if (!roadmap) return null;
  return (
    <SectionCard id="roadmap" title="Roadmap" meta={`${roadmap.overall}% · ${formatCount(roadmap.compliant)} of ${formatCount(roadmap.total)} specifications compliant`} info="Every specification belongs to year 1, 2 or 3. A specification scores the share of its assessment criteria that are met.">
      <div className="grid grid-cols-1 gap-[12px] md:grid-cols-3">
        {roadmap.tiers.map((t) => (
          <div key={t.tier} className="rounded-ds-card border border-ds-border p-[12px]">
            <LabelledBar label={`${t.tier} · ${t.year}`} value={t.avg} valueText={`${t.avg}%`} />
            <div className="mt-[8px] space-y-[4px]">
              {([['Compliant', t.compliant], ['In progress', t.inProgress], ['Not started', t.notStarted]] as const).map(([label, list]) => (
                <AccordionRow key={label} level={4} region={false} disabled={list.length === 0} title={label} trailing={<span className="tabular-nums">{formatCount(list.length)}</span>}>
                  <ul className="max-h-[240px] space-y-[2px] overflow-y-auto">
                    {list.map((c: any) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => onOpenRequirement(c)} className="flex min-h-ds-control w-full items-baseline gap-[8px] text-left text-ds-body text-ds-fg-body hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring">
                          <span className="shrink-0 font-[600] text-ds-primary-text">{c.control_code}</span>
                          <span className="min-w-0 truncate">{c.control_name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </AccordionRow>
              ))}
            </div>
            <p className="mt-[8px] text-ds-label text-ds-fg-muted">{formatCount(t.total)} specifications</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ── the certification timeline / the AI overview ─────────────────────────────

function Timeline({ journeyId, journey, canEdit }: { journeyId: number; journey: any; canEdit: boolean }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['journey-phases', journeyId],
    queryFn: async () => (await apiClient.get(`/certifications/${journeyId}/journey-phases`)).data as { generated?: boolean; phases?: any[] },
  });
  const generate = useGeneratePhases(journeyId);
  const phases = (data?.phases || []).map((ph: any) => ({
    n: ph.phase_number || ph.id, name: ph.name as string, description: ph.description as string | undefined,
    tasks: (ph.key_tasks || []) as string[], deliverables: (ph.deliverables || []) as string[],
  }));
  return (
    <SectionCard
      id="timeline"
      title="Certification timeline"
      actions={canEdit && !isLoading && !error ? (
        <Button leftIcon={<Sparkles aria-hidden />} loading={generate.isPending} onClick={() => generate.mutate()}>{phases.length ? 'Write it again with AI' : 'Write it with AI'}</Button>
      ) : undefined}
    >
      {isLoading ? <SkeletonRows rows={3} /> : error ? (
        <ErrorState compact title="Couldn't load the timeline" message={safeDetail(apiErrorText(error, 'Please try again.'))} onRetry={() => { void refetch(); }} />
      ) : phases.length === 0 ? (
        <EmptyState kind="firstUse" bare title="No timeline yet" description={canEdit ? 'AI can write the phases of this certification. Nothing is written until you ask.' : 'The phases of this certification have not been written yet.'} />
      ) : (
        <ol className="space-y-[8px]">
          {phases.map((ph) => {
            const current = journey?.current_phase === ph.n;
            const done = journey?.current_phase > ph.n;
            return (
              <li key={ph.n}>
                <AccordionRow
                  level={3}
                  region={false}
                  defaultOpen={current}
                  lead={<span className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-ds-control bg-ds-border text-ds-body font-[600] text-ds-fg">{ph.n}</span>}
                  title={ph.name}
                  meta={ph.description}
                  trailing={current ? <StatusPill tone="progress" label="Current phase" size="sm" /> : done ? <StatusPill tone="success" label="Completed" size="sm" /> : undefined}
                >
                  <div className="grid grid-cols-1 gap-[12px] md:grid-cols-2">
                    <div>
                      <h4 className="mb-[6px] !text-ds-label !font-[600] !text-ds-fg-muted">Key tasks</h4>
                      <ul className="list-disc space-y-[4px] pl-[20px] text-ds-body text-ds-fg-body">{ph.tasks.map((t, i) => <li key={i}>{t}</li>)}{ph.tasks.length === 0 && <li className="list-none text-ds-fg-muted">None listed.</li>}</ul>
                    </div>
                    <div>
                      <h4 className="mb-[6px] !text-ds-label !font-[600] !text-ds-fg-muted">Deliverables</h4>
                      <ul className="list-disc space-y-[4px] pl-[20px] text-ds-body text-ds-fg-body">{ph.deliverables.map((t, i) => <li key={i}>{t}</li>)}{ph.deliverables.length === 0 && <li className="list-none text-ds-fg-muted">None listed.</li>}</ul>
                    </div>
                  </div>
                </AccordionRow>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}

function AiOverview({ overview }: { overview?: { purpose?: string | null; scope?: string | null; classification_reasoning?: string | null; objectives?: string[]; adoption_approach?: string[] } }) {
  const o = overview || {};
  const empty = !o.purpose && !o.scope && !o.classification_reasoning && !(o.objectives && o.objectives.length) && !(o.adoption_approach && o.adoption_approach.length);
  const list = (items?: string[]) => (items && items.length ? <ul className="list-disc space-y-[4px] pl-[20px]">{items.slice(0, 8).map((x, i) => <li key={i}>{x}</li>)}</ul> : null);
  return (
    <SectionCard id="ai-overview" title="Framework overview" info="Written by AI when the framework was added to the library.">
      {empty ? <p className="text-ds-body text-ds-fg-muted">No overview was written for this framework.</p> : (
        <FactList>
          <Fact label="Purpose">{o.purpose}</Fact>
          <Fact label="Scope">{o.scope}</Fact>
          <Fact label="AI assessment">{o.classification_reasoning}</Fact>
          <Fact label="Key objectives">{list(o.objectives)}</Fact>
          <Fact label="Adoption approach">{list(o.adoption_approach)}</Fact>
        </FactList>
      )}
    </SectionCard>
  );
}

// ── key figures and what needs attention ─────────────────────────────────────

function KeyFigures({ journeyId, numbers, controls, entityLabelPlural }: { journeyId: number; numbers: JourneyNumbers | null; controls: any[] | undefined; entityLabelPlural: string }) {
  const gaps = useQuery({
    queryKey: ['certification-gaps', journeyId],
    queryFn: async () => (await certificationsApi.getGaps(journeyId)).data as { not_implemented?: unknown[]; missing_evidence?: unknown[]; pending_verification?: unknown[] },
  });
  const files = controls ? controls.reduce((n: number, c: any) => n + (c.evidence_count ?? (c.evidence ? c.evidence.length : 0)), 0) : null;
  const g = gaps.data;
  return (
    <>
      <SectionCard id="figures" title="Key figures">
        {numbers ? (
          <FactList>
            <Fact label={`${entityLabelPlural} implemented`}>{formatCount(numbers.implemented)} of {formatCount(numbers.applicable)}</Fact>
            <Fact label="In progress">{formatCount(numbers.inProgress)}</Fact>
            <Fact label="Not started">{formatCount(numbers.toStart)}</Fact>
            <Fact label="Evidence files">{files === null ? null : formatCount(files)}</Fact>
            <Fact label="Out of scope">{formatCount(numbers.notApplicable)}</Fact>
            <Fact label="Ready">{formatPercent(numbers.readyPct)}</Fact>
          </FactList>
        ) : <p className="text-ds-body text-ds-fg-muted">The figures are not available.</p>}
      </SectionCard>
      <SectionCard id="attention" title="Needs attention">
        {gaps.isLoading ? <SkeletonRows rows={2} /> : gaps.error ? (
          <ErrorState compact title="Couldn't load the gaps" message={safeDetail(apiErrorText(gaps.error, 'Please try again.'))} onRetry={() => { void gaps.refetch(); }} />
        ) : (
          <ul className="space-y-[6px] text-ds-body text-ds-fg-body">
            {(g?.not_implemented?.length ?? 0) > 0 && <li>{formatCount(g?.not_implemented?.length)} {entityLabelPlural.toLowerCase()} not implemented</li>}
            {(g?.missing_evidence?.length ?? 0) > 0 && <li>{formatCount(g?.missing_evidence?.length)} missing evidence</li>}
            {(g?.pending_verification?.length ?? 0) > 0 && <li>{formatCount(g?.pending_verification?.length)} waiting for verification</li>}
            {!(g?.not_implemented?.length || g?.missing_evidence?.length || g?.pending_verification?.length) && <li className="text-ds-fg-muted">Nothing needs attention.</li>}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
