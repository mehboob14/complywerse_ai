'use client';

// Smart asset-import wizard — Upload -> Map columns -> Preview -> Result.
// Accepts ANY .csv/.xlsx: the backend auto-detects the header row and suggests a
// column mapping (by header names AND by sniffing values); the user confirms,
// previews, and imports. Provenance batch id enables one-click Undo. Isolated:
// the only edit to existing code is the Import button in page.tsx pointing here.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, AlertTriangle, Loader2, Download, FileDown, ArrowRight, ArrowLeft, Undo2, Clock, Sparkles } from 'lucide-react';
import { assetsApi } from '@/cyber-assurance/lib/api';
import { assetImportApi, AnalyzeResult, CommitResult, ValidateResult, HistoryItem } from './api';

type Step = 'upload' | 'map' | 'preview' | 'result';

function SumPill({ n, label, cls }: { n: number; label: string; cls: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}><b>{n}</b> {label}</span>;
}

export function SmartImportWizard({ onClose, onSuccess, kind = 'asset' }: { onClose: () => void; onSuccess: () => void; kind?: 'asset' | 'vuln' }) {
  const isVuln = kind === 'vuln';
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  // source header -> canonical field ("" = ignore)
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dupe, setDupe] = useState<'skip' | 'update'>('skip');

  const [result, setResult] = useState<CommitResult | null>(null);
  const [undone, setUndone] = useState(false);

  // ── validation (dry-run) + import history ────────────────────────────────
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [hist, setHist] = useState<HistoryItem[]>([]);
  const [undoingBatch, setUndoingBatch] = useState<string | null>(null);

  // ── AI-assisted mapping (LLM fallback for weird columns) ─────────────────
  const [aiBusy, setAiBusy] = useState(false);
  const [aiOverlay, setAiOverlay] = useState<Record<string, { confidence: string; why: string }>>({});
  const [aiNote, setAiNote] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try { const { data } = await assetImportApi.history(kind); setHist(data.items || []); }
    catch { /* history is non-critical — never block the wizard on it */ }
  }, [kind]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const undoBatch = async (batchId: string) => {
    setUndoingBatch(batchId);
    setError(null);
    try { await assetImportApi.undo(batchId, kind); await loadHistory(); onSuccess(); }
    catch (e: any) { setError(e?.response?.data?.detail || 'Undo failed.'); }
    finally { setUndoingBatch(null); }
  };

  // ── step 1: upload + analyze ────────────────────────────────────────────
  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!/\.(csv|xlsx)$/i.test(f.name)) {
      setError('Please choose a .csv or .xlsx file (.xls isn’t supported yet — save it as .xlsx).');
      return;
    }
    setError(null);
    setFile(f);
  };

  const analyze = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await assetImportApi.analyze(file, kind);
      setAnalysis(data);
      const init: Record<string, string> = {};
      data.columns.forEach((c) => { init[c] = data.suggested_mapping[c]?.field || ''; });
      setMapping(init);
      setAiOverlay({});
      setAiNote(null);
      setStep('map');
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not read the file.');
    } finally {
      setBusy(false);
    }
  };

  // ── mapping helpers ─────────────────────────────────────────────────────
  const mappedFields = useMemo(() => new Set(Object.values(mapping).filter(Boolean)), [mapping]);
  const hasIdentity = (isVuln ? ['title'] : ['name', 'host_name', 'ip_address']).some((f) => mappedFields.has(f));
  const mappedCount = mappedFields.size;

  const setCol = (col: string, field: string) => {
    setMapping((m) => {
      const next = { ...m, [col]: field };
      // a canonical field can only come from one column — clear the previous owner
      if (field) {
        for (const k of Object.keys(next)) if (k !== col && next[k] === field) next[k] = '';
      }
      return next;
    });
  };

  // ── AI assist: ask the LLM to map columns the rules couldn't place ────────
  const runAiMap = async () => {
    if (!analysis) return;
    setAiBusy(true);
    setAiNote(null);
    try {
      const samples: Record<string, unknown[]> = {};
      analysis.columns.forEach((c) => {
        samples[c] = analysis.sample_rows
          .map((r) => r[c])
          .filter((v) => v != null && String(v).trim() !== '')
          .slice(0, 3);
      });
      const { data } = await assetImportApi.aiMap(kind, analysis.columns, samples);
      if (!data.ai_used) { setAiNote(data.error || 'AI is not available.'); return; }
      const overlay: Record<string, { confidence: string; why: string }> = {};
      Object.entries(data.mapping).forEach(([col, s]) => { overlay[col] = { confidence: s.confidence, why: s.why }; });
      const next = { ...mapping };
      let n = 0;
      Object.entries(data.mapping).forEach(([col, s]) => {
        if (s.field) {
          for (const k of Object.keys(next)) if (k !== col && next[k] === s.field) next[k] = '';
          next[col] = s.field; n++;
        }
      });
      setMapping(next);
      setAiOverlay(overlay);
      setAiNote(`AI reviewed ${analysis.columns.length} columns and mapped ${n}.`);
    } catch (e: any) {
      setAiNote(e?.response?.data?.detail || 'AI mapping failed.');
    } finally {
      setAiBusy(false);
    }
  };

  // ── step 3: preview (client-side, raw values; server normalizes on import) ─
  const previewCols = useMemo(() => {
    if (!analysis) return [] as { key: string; label: string }[];
    return analysis.canonical_fields.filter((f) => mappedFields.has(f.key));
  }, [analysis, mappedFields]);

  const previewRows = useMemo(() => {
    if (!analysis) return [] as Record<string, unknown>[];
    const colByField: Record<string, string> = {};
    Object.entries(mapping).forEach(([col, field]) => { if (field) colByField[field] = col; });
    return analysis.sample_rows.map((row) => {
      const out: Record<string, unknown> = {};
      previewCols.forEach((c) => { out[c.key] = row[colByField[c.key]]; });
      return out;
    });
  }, [analysis, mapping, previewCols]);

  // ── validate (dry-run) on entering preview + when dupe strategy changes ───
  const runValidate = useCallback(async (strategy: 'skip' | 'update') => {
    if (!file || !analysis) return;
    setValidating(true);
    try {
      const colmap: Record<string, string | null> = {};
      Object.entries(mapping).forEach(([col, field]) => { colmap[col] = field || null; });
      const { data } = await assetImportApi.validate(
        file, colmap, { dupe_strategy: strategy, header_row: analysis.header_row }, kind);
      setValidation(data);
    } catch { setValidation(null); }
    finally { setValidating(false); }
  }, [file, analysis, mapping, kind]);

  const goPreview = async () => { setStep('preview'); runValidate(dupe); };
  const setDupeAndRevalidate = (s: 'skip' | 'update') => { setDupe(s); runValidate(s); };

  const rowsWithIssues = useMemo(
    () => (validation?.rows || []).filter((r) => r.issues.length > 0),
    [validation]);

  const downloadIssues = () => {
    const rows = rowsWithIssues;
    if (!rows.length) return;
    const esc = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const csv = ['row,identity,action,level,field,message',
      ...rows.flatMap((r) => r.issues.map((i) =>
        [r.row, r.identity ?? '', r.action, i.level, i.field, i.message].map(esc).join(',')))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `import-issues-${kind}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── step 4: commit ──────────────────────────────────────────────────────
  const commit = async () => {
    if (!file || !analysis) return;
    setBusy(true);
    setError(null);
    try {
      const colmap: Record<string, string | null> = {};
      Object.entries(mapping).forEach(([col, field]) => { colmap[col] = field || null; });
      const { data } = await assetImportApi.commit(file, colmap, {
        dupe_strategy: dupe,
        header_row: analysis.header_row,
      }, kind);
      setResult(data);
      setStep('result');
      if (data.created + data.updated > 0) onSuccess();
      loadHistory();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!result) return;
    setBusy(true);
    try {
      await assetImportApi.undo(result.batch_id, kind);
      setUndone(true);
      onSuccess();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Undo failed.');
    } finally {
      setBusy(false);
    }
  };

  const wide = step === 'map' || step === 'preview';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`flex max-h-[90vh] w-full flex-col rounded-xl border border-gray-200 bg-white shadow-xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        {/* header + step rail */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-black">Import {isVuln ? 'Vulnerabilities' : 'IT Assets'}</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {(['upload', 'map', 'preview', 'result'] as Step[]).map((s, i) => (
                <span key={s} className={step === s ? 'font-semibold text-blue-600' : ''}>
                  {i > 0 && ' → '}{['Upload', 'Map', 'Preview', 'Done'][i]}
                </span>
              ))}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 flex-none" />{error}
            </div>
          )}

          {/* ── UPLOAD ─────────────────────────────────────────────── */}
          {step === 'upload' && (
            <>
              <div className="mb-4 rounded-lg border border-gray-200 bg-slate-50 p-4 text-xs text-gray-600">
                <div className="flex items-start gap-3">
                  <FileSpreadsheet className="mt-0.5 h-5 w-5 text-blue-600" />
                  <div>
                    <p className="text-sm font-medium text-black">Upload your {isVuln ? 'findings' : 'asset'} list — any layout works.</p>
                    <p className="mt-1">We’ll auto-detect your columns and map them to the {isVuln ? 'vulnerability' : 'inventory'} fields; you confirm before anything is saved. No template required.{isVuln ? ' Findings auto-link to matching assets by host/IP.' : ''}</p>
                    {!isVuln && (
                      <button onClick={() => assetsApi.downloadTemplate()} className="mt-2 inline-flex items-center gap-1 font-medium text-blue-600 hover:underline">
                        <Download size={13} /> Download our template (optional)
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div
                className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors ${dragActive ? 'border-blue-500 bg-blue-50' : file ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-gray-400'}`}
                onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                onDrop={(e) => { e.preventDefault(); setDragActive(false); pickFile(e.dataTransfer.files?.[0] || null); }}
              >
                <input type="file" accept=".csv,.xlsx" onChange={(e) => pickFile(e.target.files?.[0] || null)} className="absolute inset-0 cursor-pointer opacity-0" />
                {file ? (
                  <div className="flex flex-col items-center">
                    <CheckCircle2 className="mb-2 h-10 w-10 text-green-600" />
                    <p className="font-medium text-black">{file.name}</p>
                    <p className="mt-1 text-sm text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <Upload className="mb-2 h-10 w-10 text-gray-400" />
                    <p className="text-black">Drag &amp; drop, or click to browse</p>
                    <p className="mt-1 text-xs text-gray-400">Supports CSV and XLSX</p>
                  </div>
                )}
              </div>

              {hist.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-500"><Clock size={13} /> Recent imports</p>
                  <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {hist.map((h) => (
                      <div key={h.batch_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-black">{h.filename}</p>
                          <p className="text-xs text-gray-500">
                            {h.count} {isVuln ? 'finding' : 'asset'}{h.count === 1 ? '' : 's'}
                            {h.created_at ? ` · ${new Date(h.created_at).toLocaleString()}` : ''}
                          </p>
                        </div>
                        <button onClick={() => undoBatch(h.batch_id)} disabled={undoingBatch === h.batch_id}
                          className="inline-flex flex-none items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                          {undoingBatch === h.batch_id ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Undo
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── MAP ────────────────────────────────────────────────── */}
          {step === 'map' && analysis && (
            <>
              <div className="mb-3 flex items-start justify-between gap-3">
                <p className="text-sm text-gray-600">
                  Found <b>{analysis.row_count}</b> rows. Confirm how your columns map to the {isVuln ? 'vulnerability' : 'inventory'} fields —
                  we’ve pre-filled our best guess. Set anything you don’t want to <i>Ignore</i>.
                </p>
                {analysis.ai_available && (
                  <button onClick={runAiMap} disabled={aiBusy}
                    className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                    title="Let AI map the columns the rules couldn't place">
                    {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI assist
                  </button>
                )}
              </div>
              {aiNote && <p className="mb-3 flex items-center gap-1.5 text-xs text-purple-700"><Sparkles size={13} /> {aiNote}</p>}
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr><th className="p-2.5">Your column</th><th className="p-2.5">Sample</th><th className="p-2.5">Maps to</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {analysis.columns.map((col) => {
                      const sug = analysis.suggested_mapping[col];
                      const conf = sug?.confidence ?? 0;
                      const chip = conf >= 0.8 ? 'bg-green-100 text-green-700' : conf >= 0.5 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500';
                      const samples = analysis.sample_rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '').slice(0, 2);
                      return (
                        <tr key={col}>
                          <td className="p-2.5 align-top">
                            <div className="font-medium text-black">{col}</div>
                            {aiOverlay[col] ? (
                              <span className="mt-1 inline-block rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">{aiOverlay[col].why}</span>
                            ) : sug?.field ? (
                              <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${chip}`}>{Math.round(conf * 100)}% · {sug.why}</span>
                            ) : null}
                          </td>
                          <td className="p-2.5 align-top text-xs text-gray-500">{samples.map((s, i) => <div key={i} className="truncate max-w-[160px]">{String(s)}</div>)}</td>
                          <td className="p-2.5 align-top">
                            <select value={mapping[col] || ''} onChange={(e) => setCol(col, e.target.value)}
                              className={`w-full rounded-md border px-2 py-1.5 text-sm ${mapping[col] ? 'border-gray-300 text-black' : 'border-gray-200 text-gray-400'}`}>
                              <option value="">— Ignore —</option>
                              {analysis.canonical_fields.map((f) => (
                                <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!hasIdentity && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-700"><AlertCircle size={14} /> {isVuln ? <>Map a column to <b>Title</b> to continue.</> : <>Map at least one column to <b>Asset name</b> (or Hostname / IP) to continue.</>}</p>
              )}
            </>
          )}

          {/* ── PREVIEW ────────────────────────────────────────────── */}
          {step === 'preview' && analysis && (
            <>
              {/* validation summary — a real dry-run of what commit will do */}
              <div className="mb-3">
                {validating ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={15} className="animate-spin" /> Checking your data…</div>
                ) : validation ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <SumPill n={validation.summary.create} label="to create" cls="bg-green-100 text-green-700" />
                    {validation.summary.update > 0 && <SumPill n={validation.summary.update} label="to update" cls="bg-blue-100 text-blue-700" />}
                    <SumPill n={validation.summary.skip} label="to skip" cls="bg-gray-100 text-gray-600" />
                    {validation.summary.error > 0 && <SumPill n={validation.summary.error} label="error" cls="bg-red-100 text-red-700" />}
                    {isVuln && (validation.summary.linked ?? 0) > 0 && <SumPill n={validation.summary.linked!} label="auto-link" cls="bg-teal-100 text-teal-700" />}
                    <span className="text-xs text-gray-400">of {validation.row_count} rows</span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Preview of your data as it’ll import. Values are normalized on save (e.g. “H” → High).</p>
                )}
              </div>

              {/* dedupe strategy — drives the counts above (re-checks on change) */}
              <div className="mb-3 rounded-lg border border-gray-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-medium text-gray-600">{isVuln ? 'When a row matches an existing finding (by title + host):' : 'When a row matches an existing asset (by name / hostname / IP):'}</p>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" checked={dupe === 'skip'} onChange={() => setDupeAndRevalidate('skip')} /> Skip it</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={dupe === 'update'} onChange={() => setDupeAndRevalidate('update')} /> Update it in place</label>
                </div>
              </div>

              {/* data-quality issues + downloadable report */}
              {rowsWithIssues.length > 0 && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50">
                  <div className="flex items-center justify-between px-3 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800"><AlertTriangle size={14} /> {rowsWithIssues.length} row{rowsWithIssues.length === 1 ? '' : 's'} need a look</p>
                    <button onClick={downloadIssues} className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 hover:underline"><FileDown size={13} /> Download report</button>
                  </div>
                  <div className="max-h-40 overflow-y-auto border-t border-amber-200 px-3 py-2 text-xs">
                    {rowsWithIssues.slice(0, 50).map((r) => (
                      <div key={r.row} className="py-0.5">
                        <span className="font-medium text-gray-700">Row {r.row}{r.identity ? ` · ${r.identity}` : ''}:</span>{' '}
                        {r.issues.map((iss, k) => (
                          <span key={k} className={iss.level === 'error' ? 'text-red-600' : 'text-amber-700'}>{iss.message}{k < r.issues.length - 1 ? '; ' : ''}</span>
                        ))}
                      </div>
                    ))}
                    {rowsWithIssues.length > 50 && <div className="mt-1 text-gray-400">… and {rowsWithIssues.length - 50} more (in the report)</div>}
                  </div>
                </div>
              )}

              {/* sample rows exactly as they'll import */}
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>{previewCols.map((c) => <th key={c.key} className="whitespace-nowrap p-2.5">{c.label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewRows.map((row, i) => (
                      <tr key={i}>{previewCols.map((c) => <td key={c.key} className="whitespace-nowrap p-2.5 text-gray-700">{row[c.key] != null ? String(row[c.key]) : <span className="text-gray-300">—</span>}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── RESULT ─────────────────────────────────────────────── */}
          {step === 'result' && result && (
            <div className={`rounded-lg border p-4 ${(result.created + result.updated) > 0 && !undone ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-slate-50'}`}>
              <div className="flex items-start gap-3">
                {undone ? <Undo2 className="mt-0.5 h-5 w-5 text-gray-600" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />}
                <div className="text-sm">
                  <p className="font-medium text-black">{undone ? 'Import reverted.' : result.message}</p>
                  {!undone && (
                    <div className="mt-1 text-gray-600">
                      <span className="mr-3">Added: <b>{result.created}</b></span>
                      <span className="mr-3">Updated: <b>{result.updated}</b></span>
                      <span className="mr-3">Skipped: <b>{result.skipped}</b></span>
                      {result.total_errors > 0 && <span className="text-red-600">Errors: <b>{result.total_errors}</b></span>}
                    </div>
                  )}
                </div>
              </div>
              {!undone && result.errors.length > 0 && (
                <div className="mt-3 max-h-32 overflow-y-auto rounded border border-gray-200 bg-white p-2 text-xs text-red-600">
                  {result.errors.map((e, i) => <div key={i}>{e}</div>)}
                  {result.total_errors > result.errors.length && <div className="mt-1 text-gray-400">… and {result.total_errors - result.errors.length} more</div>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* footer actions */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
          <div>
            {step === 'result' && result && !undone && (result.created + result.updated) > 0 && (
              <button onClick={undo} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 size={15} />} Undo this import
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {step === 'map' && <button onClick={() => setStep('upload')} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"><ArrowLeft size={15} /> Back</button>}
            {step === 'preview' && <button onClick={() => setStep('map')} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"><ArrowLeft size={15} /> Back</button>}

            {step === 'upload' && (
              <button onClick={analyze} disabled={!file || busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight size={15} />} Analyze file
              </button>
            )}
            {step === 'map' && (
              <button onClick={goPreview} disabled={!hasIdentity} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
                Preview {mappedCount} field{mappedCount === 1 ? '' : 's'} <ArrowRight size={15} />
              </button>
            )}
            {step === 'preview' && (
              <button onClick={commit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 size={15} />} Import {analysis?.row_count} rows
              </button>
            )}
            {step === 'result' && (
              <button onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">Done</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
