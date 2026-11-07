'use client';

// The bow-tie tool: one risk with what the register holds around it. The server's bow-tie (GET analytics/bowtie/{id}) builds its picture from the register - the risk's incidents,
// the controls linked to it and its mitigation actions - and also makes up three things that looked like recorded analysis: a "potential threat" when the risk has no incident,
// consequences from a template, and "effective" on every control. Those are not shown; what is shown is labelled "Built from the register", and nothing is said that the
// register does not hold. A control and a mitigation action arrive in one list: a control carries the word "effective", an action carries its own status.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { integer } from '@/lib/addressState';
import { Button, Combobox, EmptyState, ErrorState, FormField, Notice, StatusPill, useAddressState, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { ermApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { scoreBand, BAND_LABEL } from '@/lib/erm/band';
import { categoryLabel } from '@/lib/erm/categories';
import { statusPill } from '@/lib/status';
import { mitigationStatus, severity } from '@/lib/statuses/monitoring';
import { riskOptions, useLeanRisks } from '../../_monitoring/lookups';

interface BowTie {
  risk_id: number; risk_title: string; risk_description?: string | null; risk_category?: string | null; inherent_score?: number | null; residual_score?: number | null;
  threats: Array<{ id: number; title: string; category?: string | null }>;
  preventive_controls: Array<{ id: number; name: string; code?: string | null; effectiveness?: string | null }>;
  mitigating_controls: Array<{ id: number; name: string; code?: string | null; effectiveness?: string | null }>;
}
const SCHEMA = { risk: integer(0, { min: 1 }) };

/** Splits the server's two lists into the controls linked to the risk and its mitigation actions (a control carries the literal "effective"; an action carries its status). */
export function splitBowTie(b: Pick<BowTie, 'preventive_controls' | 'mitigating_controls'>) {
  const all = b.preventive_controls.concat(b.mitigating_controls);
  return { controls: all.filter((c) => c.effectiveness === 'effective'), actions: all.filter((c) => c.effectiveness !== 'effective') };
}

const ROW = 'rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[8px]';
function Column({ title, empty, children, count }: { title: string; empty: string; count: number; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-[8px]">
      <h3 className="m-0 !text-ds-body !font-[600] !text-ds-fg">{`${title} (${formatCount(count)})`}</h3>
      {count === 0 ? <p className="rounded-ds-card border border-dashed border-ds-border-strong px-[12px] py-[10px] text-ds-body text-ds-fg-muted">{empty}</p> : <ul className="m-0 flex list-none flex-col gap-[6px] p-0">{children}</ul>}
    </section>
  );
}

export function BowTieTool() {
  const [a, set] = useAddressState(SCHEMA);
  const risks = useLeanRisks();
  const [narrative, setNarrative] = useState<{ risk: number; text: string } | null>(null);
  const q = useQuery({ queryKey: ['erm-bowtie', a.risk], queryFn: async () => (await ermApi.analytics.getBowTie(a.risk)).data as BowTie, enabled: a.risk > 0, retry: 1 });
  const ai = useReportedMutation({
    mutationFn: async (id: number) => ({ id, text: String((await ermApi.analytics.generateBowTieNarrative(id)).data.narrative ?? '') }),
    success: 'Narrative ready', failure: "Couldn't write the narrative", toast: 'none',
    onSuccess: (r) => { if (r.text.trim()) setNarrative({ risk: r.id, text: r.text }); },
  });
  const b = q.data;
  const { controls, actions } = b ? splitBowTie(b) : { controls: [], actions: [] };
  const inh = b?.inherent_score ?? null;
  const res = b?.residual_score ?? null;
  const reduction = inh && res != null ? Math.round(((inh - res) / inh) * 100) : null;
  const open = (risks.data?.items ?? []).filter((r) => !r.closure_status && (r.status || 'open') !== 'closed');

  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <FormField label="Risk" info="The risks that are open. The bow-tie is built from what the register holds for the one you choose.">
        <Combobox label="Risk" options={riskOptions(open)} value={a.risk ? String(a.risk) : null} onChange={(v) => { set({ risk: v ? Number(v) : 0 }); setNarrative(null); }} clearable searchable
          placeholder={risks.isError ? 'The risks could not be loaded' : risks.isLoading ? 'Loading the risks…' : 'Choose a risk'} disabled={risks.isError} />
      </FormField>
      {risks.isError && <ErrorState compact title="Couldn't load the risks" message={errorMessage(risks.error)} onRetry={() => { void risks.refetch(); }} />}
      {!a.risk && !risks.isError && <div className="rounded-ds-card border border-ds-border bg-ds-surface"><EmptyState bare kind="firstUse" title="Choose a risk" description="You will see its incidents, its controls and its actions side by side." /></div>}
      {a.risk > 0 && q.isLoading && <p role="status" className="text-ds-body text-ds-fg-muted">Building the bow-tie…</p>}
      {a.risk > 0 && q.isError && <ErrorState title="Couldn't build the bow-tie" message={errorMessage(q.error)} onRetry={() => { void q.refetch(); }} />}
      {b && (
        <>
          <Notice tone="info" title="Built from the register">Incidents, controls and actions are the ones linked to this risk. Nothing is added: where the register holds nothing, the column says so.</Notice>
          <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
            <div className="flex flex-wrap items-start gap-[8px]">
              <h2 className="m-0 min-w-0 flex-1 !text-ds-section !text-ds-fg [overflow-wrap:anywhere]">{b.risk_title}</h2>
              <Link href={`/erm/risks/${b.risk_id}`} className="inline-flex items-center gap-[4px] text-ds-body text-ds-primary-text underline-offset-2 hover:underline min-h-ds-control">Open the risk<ArrowUpRight aria-hidden size={14} /></Link>
            </div>
            <p className="mt-[2px] text-ds-label text-ds-fg-muted">{categoryLabel(b.risk_category)}</p>
            <dl className="m-0 mt-[12px] grid grid-cols-2 gap-[12px] sm:grid-cols-3">
              {([['Inherent score', inh], ['Residual score', res]] as const).map(([label, score]) => (
                <div key={label}><dt className="text-ds-label text-ds-fg-muted">{label}</dt><dd className="m-0 mt-[2px] flex items-center gap-[6px] text-ds-body text-ds-fg"><span className="font-[600] tabular-nums">{score ?? '—'}</span>{scoreBand(score) && <StatusPill size="sm" {...statusPill(severity, scoreBand(score) as string)} label={BAND_LABEL[scoreBand(score)!]} />}</dd></div>
              ))}
              <div><dt className="text-ds-label text-ds-fg-muted">Reduction</dt><dd className="m-0 mt-[2px] text-ds-body text-ds-fg">{reduction == null ? '—' : reduction < 0 ? 'Residual is higher than inherent' : `${reduction}%`}</dd></div>
            </dl>
          </div>
          <div className="grid gap-[16px] md:grid-cols-3">
            <Column title="Incidents" count={b.threats.filter((t) => t.id > 0).length} empty="No incident is linked to this risk.">
              {b.threats.filter((t) => t.id > 0).map((t) => <li key={t.id} className={ROW}><span className="text-ds-body text-ds-fg [overflow-wrap:anywhere]">{t.title}</span>{t.category && <span className="ml-[8px] align-middle"><StatusPill size="sm" {...statusPill(severity, t.category)} /></span>}</li>)}
            </Column>
            <Column title="Controls" count={controls.length} empty="No control is linked to this risk.">
              {controls.map((c) => <li key={`c${c.id}`} className={ROW}><span className="text-ds-body text-ds-fg [overflow-wrap:anywhere]">{c.name}</span>{c.code && <span className="block text-ds-label text-ds-fg-muted">{c.code}</span>}</li>)}
            </Column>
            <Column title="Mitigation actions" count={actions.length} empty="No action is recorded for this risk.">
              {actions.map((c) => <li key={`a${c.id}`} className={ROW}><span className="text-ds-body text-ds-fg [overflow-wrap:anywhere]">{c.name}</span><span className="ml-[8px] align-middle"><StatusPill size="sm" {...statusPill(mitigationStatus, c.effectiveness)} /></span></li>)}
            </Column>
          </div>
          <p className="text-ds-label text-ds-fg-muted">Consequences are not recorded in the register, only the impact in the scores above.</p>
          <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <p className="min-w-0 flex-1 text-ds-body font-[600] text-ds-fg">AI narrative</p>
              <Button leftIcon={<Sparkles aria-hidden />} loading={ai.isPending} onClick={() => ai.mutate(b.risk_id)}>{narrative?.risk === b.risk_id ? 'Write it again' : 'Write a narrative'}</Button>
            </div>
            {ai.isError && <div className="mt-[8px]"><ErrorState compact title="The AI could not write a narrative right now" message="Try again in a moment." /></div>}
            {narrative?.risk === b.risk_id ? <p className="mt-[8px] whitespace-pre-wrap text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{narrative.text}</p> : <p className="mt-[4px] text-ds-body text-ds-fg-muted">A short plain-language reading of this risk, its incidents, controls and actions.</p>}
          </div>
        </>
      )}
    </div>
  );
}
