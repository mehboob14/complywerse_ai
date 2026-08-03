'use client';

export const dynamic = 'force-dynamic';

import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { aiRiskAssessmentApi, type AIRiskEntry, type AIRiskEvidence } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import {
  Bot, Plus, Upload, Download, Search, Sparkles, ChevronRight,
  Edit2, Trash2, X, AlertTriangle, CheckCircle2, Loader2, Link2,
  FileSpreadsheet, Paperclip, FileText, User,
} from 'lucide-react';

const CATEGORIES = [
  'Ethical / Fairness',
  'Data Privacy',
  'Operational',
  'Regulatory Compliance',
  'Intellectual Property',
  'Security',
  'Explainability/Trust',
  'Other',
];

const STATUSES = ['Open', 'In Progress', 'Closed', 'Accepted'];

const RESIDUAL_LEVELS = ['High', 'Medium', 'Low'];

function residualTone(level?: string | null) {
  const v = (level || '').toLowerCase();
  if (v === 'high') return { bg: 'bg-rose-100', text: 'text-rose-800' };
  if (v === 'medium') return { bg: 'bg-amber-100', text: 'text-amber-800' };
  if (v === 'low') return { bg: 'bg-emerald-100', text: 'text-emerald-800' };
  return { bg: 'bg-slate-100', text: 'text-slate-700' };
}

function statusTone(s?: string | null) {
  const v = (s || '').toLowerCase();
  if (v === 'closed') return { bg: 'bg-emerald-100', text: 'text-emerald-800' };
  if (v === 'in progress') return { bg: 'bg-primary-100', text: 'text-primary-800' };
  if (v === 'accepted') return { bg: 'bg-slate-100', text: 'text-slate-800' };
  return { bg: 'bg-amber-100', text: 'text-amber-800' };
}

type EditableEntry = Partial<AIRiskEntry>;

const emptyForm: EditableEntry = {
  risk_id_external: '',
  ai_system_use_case: '',
  risk_description: '',
  risk_category: '',
  likelihood: undefined,
  impact: undefined,
  existing_controls: '',
  residual_risk_level: '',
  mitigation_plan: '',
  risk_owner: '',
  risk_owner_user_id: undefined,
  target_review_date: '',
  status: 'Open',
};

export default function AIRiskAssessmentPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<EditableEntry>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<AIRiskEntry | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ imported: number; errors: number; file: string } | null>(null);
  const [generatingFor, setGeneratingFor] = useState<number | null>(null);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['ai-risk-assessment-entries'],
    queryFn: () => aiRiskAssessmentApi.list().then(r => r.data),
  });

  // Tenant users — Risk Owner picker source. Long staleTime so we don't
  // re-fetch on every drawer open. Falls back gracefully (returns []) if
  // the endpoint isn't available yet on a stale tenant.
  const { data: tenantUsers = [] } = useQuery({
    queryKey: ['ai-risk-assessment-tenant-users'],
    queryFn: () => aiRiskAssessmentApi.getTenantUsers().then(r => r.data).catch(() => []),
    staleTime: 5 * 60_000,
  });

  // Evidence linked to the currently-edited entry. Disabled when no entry
  // is open or this is a brand-new entry being created (no id yet).
  const { data: evidence = [], refetch: refetchEvidence } = useQuery<AIRiskEvidence[]>({
    queryKey: ['ai-risk-assessment-evidence', editingId],
    queryFn: () => aiRiskAssessmentApi.listEvidence(editingId!).then(r => r.data),
    enabled: !!editingId,
  });

  const uploadEvidenceMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) =>
      aiRiskAssessmentApi.uploadEvidence(id, file).then(r => r.data),
    onSuccess: () => refetchEvidence(),
  });

  const unlinkEvidenceMutation = useMutation({
    mutationFn: ({ id, linkId }: { id: number; linkId: number }) =>
      aiRiskAssessmentApi.unlinkEvidence(id, linkId),
    onSuccess: () => refetchEvidence(),
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (filterCategory && (e.risk_category || '') !== filterCategory) return false;
      if (filterStatus && (e.status || '') !== filterStatus) return false;
      if (!s) return true;
      return (
        (e.ai_system_use_case || '').toLowerCase().includes(s) ||
        (e.risk_description || '').toLowerCase().includes(s) ||
        (e.risk_owner || '').toLowerCase().includes(s) ||
        (e.risk_id_external || '').toLowerCase().includes(s)
      );
    });
  }, [entries, search, filterCategory, filterStatus]);

  const summary = useMemo(() => {
    const total = entries.length;
    const high = entries.filter((e) => (e.residual_risk_level || '').toLowerCase() === 'high').length;
    const open = entries.filter((e) => (e.status || '').toLowerCase() !== 'closed').length;
    const withAI = entries.filter((e) => !!e.ai_generated_at).length;
    return { total, high, open, withAI };
  }, [entries]);

  const createMutation = useMutation({
    mutationFn: (body: EditableEntry) => aiRiskAssessmentApi.create(body).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-risk-assessment-entries'] });
      closeDrawer();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: EditableEntry }) =>
      aiRiskAssessmentApi.update(id, body).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-risk-assessment-entries'] });
      closeDrawer();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => aiRiskAssessmentApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-risk-assessment-entries'] });
      setDeleteTarget(null);
    },
  });

  const suggestMutation = useMutation({
    mutationFn: (id: number) => aiRiskAssessmentApi.aiSuggest(id).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-risk-assessment-entries'] });
      setGeneratingFor(null);
    },
    onError: () => setGeneratingFor(null),
  });

  const acceptMutation = useMutation({
    mutationFn: (id: number) => aiRiskAssessmentApi.acceptAi(id).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-risk-assessment-entries'] }),
  });

  const bridgeMutation = useMutation({
    mutationFn: (id: number) => aiRiskAssessmentApi.bridgeToRisk(id).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-risk-assessment-entries'] }),
  });

  function openNew() {
    setEditingId(null);
    setForm(emptyForm);
    setDrawerOpen(true);
  }

  function openEdit(entry: AIRiskEntry) {
    setEditingId(entry.id);
    setForm({
      risk_id_external: entry.risk_id_external || '',
      ai_system_use_case: entry.ai_system_use_case || '',
      risk_description: entry.risk_description || '',
      risk_category: entry.risk_category || '',
      likelihood: entry.likelihood ?? undefined,
      impact: entry.impact ?? undefined,
      existing_controls: entry.existing_controls || '',
      residual_risk_level: entry.residual_risk_level || '',
      mitigation_plan: entry.mitigation_plan || '',
      risk_owner: entry.risk_owner || '',
      risk_owner_user_id: entry.risk_owner_user_id ?? undefined,
      target_review_date: entry.target_review_date || '',
      status: entry.status || 'Open',
    });
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  function submitForm() {
    const body: EditableEntry = { ...form };
    if (body.likelihood === undefined) delete body.likelihood;
    if (body.impact === undefined) delete body.impact;
    if (!body.target_review_date) delete body.target_review_date;
    if (editingId) updateMutation.mutate({ id: editingId, body });
    else createMutation.mutate(body);
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadResult(null);
    try {
      const r = await aiRiskAssessmentApi.upload(file);
      setUploadResult({
        imported: r.data.summary.imported_count,
        errors: r.data.summary.error_count,
        file: r.data.summary.file_name,
      });
      queryClient.invalidateQueries({ queryKey: ['ai-risk-assessment-entries'] });
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Upload failed';
      setUploadResult({ imported: 0, errors: 1, file: detail });
    } finally {
      setUploading(false);
    }
  }

  if (isLoading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-4 p-4 sm:p-5 max-w-[1400px] mx-auto">

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary-600" strokeWidth={1.75} />
            AI Risk Assessment
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Register, score, and treat AI / ML system risks using the AI Risk Assessment Template.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={aiRiskAssessmentApi.templateUrl()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
          >
            <Download className="h-4 w-4" />
            Template
          </a>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload xlsx
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
          <button
            onClick={openNew}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary-600 hover:bg-primary-700 text-[#0a0a0a]"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            New Entry
          </button>
        </div>
      </div>

      {uploadResult && (
        <div className="rounded-md border border-primary-200 bg-primary-50 p-3 text-sm text-primary-800 flex items-start gap-2">
          <FileSpreadsheet className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <strong>Imported {uploadResult.imported} entries</strong>
            {uploadResult.errors > 0 && <span> ({uploadResult.errors} errors)</span>}
            <span className="text-primary-600 ml-1">from {uploadResult.file}.</span>
          </div>
          <button onClick={() => setUploadResult(null)} className="text-primary-700 hover:text-primary-900">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Entries" value={summary.total} tone="slate" />
        <KpiCard label="Open" value={summary.open} tone="amber" />
        <KpiCard label="High Residual" value={summary.high} tone="rose" />
        <KpiCard label="AI Suggestions Generated" value={summary.withAI} tone="violet" />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 relative">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search AI system, description, owner, ID..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-2 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: '5%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '11%' }} />
          </colgroup>
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200">
              <Th>ID</Th>
              <Th>AI System</Th>
              <Th>Risk Description</Th>
              <Th>Category</Th>
              <Th>Score</Th>
              <Th>Residual</Th>
              <Th>Owner</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-10 text-slate-500">
                  <Bot className="h-10 w-10 mx-auto mb-2 text-slate-300" />
                  <p>No AI risk entries. Click <span className="font-semibold">+ New Entry</span> or upload the template.</p>
                </td>
              </tr>
            ) : filtered.map((entry) => {
              const rt = residualTone(entry.residual_risk_level);
              const st = statusTone(entry.status);
              const aiUnused = !!entry.ai_generated_at && !entry.ai_suggestion_accepted;
              return (
                <tr key={entry.id} className="hover:bg-slate-50 align-top">
                  <Td className="font-mono text-xs text-slate-600">
                    {entry.risk_id_external || entry.id}
                  </Td>
                  <Td>
                    <div className="font-medium text-slate-900 break-words">{entry.ai_system_use_case || '-'}</div>
                    {aiUnused && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-medium text-primary-700">
                        <Sparkles className="h-3 w-3" /> AI suggestion ready
                      </span>
                    )}
                  </Td>
                  <Td className="text-slate-700 break-words">{entry.risk_description || '-'}</Td>
                  <Td className="text-slate-700 break-words">{entry.risk_category || '-'}</Td>
                  <Td>
                    <div className="text-sm font-semibold text-slate-900">
                      {entry.risk_score ?? '-'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      L{entry.likelihood ?? '-'} × I{entry.impact ?? '-'}
                    </div>
                  </Td>
                  <Td>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${rt.bg} ${rt.text}`}>
                      {entry.residual_risk_level || '-'}
                    </span>
                  </Td>
                  <Td className="text-slate-700 break-words">{entry.risk_owner || '-'}</Td>
                  <Td>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${st.bg} ${st.text}`}>
                      {entry.status || 'Open'}
                    </span>
                    {entry.bridged_risk_id && (
                      <Link
                        href={`/erm/risks/${entry.bridged_risk_id}`}
                        className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary-700 hover:underline"
                      >
                        <Link2 className="h-3 w-3" /> Risk #{entry.bridged_risk_id}
                      </Link>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        title="AI Suggest"
                        disabled={generatingFor === entry.id}
                        onClick={() => {
                          setGeneratingFor(entry.id);
                          suggestMutation.mutate(entry.id);
                        }}
                        className="p-1.5 rounded-md text-primary-600 hover:bg-primary-50 disabled:opacity-50"
                      >
                        {generatingFor === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      </button>
                      {!entry.bridged_risk_id && (
                        <button
                          title="Bridge to Risk Register"
                          onClick={() => bridgeMutation.mutate(entry.id)}
                          className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50"
                        >
                          <Link2 className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        title="Edit"
                        onClick={() => openEdit(entry)}
                        className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-primary-600"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        title="Delete"
                        onClick={() => setDeleteTarget(entry)}
                        className="p-1.5 rounded-md text-slate-600 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-900/40">
          <div className="w-full max-w-2xl bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {editingId ? `Edit Entry #${editingId}` : 'New AI Risk Entry'}
                </h3>
                <p className="text-[11px] text-slate-500">All 13 columns from the template.</p>
              </div>
              <button onClick={closeDrawer} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Risk ID">
                  <input
                    value={form.risk_id_external || ''}
                    onChange={(e) => setForm((s) => ({ ...s, risk_id_external: e.target.value }))}
                    placeholder="e.g. AI-001"
                    className="form-input"
                  />
                </Field>
                <Field label="Status">
                  <select
                    value={form.status || 'Open'}
                    onChange={(e) => setForm((s) => ({ ...s, status: e.target.value }))}
                    className="form-input"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="AI System / Use Case">
                <input
                  value={form.ai_system_use_case || ''}
                  onChange={(e) => setForm((s) => ({ ...s, ai_system_use_case: e.target.value }))}
                  placeholder="e.g. AI Chatbot, Fraud Detection AI"
                  className="form-input"
                />
              </Field>

              <Field label="Risk Description" required>
                <textarea
                  value={form.risk_description || ''}
                  onChange={(e) => setForm((s) => ({ ...s, risk_description: e.target.value }))}
                  rows={3}
                  className="form-input"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Risk Category">
                  <select
                    value={form.risk_category || ''}
                    onChange={(e) => setForm((s) => ({ ...s, risk_category: e.target.value }))}
                    className="form-input"
                  >
                    <option value="">Pick category</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Residual Risk Level">
                  <select
                    value={form.residual_risk_level || ''}
                    onChange={(e) => setForm((s) => ({ ...s, residual_risk_level: e.target.value }))}
                    className="form-input"
                  >
                    <option value="">Auto compute</option>
                    {RESIDUAL_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Likelihood (1-5)">
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={form.likelihood ?? ''}
                    onChange={(e) => setForm((s) => ({ ...s, likelihood: e.target.value ? Number(e.target.value) : undefined }))}
                    className="form-input"
                  />
                </Field>
                <Field label="Impact (1-5)">
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={form.impact ?? ''}
                    onChange={(e) => setForm((s) => ({ ...s, impact: e.target.value ? Number(e.target.value) : undefined }))}
                    className="form-input"
                  />
                </Field>
                <Field label="Risk Score">
                  <div className="px-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-md text-slate-700">
                    {(form.likelihood && form.impact) ? Number(form.likelihood) * Number(form.impact) : '-'}
                  </div>
                </Field>
              </div>

              <Field label="Existing Controls">
                <textarea
                  value={form.existing_controls || ''}
                  onChange={(e) => setForm((s) => ({ ...s, existing_controls: e.target.value }))}
                  rows={2}
                  className="form-input"
                />
              </Field>

              <Field label="Mitigation Plan">
                <textarea
                  value={form.mitigation_plan || ''}
                  onChange={(e) => setForm((s) => ({ ...s, mitigation_plan: e.target.value }))}
                  rows={3}
                  className="form-input"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Risk Owner">
                  {/* Two-line picker: tenant-user dropdown (sets both
                      risk_owner_user_id and the display name as risk_owner
                      text), plus a free-text override for "Compliance Team",
                      external owners, etc. Either or both can be set. */}
                  <div className="space-y-1">
                    <select
                      value={form.risk_owner_user_id ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) {
                          setForm((s) => ({ ...s, risk_owner_user_id: undefined }));
                        } else {
                          const id = Number(v);
                          const u = tenantUsers.find((tu) => tu.id === id);
                          setForm((s) => ({
                            ...s,
                            risk_owner_user_id: id,
                            // Pre-fill display text from the user — operator
                            // can still override with a team/department label.
                            risk_owner: (s.risk_owner && s.risk_owner.trim())
                              ? s.risk_owner : (u?.display_name || s.risk_owner || ''),
                          }));
                        }
                      }}
                      className="form-input"
                    >
                      <option value="">— assign a user —</option>
                      {tenantUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.display_name}{u.email ? ` (${u.email})` : ''}
                        </option>
                      ))}
                    </select>
                    <input
                      value={form.risk_owner || ''}
                      onChange={(e) => setForm((s) => ({ ...s, risk_owner: e.target.value }))}
                      placeholder="…or type a team / department"
                      className="form-input"
                    />
                  </div>
                </Field>
                <Field label="Target Review Date">
                  <input
                    type="date"
                    value={form.target_review_date || ''}
                    onChange={(e) => setForm((s) => ({ ...s, target_review_date: e.target.value }))}
                    className="form-input"
                  />
                </Field>
              </div>

              {editingId && (
                <AISection
                  entry={entries.find((e) => e.id === editingId)}
                  onAccept={() => acceptMutation.mutate(editingId)}
                  onSuggest={() => {
                    setGeneratingFor(editingId);
                    suggestMutation.mutate(editingId);
                  }}
                  generating={generatingFor === editingId}
                  accepting={acceptMutation.isPending}
                />
              )}

              {/* Evidence — only meaningful for saved entries (need an id
                  to attach files against). Empty/disabled for brand-new. */}
              {editingId && (
                <EvidenceSection
                  entryId={editingId}
                  items={evidence}
                  uploading={uploadEvidenceMutation.isPending}
                  unlinking={unlinkEvidenceMutation.isPending}
                  onUpload={(file) => uploadEvidenceMutation.mutate({ id: editingId, file })}
                  onUnlink={(linkId) => unlinkEvidenceMutation.mutate({ id: editingId, linkId })}
                />
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3 bg-slate-50">
              <div className="text-[11px] text-slate-500">
                Score auto computes from Likelihood × Impact.
              </div>
              <div className="flex gap-2">
                <button onClick={closeDrawer} className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  disabled={!form.risk_description?.trim() || createMutation.isPending || updateMutation.isPending}
                  onClick={submitForm}
                  className="px-3 py-1.5 text-sm rounded-md bg-primary-600 text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {editingId ? 'Save Changes' : 'Create Entry'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-5 w-5 text-rose-600" />
              <h3 className="text-sm font-semibold text-slate-900">Delete this AI risk entry?</h3>
            </div>
            <p className="mb-4 text-sm text-slate-600">
              <span className="font-medium text-slate-800">{deleteTarget.ai_system_use_case || deleteTarget.risk_description || `Entry ${deleteTarget.id}`}</span>
              <br />
              This action cannot be undone. The bridged Risk (if any) is preserved.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                className="px-3 py-1.5 text-sm rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 inline-flex items-center gap-1"
              >
                {deleteMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        :global(.form-input) {
          width: 100%;
          padding: 0.375rem 0.75rem;
          font-size: 0.875rem;
          border: 1px solid #cbd5e1;
          border-radius: 0.375rem;
          background-color: #fff;
        }
        :global(.form-input:focus) {
          outline: none;
          border-color: #1ed4b0;
          box-shadow: 0 0 0 2px rgba(30,212,176,0.2);
        }
      `}</style>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
        {label}{required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: number; tone: 'slate' | 'amber' | 'rose' | 'violet' }) {
  const t = {
    slate: 'text-slate-900',
    amber: 'text-amber-600',
    rose: 'text-rose-600',
    violet: 'text-primary-700',
  }[tone];
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${t}`}>{value}</div>
    </div>
  );
}

function AISection({
  entry, onAccept, onSuggest, generating, accepting,
}: {
  entry?: AIRiskEntry;
  onAccept: () => void;
  onSuggest: () => void;
  generating: boolean;
  accepting: boolean;
}) {
  if (!entry) return null;
  const hasAI = !!entry.ai_generated_at;
  return (
    <div className="border border-slate-200 bg-slate-50 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <Sparkles className="h-4 w-4" />
          AI Suggestions
        </h4>
        <div className="flex gap-2">
          <button
            onClick={onSuggest}
            disabled={generating}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-primary-600 text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {hasAI ? 'Regenerate' : 'Generate'}
          </button>
          {hasAI && !entry.ai_suggestion_accepted && (
            <button
              onClick={onAccept}
              disabled={accepting}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {accepting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Accept Suggestions
            </button>
          )}
        </div>
      </div>
      {!hasAI ? (
        <p className="text-xs text-slate-600">
          Click <span className="font-medium">Generate</span> to ask the platform AI for a mitigation plan,
          suggested controls, and likelihood / impact scoring based on the risk description and category.
        </p>
      ) : (
        <div className="space-y-2 text-xs">
          {entry.ai_suggestion_accepted && (
            <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
              <CheckCircle2 className="h-3 w-3" /> Accepted by operator
            </div>
          )}
          <SuggestionRow label="Mitigation" value={entry.ai_suggested_mitigation} />
          <SuggestionRow label="Existing Controls" value={entry.ai_suggested_controls} />
          <div className="grid grid-cols-3 gap-2">
            <SuggestionRow label="Likelihood" value={entry.ai_suggested_likelihood?.toString()} />
            <SuggestionRow label="Impact" value={entry.ai_suggested_impact?.toString()} />
            <SuggestionRow label="Residual" value={entry.ai_suggested_residual_level} />
          </div>
          {entry.ai_rationale && (
            <div className="rounded-md bg-white border border-slate-200 p-2 text-slate-700">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Rationale</div>
              <div className="mt-0.5 text-xs">{entry.ai_rationale}</div>
            </div>
          )}
          <div className="text-[10px] text-slate-500">
            Generated {entry.ai_generated_at ? new Date(entry.ai_generated_at).toLocaleString() : ''}
            {entry.ai_model && <span className="ml-1">· model {entry.ai_model}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function SuggestionRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-md bg-white border border-slate-200 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-xs text-slate-900">{value || '-'}</div>
    </div>
  );
}

function EvidenceSection({
  entryId,
  items,
  uploading,
  unlinking,
  onUpload,
  onUnlink,
}: {
  entryId: number;
  items: AIRiskEvidence[];
  uploading: boolean;
  unlinking: boolean;
  onUpload: (file: File) => void;
  onUnlink: (linkId: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary-900">
          <Paperclip className="h-4 w-4 text-primary-700" strokeWidth={1.75} />
          Supporting Evidence ({items.length})
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-primary-600 hover:bg-primary-700 text-[#0a0a0a] disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? 'Uploading…' : 'Upload File'}
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-slate-500 italic">
          No evidence attached yet. Upload audit reports, model cards, fairness scorecards, DPIAs, or any supporting document.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.link_id ?? it.evidence_id} className="flex items-center gap-2 rounded-md border border-primary-100 bg-white px-2.5 py-1.5 text-xs">
              <FileText className="h-3.5 w-3.5 shrink-0 text-primary-600" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-900">
                  {it.file_name || it.name || `Evidence #${it.evidence_id}`}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  {it.evidence_type && <span>{it.evidence_type}</span>}
                  {it.uploaded_at && <span>uploaded {new Date(it.uploaded_at).toLocaleDateString()}</span>}
                  <span className="rounded-full bg-emerald-50 px-1.5 py-px text-emerald-700">{it.relationship_type}</span>
                </div>
              </div>
              {it.link_id && (
                <>
                  <a
                    href={aiRiskAssessmentApi.evidenceDownloadUrl(entryId, it.link_id)}
                    target="_blank"
                    rel="noreferrer"
                    title="Download"
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-primary-600"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  <button
                    type="button"
                    title="Remove from this entry (keeps the Evidence row)"
                    disabled={unlinking}
                    onClick={() => onUnlink(it.link_id!)}
                    className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
