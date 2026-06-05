'use client';

// IssueForm
// ─────────────────────────────────────────────────────────────────────────
// Modal create/edit form for an Issue. Severity is computed from
// Impact × Urgency by the backend; the user can override with a captured
// reason. Used by:
//  - The "+ New Issue" button on /issues
//  - The "Create Issue from…" buttons on Vuln/Risk/Asset/Control detail pages
//    (via the `presetSource` + `presetFields` props)

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { issuesApi } from '@/lib/api';
import { ISSUE_TYPES, CATEGORIES, SEVERITIES, IMPACTS, URGENCIES } from './shared';

export interface IssueFormProps {
  open: boolean;
  onClose: () => void;
  /** When set, calls /issues/from-source instead of /issues so the linkage is pinned. */
  presetSource?: {
    source_type:
      | 'vulnerability' | 'risk' | 'asset'
      | 'control_framework' | 'control_parsed' | 'control_normalized' | 'control_internal'
      // v2 — governance + policy types accepted by /issues/from-source
      | 'governance_document' | 'policy_statement';
    source_id: number;
  };
  /** Pre-filled form values (title/description/impact/urgency etc.). */
  presetFields?: Partial<{
    title: string;
    description: string;
    impact: string;
    urgency: string;
    category: string;
    issue_type: string;
  }>;
  /** Where to redirect on success. Defaults to /issues/{newId}. */
  onCreated?: (id: number) => void;
}

export function IssueForm({ open, onClose, presetSource, presetFields, onCreated }: IssueFormProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState(presetFields?.title || '');
  const [description, setDescription] = useState(presetFields?.description || '');
  const [issueType, setIssueType] = useState(presetFields?.issue_type || 'incident');
  const [category, setCategory] = useState(presetFields?.category || 'security');
  const [impact, setImpact] = useState(presetFields?.impact || 'medium');
  const [urgency, setUrgency] = useState(presetFields?.urgency || 'medium');
  const [override, setOverride] = useState<string>('');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = {
        title, description, impact, urgency,
        issue_type: issueType, category,
        severity_override: override || undefined,
        severity_override_reason: override ? overrideReason : undefined,
      };
      if (presetSource) {
        return await issuesApi.fromSource({ ...presetSource, ...body });
      }
      return await issuesApi.create(body);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['issues'] });
      qc.invalidateQueries({ queryKey: ['issues-dashboard'] });
      const id = res.data?.id;
      onClose();
      if (id) {
        if (onCreated) onCreated(id);
        else router.push(`/issues/${id}`);
      }
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(err?.response?.data?.detail || err?.message || 'Failed to create issue');
    },
  });

  if (!open) return null;

  const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {presetSource ? 'Create Issue from source' : 'New Issue'}
            </h3>
            <p className="text-[11px] text-slate-500">
              Impact × Urgency drives the computed severity; override with a reason if you must.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="Brief one-liner" />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass + ' resize-none'} placeholder="What broke, what was found, scope of impact…" />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Type</label>
              <select value={issueType} onChange={(e) => setIssueType(e.target.value)} className={inputClass}>
                {ISSUE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Impact</label>
              <select value={impact} onChange={(e) => setImpact(e.target.value)} className={inputClass}>
                {IMPACTS.map((i) => <option key={i} value={i}>{i.charAt(0).toUpperCase() + i.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Urgency</label>
              <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className={inputClass}>
                {URGENCIES.map((u) => <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Severity</span>
              {!override && (
                <button onClick={() => setOverride('high')} className="text-[10px] font-medium text-blue-700 hover:underline">
                  Override
                </button>
              )}
            </div>
            {override ? (
              <div className="mt-1.5 space-y-1.5">
                <select value={override} onChange={(e) => setOverride(e.target.value)} className={inputClass}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={2}
                  className={inputClass + ' resize-none'}
                  placeholder="Required: why are you overriding the computed severity?"
                />
                <button onClick={() => { setOverride(''); setOverrideReason(''); }} className="text-[10px] text-slate-500 hover:underline">
                  Cancel override (use computed severity)
                </button>
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-700">
                Computed from Impact ({impact}) × Urgency ({urgency}) by the Severity Matrix on submit.
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 bg-slate-50/60">
          <button onClick={onClose} disabled={createMutation.isPending} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!title.trim() || createMutation.isPending || (!!override && !overrideReason.trim())}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create Issue
          </button>
        </div>
      </div>
    </div>
  );
}
