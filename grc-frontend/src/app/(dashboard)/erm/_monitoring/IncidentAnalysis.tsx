'use client';

// The AI analysis of one incident, in a side panel: the cause, how bad it is on four counts, the risks and controls it touches, what to do, and similar incidents. It asks when
// it opens (the analysis is a request of its own), says so while it works, and a failure has its words and a Retry. "Save" keeps the result for everyone who can open the incident.
import { useQuery } from '@tanstack/react-query';
import { SidePanel, ErrorState, Fact, FactList, SkeletonRows, StatusPill } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import AiRecommendationSaver from '@/components/ai/AiRecommendationSaver';
import { ermApi } from '@/lib/api';
import { statusLabel } from '@/lib/format';
import type { Tone } from '@/lib/status';
import { severity } from '@/lib/statuses/monitoring';
import type { IncidentRow } from './incidentModel';

const LEVEL_TONE = (word: string): Tone => (severity.has(word) ? severity.tone(word) : 'neutral');
const H = 'm-0 mb-[8px] !text-ds-body !font-[600] !text-ds-fg';
const ROW = 'rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[8px]';

export function IncidentAnalysis({ incident, onClose }: { incident: IncidentRow | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['erm-incident-analysis', incident?.id],
    queryFn: async () => (await ermApi.incidents.analyzeWithAI({
      title: incident!.title, description: incident!.description ?? '', severity: incident!.severity, incident_date: incident!.incident_date,
    })).data,
    enabled: !!incident,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const a = q.data;
  return (
    <SidePanel open={!!incident} onClose={onClose} title="AI analysis" subtitle={incident?.title} dockFrom={Infinity} width="lg">
      {q.isFetching && !a && <div role="status" aria-busy="true"><p className="mb-[8px] text-ds-body text-ds-fg-muted">The AI is reading the incident. This takes a few seconds.</p><SkeletonRows rows={5} columns={1} label="Analysing the incident" /></div>}
      {q.isError && <ErrorState title="Couldn't analyse this incident" message={errorMessage(q.error)} onRetry={() => { void q.refetch(); }} />}
      {a && incident && (
        <div className="flex flex-col gap-[20px]">
          <AiRecommendationSaver module="erm_incident" recommendationType="ai_analysis" entityType="incident" entityId={incident.id} title={`AI analysis · ${incident.title}`} output={a as unknown as Record<string, unknown>} />
          <section>
            <h3 className={H}>Root cause</h3>
            <p className="text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{a.root_cause_analysis.primary_cause}</p>
            {a.root_cause_analysis.contributing_factors.length > 0 && (
              <ul className="mt-[8px] list-disc pl-[18px] text-ds-body text-ds-fg-body">{a.root_cause_analysis.contributing_factors.map((f, i) => <li key={i}>{f}</li>)}</ul>
            )}
            <div className="mt-[8px] flex flex-wrap gap-[8px]">
              <StatusPill tone="neutral" label={statusLabel(a.root_cause_analysis.category)} />
              <StatusPill tone="neutral" label={`${statusLabel(a.root_cause_analysis.preventability)} preventability`} />
            </div>
          </section>
          <section>
            <h3 className={H}>How bad</h3>
            <FactList variant="boxed" min={130}>
              {([['Financial', a.impact_assessment.financial_impact], ['Reputational', a.impact_assessment.reputational_impact], ['Regulatory', a.impact_assessment.regulatory_impact], ['Operational', a.impact_assessment.operational_impact]] as const).map(([name, level]) => (
                <Fact key={name} label={name}><StatusPill tone={LEVEL_TONE(level)} label={statusLabel(level)} /></Fact>
              ))}
            </FactList>
          </section>
          {a.related_risks.length > 0 && (
            <section>
              <h3 className={H}>Related risks</h3>
              <ul className="m-0 flex list-none flex-col gap-[8px] p-0">{a.related_risks.map((r, i) => (
                <li key={i} className={ROW}><span className="text-ds-body font-[600] text-ds-fg">{r.risk_title}</span><span className="ml-[8px] text-ds-label text-ds-fg-muted">{statusLabel(r.relevance)} relevance</span><p className="text-ds-body text-ds-fg-body">{r.explanation}</p></li>
              ))}</ul>
            </section>
          )}
          {a.related_controls.length > 0 && (
            <section>
              <h3 className={H}>Related controls</h3>
              <ul className="m-0 flex list-none flex-col gap-[8px] p-0">{a.related_controls.map((c, i) => (
                <li key={i} className={ROW}><span className="text-ds-body font-[600] text-ds-fg">{c.control_title}</span>{c.framework && <span className="ml-[8px] text-ds-label text-ds-fg-muted">{c.framework}</span>}<p className="text-ds-body text-ds-fg-body">{c.status_recommendation}</p></li>
              ))}</ul>
            </section>
          )}
          {a.recommended_actions.length > 0 && (
            <section>
              <h3 className={H}>What to do</h3>
              <ol className="m-0 list-decimal pl-[20px] text-ds-body text-ds-fg-body">{a.recommended_actions.map((r, i) => <li key={i} className="mb-[4px]">{r}</li>)}</ol>
            </section>
          )}
          {a.similar_incidents.length > 0 && (
            <section>
              <h3 className={H}>Similar incidents</h3>
              <ul className="m-0 flex list-none flex-col gap-[6px] p-0">{a.similar_incidents.map((s, i) => (
                <li key={i} className={`${ROW} flex items-center justify-between gap-[8px]`}><span className="min-w-0 text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{s.title}</span><span className="shrink-0 text-ds-label text-ds-fg-muted">{Math.round(s.similarity * 100)}% alike</span></li>
              ))}</ul>
            </section>
          )}
        </div>
      )}
    </SidePanel>
  );
}
