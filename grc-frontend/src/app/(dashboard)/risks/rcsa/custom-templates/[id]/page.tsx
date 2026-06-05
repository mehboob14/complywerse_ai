'use client';

export const dynamic = 'force-dynamic';

import { useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import {
  ArrowLeft, Plus, Save, X, Trash2, Link2, Download, RefreshCw,
  Sparkles, Paperclip, UserCheck, Upload, FileText, Loader2,
} from 'lucide-react';
import apiClient from '@/lib/api';

type ColumnSpec = {
  key: string;
  label: string;
  col_index: number;
  group?: string | null;
  group_key?: string | null;
  data_type: string;
  sample_values?: string[];
};

type ColumnGroup = {
  label: string;
  key: string;
  columns: ColumnSpec[];
};

type CustomTemplateDetail = {
  id: number;
  name: string;
  description?: string | null;
  function_area?: string | null;
  original_filename: string;
  sheet_name?: string | null;
  is_active: boolean;
  column_schema: {
    title?: string;
    sheet_name?: string;
    header_row_count?: number;
    data_start_row?: number;
    groups: ColumnGroup[];
    flat_columns: ColumnSpec[];
    warnings?: string[];
  };
  row_count: number;
  created_at: string;
  updated_at: string;
};

type Row = {
  id: number;
  template_id: number;
  risk_id_text?: string | null;
  inherent_overall_label?: string | null;
  residual_overall_label?: string | null;
  inherent_overall_score?: number | null;
  residual_overall_score?: number | null;
  data: Record<string, unknown>;
  linked_risk_id?: number | null;
  assigned_user_id?: number | null;
  assigned_user_name?: string | null;
  assigned_user_email?: string | null;
  evidence_count?: number;
  has_ai_explanation?: boolean;
  ai_explanation_at?: string | null;
  created_at: string;
  updated_at: string;
};

type TenantUserOption = {
  id: number;
  display_name: string;
  email?: string | null;
};

type EvidenceItem = {
  id: number;
  row_id: number;
  file_name: string;
  file_size?: number | null;
  mime_type?: string | null;
  description?: string | null;
  uploaded_by_name?: string | null;
  uploaded_at: string;
};

type DrawerTab = 'fields' | 'explain' | 'evidence' | 'assign';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RCSACustomTemplateDetailPage() {
  const params = useParams() as { id: string };
  const templateId = Number(params?.id);
  const qc = useQueryClient();

  const [selectedRow, setSelectedRow] = useState<Row | null>(null);
  const [creatingRow, setCreatingRow] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const tplQ = useQuery<CustomTemplateDetail>({
    queryKey: ['rcsa.custom-template', templateId],
    queryFn: async () => (await rcsaApi.customTemplates.get(templateId)).data,
    enabled: templateId > 0,
  });

  const rowsQ = useQuery<Row[]>({
    queryKey: ['rcsa.custom-template.rows', templateId],
    queryFn: async () => (await rcsaApi.customTemplates.listRows(templateId, { limit: 2000 })).data,
    enabled: templateId > 0,
  });

  const createRowM = useMutation({
    mutationFn: () => rcsaApi.customTemplates.createRow(templateId, { data: draft }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rcsa.custom-template.rows', templateId] });
      setCreatingRow(false);
      setDraft({});
    },
  });

  const updateRowM = useMutation({
    mutationFn: ({ rowId, data }: { rowId: number; data: Record<string, unknown> }) =>
      rcsaApi.customTemplates.updateRow(templateId, rowId, { data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rcsa.custom-template.rows', templateId] });
      setSelectedRow(null);
    },
  });

  const deleteRowM = useMutation({
    mutationFn: (rowId: number) => rcsaApi.customTemplates.deleteRow(templateId, rowId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rcsa.custom-template.rows', templateId] });
      setSelectedRow(null);
    },
  });

  const promoteM = useMutation({
    mutationFn: (rowId: number) => rcsaApi.customTemplates.promoteRowToRisk(templateId, rowId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rcsa.custom-template.rows', templateId] }),
  });

  // Tenant users for the assignment dropdown — cached at the page level so
  // every row drawer doesn't refetch the same list.
  const tenantUsersQ = useQuery<TenantUserOption[]>({
    queryKey: ['rcsa.custom-template.tenant-users'],
    queryFn: async () => (await rcsaApi.customTemplates.listTenantUsers()).data,
    staleTime: 5 * 60_000,
  });

  // Single source of truth for the assignment mutation — fires when the
  // drawer's Assign tab dropdown changes. Re-runs the row query so the
  // table row's chip updates without a manual reload.
  const assignRowM = useMutation({
    mutationFn: ({ rowId, userId }: { rowId: number; userId: number | null }) =>
      rcsaApi.customTemplates.assignRow(templateId, rowId, userId),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ['rcsa.custom-template.rows', templateId] });
      // Patch the drawer's local copy so the dropdown shows the new value
      // immediately even before the rows query revalidates.
      if (selectedRow && resp.data && resp.data.id === selectedRow.id) {
        setSelectedRow({ ...selectedRow, ...(resp.data as Partial<Row>) });
      }
    },
  });

  // For the table view we only show a handful of "primary" columns. The full
  // payload lives in the detail drawer.
  const primaryColumns = useMemo<ColumnSpec[]>(() => {
    if (!tplQ.data) return [];
    const all = tplQ.data.column_schema.flat_columns;
    // Heuristic: prefer Risk ID, Process, Risk Description, Inherent Overall, Residual Overall.
    const pickHints = [
      ['risk_id'],
      ['process'],
      ['risk_description'],
      ['inherent', 'overall'],
      ['residual', 'overall'],
    ];
    const picks: ColumnSpec[] = [];
    for (const hints of pickHints) {
      const hit = all.find((c) => hints.every((h) => c.key.toLowerCase().includes(h)));
      if (hit && !picks.find((p) => p.key === hit.key)) picks.push(hit);
    }
    // Pad with the next few cols if we found fewer than 5.
    for (const c of all) {
      if (picks.length >= 7) break;
      if (!picks.find((p) => p.key === c.key)) picks.push(c);
    }
    return picks;
  }, [tplQ.data]);

  if (!templateId || templateId <= 0) {
    return <div className="p-6 text-sm text-gray-500">Invalid template id.</div>;
  }
  if (tplQ.isLoading) return <div className="p-6 text-sm text-gray-500">Loading template…</div>;
  if (tplQ.isError || !tplQ.data) {
    return (
      <div className="p-6">
        <Link href="/risks/rcsa/custom-templates" className="text-sm text-blue-600 hover:underline">
          ← Back to Custom Templates
        </Link>
        <p className="mt-3 text-sm text-red-600">Failed to load template.</p>
      </div>
    );
  }

  const t = tplQ.data;
  const rows = rowsQ.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/risks/rcsa/custom-templates"
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Custom Templates
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              const r = await rcsaApi.customTemplates.download(t.id);
              downloadBlob(r.data as Blob, t.original_filename);
            }}
            className="inline-flex items-center gap-1.5 text-xs text-gray-700 hover:text-gray-900 border border-gray-300 rounded px-2 py-1"
            title="Re-download the original .xlsx"
          >
            <Download className="h-3.5 w-3.5" />
            Original
          </button>
          <button
            type="button"
            onClick={async () => {
              const r = await rcsaApi.customTemplates.exportCurrent(t.id);
              downloadBlob(r.data as Blob, t.original_filename.replace(/\.xlsx$/i, '_export.xlsx'));
            }}
            className="inline-flex items-center gap-1.5 text-xs text-gray-700 hover:text-gray-900 border border-gray-300 rounded px-2 py-1"
            title="Export the current rows in the same layout"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Export current
          </button>
        </div>
      </div>

      {/* Header */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-gray-900">{t.name}</h1>
            {t.description && (
              <p className="text-sm text-gray-600 mt-1 max-w-3xl">{t.description}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
              {t.function_area && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700">
                  {t.function_area}
                </span>
              )}
              {t.sheet_name && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-700">
                  Sheet: {t.sheet_name}
                </span>
              )}
              <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-700">
                {t.column_schema.flat_columns.length} columns
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-700">
                {t.row_count} rows
              </span>
            </div>
            {(t.column_schema.warnings ?? []).length > 0 && (
              <ul className="mt-3 text-xs text-amber-700 list-disc list-inside">
                {(t.column_schema.warnings ?? []).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Matrix table */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Assessment items</h2>
          <button
            type="button"
            onClick={() => { setDraft({}); setCreatingRow(true); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Add assessment item
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                {primaryColumns.map((c) => (
                  <th key={c.key} className="px-3 py-2 whitespace-nowrap">
                    {c.label}
                    {c.group && <div className="text-[10px] text-gray-400 normal-case font-normal">{c.group}</div>}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={primaryColumns.length + 1} className="px-3 py-6 text-center text-xs text-gray-500">
                    No assessment items yet. Use “Add assessment item” above, or re-import from the original file.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    {primaryColumns.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-gray-700 align-top max-w-[280px]">
                        <div className="line-clamp-2" title={String(r.data?.[c.key] ?? '')}>
                          {String(r.data?.[c.key] ?? '') || <span className="text-gray-400">—</span>}
                        </div>
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                      {/* Quick-glance status chips so an operator can scan
                          the matrix and see what needs work without opening
                          every row. */}
                      <div className="inline-flex items-center gap-1.5 mr-2 align-middle">
                        {r.assigned_user_name ? (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-1.5 py-0.5"
                            title={`Assigned to ${r.assigned_user_name}`}
                          >
                            <UserCheck className="h-2.5 w-2.5" />
                            {r.assigned_user_name.split(' ')[0]}
                          </span>
                        ) : null}
                        {(r.evidence_count ?? 0) > 0 ? (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5"
                            title={`${r.evidence_count} evidence file${r.evidence_count === 1 ? '' : 's'} attached`}
                          >
                            <Paperclip className="h-2.5 w-2.5" />
                            {r.evidence_count}
                          </span>
                        ) : null}
                        {r.has_ai_explanation ? (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5"
                            title="AI explanation cached — open the row to read"
                          >
                            <Sparkles className="h-2.5 w-2.5" />
                            AI
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedRow(r)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Edit
                      </button>
                      {r.linked_risk_id ? (
                        <Link
                          href={`/erm/risks/${r.linked_risk_id}`}
                          className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
                          title="View linked Risk Register entry"
                        >
                          <Link2 className="h-3 w-3" />
                          Risk #{r.linked_risk_id}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => promoteM.mutate(r.id)}
                          disabled={promoteM.isPending}
                          className="inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900 disabled:opacity-50"
                          title="Create a Risk Register entry from this row"
                        >
                          <Link2 className="h-3 w-3" />
                          Promote
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Create row drawer */}
      {creatingRow && (
        <RowDrawer
          title="Add assessment item"
          schema={t.column_schema}
          values={draft}
          isPending={createRowM.isPending}
          onClose={() => { setCreatingRow(false); setDraft({}); }}
          onChange={(k, v) => setDraft((p) => ({ ...p, [k]: v }))}
          onSave={() => createRowM.mutate()}
        />
      )}

      {/* Edit row drawer — gets the AI/evidence/assign tabs for existing rows. */}
      {selectedRow && (
        <RowDrawer
          title={`Edit row #${selectedRow.id}`}
          schema={t.column_schema}
          values={Object.fromEntries(
            Object.entries(selectedRow.data || {}).map(([k, v]) => [k, v == null ? '' : String(v)])
          )}
          isPending={updateRowM.isPending}
          onClose={() => setSelectedRow(null)}
          onChange={(k, v) => {
            const next = { ...(selectedRow.data || {}), [k]: v };
            setSelectedRow({ ...selectedRow, data: next });
          }}
          onSave={() => updateRowM.mutate({ rowId: selectedRow.id, data: selectedRow.data })}
          onDelete={() => {
            if (confirm(`Delete row #${selectedRow.id}? This cannot be undone.`)) {
              deleteRowM.mutate(selectedRow.id);
            }
          }}
          extension={{
            templateId,
            row: selectedRow,
            tenantUsers: tenantUsersQ.data || [],
            tenantUsersLoading: tenantUsersQ.isLoading,
            onAssignChange: (userId) =>
              assignRowM.mutate({ rowId: selectedRow.id, userId }),
            assignPending: assignRowM.isPending,
          }}
        />
      )}
    </div>
  );
}

// ─── Row drawer: form built dynamically from the template's schema ──────────

function RowDrawer({
  title,
  schema,
  values,
  isPending,
  onClose,
  onChange,
  onSave,
  onDelete,
  extension,
}: {
  title: string;
  schema: CustomTemplateDetail['column_schema'];
  values: Record<string, unknown>;
  isPending: boolean;
  onClose: () => void;
  onChange: (key: string, value: string) => void;
  onSave: () => void;
  onDelete?: () => void;
  extension?: {
    templateId: number;
    row: Row;
    tenantUsers: TenantUserOption[];
    tenantUsersLoading: boolean;
    onAssignChange: (userId: number | null) => void;
    assignPending: boolean;
  };
}) {
  const [tab, setTab] = useState<DrawerTab>('fields');
  const isExisting = !!extension;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs only appear for an existing row — creation stays single-pane. */}
        {isExisting && (
          <div className="px-5 pt-3 border-b border-gray-100 bg-white">
            <nav className="flex gap-1 -mb-px">
              {(
                [
                  { key: 'fields', label: 'Fields', icon: FileText },
                  { key: 'explain', label: 'AI Explain', icon: Sparkles },
                  { key: 'evidence', label: 'Evidence', icon: Paperclip },
                  { key: 'assign', label: 'Assign', icon: UserCheck },
                ] as Array<{ key: DrawerTab; label: string; icon: typeof FileText }>
              ).map(({ key, label, icon: Icon }) => {
                const active = tab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                      active
                        ? 'border-blue-600 text-blue-700'
                        : 'border-transparent text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                );
              })}
            </nav>
          </div>
        )}

        <div className="p-5 space-y-5">
          {(!isExisting || tab === 'fields') && (
            <>
              {schema.groups.map((g) => (
                <fieldset key={g.key} className="border border-gray-200 rounded-lg p-4">
                  <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500 px-2">
                    {g.label}
                  </legend>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {g.columns.map((c) => (
                      <div key={c.key}>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          {c.label}
                          <span className="ml-1 text-[10px] uppercase text-gray-400 font-normal">{c.data_type}</span>
                        </label>
                        {c.data_type === 'yes_no' ? (
                          <select
                            value={String(values[c.key] ?? '')}
                            onChange={(e) => onChange(c.key, e.target.value)}
                            className="block w-full text-sm rounded-md border border-gray-300 px-3 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="">—</option>
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                          </select>
                        ) : c.data_type === 'number' || c.data_type === 'score' ? (
                          <input
                            type="number"
                            value={String(values[c.key] ?? '')}
                            onChange={(e) => onChange(c.key, e.target.value)}
                            className="block w-full text-sm rounded-md border border-gray-300 px-3 py-1.5 font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (c.label || '').toLowerCase().includes('description') || (c.label || '').toLowerCase().includes('action') ? (
                          <textarea
                            rows={3}
                            value={String(values[c.key] ?? '')}
                            onChange={(e) => onChange(c.key, e.target.value)}
                            className="block w-full text-sm rounded-md border border-gray-300 px-3 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <input
                            type="text"
                            value={String(values[c.key] ?? '')}
                            onChange={(e) => onChange(c.key, e.target.value)}
                            placeholder={c.sample_values?.[0] ? String(c.sample_values[0]).slice(0, 60) : ''}
                            className="block w-full text-sm rounded-md border border-gray-300 px-3 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </fieldset>
              ))}
            </>
          )}

          {isExisting && tab === 'explain' && extension && (
            <ExplainPanel templateId={extension.templateId} row={extension.row} />
          )}
          {isExisting && tab === 'evidence' && extension && (
            <EvidencePanel templateId={extension.templateId} row={extension.row} />
          )}
          {isExisting && tab === 'assign' && extension && (
            <AssignPanel
              row={extension.row}
              tenantUsers={extension.tenantUsers}
              tenantUsersLoading={extension.tenantUsersLoading}
              onAssignChange={extension.onAssignChange}
              assignPending={extension.assignPending}
            />
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-gray-200 bg-white px-5 py-3">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete row
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Close
            </button>
            {(!isExisting || tab === 'fields') && (
              <button
                type="button"
                onClick={onSave}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {isPending ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AI Explain panel ────────────────────────────────────────────────────
function ExplainPanel({ templateId, row }: { templateId: number; row: Row }) {
  const qc = useQueryClient();
  const explainM = useMutation({
    mutationFn: (refresh: boolean) =>
      rcsaApi.customTemplates.explainRow(templateId, row.id, refresh),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rcsa.custom-template.rows', templateId] });
    },
  });

  // Result: prefer the latest mutation response; otherwise show whatever
  // was cached on the row by an earlier call.
  const latest = explainM.data?.data;
  const cachedExplanation = row.has_ai_explanation ? row.ai_explanation_at : null;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 text-xs text-violet-800">
        <p className="font-medium">
          AI can summarise this row in plain language — useful when handing it off to a process
          owner who isn&apos;t a risk specialist.
        </p>
        <p className="mt-1 text-[11px] text-violet-700/80">
          Output is cached on the row; click <em>Re-analyze</em> to regenerate after edits.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={explainM.isPending}
          onClick={() => explainM.mutate(false)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-violet-600 rounded-md hover:bg-violet-700 disabled:opacity-50"
        >
          {explainM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {latest || cachedExplanation ? 'Open AI explanation' : 'Analyze with AI'}
        </button>
        {(latest || cachedExplanation) && (
          <button
            type="button"
            disabled={explainM.isPending}
            onClick={() => explainM.mutate(true)}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-600 hover:text-gray-900 border border-gray-300 rounded"
          >
            <RefreshCw className="h-3 w-3" />
            Re-analyze
          </button>
        )}
        {latest?.generated_at && (
          <span className="text-[10px] text-gray-500">
            Generated {new Date(latest.generated_at).toLocaleString()}
            {latest.from_cache ? ' · from cache' : ''}
          </span>
        )}
      </div>

      {explainM.isError && (
        <p className="text-xs text-rose-700">
          Failed to generate explanation. Check the AI integration settings and retry.
        </p>
      )}

      {latest?.explanation && (
        <article
          className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap"
          aria-live="polite"
        >
          {latest.explanation}
        </article>
      )}
    </div>
  );
}

// ─── Evidence panel ──────────────────────────────────────────────────────
function EvidencePanel({ templateId, row }: { templateId: number; row: Row }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [description, setDescription] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const listQ = useQuery<EvidenceItem[]>({
    queryKey: ['rcsa.custom-template.row.evidence', templateId, row.id],
    queryFn: async () =>
      (await rcsaApi.customTemplates.listRowEvidence(templateId, row.id)).data as EvidenceItem[],
  });

  const uploadM = useMutation({
    mutationFn: ({ file, desc }: { file: File; desc: string }) =>
      rcsaApi.customTemplates.uploadRowEvidence(templateId, row.id, file, desc || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rcsa.custom-template.row.evidence', templateId, row.id] });
      qc.invalidateQueries({ queryKey: ['rcsa.custom-template.rows', templateId] });
      setPendingFile(null);
      setDescription('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const deleteM = useMutation({
    mutationFn: (evidenceId: number) =>
      rcsaApi.customTemplates.deleteRowEvidence(templateId, row.id, evidenceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rcsa.custom-template.row.evidence', templateId, row.id] });
      qc.invalidateQueries({ queryKey: ['rcsa.custom-template.rows', templateId] });
    },
  });

  const items = listQ.data ?? [];

  const handleDownload = async (evidenceId: number, fileName: string) => {
    // Use the api client so the existing Bearer + tenant headers are
    // attached automatically; the path returned by downloadRowEvidenceUrl
    // is relative and safe to pass through.
    try {
      const path = rcsaApi.customTemplates.downloadRowEvidenceUrl(templateId, row.id, evidenceId);
      const r = await apiClient.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Download failed.');
    }
  };

  return (
    <div className="space-y-3">
      {/* Upload row */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={(e) => setPendingFile(e.target.files?.[0] || null)}
            className="text-xs"
          />
          {pendingFile && (
            <span className="text-[11px] text-gray-600 truncate">
              {pendingFile.name} ({Math.round(pendingFile.size / 1024)} KB)
            </span>
          )}
        </div>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description — what does this evidence prove?"
          className="block w-full text-sm rounded-md border border-gray-300 px-3 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!pendingFile || uploadM.isPending}
            onClick={() => pendingFile && uploadM.mutate({ file: pendingFile, desc: description })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50"
          >
            {uploadM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload evidence
          </button>
        </div>
        {uploadM.isError && (
          <p className="text-[11px] text-rose-700">Upload failed. Try a smaller file or check your connection.</p>
        )}
      </div>

      {/* Existing evidence list */}
      {listQ.isLoading ? (
        <p className="text-xs text-gray-500">Loading evidence…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-500">No evidence attached yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((ev) => (
            <li
              key={ev.id}
              className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3"
            >
              <FileText className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => handleDownload(ev.id, ev.file_name)}
                  className="text-sm font-medium text-gray-900 hover:text-emerald-700 hover:underline truncate text-left"
                  title={ev.file_name}
                >
                  {ev.file_name}
                </button>
                <p className="text-[10px] text-gray-500">
                  {ev.uploaded_by_name || 'Someone'} ·{' '}
                  {new Date(ev.uploaded_at).toLocaleString()}
                  {ev.file_size != null ? ` · ${Math.round(ev.file_size / 1024)} KB` : ''}
                </p>
                {ev.description && <p className="mt-1 text-xs text-gray-700">{ev.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => handleDownload(ev.id, ev.file_name)}
                className="text-[11px] text-gray-600 hover:text-gray-900 px-2 py-1 border border-gray-300 rounded"
              >
                <Download className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete "${ev.file_name}"?`)) deleteM.mutate(ev.id);
                }}
                className="text-[11px] text-red-600 hover:text-red-700 px-2 py-1 border border-red-200 rounded"
                disabled={deleteM.isPending}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Assign panel ────────────────────────────────────────────────────────
function AssignPanel({
  row,
  tenantUsers,
  tenantUsersLoading,
  onAssignChange,
  assignPending,
}: {
  row: Row;
  tenantUsers: TenantUserOption[];
  tenantUsersLoading: boolean;
  onAssignChange: (userId: number | null) => void;
  assignPending: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-xs text-indigo-800">
        Assigning this row to a tenant user makes them the named owner on dashboards and audit
        reports. They&apos;ll still need to be granted access to the template separately if they
        don&apos;t already have <code>erm:rcsa:view</code>.
      </div>

      <label className="block text-xs font-medium text-gray-700">Assignee</label>
      {tenantUsersLoading ? (
        <p className="text-xs text-gray-500">Loading users…</p>
      ) : (
        <select
          value={row.assigned_user_id == null ? '' : String(row.assigned_user_id)}
          onChange={(e) =>
            onAssignChange(e.target.value === '' ? null : Number(e.target.value))
          }
          disabled={assignPending}
          className="block w-full text-sm rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        >
          <option value="">— Unassigned —</option>
          {tenantUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name}
              {u.email ? ` (${u.email})` : ''}
            </option>
          ))}
        </select>
      )}

      {row.assigned_user_id && row.assigned_user_name && (
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs">
          <div className="flex items-center gap-2 text-gray-700">
            <UserCheck className="h-3.5 w-3.5 text-indigo-600" />
            <span>
              Currently assigned to{' '}
              <span className="font-semibold text-gray-900">{row.assigned_user_name}</span>
              {row.assigned_user_email ? ` (${row.assigned_user_email})` : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
