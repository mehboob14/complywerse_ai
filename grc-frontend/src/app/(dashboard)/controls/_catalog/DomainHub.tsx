'use client';

// "By domain": the posture of the whole catalog, then the unified library's domains, each with a bar of how its controls stand and the three numbers that ask for someone (assigned, tested,
// evidence to review). A domain is a button: it opens the domain. The figures are the server's overview, untouched; the filter only narrows the domains by name.
import { useState } from 'react';
import { ChevronRight, Layers } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton, SkeletonRows, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { StatusBar } from '@/app/(dashboard)/automation/soc2-controls/_explorer/StatusBar';
import { formatCount } from '@/lib/format';
import { KpiTiles, PostureBand } from './HubBand';
import { pct, shownDomains, type AttentionKey, type CatalogOverview, type DomainStat } from './catalogModel';

function barOf(d: DomainStat) {
  const notTested = Math.max(0, d.controls - d.effective - d.partially_effective - d.ineffective);
  return [
    { key: 'effective', label: 'Effective', value: d.effective, tone: 'success' as const },
    { key: 'partial', label: 'Partially effective', value: d.partially_effective, tone: 'warning' as const },
    { key: 'ineffective', label: 'Ineffective', value: d.ineffective, tone: 'danger' as const },
    { key: 'not_tested', label: 'Not tested', value: notTested, tone: 'neutral' as const },
  ];
}

function split(d: DomainStat): string {
  const s = d.by_source;
  if (!s) return '';
  if (!s.framework && s.internal) return 'internal controls';
  return [s.internal ? `${formatCount(s.internal)} internal` : '', s.normalized ? `${formatCount(s.normalized)} unified` : ''].filter(Boolean).join(' · ');
}

export function DomainRow({ d, onOpen }: { d: DomainStat; onOpen: (domain: string) => void }) {
  const extra = split(d);
  return (
    <li className="border-t border-ds-border first:border-t-0">
      <button
        type="button"
        onClick={() => onOpen(d.domain)}
        className="flex min-h-[56px] w-full min-w-0 flex-wrap items-center gap-x-[16px] gap-y-[6px] px-[12px] py-[8px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]"
      >
        <span className="min-w-[160px] flex-[1_1_220px]">
          <span className="block truncate text-ds-body font-[600] text-ds-fg" title={d.domain}>{d.domain}</span>
          <span className="text-ds-label text-ds-fg-muted">
            {`${formatCount(d.controls)} ${d.controls === 1 ? 'control' : 'controls'}${d.frameworks > 0 ? ` · ${formatCount(d.frameworks)} ${d.frameworks === 1 ? 'framework' : 'frameworks'}` : ''}${extra ? ` · ${extra}` : ''}`}
          </span>
        </span>
        <span className="min-w-[120px] flex-[2_1_200px]">
          <StatusBar label={d.domain} total={d.controls} parts={barOf(d)} />
        </span>
        <span className="flex min-w-[210px] flex-wrap items-center gap-x-[12px] text-ds-label tabular-nums text-ds-fg-body">
          <span>{`${formatCount(d.assigned)} assigned`}</span>
          <span>{d.tested ? `${pct(d.tested, d.controls)}% tested` : 'not tested'}</span>
          {d.evidence_pending > 0 && <span className="text-ds-warning">{`${formatCount(d.evidence_pending)} to review`}</span>}
          {(d.overdue ?? 0) > 0 && <span className="font-[600] text-ds-danger">{`${formatCount(d.overdue)} overdue`}</span>}
        </span>
        <ChevronRight aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
      </button>
    </li>
  );
}

export interface DomainHubProps {
  ov: CatalogOverview | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onOpen: (domain: string) => void;
  onAttention: (key: AttentionKey) => void;
}

export function DomainHub({ ov, loading, error, onRetry, onOpen, onAttention }: DomainHubProps) {
  const [q, setQ] = useState('');
  if (error && !ov) return <ErrorState title="Couldn’t load the catalog" message={errorMessage(error)} onRetry={canRetry(error) ? onRetry : undefined} />;
  if (loading || !ov) {
    return (
      <div aria-busy="true" className="flex flex-col gap-[12px]">
        <Skeleton className="h-[140px] w-full" />
        <SkeletonRows rows={6} columns={3} label="Loading the domains" />
      </div>
    );
  }
  const shown = shownDomains(ov.domains, q);
  return (
    <div className="flex flex-col gap-[16px]">
      <PostureBand stats={ov.totals} trend={ov.trend} onAttention={onAttention} />
      <KpiTiles stats={ov.totals} trend={ov.trend} />
      <section aria-labelledby="domains-title" className="flex flex-col gap-[8px]">
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <h2 id="domains-title" className="m-0 !text-ds-section !text-ds-fg">
            Controls by domain <span className="text-ds-label font-[400] text-ds-fg-muted">{`${formatCount(ov.domains.length)} domains · ${formatCount(ov.totals.controls)} controls`}</span>
          </h2>
          <TextInput aria-label="Filter domains" placeholder="Filter domains" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-[240px]" />
        </div>
        {ov.domains.length === 0 ? (
          <div className="rounded-ds-card border border-ds-border bg-ds-surface">
            <EmptyState kind="firstUse" bare icon={Layers} title="No controls yet" description="Choose the frameworks of your catalog, or author an internal control, to see your domains." />
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-ds-card border border-ds-border bg-ds-surface">
            <EmptyState kind="noMatches" bare title="No domains match" description={`No domain name contains “${q.trim()}”.`} onClearFilters={() => setQ('')} />
          </div>
        ) : (
          <ul aria-label="Domains" className="m-0 list-none overflow-clip rounded-ds-card border border-ds-border bg-ds-surface p-0">
            {shown.map((d) => <DomainRow key={d.domain} d={d} onOpen={onOpen} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
