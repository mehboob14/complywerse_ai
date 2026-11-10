// A saved report as a file, straight from the library. It runs the SAME pipeline as the builder's table, the print view and the dashboard tiles (reportData.ts: columns, rows, the filtering the
// browser still owes, the report's own sort), so the numbers in the file are the numbers on those screens. The file holds the report's DETAIL (its columns, filters and links); a report that
// is a summary (it has measures) is downloaded from the builder, where its summary is built. The words (name, "file ready", the partial-data note) are fileModel.ts; the CSV is safeCsv.ts.
import { DATASETS, datasetByKey } from '../_reports/datasets';
import { fetchLinkageCatalog } from '../_reports/linkages';
import { compareRows, describeRules, displayText, rawValue } from '../_reports/grid-utils';
import { stashPrintSpec } from '../_reports/printPayload';
import { filterReportRows, loadReportRows, resolveReportColumns } from '../_reports/reportData';
import { coverage, type Coverage } from '../_reports/rowCoverage';
import { emptySpec, type ColumnDef, type ReportSpec } from '../_reports/types';
import { fileBase, type FileFormat } from './fileModel';
import { toSafeCsv } from './safeCsv';

export interface ReportFile {
  /** the name the person gave the report (or its module's) */
  name: string;
  /** the rows in the file */
  rows: number;
  coverage: Coverage;
}

const NONE: Coverage = { partial: false, text: '', short: '' };

function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** What the file says about how it was made (the Excel "Definition" sheet and the Word header). */
function facts(spec: ReportSpec, label: string, module: string, cols: ColumnDef[], rows: number, shown: ColumnDef[]): { label: string; value: string }[] {
  return [
    { label: 'Module', value: `${module} · ${label}` },
    { label: 'Rows', value: String(rows) },
    { label: 'Columns', value: shown.map((c) => c.label).join(', ') },
    { label: 'Filters', value: describeRules(cols, spec.rules) },
    ...(spec.search.trim() ? [{ label: 'Search', value: `“${spec.search.trim()}”` }] : []),
  ];
}

/** Writes the file (or, for PDF, opens the print view in a new tab). Throws with a sentence a person can read when it cannot. */
export async function makeFile(saved: ReportSpec, format: FileFormat, day: string): Promise<ReportFile> {
  const spec: ReportSpec = { ...emptySpec(saved.dataset), ...saved };               // a report saved by an older version may lack a field the pipeline reads
  const dataset = datasetByKey(spec.dataset);
  if (!dataset) throw new Error('This report reads a module that is no longer available.');
  const name = (spec.name || '').trim() || dataset.label;
  const base = fileBase(name, day);

  if (format === 'pdf') {
    // before any await: the new tab opens while the click is still the person's
    stashPrintSpec({ ...spec, name, view: 'table', dataset: dataset.key });
    window.open('/reports/print', '_blank', 'noopener');
    return { name, rows: 0, coverage: NONE };
  }

  const catalog = (await fetchLinkageCatalog(dataset.key, DATASETS)).defs;
  const plan = resolveReportColumns(spec, dataset, catalog);
  const loaded = await loadReportRows(spec, dataset, plan);
  const resolve = (k: string) => plan.lookupCols.find((c) => c.key === k);
  const matched = filterReportRows(plan.cols, loaded.rows, spec, !!dataset.server, resolve);
  const sorts = spec.sorts ?? [];
  const rows = sorts.length ? [...matched].sort((a, b) => compareRows(plan.cols, a, b, sorts)) : matched;
  const shown = (spec.visibleColumns ?? []).map((k) => plan.cols.find((c) => c.key === k)).filter((c): c is ColumnDef => !!c);
  if (shown.length === 0) throw new Error('This report has no columns yet. Open it and choose the columns first.');
  const note = coverage({ serverMode: !!dataset.server, loaded: loaded.rows.length, total: loaded.total });

  if (format === 'csv') {
    const body = rows.map((r) => shown.map((c) => {
      const raw = rawValue(c, r);
      return c.type === 'number' && raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : displayText(c, r);
    }));
    save(new Blob([toSafeCsv(shown.map((c) => c.label), body)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`);
  } else {
    // the spreadsheet and Word writers (and the large libraries behind them) are fetched only when someone downloads one of those
    const { exportExcelMulti, exportWord } = await import('../_reports/exporters');
    const lines = facts(spec, dataset.label, dataset.module, plan.cols, rows.length, shown);
    if (format === 'excel') {
      exportExcelMulti(base, [
        { name: 'Report', cols: shown, rows },
        { name: 'Definition', aoa: [['Field', 'Value'], ...lines.map((f) => [f.label, f.value])] },
      ]);
    } else {
      await exportWord(base, { title: name, subtitle: `${dataset.module} · ${dataset.label}`, facts: lines }, shown, rows);
    }
  }
  return { name, rows: rows.length, coverage: note };
}
