'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import apiClient, { assetsApi } from '@/lib/api';
import { X, Save, Loader2, Search, Check } from 'lucide-react';

interface TenantUser { id: number; display_name: string; email: string; }
interface AssetLite { id: number; name: string; asset_type?: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (entryId: number, bridgedVulnerabilityId: number | null) => void;
}

const STATUS_OPTIONS = ['OPEN', 'IN PROGRESS', 'ON HOLD', 'RESOLVED'];

const LEVEL_STYLES: Record<string, string> = {
  Critical:   'bg-rose-100 text-rose-700',
  High:       'bg-orange-100 text-orange-700',
  Medium:     'bg-amber-100 text-amber-700',
  Low:        'bg-green-100 text-green-700',
  'Very Low': 'bg-gray-100 text-gray-600',
};

function calcLevel(l: string, s: string): string | null {
  const score = parseInt(l) * parseInt(s);
  if (!score) return null;
  if (score >= 20) return 'Critical';
  if (score >= 12) return 'High';
  if (score >= 6) return 'Medium';
  if (score >= 3) return 'Low';
  return 'Very Low';
}

const EMPTY_FORM = {
  title: '', description: '', vendor_link: '', cve_number: '', cve_score: '',
  affected_technology: '', threat_analysis: '',
  threat_severity: '', risk_likelihood: '', risk_severity: '',
  status: 'OPEN', first_observation_date: '',
  due_date: '', resolution_date: '', comments: '',
};

export default function NcaVulnQuickAddModal({ isOpen, onClose, onCreated }: Props) {
  const [form, setForm] = useState<Record<string, string>>({ ...EMPTY_FORM });
  const [ownerUserId, setOwnerUserId] = useState<number | null>(null);
  const [linkedAssetIds, setLinkedAssetIds] = useState<number[]>([]);
  const [assetSearch, setAssetSearch] = useState('');
  const [assetsExpanded, setAssetsExpanded] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const { data: tenantUsersData } = useQuery<TenantUser[]>({
    queryKey: ['tenant-users-for-nca-vuln-add'],
    queryFn: async () => (await assetsApi.getTenantUsers()).data,
    enabled: isOpen,
  });
  const tenantUsers = tenantUsersData ?? [];

  const { data: assetsData } = useQuery<AssetLite[]>({
    queryKey: ['assets-for-nca-vuln-add'],
    queryFn: async () => {
      const r = await assetsApi.getAll();
      return (r.data as any[]).map(a => ({ id: a.id, name: a.name, asset_type: a.asset_type }));
    },
    enabled: isOpen,
  });
  const assets = assetsData ?? [];

  const filteredAssets = useMemo(() => {
    if (!assetSearch) return assets;
    const q = assetSearch.toLowerCase();
    return assets.filter(a => a.name.toLowerCase().includes(q));
  }, [assets, assetSearch]);

  const selectedAssets = useMemo(
    () => assets.filter(a => linkedAssetIds.includes(a.id)),
    [assets, linkedAssetIds]
  );

  const riskLevel = calcLevel(form.risk_likelihood, form.risk_severity);

  const createMut = useMutation({
    mutationFn: async () => {
      const owner = ownerUserId ? tenantUsers.find(u => u.id === ownerUserId) : null;
      const payload: Record<string, any> = {
        ...form,
        owner: owner ? (owner.display_name || owner.email) : null,
        owner_user_id: ownerUserId,
        linked_asset_ids: linkedAssetIds,
      };
      // Coerce numerics + dates
      ['threat_severity', 'risk_likelihood', 'risk_severity'].forEach(k => {
        payload[k] = payload[k] ? parseInt(payload[k]) : null;
      });
      payload.cve_score = payload.cve_score ? parseFloat(payload.cve_score) : null;
      ['first_observation_date', 'due_date', 'resolution_date'].forEach(k => {
        payload[k] = payload[k] || null;
      });
      Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null; });

      const res = await apiClient.post('/vulnerabilities/nca', payload);
      return res.data as { id: number; bridged_vulnerability_id: number | null };
    },
    onSuccess: (data) => {
      onCreated(data.id, data.bridged_vulnerability_id ?? null);
      reset();
    },
  });

  const reset = () => {
    setForm({ ...EMPTY_FORM });
    setOwnerUserId(null);
    setLinkedAssetIds([]);
    setAssetSearch('');
    setAssetsExpanded(false);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-semibold text-black">Add NCA Vulnerability Entry</h2>
            <p className="text-xs text-gray-500 mt-0.5">All NCA template fields. Owner and Affected Assets use platform pickers.</p>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Identification */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Identification</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Field label="Title *">
                  <input type="text" value={form.title} onChange={e => set('title', e.target.value)} className={inputCls} placeholder="Vulnerability title" />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Vulnerability Description">
                  <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} className={textareaCls} placeholder="Describe the vulnerability..." />
                </Field>
              </div>
              <Field label="Vendor Link">
                <input type="text" value={form.vendor_link} onChange={e => set('vendor_link', e.target.value)} className={inputCls} placeholder="https://..." />
              </Field>
              <Field label="CVE Number">
                <input type="text" value={form.cve_number} onChange={e => set('cve_number', e.target.value)} className={inputCls} placeholder="CVE-2024-XXXXX" />
              </Field>
              <Field label="CVE Score (0-10)">
                <input type="number" min={0} max={10} step={0.1} value={form.cve_score} onChange={e => set('cve_score', e.target.value)} className={inputCls} placeholder="0.0" />
              </Field>
            </div>
          </div>

          {/* Impact Analysis */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Impact Analysis</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Affected Technology">
                <input type="text" value={form.affected_technology} onChange={e => set('affected_technology', e.target.value)} className={inputCls} placeholder="e.g. Apache 2.4" />
              </Field>
              <Field label="Affected Assets (link from platform)">
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
                  <div className="mt-2 border border-gray-200 rounded-lg">
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
              <div className="md:col-span-2">
                <Field label="Threat Analysis">
                  <textarea value={form.threat_analysis} onChange={e => set('threat_analysis', e.target.value)} rows={3} className={textareaCls} placeholder="Threat analysis details..." />
                </Field>
              </div>
              <Field label="Threat Severity (1-5)">
                <input type="number" min={1} max={5} value={form.threat_severity} onChange={e => set('threat_severity', e.target.value)} className={inputCls} placeholder="1-5" />
              </Field>
              <Field label="Risk Likelihood (1-5)">
                <input type="number" min={1} max={5} value={form.risk_likelihood} onChange={e => set('risk_likelihood', e.target.value)} className={inputCls} placeholder="1-5" />
              </Field>
              <Field label="Risk Severity (1-5)">
                <input type="number" min={1} max={5} value={form.risk_severity} onChange={e => set('risk_severity', e.target.value)} className={inputCls} placeholder="1-5" />
              </Field>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Calculated Risk Level</label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex items-center">
                  {riskLevel ? (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${LEVEL_STYLES[riskLevel] || 'bg-gray-100 text-gray-600'}`}>{riskLevel}</span>
                  ) : <span className="text-xs text-gray-400">Set Likelihood × Severity</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Management */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Management</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Owner (platform user)">
                <select
                  value={ownerUserId?.toString() || ''}
                  onChange={e => setOwnerUserId(e.target.value ? parseInt(e.target.value) : null)}
                  className={inputCls}
                >
                  <option value="">— Unassigned —</option>
                  {tenantUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="First Observation Date">
                <input type="date" value={form.first_observation_date} onChange={e => set('first_observation_date', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Due Date">
                <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Resolution Date">
                <input type="date" value={form.resolution_date} onChange={e => set('resolution_date', e.target.value)} className={inputCls} />
              </Field>
              <div className="md:col-span-2">
                <Field label="Comments">
                  <textarea value={form.comments} onChange={e => set('comments', e.target.value)} rows={2} className={textareaCls} placeholder="Additional comments..." />
                </Field>
              </div>
            </div>
          </div>

          {createMut.isError && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">
              Failed to create vulnerability entry. Try again.
            </p>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
          <button onClick={handleClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || !form.title.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Add Entry
          </button>
        </div>
      </div>
    </div>
  );
}
