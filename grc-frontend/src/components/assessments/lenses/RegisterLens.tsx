'use client';

/**
 * The NCA registers (vulnerabilities, the audit plan, risks): one lens driven by the kind of register. Every row keeps its whole column set (the workbook parser stores it as JSON
 * in the control's remarks) behind the row; the rating before and after treatment, and the likelihood by impact grid, are drawn for the registers that score risk. A press on a row
 * opens the workspace drawer (who it is assigned to, its answer, its files).
 */
import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { DebouncedSearch, EmptyState, ErrorState, PersonStack, ProgressBar, RegisterTable, SectionCard, SkeletonLines, StatusPill, useAddressState, type RegisterColumn } from '@/components/ui/ds';
import { integer, text } from '@/lib/addressState';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { rowCountText } from '@/components/ui/ds/tableModel';
import { EMPTY, formatCount } from '@/lib/format';
import type { LensProps } from '../workspace/lens';
import { Heatmap } from './Heatmap';
import { ItemPanelHost } from './ItemPanelHost';
import { LensFigures } from './LensFigures';
import { matchesText } from './lensData';
import type { Tile } from './profiles';
import { BAND_LABEL, entriesOf, namedBand, namedBandBand, NAMED_BANDS, pick, REGISTERS, registerKpis, type Band, type Entry, type RegisterKind } from './riskModel';
import { useLensData } from './useLensData';

const SCHEMA = { q: text(), item: integer(0, { min: 0 }) };
const BAND_TONE: Record<Band, 'danger' | 'warning' | 'progress' | 'success' | 'neutral'> = { critical: 'danger', high: 'warning', medium: 'progress', low: 'success', none: 'neutral' };

const Rating = ({ value }: { value: string }) => (value ? <StatusPill tone={BAND_TONE[namedBandBand(namedBand(value))]} label={value} size="sm" /> : <span className="text-ds-body text-ds-fg-muted">{EMPTY}</span>);

export default function RegisterLens({ kind, assessmentId, readOnly, onChanged }: LensProps & { kind: RegisterKind }) {
  const cfg = REGISTERS[kind];
  const { query, detail, items } = useLensData(assessmentId);
  const [a, set] = useAddressState(SCHEMA);
  const [open, setOpen] = useState<Array<string | number>>([]);
  const entries = useMemo(() => entriesOf(items, cfg), [items, cfg]);
  const k = useMemo(() => registerKpis(entries, cfg), [entries, cfg]);
  const shown = useMemo(() => entries.filter((e) => matchesText(`${e.item.number} ${e.item.description} ${Object.values(e.row).join(' ')}`, a.q)), [entries, a.q]);

  if (query.isPending) return <SkeletonLines lines={6} label="Loading the register" />;
  if (query.isError || !detail) return <ErrorState title="Couldn't load the register" message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />;
  if (entries.length === 0) return <EmptyState kind="firstUse" title="The register is empty" description={`This template has no ${cfg.noun} filled in yet. Add rows in the workbook and refresh from it (Actions menu).`} />;

  const figures: Tile[] = [
    { label: kind === 'audit' ? 'Audits and reviews' : 'Entries', value: formatCount(k.total) },
    { label: 'Open', value: formatCount(k.open), tone: k.open ? 'warning' : 'default', info: 'Entries whose answer is still Not answered.' },
    { label: kind === 'audit' ? 'Completed' : 'Resolved', value: formatCount(k.resolved), tone: k.resolved ? 'success' : 'default' },
    ...(cfg.sev.length ? [{ label: 'Critical and high', value: formatCount(k.critHigh), tone: k.critHigh ? ('danger' as const) : ('default' as const), note: 'by the rating before treatment' }] : []),
  ];
  const ratedTotal = Object.values(k.distribution).reduce((x, y) => x + y, 0);
  const text1 = (e: Entry, words: string[]) => pick(e.row, words);

  const columns: Array<RegisterColumn<Entry>> = [
    {
      key: 'entry', header: 'Entry', isRowHeader: true, width: 'w-[42%]',
      cell: (e) => {
        const lead = text1(e, [cfg.inline[0]]);
        const rest = cfg.inline.slice(1).map((c) => text1(e, [c])).filter(Boolean).map((v) => (v.length > 44 ? `${v.slice(0, 44)}…` : v));
        return (
          <span className="block min-w-0">
            <span className="block text-ds-label text-ds-fg-muted">{e.item.number || EMPTY}</span>
            <span className="line-clamp-2 break-words text-ds-body text-ds-fg" title={e.item.description}>{e.item.description || EMPTY}</span>
            <span className="mt-[2px] block text-ds-label text-ds-fg-muted">{[lead, ...rest, e.l >= 1 && e.i >= 1 ? `L${e.l} × I${e.i}${e.res && e.res.l >= 1 ? ` → L${e.res.l} × I${e.res.i}` : ''}` : ''].filter(Boolean).join(' · ')}</span>
          </span>
        );
      },
    },
    ...(cfg.sev.length ? [
      { key: 'rating', header: 'Rating', card: 'meta' as const, cell: (e: Entry) => <Rating value={e.sev} /> },
      ...(cfg.res ? [{ key: 'after', header: 'After treatment', priority: 2 as const, card: 'meta' as const, cell: (e: Entry) => <Rating value={e.res?.sev ?? ''} /> }] : []),
    ] : []),
    { key: 'tag', header: cfg.chips[0].replace(/\b\w/g, (c) => c.toUpperCase()), priority: 2, card: 'meta', cell: (e: Entry) => <span className="text-ds-body text-ds-fg-body">{text1(e, cfg.chips) || EMPTY}</span> },
    { key: 'assigned', header: 'Assigned to', priority: 3, card: 'meta', cell: (e: Entry) => <PersonStack people={e.item.assignees.map((x) => x.name)} size={24} max={2} label="Assigned to" emptyLabel="Unassigned" /> },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <LensFigures figures={figures} />
      {(ratedTotal > 0 || k.inherent.length > 0) && (
        <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-2">
          {ratedTotal > 0 && (
            <SectionCard id="ratings" title="Rating before treatment" meta={`${formatCount(ratedTotal)} rated`}>
              <ul className="flex flex-col gap-[8px]">
                {NAMED_BANDS.map((b) => {
                  const n = k.distribution[b] || 0;
                  return (
                    <li key={b} className="flex items-center gap-[12px]">
                      <span className="w-[72px] shrink-0 text-ds-body text-ds-fg-body">{b}</span>
                      <span className="min-w-0 flex-1"><ProgressBar value={Math.round((n / ratedTotal) * 100)} label={`${b} share`} valueText={`${formatCount(n)} · ${Math.round((n / ratedTotal) * 100)}%`} tone={b === 'Critical' ? 'danger' : b === 'High' ? 'warning' : b === 'Low' || b === 'Very Low' ? 'success' : 'primary'} /></span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-[8px] text-ds-label text-ds-fg-muted">{BAND_LABEL.critical}, high, medium, low and very low as the register words them.</p>
            </SectionCard>
          )}
          {k.inherent.length > 0 && (
            <SectionCard id="heat-map" title={`Likelihood by ${kind === 'vuln' ? 'severity' : 'impact'}`} meta={`${formatCount(k.inherent.length)} placed`}>
              <div className="flex flex-wrap items-center gap-[24px]">
                <Heatmap points={k.inherent} label={cfg.res ? 'Before treatment' : 'Exposure'} impactLabel={kind === 'vuln' ? 'Severity' : 'Impact'} />
                {cfg.res && k.residual.length > 0 && (
                  <>
                    <ArrowRight aria-hidden className="h-[20px] w-[20px] text-ds-fg-muted" />
                    <Heatmap points={k.residual} label="After treatment" />
                  </>
                )}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-[8px]">
        <DebouncedSearch className="w-full sm:w-[280px]" label={`Search ${cfg.noun}`} placeholder={`Search ${cfg.noun}`} value={a.q} onSearch={(q) => set({ q })} />
        <span className="ml-auto text-ds-label text-ds-fg-muted" role="status">{rowCountText({ shown: shown.length, total: shown.length, noun: kind === 'audit' ? 'audit' : kind === 'risk' ? 'risk' : 'vulnerability', plural: kind === 'vuln' ? 'vulnerabilities' : undefined })}{a.q.trim() ? ` of ${formatCount(entries.length)}` : ''}</span>
      </div>
      {shown.length === 0 ? (
        <EmptyState kind="noMatches" title={`No ${cfg.noun} match`} description="Change the search." onClearFilters={() => set({ q: '' })} />
      ) : (
        <RegisterTable
          caption={cfg.title} columns={columns} rows={shown} getRowId={(e) => e.item.id} onRowActivate={(e) => set({ item: e.item.id })} selectedId={a.item || null}
          expand={{ open, onChange: setOpen, label: (e) => `Details of ${e.item.number || 'the entry'}`, render: (e) => (
            <dl className="grid grid-cols-1 gap-x-[16px] gap-y-[8px] sm:grid-cols-2">
              {Object.entries(e.row).filter(([, v]) => String(v ?? '').trim()).map(([key, v]) => <div key={key} className="min-w-0"><dt className="text-ds-label text-ds-fg-muted">{key}</dt><dd className="break-words text-ds-body text-ds-fg">{String(v)}</dd></div>)}
            </dl>
          ) }}
          cardTitle={(e) => <span className="block min-w-0"><span className="block text-ds-label text-ds-fg-muted">{e.item.number || EMPTY}</span><span className="line-clamp-3 break-words text-ds-body font-[600] text-ds-fg">{e.item.description}</span></span>}
        />
      )}
      <ItemPanelHost assessmentId={assessmentId} assessmentName={detail.name} all={items} listed={shown.map((e) => e.item)} itemId={a.item} setItem={(id) => set({ item: id })} readOnly={readOnly} onChanged={onChanged} noun="entry" />
    </div>
  );
}
