'use client';

export const dynamic = 'force-dynamic';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import {
  FileSpreadsheet, Upload, Download, Trash2, Eye, RefreshCw,
  ClipboardList, ListChecks, ArrowRight,
} from 'lucide-react';

type IndexTab = 'templates' | 'mine';

type MyAssignment = {
  row_id: number;
  template_id: number;
  template_name: string;
  risk_id_text?: string | null;
  inherent_overall_label?: string | null;
  residual_overall_label?: string | null;
  inherent_overall_score?: number | null;
  residual_overall_score?: number | null;
  evidence_count: number;
  updated_at: string;
};

type CustomTemplate = {
  id: number;
  name: string;
  description?: string | null;
  function_area?: string | null;
  original_filename: string;
  sheet_name?: string | null;
  is_active: boolean;
  column_count: number;
  row_count: number;
  created_at: string;
  updated_at: string;
};

export default function RCSACustomTemplatesPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [functionArea, setFunctionArea] = useState('');
  const [description, setDescription] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [tab, setTab] = useState<IndexTab>('templates');

  // "Items assigned to me" feed — cross-template view of every row the
  // current operator owns. Used by the My Assignments tab so a user can
  // walk into their work without first selecting a template.
  const myQ = useQuery<MyAssignment[]>({
    queryKey: ['rcsa.custom-templates.my-assignments'],
    queryFn: async () => (await rcsaApi.customTemplates.listMyAssignments()).data,
    enabled: tab === 'mine',
  });

  const listQ = useQuery<CustomTemplate[]>({
    queryKey: ['rcsa.custom-templates', includeInactive],
    queryFn: async () => (await rcsaApi.customTemplates.list(includeInactive)).data,
  });

  const uploadM = useMutation({
    mutationFn: async (f: File) =>
      (await rcsaApi.customTemplates.upload(f, {
        name: name || undefined,
        function_area: functionArea || undefined,
        description: description || undefined,
        seed_from_file: true,
      })).data,
    onSuccess: () => {
      setFile(null);
      setName('');
      setFunctionArea('');
      setDescription('');
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['rcsa.custom-templates'] });
    },
  });

  const deactivateM = useMutation({
    mutationFn: (id: number) => rcsaApi.customTemplates.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rcsa.custom-templates'] }),
  });

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const templates = listQ.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header + upload */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Custom RCSA Templates</h2>
            <p className="text-sm text-gray-600 mt-1 max-w-3xl">
              Upload your bank&apos;s own RCSA Excel template. The platform reads its column structure
              once and then drives every downstream feature &mdash; row CRUD, AI suggestions, risk-register
              linkage, and export &mdash; using <em>your</em> exact layout. Existing question-based
              templates keep working alongside this.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">
              Excel template (.xlsx)
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            <p className="mt-1 text-xs text-gray-500">
              The first sheet is parsed by default. Two-row merged headers (the UBL pattern)
              are detected automatically; data rows already in the file are imported as seed rows.
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">
              Name <span className="text-gray-400 font-normal">(optional, defaults to the file&apos;s title)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. UBL Information Security RCSA"
              className="block w-full text-sm rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">
              Function area <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={functionArea}
              onChange={(e) => setFunctionArea(e.target.value)}
              placeholder="e.g. Information Security, Branch Operations, Treasury"
              className="block w-full text-sm rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Internal reference, governing committee, intended use…"
              className="block w-full text-sm rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={!file || uploadM.isPending}
            onClick={() => file && uploadM.mutate(file)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className="h-4 w-4" />
            {uploadM.isPending ? 'Parsing & saving…' : 'Upload & parse template'}
          </button>
          {uploadM.isError && (() => {
            const e = uploadM.error as { response?: { status?: number; data?: { detail?: string } }; message?: string };
            const status = e?.response?.status;
            const detail = e?.response?.data?.detail || e?.message || 'unknown error';
            let hint = '';
            if (status === 401) hint = ' (you may need to sign in again)';
            else if (status === 403) hint = ' (your role doesn\'t include erm:rcsa:edit)';
            else if (status === 413) hint = ' (template exceeds the 25 MB limit)';
            else if (status === 422) hint = ' (file may not be a valid .xlsx or columns weren\'t detected)';
            return (
              <p className="text-xs text-red-600">
                <strong>Upload failed:</strong> {detail}{hint}
              </p>
            );
          })()}
          {uploadM.isSuccess && (
            <p className="text-xs text-green-700">Saved &mdash; the new template appears below.</p>
          )}
        </div>
      </section>

      {/* Tab bar — Templates vs. My Assignments */}
      <div className="rounded-lg border border-gray-200 bg-white px-3">
        <nav className="flex gap-1">
          {([
            { key: 'templates' as const, label: 'Templates',       icon: ClipboardList },
            { key: 'mine'      as const, label: 'My Assignments',  icon: ListChecks    },
          ]).map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
                {key === 'mine' && (myQ.data?.length ?? 0) > 0 && (
                  <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
                    {myQ.data?.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* List (Templates tab) */}
      {tab === 'templates' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Your custom templates</h3>
          <label className="text-xs text-gray-600 inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Include deactivated
          </label>
        </div>

        {listQ.isLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : templates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
            <FileSpreadsheet className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-700">No custom templates yet</p>
            <p className="mt-1 text-xs text-gray-500">
              Upload your existing RCSA Excel file above. The platform will preserve every column
              and re-export in the same layout.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Function area</th>
                  <th className="px-4 py-2 text-right">Columns</th>
                  <th className="px-4 py-2 text-right">Rows</th>
                  <th className="px-4 py-2">Sheet</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {templates.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{t.name}</div>
                      <div className="text-[11px] text-gray-500 font-mono truncate max-w-[260px]" title={t.original_filename}>
                        {t.original_filename}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{t.function_area || '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{t.column_count}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{t.row_count}</td>
                    <td className="px-4 py-3 text-gray-700 truncate max-w-[160px]" title={t.sheet_name || ''}>
                      {t.sheet_name || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${
                          t.is_active
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-gray-100 text-gray-600 border-gray-200'
                        }`}
                      >
                        {t.is_active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                      <Link
                        href={`/erm/rcsa/custom-templates/${t.id}`}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        title="Open the matrix view"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const r = await rcsaApi.customTemplates.download(t.id);
                            downloadBlob(r.data as Blob, t.original_filename);
                          } catch {
                            /* ignore — backend already returned an error response */
                          }
                        }}
                        className="inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900"
                        title="Re-download the original .xlsx"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Original
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const r = await rcsaApi.customTemplates.exportCurrent(t.id);
                            const fname = t.original_filename.replace(/\.xlsx$/i, '_export.xlsx');
                            downloadBlob(r.data as Blob, fname);
                          } catch {
                            /* ignore */
                          }
                        }}
                        className="inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900"
                        title="Export current rows in the same layout"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Export
                      </button>
                      {t.is_active && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Deactivate template "${t.name}"? Its rows are retained; you can restore by checking "Include deactivated".`)) {
                              deactivateM.mutate(t.id);
                            }
                          }}
                          disabled={deactivateM.isPending}
                          className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline disabled:opacity-50"
                          title="Soft-delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {/* My Assignments tab */}
      {tab === 'mine' && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Assessment items assigned to me</h3>
            <button
              type="button"
              onClick={() => qc.invalidateQueries({ queryKey: ['rcsa.custom-templates.my-assignments'] })}
              className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
              title="Refresh"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>
          {myQ.isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (myQ.data ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
              <ListChecks className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-gray-700">No items assigned to you yet</p>
              <p className="mt-1 text-xs text-gray-500">
                When someone assigns an assessment item to you from the template detail page,
                it shows up here so you can walk straight into your work.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2">Template</th>
                    <th className="px-4 py-2">Risk ID</th>
                    <th className="px-4 py-2">Inherent</th>
                    <th className="px-4 py-2">Residual</th>
                    <th className="px-4 py-2 text-right">Evidence</th>
                    <th className="px-4 py-2">Updated</th>
                    <th className="px-4 py-2 text-right">Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(myQ.data ?? []).map((row) => (
                    <tr key={`${row.template_id}-${row.row_id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{row.template_name}</div>
                        <div className="text-[11px] text-gray-500">Item #{row.row_id}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700 font-mono text-xs">{row.risk_id_text || '—'}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {row.inherent_overall_label || (row.inherent_overall_score != null ? row.inherent_overall_score : '—')}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {row.residual_overall_label || (row.residual_overall_score != null ? row.residual_overall_score : '—')}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{row.evidence_count}</td>
                      <td className="px-4 py-3 text-[11px] text-gray-500">
                        {new Date(row.updated_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/erm/rcsa/custom-templates/${row.template_id}?open=${row.row_id}`}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          Open
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
