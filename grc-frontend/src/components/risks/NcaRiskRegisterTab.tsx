'use client';

import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import apiClient, { assetsApi } from '@/lib/api';
import * as XLSX from 'xlsx';
import {
  Upload,
  Layers,
  Plus, Edit2, Trash2, Sparkles, ChevronDown, ChevronRight,
  Download, Search, X, Save, Loader2, ShieldAlert, ExternalLink,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NcaRiskEntry {
  id: number;
  risk_identifier: string;
  risk_area: string | null;
  risk_owner: string | null;
  date_identified: string | null;
  description: string | null;
  risk_cause: string | null;
  threat: string | null;
  risk_analysis: string | null;
  date_analysis: string | null;
  inherent_likelihood: number | null;
  inherent_impact: number | null;
  inherent_rating: string | null;
  inherent_rating_override: string | null;
  treatment_type: string | null;
  treatment_description: string | null;
  treatment_owner: string | null;
  treatment_deadline: string | null;
  residual_description: string | null;
  residual_likelihood: number | null;
  residual_impact: number | null;
  residual_rating: string | null;
  following_steps: string | null;
  last_evaluation_date: string | null;
  comment: string | null;
  risk_owner_user_id: number | null;
  treatment_owner_user_id: number | null;
  linked_asset_ids: number[] | null;
  bridged_risk_id: number | null;
  ai_recommendation: string | null;
  ai_recommendation_generated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface TenantUser {
  id: number;
  display_name: string;
  email: string;
}

interface AssetLite {
  id: number;
  name: string;
  asset_type?: string;
}

interface Summary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  very_low: number;
  open_treatment: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RISK_AREAS = ['IT assets', 'Business process', 'Personnel'];
const TREATMENT_TYPES = ['Risk Mitigation', 'Risk Avoidance', 'Risk Transfer', 'Risk Acceptance'];
const RATING_OPTIONS = ['Critical', 'High', 'Medium', 'Low', 'Very Low', 'N/A'];
const THREATS = [
  'Credential compromise', 'Insider threats', 'Asset compromise', 'Social engineering',
  'Data breach/leakage', 'Loss of business continuity', 'Data loss',
  'Mistaking compliance for protection', 'Regulatory fines', 'Outdated hardware',
  'Vulnerable software', 'Cloud vulnerabilities', 'Ransomware', 'Malware',
  'Attacks on IoT devices', 'Operational downtime', 'DDoS',
  'Underestimation of risk occurrence probability', 'Partial risk assessment',
  'Improper risk management', 'Improper incident response', 'Third party exposure',
];

const RATING_STYLES: Record<string, { bg: string; text: string }> = {
  Critical: { bg: 'bg-rose-100', text: 'text-rose-700' },
  High:     { bg: 'bg-orange-100', text: 'text-orange-700' },
  Medium:   { bg: 'bg-amber-100', text: 'text-amber-700' },
  Low:      { bg: 'bg-green-100', text: 'text-green-700' },
  'Very Low': { bg: 'bg-gray-100', text: 'text-gray-600' },
};

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return <span className="text-xs text-gray-400">—</span>;
  const s = RATING_STYLES[rating] || { bg: 'bg-gray-100', text: 'text-gray-600' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>
      {rating}
    </span>
  );
}

// ─── Empty form state ─────────────────────────────────────────────────────────

const EMPTY_FORM = {
  risk_area: '', risk_owner: '', risk_owner_user_id: '', date_identified: '', description: '', risk_cause: '',
  threat: '', risk_analysis: '', date_analysis: '', inherent_likelihood: '',
  inherent_impact: '', inherent_rating_override: '', treatment_type: '',
  treatment_description: '', treatment_owner: '', treatment_owner_user_id: '', treatment_deadline: '',
  residual_description: '', residual_likelihood: '', residual_impact: '',
  following_steps: '', last_evaluation_date: '', comment: '',
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
      {Array.isArray(data.treatment_recommendations) && data.treatment_recommendations.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Treatment Recommendations</p>
          <ul className="list-disc list-inside space-y-1">
            {data.treatment_recommendations.map((r: string, i: number) => (
              <li key={i} className="text-xs text-gray-700">{r}</li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(data.controls_to_implement) && data.controls_to_implement.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Controls to Implement</p>
          <ul className="list-disc list-inside space-y-1">
            {data.controls_to_implement.map((c: string, i: number) => (
              <li key={i} className="text-xs text-gray-700">{c}</li>
            ))}
          </ul>
        </div>
      )}
      {data.residual_risk_guidance && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Residual Risk Guidance</p>
          <p className="text-xs text-gray-700">{data.residual_risk_guidance}</p>
        </div>
      )}
    </div>
  );
}

// ─── Add/Edit Modal ───────────────────────────────────────────────────────────

function EntryModal({
  entry,
  onClose,
  onSave,
  isSaving,
  tenantUsers,
  assets,
}: {
  entry: NcaRiskEntry | null;
  onClose: () => void;
  onSave: (data: Record<string, any>) => void;
  isSaving: boolean;
  tenantUsers: TenantUser[];
  assets: AssetLite[];
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    if (!entry) return { ...EMPTY_FORM };
    return {
      risk_area:                entry.risk_area || '',
      risk_owner:               entry.risk_owner || '',
      risk_owner_user_id:       entry.risk_owner_user_id?.toString() || '',
      date_identified:          entry.date_identified?.slice(0, 10) || '',
      description:              entry.description || '',
      risk_cause:               entry.risk_cause || '',
      threat:                   entry.threat || '',
      risk_analysis:            entry.risk_analysis || '',
      date_analysis:            entry.date_analysis?.slice(0, 10) || '',
      inherent_likelihood:      entry.inherent_likelihood?.toString() || '',
      inherent_impact:          entry.inherent_impact?.toString() || '',
      inherent_rating_override: entry.inherent_rating_override || '',
      treatment_type:           entry.treatment_type || '',
      treatment_description:    entry.treatment_description || '',
      treatment_owner:          entry.treatment_owner || '',
      treatment_owner_user_id:  entry.treatment_owner_user_id?.toString() || '',
      treatment_deadline:       entry.treatment_deadline?.slice(0, 10) || '',
      residual_description:     entry.residual_description || '',
      residual_likelihood:      entry.residual_likelihood?.toString() || '',
      residual_impact:          entry.residual_impact?.toString() || '',
      following_steps:          entry.following_steps || '',
      last_evaluation_date:     entry.last_evaluation_date?.slice(0, 10) || '',
      comment:                  entry.comment || '',
    };
  });

  const [linkedAssetIds, setLinkedAssetIds] = useState<number[]>(entry?.linked_asset_ids || []);
  const [assetSearch, setAssetSearch] = useState('');

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const calcRating = (l: string, i: string) => {
    const score = parseInt(l) * parseInt(i);
    if (!score) return null;
    if (score >= 20) return 'Critical';
    if (score >= 12) return 'High';
    if (score >= 6) return 'Medium';
    if (score >= 3) return 'Low';
    return 'Very Low';
  };

  const inherentRating = form.inherent_rating_override || calcRating(form.inherent_likelihood, form.inherent_impact);
  const residualRating  = calcRating(form.residual_likelihood, form.residual_impact);

  const handleSubmit = () => {
    const data: Record<string, any> = { ...form };
    ['inherent_likelihood', 'inherent_impact', 'residual_likelihood', 'residual_impact', 'risk_owner_user_id', 'treatment_owner_user_id'].forEach(k => {
      data[k] = data[k] ? parseInt(data[k]) : null;
    });
    ['date_identified', 'date_analysis', 'treatment_deadline', 'last_evaluation_date'].forEach(k => {
      data[k] = data[k] || null;
    });
    Object.keys(data).forEach(k => { if (data[k] === '') data[k] = null; });
    data.linked_asset_ids = linkedAssetIds;
    onSave(data);
  };

  // When user picks a platform user, auto-fill the text owner field with their display name
  const setOwnerByUser = (userIdField: string, ownerField: string, userId: string) => {
    setForm(f => {
      const next = { ...f, [userIdField]: userId };
      if (userId) {
        const u = tenantUsers.find(tu => tu.id === parseInt(userId));
        if (u) next[ownerField] = u.display_name || u.email;
      }
      return next;
    });
  };

  const filteredAssets = assets.filter(a =>
    !assetSearch || a.name.toLowerCase().includes(assetSearch.toLowerCase())
  );
  const showAssetLinking = form.risk_area === 'IT assets';

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );

  const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500';
  const selectCls = inputCls;
  const textareaCls = `${inputCls} resize-none`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-base font-semibold text-black">
            {entry ? `Edit ${entry.risk_identifier}` : 'Add NCA Risk Entry'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Risk Identification */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Risk Identification</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Risk Area (Scope)">
                <select value={form.risk_area} onChange={e => set('risk_area', e.target.value)} className={selectCls}>
                  <option value="">— Select scope —</option>
                  {RISK_AREAS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Risk Owner (platform user)">
                <select
                  value={form.risk_owner_user_id}
                  onChange={e => setOwnerByUser('risk_owner_user_id', 'risk_owner', e.target.value)}
                  className={selectCls}
                >
                  <option value="">— Select platform user —</option>
                  {tenantUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
                  ))}
                </select>
                {form.risk_owner && !form.risk_owner_user_id && (
                  <p className="text-xs text-gray-500 mt-1">Existing owner: {form.risk_owner}</p>
                )}
              </Field>
              <Field label="Date of Risk Identification">
                <input type="date" value={form.date_identified} onChange={e => set('date_identified', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Threat">
                <select value={form.threat} onChange={e => set('threat', e.target.value)} className={selectCls}>
                  <option value="">— Select threat —</option>
                  {THREATS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Description of the Risk">
                <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} className={textareaCls} placeholder="Describe the risk..." />
              </Field>
              <Field label="Risk Cause">
                <textarea value={form.risk_cause} onChange={e => set('risk_cause', e.target.value)} rows={3} className={textareaCls} placeholder="Root cause..." />
              </Field>
              <div className="md:col-span-2">
                <Field label="Risk Analysis and Consequences">
                  <textarea value={form.risk_analysis} onChange={e => set('risk_analysis', e.target.value)} rows={3} className={textareaCls} placeholder="Analysis and consequences..." />
                </Field>
              </div>
              <Field label="Date of Risk Analysis">
                <input type="date" value={form.date_analysis} onChange={e => set('date_analysis', e.target.value)} className={inputCls} />
              </Field>
            </div>

            {showAssetLinking && (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Layers className="h-4 w-4 text-blue-600" />
                  <h4 className="text-xs font-semibold text-blue-900">Linked IT Assets</h4>
                  <span className="text-xs text-gray-500">{linkedAssetIds.length} selected</span>
                </div>
                <input
                  type="text"
                  value={assetSearch}
                  onChange={e => setAssetSearch(e.target.value)}
                  placeholder="Search assets..."
                  className="w-full mb-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                  {filteredAssets.length === 0 ? (
                    <p className="text-xs text-gray-400 p-3 text-center">{assets.length === 0 ? 'No assets found in tenant' : 'No matching assets'}</p>
                  ) : filteredAssets.map(a => (
                    <label key={a.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={linkedAssetIds.includes(a.id)}
                        onChange={e => {
                          setLinkedAssetIds(prev =>
                            e.target.checked ? [...prev, a.id] : prev.filter(id => id !== a.id)
                          );
                        }}
                        className="rounded border-gray-300"
                      />
                      <span className="text-gray-800">{a.name}</span>
                      {a.asset_type && <span className="text-gray-400">({a.asset_type})</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Inherent Risk Assessment */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Inherent Risk Assessment</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Likelihood (1-5)">
                <input type="number" min={1} max={5} value={form.inherent_likelihood} onChange={e => set('inherent_likelihood', e.target.value)} className={inputCls} placeholder="1-5" />
              </Field>
              <Field label="Impact (1-5)">
                <input type="number" min={1} max={5} value={form.inherent_impact} onChange={e => set('inherent_impact', e.target.value)} className={inputCls} placeholder="1-5" />
              </Field>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Calculated Rating</label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex items-center">
                  <RatingBadge rating={inherentRating} />
                </div>
              </div>
              <Field label="Override Rating (manual)">
                <select value={form.inherent_rating_override} onChange={e => set('inherent_rating_override', e.target.value)} className={selectCls}>
                  <option value="">— Use calculated —</option>
                  {RATING_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
            </div>
          </div>

          {/* Treatment Plan */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Treatment Plan</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Type of Treatment Action">
                <select value={form.treatment_type} onChange={e => set('treatment_type', e.target.value)} className={selectCls}>
                  <option value="">— Select treatment —</option>
                  {TREATMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Treatment Owner (platform user)">
                <select
                  value={form.treatment_owner_user_id}
                  onChange={e => setOwnerByUser('treatment_owner_user_id', 'treatment_owner', e.target.value)}
                  className={selectCls}
                >
                  <option value="">— Select platform user —</option>
                  {tenantUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
                  ))}
                </select>
                {form.treatment_owner && !form.treatment_owner_user_id && (
                  <p className="text-xs text-gray-500 mt-1">Existing owner: {form.treatment_owner}</p>
                )}
              </Field>
              <div className="md:col-span-2">
                <Field label="Risk Treatment Description">
                  <textarea value={form.treatment_description} onChange={e => set('treatment_description', e.target.value)} rows={3} className={textareaCls} placeholder="Describe treatment actions..." />
                </Field>
              </div>
              <Field label="Deadline for Action">
                <input type="date" value={form.treatment_deadline} onChange={e => set('treatment_deadline', e.target.value)} className={inputCls} />
              </Field>
            </div>
          </div>

          {/* Residual Risk & Follow-up */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Residual Risk & Follow-up</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-3">
                <Field label="Residual Risk Description">
                  <textarea value={form.residual_description} onChange={e => set('residual_description', e.target.value)} rows={2} className={textareaCls} placeholder="Describe remaining risk after treatment..." />
                </Field>
              </div>
              <Field label="Residual Likelihood (1-5)">
                <input type="number" min={1} max={5} value={form.residual_likelihood} onChange={e => set('residual_likelihood', e.target.value)} className={inputCls} placeholder="1-5" />
              </Field>
              <Field label="Residual Impact (1-5)">
                <input type="number" min={1} max={5} value={form.residual_impact} onChange={e => set('residual_impact', e.target.value)} className={inputCls} placeholder="1-5" />
              </Field>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Residual Rating</label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex items-center">
                  <RatingBadge rating={residualRating} />
                </div>
              </div>
              <div className="md:col-span-3">
                <Field label="Following Steps Description">
                  <textarea value={form.following_steps} onChange={e => set('following_steps', e.target.value)} rows={2} className={textareaCls} placeholder="Next steps..." />
                </Field>
              </div>
              <Field label="Last Evaluation Date">
                <input type="date" value={form.last_evaluation_date} onChange={e => set('last_evaluation_date', e.target.value)} className={inputCls} />
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

export default function NcaRiskRegisterTab() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Open the bridged general Risk detail (full ERM page with mitigations,
  // asset/control/dept links, KRIs, reviews, etc.). Backfills the bridge for
  // entries created before the bridge column existed.
  const openInGeneralDetail = async (entry: NcaRiskEntry) => {
    let bridgedId = entry.bridged_risk_id;
    if (!bridgedId) {
      try {
        const res = await apiClient.post(`/risks/nca/${entry.id}/bridge`);
        bridgedId = res.data?.bridged_risk_id;
      } catch {
        /* fall through */
      }
    }
    if (bridgedId) {
      router.push(`/erm/risks/${bridgedId}`);
    } else {
      openInGeneralDetail(entry);
    }
  };
  const [search, setSearch] = useState('');
  const [modalEntry, setModalEntry] = useState<NcaRiskEntry | null | 'new'>( null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [generatingAI, setGeneratingAI] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ created: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<{ entries: NcaRiskEntry[]; summary: Summary }>({
    queryKey: ['nca-risk-entries'],
    queryFn: async () => (await apiClient.get('/risks/nca')).data,
  });

  const { data: tenantUsersData } = useQuery<TenantUser[]>({
    queryKey: ['tenant-users-for-nca-risk'],
    queryFn: async () => (await assetsApi.getTenantUsers()).data,
  });
  const tenantUsers = tenantUsersData ?? [];

  const { data: assetsData } = useQuery<AssetLite[]>({
    queryKey: ['assets-for-nca-risk'],
    queryFn: async () => {
      const res = await assetsApi.getAll();
      return (res.data as any[]).map(a => ({ id: a.id, name: a.name, asset_type: a.asset_type }));
    },
  });
  const assets = useMemo(() => assetsData ?? [], [assetsData]);

  const createMut = useMutation({
    mutationFn: (d: Record<string, any>) => apiClient.post('/risks/nca', d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nca-risk-entries'] }); setModalEntry(null); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, d }: { id: number; d: Record<string, any> }) => apiClient.put(`/risks/nca/${id}`, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nca-risk-entries'] }); setModalEntry(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/risks/nca/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nca-risk-entries'] }); setDeleteConfirm(null); },
  });

  const aiMut = useMutation({
    mutationFn: (id: number) => apiClient.post(`/risks/nca/${id}/ai-recommendation`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nca-risk-entries'] }); setGeneratingAI(null); },
    onError: () => setGeneratingAI(null),
  });

  const entries = data?.entries ?? [];
  const summary = data?.summary ?? { total: 0, critical: 0, high: 0, medium: 0, low: 0, very_low: 0, open_treatment: 0 };

  const filtered = entries.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (e.risk_identifier || '').toLowerCase().includes(q) ||
      (e.description || '').toLowerCase().includes(q) ||
      (e.risk_area || '').toLowerCase().includes(q) ||
      (e.threat || '').toLowerCase().includes(q) ||
      (e.risk_owner || '').toLowerCase().includes(q)
    );
  });

  const toggleRow = (id: number) => setExpandedRows(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsUploading(true);
    setUploadResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });

      // NCA workbook has 8 sheets — pick "Risk register" (the data sheet),
      // not the cover page or legend. Fall back to header sniffing.
      const findDataSheet = (): XLSX.WorkSheet | null => {
        const preferred = wb.SheetNames.find(n => {
          const s = n.toLowerCase();
          return s.includes('risk register') && !s.includes('legend');
        });
        if (preferred) return wb.Sheets[preferred];

        for (const name of wb.SheetNames) {
          const candidate = wb.Sheets[name];
          const probe: any[][] = XLSX.utils.sheet_to_json(candidate, { header: 1, defval: '' }) as any;
          for (let r = 0; r < Math.min(probe.length, 20); r++) {
            const rowStr = (probe[r] || []).map(c => String(c || '').toLowerCase()).join(' ');
            if (rowStr.includes('risk identifier') && rowStr.includes('threat')) {
              return candidate;
            }
          }
        }
        return null;
      };

      const ws = findDataSheet();
      if (!ws) {
        setUploadResult({ created: 0, errors: ['Could not find a Risk Register sheet in this workbook'] });
        return;
      }

      // Header row inside the chosen data sheet (NCA puts it at row 11 / idx 10)
      const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any;
      let headerRowIdx = 0;
      for (let r = 0; r < Math.min(allRows.length, 25); r++) {
        const rowStr = (allRows[r] || []).map(c => String(c || '').toLowerCase()).join(' ');
        if (rowStr.includes('risk identifier') || (rowStr.includes('risk owner') && rowStr.includes('threat'))) {
          headerRowIdx = r;
          break;
        }
      }
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '', range: headerRowIdx, raw: false });

      let created = 0;
      const errors: string[] = [];

      // Build a name → user_id map for owner auto-resolution
      const userByName = new Map<string, number>();
      tenantUsers.forEach(u => {
        const dn = (u.display_name || '').toLowerCase().trim();
        const em = (u.email || '').toLowerCase().trim();
        if (dn) userByName.set(dn, u.id);
        if (em) userByName.set(em, u.id);
      });

      const resolveUserId = (name: string | null): number | null => {
        if (!name) return null;
        return userByName.get(name.toLowerCase().trim()) ?? null;
      };

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const keys = Object.keys(r);
        const ci = (name: string) => {
          const norm = name.toLowerCase().replace(/\s+/g, ' ').trim();
          const key = keys.find(k => k.toLowerCase().replace(/\s+/g, ' ').trim().startsWith(norm));
          return key ? r[key] : undefined;
        };

        const toStr = (v: any) => (v === null || v === undefined || v === '') ? null : String(v).trim() || null;
        const toInt = (v: any) => { const n = parseInt(v); return isNaN(n) ? null : n; };
        const toDate = (v: any) => {
          if (!v) return null;
          if (v instanceof Date) return v.toISOString().split('T')[0];
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
        };

        const riskOwnerName = toStr(ci('risk owner'));
        const treatmentOwnerName = toStr(ci('owner of the treatment') ?? ci('owner of treatment') ?? ci('treatment owner'));

        // Some cells in the template are dropdown placeholders (e.g.
        // "Please select overall inherent risk rating") — treat those as null
        // so they don't pollute the imported record.
        const stripPlaceholder = (v: string | null): string | null => {
          if (!v) return null;
          if (/^please\s+select/i.test(v.trim())) return null;
          return v;
        };

        const payload = {
          risk_area:                stripPlaceholder(toStr(ci('risk area'))),
          risk_owner:               stripPlaceholder(riskOwnerName),
          risk_owner_user_id:       resolveUserId(riskOwnerName),
          date_identified:          toDate(ci('date of risk identification')),
          description:              toStr(ci('description of the risk') ?? ci('description')),
          risk_cause:               toStr(ci('risk cause')),
          threat:                   stripPlaceholder(toStr(ci('threat'))),
          risk_analysis:            toStr(ci('risk analysis and consequences') ?? ci('risk analysis')),
          date_analysis:            toDate(ci('date of risk analysis')),
          inherent_likelihood:      toInt(ci('inherent risk likelihood')),
          inherent_impact:          toInt(ci('inherent risk magnitude') ?? ci('inherent risk impact')),
          inherent_rating_override: stripPlaceholder(toStr(ci('updated overall inherent risk rating') ?? ci('updated inherent risk rating'))),
          treatment_type:           stripPlaceholder(toStr(ci('type of treatment action'))),
          treatment_description:    toStr(ci('risk treatment description')),
          treatment_owner:          stripPlaceholder(treatmentOwnerName),
          treatment_owner_user_id:  resolveUserId(treatmentOwnerName),
          treatment_deadline:       toDate(ci('deadline for action')),
          residual_description:     toStr(ci('residual risk description')),
          residual_likelihood:      toInt(ci('residual risk likelihood')),
          residual_impact:          toInt(ci('residual risk magnitude') ?? ci('residual risk impact')),
          following_steps:          toStr(ci('following steps description') ?? ci('following steps')),
          last_evaluation_date:     toDate(ci('last evaluation date')),
          comment:                  toStr(ci('comment')),
        };

        // A row counts as real content only if it has at least one meaningful
        // business field — not just an auto-generated row number / placeholder.
        const meaningful = [
          payload.description, payload.risk_owner, payload.threat,
          payload.risk_cause, payload.risk_analysis, payload.treatment_description,
          payload.risk_area,
        ];
        const hasContent = meaningful.some(v => v !== null && v !== '' && v !== undefined);
        if (!hasContent) continue;

        try {
          await apiClient.post('/risks/nca', payload);
          created++;
        } catch {
          errors.push(`Row ${headerRowIdx + i + 2}: failed to import`);
        }
      }

      setUploadResult({ created, errors });
      queryClient.invalidateQueries({ queryKey: ['nca-risk-entries'] });
    } catch {
      setUploadResult({ created: 0, errors: ['Failed to parse Excel file'] });
    } finally {
      setIsUploading(false);
    }
  };

  const exportToExcel = () => {
    const rows = entries.map(e => ({
      'Risk Identifier': e.risk_identifier,
      'Risk Area (Scope)': e.risk_area,
      'Risk Owner': e.risk_owner,
      'Date of Risk Identification': e.date_identified,
      'Description of the Risk': e.description,
      'Risk Cause': e.risk_cause,
      'Threat': e.threat,
      'Risk Analysis and Consequences': e.risk_analysis,
      'Date of Risk Analysis': e.date_analysis,
      'Inherent Risk Likelihood (1-5)': e.inherent_likelihood,
      'Inherent Risk Impact (1-5)': e.inherent_impact,
      'Overall Inherent Risk Rating': e.inherent_rating,
      'Updated Inherent Risk Rating (Override)': e.inherent_rating_override,
      'Type of Treatment Action': e.treatment_type,
      'Risk Treatment Description': e.treatment_description,
      'Owner of Treatment Action': e.treatment_owner,
      'Deadline for Action': e.treatment_deadline,
      'Residual Risk Description': e.residual_description,
      'Residual Risk Likelihood (1-5)': e.residual_likelihood,
      'Residual Risk Impact (1-5)': e.residual_impact,
      'Overall Residual Risk Rating': e.residual_rating,
      'Following Steps Description': e.following_steps,
      'Last Evaluation Date': e.last_evaluation_date,
      'Comment': e.comment,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Risk Register');
    XLSX.writeFile(wb, 'NCA_Risk_Register.xlsx');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Risks', value: summary.total, color: 'text-black' },
          { label: 'Critical', value: summary.critical, color: 'text-rose-700' },
          { label: 'High', value: summary.high, color: 'text-orange-700' },
          { label: 'Open Treatment', value: summary.open_treatment, color: 'text-blue-700' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Upload result banner */}
      {uploadResult && (
        <div className={`rounded-lg border px-4 py-3 text-sm flex items-start justify-between gap-3 ${uploadResult.errors.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50'}`}>
          <div>
            <p className={`font-medium ${uploadResult.errors.length > 0 ? 'text-amber-800' : 'text-green-800'}`}>
              Imported {uploadResult.created} {uploadResult.created === 1 ? 'risk' : 'risks'}
              {uploadResult.errors.length > 0 ? ` (${uploadResult.errors.length} errors)` : ' successfully'}
            </p>
            {uploadResult.errors.slice(0, 5).map((e, i) => <p key={i} className="text-xs text-amber-700 mt-0.5">{e}</p>)}
          </div>
          <button onClick={() => setUploadResult(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search risks..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileUpload}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          title="Upload NCA Cybersecurity Risk Register Excel file"
        >
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Upload Excel
        </button>
        <button onClick={exportToExcel} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
          <Download className="h-4 w-4" />
          Export XLSX
        </button>
        <button onClick={() => setModalEntry('new')} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          <Plus className="h-4 w-4" />
          Add Risk
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ShieldAlert className="h-12 w-12 text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-600">No risk entries yet</p>
            <p className="text-xs text-gray-400 mt-1">Click "Add Risk" to create your first NCA risk register entry</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 w-8"></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Risk ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Risk Area</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 max-w-xs">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Threat</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Inherent Rating</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Treatment</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Residual Rating</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Owner</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(entry => {
                  const expanded = expandedRows.has(entry.id);
                  return (
                    <>
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <button onClick={() => toggleRow(entry.id)} className="text-gray-400 hover:text-gray-600">
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                          <button
                            onClick={() => openInGeneralDetail(entry)}
                            className="text-blue-600 hover:underline"
                          >
                            {entry.risk_identifier}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{entry.risk_area || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 max-w-xs truncate cursor-pointer hover:text-blue-600" onClick={() => openInGeneralDetail(entry)}>{entry.description || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap max-w-[120px] truncate">{entry.threat || '—'}</td>
                        <td className="px-4 py-3"><RatingBadge rating={entry.inherent_rating} /></td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{entry.treatment_type || '—'}</td>
                        <td className="px-4 py-3"><RatingBadge rating={entry.residual_rating} /></td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{entry.risk_owner || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setGeneratingAI(entry.id); aiMut.mutate(entry.id); }}
                              disabled={generatingAI === entry.id}
                              className={`p-1.5 rounded-lg transition-colors ${entry.ai_recommendation ? 'text-purple-600 bg-purple-50' : 'text-gray-500 hover:text-purple-600 hover:bg-purple-50'} disabled:opacity-50`}
                              title="AI Recommendation"
                            >
                              {generatingAI === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                            </button>
                            <button onClick={() => openInGeneralDetail(entry)} className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50" title="Open detail page">
                              <ExternalLink className="h-3.5 w-3.5" />
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
                        <tr key={`${entry.id}-expanded`}>
                          <td colSpan={10} className="px-6 pb-4 bg-gray-50">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 text-xs text-gray-700">
                              {entry.risk_cause && <div><span className="font-semibold text-gray-500">Risk Cause:</span> {entry.risk_cause}</div>}
                              {entry.risk_analysis && <div><span className="font-semibold text-gray-500">Risk Analysis:</span> {entry.risk_analysis}</div>}
                              {entry.treatment_description && <div><span className="font-semibold text-gray-500">Treatment:</span> {entry.treatment_description}</div>}
                              {entry.residual_description && <div><span className="font-semibold text-gray-500">Residual Risk:</span> {entry.residual_description}</div>}
                              {entry.following_steps && <div><span className="font-semibold text-gray-500">Following Steps:</span> {entry.following_steps}</div>}
                              {entry.comment && <div><span className="font-semibold text-gray-500">Comment:</span> {entry.comment}</div>}
                              {entry.treatment_deadline && <div><span className="font-semibold text-gray-500">Treatment Deadline:</span> {entry.treatment_deadline}</div>}
                              {entry.last_evaluation_date && <div><span className="font-semibold text-gray-500">Last Evaluation:</span> {entry.last_evaluation_date}</div>}
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

      {/* Modals */}
      {(modalEntry === 'new' || (modalEntry && modalEntry !== 'new')) && (
        <EntryModal
          entry={modalEntry === 'new' ? null : modalEntry}
          onClose={() => setModalEntry(null)}
          onSave={d => {
            if (modalEntry === 'new') createMut.mutate(d);
            else updateMut.mutate({ id: (modalEntry as NcaRiskEntry).id, d });
          }}
          isSaving={createMut.isPending || updateMut.isPending}
          tenantUsers={tenantUsers}
          assets={assets}
        />
      )}

      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-black mb-2">Delete Risk Entry</h3>
            <p className="text-sm text-gray-600 mb-4">Are you sure? This cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => deleteMut.mutate(deleteConfirm!)} disabled={deleteMut.isPending} className="px-4 py-2 text-sm text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50">
                {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
