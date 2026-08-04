'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import apiClient, { assetsApi } from '@/lib/api';
import { X, Save, Loader2, Search, Check } from 'lucide-react';

interface TenantUser { id: number; display_name: string; email: string; }
interface AssetLite { id: number; name: string; asset_type?: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (entryId: number, bridgedRiskId: number | null) => void;
  /** When set, the modal opens in EDIT mode and loads the NCA risk entry
   *  bridged to this general Risk id. On save, PUTs back to /risks/nca/{id}. */
  editBridgedRiskId?: number | null;
}

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

const RATING_STYLES: Record<string, string> = {
  Critical:   'bg-rose-100 text-rose-700',
  High:       'bg-orange-100 text-orange-700',
  Medium:     'bg-amber-100 text-amber-700',
  Low:        'bg-green-100 text-green-700',
  'Very Low': 'bg-gray-100 text-gray-600',
};

function calcRating(l: string, i: string): string | null {
  const score = parseInt(l) * parseInt(i);
  if (!score) return null;
  if (score >= 20) return 'Critical';
  if (score >= 12) return 'High';
  if (score >= 6) return 'Medium';
  if (score >= 3) return 'Low';
  return 'Very Low';
}

const EMPTY_FORM = {
  risk_area: '', date_identified: '', description: '', risk_cause: '',
  threat: '', risk_analysis: '', date_analysis: '',
  inherent_likelihood: '', inherent_impact: '', inherent_rating_override: '',
  treatment_type: '', treatment_description: '', treatment_deadline: '',
  residual_description: '', residual_likelihood: '', residual_impact: '',
  following_steps: '', last_evaluation_date: '', comment: '',
};

export default function NcaRiskQuickAddModal({ isOpen, onClose, onCreated, editBridgedRiskId }: Props) {
  const isEditMode = !!editBridgedRiskId;
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ ...EMPTY_FORM });
  const [riskOwnerUserId, setRiskOwnerUserId] = useState<number | null>(null);
  const [treatmentOwnerUserId, setTreatmentOwnerUserId] = useState<number | null>(null);
  const [linkedAssetIds, setLinkedAssetIds] = useState<number[]>([]);
  const [assetSearch, setAssetSearch] = useState('');
  const [assetsExpanded, setAssetsExpanded] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const { data: tenantUsersData } = useQuery<TenantUser[]>({
    queryKey: ['tenant-users-for-nca-risk-add'],
    queryFn: async () => (await assetsApi.getTenantUsers()).data,
    enabled: isOpen,
  });
  const tenantUsers = tenantUsersData ?? [];

  const { data: assetsData } = useQuery<AssetLite[]>({
    queryKey: ['assets-for-nca-risk-add'],
    queryFn: async () => {
      const r = await assetsApi.getAll();
      return (r.data as any[]).map(a => ({ id: a.id, name: a.name, asset_type: a.asset_type }));
    },
    enabled: isOpen,
  });
  const assets = assetsData ?? [];

  // Edit mode — fetch the source NCA risk entry by the bridged Risk id and
  // pre-fill the form. The bridge id comes from the row the user clicked Edit on.
  const { data: editingEntry, isLoading: loadingEntry } = useQuery({
    queryKey: ['nca-risk-by-bridged', editBridgedRiskId],
    queryFn: async () => (await apiClient.get(`/risks/nca/by-bridged-risk/${editBridgedRiskId}`)).data,
    enabled: isOpen && isEditMode && !!editBridgedRiskId,
  });

  useEffect(() => {
    if (!editingEntry) return;
    const e = editingEntry as any;
    setEditingEntryId(e.id);
    setForm({
      risk_area:                e.risk_area || '',
      date_identified:          e.date_identified ? String(e.date_identified).slice(0, 10) : '',
      description:              e.description || '',
      risk_cause:               e.risk_cause || '',
      threat:                   e.threat || '',
      risk_analysis:            e.risk_analysis || '',
      date_analysis:            e.date_analysis ? String(e.date_analysis).slice(0, 10) : '',
      inherent_likelihood:      e.inherent_likelihood?.toString() || '',
      inherent_impact:          e.inherent_impact?.toString() || '',
      inherent_rating_override: e.inherent_rating_override || '',
      treatment_type:           e.treatment_type || '',
      treatment_description:    e.treatment_description || '',
      treatment_deadline:       e.treatment_deadline ? String(e.treatment_deadline).slice(0, 10) : '',
      residual_description:     e.residual_description || '',
      residual_likelihood:      e.residual_likelihood?.toString() || '',
      residual_impact:          e.residual_impact?.toString() || '',
      following_steps:          e.following_steps || '',
      last_evaluation_date:     e.last_evaluation_date ? String(e.last_evaluation_date).slice(0, 10) : '',
      comment:                  e.comment || '',
    });
    setRiskOwnerUserId(e.risk_owner_user_id ?? null);
    setTreatmentOwnerUserId(e.treatment_owner_user_id ?? null);
    setLinkedAssetIds(Array.isArray(e.linked_asset_ids) ? e.linked_asset_ids : []);
  }, [editingEntry]);

  const filteredAssets = useMemo(() => {
    if (!assetSearch) return assets;
    const q = assetSearch.toLowerCase();
    return assets.filter(a => a.name.toLowerCase().includes(q));
  }, [assets, assetSearch]);

  const selectedAssets = useMemo(
    () => assets.filter(a => linkedAssetIds.includes(a.id)),
    [assets, linkedAssetIds]
  );

  const inherentRating = form.inherent_rating_override || calcRating(form.inherent_likelihood, form.inherent_impact);
  const residualRating = calcRating(form.residual_likelihood, form.residual_impact);

  const showAssetLinking = form.risk_area === 'IT assets';

  const createMut = useMutation({
    mutationFn: async () => {
      const riskOwner = riskOwnerUserId ? tenantUsers.find(u => u.id === riskOwnerUserId) : null;
      const treatmentOwner = treatmentOwnerUserId ? tenantUsers.find(u => u.id === treatmentOwnerUserId) : null;
      const payload: Record<string, any> = {
        ...form,
        risk_owner: riskOwner ? (riskOwner.display_name || riskOwner.email) : null,
        risk_owner_user_id: riskOwnerUserId,
        treatment_owner: treatmentOwner ? (treatmentOwner.display_name || treatmentOwner.email) : null,
        treatment_owner_user_id: treatmentOwnerUserId,
        linked_asset_ids: linkedAssetIds,
      };
      ['inherent_likelihood', 'inherent_impact', 'residual_likelihood', 'residual_impact'].forEach(k => {
        payload[k] = payload[k] ? parseInt(payload[k]) : null;
      });
      ['date_identified', 'date_analysis', 'treatment_deadline', 'last_evaluation_date'].forEach(k => {
        payload[k] = payload[k] || null;
      });
      Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null; });

      // Edit mode → PUT to update the existing NCA entry; the bridge resyncs
      // automatically server-side. Otherwise POST a new entry.
      if (isEditMode && editingEntryId) {
        const res = await apiClient.put(`/risks/nca/${editingEntryId}`, payload);
        return res.data as { id: number; bridged_risk_id: number | null };
      }
      const res = await apiClient.post('/risks/nca', payload);
      return res.data as { id: number; bridged_risk_id: number | null };
    },
    onSuccess: (data) => {
      onCreated(data.id, data.bridged_risk_id ?? null);
      reset();
    },
  });

  const reset = () => {
    setForm({ ...EMPTY_FORM });
    setRiskOwnerUserId(null);
    setTreatmentOwnerUserId(null);
    setLinkedAssetIds([]);
    setAssetSearch('');
    setAssetsExpanded(false);
    setEditingEntryId(null);
    createMut.reset();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  if (!isOpen) return null;

  const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500';
  const textareaCls = `${inputCls} resize-none`;

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );

  const RatingPill = ({ rating }: { rating: string | null }) => {
    if (!rating) return <span className="text-xs text-gray-400">—</span>;
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${RATING_STYLES[rating] || 'bg-gray-100 text-gray-600'}`}>{rating}</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-semibold text-black">{isEditMode ? 'Edit NCA Risk Entry' : 'Add NCA Risk Entry'}</h2>
            <p className="text-xs text-gray-500 mt-0.5">All NCA template fields. Owners and assets use platform pickers.</p>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Risk Identification */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Risk Identification</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Risk Area (Scope)">
                <select value={form.risk_area} onChange={e => set('risk_area', e.target.value)} className={inputCls}>
                  <option value="">— Select scope —</option>
                  {RISK_AREAS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Risk Owner (platform user)">
                <select
                  value={riskOwnerUserId?.toString() || ''}
                  onChange={e => setRiskOwnerUserId(e.target.value ? parseInt(e.target.value) : null)}
                  className={inputCls}
                >
                  <option value="">— Unassigned —</option>
                  {tenantUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
                  ))}
                </select>
              </Field>
              <Field label="Date of Risk Identification">
                <input type="date" value={form.date_identified} onChange={e => set('date_identified', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Threat">
                <select value={form.threat} onChange={e => set('threat', e.target.value)} className={inputCls}>
                  <option value="">— Select threat —</option>
                  {THREATS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Description of the Risk">
                  <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} className={textareaCls} placeholder="Describe the risk..." />
                </Field>
              </div>
              <Field label="Risk Cause">
                <textarea value={form.risk_cause} onChange={e => set('risk_cause', e.target.value)} rows={2} className={textareaCls} placeholder="Root cause..." />
              </Field>
              <Field label="Date of Risk Analysis">
                <input type="date" value={form.date_analysis} onChange={e => set('date_analysis', e.target.value)} className={inputCls} />
              </Field>
              <div className="md:col-span-2">
                <Field label="Risk Analysis and Consequences">
                  <textarea value={form.risk_analysis} onChange={e => set('risk_analysis', e.target.value)} rows={3} className={textareaCls} placeholder="Analysis and consequences..." />
                </Field>
              </div>
            </div>

            {showAssetLinking && (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
                <Field label="Linked IT Assets (platform)">
                  <button
                    type="button"
                    onClick={() => setAssetsExpanded(e => !e)}
                    className={`${inputCls} text-left flex items-center justify-between`}
                  >
                    <span className="text-gray-700">{selectedAssets.length === 0 ? 'No assets linked' : `${selectedAssets.length} asset${selectedAssets.length === 1 ? '' : 's'} linked`}</span>
                    <span className="text-xs text-blue-600">{assetsExpanded ? 'Done' : 'Pick'}</span>
                  </button>
                  {selectedAssets.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {selectedAssets.map(a => (
                        <span key={a.id} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-700 text-xs rounded-full pl-2 pr-1 py-0.5">
                          {a.name}
                          <button type="button" onClick={() => setLinkedAssetIds(ids => ids.filter(x => x !== a.id))} className="hover:bg-blue-100 rounded-full p-0.5">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {assetsExpanded && (
                    <div className="mt-2 border border-gray-200 rounded-lg bg-white">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <input
                          type="text" value={assetSearch} onChange={e => setAssetSearch(e.target.value)}
                          placeholder="Search assets..."
                          className="w-full pl-8 pr-3 py-1.5 border-b border-gray-200 text-xs focus:outline-none"
                        />
                      </div>
                      <div className="max-h-44 overflow-y-auto">
                        {filteredAssets.length === 0 ? (
                          <p className="text-xs text-gray-400 p-2 text-center">{assets.length === 0 ? 'No assets in tenant' : 'No matches'}</p>
                        ) : filteredAssets.map(a => (
                          <label key={a.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              checked={linkedAssetIds.includes(a.id)}
                              onChange={(e) => {
                                setLinkedAssetIds(prev =>
                                  e.target.checked ? [...prev, a.id] : prev.filter(id => id !== a.id)
                                );
                              }}
                            />
                            <span className="text-gray-800 flex-1">{a.name}</span>
                            {a.asset_type && <span className="text-gray-400">({a.asset_type})</span>}
                            {linkedAssetIds.includes(a.id) && <Check className="h-3 w-3 text-blue-600" />}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </Field>
              </div>
            )}
          </div>

          {/* Inherent Risk Assessment */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Inherent Risk Assessment</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Likelihood (1-5)">
                <input type="number" min={1} max={5} value={form.inherent_likelihood} onChange={e => set('inherent_likelihood', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Impact (1-5)">
                <input type="number" min={1} max={5} value={form.inherent_impact} onChange={e => set('inherent_impact', e.target.value)} className={inputCls} />
              </Field>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Calculated Rating</label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex items-center">
                  <RatingPill rating={inherentRating} />
                </div>
              </div>
              <Field label="Override Rating (manual)">
                <select value={form.inherent_rating_override} onChange={e => set('inherent_rating_override', e.target.value)} className={inputCls}>
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
                <select value={form.treatment_type} onChange={e => set('treatment_type', e.target.value)} className={inputCls}>
                  <option value="">— Select treatment —</option>
                  {TREATMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Treatment Owner (platform user)">
                <select
                  value={treatmentOwnerUserId?.toString() || ''}
                  onChange={e => setTreatmentOwnerUserId(e.target.value ? parseInt(e.target.value) : null)}
                  className={inputCls}
                >
                  <option value="">— Unassigned —</option>
                  {tenantUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
                  ))}
                </select>
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
                <input type="number" min={1} max={5} value={form.residual_likelihood} onChange={e => set('residual_likelihood', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Residual Impact (1-5)">
                <input type="number" min={1} max={5} value={form.residual_impact} onChange={e => set('residual_impact', e.target.value)} className={inputCls} />
              </Field>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Residual Rating</label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex items-center">
                  <RatingPill rating={residualRating} />
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

          {createMut.isError && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">
              Failed to create risk entry. Try again.
            </p>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
          <button onClick={handleClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || loadingEntry || !form.description.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isEditMode ? 'Save Changes' : 'Add Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
