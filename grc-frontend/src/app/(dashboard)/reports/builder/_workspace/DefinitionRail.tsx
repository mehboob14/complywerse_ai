'use client';

// The definition of a report, always on screen (a rail beside the rows on a wide window, the "Setup" tab on a phone): where the rows come from (the module), which fields, which filters, how they are
// summarised, how they are sorted. Each part is a section that opens and shuts and says how much is set in it. It replaces six hand-made panels that covered the rows; the rows now change as the
// definition does. This file draws and calls: the rules are builderModel.ts, the data is useReportRows.ts, the parts are the report engine's components restyled on the kit.
import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { Button, Disclosure, Notice, Select, TextInput, useConfirm } from '@/components/ui/ds';
import type { FilterRules, ReportDataset, ReportSpec } from '../../_reports/types';
import { isActiveCondition } from '../../_reports/grid-utils';
import { dimensionCandidates } from '../../_reports/aggregate-utils';
import FilterBuilder from '../../_reports/FilterBuilder';
import SelectedColumnList from '../../_reports/SelectedColumnList';
import SummarizePanel from '../../_reports/SummarizePanel';
import { sortChoice, sortFromChoice, switchNeedsConfirm, toggleShortcut, gapModuleLabel } from './builderModel';
import type { ReportRows } from './useReportRows';

type Section = 'source' | 'fields' | 'filters' | 'summary' | 'sort';

export interface RailProps {
  dataset: ReportDataset;
  groupedDatasets: [string, ReportDataset[]][];
  spec: ReportSpec;
  patch: (p: Partial<ReportSpec>) => void;
  data: ReportRows;
  draftRules: FilterRules;
  setDraftRules: (r: FilterRules) => void;
  draftSearch: string;
  setDraftSearch: (s: string) => void;
  filtersDirty: boolean;
  applyFilters: () => void;
  resetFilters: () => void;
  onSwitchDataset: (key: string) => void;
  onAddFields: () => void;
  onCalculated: () => void;
  /** which section the workspace asks to be opened (the notice above the rows sends a person to Filters) */
  openRequest: { section: Section; n: number } | null;
}

const CHIP = 'inline-flex min-h-ds-control-sm items-center gap-[4px] rounded-full border px-[10px] text-ds-label focus-visible:outline-none focus-visible:shadow-ds-ring';

export function DefinitionRail(p: RailProps) {
  const { dataset, spec, patch, data } = p;
  const uid = useId();
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState<Record<Section, boolean>>({ source: true, fields: true, filters: spec.rules.conditions.some(isActiveCondition) || !!spec.search, summary: data.summaryMode, sort: false });
  const [seenRequest, setSeenRequest] = useState(0);
  if (p.openRequest && p.openRequest.n !== seenRequest) {
    setSeenRequest(p.openRequest.n);
    setOpen((o) => ({ ...o, [p.openRequest!.section]: true }));
  }
  const section = (key: Section) => ({ open: open[key], onOpenChange: (v: boolean) => setOpen((o) => ({ ...o, [key]: v })) });

  const ruleCount = spec.rules.conditions.filter(isActiveCondition).length;
  const sortKeys = (data.summaryMode ? data.displayVisibleKeys : data.visibleKeys);
  const sortLabel = (k: string) => (data.summaryMode ? data.displayCols.find((c) => c.key === k)?.label : data.labelFor(k)) ?? k;

  const switchTo = async (key: string) => {
    if (key === dataset.key) return;
    if (switchNeedsConfirm(spec, dataset.key, key)) {
      const ok = await confirm({
        title: 'Change the module?',
        message: 'The columns, filters and summary of this report are cleared when it reads another module. Saved reports are not changed.',
        confirmLabel: 'Change the module',
        tone: 'danger',
      });
      if (!ok) return;
    }
    p.onSwitchDataset(key);
  };

  const removeAllFields = async () => {
    if (!(await confirm({ title: 'Remove every column?', message: 'The report keeps its filters and summary. You can add the fields again.', confirmLabel: 'Remove every column', tone: 'danger' }))) return;
    patch({ visibleColumns: [] });
  };

  const gapOn = (colKey: string) => spec.rules.conditions.some((x) => x.col === colKey && x.op === 'notlinked');
  const zeroOn = (colKey: string) => spec.rules.conditions.some((x) => x.col === colKey && x.op === 'eq' && x.value === '0');
  const applyShortcut = (kind: 'gap' | 'zero', colKey: string) => {
    const next = toggleShortcut(p.draftRules, kind, colKey);            // applies straight away so the rows move behind it; the same click again removes it
    p.setDraftRules(next);
    patch({ rules: next });
  };

  return (
    <div className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface">
      <Disclosure label="Source" level={2} {...section('source')}>
        <div className="flex flex-col gap-[8px] px-[8px] pb-[12px]">
          <Select aria-label="Module and register" value={dataset.key} onChange={(e) => void switchTo(e.target.value)}>
            {p.groupedDatasets.map(([module, list]) => (
              <optgroup key={module} label={module}>{list.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</optgroup>
            ))}
          </Select>
          <p className="m-0 text-ds-label text-ds-fg-muted">{dataset.module}{dataset.description ? `. ${dataset.description}` : ''}</p>
        </div>
      </Disclosure>

      <Disclosure label="Fields" level={2} count={data.visibleKeys.length} countLabel="on the report" {...section('fields')}>
        <div className="flex flex-col gap-[12px] px-[8px] pb-[12px]">
          <SelectedColumnList
            cols={data.lookupCols}
            visibleKeys={data.visibleKeys}
            align={spec.columnAlign ?? {}}
            pinned={spec.pinnedColumns ?? []}
            onReorder={(keys) => patch({ visibleColumns: keys })}
            onRemove={(key) => patch({ visibleColumns: data.visibleKeys.filter((x) => x !== key) })}
            onAlign={(key, align) => patch({ columnAlign: { ...(spec.columnAlign ?? {}), [key]: align } })}
            onPin={(key) => {
              const pinned = new Set(spec.pinnedColumns ?? []);
              if (pinned.has(key)) pinned.delete(key); else pinned.add(key);
              patch({ pinnedColumns: Array.from(pinned) });
            }}
          />
          <div className="flex flex-wrap gap-[8px]">
            <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={p.onAddFields}>Add fields</Button>
            <Button onClick={p.onCalculated}>{data.calcDefs.length > 0 ? `Calculated fields (${data.calcDefs.length})` : 'Calculated fields'}</Button>
            {data.visibleKeys.length > 1 && <Button variant="ghost" onClick={() => void removeAllFields()}>Remove all</Button>}
          </div>
        </div>
      </Disclosure>

      <Disclosure label="Filters" level={2} count={ruleCount + (spec.search.trim() ? 1 : 0)} countLabel="applied" {...section('filters')}>
        <div className="flex flex-col gap-[12px] px-[8px] pb-[12px]">
          {data.linkageDegraded && (
            <Notice tone="warning" title="Link checks are not available">The list of links did not load, so the “nothing linked” shortcuts are hidden rather than answered from incomplete data. Open the report again to retry.</Notice>
          )}
          {(data.linkagePresenceCols.length > 0 || data.countGapCols.length > 0) && (
            <div role="group" aria-label="Find gaps" className="flex flex-col gap-[6px]">
              <p className="m-0 text-ds-label text-ds-fg-muted">Find gaps: {dataset.label} with nothing linked, or a link count of zero.</p>
              <div className="flex flex-wrap gap-[6px]">
                {data.linkagePresenceCols.map((c) => (
                  <button key={c.key} type="button" aria-pressed={gapOn(c.key)} onClick={() => applyShortcut('gap', c.key)} className={clsx(CHIP, gapOn(c.key) ? 'border-transparent bg-ds-primary text-ds-on-primary' : 'border-ds-border-strong bg-ds-surface text-ds-fg-body hover:bg-ds-surface-hover')}>
                    No {gapModuleLabel(c.label)} linked
                  </button>
                ))}
                {data.countGapCols.map((c) => (
                  <button key={`cnt-${c.key}`} type="button" aria-pressed={zeroOn(c.key)} onClick={() => applyShortcut('zero', c.key)} className={clsx(CHIP, zeroOn(c.key) ? 'border-transparent bg-ds-primary text-ds-on-primary' : 'border-ds-border-strong bg-ds-surface text-ds-fg-body hover:bg-ds-surface-hover')}>
                    {c.label} = 0
                  </button>
                ))}
              </div>
            </div>
          )}
          <TextInput aria-label={data.serverMode ? 'Search the module' : 'Search the columns'} type="search" placeholder={data.serverMode ? 'Search the module' : 'Search the columns'} value={p.draftSearch} onChange={(e) => p.setDraftSearch(e.target.value)} autoComplete="off" />
          <FilterBuilder
            staged
            dirty={p.filtersDirty}
            cols={data.filterCols.length ? data.filterCols : data.selectedCols}
            lookupCols={data.lookupCols}
            rows={data.rows}
            rules={p.draftRules}
            onChange={p.setDraftRules}
            onApply={p.applyFilters}
            onReset={p.resetFilters}
          />
        </div>
      </Disclosure>

      <Disclosure label="Summary" level={2} count={data.summaryMode ? spec.measures.length : 0} countLabel="calculations" {...section('summary')}>
        <div className="px-[8px] pb-[12px]">
          <SummarizePanel
            cols={data.selectedCols}
            lookupCols={data.lookupCols}
            dimensions={data.dimensions}
            measures={spec.measures}
            onDimensionsChange={(keys) => patch({ rows: keys })}
            onMeasuresChange={(measures) => {
              // The FIRST calculation seeds one sensible breakdown (the first categorical column selected) so the result reads as "count by Status", not one anonymous total.
              // Grouping by every visible column would only restate the detail rows with a column of 1s. Later edits do not re-seed, so a deliberate grand total is respected.
              const firstRun = spec.measures.length === 0 && measures.length > 0 && data.dimensions.length === 0;
              const seed = firstRun ? dimensionCandidates(data.selectedCols)[0]?.key : undefined;
              patch(seed ? { measures, rows: [seed] } : { measures });
            }}
            onClear={() => patch({ rows: [], measures: [] })}
          />
        </div>
      </Disclosure>

      <Disclosure label="Sort" level={2} count={spec.sorts?.length ?? 0} countLabel="sorted" {...section('sort')}>
        <div className="flex flex-col gap-[8px] px-[8px] pb-[12px]">
          <Select aria-label="Sort the rows by" value={sortChoice(spec.sorts)} onChange={(e) => patch({ sorts: sortFromChoice(e.target.value) })} disabled={sortKeys.length === 0}>
            <option value="">{sortKeys.length ? 'No order chosen' : 'Add columns to sort by them'}</option>
            {sortKeys.map((k) => (
              <optgroup key={k} label={sortLabel(k)}>
                <option value={`${k}:asc`}>{sortLabel(k)}, lowest first</option>
                <option value={`${k}:desc`}>{sortLabel(k)}, highest first</option>
              </optgroup>
            ))}
          </Select>
          <p id={`${uid}-sort-hint`} className="m-0 text-ds-label text-ds-fg-muted">You can also click a column heading in the table. Hold Shift to sort by several.</p>
        </div>
      </Disclosure>
      {confirmDialog}
    </div>
  );
}
