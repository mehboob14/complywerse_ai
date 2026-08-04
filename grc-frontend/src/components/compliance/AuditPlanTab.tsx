'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  Plus, Edit2, Trash2, Sparkles, ChevronDown, ChevronRight,
  X, Save, Loader2, ClipboardList, Search, AlertCircle,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditPlanEntry {
  id: number;
  assessment_id: number;
  entry_type: string | null;
  audit_id: string | null;
  audit_name: string | null;
  team_responsible: string | null;
  lead_auditor: string | null;
  audit_type: string | null;
  scope: string | null;
  methods: string | null;
  criteria: string | null;
  sampling: string | null;
  evidence_needed: string | null;
  duration: string | null;
  schedule: string | null;
  audit_start: string | null;
  audit_end: string | null;
  cost: string | null;
  comment: string | null;
  status: string | null;
  priority: string | null;
  ai_recommendation: string | null;
  ai_recommendation_generated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface TenantUser {
  id: number;
  label: string;
  email: string | null;
}

interface Summary {
  total: number;
  audits: number;
  reviews: number;
  planned: number;
  in_progress: number;
  completed: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTRY_TYPES = ['Audit', 'Review'];
const TEAM_OPTIONS = ['Cybersecurity Org', 'Internal Audit', 'Third Party'];
const AUDIT_TYPES = ['Design effectiveness', 'Operational effectiveness', 'Both'];
const STATUS_OPTIONS = ['planned', 'in_progress', 'completed', 'cancelled'];
const PRIORITY_OPTIONS = ['critical', 'high', 'medium', 'low'];

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  planned:     { bg: 'bg-gray-100',   text: 'text-gray-700' },
  in_progress: { bg: 'bg-blue-50',    text: 'text-blue-700' },
  completed:   { bg: 'bg-green-50',   text: 'text-green-700' },
  cancelled:   { bg: 'bg-rose-50',    text: 'text-rose-700' },
};

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-rose-100 text-rose-700',
  high:     'bg-orange-100 text-orange-700',
  medium:   'bg-amber-100 text-amber-700',
  low:      'bg-gray-100 text-gray-600',
};

// ─── Empty form ───────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  entry_type: 'Audit', audit_name: '', team_responsible: '', lead_auditor: '',
  audit_type: '', scope: '', methods: '', criteria: '', sampling: '',
  evidence_needed: '', duration: '', schedule: '', audit_start: '', audit_end: '',
  cost: '', comment: '', status: 'planned', priority: '',
};

// ─── AI Panel ─────────────────────────────────────────────────────────────────

function AIPanel({ json, generatedAt }: { json: string; generatedAt: string | null }) {
  let data: any = {};
  try { data = JSON.parse(json); } catch { data = { summary: json }; }
  return (
    <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-purple-600" />
        <span className="text-sm font-medium text-purple-700">AI Recommendation</span>
        {generatedAt && <span className="text-xs text-gray-500">{new Date(generatedAt).toLocaleString()}</span>}
      </div>
      {data.summary && <p className="text-sm text-gray-700">{data.summary}</p>}
      {Array.isArray(data.scope_advice) && data.scope_advice.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Scope Refinements</p>
          <ul className="list-disc list-inside space-y-1">
            {data.scope_advice.map((s: string, i: number) => (
              <li key={i} className="text-xs text-gray-700">{s}</li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(data.methods) && data.methods.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Recommended Methods</p>
          <ul className="list-disc list-inside space-y-1">
            {data.methods.map((m: string, i: number) => (
              <li key={i} className="text-xs text-gray-700">{m}</li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(data.evidence) && data.evidence.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Evidence to Collect</p>
          <ul className="list-disc list-inside space-y-1">
            {data.evidence.map((e: string, i: number) => (
              <li key={i} className="text-xs text-gray-700">{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Add/Edit Modal ───────────────────────────────────────────────────────────

function EntryModal({
  entry, onClose, onSave, isSaving, tenantUsers,
}: {
  entry: AuditPlanEntry | null;
  onClose: () => void;
  onSave: (d: Record<string, any>) => void;
  isSaving: boolean;
  tenantUsers: TenantUser[];
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    if (!entry) return { ...EMPTY_FORM };
    return {
      entry_type:        entry.entry_type || 'Audit',
      audit_name:        entry.audit_name || '',
      team_responsible:  entry.team_responsible || '',
      lead_auditor:      entry.lead_auditor || '',
      audit_type:        entry.audit_type || '',
      scope:             entry.scope || '',
      methods:           entry.methods || '',
      criteria:          entry.criteria || '',
      sampling:          entry.sampling || '',
      evidence_needed:   entry.evidence_needed || '',
      duration:          entry.duration || '',
      schedule:          entry.schedule || '',
      audit_start:       entry.audit_start?.slice(0, 10) || '',
      audit_end:         entry.audit_end?.slice(0, 10) || '',
      cost:              entry.cost || '',
      comment:           entry.comment || '',
      status:            entry.status || 'planned',
      priority:          entry.priority || '',
    };
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = () => {
    const data: Record<string, any> = { ...form };
    ['audit_start', 'audit_end'].forEach(k => { data[k] = data[k] || null; });
    Object.keys(data).forEach(k => { if (data[k] === '') data[k] = null; });
    onSave(data);
  };

  const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500';
  const textareaCls = `${inputCls} resize-none`;

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-base font-semibold text-black">
            {entry ? `Edit ${entry.audit_id || 'Entry'}` : 'Add Audit Plan Entry'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Identification</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Entry Type">
                <select value={form.entry_type} onChange={e => set('entry_type', e.target.value)} className={inputCls}>
                  {ENTRY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Audit / Review Name">
                <input type="text" value={form.audit_name} onChange={e => set('audit_name', e.target.value)} className={inputCls} placeholder="e.g. Annual ISMS Audit" />
              </Field>
              <Field label="Team Responsible">
                <select value={form.team_responsible} onChange={e => set('team_responsible', e.target.value)} className={inputCls}>
                  <option value="">— Select team —</option>
                  {TEAM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Lead Auditor (platform user)">
                <select value={form.lead_auditor} onChange={e => set('lead_auditor', e.target.value)} className={inputCls}>
                  <option value="">— Select user —</option>
                  {tenantUsers.map(u => (
                    <option key={u.id} value={u.label}>{u.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Audit Type">
                <select value={form.audit_type} onChange={e => set('audit_type', e.target.value)} className={inputCls}>
                  <option value="">— Select audit type —</option>
                  {AUDIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select value={form.priority} onChange={e => set('priority', e.target.value)} className={inputCls}>
                  <option value="">— None —</option>
                  {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Audit Methodology</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Field label="Scope">
                  <textarea value={form.scope} onChange={e => set('scope', e.target.value)} rows={2} className={textareaCls} placeholder="Audit scope..." />
                </Field>
              </div>
              <Field label="Methods">
                <textarea value={form.methods} onChange={e => set('methods', e.target.value)} rows={2} className={textareaCls} placeholder="Interviews, document review, observation..." />
              </Field>
              <Field label="Criteria">
                <textarea value={form.criteria} onChange={e => set('criteria', e.target.value)} rows={2} className={textareaCls} placeholder="Audit criteria / standards..." />
              </Field>
              <Field label="Sampling">
                <textarea value={form.sampling} onChange={e => set('sampling', e.target.value)} rows={2} className={textareaCls} placeholder="Sampling approach..." />
              </Field>
              <Field label="Evidence Needed">
                <textarea value={form.evidence_needed} onChange={e => set('evidence_needed', e.target.value)} rows={2} className={textareaCls} placeholder="Evidence requirements..." />
              </Field>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Schedule & Resources</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Duration">
                <input type="text" value={form.duration} onChange={e => set('duration', e.target.value)} className={inputCls} placeholder="e.g. 2 weeks" />
              </Field>
              <Field label="Schedule">
                <input type="text" value={form.schedule} onChange={e => set('schedule', e.target.value)} className={inputCls} placeholder="Detailed schedule" />
              </Field>
              <Field label="Audit Start">
                <input type="date" value={form.audit_start} onChange={e => set('audit_start', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Audit End">
                <input type="date" value={form.audit_end} onChange={e => set('audit_end', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Cost">
                <input type="text" value={form.cost} onChange={e => set('cost', e.target.value)} className={inputCls} placeholder="e.g. SAR 50,000" />
              </Field>
              <div className="md:col-span-2">
                <Field label="Comment">
                  <textarea value={form.comment} onChange={e => set('comment', e.target.value)} rows={2} className={textareaCls} placeholder="Additional comments..." />
                </Field>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={isSaving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {entry ? 'Save Changes' : 'Add Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  assessmentId: number;
  tenantUsers: TenantUser[];
}

export default function AuditPlanTab({ assessmentId, tenantUsers }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [modalEntry, setModalEntry] = useState<AuditPlanEntry | null | 'new'>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [generatingAI, setGeneratingAI] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery<{ entries: AuditPlanEntry[]; summary: Summary }>({
    queryKey: ['audit-plan-entries', assessmentId],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${assessmentId}/audit-plan`)).data,
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: (d: Record<string, any>) => apiClient.post(`/compliance/assessments/${assessmentId}/audit-plan`, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['audit-plan-entries', assessmentId] }); setModalEntry(null); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, d }: { id: number; d: Record<string, any> }) =>
      apiClient.put(`/compliance/assessments/${assessmentId}/audit-plan/${id}`, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['audit-plan-entries', assessmentId] }); setModalEntry(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/compliance/assessments/${assessmentId}/audit-plan/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['audit-plan-entries', assessmentId] }); setDeleteConfirm(null); },
  });

  const aiMut = useMutation({
    mutationFn: (id: number) =>
      apiClient.post(`/compliance/assessments/${assessmentId}/audit-plan/${id}/ai-recommendation`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['audit-plan-entries', assessmentId] }); setGeneratingAI(null); },
    onError: () => setGeneratingAI(null),
  });

  const entries = data?.entries ?? [];
  const summary = data?.summary ?? { total: 0, audits: 0, reviews: 0, planned: 0, in_progress: 0, completed: 0 };

  const filtered = useMemo(() => entries.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (e.audit_id || '').toLowerCase().includes(q) ||
      (e.audit_name || '').toLowerCase().includes(q) ||
      (e.lead_auditor || '').toLowerCase().includes(q) ||
      (e.team_responsible || '').toLowerCase().includes(q)
    );
  }), [entries, search]);

  const toggleRow = (id: number) => setExpandedRows(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>;
  }
  if (isError) {
    return (
      <div className="flex items-center gap-3 p-6 bg-rose-50 rounded-xl text-rose-700 text-sm">
        <AlertCircle className="h-5 w-5 shrink-0" />
        Failed to load audit plan entries.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: summary.total, color: 'text-black' },
          { label: 'Audits', value: summary.audits, color: 'text-blue-700' },
          { label: 'Reviews', value: summary.reviews, color: 'text-indigo-700' },
          { label: 'In Progress', value: summary.in_progress, color: 'text-amber-700' },
          { label: 'Completed', value: summary.completed, color: 'text-green-700' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search audit plan..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button onClick={() => setModalEntry('new')} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          <Plus className="h-4 w-4" />Add Entry
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardList className="h-12 w-12 text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-600">No audit plan entries yet</p>
            <p className="text-xs text-gray-400 mt-1">Click "Add Entry" to plan your first audit or review</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 w-8"></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Team</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Lead Auditor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Priority</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(entry => {
                  const expanded = expandedRows.has(entry.id);
                  const statusStyle = STATUS_STYLES[entry.status || 'planned'] || STATUS_STYLES.planned;
                  return (
                    <>
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <button onClick={() => toggleRow(entry.id)} className="text-gray-400 hover:text-gray-600">
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">{entry.audit_id || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-600">{entry.entry_type || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 max-w-[240px] truncate">{entry.audit_name || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{entry.team_responsible || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{entry.lead_auditor || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                            {(entry.status || 'planned').replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {entry.priority ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_STYLES[entry.priority] || ''}`}>
                              {entry.priority}
                            </span>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setGeneratingAI(entry.id); aiMut.mutate(entry.id); }}
                              disabled={generatingAI === entry.id}
                              className="p-1.5 rounded-lg text-purple-600 hover:bg-purple-50"
                              title="Generate AI Recommendation"
                            >
                              {generatingAI === entry.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Sparkles className="h-3.5 w-3.5" />}
                            </button>
                            <button onClick={() => setModalEntry(entry)} className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50" title="Edit">
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setDeleteConfirm(entry.id)} className="p-1.5 rounded-lg text-gray-500 hover:text-rose-600 hover:bg-rose-50" title="Delete">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${entry.id}-exp`} className="bg-gray-50">
                          <td colSpan={9} className="px-6 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-700">
                              {entry.scope && <div><strong className="text-gray-500">Scope:</strong> {entry.scope}</div>}
                              {entry.methods && <div><strong className="text-gray-500">Methods:</strong> {entry.methods}</div>}
                              {entry.criteria && <div><strong className="text-gray-500">Criteria:</strong> {entry.criteria}</div>}
                              {entry.sampling && <div><strong className="text-gray-500">Sampling:</strong> {entry.sampling}</div>}
                              {entry.evidence_needed && <div><strong className="text-gray-500">Evidence:</strong> {entry.evidence_needed}</div>}
                              {entry.duration && <div><strong className="text-gray-500">Duration:</strong> {entry.duration}</div>}
                              {entry.audit_start && <div><strong className="text-gray-500">Start:</strong> {entry.audit_start}</div>}
                              {entry.audit_end && <div><strong className="text-gray-500">End:</strong> {entry.audit_end}</div>}
                              {entry.cost && <div><strong className="text-gray-500">Cost:</strong> {entry.cost}</div>}
                              {entry.comment && <div className="md:col-span-2"><strong className="text-gray-500">Comment:</strong> {entry.comment}</div>}
                            </div>
                            {entry.ai_recommendation && (
                              <AIPanel json={entry.ai_recommendation} generatedAt={entry.ai_recommendation_generated_at} />
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(modalEntry === 'new' || (modalEntry && modalEntry !== 'new')) && (
        <EntryModal
          entry={modalEntry === 'new' ? null : modalEntry}
          onClose={() => setModalEntry(null)}
          onSave={d => {
            if (modalEntry === 'new') createMut.mutate(d);
            else updateMut.mutate({ id: (modalEntry as AuditPlanEntry).id, d });
          }}
          isSaving={createMut.isPending || updateMut.isPending}
          tenantUsers={tenantUsers}
        />
      )}

      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-black mb-2">Delete Audit Plan Entry?</h3>
            <p className="text-sm text-gray-600 mb-4">This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate(deleteConfirm)}
                disabled={deleteMut.isPending}
                className="px-4 py-2 text-sm text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2"
              >
                {deleteMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
