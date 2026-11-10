'use client';

// The two sheets of a dashboard in edit mode: "Edit tile" (its title, how it is drawn, how wide it is, which number a KPI shows, the words under the number) and "Add a tile" (pick a saved report and
// how to draw it). Both change the DRAFT of the dashboard; nothing is saved until the page's Save bar is pressed. The rules (defaults, the measure a KPI shows) are dashboardModel.ts.
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button, EmptyState, FormField, Notice, Select, Sheet, TextInput } from '@/components/ui/ds';
import { aggLabelFor } from './tileLabels';
import { CHART_TYPES } from '../../_reports/PivotChart';
import { datasetByKey } from '../../_reports/datasets';
import type { DashboardTile, TileRender } from '../../_reports/dashboards';
import type { ReportSpec } from '../../_reports/types';
import { defaultWidth, measureChoice, type TileWidth } from './dashboardModel';

export const RENDER_OPTIONS: { value: TileRender; label: string }[] = [
  { value: 'kpi', label: 'A number' },
  { value: 'table', label: 'A table of the first rows' },
  ...CHART_TYPES.map((c) => ({ value: c.kind as TileRender, label: c.label })),
];
const WIDTHS: { value: TileWidth; label: string }[] = [
  { value: 1, label: 'A quarter of the row' },
  { value: 2, label: 'Half the row' },
  { value: 3, label: 'Three quarters of the row' },
  { value: 4, label: 'The whole row' },
];

export type TilePatch = Pick<DashboardTile, 'title' | 'caption' | 'render' | 'width' | 'measureIdx'>;

export function TileSheet({ open, tile, spec, onClose, onApply }: { open: boolean; tile: DashboardTile | null; spec: ReportSpec | null; onClose: () => void; onApply: (patch: TilePatch) => void }) {
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [render, setRender] = useState<TileRender>('kpi');
  const [width, setWidth] = useState<TileWidth>(1);
  const [measure, setMeasure] = useState(-1);
  const measures = spec?.measures ?? [];
  useEffect(() => {
    if (!open || !tile) return;
    setTitle(tile.title ?? ''); setCaption(tile.caption ?? ''); setRender(tile.render); setWidth(tile.width); setMeasure(measureChoice(tile.measureIdx, spec?.measures?.length ?? 0));
  }, [open, tile, spec]);
  if (!tile) return null;
  const was = measureChoice(tile.measureIdx, measures.length);
  const dirty = title !== (tile.title ?? '') || caption !== (tile.caption ?? '') || render !== tile.render || width !== tile.width || (render === 'kpi' && measure !== was);
  const apply = () => onApply({
    title: title.trim() || undefined,
    caption: render === 'kpi' ? caption.trim() || undefined : undefined,
    render,
    width,
    measureIdx: render === 'kpi' ? (measure === was ? tile.measureIdx : measure) : undefined,
  });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit tile"
      subtitle={spec ? spec.name || 'Untitled report' : undefined}
      width="md"
      dirty={dirty}
      footer={<div className="flex justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={apply} disabled={!dirty}>Apply</Button></div>}
    >
      <div className="flex flex-col gap-[16px]">
        <FormField label="Title" optional hint="Leave it empty to use the report's name."><TextInput value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} autoComplete="off" /></FormField>
        <FormField label="Show it as"><Select value={render} onChange={(e) => setRender(e.target.value as TileRender)}>{RENDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
        <FormField label="Width"><Select value={String(width)} onChange={(e) => setWidth(Number(e.target.value) as TileWidth)}>{WIDTHS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
        {render === 'kpi' && (
          <>
            <FormField label="Number to show">
              <Select value={String(measure)} onChange={(e) => setMeasure(Number(e.target.value))}>
                <option value="-1">Number of rows</option>
                {measures.map((m, i) => <option key={m.id} value={i}>{aggLabelFor(m, spec)}</option>)}
              </Select>
            </FormField>
            <FormField label="Words under the number" optional><TextInput value={caption} maxLength={120} onChange={(e) => setCaption(e.target.value)} autoComplete="off" /></FormField>
          </>
        )}
      </div>
    </Sheet>
  );
}

export function AddTileSheet({ open, reports, dashboardShared, onClose, onAdd }: {
  open: boolean;
  reports: readonly ReportSpec[];
  dashboardShared: boolean;
  onClose: () => void;
  onAdd: (reportId: string, render: TileRender) => void;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [render, setRender] = useState<TileRender>('kpi');
  useEffect(() => { if (open) { setQ(''); setPicked(null); setRender('kpi'); } }, [open]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => reports.filter((r) => {
    if (!needle) return true;
    const ds = datasetByKey(r.dataset);
    return `${r.name} ${ds?.label ?? ''} ${ds?.module ?? ''}`.toLowerCase().includes(needle);
  }), [reports, needle]);
  const report = reports.find((r) => r.id === picked);
  const chartWithoutBreakdown = !!report && render !== 'kpi' && render !== 'table' && !(report.rows?.length);
  const privateReport = dashboardShared && !!report && report.mine !== false && !report.shared;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a tile"
      subtitle="Each tile shows one saved report"
      width="md"
      footer={(
        <div className="flex items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!picked} onClick={() => picked && onAdd(picked, render)}>Add tile</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[12px]">
        {reports.length === 0 ? (
          <EmptyState kind="firstUse" bare title="No saved reports yet" description="Build and save a report first, then add it here." action={<Button href="/reports" variant="primary">Go to Reports</Button>} />
        ) : (
          <>
            <TextInput type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search saved reports" placeholder="Search saved reports" autoComplete="off" leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />} />
            {shown.length === 0 ? (
              <EmptyState kind="noMatches" bare title="No report matches" description="Search for another word." onClearFilters={() => setQ('')} />
            ) : (
              <ul aria-label="Saved reports" className="m-0 flex list-none flex-col p-0">
                {shown.map((r) => {
                  const ds = datasetByKey(r.dataset);
                  const on = picked === r.id;
                  return (
                    <li key={`${r.id}:${r.mine === false ? 'o' : 'm'}`}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPicked(r.id)}
                        className={`flex min-h-[44px] w-full flex-col justify-center rounded-ds-control px-[10px] py-[6px] text-left focus-visible:outline-none focus-visible:shadow-ds-ring ${on ? 'bg-ds-primary-soft text-ds-primary-text' : 'hover:bg-ds-surface-hover'}`}
                      >
                        <span className="truncate text-ds-body font-[600]" title={r.name}>{r.name || 'Untitled report'}</span>
                        <span className="truncate text-ds-label text-ds-fg-muted">{ds ? `${ds.module} · ${ds.label}` : 'A module that is no longer available'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <FormField label="Show it as"><Select value={render} onChange={(e) => setRender(e.target.value as TileRender)}>{RENDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
            {chartWithoutBreakdown && <Notice tone="warning">This report has no breakdown field, so a chart has nothing to plot. Choose a number or a table, or add a breakdown to the report first.</Notice>}
            {privateReport && <Notice tone="warning">This report is only yours. The people this dashboard is shared with will see this tile as not available until you share the report too.</Notice>}
          </>
        )}
      </div>
    </Sheet>
  );
}

export { defaultWidth };
