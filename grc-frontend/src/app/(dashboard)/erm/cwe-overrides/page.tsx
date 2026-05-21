'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import { Plus, Trash2, AlertCircle, Sparkles, Loader2, Eye, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Per-tenant CWE → framework-control overrides
// ---------------------------------------------------------------------------
// The default static map in `cwe_control_map.py` covers the CWE Top 25
// against PCI / ISO 27001 / OWASP / NIST. Each tenant's compliance team
// can augment that with:
//   - "add"    a custom link (e.g. for our org, CWE-89 also breaks SAMA 4.2.1)
//   - "remove" a default link they disagree with
// The resolver merges defaults + overrides at lookup time. Cache is
// invalidated on every mutation so changes take effect immediately.

interface CweOverride {
  id: number;
  tenant_id: number;
  cwe_id: string;
  framework_prefix: string;
  control_code_pattern: string;
  action: 'add' | 'remove' | string;
  notes?: string | null;
  created_at: string;
  created_by?: number | null;
}

interface PreviewResponse {
  tenant_id: number | null;
  cwe_id: string | null;
  has_cve?: boolean;
  is_kev?: boolean;
  default_identifiers: Array<{ framework_prefix: string; control_code_pattern: string }>;
  effective_identifiers: Array<{ framework_prefix: string; control_code_pattern: string }>;
  overrides_applied: Array<{
    id: number; cwe_id: string;
    framework_prefix: string; control_code_pattern: string;
    action: string; notes?: string | null;
  }>;
}

const SENTINEL_VULN_MGMT = '__vuln_mgmt__';
const SENTINEL_KEV = '__kev__';

const SENTINEL_LABELS: Record<string, string> = {
  [SENTINEL_VULN_MGMT]: 'All open CVE-bearing vulns (vuln-management baseline)',
  [SENTINEL_KEV]: 'All KEV-flagged vulns (active-exploitation baseline)',
};

function cweLabel(raw: string): string {
  return SENTINEL_LABELS[raw] || raw;
}

export default function CweOverridesPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Preview state
  const [previewCwe, setPreviewCwe] = useState<string>('CWE-89');
  const [previewHasCve, setPreviewHasCve] = useState(true);
  const [previewIsKev, setPreviewIsKev] = useState(false);

  const { data: overrides, isLoading } = useQuery({
    queryKey: ['cwe-overrides'],
    queryFn: async () => {
      const res = await vulnManagementApi.controlLinks.listOverrides();
      return (res.data || []) as CweOverride[];
    },
  });

  const { data: preview } = useQuery({
    queryKey: ['cwe-overrides-preview', previewCwe, previewHasCve, previewIsKev],
    queryFn: async () => {
      const res = await vulnManagementApi.controlLinks.previewOverrides({
        cwe_id: previewCwe || undefined,
        has_cve: previewHasCve,
        is_kev: previewIsKev,
      });
      return res.data as PreviewResponse;
    },
    enabled: previewCwe.trim().length > 0,
    staleTime: 5000,
  });

  const createMutation = useMutation({
    mutationFn: async (body: {
      cwe_id: string;
      framework_prefix: string;
      control_code_pattern: string;
      action: 'add' | 'remove';
      notes?: string;
    }) => {
      const res = await vulnManagementApi.controlLinks.createOverride(body);
      return res.data as CweOverride;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cwe-overrides'] });
      qc.invalidateQueries({ queryKey: ['cwe-overrides-preview'] });
      setShowAdd(false);
      setErrorMsg(null);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErrorMsg(detail || 'Could not save override.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await vulnManagementApi.controlLinks.deleteOverride(id);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cwe-overrides'] });
      qc.invalidateQueries({ queryKey: ['cwe-overrides-preview'] });
    },
  });

  if (isLoading) return <PageLoader className="h-64" />;

  // Group overrides by cwe_id for the listing table.
  const grouped: Record<string, CweOverride[]> = {};
  for (const o of overrides || []) {
    (grouped[o.cwe_id] = grouped[o.cwe_id] || []).push(o);
  }
  const groupKeys = Object.keys(grouped).sort();

  return (
    <div className="px-3 sm:px-6 py-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="max-w-2xl">
          <h1 className="text-lg font-semibold text-slate-900">CWE → Control Overrides</h1>
          <p className="text-xs text-slate-500 mt-1">
            The CWE → framework-control auto-mapper ships a default map covering
            the CWE Top 25 against PCI, ISO 27001, OWASP and NIST. Add your own
            organisation-specific links, or remove default links you disagree with.
            Changes take effect on the next vulnerability enrichment.
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setErrorMsg(null); }}
          className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3"
        >
          <Plus size={14} />
          Add Override
        </button>
      </div>

      {/* Existing overrides */}
      <div className="cw-card p-4">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Your Overrides ({overrides?.length || 0})</h2>
        {groupKeys.length === 0 ? (
          <div className="p-6 text-center">
            <Sparkles className="mx-auto h-7 w-7 text-slate-300 mb-2" />
            <p className="text-sm text-slate-600">No overrides yet — the auto-mapper is using the shipped defaults only.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groupKeys.map((cwe) => (
              <div key={cwe} className="border border-slate-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                    {cwe.startsWith('__') ? 'BASELINE' : cwe}
                  </span>
                  <span className="text-xs text-slate-600">{cweLabel(cwe)}</span>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-50/50">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-600">Action</th>
                      <th className="px-2 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-600">Framework prefix</th>
                      <th className="px-2 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-600">Control pattern</th>
                      <th className="px-2 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-600">Notes</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {grouped[cwe].map((o) => (
                      <tr key={o.id} className="hover:bg-slate-50">
                        <td className="px-2 py-1.5">
                          {o.action === 'add' ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-1.5 py-0 text-[10px] font-semibold text-emerald-700">
                              add
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-rose-50 border border-rose-200 px-1.5 py-0 text-[10px] font-semibold text-rose-700">
                              remove
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-slate-700">{o.framework_prefix}</td>
                        <td className="px-2 py-1.5 font-mono text-slate-700">{o.control_code_pattern}</td>
                        <td className="px-2 py-1.5 text-slate-600">{o.notes || <span className="text-slate-400">—</span>}</td>
                        <td className="px-2 py-1.5">
                          <button
                            onClick={() => deleteMutation.mutate(o.id)}
                            className="text-slate-400 hover:text-red-600"
                            disabled={deleteMutation.isPending}
                            title="Remove this override"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview panel */}
      <div className="cw-card p-4">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 mb-2">
          <Eye size={14} className="text-blue-600" />
          Effective Resolution Preview
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Enter a CWE-ID to see how defaults + your overrides combine into the
          identifier list the resolver uses at runtime.
        </p>
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">CWE-ID</label>
            <input
              type="text"
              value={previewCwe}
              onChange={(e) => setPreviewCwe(e.target.value)}
              placeholder="e.g. CWE-89"
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-sm font-mono text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={previewHasCve}
              onChange={(e) => setPreviewHasCve(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Vuln has a CVE
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={previewIsKev}
              onChange={(e) => setPreviewIsKev(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            KEV-flagged
          </label>
        </div>

        {preview && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="border border-slate-200 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">
                Default identifiers ({preview.default_identifiers.length})
              </p>
              {preview.default_identifiers.length === 0 ? (
                <p className="text-xs text-slate-400 italic">None — this CWE isn&apos;t in our default map.</p>
              ) : (
                <ul className="space-y-1 max-h-72 overflow-y-auto">
                  {preview.default_identifiers.map((d, i) => (
                    <li key={i} className="text-xs font-mono text-slate-700">
                      <span className="text-slate-500">prefix:</span> {d.framework_prefix}
                      <span className="ml-2 text-slate-500">code:</span> {d.control_code_pattern}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-2 border-blue-200 rounded-lg p-3 bg-blue-50/30">
              <p className="text-[10px] uppercase tracking-wider text-blue-700 font-semibold mb-1.5">
                Effective (after your overrides) ({preview.effective_identifiers.length})
              </p>
              {preview.effective_identifiers.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Empty — nothing will match.</p>
              ) : (
                <ul className="space-y-1 max-h-72 overflow-y-auto">
                  {preview.effective_identifiers.map((d, i) => {
                    const inDefault = preview.default_identifiers.some(
                      (x) => x.framework_prefix === d.framework_prefix && x.control_code_pattern === d.control_code_pattern,
                    );
                    return (
                      <li key={i} className="text-xs font-mono text-slate-700">
                        {!inDefault && (
                          <span className="inline-flex items-center rounded bg-emerald-100 px-1 text-[9px] font-semibold text-emerald-800 mr-1.5">
                            ADDED
                          </span>
                        )}
                        <span className="text-slate-500">prefix:</span> {d.framework_prefix}
                        <span className="ml-2 text-slate-500">code:</span> {d.control_code_pattern}
                      </li>
                    );
                  })}
                </ul>
              )}
              {preview.overrides_applied.length > 0 && (
                <p className="text-[10px] text-slate-500 mt-2">
                  {preview.overrides_applied.length} override{preview.overrides_applied.length === 1 ? '' : 's'} applied.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <AddOverrideModal
          onClose={() => { setShowAdd(false); setErrorMsg(null); }}
          onSubmit={(body) => createMutation.mutate(body)}
          isPending={createMutation.isPending}
          errorMsg={errorMsg}
        />
      )}
    </div>
  );
}

function AddOverrideModal({
  onClose,
  onSubmit,
  isPending,
  errorMsg,
}: {
  onClose: () => void;
  onSubmit: (body: {
    cwe_id: string;
    framework_prefix: string;
    control_code_pattern: string;
    action: 'add' | 'remove';
    notes?: string;
  }) => void;
  isPending: boolean;
  errorMsg: string | null;
}) {
  const [cweId, setCweId] = useState('');
  const [prefix, setPrefix] = useState('');
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<'add' | 'remove'>('add');
  const [notes, setNotes] = useState('');

  const submit = () => {
    if (!cweId.trim() || !prefix.trim() || !pattern.trim()) return;
    onSubmit({
      cwe_id: cweId.trim(),
      framework_prefix: prefix.trim(),
      control_code_pattern: pattern.trim(),
      action,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="cw-card w-full max-w-lg p-5 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Add CWE Override</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">CWE-ID *</label>
            <input
              type="text"
              value={cweId}
              onChange={(e) => setCweId(e.target.value)}
              placeholder="CWE-89  |  __vuln_mgmt__  |  __kev__"
              className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm font-mono text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Use <code className="bg-slate-100 px-1 rounded">__vuln_mgmt__</code> or{' '}
              <code className="bg-slate-100 px-1 rounded">__kev__</code> to override the always-applicable rule sets.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Action *</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAction('add')}
                className={`flex-1 rounded border px-3 py-1.5 text-xs ${
                  action === 'add'
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-800 font-semibold'
                    : 'border-slate-200 bg-white text-slate-700'
                }`}
              >
                Add (new link)
              </button>
              <button
                type="button"
                onClick={() => setAction('remove')}
                className={`flex-1 rounded border px-3 py-1.5 text-xs ${
                  action === 'remove'
                    ? 'border-rose-400 bg-rose-50 text-rose-800 font-semibold'
                    : 'border-slate-200 bg-white text-slate-700'
                }`}
              >
                Remove (filter out default)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Framework prefix *</label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="e.g. SAMA  |  HITRUST  |  ISO27001"
                className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm font-mono text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              <p className="text-[10px] text-slate-500 mt-1">Loose substring match on the framework name.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Control pattern *</label>
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="e.g. 4.2.1  |  A.8.28"
                className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm font-mono text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              <p className="text-[10px] text-slate-500 mt-1">Substring match on the control code.</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Rationale (recommended)</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. SAMA 4.2.1 explicitly covers SQL injection in the secure-development section — added per our 2026 compliance review."
              className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {errorMsg && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              <div>{errorMsg}</div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="cw-btn-secondary text-sm px-3 py-1.5">Cancel</button>
            <button
              onClick={submit}
              disabled={isPending || !cweId.trim() || !prefix.trim() || !pattern.trim()}
              className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              {isPending && <Loader2 size={14} className="animate-spin" />}
              Save Override
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
