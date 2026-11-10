'use client';

// The analyses at a glance, above the register: how many, how many suppliers, the average year of the FINAL analyses added up, and how many analyses a supplier's insurance falls short of; then the five
// largest one-in-twenty years and where the insurance falls short (each opens its analysis). The figures are the server's overview (GET fair/overview). It says nothing while there is no analysis, and a
// failed read says so with Retry in place of the cards (it was silent).
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, SectionCard, Skeleton, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { vendorFairApi } from '@/lib/api';
import { statusPill } from '@/lib/status';
import { analysisRisk } from '@/lib/statuses/vendorInsights';
import { money } from '../../_lib/fair/fairModel';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import { barWidth, type Brief, type Overview } from './analysisModel';

const LINK = linkClasses({ tone: 'text', size: 'body' });
const MUTED = 'text-ds-fg-muted';
const href = (b: Brief) => `/vendor-risk/comply-analysis/${b.id}`;

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'warning' }) {
  return (
    <div className="min-w-0">
      <dt className="break-words text-ds-label text-ds-fg-muted">{label}</dt>
      <dd className="m-0">
        <span className={`block text-[20px] font-[600] leading-[28px] tabular-nums ${tone === 'warning' ? 'text-ds-warning' : 'text-ds-fg'}`}>{value}</span>
        {note && <span className="block break-words text-ds-label text-ds-fg-muted">{note}</span>}
      </dd>
    </div>
  );
}

export default function AnalysisOverview() {
  const q = useQuery({ queryKey: ['tprm-fair', 'overview'], queryFn: async () => (await vendorFairApi.overview()).data as Overview, ...TPRM_QUERY_OPTS });
  if (q.isLoading) return <SectionCard id="glance" title="The analyses at a glance"><Skeleton className="h-[72px] w-full" /></SectionCard>;
  if (q.isError) return <ErrorState compact title="Couldn't load the overview" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />;
  const o = q.data;
  if (!o || !o.count) return null;
  const top = Math.max(...o.largest.map((b) => b.p95 || 0), 1);
  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard id="glance" title="The analyses at a glance" info="The average year adds up the average years of the final analyses only.">
        <dl className="m-0 grid grid-cols-2 gap-x-[16px] gap-y-[16px] lg:grid-cols-4">
          <Figure label="Analyses" value={String(o.count)} note={`${o.finals} final · ${o.drafts} draft`} />
          <Figure label="Suppliers analysed" value={String(o.suppliers)} />
          <Figure label="Average year, final analyses" value={money(o.average_year, o.currency)} note="Their average years added up" />
          <Figure label="Insurance short of the 1-in-20 year" value={String(o.under_insured.length)} tone={o.under_insured.length > 0 ? 'warning' : undefined}
            note={o.no_cover ? `${o.no_cover} with no cover recorded` : 'Every analysis has a cover recorded'} />
        </dl>
      </SectionCard>
      <div className="grid gap-[16px] lg:grid-cols-2">
        <SectionCard id="largest" title="Largest one-in-twenty years">
          <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
            {o.largest.map((b) => (
              <li key={b.id} className="min-w-0">
                <div className="flex items-center justify-between gap-[8px] text-ds-body">
                  <Link href={href(b)} className={`min-w-0 truncate ${LINK}`}>{b.name} <span className={MUTED}>· {b.vendor.name}</span></Link>
                  <span className="flex shrink-0 items-center gap-[6px]">
                    {b.risk_level && <StatusPill size="sm" {...statusPill(analysisRisk, b.risk_level)} />}
                    <span className="tabular-nums text-ds-fg">{money(b.p95, o.currency)}</span>
                  </span>
                </div>
                <div className="mt-[4px] h-[6px] overflow-hidden rounded-full bg-ds-border" aria-hidden><div className="h-full rounded-full bg-ds-primary" style={{ width: `${barWidth(b.p95, top)}%` }} /></div>
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard id="short" title="Where the supplier’s insurance falls short">
          {o.under_insured.length === 0 ? (
            <p className="text-ds-body text-ds-fg-muted">{o.no_cover ? 'None of the covers recorded falls short. Record the others’ cover to check them too.' : 'Every supplier’s cover pays for its one-in-twenty year.'}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-ds-border p-0">
              {o.under_insured.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-[8px] py-[6px] text-ds-body">
                  <Link href={href(b)} className={`min-w-0 truncate ${LINK}`}>{b.vendor.name} <span className={MUTED}>· {b.name}</span></Link>
                  <span className="shrink-0 text-ds-label text-ds-warning">covers {money(b.cover, o.currency)} of {money(b.p95, o.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
