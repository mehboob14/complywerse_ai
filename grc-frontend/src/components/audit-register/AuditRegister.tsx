'use client';

/**
 * The audit register as the client keeps it.
 *
 * Their monthly workbook goes in at the top — checked first, applied second —
 * and the table below shows the register in their own columns and words, while
 * every row is a real issue underneath with an owner, actions and links.
 */
import { Fragment, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Bell, CheckCircle2, ClipboardCheck, Download, ExternalLink, Eye, FileSpreadsheet,
  Loader2, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2, Upload, Users, X,
} from 'lucide-react';
import { AnimatedModal, RightSlidePanel } from '@/components/ui';
import { FindingForm } from './FindingForm';
import { FindingWorkflow } from './FindingWorkflow';
import { NewFindingForm } from './NewFindingForm';
import Link from 'next/link';
import { auditRegisterApi } from '@/lib/api';
import { RegisterSummary } from './RegisterSummary';
import { RegisterExtensions, RegisterMappings, RegisterReports } from './RegisterViews';

type Preview = {
  file_name: string;
  as_of: string | null;
  rows: number;
  sheet_counts: Record<string, number>;
  by_source: Record<string, number>;
  summary: Record<string, Record<string, number>>;
  unmatched_owners: Array<{ name: string; rows: number }>;
  warnings: string[];
};

type ImportResult = {
  created: number; updated: number; skipped: number;
  unmatched_owners: string[]; warnings: string[]; as_of: string | null;
  linked?: Record<string, number>;
};

type Reminders = {
  due_soon: number; past_due: number; owners: number; escalated: number;
  items: Array<{ issue_id: number; reference: string | null; title: string; due: string; past_due: number; kind: string }>;
};

type View = 'register' | 'summary' | 'reports' | 'extensions' | 'mappings' | 'imports';
const VIEWS: Array<[View, string]> = [
  ['register', 'Register'], ['summary', 'Issue Summary'], ['reports', 'Reports'],
  ['extensions', 'Extensions'], ['mappings', 'Mappings'], ['imports', 'Imports'],
];

// Status as the client defines it; Past Due applied once the agreed date passes.
const STATUS: Record<string, [string, string]> = {
  NS: ['Not Started', 'bg-slate-50 text-slate-700 ring-slate-200'],
  IP: ['In Progress', 'bg-sky-50 text-sky-700 ring-sky-200'],
  DE: ['Delayed', 'bg-amber-50 text-amber-700 ring-amber-200'],
  PD: ['Past Due', 'bg-red-50 text-red-700 ring-red-200'],
  EXT: ['Extension', 'bg-violet-50 text-violet-700 ring-violet-200'],
  CD: ['Closed', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
  unstated: ['No status', 'bg-slate-50 text-slate-500 ring-slate-200'],
};

type Row = {
  issue_id: number; code: string | null; source: string; record_type: string;
  regulator: string | null; report: string | null; reference: string | null; title: string | null;
  risk_rating: string | null; lob: string | null; owner: string | null; owner_id: number | null;
  target_date: string | null; revised_target_date: string | null; ia_status: string | null;
  remediation_status: string | null; validation_status: string | null;
  validation_pass_fail: string | null; aged_status: string | null; days_past_due: number | null;
  workflow_state: string | null; owner_name: string | null; affected_hosts: string | null;
  edited: boolean; status: string; report_key: string | null; added_in_platform: boolean;
  report_prefill: Record<string, unknown>; deleted?: boolean; deleted_at?: string | null;
};

// Which sheet a new finding is added on, from the source being looked at.
const ENTRY_TEMPLATE: Record<string, string> = {
  regulator: 'regulatory', mercadien: 'ia_mercadien', ey: 'ia_ey_issue', it_pen: 'it_pen',
  self_id: 'self_id', credit_review: 'credit_review',
};

const SOURCE_LABELS: Record<string, string> = {
  regulator: 'Regulator',
  mercadien: 'CFSB Audit-Mercadien',
  ey: 'CFSB Audit-EY',
  internal_audit: 'Internal Audit',
  self_id: 'Self Identified',
  it_pen: 'IT Pen Test',
  credit_review: 'Credit Reviews',
  unassigned: 'Source not stated',
};

const RISK_TONE: Record<string, string> = {
  high: 'bg-red-50 text-red-700 ring-red-200',
  critical: 'bg-red-50 text-red-700 ring-red-200',
  moderate: 'bg-amber-50 text-amber-700 ring-amber-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  low: 'bg-slate-50 text-slate-600 ring-slate-200',
};

const chip = (tone: string) =>
  `inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone}`;

export function AuditRegister({ initialSource = '' }: { initialSource?: string }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string>('');
  const [source, setSource] = useState<string>(initialSource);
  const [openIssue, setOpenIssue] = useState<{ id: number; edit: boolean; focus?: 'workflow' } | null>(null);
  const [newFinding, setNewFinding] = useState<{ template: string | null; prefill?: Record<string, unknown> } | null>(null);
  const [rowMenu, setRowMenu] = useState<number | null>(null);
  const [view, setView] = useState<View>('register');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [reportFilter, setReportFilter] = useState<{ key: string | null; label: string } | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);
  const addFinding =(template?: string | null, prefill?: Record<string, unknown>) => {
    setOpenIssue(null);
    setNewFinding({ template: template ?? ENTRY_TEMPLATE[source] ?? null, prefill });
  };
  // The register filtered to what a pack figure or a report counts.
  const drill = (filters: { source?: string; status?: string; report?: { key: string | null; label: string } }) => {
    setSource(filters.source ?? '');
    setStatusFilter(filters.status ?? '');
    setReportFilter(filters.report ?? null);
    setSearch('');
    setView('register');
  };
  const [remindOpen, setRemindOpen] = useState(false);
  const [remindEmail, setRemindEmail] = useState(false);
  const [remindNote, setRemindNote] = useState('');
  const [openRun, setOpenRun] = useState<number | null>(null);

  // The whole register once; source, status, report and search filter it here,
  // so every source chip stays visible whichever one is picked.
  const rows = useQuery<Row[]>({
    queryKey: ['audit-register-rows', ''],
    queryFn: async () => (await auditRegisterApi.rows()).data,
  });
  // What was deleted, listed only when the "Deleted" filter asks for it.
  const deletedRows = useQuery<Row[]>({
    queryKey: ['audit-register-rows', 'deleted'],
    queryFn: async () => (await auditRegisterApi.rows(undefined, true)).data,
    enabled: statusFilter === 'deleted',
  });

  const refreshAll = () => {
    ['audit-register-rows', 'audit-register-pack', 'audit-register-reports', 'audit-register-status',
      'audit-register-all-extensions', 'issues'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
  };
  const remove = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) =>
      (await auditRegisterApi.deleteFinding(id, reason)).data,
    onSuccess: (_d, { id }) => {
      setDeleting(null);
      setDeleteReason('');
      if (openIssue?.id === id) setOpenIssue(null);
      refreshAll();
    },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not delete the finding.'),
  });
  const restore = useMutation({
    mutationFn: async (id: number) => (await auditRegisterApi.restoreFinding(id)).data,
    onSuccess: refreshAll,
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not restore the finding.'),
  });
  const downloadTemplate = async () => {
    setTemplateBusy(true);
    try {
      const res = await auditRegisterApi.downloadTemplate();
      const disposition = String(res.headers?.['content-disposition'] || '');
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] || 'Audit register - blank.xlsx';
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not download the template.');
    } finally {
      setTemplateBusy(false);
    }
  };

  const history = useQuery<Array<{
    id: number; file_name: string; as_of: string | null; created: number; updated: number;
    skipped: number; unmatched_owners: Array<{ name: string; rows: number }>;
    warnings: string[]; imported_at: string | null;
  }>>({
    queryKey: ['audit-register-imports'],
    queryFn: async () => (await auditRegisterApi.imports()).data,
    enabled: view === 'imports',
  });

  const [linkNote, setLinkNote] = useState('');
  const relink = useMutation({
    mutationFn: async () => (await auditRegisterApi.relink()).data as { linked: Record<string, number> },
    onSuccess: (data) => {
      const { assets = 0, vulnerabilities = 0, vendors = 0, observations = 0, incidents = 0,
        business_units: units = 0 } = data.linked || {};
      const made = [
        assets && `${assets} asset(s)`, vulnerabilities && `${vulnerabilities} vulnerability(ies)`,
        vendors && `${vendors} vendor(s)`, observations && `${observations} MRA(s) to Statutory Audit`,
        incidents && `${incidents} event(s) to Incidents`, units && `${units} business unit link(s)`,
      ].filter(Boolean);
      setLinkNote(made.length ? `Linked ${made.join(', ')}.` : 'Nothing new to link.');
      queryClient.invalidateQueries({ queryKey: ['audit-register-rows'] });
    },
  });

  const reminderPreview = useQuery<Reminders>({
    queryKey: ['audit-register-reminders'],
    queryFn: async () => (await auditRegisterApi.previewReminders()).data,
    enabled: remindOpen,
  });
  const remind = useMutation({
    mutationFn: async () => (await auditRegisterApi.sendReminders(remindEmail)).data as Reminders,
    onSuccess: (data) => {
      setRemindNote(`Reminded ${data.owners} owner(s) about ${data.due_soon + data.past_due} finding(s)`
        + (data.escalated ? `; ${data.escalated} escalated to Audit Services.` : '.'));
      setRemindOpen(false);
      queryClient.invalidateQueries({ queryKey: ['audit-register-reminders'] });
    },
  });

  const fail = (e: any, fallback: string) =>
    setError(e?.response?.data?.detail || e?.message || fallback);

  const check = useMutation({
    mutationFn: async (chosen: File) => (await auditRegisterApi.preview(chosen)).data as Preview,
    onSuccess: (data) => { setPreview(data); setResult(null); setError(''); },
    onError: (e) => fail(e, 'Could not read the workbook.'),
  });

  const apply = useMutation({
    mutationFn: async (chosen: File) => (await auditRegisterApi.import(chosen)).data as ImportResult,
    onSuccess: (data) => {
      setResult(data);
      setPreview(null);
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ['audit-register-rows'] });
      queryClient.invalidateQueries({ queryKey: ['audit-register-pack'] });
      queryClient.invalidateQueries({ queryKey: ['audit-register-reports'] });
      queryClient.invalidateQueries({ queryKey: ['audit-register-imports'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
    },
    onError: (e) => fail(e, 'The import failed.'),
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    setFile(chosen);
    check.mutate(chosen);
    if (fileRef.current) fileRef.current.value = '';
  };

  const busy = check.isPending || apply.isPending;
  const sources = Object.keys(SOURCE_LABELS).filter((s) =>
    rows.data?.some((r) => r.source === s));
  const needle = search.trim().toLowerCase();
  const showingDeleted = statusFilter === 'deleted';
  const visible = ((showingDeleted ? deletedRows.data : rows.data) || []).filter((r) =>
    (!source || r.source === source)
    && (!statusFilter || showingDeleted
      || (statusFilter === 'open' ? r.status !== 'CD' : r.status === statusFilter))
    && (!reportFilter || r.report_key === reportFilter.key)
    && (!needle || [r.reference, r.title, r.owner_name, r.owner, r.report, r.lob, r.code]
      .some((v) => (v || '').toLowerCase().includes(needle))));

  return (
    <div className="space-y-4">
      {/* ── views, and the workbook actions: upload, blank template, one finding ── */}
      <div className="flex flex-wrap items-center gap-2">
        <nav className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {VIEWS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                view === id ? 'bg-primary-600 text-[#0a0a0a] shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsb,.xlsx,.xlsm" className="hidden" onChange={onPick} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="Upload the monthly workbook (.xlsb or .xlsx). You see what it holds before anything is imported; a re-upload updates the same findings."
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {check.isPending ? 'Reading…' : apply.isPending ? 'Importing…' : 'Upload workbook'}
          </button>
          <button
            onClick={downloadTemplate}
            disabled={templateBusy}
            title="A blank workbook in the client's layout — their sheets and columns — to fill in and upload"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
          >
            {templateBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download template
          </button>
          <button
            onClick={() => addFinding()}
            title="Add a single finding on one of the workbook's sheets, in that sheet's columns"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] shadow-sm hover:bg-primary-700"
          >
            <Plus className="h-3.5 w-3.5" /> Add finding
          </button>
        </div>
      </div>

      {(error || (preview && file) || result) && (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {error && (
          <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <span className="mr-auto">{error}</span>
            <button aria-label="Dismiss" onClick={() => setError('')}><X className="h-3.5 w-3.5" /></button>
          </p>
        )}

        {preview && file && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <FileSpreadsheet className="h-4 w-4 text-slate-500" />
              {preview.file_name}
              {preview.as_of && <span className="font-normal text-slate-500">as of {preview.as_of}</span>}
            </div>
            <p className="mt-2 text-xs text-slate-600">
              <strong>{preview.rows}</strong> findings ready to import:{' '}
              {Object.entries(preview.by_source)
                .map(([s, n]) => `${n} ${SOURCE_LABELS[s] || s}`)
                .join(' · ')}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {Object.entries(preview.sheet_counts).map(([s, n]) => `${s}: ${n}`).join('  |  ')}
            </p>
            {preview.unmatched_owners.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
                <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {preview.unmatched_owners.length} owner name(s) match no user and will be left
                  unassigned: {preview.unmatched_owners.slice(0, 4).map((o) => o.name).join(', ')}
                  {preview.unmatched_owners.length > 4 ? '…' : ''}
                </span>
              </p>
            )}
            {preview.warnings.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] font-medium text-amber-700">
                  {preview.warnings.length} row(s) need attention
                </summary>
                <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                  {preview.warnings.slice(0, 10).map((w) => <li key={w}>• {w}</li>)}
                </ul>
              </details>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => apply.mutate(file)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-60"
              >
                {apply.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Import {preview.rows} findings
              </button>
              <button
                onClick={() => { setPreview(null); setFile(null); }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            <strong>{result.created} created</strong>, {result.updated} updated
            {result.skipped ? `, ${result.skipped} skipped` : ''}
            {result.as_of ? ` — as of ${result.as_of}` : ''}.
            {result.linked && (result.linked.observations || result.linked.incidents) ? (
              <span className="mt-1 block">
                {result.linked.observations ? `${result.linked.observations} MRA(s) added to Statutory Audit. ` : ''}
                {result.linked.incidents ? `${result.linked.incidents} self-identified event(s) added to Incidents.` : ''}
              </span>
            ) : null}
            {result.unmatched_owners.length > 0 && (
              <span className="mt-1 block text-amber-800">
                Unassigned owners: {result.unmatched_owners.join(', ')}
              </span>
            )}
            <button onClick={() => setResult(null)} className="mt-1 block text-[11px] font-semibold text-emerald-900 underline">
              Dismiss
            </button>
          </div>
        )}
      </div>
      )}

      {view === 'summary' && <RegisterSummary onDrill={(s, status) => drill({ source: s, status })} />}
      {view === 'reports' && (
        <RegisterReports
          onOpen={(id) => { setNewFinding(null); setOpenIssue({ id, edit: false }); }}
          onAddFinding={addFinding}
          onShowInRegister={(s, report) => drill({ source: s, report })}
        />
      )}
      {view === 'extensions' && <RegisterExtensions onOpen={(id) => { setNewFinding(null); setOpenIssue({ id, edit: false, focus: 'workflow' }); }} />}
      {view === 'mappings' && <RegisterMappings />}

      {view === 'imports' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          {!history.data?.length ? (
            <p className="p-8 text-center text-sm text-slate-500">No imports yet.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>{['Workbook', 'As of', 'Imported', 'Created', 'Updated', 'Skipped', 'Needs attention'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.data.map((run) => (
                  <Fragment key={run.id}>
                  <tr onClick={() => setOpenRun(openRun === run.id ? null : run.id)}
                      className={`cursor-pointer hover:bg-slate-50 ${openRun === run.id ? 'bg-slate-50' : ''}`}>
                    <td className="px-3 py-2 text-slate-900">{run.file_name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{run.as_of || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {run.imported_at ? run.imported_at.replace('T', ' ').slice(0, 16) : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-900">{run.created}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{run.updated}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{run.skipped}</td>
                    <td className="px-3 py-2 text-amber-700">
                      {run.unmatched_owners.length ? `${run.unmatched_owners.length} owner name(s)` : ''}
                      {run.unmatched_owners.length && run.warnings.length ? ' · ' : ''}
                      {run.warnings.length ? `${run.warnings.length} row(s)` : ''}
                      {!run.unmatched_owners.length && !run.warnings.length ? '—' : ''}
                    </td>
                  </tr>
                  {openRun === run.id && (
                    <tr>
                      <td colSpan={7} className="bg-slate-50 px-4 py-3">
                        {run.unmatched_owners.length > 0 && (
                          <div className="mb-2">
                            <p className="text-[11px] font-semibold text-slate-700">Owner names that matched no user</p>
                            <p className="text-[11px] text-slate-600">
                              {run.unmatched_owners.map((o) => `${o.name} (${o.rows})`).join(' · ')}
                            </p>
                            <button onClick={() => setView('mappings')}
                                    className="mt-1 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                              <Users className="h-3 w-3" /> Map them to users
                            </button>
                          </div>
                        )}
                        {run.warnings.length > 0 ? (
                          <ul className="space-y-0.5 text-[11px] text-slate-600">
                            {run.warnings.map((w) => <li key={w}>• {w}</li>)}
                          </ul>
                        ) : !run.unmatched_owners.length && (
                          <p className="text-[11px] text-slate-500">Nothing needed attention in this upload.</p>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── the register ───────────────────────────────────────────────── */}
      <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${view === 'register' ? '' : 'hidden'}`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <h2 className="mr-auto text-sm font-semibold text-slate-900">
            Register {rows.data ? (
              <span className="font-normal text-slate-500">
                · {visible.length === rows.data.length ? `${rows.data.length} findings` : `${visible.length} of ${rows.data.length} findings`}
              </span>
            ) : null}
            {linkNote && <span className="ml-2 text-[11px] font-normal text-emerald-700">{linkNote}</span>}
            {remindNote && <span className="ml-2 text-[11px] font-normal text-emerald-700">{remindNote}</span>}
          </h2>
          <div className="relative">
            <button
              onClick={() => setRemindOpen((o) => !o)}
              title="Remind owners of findings coming due or past due (the daily job does this too)"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Bell className="h-3 w-3" /> Remind owners
            </button>
            {remindOpen && (
              <div className="absolute right-0 z-30 mt-1 w-80 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
                {reminderPreview.isLoading ? (
                  <Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-300" />
                ) : reminderPreview.data ? (
                  <>
                    <p className="font-semibold text-slate-900">
                      {reminderPreview.data.due_soon} coming due (14 days) · {reminderPreview.data.past_due} past due
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {reminderPreview.data.owners} owner(s), one message each
                      {reminderPreview.data.escalated ? `; ${reminderPreview.data.escalated} 30+ days past due escalate to Audit Services` : ''}.
                      Each finding is reminded at most weekly.
                    </p>
                    <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-slate-600">
                      {reminderPreview.data.items.slice(0, 30).map((i) => (
                        <li key={i.issue_id} className="truncate">
                          {i.reference ? `${i.reference} · ` : ''}{i.title} — {i.past_due ? `${i.past_due}d past due` : `due ${i.due}`}
                        </li>
                      ))}
                    </ul>
                    <label className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600">
                      <input type="checkbox" checked={remindEmail} onChange={(e) => setRemindEmail(e.target.checked)} />
                      Also email them (in-app notification always)
                    </label>
                    <button
                      onClick={() => remind.mutate()}
                      disabled={remind.isPending || !reminderPreview.data.items.length}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
                    >
                      {remind.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />}
                      {reminderPreview.data.items.length ? 'Send reminders' : 'Nobody to remind today'}
                    </button>
                  </>
                ) : (
                  <p className="text-red-600">Could not work out the reminders.</p>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => relink.mutate()}
            disabled={relink.isPending}
            title="Match findings to the IT asset inventory, the vulnerability register and vendors again"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {relink.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Re-link
          </button>
          <button
            onClick={() => setSource('')}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${!source ? 'bg-primary-600 text-[#0a0a0a]' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            All
          </button>
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${source === s ? 'bg-primary-600 text-[#0a0a0a]' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {SOURCE_LABELS[s] || s}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Search issue #, name, owner, report, LOB"
                   className="w-72 rounded-lg border border-slate-200 bg-white py-1 pl-7 pr-2 text-xs text-slate-800 focus:border-primary-400 focus:outline-none" />
          </label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
            <option value="">All statuses</option>
            <option value="open">Open (everything not closed)</option>
            {Object.entries(STATUS).map(([code, [label]]) => <option key={code} value={code}>{label}</option>)}
            <option value="deleted">Deleted — to restore</option>
          </select>
          {reportFilter && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-primary-50 px-2 py-1 text-xs text-primary-800 ring-1 ring-primary-200">
              Report: {reportFilter.label}
              <button aria-label="Clear the report filter" onClick={() => setReportFilter(null)}><X className="h-3 w-3" /></button>
            </span>
          )}
          {(search || statusFilter || reportFilter) && (
            <button onClick={() => { setSearch(''); setStatusFilter(''); setReportFilter(null); }}
                    className="text-[11px] font-medium text-slate-500 hover:underline">
              Clear filters
            </button>
          )}
        </div>

        {rows.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
        ) : rows.isError ? (
          <p className="flex items-center gap-2 p-6 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4" /> Could not load the register.
            <button onClick={() => rows.refetch()} className="font-semibold underline">Retry</button>
          </p>
        ) : !rows.data?.length ? (
          <p className="p-8 text-center text-sm text-slate-500">
            Nothing in the register yet.{' '}
            <button onClick={() => fileRef.current?.click()} className="font-semibold text-primary-700 hover:underline">Upload the workbook</button>,{' '}
            <button onClick={downloadTemplate} className="font-semibold text-primary-700 hover:underline">download the blank template</button>{' '}
            or <button onClick={() => addFinding()} className="font-semibold text-primary-700 hover:underline">add a finding</button>.
          </p>
        ) : showingDeleted && deletedRows.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
        ) : !visible.length ? (
          <p className="p-8 text-center text-sm text-slate-500">
            {showingDeleted ? 'Nothing has been deleted.' : 'No findings match these filters.'}{' '}
            {!showingDeleted && (
              <button onClick={() => addFinding()} className="font-semibold text-primary-700 hover:underline">
                Add one{source ? ` on the ${SOURCE_LABELS[source] || source} sheet` : ''}
              </button>
            )}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  {['Source', 'Report', 'Issue #', 'Issue name', 'Risk', 'LOB', 'Owner',
                    'Target', 'Revised', 'Status', 'Validation', 'Aging', ''].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((r) => (
                  <tr key={r.issue_id} onClick={() => { setNewFinding(null); setOpenIssue({ id: r.issue_id, edit: false }); }}
                      className="cursor-pointer hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="text-slate-700">{SOURCE_LABELS[r.source] || r.source}</span>
                      {r.record_type === 'recommendation' && (
                        <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500">rec</span>
                      )}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-slate-600" title={r.report || ''}>
                      {r.regulator ? `${r.regulator} · ` : ''}{r.report || '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">
                      {r.reference || '—'}
                      {r.added_in_platform && (
                        <span title="Added in the platform, not from the workbook"
                              className="ml-1 rounded bg-primary-50 px-1 text-[10px] font-normal text-primary-700">new</span>
                      )}
                    </td>
                    <td className="max-w-[320px] truncate px-3 py-2 text-slate-900" title={r.title || ''}>{r.title}</td>
                    <td className="px-3 py-2">
                      {r.risk_rating && (
                        <span className={chip(RISK_TONE[r.risk_rating.toLowerCase()] || RISK_TONE.low)}>
                          {r.risk_rating}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.lob || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={r.owner_id ? 'text-slate-700' : 'text-amber-700'} title={r.owner || ''}>
                        {r.owner_name || r.owner || '—'}
                      </span>
                      {r.owner && !r.owner_id && <span className="ml-1 text-[10px] text-amber-600">unmatched</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.target_date || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.revised_target_date || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span
                        className={chip((STATUS[r.status] || STATUS.unstated)[1])}
                        title={`Recorded: ${r.ia_status || r.remediation_status || r.workflow_state || 'nothing'}`}
                      >
                        {(STATUS[r.status] || STATUS.unstated)[0]}
                      </span>
                      {r.workflow_state === 'closure_review' && r.status !== 'CD' && (
                        <span className="ml-1 text-[10px] text-sky-700">awaiting validation</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {r.validation_pass_fail || r.validation_status || '—'}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2 ${r.days_past_due && r.status !== 'CD' ? 'font-medium text-red-700' : 'text-slate-600'}`}>
                      {r.status === 'CD' ? '—' : r.days_past_due ? `${r.days_past_due}d past due` : (r.aged_status || '—')}
                    </td>
                    <td className="relative px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <button aria-label="Row actions" onClick={() => setRowMenu(rowMenu === r.issue_id ? null : r.issue_id)}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {rowMenu === r.issue_id && (
                        <div className="absolute right-2 z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg">
                          <button onClick={() => { setNewFinding(null); setOpenIssue({ id: r.issue_id, edit: false }); setRowMenu(null); }}
                                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                            <Eye className="h-3 w-3" /> View
                          </button>
                          <button onClick={() => { setNewFinding(null); setOpenIssue({ id: r.issue_id, edit: true }); setRowMenu(null); }}
                                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                          <button onClick={() => { setNewFinding(null); setOpenIssue({ id: r.issue_id, edit: false, focus: 'workflow' }); setRowMenu(null); }}
                                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                            <ClipboardCheck className="h-3 w-3" /> Validation &amp; extension
                          </button>
                          <button onClick={() => {
                                    setRowMenu(null);
                                    addFinding(ENTRY_TEMPLATE[r.source] ?? null, r.report_prefill);
                                  }}
                                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                            <Plus className="h-3 w-3" /> Add finding on this report
                          </button>
                          <Link href={`/issues/${r.issue_id}`}
                                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                            <ExternalLink className="h-3 w-3" /> Open issue page
                          </Link>
                          <div className="my-1 border-t border-slate-100" />
                          {r.deleted ? (
                            <button onClick={() => { setRowMenu(null); restore.mutate(r.issue_id); }}
                                    disabled={restore.isPending}
                                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-primary-700 hover:bg-slate-50">
                              <RotateCcw className="h-3 w-3" /> Restore to the register
                            </button>
                          ) : (
                            <button onClick={() => { setRowMenu(null); setDeleteReason(''); setDeleting(r); }}
                                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
                              <Trash2 className="h-3 w-3" /> Delete finding
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RightSlidePanel
        isOpen={!!openIssue || !!newFinding}
        onClose={() => { setOpenIssue(null); setNewFinding(null); }}
        title={newFinding ? 'Add a finding' : rows.data?.find((r) => r.issue_id === openIssue?.id)?.title || 'Finding'}
        subtitle={newFinding ? 'On one of the workbook’s sheets, in its columns' : (() => {
          const r = rows.data?.find((x) => x.issue_id === openIssue?.id);
          return r ? `${SOURCE_LABELS[r.source] || r.source}${r.reference ? ` · ${r.reference}` : ''}${r.code ? ` · ${r.code}` : ''}` : undefined;
        })()}
        width="w-full max-w-2xl"
        footer={openIssue && !newFinding ? (
          <div className="flex w-full items-center gap-3">
            <Link href={`/issues/${openIssue.id}`} className="mr-auto inline-flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> Open the full issue — actions, links, comments
            </Link>
            {(() => {
              const r = rows.data?.find((x) => x.issue_id === openIssue.id);
              return r ? (
                <button onClick={() => { setDeleteReason(''); setDeleting(r); }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline">
                  <Trash2 className="h-3.5 w-3.5" /> Delete finding
                </button>
              ) : null;
            })()}
          </div>
        ) : undefined}
      >
        {newFinding ? (
          <NewFindingForm
            key={`${newFinding.template}-${JSON.stringify(newFinding.prefill || {})}`}
            template={newFinding.template}
            prefill={newFinding.prefill}
            onCancel={() => setNewFinding(null)}
            onCreated={(id) => { setNewFinding(null); setOpenIssue({ id, edit: false }); }}
          />
        ) : openIssue && (
          <div className="space-y-4">
            {openIssue.focus === 'workflow' && <FindingWorkflow issueId={openIssue.id} />}
            <FindingForm issueId={openIssue.id} startInEdit={openIssue.edit} />
            {openIssue.focus !== 'workflow' && <FindingWorkflow issueId={openIssue.id} />}
          </div>
        )}
      </RightSlidePanel>

      <AnimatedModal
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        size="md"
        title="Delete this finding?"
        subtitle={deleting ? `${deleting.reference ? `${deleting.reference} · ` : ''}${deleting.title || ''}${deleting.code ? ` · ${deleting.code}` : ''}` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleting(null)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              Keep it
            </button>
            <button onClick={() => deleting && remove.mutate({ id: deleting.issue_id, reason: deleteReason })}
                    disabled={remove.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
              {remove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete finding
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-xs text-slate-600">
          <p>
            It leaves the register, the Issue Summary, reports and reminders. Its issue is kept as
            cancelled with its full history, so the audit trail stays intact
            {deleting?.source === 'regulator' ? ', and its Statutory Audit observation is cancelled' : ''}
            {deleting?.source === 'self_id' ? ', and its incident is closed' : ''}.
          </p>
          {deleting && !deleting.added_in_platform && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
              This finding came from the workbook. Later uploads that still carry it will leave it out
              rather than add it back.
            </p>
          )}
          <p>You can restore it any time: status filter → <strong>Deleted — to restore</strong>.</p>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reason (kept in the history)</span>
            <textarea rows={2} value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)}
                      placeholder="e.g. entered twice, raised in error"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-primary-400 focus:outline-none" />
          </label>
        </div>
      </AnimatedModal>
    </div>
  );
}
