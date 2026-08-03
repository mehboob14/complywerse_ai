'use client';

import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient, { assetsApi, controlsApi } from '@/lib/api';
import {
  ArrowLeft, Edit2, Loader2, Sparkles, AlertCircle, Plus, Trash2,
  X, CheckCircle, Layers, Shield, ListTodo, Calendar, User, ExternalLink,
  ChevronDown, ChevronUp, Bug,
} from 'lucide-react';

interface NcaVulnEntry {
  id: number;
  vuln_identifier: string;
  title: string | null;
  description: string | null;
  vendor_link: string | null;
  cve_number: string | null;
  cve_score: number | null;
  affected_technology: string | null;
  affected_assets: string | null;
  threat_analysis: string | null;
  threat_severity: number | null;
  risk_likelihood: number | null;
  risk_severity: number | null;
  risk_level: string | null;
  owner: string | null;
  owner_user_id: number | null;
  status: string;
  first_observation_date: string | null;
  due_date: string | null;
  resolution_date: string | null;
  comments: string | null;
  linked_asset_ids: number[];
  linked_control_ids: number[];
  mitigation_actions: MitigationAction[];
  ai_recommendation: string | null;
  ai_recommendation_generated_at: string | null;
}

interface MitigationAction {
  id: string;
  title: string;
  owner: string | null;
  owner_user_id: number | null;
  due_date: string | null;
  status: 'open' | 'in_progress' | 'completed' | 'on_hold';
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

interface TenantUser { id: number; display_name: string; email: string; }
interface AssetLite { id: number; name: string; asset_type?: string; }
interface ControlLite { id: number; name?: string; control_id?: string; description?: string; }

const STATUSES = [
  { value: 'OPEN',         label: 'Open',         color: 'bg-rose-100 text-rose-700' },
  { value: 'IN PROGRESS',  label: 'In Progress',  color: 'bg-blue-100 text-blue-700' },
  { value: 'ON HOLD',      label: 'On Hold',      color: 'bg-amber-100 text-amber-700' },
  { value: 'RESOLVED',     label: 'Resolved',     color: 'bg-green-100 text-green-700' },
];

const ACTION_STATUSES = [
  { value: 'open',         label: 'Open',         color: 'bg-rose-50 text-rose-700' },
  { value: 'in_progress',  label: 'In Progress',  color: 'bg-blue-50 text-blue-700' },
  { value: 'on_hold',      label: 'On Hold',      color: 'bg-amber-50 text-amber-700' },
  { value: 'completed',    label: 'Completed',    color: 'bg-green-50 text-green-700' },
];

const LEVEL_STYLES: Record<string, string> = {
  Critical:   'bg-rose-100 text-rose-700',
  High:       'bg-orange-100 text-orange-700',
  Medium:     'bg-amber-100 text-amber-700',
  Low:        'bg-green-100 text-green-700',
  'Very Low': 'bg-gray-100 text-gray-600',
};

function LevelBadge({ level }: { level: string | null }) {
  if (!level) return <span className="text-xs text-gray-400">—</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${LEVEL_STYLES[level] || 'bg-gray-100 text-gray-600'}`}>
      {level}
    </span>
  );
}

function genId() {
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function AIPanel({ json, generatedAt }: { json: string; generatedAt: string | null }) {
  let data: any = {};
  try { data = JSON.parse(json); } catch { data = { summary: json }; }
  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-purple-600" />
        <span className="text-sm font-semibold text-purple-700">AI Recommendation</span>
        {generatedAt && <span className="text-xs text-gray-500">{new Date(generatedAt).toLocaleString()}</span>}
      </div>
      {data.summary && <p className="text-sm text-gray-700">{data.summary}</p>}
      {Array.isArray(data.remediation_steps) && data.remediation_steps.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Remediation Steps</p>
          <ol className="list-decimal list-inside space-y-0.5">
            {data.remediation_steps.map((s: string, i: number) => <li key={i} className="text-xs text-gray-700">{s}</li>)}
          </ol>
        </div>
      )}
      {data.patching_guidance && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Patching Guidance</p>
          <p className="text-xs text-gray-700">{data.patching_guidance}</p>
        </div>
      )}
      {Array.isArray(data.compensating_controls) && data.compensating_controls.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Compensating Controls</p>
          <ul className="list-disc list-inside space-y-0.5">
            {data.compensating_controls.map((s: string, i: number) => <li key={i} className="text-xs text-gray-700">{s}</li>)}
          </ul>
        </div>
      )}
      {Array.isArray(data.verification_steps) && data.verification_steps.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Verification Steps</p>
          <ul className="list-disc list-inside space-y-0.5">
            {data.verification_steps.map((s: string, i: number) => <li key={i} className="text-xs text-gray-700">{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActionRow({
  action, tenantUsers, onSave, onDelete,
}: {
  action: MitigationAction;
  tenantUsers: TenantUser[];
  onSave: (a: MitigationAction) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(action.id.startsWith('act-new-'));
  const [draft, setDraft] = useState<MitigationAction>(action);
  const statusStyle = ACTION_STATUSES.find(s => s.value === draft.status)?.color || 'bg-gray-100 text-gray-600';

  const setOwner = (userId: string) => {
    const id = userId ? parseInt(userId) : null;
    const u = id ? tenantUsers.find(t => t.id === id) : null;
    setDraft(d => ({ ...d, owner_user_id: id, owner: u ? (u.display_name || u.email) : d.owner }));
  };

  if (!editing) {
    return (
      <div className="border border-gray-200 rounded-lg p-3 flex items-start gap-3 hover:bg-gray-50">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusStyle}`}>
              {ACTION_STATUSES.find(s => s.value === draft.status)?.label || draft.status}
            </span>
            <p className="text-sm font-medium text-gray-900 truncate">{draft.title || '(untitled)'}</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
            {draft.owner && <span className="flex items-center gap-1"><User className="h-3 w-3" />{draft.owner}</span>}
            {draft.due_date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{draft.due_date}</span>}
          </div>
          {draft.notes && <p className="text-xs text-gray-600 mt-1.5">{draft.notes}</p>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setEditing(true)} className="p-1.5 rounded text-gray-500 hover:text-blue-600 hover:bg-blue-50">
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded text-gray-500 hover:text-rose-600 hover:bg-rose-50">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-blue-300 bg-blue-50/30 rounded-lg p-3 space-y-2">
      <input
        type="text" value={draft.title}
        onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
        placeholder="Action title…"
        className="w-full text-sm rounded-lg border border-gray-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <select value={draft.owner_user_id?.toString() || ''} onChange={e => setOwner(e.target.value)}
          className="text-xs rounded-lg border border-gray-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">— Owner —</option>
          {tenantUsers.map(u => <option key={u.id} value={u.id}>{u.display_name || u.email}</option>)}
        </select>
        <input type="date" value={draft.due_date || ''}
          onChange={e => setDraft(d => ({ ...d, due_date: e.target.value || null }))}
          className="text-xs rounded-lg border border-gray-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as any }))}
          className="text-xs rounded-lg border border-gray-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
          {ACTION_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <textarea value={draft.notes || ''} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
        placeholder="Notes (optional)" rows={2}
        className="w-full text-xs rounded-lg border border-gray-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      <div className="flex justify-end gap-2">
        <button onClick={() => { setDraft(action); setEditing(false); }} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">
          Cancel
        </button>
        <button
          onClick={() => { onSave({ ...draft, updated_at: new Date().toISOString() }); setEditing(false); }}
          disabled={!draft.title.trim()}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function LinkPicker<T extends { id: number }>({
  title, items, selectedIds, onChange, getLabel, getSubtitle, icon: Icon, emptyMessage,
}: {
  title: string;
  items: T[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  getLabel: (item: T) => string;
  getSubtitle?: (item: T) => string;
  icon: typeof Layers;
  emptyMessage: string;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const selected = useMemo(() => items.filter(i => selectedIds.includes(i.id)), [items, selectedIds]);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter(i => !q || getLabel(i).toLowerCase().includes(q));
  }, [items, search, getLabel]);

  const toggle = (id: number) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <span className="text-xs text-gray-500">({selected.length})</span>
        </div>
        <button onClick={() => setExpanded(e => !e)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
          {expanded ? 'Done' : 'Manage'}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>
      <div className="p-4">
        {selected.length === 0 && !expanded ? (
          <p className="text-xs text-gray-400 italic">{emptyMessage}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selected.map(s => (
              <span key={s.id} className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 text-xs rounded-full pl-2.5 pr-1 py-1">
                {getLabel(s)}
                <button onClick={() => toggle(s.id)} className="hover:bg-blue-100 rounded-full p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {expanded && (
          <div className="mt-3 border border-gray-200 rounded-lg">
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full text-xs px-3 py-2 border-b border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <div className="max-h-56 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-xs text-gray-400 italic p-3 text-center">{items.length === 0 ? emptyMessage : 'No matches'}</p>
              ) : filtered.map(item => (
                <label key={item.id} className="flex items-start gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-xs">
                  <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} className="mt-0.5" />
                  <span className="flex-1">
                    <span className="text-gray-800">{getLabel(item)}</span>
                    {getSubtitle && <span className="text-gray-400 ml-1">— {getSubtitle(item)}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function NcaVulnDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = Number(params?.id);

  const { data: entry, isLoading, error } = useQuery<NcaVulnEntry>({
    queryKey: ['nca-vuln-entry', id],
    queryFn: async () => (await apiClient.get(`/vulnerabilities/nca/${id}`)).data,
    enabled: !!id,
  });

  const { data: tenantUsersData } = useQuery<TenantUser[]>({
    queryKey: ['tenant-users-for-nca-vuln-detail'],
    queryFn: async () => (await assetsApi.getTenantUsers()).data,
  });
  const tenantUsers = tenantUsersData ?? [];

  const { data: assetsData } = useQuery<AssetLite[]>({
    queryKey: ['assets-for-nca-vuln-detail'],
    queryFn: async () => {
      const r = await assetsApi.getAll();
      return (r.data as any[]).map(a => ({ id: a.id, name: a.name, asset_type: a.asset_type }));
    },
  });
  const assets = assetsData ?? [];

  const { data: controlsData } = useQuery<ControlLite[]>({
    queryKey: ['controls-for-nca-vuln-detail'],
    queryFn: async () => {
      const r = await controlsApi.getAll();
      return (r.data as any[]).map(c => ({
        id: c.id, name: c.name || c.title, control_id: c.control_id || c.code, description: c.description,
      }));
    },
  });
  const controls = controlsData ?? [];

  const updateMut = useMutation({
    mutationFn: (patch: Partial<NcaVulnEntry>) => apiClient.put(`/vulnerabilities/nca/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nca-vuln-entry', id] }),
  });

  const aiMut = useMutation({
    mutationFn: () => apiClient.post(`/vulnerabilities/nca/${id}/ai-recommendation`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nca-vuln-entry', id] }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>;
  }
  if (error || !entry) {
    return (
      <div className="flex items-center gap-3 p-6 bg-rose-50 rounded-xl text-rose-700 text-sm">
        <AlertCircle className="h-5 w-5" /> Failed to load NCA vulnerability entry.
      </div>
    );
  }

  const upsertAction = (action: MitigationAction) => {
    const list = entry.mitigation_actions || [];
    const idx = list.findIndex(a => a.id === action.id);
    let next: MitigationAction[];
    if (idx >= 0) {
      next = [...list];
      next[idx] = action;
    } else {
      next = [...list, { ...action, created_at: new Date().toISOString() }];
    }
    updateMut.mutate({ mitigation_actions: next });
  };

  const deleteAction = (actionId: string) => {
    const next = (entry.mitigation_actions || []).filter(a => a.id !== actionId);
    updateMut.mutate({ mitigation_actions: next });
  };

  const addNewAction = () => {
    upsertAction({
      id: `act-new-${Date.now()}`,
      title: '', owner: null, owner_user_id: null,
      due_date: null, status: 'open', notes: null,
    });
  };

  return (
    <div className="space-y-4 px-3 sm:px-6 max-w-7xl mx-auto pb-12">
      <button
        onClick={() => router.push('/vulnerabilities?view=nca')}
        className="text-sm text-gray-600 hover:text-blue-600 flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" /> Back to NCA Vulnerability Register
      </button>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="text-xs font-mono text-gray-500">{entry.vuln_identifier}</span>
              <select
                value={entry.status}
                onChange={e => updateMut.mutate({ status: e.target.value })}
                className="text-xs rounded-full border-0 px-2.5 py-1 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer bg-gray-100"
              >
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUSES.find(s => s.value === entry.status)?.color || 'bg-gray-100 text-gray-600'}`}>
                {STATUSES.find(s => s.value === entry.status)?.label || entry.status}
              </span>
            </div>
            <h1 className="text-lg font-semibold text-gray-900">{entry.title || '(no title)'}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {entry.cve_number && <span className="mr-3">CVE: <span className="font-mono">{entry.cve_number}</span></span>}
              {entry.cve_score && <span className="mr-3">Score: <span className="font-mono">{entry.cve_score}</span></span>}
              {entry.affected_technology && <span>Technology: {entry.affected_technology}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => aiMut.mutate()} disabled={aiMut.isPending}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 disabled:opacity-50">
              {aiMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {entry.ai_recommendation ? 'Regenerate AI' : 'Generate AI'}
            </button>
            <button onClick={() => router.push('/vulnerabilities?view=nca&edit=' + entry.id)}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
              <Edit2 className="h-4 w-4" /> Edit Fields
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-100">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Threat Severity</p>
            <p className="text-sm text-gray-800">{entry.threat_severity ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Likelihood × Severity</p>
            <p className="text-sm text-gray-800">{entry.risk_likelihood ?? '—'} × {entry.risk_severity ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Risk Level</p>
            <LevelBadge level={entry.risk_level} />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Due Date</p>
            <p className="text-sm text-gray-800">{entry.due_date || '—'}</p>
          </div>
        </div>
      </div>

      {entry.ai_recommendation && (
        <AIPanel json={entry.ai_recommendation} generatedAt={entry.ai_recommendation_generated_at} />
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex items-center gap-2">
          <Bug className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-900">NCA Template Fields</h3>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {[
            ['Vulnerability ID', entry.vuln_identifier],
            ['Title', entry.title],
            ['Description', entry.description],
            ['CVE Number', entry.cve_number],
            ['CVE Score', entry.cve_score?.toString()],
            ['Affected Technology', entry.affected_technology],
            ['Affected Assets', entry.affected_assets],
            ['Threat Analysis', entry.threat_analysis],
            ['Owner', entry.owner],
            ['First Observed', entry.first_observation_date],
            ['Resolved On', entry.resolution_date],
            ['Comments', entry.comments],
          ].map(([label, value]) => (
            <div key={label as string}>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">{label}</p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{value || <span className="text-gray-400 italic">—</span>}</p>
            </div>
          ))}
          {entry.vendor_link && (
            <div className="md:col-span-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Vendor Link</p>
              <a href={entry.vendor_link} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline flex items-center gap-1 break-all">
                {entry.vendor_link} <ExternalLink className="h-3 w-3 flex-shrink-0" />
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-900">Mitigation Actions</h3>
            <span className="text-xs text-gray-500">({entry.mitigation_actions?.length || 0})</span>
          </div>
          <button onClick={addNewAction}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1">
            <Plus className="h-3.5 w-3.5" /> Add Action
          </button>
        </div>
        <div className="p-4 space-y-2">
          {(entry.mitigation_actions || []).length === 0 ? (
            <p className="text-xs text-gray-400 italic text-center py-6">No mitigation actions yet. Add one to track remediation work.</p>
          ) : (
            (entry.mitigation_actions || []).map(action => (
              <ActionRow key={action.id} action={action} tenantUsers={tenantUsers}
                onSave={(a) => upsertAction({ ...a, id: a.id.startsWith('act-new-') ? genId() : a.id })}
                onDelete={() => deleteAction(action.id)} />
            ))
          )}
        </div>
      </div>

      <LinkPicker
        title="Linked IT Assets"
        items={assets}
        selectedIds={entry.linked_asset_ids || []}
        onChange={(ids) => updateMut.mutate({ linked_asset_ids: ids })}
        getLabel={(a) => a.name}
        getSubtitle={(a) => a.asset_type || ''}
        icon={Layers}
        emptyMessage="No assets linked. Link the assets affected by this vulnerability."
      />

      <LinkPicker
        title="Linked Controls"
        items={controls}
        selectedIds={entry.linked_control_ids || []}
        onChange={(ids) => updateMut.mutate({ linked_control_ids: ids })}
        getLabel={(c) => c.name || c.control_id || `Control ${c.id}`}
        getSubtitle={(c) => c.control_id || ''}
        icon={Shield}
        emptyMessage="No controls linked. Link the controls that mitigate this vulnerability."
      />

      {updateMut.isPending && (
        <div className="fixed bottom-4 right-4 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-lg flex items-center gap-2 text-xs text-gray-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
        </div>
      )}
      {updateMut.isSuccess && !updateMut.isPending && (
        <div className="fixed bottom-4 right-4 bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2 shadow-lg flex items-center gap-2 text-xs">
          <CheckCircle className="h-3.5 w-3.5" /> Saved
        </div>
      )}
    </div>
  );
}
