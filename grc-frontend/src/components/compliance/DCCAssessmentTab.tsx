'use client';

import { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import apiClient from '@/lib/api';
import {
  Shield,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Search,
  Download,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  Minus,
  User,
  Calendar,
  AlertCircle,
  Loader2,
  FileSpreadsheet,
  Info,
  X,
  Paperclip,
  Upload,
  Plus,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DCCItem {
  id: number;
  assessment_id: number;
  item_number: string;
  area_domain: string | null;
  subdomain_name: string | null;
  control_type: string | null;
  control_description: string | null;
  compliance_status: string;
  status_label: string;
  gaps_identified: string | null;
  proposed_solution: string | null;
  responsible_party: string | null;
  timeline: string | null;
  priority: string | null;
  remarks: string | null;
  ai_evidence_recommendation: string | null;
  ai_recommendation_generated_at: string | null;
  control_source: string | null;
}

interface DCCDomain {
  name: string;
  items: DCCItem[];
}

interface DCCData {
  initialized: boolean;
  summary: {
    total: number;
    complied: number;
    partially_complied: number;
    not_complied: number;
    na: number;
    in_progress: number;
  };
  domains: DCCDomain[];
}

interface TenantUser {
  id: number;
  label: string;
  email: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'complied',           label: 'Fully Implemented',    color: 'emerald' },
  { value: 'partially_complied', label: 'Partially Implemented', color: 'amber'   },
  { value: 'not_complied',       label: 'Not Implemented',      color: 'rose'    },
  { value: 'na',                 label: 'Not Applicable',       color: 'gray'    },
  { value: 'in_progress',        label: 'In Progress',          color: 'blue'    },
];

const PRIORITY_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'high',     label: 'High'     },
  { value: 'medium',   label: 'Medium'   },
  { value: 'low',      label: 'Low'      },
];

const STATUS_STYLE: Record<string, { bg: string; text: string; icon: typeof CheckCircle }> = {
  complied:           { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircle  },
  partially_complied: { bg: 'bg-amber-50',   text: 'text-amber-700',   icon: AlertTriangle},
  not_complied:       { bg: 'bg-rose-50',    text: 'text-rose-700',    icon: XCircle      },
  na:                 { bg: 'bg-gray-100',   text: 'text-gray-600',    icon: Minus        },
  in_progress:        { bg: 'bg-blue-50',    text: 'text-blue-700',    icon: Clock        },
};

const PRIORITY_STYLE: Record<string, string> = {
  critical: 'bg-rose-100 text-rose-700',
  high:     'bg-orange-100 text-orange-700',
  medium:   'bg-amber-100 text-amber-700',
  low:      'bg-gray-100 text-gray-600',
};

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ summary }: { summary: DCCData['summary'] }) {
  const { total, complied, partially_complied, not_complied, na, in_progress } = summary;
  if (total === 0) return null;

  const pct = (n: number) => Math.round((n / total) * 100);
  const segments = [
    { key: 'complied',           pct: pct(complied),            color: 'bg-emerald-500', label: 'Fully Implemented' },
    { key: 'partially_complied', pct: pct(partially_complied),  color: 'bg-amber-400',   label: 'Partially Implemented' },
    { key: 'not_complied',       pct: pct(not_complied),        color: 'bg-rose-500',    label: 'Not Implemented' },
    { key: 'na',                 pct: pct(na),                  color: 'bg-gray-300',    label: 'Not Applicable' },
    { key: 'in_progress',        pct: pct(in_progress),         color: 'bg-blue-400',    label: 'In Progress' },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-800">Compliance Progress</h3>
        <span className="text-xs text-gray-500">{total} controls total</span>
      </div>
      <div className="flex rounded-full overflow-hidden h-3 mb-4 bg-gray-100">
        {segments.map((s) =>
          s.pct > 0 ? (
            <div key={s.key} className={`${s.color} transition-all`} style={{ width: `${s.pct}%` }} title={`${s.label}: ${s.pct}%`} />
          ) : null
        )}
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {segments.map((s) => (
          <div key={s.key} className="text-center">
            <p className="text-lg font-bold text-gray-900">{summary[s.key as keyof typeof summary]}</p>
            <p className="text-xs text-gray-500 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── AI Recommendation Panel ──────────────────────────────────────────────────

function AIPanel({ raw }: { raw: string | null }) {
  if (!raw) return null;
  let parsed: { recommendations?: Array<{ evidence_type: string; description: string; priority: string; example_files?: string[] }>; summary?: string } | null = null;
  try { parsed = JSON.parse(raw); } catch { return <p className="text-xs text-gray-600 whitespace-pre-wrap">{raw}</p>; }

  return (
    <div className="mt-2 p-3 bg-violet-50 rounded-lg border border-violet-100 text-xs space-y-2">
      {parsed?.summary && <p className="text-violet-800 font-medium">{parsed.summary}</p>}
      {(parsed?.recommendations ?? []).map((rec, i) => (
        <div key={i} className="flex gap-2">
          <span className={`mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${
            rec.priority === 'high' ? 'bg-rose-100 text-rose-700' :
            rec.priority === 'medium' ? 'bg-amber-100 text-amber-700' :
            'bg-gray-100 text-gray-600'}`}>
            {rec.priority}
          </span>
          <div>
            <p className="font-medium text-violet-800">{rec.evidence_type}</p>
            <p className="text-violet-700">{rec.description}</p>
            {rec.example_files?.length ? (
              <p className="text-violet-500 mt-0.5">e.g. {rec.example_files.join(', ')}</p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function DCCRow({
  item,
  assessmentId,
  tenantUsers,
  onUpdated,
}: {
  item: DCCItem;
  assessmentId: number;
  tenantUsers: TenantUser[];
  onUpdated: (updated: Partial<DCCItem>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const updateField = useCallback(
    async (field: string, value: string | null) => {
      onUpdated({ [field]: value });
      try {
        await apiClient.put(`/compliance/assessments/items/${item.id}`, { [field]: value });
      } catch {
        onUpdated({ [field]: (item as Record<string, unknown>)[field] as string | null });
      }
    },
    [item, onUpdated]
  );

  const generateAI = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await apiClient.post(
        `/compliance/assessments/${assessmentId}/items/${item.id}/ai-recommendation`
      );
      onUpdated({ ai_evidence_recommendation: JSON.stringify(res.data) });
      setExpanded(true);
    } catch {
      setAiError('AI recommendation failed. Please try again.');
      setTimeout(() => setAiError(null), 4000);
    } finally {
      setAiLoading(false);
    }
  };

  // Evidence — load lazily when the popup opens; upload via the shared endpoint.
  const evUpload = useRef<HTMLInputElement>(null);
  const [evUploading, setEvUploading] = useState(false);
  const { data: evidence = [], refetch: refetchEv } = useQuery<Array<Record<string, unknown>>>({
    queryKey: ['dcc-evidence', item.id],
    queryFn: async () => {
      const res = await apiClient.get(`/compliance/assessments/${assessmentId}/items/${item.id}/evidence`);
      const list = res.data?.evidence || res.data || [];
      return Array.isArray(list) ? list : [];
    },
    enabled: expanded,
    staleTime: 15_000,
  });
  const onEvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEvUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', file.name.replace(/\.[^.]+$/, ''));
      await apiClient.post(`/compliance/assessments/${assessmentId}/items/${item.id}/evidence/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await refetchEv();
    } catch {
      setAiError('Evidence upload failed.');
      setTimeout(() => setAiError(null), 4000);
    } finally {
      setEvUploading(false);
      if (evUpload.current) evUpload.current.value = '';
    }
  };

  const style = STATUS_STYLE[item.compliance_status] || STATUS_STYLE.in_progress;
  const StatusIcon = style.icon;

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors group">
        {/* Ref */}
        <td className="px-3 py-2.5 w-20 shrink-0">
          <span className="text-xs font-mono font-medium text-gray-700">{item.item_number}</span>
          {item.control_type === 'basic' ? (
            <span className="ml-1.5 text-[10px] px-1 py-0.5 bg-blue-50 text-blue-600 rounded">Basic</span>
          ) : (
            <span className="ml-1.5 text-[10px] px-1 py-0.5 bg-gray-100 text-gray-500 rounded">Sub</span>
          )}
        </td>

        {/* Subdomain */}
        <td className="px-3 py-2.5 w-36 hidden md:table-cell">
          <span className="text-xs text-gray-500 truncate block max-w-[130px]" title={item.subdomain_name || ''}>
            {item.subdomain_name || '—'}
          </span>
        </td>

        {/* Control description */}
        <td className="px-3 py-2.5">
          <p className="text-xs text-gray-800 leading-relaxed line-clamp-2">{item.control_description}</p>
        </td>

        {/* Status */}
        <td className="px-3 py-2.5 w-44">
          <select
            value={item.compliance_status}
            onChange={(e) => updateField('compliance_status', e.target.value)}
            className={`w-full text-xs px-2 py-1.5 rounded-lg border-0 font-medium focus:ring-2 focus:ring-blue-500 cursor-pointer ${style.bg} ${style.text}`}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </td>

        {/* Owner */}
        <td className="px-3 py-2.5 w-36 hidden lg:table-cell">
          <select
            value={item.responsible_party || ''}
            onChange={(e) => updateField('responsible_party', e.target.value || null)}
            className="w-full text-xs px-2 py-1 border border-gray-200 rounded-lg bg-white text-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">— Unassigned —</option>
            {tenantUsers.map((u) => (
              <option key={u.id} value={u.label}>{u.label}</option>
            ))}
          </select>
        </td>

        {/* Priority */}
        <td className="px-3 py-2.5 w-28 hidden lg:table-cell">
          <select
            value={item.priority || ''}
            onChange={(e) => updateField('priority', e.target.value || null)}
            className={`w-full text-xs px-2 py-1.5 rounded-lg border-0 font-medium focus:ring-2 focus:ring-blue-500 cursor-pointer ${
              item.priority ? PRIORITY_STYLE[item.priority] : 'bg-gray-50 text-gray-500'}`}
          >
            <option value="">— None —</option>
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </td>

        {/* Actions */}
        <td className="px-3 py-2.5 w-24">
          <div className="flex items-center gap-1">
            <button
              onClick={generateAI}
              disabled={aiLoading}
              title="Generate AI Recommendation"
              className="p-1.5 rounded-lg text-violet-500 hover:bg-violet-50 transition-colors disabled:opacity-50"
            >
              {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              title="Expand details"
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </td>
      </tr>

      {/* AI error toast */}
      {aiError && createPortal(
        <div className="fixed bottom-4 right-4 z-[70] flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 shadow-lg">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {aiError}
        </div>, document.body)}

      {/* Editable detail popup */}
      {expanded && createPortal(
        <div onClick={() => setExpanded(false)} className="fixed inset-0 z-[60] flex items-center justify-center p-6" style={{ background: 'rgba(15,23,42,0.45)' }}>
          <div onClick={(e) => e.stopPropagation()} className="flex max-h-[88vh] w-[720px] max-w-[96vw] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.4)]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-slate-500">Control detail · edit</div>
                <div className="mt-0.5 flex items-center gap-2 text-[12px]">
                  <span className="font-mono font-semibold text-slate-700">{item.item_number}</span>
                  {item.subdomain_name && <span className="truncate text-slate-400">{item.subdomain_name}</span>}
                </div>
              </div>
              <button onClick={() => setExpanded(false)} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X className="h-[17px] w-[17px]" /></button>
            </div>
            <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Control</label>
                <textarea rows={3} defaultValue={item.control_description || ''} onBlur={(e) => { if (e.target.value !== (item.control_description || '')) updateField('control_description', e.target.value || null); }} className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] focus:border-transparent focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Status</label>
                  <select value={item.compliance_status} onChange={(e) => updateField('compliance_status', e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] focus:ring-2 focus:ring-blue-500">
                    {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Owner</label>
                  <select value={item.responsible_party || ''} onChange={(e) => updateField('responsible_party', e.target.value || null)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] focus:ring-2 focus:ring-blue-500">
                    <option value="">— Unassigned —</option>
                    {tenantUsers.map((u) => <option key={u.id} value={u.label}>{u.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Priority</label>
                  <select value={item.priority || ''} onChange={(e) => updateField('priority', e.target.value || null)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] focus:ring-2 focus:ring-blue-500">
                    <option value="">— None —</option>
                    {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Remarks / Observations</label>
                <textarea rows={2} defaultValue={item.remarks || ''} onBlur={(e) => { if (e.target.value !== (item.remarks || '')) updateField('remarks', e.target.value || null); }} placeholder="Add remarks..." className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] focus:border-transparent focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Corrective Procedures</label>
                <textarea rows={2} defaultValue={item.proposed_solution || ''} onBlur={(e) => { if (e.target.value !== (item.proposed_solution || '')) updateField('proposed_solution', e.target.value || null); }} placeholder="Describe corrective procedures..." className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] focus:border-transparent focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600"><Calendar className="mr-1 inline h-3 w-3" />Expected Compliance Date</label>
                <input type="date" defaultValue={item.timeline || ''} onBlur={(e) => { if (e.target.value !== (item.timeline || '')) updateField('timeline', e.target.value || null); }} className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] focus:border-transparent focus:ring-2 focus:ring-blue-500" />
              </div>
              {/* Evidence */}
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-600"><Paperclip className="h-3 w-3" /> Evidence ({evidence.length})</label>
                <input ref={evUpload} type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg,.csv,.docx" className="hidden" onChange={onEvFile} />
                <div onClick={() => evUpload.current?.click()} className="cursor-pointer rounded-lg border-[1.5px] border-dashed border-gray-300 p-3 text-center hover:border-blue-400 hover:bg-blue-50/40">
                  {evUploading ? <Loader2 className="mx-auto mb-1 h-5 w-5 animate-spin text-blue-600" /> : <Upload className="mx-auto mb-1 h-5 w-5 text-blue-600" />}
                  <div className="text-[12px] font-medium text-gray-700">{evUploading ? 'Uploading…' : 'Drop a file or click to upload'}</div>
                  <div className="text-[10.5px] text-gray-400">PDF, XLSX, PNG · up to 25 MB</div>
                </div>
                {evidence.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {evidence.map((ev, i) => {
                      const fileName = String(ev.evidence_file_name || ev.evidence_name || ev.file_name || `Evidence ${i + 1}`);
                      const ext = (fileName.split('.').pop() || 'FILE').toUpperCase().slice(0, 4);
                      return (
                        <div key={String(ev.id ?? i)} className="flex items-center gap-2.5 rounded-lg border border-gray-200 px-2.5 py-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[9px] font-bold text-blue-600">{ext}</div>
                          <div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-semibold text-gray-800">{String(ev.evidence_name || fileName)}</div><div className="text-[10.5px] text-gray-400">Linked · {String(ev.approval_status || ev.status || 'linked')}</div></div>
                          <Download className="h-4 w-4 shrink-0 text-gray-300" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* AI */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="flex items-center gap-1 text-xs font-medium text-gray-600"><Sparkles className="h-3 w-3 text-violet-500" /> AI Recommendation{item.ai_recommendation_generated_at && <span className="ml-1 font-normal text-gray-400">· {new Date(item.ai_recommendation_generated_at).toLocaleDateString()}</span>}</p>
                  <button onClick={generateAI} disabled={aiLoading} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50">
                    {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} {item.ai_evidence_recommendation ? 'Regenerate' : 'Generate'}
                  </button>
                </div>
                {item.ai_evidence_recommendation ? <AIPanel raw={item.ai_evidence_recommendation} /> : <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">No AI recommendation yet.</p>}
              </div>
            </div>
          </div>
        </div>, document.body)}
    </>
  );
}

// ─── Domain group ─────────────────────────────────────────────────────────────

function DomainGroup({
  domain,
  assessmentId,
  tenantUsers,
  onItemUpdated,
}: {
  domain: DCCDomain;
  assessmentId: number;
  tenantUsers: TenantUser[];
  onItemUpdated: (itemId: number, update: Partial<DCCItem>) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const complied = domain.items.filter((i) => i.compliance_status === 'complied').length;
  const total = domain.items.length;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden mb-3">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {collapsed ? <ChevronRight className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          <span className="text-sm font-semibold text-gray-800">{domain.name}</span>
          <span className="text-xs text-gray-500">{total} controls</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-1.5 w-24 rounded-full overflow-hidden bg-gray-200">
            <div className="bg-emerald-500 transition-all" style={{ width: `${(complied / total) * 100}%` }} />
          </div>
          <span className="text-xs text-gray-500">{complied}/{total}</span>
        </div>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-white text-xs text-gray-500">
                <th className="px-3 py-2 text-left font-medium w-20">Ref</th>
                <th className="px-3 py-2 text-left font-medium w-36 hidden md:table-cell">Subdomain</th>
                <th className="px-3 py-2 text-left font-medium">Control</th>
                <th className="px-3 py-2 text-left font-medium w-44">Status</th>
                <th className="px-3 py-2 text-left font-medium w-36 hidden lg:table-cell">Owner</th>
                <th className="px-3 py-2 text-left font-medium w-28 hidden lg:table-cell">Priority</th>
                <th className="px-3 py-2 text-left font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {domain.items.map((item) => (
                <DCCRow
                  key={item.id}
                  item={item}
                  assessmentId={assessmentId}
                  tenantUsers={tenantUsers}
                  onUpdated={(update) => onItemUpdated(item.id, update)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Export helper ────────────────────────────────────────────────────────────

function exportToExcel(data: DCCData) {
  const rows: unknown[][] = [
    ['Control Ref', 'Main Domain', 'Subdomain', 'Type', 'Control Description', 'Compliance Status', 'Owner', 'Priority', 'Remarks', 'Corrective Procedures', 'Expected Date'],
  ];
  for (const domain of data.domains) {
    for (const item of domain.items) {
      rows.push([
        item.item_number,
        domain.name,
        item.subdomain_name || '',
        item.control_type || '',
        item.control_description || '',
        item.status_label,
        item.responsible_party || '',
        item.priority || '',
        item.remarks || '',
        item.proposed_solution || '',
        item.timeline || '',
      ]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 10 }, { wch: 25 }, { wch: 25 }, { wch: 8 }, { wch: 60 }, { wch: 22 }, { wch: 20 }, { wch: 10 }, { wch: 30 }, { wch: 35 }, { wch: 15 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DCC Assessment');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'DCC_Assessment.xlsx';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Add DCC control popup ────────────────────────────────────────────────────

function DCCAddItemModal({
  assessmentId, domains, tenantUsers, onClose, onAdded,
}: {
  assessmentId: number; domains: string[]; tenantUsers: TenantUser[]; onClose: () => void; onAdded: () => void;
}) {
  const [f, setF] = useState({ item_number: '', area_domain: domains[0] ?? '', subdomain: '', control_description: '', compliance_status: 'in_progress', responsible_party: '', priority: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    if (!f.control_description.trim()) return;
    setSaving(true);
    try {
      await apiClient.post(`/compliance/assessments/${assessmentId}/items`, {
        item_number: f.item_number || undefined,
        area_domain: f.area_domain,
        control_description: f.control_description,
        compliance_status: f.compliance_status,
        responsible_party: f.responsible_party || undefined,
        priority: f.priority || undefined,
        remarks: f.subdomain ? `Subdomain: ${f.subdomain}` : undefined,
      });
      onAdded();
    } catch { alert('Failed to add control.'); }
    finally { setSaving(false); }
  };
  const inp = 'w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] focus:border-transparent focus:ring-2 focus:ring-blue-500';
  const lbl = 'mb-1 block text-xs font-medium text-gray-600';
  return createPortal(
    <div onClick={onClose} className="fixed inset-0 z-[60] flex items-center justify-center p-6" style={{ background: 'rgba(15,23,42,0.45)' }}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[88vh] w-[560px] max-w-[96vw] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.4)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="text-[14px] font-semibold text-gray-800">Add DCC control</div>
          <button onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X className="h-[17px] w-[17px]" /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Control Ref (optional)</label><input className={inp} value={f.item_number} onChange={(e) => set('item_number', e.target.value)} placeholder="e.g. 1-1-2" /></div>
            <div><label className={lbl}>Domain</label><select className={inp} value={f.area_domain} onChange={(e) => set('area_domain', e.target.value)}>{domains.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
          </div>
          <div><label className={lbl}>Subdomain (optional)</label><input className={inp} value={f.subdomain} onChange={(e) => set('subdomain', e.target.value)} /></div>
          <div><label className={lbl}>Control description</label><textarea className={`${inp} min-h-[80px] resize-y`} value={f.control_description} onChange={(e) => set('control_description', e.target.value)} placeholder="Describe the control…" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={lbl}>Status</label><select className={inp} value={f.compliance_status} onChange={(e) => set('compliance_status', e.target.value)}>{STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
            <div><label className={lbl}>Owner</label><select className={inp} value={f.responsible_party} onChange={(e) => set('responsible_party', e.target.value)}><option value="">— Unassigned —</option>{tenantUsers.map((u) => <option key={u.id} value={u.label}>{u.label}</option>)}</select></div>
            <div><label className={lbl}>Priority</label><select className={inp} value={f.priority} onChange={(e) => set('priority', e.target.value)}><option value="">— None —</option>{PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving || !f.control_description.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add control</button>
        </div>
      </div>
    </div>, document.body);
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DCCAssessmentTab({
  assessmentId,
  tenantUsers,
}: {
  assessmentId: number;
  tenantUsers: TenantUser[];
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [domainFilter, setDomainFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);

  // Local optimistic cache for item updates
  const [localUpdates, setLocalUpdates] = useState<Record<number, Partial<DCCItem>>>({});

  const { data, isLoading, isError } = useQuery<DCCData>({
    queryKey: ['dcc-assessment', assessmentId],
    queryFn: async () => {
      const r = await apiClient.get(`/compliance/assessments/${assessmentId}/dcc`);
      return r.data;
    },
    staleTime: 30_000,
  });

  const initMutation = useMutation({
    mutationFn: () => apiClient.post(`/compliance/assessments/${assessmentId}/dcc/initialize`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dcc-assessment', assessmentId] });
      setLocalUpdates({});
    },
  });

  const handleItemUpdated = useCallback((itemId: number, update: Partial<DCCItem>) => {
    setLocalUpdates((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? {}), ...update },
    }));
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-3 p-6 bg-rose-50 rounded-xl text-rose-700 text-sm">
        <AlertCircle className="h-5 w-5 shrink-0" />
        Failed to load DCC assessment data.
      </div>
    );
  }

  if (!data?.initialized) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="h-16 w-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
          <FileSpreadsheet className="h-8 w-8 text-blue-500" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Initialize DCC Assessment</h3>
        <p className="text-sm text-gray-500 max-w-md mb-6">
          Load all 66 controls from the NCA DCC-1:2022 framework into this assessment.
          You can then assess compliance, assign owners, set priorities, and generate AI recommendations for each control.
        </p>
        <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl text-xs text-blue-700 mb-6 max-w-md">
          <Info className="h-4 w-4 shrink-0" />
          This creates 66 assessment items pre-loaded with the DCC control descriptions.
          All changes are saved automatically.
        </div>
        <button
          onClick={() => initMutation.mutate()}
          disabled={initMutation.isPending}
          className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {initMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Shield className="h-4 w-4" />
          )}
          Initialize DCC Assessment (66 Controls)
        </button>
      </div>
    );
  }

  // Merge local updates into data
  const mergedData: DCCData = {
    ...data,
    domains: data.domains.map((domain) => ({
      ...domain,
      items: domain.items.map((item) =>
        localUpdates[item.id] ? { ...item, ...localUpdates[item.id] } : item
      ),
    })),
  };

  // Recompute summary from merged data
  const allItems = mergedData.domains.flatMap((d) => d.items);
  const liveSummary = {
    total: allItems.length,
    complied: allItems.filter((i) => i.compliance_status === 'complied').length,
    partially_complied: allItems.filter((i) => i.compliance_status === 'partially_complied').length,
    not_complied: allItems.filter((i) => i.compliance_status === 'not_complied').length,
    na: allItems.filter((i) => i.compliance_status === 'na').length,
    in_progress: allItems.filter((i) => i.compliance_status === 'in_progress').length,
  };

  // Filter domains/items
  const domainNames = mergedData.domains.map((d) => d.name);
  const filteredDomains = mergedData.domains
    .filter((d) => domainFilter === 'all' || d.name === domainFilter)
    .map((domain) => ({
      ...domain,
      items: domain.items.filter((item) => {
        const matchSearch =
          !search ||
          item.item_number.toLowerCase().includes(search.toLowerCase()) ||
          item.control_description?.toLowerCase().includes(search.toLowerCase()) ||
          item.subdomain_name?.toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === 'all' || item.compliance_status === statusFilter;
        return matchSearch && matchStatus;
      }),
    }))
    .filter((d) => d.items.length > 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            NCA DCC-1:2022 Assessment
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Data Cybersecurity Controls · {liveSummary.total} controls
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportToExcel(mergedData)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> Export XLSX
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add item
          </button>
        </div>
      </div>

      {showAdd && (
        <DCCAddItemModal
          assessmentId={assessmentId}
          domains={domainNames}
          tenantUsers={tenantUsers}
          onClose={() => setShowAdd(false)}
          onAdded={() => { queryClient.invalidateQueries({ queryKey: ['dcc-assessment', assessmentId] }); setShowAdd(false); }}
        />
      )}

      {/* Progress */}
      <ProgressBar summary={liveSummary} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search controls..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          className="text-sm px-3 py-2 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Domains</option>
          {domainNames.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm px-3 py-2 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Statuses</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Domain groups */}
      {filteredDomains.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">No controls match the current filters.</div>
      ) : (
        filteredDomains.map((domain) => (
          <DomainGroup
            key={domain.name}
            domain={domain}
            assessmentId={assessmentId}
            tenantUsers={tenantUsers}
            onItemUpdated={handleItemUpdated}
          />
        ))
      )}
    </div>
  );
}
