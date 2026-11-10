'use client';

// Insights > Comply analyses: one loss scenario at one supplier, taken apart factor by factor and simulated into the range of what a year could cost, on the facet explorer (RegisterFrame). The overview
// above it is the server's; a row opens a drawer with the figures and the way into the analysis. New analysis and Import are Sheets. Who may change analyses is the server's rule (assessments:edit or
// the risk-edit right); everyone signed in may read. A failed read says so with Retry; it never reads as "no analyses yet".
import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Download, FileSpreadsheet, Plus, Upload } from 'lucide-react';
import { Button, EmptyState, Fact, FactList, Menu, StatusPill, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { RecordDetail, RegisterFrame } from '@/components/records/RegisterFrame';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { usePermissions } from '@/hooks/usePermissions';
import { vendorFairApi } from '@/lib/api';
import { EMPTY, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { vendorTier } from '@/lib/statuses/vendor';
import { EFFECT_WORDS, analysisCover, analysisRisk, analysisState } from '@/lib/statuses/vendorInsights';
import { download } from '../../_lib/fair/shared';
import { money, oneIn, pct } from '../../_lib/fair/fairModel';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import AnalysisOverview from './AnalysisOverview';
import { ANALYSIS_SCHEMA, analysisDef, coverOf, headLine, isFinal, tierOf, type AnalysisRow, type ListAnswer } from './analysisModel';

const MUTED = 'text-ds-fg-muted';
const LINK = linkClasses({ tone: 'text', size: 'label' });
const hrefOf = (r: AnalysisRow) => `/vendor-risk/comply-analysis/${r.id}`;

export interface AnalysesHeadProps { meta?: string; info: string; actions: React.ReactNode }

export default function AnalysisRegister({ label, info, head, onNew, onImport }: { label: string; info: string; head: (h: AnalysesHeadProps) => React.ReactNode; onNew: () => void; onImport: () => void }) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');       // the server's rule for creating and importing
  const def = useMemo(() => analysisDef(), []);
  const q = useQuery<ListAnswer>({ queryKey: ['tprm-fair'], queryFn: async () => (await vendorFairApi.list()).data, ...TPRM_QUERY_OPTS });
  const rows = useMemo(() => q.data?.items ?? [], [q.data]);
  const currency = q.data?.currency ?? 'USD';
  const exportAll = useReportedMutation({
    mutationFn: async () => download((await vendorFairApi.exportAll()).data as Blob, 'comply-analyses.csv'),
    failure: 'The analyses could not be exported.',
    toast: 'errors',
  });

  const money1 = (v: number | null | undefined) => <span className={`tabular-nums text-ds-body ${v == null ? MUTED : 'text-ds-fg'}`}>{v == null ? EMPTY : money(v, currency)}</span>;
  const columns: RecordColumn<AnalysisRow>[] = [
    {
      key: 'name', header: 'Analysis', sortKey: 'name',
      cell: (row) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={row.record.name}>{row.record.name}</span>
          <span className={`flex min-w-0 flex-wrap items-center gap-[6px] text-ds-label ${MUTED}`}>
            <span className="truncate">{row.record.vendor.name}</span>
            {tierOf(row.record) !== 'none' && <StatusPill size="sm" {...statusPill(vendorTier, tierOf(row.record))} />}
            <StatusPill size="sm" {...statusPill(analysisState, row.record.status)} />
          </span>
        </div>
      ),
    },
    { key: 'effect', header: 'Scenario', fit: { px: 150, dropRank: 3 }, cell: (row) => <span className="text-ds-body text-ds-fg-body">{EFFECT_WORDS[row.record.effect]}</span> },
    { key: 'chance', header: 'Chance a year', sortKey: 'chance', firstDir: 'desc', fit: { px: 120 }, cell: (row) => <span className={`tabular-nums text-ds-body ${row.record.annual ? 'text-ds-fg' : MUTED}`}>{row.record.annual ? pct(row.record.annual.chance) : EMPTY}</span> },
    { key: 'mean', header: 'Average year', sortKey: 'mean', firstDir: 'desc', fit: { px: 120 }, cell: (row) => money1(row.record.annual?.mean) },
    { key: 'p95', header: '1 year in 20', sortKey: 'p95', firstDir: 'desc', fit: { px: 116, dropRank: 2 }, cell: (row) => money1(row.record.annual?.p95) },
    { key: 'cap', header: 'Least liability cap', sortKey: 'cap', firstDir: 'desc', fit: { px: 140, dropRank: 1 }, cell: (row) => money1(row.record.liability_cap) },
  ];
  const card = (row: RecordRow<AnalysisRow>) => (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{row.record.name}</span>
      <span className="flex flex-wrap items-center gap-[8px]"><StatusPill size="sm" {...statusPill(analysisState, row.record.status)} /><span className={`truncate text-ds-label ${MUTED}`}>{row.record.vendor.name}</span></span>
      <span className="text-ds-label text-ds-fg-body">{row.record.annual ? `${pct(row.record.annual.chance)} chance a year · average ${money(row.record.annual.mean, currency)} · 1 in 20 ${money(row.record.annual.p95, currency)}` : 'Not run yet'}</span>
    </div>
  );
  const menu = (r: AnalysisRow) => {
    const items: MenuItem[] = [{ key: 'open', label: 'Open the analysis', icon: ArrowUpRight, onSelect: () => router.push(hrefOf(r)) }];
    items.push({ key: 'supplier', label: 'Open the supplier', icon: ArrowUpRight, onSelect: () => router.push(`/vendor-risk/vendors/${r.vendor.id}?tab=exposure`) });
    return <Menu iconOnly label={`Actions for ${r.name.slice(0, 60)}`} items={items} />;
  };
  const actions = (
    <>
      <Button leftIcon={<Download aria-hidden />} disabled={!rows.length} loading={exportAll.isPending} onClick={() => exportAll.mutate()}>Export</Button>
      {canEdit && <Button leftIcon={<Upload aria-hidden />} onClick={onImport}>Import</Button>}
      {canEdit && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onNew}>New analysis</Button>}
    </>
  );

  return (
    <RegisterFrame
      def={def}
      schema={ANALYSIS_SCHEMA}
      label={label}
      rows={rows}
      loading={q.isLoading}
      error={q.isError && !q.data ? q.error : undefined}
      refreshError={q.isError && q.data ? q.error : undefined}
      onRetry={() => { void q.refetch(); }}
      head={() => head({ meta: q.data ? headLine({ count: rows.length, suppliers: new Set(rows.map((r) => r.vendor.id)).size, finals: rows.filter(isFinal).length }) : undefined, info, actions })}
      notices={<AnalysisOverview />}
      columns={columns}
      card={card}
      boardCard={() => null}
      boardLabel={(r) => r.name}
      rowActions={menu}
      rowLabel={(r) => `Select ${r.name.slice(0, 60)}`}
      searchLabel="Search analyses by name or supplier"
      noAccess={{ title: "You don't have access to the Comply analyses", reason: errorMessage(q.error) }}
      emptyFirst={(
        <EmptyState
          bare kind="firstUse" icon={FileSpreadsheet} title="No analyses yet"
          description="Start one from a supplier; it is prefilled from what we already hold about it."
          action={canEdit ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onNew}>New analysis</Button> : <Link href="/vendor-risk/vendors" className={LINK}>Open the vendor register</Link>}
        />
      )}
      detail={(open, nav) => (
        <RecordDetail
          id={open?.id ?? null}
          nav={nav}
          title={<span dir="auto" className="line-clamp-3 break-words">{open?.name}</span>}
          subtitle={open ? `${open.vendor.name} · ${EFFECT_WORDS[open.effect]}` : undefined}
          footer={open ? <Button href={hrefOf(open)} variant="primary" rightIcon={<ArrowUpRight aria-hidden />}>Open the analysis</Button> : undefined}
        >
          {open && (
            <div className="flex flex-col gap-[16px]">
              <div className="flex flex-wrap items-center gap-[8px]">
                <StatusPill size="sm" {...statusPill(analysisState, open.status)} />
                <StatusPill size="sm" {...statusPill(analysisCover, coverOf(open))} />
                {open.risk_level && <StatusPill size="sm" {...statusPill(analysisRisk, open.risk_level)} />}
              </div>
              <FactList min={150}>
                <Fact label="Supplier"><Link href={`/vendor-risk/vendors/${open.vendor.id}?tab=exposure`} className={LINK}>{open.vendor.name}</Link></Fact>
                <Fact label="Chance of a loss in a year">{open.annual ? `${pct(open.annual.chance)}, ${oneIn(open.annual.chance)}` : null}</Fact>
                <Fact label="Average year">{open.annual ? money(open.annual.mean, currency) : null}</Fact>
                <Fact label="One year in twenty">{open.annual ? money(open.annual.p95, currency) : null}</Fact>
                <Fact label="Least liability cap to accept">{open.liability_cap != null ? money(open.liability_cap, currency) : null}</Fact>
                <Fact label="Supplier’s insurance cover" empty="Not recorded">{open.insurance_cover != null ? money(open.insurance_cover, currency) : null}</Fact>
                <Fact label="Last updated">{open.updated_at ? formatDate(open.updated_at) : null}</Fact>
              </FactList>
            </div>
          )}
        </RecordDetail>
      )}
    />
  );
}
