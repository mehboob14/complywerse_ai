'use client';

/**
 * The Cyber Security KPI report: the KPIs the uploaded workbook defines, with the actual value computed live where the platform owns the data and "external" where it does not (no
 * number is invented). A press opens the KPI: its formula, source and the history kept. Reading the live values is a GET that writes nothing; once per visit, after the read, this
 * lens asks the server to keep today's value of every live KPI (`POST /kpi-live/snapshot`), which is what makes the trend grow. Add KPI appends one to the report.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus } from 'lucide-react';
import { Button, DebouncedSearch, EmptyState, ErrorState, FormField, ProgressBar, RegisterTable, SidePanel, SkeletonLines, StatusPill, Textarea, TextInput, useAddressState, useReportedMutation, type RegisterColumn } from '@/components/ui/ds';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { text } from '@/lib/addressState';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { rowCountText } from '@/components/ui/ds/tableModel';
import { EMPTY, formatCount, formatDate } from '@/lib/format';
import { buildKpis, type Kpi } from '@/components/dashboard/kpiShared';
import { statusPill } from '@/lib/status';
import { kpiStanding } from '@/lib/statuses/assessmentLenses';
import type { LensProps } from '../workspace/lens';
import { LensFigures } from './LensFigures';
import { lensApi } from './lensApi';
import { matchesText } from './lensData';
import { countKpis, kpiRemarks, orderKpis, stateOf } from './kpiModel';
import type { Tile } from './profiles';
import { useLensData } from './useLensData';

const SCHEMA = { q: text(), kpi: text() };
const pct = (v: number | null): string => (v == null ? EMPTY : `${Math.round(v)}%`);
const EMPTY_FORM = { number: '', domain: '', name: '', definition: '', source: '' };

export default function KpiLens({ assessmentId, readOnly, onChanged }: LensProps) {
  const { query, detail } = useLensData(assessmentId);
  const live = useQuery({ queryKey: ['assessment-lens-kpi-live'], queryFn: lensApi.kpiLive, staleTime: 30_000 });
  const [a, set] = useAddressState(SCHEMA);
  const [adding, setAdding] = useState(false);

  // once per visit, after the read: keep today's value (fire and forget; a failure is not the person's business)
  const kept = useRef(false);
  useEffect(() => {
    if (!live.isSuccess || kept.current) return;
    kept.current = true;
    void lensApi.snapshotKpis().catch(() => undefined);
  }, [live.isSuccess]);

  const kpis = useMemo(() => orderKpis(buildKpis(detail?.items ?? [], live.data ?? {})), [detail, live.data]);
  const counts = countKpis(kpis);
  const shown = useMemo(() => kpis.filter((k) => matchesText(`${k.domain} ${k.topic} ${k.def}`, a.q)), [kpis, a.q]);
  const key = (k: Kpi): string => `${k.domain}|${k.topic}`;
  const opened = a.kpi ? kpis.find((k) => key(k) === a.kpi) ?? null : null;

  if (query.isPending) return <SkeletonLines lines={6} label="Loading the KPI report" />;
  if (query.isError || !detail) return <ErrorState title="Couldn't load the KPI report" message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />;

  const figures: Tile[] = [
    { label: 'Live KPIs', value: formatCount(counts.live), note: `${formatCount(counts.total)} in the report`, info: 'KPIs the platform computes from its own modules.' },
    { label: 'On target', value: formatCount(counts.onTarget), tone: counts.onTarget ? 'success' : 'default' },
    { label: 'Below target', value: formatCount(counts.below), tone: counts.below ? 'danger' : 'default' },
    { label: 'External', value: formatCount(counts.external), note: 'no feed from the platform', info: 'Measured outside the platform: no number is shown for them.' },
  ];
  const columns: Array<RegisterColumn<Kpi>> = [
    {
      key: 'kpi', header: 'KPI', isRowHeader: true, width: 'w-[44%]',
      cell: (k) => (<span className="block min-w-0"><span className="block text-ds-label text-ds-fg-muted">{k.domain}</span><span className="line-clamp-2 break-words text-ds-body text-ds-fg" title={k.topic}>{k.topic}</span></span>),
    },
    { key: 'state', header: 'Status', card: 'meta', cell: (k) => <StatusPill {...statusPill(kpiStanding, stateOf(k))} size="sm" /> },
    { key: 'actual', header: 'Actual', align: 'right', card: 'meta', cell: (k) => <span className="text-ds-body tabular-nums text-ds-fg">{k.live ? pct(k.actual) : EMPTY}</span> },
    { key: 'target', header: 'Target', align: 'right', priority: 2, card: 'meta', cell: (k) => <span className="text-ds-body tabular-nums text-ds-fg-body">{k.live ? pct(k.target) : EMPTY}</span> },
    { key: 'bar', header: 'Progress', priority: 3, card: 'hide', width: 'w-[160px]', cell: (k) => (k.live ? <ProgressBar value={k.actual} label={`${k.topic} actual`} showValue={false} tone={k.onTarget === false ? 'danger' : 'success'} /> : <span className="text-ds-body text-ds-fg-muted">{EMPTY}</span>) },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <LensFigures figures={figures} />
      {live.isError && <ErrorState title="Couldn't load the live values" message={errorMessage(live.error)} onRetry={canRetry(live.error) ? () => { void live.refetch(); } : undefined} />}
      <div className="flex flex-wrap items-center gap-[8px]">
        <DebouncedSearch className="w-full sm:w-[280px]" label="Search KPIs" placeholder="Search KPIs" value={a.q} onSearch={(q) => set({ q })} />
        <span className="text-ds-label text-ds-fg-muted" role="status">{rowCountText({ shown: shown.length, total: shown.length, noun: 'KPI' })}{a.q.trim() ? ` of ${formatCount(kpis.length)}` : ''}</span>
        {!readOnly && <Button className="ml-auto" variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add KPI</Button>}
      </div>
      {kpis.length === 0 ? (
        <EmptyState kind="firstUse" title="No KPI yet" description={readOnly ? 'The report has no KPI.' : 'Add a KPI, or refresh the report from its workbook (Actions menu).'} />
      ) : shown.length === 0 ? (
        <EmptyState kind="noMatches" title="No KPI matches" description="Change the search." onClearFilters={() => set({ q: '' })} />
      ) : (
        <RegisterTable
          caption="KPIs" columns={columns} rows={shown} getRowId={key} onRowActivate={(k) => set({ kpi: key(k) })} selectedId={opened ? key(opened) : null}
          cardTitle={(k) => <span className="block min-w-0"><span className="block text-ds-label text-ds-fg-muted">{k.domain}</span><span className="line-clamp-3 break-words text-ds-body font-[600] text-ds-fg">{k.topic}</span></span>}
        />
      )}
      {opened && (
        <SidePanel open onClose={() => set({ kpi: '' })} title={opened.topic} width="md" dockFrom={Infinity} subtitle={<span className="flex flex-wrap items-center gap-[8px]"><StatusPill {...statusPill(kpiStanding, stateOf(opened))} size="sm" /><span className="text-ds-label text-ds-fg-muted">{opened.domain}</span></span>}>
          <div className="flex flex-col gap-[16px]">
            <dl className="grid grid-cols-2 gap-[12px]">
              <div><dt className="text-ds-label text-ds-fg-muted">Actual</dt><dd className="text-ds-section font-[600] tabular-nums text-ds-fg">{opened.live ? pct(opened.actual) : EMPTY}</dd></div>
              <div><dt className="text-ds-label text-ds-fg-muted">Target</dt><dd className="text-ds-section font-[600] tabular-nums text-ds-fg">{opened.live ? pct(opened.target) : EMPTY}</dd></div>
            </dl>
            <div><p className="text-ds-label text-ds-fg-muted">{opened.live ? 'How it is measured' : 'Definition'}</p><p className="break-words text-ds-body text-ds-fg">{opened.def || EMPTY}</p></div>
            {opened.live && opened.denominator != null && <p className="text-ds-body text-ds-fg-body">{formatCount(opened.numerator ?? 0)} of {formatCount(opened.denominator)}</p>}
            {opened.live ? (
              <p className="text-ds-body text-ds-fg-body">Source: {opened.source}{opened.href ? <> · <Link href={opened.href} className="inline-flex items-center gap-[4px] text-ds-primary-text underline">Open it<ExternalLink aria-hidden className="h-[12px] w-[12px]" /></Link></> : null}</p>
            ) : (
              <p className="text-ds-body text-ds-fg-body">Measured outside the platform: {opened.extSource}. No number is shown.</p>
            )}
            {opened.live && (
              <div>
                <p className="mb-[4px] text-ds-label text-ds-fg-muted">History kept</p>
                {opened.history.filter((h) => h.value != null).length === 0 ? <p className="text-ds-body text-ds-fg-muted">No history yet. A value is kept for each day this report is opened.</p> : (
                  <ul className="flex flex-col divide-y divide-ds-border">
                    {opened.history.filter((h) => h.value != null).slice(-12).reverse().map((h) => (
                      <li key={h.date} className="flex items-center justify-between py-[6px] text-ds-body"><span className="text-ds-fg-body">{formatDate(h.date, { calendar: true })}</span><span className="tabular-nums text-ds-fg">{pct(h.value)}</span></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </SidePanel>
      )}
      {adding && <AddKpi assessmentId={assessmentId} onClose={() => setAdding(false)} onAdded={() => { void query.refetch(); onChanged(); }} />}
    </div>
  );
}

function AddKpi({ assessmentId, onClose, onAdded }: { assessmentId: number; onClose: () => void; onAdded: () => void }) {
  const [f, setF] = useState(EMPTY_FORM);
  const set = (k: keyof typeof EMPTY_FORM, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY_FORM);
  const create = useReportedMutation({
    mutationFn: () => lensApi.addKpi(assessmentId, {
      item_number: f.number.trim() || undefined, area_domain: f.domain.trim() || undefined, control_description: f.name.trim(), remarks: kpiRemarks(f.definition, f.source) || undefined,
    }),
    success: 'KPI added',
    failure: "Couldn't add the KPI",
    retryable: false,
    onSuccess: () => { onAdded(); onClose(); },
  });
  return (
    <AnimatedModal isOpen onClose={onClose} title="Add a KPI" subtitle="It is added to this report as an external KPI: only KPIs the platform measures show a live value." size="md" dirty={dirty}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!f.name.trim()} onClick={() => create.mutate()}>Add KPI</Button></div>}>
      <div className="flex flex-col gap-[16px]">
        <FormField label="KPI name" required><TextInput value={f.name} maxLength={300} placeholder="Critical patches applied within SLA" onChange={(e) => set('name', e.target.value)} /></FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Domain" optional><TextInput value={f.domain} maxLength={200} placeholder="Vulnerability Management" onChange={(e) => set('domain', e.target.value)} /></FormField>
          <FormField label="Number" optional hint="Left empty, it follows the list."><TextInput value={f.number} maxLength={50} onChange={(e) => set('number', e.target.value)} /></FormField>
        </div>
        <FormField label="Definition" optional><Textarea rows={2} value={f.definition} placeholder="How the KPI is measured" onChange={(e) => set('definition', e.target.value)} /></FormField>
        <FormField label="External source" optional><TextInput value={f.source} maxLength={200} placeholder="Nessus, SIEM" onChange={(e) => set('source', e.target.value)} /></FormField>
      </div>
    </AnimatedModal>
  );
}
