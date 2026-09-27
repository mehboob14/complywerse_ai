'use client';

// Bulk create or update vendors from a sheet. Checking the file first shows what
// every row would do; importing is all or nothing, so one bad row changes nothing.

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { clsx } from 'clsx';
import { vendorOnboardingApi } from '@/lib/api';
import { errText } from '../_lib/intake/types';

interface PlanRow { row: number; action: 'create' | 'update' | 'error'; name: string; vendor_id: number | null; changes: string[]; errors: string[] }
interface Plan { dry_run: boolean; summary: { create: number; update: number; error: number }; rows: PlanRow[]; ignored_columns: string[] }

const ACTION_CLS = {
  create: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  update: 'bg-sky-50 text-sky-700 border-sky-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
};

export default function ImportVendors({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [done, setDone] = useState<Plan | null>(null);

  const check = useMutation({
    mutationFn: async (f: File) => (await vendorOnboardingApi.importVendors(f, true)).data as Plan,
    onSuccess: setPlan,
  });
  const apply = useMutation({
    mutationFn: async (f: File) => (await vendorOnboardingApi.importVendors(f, false)).data as Plan,
    onSuccess: (p) => { setDone(p); onDone(); },
  });
  const template = async () => {
    const res = await vendorOnboardingApi.importTemplate();
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vendor-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  const changes = plan ? plan.summary.create + plan.summary.update : 0;
  const error = check.error || apply.error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="import-title" className="text-base font-semibold text-slate-900">Import vendors</h2>
            <p className="text-sm text-slate-500">Create new vendors or update existing ones from a CSV or Excel sheet.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {done ? (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              Imported: {done.summary.create} created and {done.summary.update} updated. Each change is on the vendor&apos;s history.
            </div>
          ) : (
            <>
              <ol className="space-y-2 text-sm text-slate-600">
                <li>
                  1. <button type="button" onClick={template} className="inline-flex items-center gap-1 font-medium text-primary-700 hover:underline">
                    <Download className="h-3.5 w-3.5" /> Download the template</button>. Only <span className="font-medium">name</span> is needed for a new vendor.
                </li>
                <li>2. A row updates the vendor with the same website, or else the same name; blank cells leave a field as it is.</li>
                <li>3. Owners are matched by email. Separate several data types or locations with a semicolon.</li>
              </ol>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 px-4 py-4 hover:bg-slate-50">
                <FileSpreadsheet className="h-6 w-6 text-slate-400" />
                <span className="flex-1 text-sm text-slate-600">{file ? file.name : 'Choose a .csv or .xlsx file'}</span>
                <input type="file" accept=".csv,.xlsx" className="sr-only"
                  onChange={(e) => { setFile(e.target.files?.[0] || null); setPlan(null); }} />
                <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">Browse</span>
              </label>
            </>
          )}

          {error && <p className="text-sm text-rose-700">{errText(error, 'Could not read the file')}</p>}

          {plan && !done && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-emerald-700">{plan.summary.create} new</span>
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-sky-700">{plan.summary.update} updated</span>
                <span className={clsx('rounded-full border px-2.5 py-0.5', plan.summary.error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-500')}>
                  {plan.summary.error} with errors
                </span>
              </div>
              {plan.ignored_columns.length > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-amber-800"><AlertTriangle className="h-3.5 w-3.5" />
                  Ignored columns: {plan.ignored_columns.join(', ')}</p>
              )}
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">Does</th><th className="px-3 py-2">Details</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plan.rows.map((r) => (
                      <tr key={r.row} className={r.action === 'error' ? 'bg-rose-50/40' : ''}>
                        <td className="px-3 py-2 text-xs text-slate-400">{r.row}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{r.name || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={clsx('rounded-full border px-2 py-0.5 text-xs capitalize', ACTION_CLS[r.action])}>{r.action}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {r.errors.length ? r.errors.join('; ') : r.changes.length ? r.changes.join(', ').replace(/_/g, ' ') : 'No change'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50">
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && !plan && (
            <button type="button" disabled={!file || check.isPending} onClick={() => file && check.mutate(file)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              {check.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Check the file
            </button>
          )}
          {!done && plan && (
            <button type="button" disabled={!file || plan.summary.error > 0 || changes === 0 || apply.isPending}
              onClick={() => file && apply.mutate(file)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
              {apply.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {plan.summary.error ? 'Fix the errors first' : `Import ${changes} vendor${changes === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
