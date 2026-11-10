'use client';

// The report workspace: the page the library's "Open" and "New report" lead to. One screen holds the whole report: its definition on the left (module, fields, filters, summary, sort), its rows on the
// right, and Save and Download in the head. On a phone the two are tabs (Setup | Preview). The state of the report is one ReportSpec (the same JSON the server stores); builderModel.ts holds the rules,
// useReportRows.ts the data, notices.ts what a person must be told about it. This file wires them: filters are staged until Apply, a save goes to the server STRICTLY (a refusal is said, with Retry, never
// kept out of sight), and a download says what it wrote and when the rows are only part of the register.
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, FileType2, Printer, RotateCw } from 'lucide-react';
import { Button, Notice, SegmentedControl, Sheet, useConfirm, useNotify, type MenuItem } from '@/components/ui/ds';
import type { FilterRules, ReportDataset, ReportSpec } from '../../_reports/types';
import { formatCount, formatDateTime, truncate } from '@/lib/format';
import { isActiveCondition, describeRules } from '../../_reports/grid-utils';
import { measureLabel } from '../../_reports/aggregate-utils';
import { newSpecId, persistSpec, putSpec } from '../../_reports/savedReports';
import { stashPrintSpec } from '../../_reports/printPayload';
import CalcColumnPanel from '../../_reports/CalcColumnPanel';
import { REPORTS_KEY } from '../../_library/keys';
import { downloadWords, FORMAT_LABEL, type FileFormat } from '../../_library/fileModel';
import { classifySync, failureWords } from '../../_library/syncModel';
import { hasUnsaved, moduleLine, workingSpec } from './builderModel';
import { useReportRows } from './useReportRows';
import { WorkspaceHead } from './WorkspaceHead';
import { DefinitionRail } from './DefinitionRail';
import { DataPane } from './DataPane';
import { AddFieldsSheet } from './AddFieldsSheet';
import { SaveSheet, type SaveDetails } from './SaveSheet';

type Tab = 'setup' | 'preview';
type RailSection = 'source' | 'fields' | 'filters' | 'summary' | 'sort';
const emptyRules = (): FilterRules => ({ logic: 'AND', conditions: [] });
const activeOnly = (r: FilterRules) => JSON.stringify({ logic: r.logic, conditions: r.conditions.filter(isActiveCondition) });

export function ReportWorkspace({
  dataset, datasets, groupedDatasets, initialSpec, savedSpec, onSwitchDataset, onNewReport, onSaved,
}: {
  dataset: ReportDataset;
  datasets: ReportDataset[];
  groupedDatasets: [string, ReportDataset[]][];
  /** the report as it opens (a saved one, possibly narrowed to a dashboard's category, or a blank one on a module) */
  initialSpec: ReportSpec | null;
  /** the report as the server holds it, to tell what is unsaved (null for a new report) */
  savedSpec: ReportSpec | null;
  onSwitchDataset: (key: string) => void;
  onNewReport: () => void;
  /** a report was saved: the page gives it an address */
  onSaved: (spec: ReportSpec) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();

  const [spec, setSpec] = useState<ReportSpec>(() => workingSpec(initialSpec, dataset.key));
  const [saved, setSaved] = useState<ReportSpec | null>(savedSpec);
  const patch = useCallback((p: Partial<ReportSpec>) => setSpec((s) => ({ ...s, ...p })), []);
  const [draftRules, setDraftRules] = useState<FilterRules>(spec.rules);
  const [draftSearch, setDraftSearch] = useState(spec.search);
  const [showTotals, setShowTotals] = useState(true);
  const [tab, setTab] = useState<Tab>(spec.visibleColumns && spec.visibleColumns.length > 0 ? 'preview' : 'setup');
  const [sheet, setSheet] = useState<'add' | 'calc' | 'save' | null>(null);
  const [saveMode, setSaveMode] = useState<'save' | 'save-as'>('save');
  const [calcEditing, setCalcEditing] = useState(false);
  const [openRequest, setOpenRequest] = useState<{ section: RailSection; n: number } | null>(null);

  const data = useReportRows({ dataset, datasets, spec, draftRules });

  // ── filters (staged: the rows are read again only on Apply) ──
  const filtersDirty = useMemo(() => activeOnly(draftRules) !== activeOnly(spec.rules) || draftSearch !== spec.search, [draftRules, spec.rules, draftSearch, spec.search]);
  const applyFilters = () => patch({ rules: draftRules, search: draftSearch });
  const resetFilters = () => { setDraftRules(emptyRules()); setDraftSearch(''); patch({ rules: emptyRules(), search: '' }); };
  const fromChip = (next: { rules?: FilterRules; search?: string }) => {
    if (next.rules) { setDraftRules(next.rules); patch({ rules: next.rules }); }
    if (next.search !== undefined) { setDraftSearch(next.search); patch({ search: next.search }); }
  };
  const goRail = (section: RailSection) => { setTab('setup'); setOpenRequest({ section, n: Date.now() }); };

  // the library's "choose columns" hand-off
  useEffect(() => {
    try {
      if (sessionStorage.getItem('grc.reports.openColumns') === '1') { sessionStorage.removeItem('grc.reports.openColumns'); setSheet('add'); }
    } catch { /* no storage: nothing to open */ }
  }, []);

  // ── unsaved work ──
  const unsaved = hasUnsaved(spec, saved);
  useEffect(() => {
    if (!unsaved) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  const [deviceOnly, setDeviceOnly] = useState(false);

  // ── save ──
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ text: string; unreachable: boolean; spec: ReportSpec } | null>(null);
  const forkOwn = spec.mine === false;                                       // someone else's shared report: saving makes your own copy (as it always did)
  const build = (over: Partial<ReportSpec>): ReportSpec => ({
    ...spec, view: 'table', visibleColumns: data.visibleKeys, includes: data.includes, dataset: dataset.key, mine: true, updatedAt: new Date().toISOString(), ...over,
  });

  const commit = async (next: ReportSpec): Promise<boolean> => {
    setSaving(true);
    setFailure(null);
    try {
      await putSpec(next);                                                   // strict: a refusal or a lost connection throws, nothing is stored out of sight
      setSpec((s) => ({ ...next, view: s.view }));
      setSaved(next);
      setDeviceOnly(false);
      void qc.invalidateQueries({ queryKey: REPORTS_KEY });
      notify.success(`“${truncate(next.name, 60).text}” is saved`, { title: 'Report saved' });
      onSaved(next);
      return true;
    } catch (e) {
      const f = classifySync(e);
      setFailure({ text: failureWords(f, 'save the report'), unreachable: f.kind === 'unreachable', spec: next });
      return false;
    } finally {
      setSaving(false);
    }
  };
  const keepOnDevice = async (next: ReportSpec) => {
    setSaving(true);
    try {
      const where = await persistSpec(next);                                 // the explicit choice: a copy on this device, sent when the server can be reached
      setSpec((s) => ({ ...next, view: s.view }));
      setSaved(next);
      setFailure(null);
      setDeviceOnly(where === 'local');
      void qc.invalidateQueries({ queryKey: REPORTS_KEY });
      if (where === 'local') notify.info('It will be sent to the server when it can be reached. The Reports list shows it as “This device only”.', { title: 'Kept on this device' });
      else { notify.success(`“${truncate(next.name, 60).text}” is saved`, { title: 'Report saved' }); onSaved(next); }
    } finally {
      setSaving(false);
    }
  };

  const quickSavable = !!spec.id && !!spec.name.trim() && !forkOwn;
  const save = () => {
    if (quickSavable) { void commit(build({})); return; }
    setSaveMode(forkOwn ? 'save-as' : 'save');            // someone else's report: the sheet says it saves a copy
    setFailure(null);
    setSheet('save');
  };
  const saveAs = () => { setSaveMode('save-as'); setFailure(null); setSheet('save'); };
  const sheetInitial: SaveDetails = {
    name: saveMode === 'save-as' && spec.name.trim() ? `${spec.name.trim()} (copy)`.slice(0, 120) : (spec.name.trim() || `${dataset.label} report`).slice(0, 120),
    description: spec.description ?? '',
    shared: saveMode === 'save-as' ? false : !!spec.shared,
  };
  const saveFromSheet = async (d: SaveDetails) => {
    const fork = forkOwn || saveMode === 'save-as';
    const ok = await commit(build({ id: spec.id && !fork ? spec.id : newSpecId(), name: d.name, description: d.description, shared: d.shared }));
    if (ok) setSheet(null);
  };

  // ── download ──
  const [downloading, setDownloading] = useState(false);
  const summary = data.summaryMode;
  const exportKeys = summary ? data.displayVisibleKeys : data.visibleKeys;
  const factLines = () => [
    { label: 'Module', value: moduleLine(dataset.module, dataset.label) },
    { label: 'Generated', value: formatDateTime(new Date()) },
    { label: 'Rows', value: summary ? `${formatCount(data.displayRows.length)} summary ${data.displayRows.length === 1 ? 'group' : 'groups'}` : `${formatCount(data.filteredRows.length)}${data.filteredRows.length !== data.rows.length ? ` of ${formatCount(data.rows.length)}` : ''}` },
    { label: 'Columns', value: exportKeys.map((k) => data.displayCols.find((c) => c.key === k)?.label ?? k).join(', ') || '(none)' },
    ...(summary ? [{ label: 'Summary', value: [data.dimensions.length ? `grouped by ${data.dimensions.map(data.labelFor).join(' › ')}` : 'overall total', spec.measures.map((m) => measureLabel(m, m.key ? data.labelFor(m.key) : '')).join(', ')].filter(Boolean).join(' · ') }] : []),
    { label: 'Filters', value: describeRules(data.cols, spec.rules) },
    ...(data.includes.length ? [{ label: 'Linked modules', value: data.includes.map((k) => data.linkageCatalog.find((l) => l.key === k)?.label ?? k).join(', ') }] : []),
    ...(spec.search.trim() ? [{ label: 'Search', value: `“${spec.search.trim()}”` }] : []),
  ];
  const download = async (format: FileFormat) => {
    const name = spec.name.trim() || dataset.label;
    const shown = truncate(name, 60).text;                                   // a long name does not fill the toast
    const cols = exportKeys.map((k) => data.displayCols.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => !!c);
    if (cols.length === 0) { notify.warning('Add the columns the file should hold first.', { title: 'Nothing to download yet' }); return; }
    if (format === 'pdf') {
      // before anything is awaited: the new tab opens while the click is still the person's
      stashPrintSpec({ ...spec, name, visibleColumns: data.visibleKeys, includes: data.includes, view: 'table', dataset: dataset.key });
      window.open('/reports/print', '_blank', 'noopener');
      const w = downloadWords(shown, 'pdf', 0, data.partial);
      notify.info(w.message, { title: w.title });
      return;
    }
    setDownloading(true);
    try {
      const { exportCSV, exportExcelMulti, exportWord } = await import('../../_reports/exporters');
      const rows = data.displayRows;
      if (format === 'csv') exportCSV(name, cols, rows);
      else if (format === 'excel') exportExcelMulti(name, [{ name: 'Report', cols, rows }, { name: 'Definition', aoa: [['Field', 'Value'], ...factLines().map((f) => [f.label, f.value])] }]);
      else await exportWord(name, { title: name, subtitle: moduleLine(dataset.module, dataset.label), facts: factLines() }, cols, rows);
      const w = downloadWords(shown, format, rows.length, data.partial);
      if (w.partial) notify.warning(w.message, { title: w.title }); else notify.success(w.message, { title: w.title });
    } catch (e) {
      notify.error(e, { title: `The ${FORMAT_LABEL[format]} file could not be made`, fallback: 'Try again in a moment.', retry: () => void download(format) });
    } finally {
      setDownloading(false);
    }
  };
  const noColumns = exportKeys.length === 0;
  const downloadItems: MenuItem[] = [
    { key: 'csv', label: 'CSV file', icon: FileText, onSelect: () => void download('csv'), disabled: noColumns, reason: noColumns ? 'Add columns first' : undefined },
    { key: 'excel', label: 'Excel workbook', icon: FileSpreadsheet, onSelect: () => void download('excel'), disabled: noColumns, reason: noColumns ? 'Add columns first' : undefined },
    { key: 'word', label: 'Word document', icon: FileType2, onSelect: () => void download('word'), disabled: noColumns, reason: noColumns ? 'Add columns first' : undefined },
    { key: 'pdf', label: 'PDF (print view)', icon: Printer, onSelect: () => void download('pdf'), disabled: noColumns || summary, reason: summary ? 'Prints the detail; download Excel or CSV for a summary' : noColumns ? 'Add columns first' : undefined },
  ];

  // ── leaving ──
  const back = (e: MouseEvent) => {
    if (!unsaved) return;
    e.preventDefault();
    void confirm({ title: 'Leave without saving?', message: 'This report has changes that were not saved.', confirmLabel: 'Leave without saving', cancelLabel: 'Stay', tone: 'danger' }).then((ok) => { if (ok) router.push('/reports'); });
  };
  const startNew = async () => {
    if (unsaved && !(await confirm({ title: 'Start a new report?', message: 'This report has changes that were not saved.', confirmLabel: 'Start a new report', tone: 'danger' }))) return;
    onNewReport();
  };

  const status = failure ? { text: 'Not saved', tone: 'warning' as const }
    : deviceOnly ? { text: 'Only on this device', tone: 'warning' as const }
    : unsaved ? { text: 'Unsaved changes', tone: 'warning' as const }
    : saved ? { text: 'Saved', tone: 'success' as const }
    : { text: 'New report', tone: 'muted' as const };

  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      <WorkspaceHead
        name={spec.name}
        onName={(name) => patch({ name })}
        moduleLine={moduleLine(dataset.module, dataset.label)}
        shared={!!spec.shared}
        canShare={!forkOwn}
        onShare={() => patch({ shared: !spec.shared })}
        saving={saving && sheet !== 'save'}
        status={status}
        onBack={back}
        onSave={save}
        onSaveAs={saveAs}
        onNew={() => void startNew()}
        downloadItems={downloadItems}
        downloading={downloading}
      />

      {forkOwn && <Notice tone="info">This report belongs to someone else and was shared with you. Saving makes your own copy of it.</Notice>}
      {failure && sheet !== 'save' && (
        <Notice
          tone="danger"
          title="The report was not saved"
          action={(
            <div className="flex flex-wrap gap-[8px]">
              <Button size="sm" leftIcon={<RotateCw aria-hidden />} loading={saving} onClick={() => void commit(failure.spec)}>Retry</Button>
              {failure.unreachable && <Button size="sm" onClick={() => void keepOnDevice(failure.spec)}>Keep on this device</Button>}
              <Button size="sm" variant="ghost" onClick={() => setFailure(null)}>Dismiss</Button>
            </div>
          )}
        >
          {failure.text}
        </Notice>
      )}

      <div className="lg:hidden">
        <SegmentedControl<Tab> label="Setup or preview" name="workspace-tab" options={[{ value: 'setup', label: 'Setup' }, { value: 'preview', label: 'Preview' }]} value={tab} onChange={setTab} />
      </div>

      <div className="grid min-w-0 items-start gap-[16px] lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className={tab === 'setup' ? 'min-w-0 lg:sticky lg:top-[0px] lg:max-h-[calc(100dvh-112px)] lg:overflow-y-auto' : 'hidden min-w-0 lg:sticky lg:top-[0px] lg:block lg:max-h-[calc(100dvh-112px)] lg:overflow-y-auto'}>
          <DefinitionRail
            dataset={dataset}
            groupedDatasets={groupedDatasets}
            spec={spec}
            patch={patch}
            data={data}
            draftRules={draftRules}
            setDraftRules={setDraftRules}
            draftSearch={draftSearch}
            setDraftSearch={setDraftSearch}
            filtersDirty={filtersDirty}
            applyFilters={applyFilters}
            resetFilters={resetFilters}
            onSwitchDataset={onSwitchDataset}
            onAddFields={() => setSheet('add')}
            onCalculated={() => setSheet('calc')}
            openRequest={openRequest}
          />
        </div>
        <div className={tab === 'preview' ? 'min-w-0' : 'hidden min-w-0 lg:block'}>
          <DataPane
            dataset={dataset}
            spec={spec}
            patch={patch}
            data={data}
            showTotals={showTotals}
            onShowTotals={setShowTotals}
            onAddFields={() => setSheet('add')}
            onEditFilters={() => goRail('filters')}
            onEditSummary={() => goRail('summary')}
            onRules={fromChip}
          />
        </div>
      </div>

      <AddFieldsSheet
        open={sheet === 'add'}
        onClose={() => setSheet(null)}
        dataset={dataset}
        datasets={datasets}
        groupedDatasets={groupedDatasets}
        visibleKeys={data.visibleKeys}
        onChange={(keys) => patch({ visibleColumns: keys })}
        linkageCatalog={data.linkageCatalog}
        linkageColumns={data.linkageColDefs}
        rows={data.rows}
      />
      <Sheet open={sheet === 'calc'} onClose={() => setSheet(null)} title="Calculated fields" width="md" dirty={calcEditing}>
        <CalcColumnPanel
          cols={data.sourceCols}
          defs={data.calcDefs}
          rows={data.rows}
          onChange={(next) => patch({ calcColumns: next })}
          onAddToReport={(key) => { if (!data.visibleKeys.includes(key)) patch({ visibleColumns: [...data.visibleKeys, key] }); }}
          onDraftChange={setCalcEditing}
        />
      </Sheet>
      <SaveSheet open={sheet === 'save'} mode={saveMode} initial={sheetInitial} saving={saving} error={failure && sheet === 'save' ? failure.text : null} onClose={() => setSheet(null)} onSave={(d) => void saveFromSheet(d)} />
      {confirmDialog}
    </div>
  );
}
