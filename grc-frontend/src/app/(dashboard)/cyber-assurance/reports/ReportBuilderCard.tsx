'use client';

// Custom Report Builder — the UI for the parameter-driven reporting engine
// (backend: grc/routers/reporting_router.py). The user picks a server dataset,
// ticks columns, adds typed filters, chooses CSV/XLSX, and Generate streams the
// file back (mirrors the SBP card's blob-download pattern). This slice wires only
// the datasets already registered server-side; it builds no new engine.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table2, Download, Loader2, AlertCircle, Plus, X, BarChart3 } from 'lucide-react';
import { MultiSelectDropdown } from '@/cyber-assurance/components/ui';
import { reportingApi, type ReportDatasetMeta, type ReportFilter, type ReportFilterType } from '@/cyber-assurance/lib/api';
import type { BuilderLoadRequest, BuilderSnapshot } from '@/cyber-assurance/lib/reportingExtrasApi';
import ReportPreview, { type PreviewRequest } from './ReportPreview';

const ACCENT = 'var(--color-base)';

// Friendly labels for the server dataset keys (the catalog ships keys only).
// ComplyVerse is CYBER-ONLY — these are the only datasets it reports on. The shared backend
// may also expose GRC datasets (risks, controls, evidence, issues, tasks, vendors,
// governance docs); AVA_DATASETS below hides everything not listed here so GRC data
// can never leak into ComplyVerse's dataset picker.
const DATASET_LABELS: Record<string, string> = {
  assets: 'Assets',
  vulnerabilities: 'Vulnerabilities',
  discovery: 'Discovered Devices',
  software_inventory: 'Software Inventory',
  cis_results: 'CIS Benchmark Results',
  risk_posture: 'Risk Posture',
  pentest_findings: 'Pentest Findings',
  pentest_scans: 'Pentest Scans',
  ctem_scopes: 'CTEM Scopes',
  sbp_inventory: 'SBP Offsite IT-Asset Inventory',
  helpdesk_tickets: 'Help Desk Tickets',
  licenses: 'Licenses',
};
const AVA_DATASETS = new Set(Object.keys(DATASET_LABELS));

const labelize = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Operators offered per filter UI-type — a safe subset of what the backend
// (_build_condition) accepts for each column kind.
const OPS: Record<ReportFilterType, { value: string; label: string }[]> = {
  text: [
    { value: 'contains', label: 'contains' },
    { value: 'eq', label: 'is' },
    { value: 'neq', label: 'is not' },
    { value: 'starts', label: 'starts with' },
  ],
  badge: [
    { value: 'eq', label: 'is' },
    { value: 'neq', label: 'is not' },
    { value: 'contains', label: 'contains' },
  ],
  number: [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '≠' },
    { value: 'gt', label: '>' },
    { value: 'lt', label: '<' },
    { value: 'gte', label: '≥' },
    { value: 'lte', label: '≤' },
  ],
  date: [
    { value: 'on', label: 'on' },
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
  ],
};

type DraftFilter = { id: number; col: string; op: string; value: string };

const selectCls =
  'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] focus:border-[var(--color-base)] focus:outline-none';

// Optional hooks the Reports page uses to connect saved / scheduled reports to the builder.
// All three are optional, so the card behaves exactly as before when rendered bare.
export interface ReportBuilderCardProps {
  /** Adopt this definition (dataset, columns, filters, logic, format) — e.g. "Open in builder" on a saved report. */
  load?: BuilderLoadRequest | null;
  /** Called with the builder's current definition whenever it changes (null until the catalog loads). */
  onSnapshot?: (snapshot: BuilderSnapshot | null) => void;
  /** Extra footer controls (Save / Schedule), rendered next to "Generate report". */
  footerExtras?: React.ReactNode;
}

export default function ReportBuilderCard({ load, onSnapshot, footerExtras }: ReportBuilderCardProps = {}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['reporting-datasets'],
    queryFn: async () => (await reportingApi.datasets()).data.datasets,
  });

  // Cyber-only: hide any GRC datasets the shared backend might expose.
  const datasets = useMemo<ReportDatasetMeta[]>(() => (data ?? []).filter((d) => AVA_DATASETS.has(d.key)), [data]);

  const [dataset, setDataset] = useState('');
  const ASSET_CATEGORY_OPTIONS: { value: string; label: string }[] = [
    { value: 'credential', label: 'Credentialed' },
    { value: 'uncredential', label: 'Uncredentialed' },
    { value: 'easm', label: 'EASM' },
    { value: 'pci', label: 'PCI (CDE)' },
    { value: 'adhoc', label: 'Ad-hoc (pentest)' },
  ];
  const [assetCategories, setAssetCategories] = useState<string[]>(['credential', 'uncredential', 'easm', 'pci']);
  const showScope = dataset === 'assets' || dataset === 'sbp_inventory';
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [filters, setFilters] = useState<DraftFilter[]>([]);
  const [logic, setLogic] = useState<'AND' | 'OR'>('AND');
  const [format, setFormat] = useState<'csv' | 'xlsx' | 'pdf' | 'html'>('csv');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRequest | null>(null);
  const previewNonce = useRef(0);  // bumped per "Update report" click so it always refetches

  const meta = useMemo(() => datasets.find((d) => d.key === dataset), [datasets, dataset]);

  // Column options: each projected field, user-FK ids shown as their resolved name.
  const columnOptions = useMemo(() => {
    if (!meta) return [] as { value: string; label: string }[];
    return meta.fields.map((f) => {
      const key = meta.user_fields[f] ?? f;
      return { value: key, label: labelize(key) };
    });
  }, [meta]);

  const filterCols = useMemo(() => (meta ? Object.keys(meta.filterable) : []), [meta]);

  // Pick a default dataset once the catalog loads.
  useEffect(() => {
    if (!dataset && datasets.length) {
      setDataset(datasets.find((d) => d.key === 'assets')?.key ?? datasets[0].key);
    }
  }, [datasets, dataset]);

  // A definition waiting for its dataset to become active (see the load effect below).
  const pendingLoad = useRef<BuilderSnapshot | null>(null);

  // Adopt a definition for `m`: keep only columns/filters that still exist in the catalog.
  const applySnapshot = useCallback((s: BuilderSnapshot, m: ReportDatasetMeta) => {
    const allCols = m.fields.map((f) => m.user_fields[f] ?? f);
    const valid = new Set(allCols);
    const cols = s.columns.filter((c) => valid.has(c));
    setSelectedCols(cols.length ? cols : allCols);
    setFilters(
      s.filters
        .filter((f) => f.col in m.filterable)
        .map((f, i) => ({ id: Date.now() + i, col: f.col, op: f.op, value: f.value == null ? '' : String(f.value) })),
    );
    setLogic(s.logic === 'OR' ? 'OR' : 'AND');
    setFormat(s.format);
    setErr(null);
  }, []);

  // Reset columns (all ticked) + filters whenever the dataset changes — unless a load
  // request is waiting for exactly this dataset, in which case that definition wins.
  useEffect(() => {
    if (!meta) return;
    const pending = pendingLoad.current;
    pendingLoad.current = null;
    if (pending && pending.dataset === meta.key) {
      applySnapshot(pending, meta);
      return;
    }
    setSelectedCols(meta.fields.map((f) => meta.user_fields[f] ?? f));
    setFilters([]);
    setErr(null);
  }, [meta, applySnapshot]);

  // External "load this definition" request (nonce changes on every request).
  useEffect(() => {
    if (!load) return;
    if (meta && meta.key === load.snapshot.dataset) {
      applySnapshot(load.snapshot, meta);
    } else {
      pendingLoad.current = load.snapshot;
      setDataset(load.snapshot.dataset);
    }
    // Only a new request should re-run this, not every catalog / state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load?.nonce]);

  // Populate the dashboard canvas whenever the active dataset changes, using the
  // post-reset defaults (all columns, no filters) so a report is visible without a
  // click. Column / filter / category edits refresh it via the "Update report" button.
  useEffect(() => {
    if (!meta) return;
    setPreview({
      dataset: meta.key,
      label: DATASET_LABELS[meta.key] ?? labelize(meta.key),
      columns: meta.fields.map((f) => meta.user_fields[f] ?? f),
      filters: [],
      logic: 'AND',
      assetCategories:
        meta.key === 'assets' || meta.key === 'sbp_inventory' ? assetCategories : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.key]);

  // The filters the backend will actually receive (blank values are dropped, numbers coerced).
  const filterPayload = useMemo<ReportFilter[]>(
    () =>
      filters
        .filter((f) => f.col && f.value.trim() !== '')
        .map((f) => ({
          col: f.col,
          op: f.op,
          value: meta?.filterable[f.col] === 'number' ? Number(f.value) : f.value,
        })),
    [filters, meta],
  );

  // Tell the page what is configured right now (powers Save / Schedule).
  useEffect(() => {
    if (!onSnapshot) return;
    onSnapshot(meta ? { dataset, columns: selectedCols, filters: filterPayload, logic, format } : null);
    // onSnapshot is a state setter on the page; the definition inputs are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, dataset, selectedCols, filterPayload, logic, format]);

  const addFilter = () => {
    if (!meta || !filterCols.length) return;
    const col = filterCols[0];
    const type = meta.filterable[col];
    setFilters((f) => [...f, { id: Date.now() + f.length, col, op: OPS[type][0].value, value: '' }]);
  };

  const patchFilter = (id: number, patch: Partial<DraftFilter>) =>
    setFilters((fs) =>
      fs.map((f) => {
        if (f.id !== id) return f;
        const next = { ...f, ...patch };
        // When the column changes, reset the operator to that type's default.
        if (patch.col && meta) next.op = OPS[meta.filterable[patch.col]][0].value;
        return next;
      }),
    );

  const removeFilter = (id: number) => setFilters((fs) => fs.filter((f) => f.id !== id));

  const runExport = async () => {
    if (!meta || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await reportingApi.exportReport({
        dataset,
        columns: selectedCols,
        filters: filterPayload,
        logic,
        format,
        asset_categories: showScope ? assetCategories : undefined,
      });
      const today = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dataset}-report-${today}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      // Blob error bodies need decoding to surface the backend detail (e.g. 403).
      let msg = 'Export failed — please try again.';
      const blob = (e as { response?: { data?: unknown } })?.response?.data;
      if (blob instanceof Blob) {
        try {
          msg = JSON.parse(await blob.text())?.detail || msg;
        } catch {
          /* keep generic message */
        }
      }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* ── Controls rail: dataset, columns, filters, format and actions ── */}
      <aside className="w-full flex-none rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm lg:sticky lg:top-4 lg:w-[320px] lg:max-h-[calc(100vh-6.5rem)] lg:overflow-y-auto scrollbar-thin">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg"
            style={{ background: 'var(--color-base-soft)', color: ACCENT }}
          >
            <Table2 size={18} />
          </div>
          <h2 className="text-[14px] font-semibold text-[var(--color-text)]">Report Builder</h2>
        </div>

        {isLoading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <Loader2 size={15} className="animate-spin" /> Loading datasets…
          </div>
        ) : isError || !datasets.length ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-[var(--color-danger)]">
            <AlertCircle size={15} /> Could not load the report catalog.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Dataset */}
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Dataset
              </span>
              <select
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
                className={`${selectCls} w-full`}
              >
                {datasets.map((d) => (
                  <option key={d.key} value={d.key}>
                    {DATASET_LABELS[d.key] ?? labelize(d.key)}
                  </option>
                ))}
              </select>
            </label>

            {/* Columns */}
            <div>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Columns ({selectedCols.length}/{columnOptions.length})
              </span>
              <MultiSelectDropdown
                title="Columns"
                triggerVariant="input"
                placeholder="Select columns…"
                items={columnOptions}
                selectedValues={selectedCols}
                onApply={setSelectedCols}
                forceSearch
                triggerClassName="w-full"
              />
            </div>

            {/* Asset categories */}
            {showScope && (
              <div>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Asset categories ({assetCategories.length}/{ASSET_CATEGORY_OPTIONS.length})
                </span>
                <MultiSelectDropdown
                  title="Asset categories"
                  triggerVariant="input"
                  placeholder="Select categories…"
                  items={ASSET_CATEGORY_OPTIONS}
                  selectedValues={assetCategories}
                  onApply={setAssetCategories}
                  triggerClassName="w-full"
                />
              </div>
            )}

            {/* Filters */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Filters
                </span>
                <button
                  onClick={addFilter}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2 py-1 text-[13px] font-medium text-[var(--color-text)] hover:bg-[var(--color-subtle)]"
                >
                  <Plus size={13} /> Add
                </button>
              </div>

              {filters.length > 1 && (
                <select
                  value={logic}
                  onChange={(e) => setLogic(e.target.value as 'AND' | 'OR')}
                  className={`${selectCls} mb-2 w-full`}
                  aria-label="Combine filters with AND or OR"
                >
                  <option value="AND">Match all (AND)</option>
                  <option value="OR">Match any (OR)</option>
                </select>
              )}

              {filters.length === 0 ? (
                <p className="text-[12px] text-[var(--color-muted)]">
                  No filters — every row is included.
                </p>
              ) : (
                <div className="space-y-2">
                  {filters.map((f) => {
                    const type: ReportFilterType = meta?.filterable[f.col] ?? 'text';
                    return (
                      <div key={f.id} className="rounded-lg border border-[var(--color-border)] p-2">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={f.col}
                            onChange={(e) => patchFilter(f.id, { col: e.target.value })}
                            className={`${selectCls} min-w-0 flex-1`}
                          >
                            {filterCols.map((c) => (
                              <option key={c} value={c}>
                                {labelize(c)}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => removeFilter(f.id)}
                            className="flex-none rounded-lg p-1 text-[var(--color-muted)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-text)]"
                            aria-label="Remove filter"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <select
                            value={f.op}
                            onChange={(e) => patchFilter(f.id, { op: e.target.value })}
                            className={selectCls}
                          >
                            {OPS[type].map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <input
                            type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
                            value={f.value}
                            onChange={(e) => patchFilter(f.id, { value: e.target.value })}
                            placeholder="value"
                            className={`${selectCls} min-w-0 flex-1`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Download format */}
            <div>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Download format
              </span>
              <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-[var(--color-border)]">
                {(['csv', 'xlsx', 'pdf', 'html'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setFormat(fmt)}
                    className="py-1.5 text-[13px] font-medium"
                    style={
                      format === fmt
                        ? { background: ACCENT, color: 'var(--color-on-base)' }
                        : { color: 'var(--color-muted)' }
                    }
                  >
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
              {err && (
                <span className="flex items-center gap-1 text-[12px] text-[var(--color-danger)]">
                  <AlertCircle size={13} /> {err}
                </span>
              )}
              <button
                onClick={() =>
                  setPreview({
                    dataset,
                    label: DATASET_LABELS[dataset] ?? labelize(dataset),
                    columns: selectedCols,
                    filters: filterPayload,
                    logic,
                    assetCategories: showScope ? assetCategories : undefined,
                    nonce: ++previewNonce.current,
                  })
                }
                disabled={!selectedCols.length}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-subtle)] disabled:opacity-60"
              >
                <BarChart3 size={15} /> Update report
              </button>
              <button
                onClick={runExport}
                disabled={busy || !selectedCols.length}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[var(--color-on-base)] disabled:opacity-60"
                style={{ background: ACCENT }}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                Download {format.toUpperCase()}
              </button>
              {footerExtras && <div className="flex flex-wrap gap-2 pt-1">{footerExtras}</div>}
            </div>
          </div>
        )}
      </aside>

      {/* ── Dashboard canvas: the visual report, front and centre ── */}
      <section className="min-w-0 flex-1">
        {preview && meta ? (
          <ReportPreview req={preview} filterable={meta.filterable} onClose={() => setPreview(null)} />
        ) : (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
            <BarChart3 size={30} className="text-[var(--color-muted)]" />
            <p className="mt-3 text-sm font-medium text-[var(--color-text)]">Your report dashboard appears here</p>
            <p className="mt-1 text-[13px] text-[var(--color-muted)]">
              Pick a dataset and filters on the left, then click <span className="font-medium">Update report</span>.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
