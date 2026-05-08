'use client';

import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient, { assetsApi, controlsApi } from '@/lib/api';
import {
  ArrowLeft, Edit2, Loader2, Sparkles, AlertCircle, Plus, Trash2,
  Save, X, CheckCircle, Layers, Shield, ListTodo, Calendar, User,
  ChevronDown, ChevronUp,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NcaRiskEntry {
  id: number;
  risk_identifier: string;
  risk_area: string | null;
  risk_owner: string | null;
  risk_owner_user_id: number | null;
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
  treatment_owner_user_id: number | null;
  treatment_deadline: string | null;
  residual_description: string | null;
  residual_likelihood: number | null;
  residual_impact: number | null;
  residual_rating: string | null;
  following_steps: string | null;
  last_evaluation_date: string | null;
  comment: string | null;
  linked_asset_ids: number[];
  linked_control_ids: number[];
  mitigation_actions: MitigationAction[];
  lifecycle_status: string;
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

// ─── Constants ────────────────────────────────────────────────────────────────

const LIFECYCLE_STATUSES = [
  { value: 'open',         label: 'Open',         color: 'bg-rose-100 text-rose-700' },
  { value: 'in_progress',  label: 'In Treatment', color: 'bg-amber-100 text-amber-700' },
  { value: 'mitigated',    label: 'Mitigated',    color: 'bg-green-100 text-green-700' },
  { value: 'accepted',     label: 'Accepted',     color: 'bg-blue-100 text-blue-700' },
  { value: 'closed',       label: 'Closed',       color: 'bg-gray-100 text-gray-600' },
];

const ACTION_STATUSES = [
  { value: 'open',         label: 'Open',         color: 'bg-rose-50 text-rose-700' },
  { value: 'in_progress',  label: 'In Progress',  color: 'bg-blue-50 text-blue-700' },
  { value: 'on_hold',      label: 'On Hold',      color: 'bg-amber-50 text-amber-700' },
  { value: 'completed',    label: 'Completed',    color: 'bg-green-50 text-green-700' },
];

const RATING_STYLES: Record<string, string> = {
  Critical:   'bg-rose-100 text-rose-700',
  High:       'bg-orange-100 text-orange-700',
  Medium:     'bg-amber-100 text-amber-700',
  Low:        'bg-green-100 text-green-700',
  'Very Low': 'bg-gray-100 text-gray-600',
};

function StatusPill({ value }: { value: string }) {
  const found = LIFECYCLE_STATUSES.find(s => s.value === value);
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${found?.color || 'bg-gray-100 text-gray-600'}`}>
      {found?.label || value}
    </span>
  );
}

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return <span className="text-xs text-gray-400">—</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${RATING_STYLES[rating] || 'bg-gray-100 text-gray-600'}`}>
      {rating}
    </span>
  );
}

function genId() {
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── AI Panel ─────────────────────────────────────────────────────────────────

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
      {Array.isArray(data.treatment_strategy) && data.treatment_strategy.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Treatment Strategy</p>
          <ul className="list-disc list-inside space-y-0.5">
            {data.treatment_strategy.map((s: string, i: number) => <li key={i} className="text-xs text-gray-700">{s}</li>)}
          </ul>
        </div>
      )}
      {Array.isArray(data.residual_mitigation) && data.residual_mitigation.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Residual Mitigation</p>
          <ul className="list-disc list-inside space-y-0.5">
            {data.residual_mitigation.map((s: string, i: number) => <li key={i} className="text-xs text-gray-700">{s}</li>)}
          </ul>
        </div>
      )}
      {Array.isArray(data.monitoring) && data.monitoring.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Monitoring</p>
          <ul className="list-disc list-inside space-y-0.5">
            {data.monitoring.map((s: string, i: number) => <li key={i} className="text-xs text-gray-700">{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Mitigation Action Row ───────────────────────────────────────────────────

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
          <button onClick={() => setEditing(true)} className="p-1.5 rounded text-gray-500 hover:text-blue-600 hover:bg-blue-50" title="Edit">
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded text-gray-500 hover:text-rose-600 hover:bg-rose-50" title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-blue-300 bg-blue-50/30 rounded-lg p-3 space-y-2">
      <input
        type="text"
        value={draft.title}
        onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
        placeholder="Action title…"
        className="w-full text-sm rounded-lg border border-gray-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <select
          value={draft.owner_user_id?.toString() || ''}
          onChange={e => setOwner(e.target.value)}
          className="text-xs rounded-lg border border-gray-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">— Owner —</option>
          {tenantUsers.map(u => <option key={u.id} value={u.id}>{u.display_name || u.email}</option>)}
        </select>
        <input
          type="date"
          value={draft.due_date || ''}
          onChange={e => setDraft(d => ({ ...d, due_date: e.target.value || null }))}
          className="text-xs rounded-lg border border-gray-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={draft.status}
          onChange={e => setDraft(d => ({ ...d, status: e.target.value as any }))}
          className="text-xs rounded-lg border border-gray-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {ACTION_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <textarea
        value={draft.notes || ''}
        onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
        placeholder="Notes (optional)"
        rows={2}
        className="w-full text-xs rounded-lg border border-gray-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
      />
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

// ─── Multi-select picker (assets / controls) ─────────────────────────────────

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
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full text-xs px-3 py-2 border-b border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="max-h-56 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-xs text-gray-400 italic p-3 text-center">{items.length === 0 ? emptyMessage : 'No matches'}</p>
              ) : filtered.map(item => (
                <label key={item.id} className="flex items-start gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggle(item.id)}
                    className="mt-0.5"
                  />
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

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function NcaRiskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = Number(params?.id);

  const { data: entry, isLoading, error } = useQuery<NcaRiskEntry>({
    queryKey: ['nca-risk-entry', id],
    queryFn: async () => (await apiClient.get(`/risks/nca/${id}`)).data,
    enabled: !!id,
  });

  const { data: tenantUsersData } = useQuery<TenantUser[]>({
    queryKey: ['tenant-users-for-nca-risk-detail'],
    queryFn: async () => (await assetsApi.getTenantUsers()).data,
  });
  const tenantUsers = tenantUsersData ?? [];

  const { data: assetsData } = useQuery<AssetLite[]>({
    queryKey: ['assets-for-nca-risk-detail'],
    queryFn: async () => {
      const r = await assetsApi.getAll();
      return (r.data as any[]).map(a => ({ id: a.id, name: a.name, asset_type: a.asset_type }));
    },
  });
  const assets = assetsData ?? [];

  const { data: controlsData } = useQuery<ControlLite[]>({
    queryKey: ['controls-for-nca-risk-detail'],
    queryFn: async () => {
      const r = await controlsApi.getAll();
      return (r.data as any[]).map(c => ({
        id: c.id,
        name: c.name || c.title,
        control_id: c.control_id || c.code,
        description: c.description,
      }));
    },
  });
  const controls = controlsData ?? [];

  const updateMut = useMutation({
    mutationFn: (patch: Partial<NcaRiskEntry>) => apiClient.put(`/risks/nca/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nca-risk-entry', id] }),
  });

  const aiMut = useMutation({
    mutationFn: () => apiClient.post(`/risks/nca/${id}/ai-recommendation`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nca-risk-entry', id] }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>;
  }
  if (error || !entry) {
    return (
      <div className="flex items-center gap-3 p-6 bg-rose-50 rounded-xl text-rose-700 text-sm">
        <AlertCircle className="h-5 w-5" /> Failed to load NCA risk entry.
      </div>
    );
  }

  const updateAssets = (ids: number[]) => updateMut.mutate({ linked_asset_ids: ids });
  const updateControls = (ids: number[]) => updateMut.mutate({ linked_control_ids: ids });

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
    const draft: MitigationAction = {
      id: `act-new-${Date.now()}`,
      title: '',
      owner: null,
      owner_user_id: null,
      due_date: null,
      status: 'open',
      notes: null,
    };
    upsertAction(draft);
  };

  return (
    <div className="space-y-4 px-3 sm:px-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button
          onClick={() => router.push('/erm/risks?view=nca')}
          className="text-sm text-gray-600 hover:text-blue-600 flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" /> Back to NCA Risk Register
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="text-xs font-mono text-gray-500">{entry.risk_identifier}</span>
              <select
                value={entry.lifecycle_status}
                onChange={e => updateMut.mutate({ lifecycle_status: e.target.value })}
                className="text-xs rounded-full border-0 px-2.5 py-1 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer bg-gray-100"
              >
                {LIFECYCLE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <StatusPill value={entry.lifecycle_status} />
            </div>
            <h1 className="text-lg font-semibold text-gray-900">{entry.description || '(no description)'}</h1>
            <p className="text-sm text-gray-500 mt-1">{entry.risk_area || 'No risk area set'} · Threat: {entry.threat || '—'}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => aiMut.mutate()}
              disabled={aiMut.isPending}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 disabled:opacity-50"
            >
              {aiMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {entry.ai_recommendation ? 'Regenerate AI' : 'Generate AI'}
            </button>
            <button
              onClick={() => router.push('/erm/risks?view=nca&edit=' + entry.id)}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              <Edit2 className="h-4 w-4" /> Edit Fields
            </button>
          </div>
        </div>

        {/* Risk score grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-100">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Inherent L × I</p>
            <p className="text-sm text-gray-800">{entry.inherent_likelihood ?? '—'} × {entry.inherent_impact ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Inherent Rating</p>
            <RatingBadge rating={entry.inherent_rating_override || entry.inherent_rating} />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Residual L × I</p>
            <p className="text-sm text-gray-800">{entry.residual_likelihood ?? '—'} × {entry.residual_impact ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Residual Rating</p>
            <RatingBadge rating={entry.residual_rating} />
          </div>
        </div>
      </div>

      {/* AI Recommendation */}
      {entry.ai_recommendation && (
        <AIPanel json={entry.ai_recommendation} generatedAt={entry.ai_recommendation_generated_at} />
      )}

      {/* NCA fields read-only display */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">NCA Template Fields</h3>
          <p className="text-xs text-gray-500 mt-0.5">Use the Edit Fields button above to modify any of these.</p>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {[
            ['Risk Identifier', entry.risk_identifier],
            ['Risk Area', entry.risk_area],
            ['Risk Owner', entry.risk_owner],
            ['Date Identified', entry.date_identified],
            ['Risk Cause', entry.risk_cause],
            ['Threat', entry.threat],
            ['Risk Analysis', entry.risk_analysis],
            ['Date of Analysis', entry.date_analysis],
            ['Treatment Type', entry.treatment_type],
            ['Treatment Description', entry.treatment_description],
            ['Treatment Owner', entry.treatment_owner],
            ['Deadline for Action', entry.treatment_deadline],
            ['Residual Description', entry.residual_description],
            ['Following Steps', entry.following_steps],
            ['Last Evaluation Date', entry.last_evaluation_date],
            ['Comment', entry.comment],
          ].map(([label, value]) => (
            <div key={label as string}>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">{label}</p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{value || <span className="text-gray-400 italic">—</span>}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Mitigation Actions */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-900">Mitigation Actions</h3>
            <span className="text-xs text-gray-500">({entry.mitigation_actions?.length || 0})</span>
          </div>
          <button
            onClick={addNewAction}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" /> Add Action
          </button>
        </div>
        <div className="p-4 space-y-2">
          {(entry.mitigation_actions || []).length === 0 ? (
            <p className="text-xs text-gray-400 italic text-center py-6">No mitigation actions yet. Add one to track remediation work.</p>
          ) : (
            (entry.mitigation_actions || []).map(action => (
              <ActionRow
                key={action.id}
                action={action}
                tenantUsers={tenantUsers}
                onSave={(a) => upsertAction({ ...a, id: a.id.startsWith('act-new-') ? genId() : a.id })}
                onDelete={() => deleteAction(action.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Linked Assets */}
      <LinkPicker
        title="Linked IT Assets"
        items={assets}
        selectedIds={entry.linked_asset_ids || []}
        onChange={updateAssets}
        getLabel={(a) => a.name}
        getSubtitle={(a) => a.asset_type || ''}
        icon={Layers}
        emptyMessage="No assets linked. Link IT assets to this risk for traceability."
      />

      {/* Linked Controls */}
      <LinkPicker
        title="Linked Controls"
        items={controls}
        selectedIds={entry.linked_control_ids || []}
        onChange={updateControls}
        getLabel={(c) => c.name || c.control_id || `Control ${c.id}`}
        getSubtitle={(c) => c.control_id || ''}
        icon={Shield}
        emptyMessage="No controls linked. Link the controls that mitigate this risk."
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
