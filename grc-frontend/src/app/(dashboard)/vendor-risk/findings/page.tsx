'use client';

// Findings: every gap across all vendors, as one register, tracked to closure. A switch picks Open (open and in remediation),
// Accepted, Closed or All; the severity, domain and overdue filters stay. A red line says how many findings are blocking an
// approval. The list is read-only: a row opens the finding on the vendor's Findings tab, where it is worked. The scope, the filters
// and the page live in the address. The title is the module header's (layout).

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import {
  BTN, ClearFilters, EmptyState, ErrorState, FilterFacet, PersonChip, SegmentedControl, SeverityChip, Skeleton, StatusPill, TONE, ToggleChip, fmt, tierLabel,
  tones, useUrlParams,
} from '../_ui';
import Pager from '../_lib/Pager';
import { DOMAIN_KEYS, DOMAIN_LABELS, titleCase } from '../_lib/tprmShared';
import { errText } from '../_lib/intake/types';
import { findingsKey, portfolioApi, type FindingRow } from '../_lib/portfolioApi';
import {
  CLEAR_FILTERS, PAGE_SIZE, SCOPES, acceptedLine, blockingLine, dueView, emptyCopy, filterPatch, hasFilters, listParams, readFilters, rowHref,
  sourceLabel, vendorHref,
} from '../_lib/findingsModel';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';

const SEVERITIES = ['critical', 'high', 'medium', 'low'].map((value) => ({ value, label: tierLabel(value) }));
const DOMAINS = DOMAIN_KEYS.map((value) => ({ value, label: DOMAIN_LABELS[value] || titleCase(value) }));

// `!`: the dashboard CSS gives a table header its own ink and size
const TH = 'whitespace-nowrap !bg-[#f8fafb] px-4 text-left !text-[11px] !font-semibold uppercase tracking-wide !text-[#586472]';
const MUTED = 'text-[13px] leading-5 text-[#64707e]';
const LINK = 'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

function Row({ f, onOpen }: { f: FindingRow; onOpen: () => void }) {
  const due = dueView(f);
  const until = acceptedLine(f);
  const source = sourceLabel(f.source);
  return (
    <tr onClick={(e) => { if (!(e.target as HTMLElement).closest('a, button')) onOpen(); }} className="h-14 cursor-pointer !bg-[#fff] hover:!bg-[#f8fafb]">
      <td className="px-4 align-middle"><SeverityChip severity={f.severity} /></td>
      <td className="min-w-[16rem] px-4 align-middle">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={rowHref(f)} className={`text-[14px] font-semibold leading-5 text-[#1f2933] hover:text-[#0f766e] hover:underline ${LINK}`}>{f.title || 'Untitled finding'}</Link>
          {f.is_blocking && (
            <span title="Blocks approval until closed or accepted" className="shrink-0 rounded border px-1.5 py-px text-[10px] font-bold uppercase leading-4"
              style={{ borderColor: TONE.danger.dot, color: TONE.danger.text }}>Blocking</span>
          )}
          {f.is_critical_control_fail && (
            <span className="shrink-0 rounded border px-1.5 py-px text-[10px] font-medium leading-4" style={{ borderColor: TONE.danger.border, background: TONE.danger.tint, color: TONE.danger.text }}>critical control</span>
          )}
        </div>
        <p className="text-[12px] leading-4 text-[#64707e]">{DOMAIN_LABELS[f.domain] || titleCase(f.domain)}</p>
      </td>
      <td className="px-4 align-middle">
        {f.vendor_name
          ? <Link href={vendorHref(f)} className={`text-[13px] font-medium leading-5 text-[#0f766e] hover:underline ${LINK}`}>{f.vendor_name}</Link>
          : <span className={MUTED}>—</span>}
      </td>
      <td className="px-4 align-middle">
        <div className="flex flex-col items-start gap-0.5">
          <StatusPill tone={tones.finding(f.status)} variant="inline">{f.status === 'in_remediation' ? 'In remediation' : fmt.status(f.status)}</StatusPill>
          {until && <span className="text-[12px] leading-4 text-[#64707e]">{until}</span>}
        </div>
      </td>
      <td className="px-4 align-middle">
        <span title={due.title} className="whitespace-nowrap text-[13px] leading-5" style={{ color: due.late ? TONE.danger.text : due.text === '—' ? '#64707e' : '#26323d', fontWeight: due.late ? 600 : 400 }}>{due.text}</span>
      </td>
      <td className="px-4 align-middle">
        {'owner' in f ? <PersonChip name={f.owner?.name} size="sm" /> : <span className={MUTED}>—</span>}
      </td>
      <td className="px-4 align-middle"><span className={source ? 'text-[13px] leading-5 text-[#26323d]' : MUTED}>{source ?? '—'}</span></td>
    </tr>
  );
}

export default function FindingsRegisterPage() {
  const router = useRouter();
  const params = useUrlParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const query = listParams(filters);

  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useQuery({
    queryKey: [...findingsKey, query],
    queryFn: async () => (await portfolioApi.findings(query)).data,
    placeholderData: keepPreviousData,
    ...TPRM_QUERY_OPTS,
  });

  const total = data?.total ?? 0;
  const rows = data?.items ?? [];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // a link to a page the list no longer reaches lands on the last one
  useEffect(() => {
    if (data && !isPlaceholderData && filters.page > pages) params.set({ page: pages > 1 ? String(pages) : null });
  }, [data, isPlaceholderData, filters.page, pages, params]);

  const blocking = blockingLine(data?.blocking_total);
  const filtered = hasFilters(filters);
  const empty = emptyCopy(filters.scope, filtered);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <SegmentedControl ariaLabel="Show findings" value={filters.scope} onChange={(scope) => params.set(filterPatch({ scope }))}
          options={SCOPES.map((s) => ({ value: s.value, label: s.label }))} />
        {blocking && (
          <p className="flex items-center gap-1.5 text-[13px] font-semibold leading-5" style={{ color: TONE.danger.text }}>
            <AlertTriangle aria-hidden className="h-4 w-4" strokeWidth={2} />
            {blocking}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterFacet label="Severity" single options={SEVERITIES} selected={filters.severity ? [filters.severity] : []}
          onChange={(next) => params.set(filterPatch({ severity: next[0] ?? null }))} />
        <FilterFacet label="Domain" single options={DOMAINS} selected={filters.domain ? [filters.domain] : []}
          onChange={(next) => params.set(filterPatch({ domain: next[0] ?? null }))} />
        <ToggleChip on={filters.overdue} onClick={() => params.set(filterPatch({ overdue: !filters.overdue }))}>Overdue only</ToggleChip>
        <ClearFilters visible={filtered} onClick={() => params.set(CLEAR_FILTERS)} />
      </div>

      {isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading findings">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
      ) : isError ? (
        <ErrorState title="Couldn't load the findings" message={errText(error, 'Try again in a moment.')} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={empty.title} hint={empty.hint}
          action={filtered ? <button type="button" onClick={() => params.set(CLEAR_FILTERS)} className={BTN}>Clear filters</button> : undefined} />
      ) : (
        <section aria-label="Findings" className="overflow-hidden rounded-xl border border-[#d5dbe1] bg-[#fff]">
          <div className={`overflow-x-auto ${isPlaceholderData ? 'opacity-60 transition-opacity' : ''}`}>
            <table className="min-w-full">
              <thead>
                <tr className="h-10">
                  <th scope="col" className={TH}>Severity</th>
                  <th scope="col" className={TH}>Finding</th>
                  <th scope="col" className={TH}>Vendor</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={TH}>Remediation due</th>
                  <th scope="col" className={TH}>Owner</th>
                  <th scope="col" className={TH}>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => <Row key={f.id} f={f} onOpen={() => router.push(rowHref(f))} />)}
              </tbody>
            </table>
          </div>
          <Pager page={filters.page} pageSize={PAGE_SIZE} total={total} noun="findings" onPage={(page) => params.set({ page: page > 1 ? String(page) : null })} />
        </section>
      )}
    </div>
  );
}
