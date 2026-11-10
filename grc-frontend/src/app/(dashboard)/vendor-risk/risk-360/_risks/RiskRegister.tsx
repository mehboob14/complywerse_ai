'use client';

// Insights > Risks: the third-party risks the assessment lifecycle rolls up into the enterprise Risk Register, on the facet explorer (components/records/RegisterFrame, as the Alerts register and Security
// ratings). A row opens a drawer with the residual score on the tenant's bands, the ten-domain breakdown of the supplier's active assessment and the links to the risk and the supplier. The numbers
// (total, open, average residual, every score) are the server's; this file filters and orders them. A failed read says so with Retry: it never reads as "no third-party risks".
import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Shield } from 'lucide-react';
import { Button, EmptyState, FactList, Fact, Menu, ProgressBar, StatusPill, type MenuItem, type ProgressTone } from '@/components/ui/ds';
import { RecordDetail, RegisterFrame } from '@/components/records/RegisterFrame';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { tpraApi } from '@/lib/api';
import { EMPTY, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { riskStatus } from '@/lib/statuses/risk';
import { vendorBand, vendorTier } from '@/lib/statuses/vendor';
import { useBands } from '../../_overview/overviewData';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import type { Band } from '../../_lib/vendorRules';
import { RISK_SCHEMA, bandOf, domainRows, hasDomains, headLine, riskDef, scoreWords, statusOf, tierOf, titleOf, type RiskAnswer, type RiskRow } from './riskModel';

const MUTED = 'text-ds-fg-muted';
const LINK = linkClasses({ tone: 'text', size: 'label' });
const BAR: Record<Band, ProgressTone> = { critical: 'danger', high: 'warning', medium: 'primary', low: 'success', none: 'primary' };
export const RISK_KEY = ['tprm-risk-register'] as const;
const riskHref = (r: RiskRow) => `/erm/risks/${r.id}`;
const supplierHref = (r: RiskRow) => `/vendor-risk/vendors/${r.vendor_id}`;

export interface RiskHeadProps { meta?: string; info: string; actions: React.ReactNode }

export default function RiskRegister({ label, info, head, onDomains }: { label: string; info: string; head: (h: RiskHeadProps) => React.ReactNode; onDomains: () => void }) {
  const router = useRouter();
  const bands = useBands();
  const def = useMemo(() => riskDef(bands), [bands]);
  const q = useQuery({ queryKey: RISK_KEY, queryFn: async () => (await tpraApi.riskRegister()).data as RiskAnswer, ...TPRM_QUERY_OPTS });
  const rows = useMemo(() => q.data?.items ?? [], [q.data]);

  const score = (r: RiskRow) => (r.residual_score === null
    ? <span className={`text-ds-body ${MUTED}`}>Not scored</span>
    : <span className="inline-flex flex-wrap items-center gap-[6px]"><span className="tabular-nums text-ds-body font-[600] text-ds-fg">{r.residual_score}</span><StatusPill size="sm" {...statusPill(vendorBand, bandOf(r, bands))} /></span>);
  const columns: RecordColumn<RiskRow>[] = [
    {
      key: 'title', header: 'Risk', sortKey: 'title',
      cell: (row) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={titleOf(row.record)}>{titleOf(row.record)}</span>
          <span className={`block truncate text-ds-label ${MUTED}`}>{row.record.vendor_name ?? 'Not linked to a supplier'}</span>
        </div>
      ),
    },
    { key: 'residual', header: 'Residual', sortKey: 'residual', firstDir: 'desc', fit: { px: 170 }, cell: (row) => score(row.record) },
    { key: 'inherent', header: 'Inherent', sortKey: 'inherent', firstDir: 'desc', fit: { px: 92, dropRank: 3 }, cell: (row) => <span className={`tabular-nums text-ds-body ${row.record.inherent_score === null ? MUTED : 'text-ds-fg'}`}>{row.record.inherent_score ?? EMPTY}</span> },
    { key: 'tier', header: 'Tier', fit: { px: 104, dropRank: 2 }, cell: (row) => (tierOf(row.record) === 'none' ? <span className={`text-ds-body ${MUTED}`}>Not tiered</span> : <StatusPill size="sm" {...statusPill(vendorTier, tierOf(row.record))} />) },
    { key: 'status', header: 'Status', sortKey: 'status', fit: { px: 130 }, cell: (row) => <StatusPill size="sm" {...statusPill(riskStatus, statusOf(row.record))} /> },
    { key: 'updated', header: 'Updated', sortKey: 'updated', firstDir: 'desc', fit: { px: 112, dropRank: 1 }, cell: (row) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{row.record.updated_at ? formatDate(row.record.updated_at) : EMPTY}</span> },
  ];
  const card = (row: RecordRow<RiskRow>) => (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{titleOf(row.record)}</span>
      <span className="flex flex-wrap items-center gap-[8px]">{score(row.record)}<StatusPill size="sm" {...statusPill(riskStatus, statusOf(row.record))} /></span>
      <span className={`truncate text-ds-label ${MUTED}`}>{row.record.vendor_name ?? 'Not linked to a supplier'}</span>
    </div>
  );
  const menu = (r: RiskRow) => {
    const items: MenuItem[] = [{ key: 'risk', label: 'Open the risk', icon: ArrowUpRight, onSelect: () => router.push(riskHref(r)) }];
    if (r.vendor_id) items.push({ key: 'supplier', label: 'Open the supplier', icon: ArrowUpRight, onSelect: () => router.push(supplierHref(r)) });
    return <Menu iconOnly label={`Actions for ${titleOf(r).slice(0, 60)}`} items={items} />;
  };

  const a = q.data;
  const actions = (
    <>
      <Button onClick={onDomains}>Domains</Button>
      <Button href="/erm/risks/list" rightIcon={<ArrowUpRight aria-hidden />}>Risk Register</Button>
    </>
  );

  return (
    <RegisterFrame
      def={def}
      schema={RISK_SCHEMA}
      label={label}
      rows={rows}
      loading={q.isLoading}
      error={q.isError && !q.data ? q.error : undefined}
      refreshError={q.isError && q.data ? q.error : undefined}
      onRetry={() => { void q.refetch(); }}
      head={() => head({ meta: a ? headLine(a) : undefined, info, actions })}
      columns={columns}
      card={card}
      boardCard={() => null}
      boardLabel={(r) => titleOf(r)}
      rowActions={menu}
      rowLabel={(r) => `Select ${titleOf(r).slice(0, 60)}`}
      searchLabel="Search risks by title or supplier"
      noAccess={{ title: "You don't have access to the third-party risks", reason: errorMessage(q.error) }}
      emptyFirst={(
        <EmptyState
          bare kind="firstUse" icon={Shield} title="No third-party risks in the Risk Register yet"
          description="Score a supplier's assessment (its Scoring stage) and its residual risk rolls up into the enterprise Risk Register, and appears here."
          action={<Link href="/vendor-risk/vendors" className={LINK}>Open the vendor register</Link>}
        />
      )}
      detail={(open, nav) => (
        <RecordDetail
          id={open?.id ?? null}
          nav={nav}
          title={<span dir="auto" className="line-clamp-3 break-words">{open ? titleOf(open) : ''}</span>}
          subtitle={open ? scoreWords(open, bands) : undefined}
          footer={open ? (
            <div className="flex flex-wrap items-center justify-end gap-[8px]">
              {open.vendor_id && <Button href={supplierHref(open)}>Open the supplier</Button>}
              <Button href={riskHref(open)} variant="primary" rightIcon={<ArrowUpRight aria-hidden />}>Open the risk</Button>
            </div>
          ) : undefined}
        >
          {open && <RiskFacts r={open} bands={bands} />}
        </RecordDetail>
      )}
    />
  );
}

function RiskFacts({ r, bands }: { r: RiskRow; bands: ReturnType<typeof useBands> }) {
  const rows = domainRows(r, bands);
  const score = r.residual_score;
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <StatusPill size="sm" {...statusPill(riskStatus, statusOf(r))} />
        {tierOf(r) !== 'none' && <StatusPill size="sm" {...statusPill(vendorTier, tierOf(r))} label={`${vendorTier.label(tierOf(r))} tier`} />}
      </div>
      <FactList min={150}>
        <Fact label="Supplier">{r.vendor_name ? <Link href={supplierHref(r)} className={LINK}>{r.vendor_name}</Link> : null}</Fact>
        <Fact label="Inherent score">{r.inherent_score === null ? null : <span className="tabular-nums">{r.inherent_score} out of 100</span>}</Fact>
        <Fact label="Residual score">{score === null ? null : <ProgressBar value={score} label="Residual score" valueText={`${score} out of 100`} tone={BAR[bandOf(r, bands)]} className="max-w-[220px]" />}</Fact>
        <Fact label="Register">{r.register_type}</Fact>
        <Fact label="Last updated">{r.updated_at ? formatDate(r.updated_at) : null}</Fact>
      </FactList>
      <section className="flex flex-col gap-[6px]">
        <h3 className="m-0 !text-ds-label !font-[600] !text-ds-fg-muted">Residual by domain</h3>
        {!hasDomains(r) ? (
          <p className={`text-ds-body ${MUTED}`}>No domain scores yet. Run scoring on the supplier’s assessment and its ten domains appear here.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
            {rows.map((d) => (
              <li key={d.key} className="min-w-0">
                <div className="flex items-baseline justify-between gap-[8px] text-ds-body text-ds-fg">
                  <span className="min-w-0 break-words">{d.label}</span>
                  {d.residual === null ? <span className={`shrink-0 text-ds-label ${MUTED}`}>Not assessed</span> : <span className="shrink-0 tabular-nums font-[600]">{d.residual}</span>}
                </div>
                {d.residual === null
                  ? <div className="mt-[4px] h-[6px] rounded-full border border-dashed border-ds-border-strong" role="img" aria-label={`${d.label}: not assessed`} />
                  : <ProgressBar value={d.residual} label={`${d.label} residual`} showValue={false} tone={BAR[d.band]} className="mt-[4px]" />}
                {d.covered !== null && <p className={`text-ds-label ${MUTED}`}>{d.covered}% of its questions answered</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
