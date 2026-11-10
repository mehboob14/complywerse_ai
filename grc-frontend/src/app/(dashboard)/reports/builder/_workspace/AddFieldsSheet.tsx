'use client';

// "Add fields": one sheet for choosing what the report shows. Tab 1 is the old "Choose module & fields": any module the person may open, its fields ticked in a list, applied together (the sheet merges
// them into the report: it never replaces what is there, builderModel.mergedAddedFields). Tab 2 is the old "Linked & advanced fields": the counts, names and fields that come through a link, which apply as
// they are ticked. Closing with ticks that were not applied asks first.
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button, Checkbox, EmptyState, SegmentedControl, Select, Sheet, TextInput, useConfirm } from '@/components/ui/ds';
import type { ColumnDef, ReportDataset, Row } from '../../_reports/types';
import ColumnPicker from '../../_reports/ColumnPicker';
import type { LinkageDef } from '../../_reports/linkages';
import { parseXmodKey, xmodKey } from '../../_reports/openCatalog';
import { mergeAddedFields, newFieldCount, picksFromVisible, togglePick, type Picks } from './builderModel';

const TYPE_WORD: Record<string, string> = { number: 'number', date: 'date', badge: 'tag', text: 'text', linkage: 'link' };
type Tab = 'fields' | 'links';

export function AddFieldsSheet({
  open, onClose, dataset, datasets, groupedDatasets, visibleKeys, onChange, linkageCatalog, linkageColumns, rows,
}: {
  open: boolean;
  onClose: () => void;
  dataset: ReportDataset;
  datasets: ReportDataset[];
  groupedDatasets: [string, ReportDataset[]][];
  visibleKeys: string[];
  onChange: (keys: string[]) => void;
  linkageCatalog: LinkageDef[];
  linkageColumns: ColumnDef[];
  rows: Row[];
}) {
  const [tab, setTab] = useState<Tab>('fields');
  const [picks, setPicks] = useState<Picks>({});
  const [moduleKey, setModuleKey] = useState(dataset.key);
  const [q, setQ] = useState('');
  const { confirm, confirmDialog } = useConfirm();
  const ownKeys = useMemo(() => new Set(dataset.columns.map((c) => c.key)), [dataset]);

  // each time it opens: the report's fields ticked, this module's list showing
  useEffect(() => {
    if (!open) return;
    setModuleKey(dataset.key);
    setQ('');
    setTab('fields');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // whenever the first tab is shown: the ticks are the report's fields as they are now (the second tab changes them as it goes)
  useEffect(() => {
    if (open && tab === 'fields') setPicks(picksFromVisible(visibleKeys, dataset.key, ownKeys, parseXmodKey));
  }, [open, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = datasets.find((d) => d.key === moduleKey) ?? dataset;
  const needle = q.trim().toLowerCase();
  const fields = active.columns.filter((c) => !needle || c.label.toLowerCase().includes(needle));
  const ticked = new Set(picks[active.key] || []);
  const added = newFieldCount(picks, visibleKeys, dataset.key, xmodKey);
  const removed = visibleKeys.filter((k) => { const x = parseXmodKey(k); return x ? !(picks[x.dataset] || []).includes(x.field) : ownKeys.has(k) && !(picks[dataset.key] || []).includes(k); }).length;
  const dirty = tab === 'fields' && (added > 0 || removed > 0);

  const merged = () => mergeAddedFields(visibleKeys, picks, dataset.key, ownKeys, parseXmodKey, xmodKey);
  const apply = () => {
    onChange(merged());
    onClose();
  };
  /** Leaving the first tab with ticks that were not applied applies them: nothing the person chose is lost on the way to the other tab. */
  const goTab = (next: Tab) => {
    if (tab === 'fields' && dirty) onChange(merged());
    setTab(next);
  };
  const allOn = fields.length > 0 && fields.every((c) => ticked.has(c.key));
  const toggleAll = () => {
    setPicks((prev) => {
      const next = { ...prev };
      const keys = fields.map((c) => c.key);
      if (allOn) {
        const remain = (prev[active.key] || []).filter((k) => !keys.includes(k));
        if (remain.length) next[active.key] = remain; else delete next[active.key];
      } else next[active.key] = Array.from(new Set([...(prev[active.key] || []), ...keys]));
      return next;
    });
  };
  const clearAll = async () => {
    if (visibleKeys.length === 0) return;
    if (await confirm({ title: 'Remove every column?', message: 'The report keeps its filters and summary. You can add the fields again.', confirmLabel: 'Remove every column', tone: 'danger' })) onChange([]);
  };

  const tickedCount = Object.keys(picks).reduce((n, k) => n + picks[k].length, 0);

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Add fields"
        subtitle="Choose what the report shows"
        width="lg"
        dirty={dirty}
        footer={tab === 'fields' ? (
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <span className="text-ds-label text-ds-fg-muted">{tickedCount === 0 ? 'Nothing ticked yet' : `${tickedCount} ticked`}</span>
            <div className="flex gap-[8px]">
              <Button variant="ghost" disabled={tickedCount === 0} onClick={() => setPicks({})}>Untick all</Button>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" disabled={!dirty} onClick={apply}>{added > 0 ? `Add ${added} ${added === 1 ? 'field' : 'fields'}` : removed > 0 ? 'Apply' : 'Add fields'}</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <span className="text-ds-label text-ds-fg-muted">{visibleKeys.length} {visibleKeys.length === 1 ? 'column' : 'columns'} on the report. Changes apply as you tick.</span>
            <div className="flex gap-[8px]">
              <Button variant="ghost" disabled={visibleKeys.length === 0} onClick={() => void clearAll()}>Remove every column</Button>
              <Button variant="primary" onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      >
        <div className="flex flex-col gap-[16px]">
          <SegmentedControl label="How to choose" name="add-fields-tab" options={[{ value: 'fields', label: 'By module' }, { value: 'links', label: 'Links and counts' }]} value={tab} onChange={goTab} />

          {tab === 'fields' ? (
            <div className="flex flex-col gap-[12px]">
              <Select aria-label="Module" value={moduleKey} onChange={(e) => { setModuleKey(e.target.value); setQ(''); }}>
                {groupedDatasets.map(([module, list]) => (
                  <optgroup key={module} label={module}>
                    {list.map((d) => <option key={d.key} value={d.key}>{d.label}{(picks[d.key]?.length ?? 0) > 0 ? ` (${picks[d.key].length} ticked)` : ''}</option>)}
                  </optgroup>
                ))}
              </Select>
              <TextInput type="search" aria-label="Search the fields" placeholder="Search the fields" value={q} onChange={(e) => setQ(e.target.value)} leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />} autoComplete="off" />
              {fields.length === 0 ? (
                <EmptyState kind="noMatches" bare title="No field matches" description="Search for another word." onClearFilters={() => setQ('')} />
              ) : (
                <div className="flex flex-col">
                  <div className="flex items-center justify-between gap-[8px]">
                    <span className="text-ds-label text-ds-fg-muted">{active.label}: {active.columns.length} fields{ticked.size > 0 ? `, ${ticked.size} ticked` : ''}</span>
                    <Button size="sm" variant="ghost" onClick={toggleAll}>{allOn ? 'Untick these' : 'Tick all these'}</Button>
                  </div>
                  <div role="group" aria-label={`Fields of ${active.label}`} className="grid grid-cols-1 gap-x-[16px] sm:grid-cols-2">
                    {fields.map((c) => (
                      <Checkbox
                        key={c.key}
                        checked={ticked.has(c.key)}
                        onChange={() => setPicks((prev) => togglePick(prev, active.key, c.key))}
                        label={<span className="[overflow-wrap:anywhere]">{c.label}<span className="text-ds-label text-ds-fg-muted"> · {TYPE_WORD[c.type || 'text'] ?? 'text'}</span></span>}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <LinksTab
              dataset={dataset}
              linkageCatalog={linkageCatalog}
              linkageColumns={linkageColumns}
              visibleKeys={visibleKeys}
              onChange={onChange}
              rows={rows}
            />
          )}
        </div>
      </Sheet>
      {confirmDialog}
    </>
  );
}

function LinksTab({ dataset, linkageCatalog, linkageColumns, visibleKeys, onChange, rows }: { dataset: ReportDataset; linkageCatalog: LinkageDef[]; linkageColumns: ColumnDef[]; visibleKeys: string[]; onChange: (keys: string[]) => void; rows: Row[] }) {
  const [fieldQ, setFieldQ] = useState('');
  return (
    <div className="flex flex-col gap-[8px]">
      <p className="m-0 text-ds-label text-ds-fg-muted">A linked field pulls related records from another module. An empty value means the record has no link.</p>
      <ColumnPicker baseColumns={dataset.columns} linkageCatalog={linkageCatalog} linkageColumns={linkageColumns} visibleKeys={visibleKeys} onChange={onChange} fieldQ={fieldQ} onFieldQChange={setFieldQ} rows={rows} defaultScope="all" />
    </div>
  );
}
