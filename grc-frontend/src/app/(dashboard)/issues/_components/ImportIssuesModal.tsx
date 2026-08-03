'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Upload, X } from 'lucide-react';
import { issuesApi } from '@/lib/api';

export function ImportIssuesModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    imported: number;
    capa_created?: number;
    total_rows: number;
    errors: string[];
    total_errors: number;
    message: string;
  } | null>(null);

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    try {
      const response = await issuesApi.importIssues(file);
      setResult(response.data);
      if (response.data.imported > 0) {
        qc.invalidateQueries({ queryKey: ['issues'] });
        qc.invalidateQueries({ queryKey: ['capa-actions'] });
        qc.invalidateQueries({ queryKey: ['issues-overview'] });
      }
    } catch (error: any) {
      setResult({
        success: false,
        imported: 0,
        total_rows: 0,
        errors: [error?.response?.data?.detail || 'Upload failed'],
        total_errors: 1,
        message: 'Upload failed',
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Import Issues</h2>
            <p className="text-[11px] text-slate-500">CSV or Excel (.xlsx / .xls)</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <button
            type="button"
            onClick={() => issuesApi.downloadTemplate()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            Download template
          </button>

          <div
            onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const f = e.dataTransfer.files?.[0];
              if (f && /\.(csv|xlsx|xls)$/i.test(f.name)) {
                setFile(f);
                setResult(null);
              }
            }}
            className={`rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
              dragActive ? 'border-primary-400 bg-primary-50/40' : 'border-slate-200 bg-slate-50'
            }`}
          >
            <Upload className="mx-auto mb-2 h-6 w-6 text-slate-400" />
            <p className="text-xs text-slate-600">
              {file ? <span className="font-medium text-slate-800">{file.name}</span> : 'Drop a file here, or browse'}
            </p>
            <label className="mt-2 inline-flex cursor-pointer rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-primary-700 border border-slate-200 hover:bg-slate-50">
              Browse
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setFile(f); setResult(null); }
                }}
              />
            </label>
          </div>

          {result && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${result.success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
              <p className="font-medium">{result.message}</p>
              {result.capa_created ? (
                <p className="mt-0.5">Initial CAPA actions created: {result.capa_created}</p>
              ) : null}
              {result.errors?.length > 0 && (
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {result.errors.slice(0, 8).map((err) => <li key={err}>{err}</li>)}
                  {result.total_errors > 8 && <li>…and {result.total_errors - 8} more</li>}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">
            Close
          </button>
          <button
            type="button"
            disabled={!file || isUploading}
            onClick={handleUpload}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-700 disabled:bg-slate-300"
          >
            {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {isUploading ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
