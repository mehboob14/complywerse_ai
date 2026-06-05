'use client';

// Classification matrix admin — Type × Severity → default owner team + SLA.
// Compact list editor (rather than a fully populated 7×5 grid) since only
// the cells the tenant actually cares about need a row.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, Plus, Trash2 } from 'lucide-react';
import { issuesApi } from '@/lib/api';
import { SEVERITIES, ISSUE_TYPES, SeverityChip } from './shared';

interface Cell {
  issue_type: string;
  severity: string;
  default_owner_team_id: number | null;
  default_owner_user_id: number | null;
  response_sla_hours: number | null;
  escalation_sla_hours: number | null;
}

export function ClassificationMatrixEditor() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ tenant_id: number; cells: Cell[] }>({
    queryKey: ['issues-classification-matrix'],
    queryFn: async () => (await issuesApi.matrices.getClassification()).data,
    staleTime: 60_000,
  });

  const [draft, setDraft] = useState<Cell>({
    issue_type: 'incident',
    severity: 'critical',
    default_owner_team_id: null,
    default_owner_user_id: null,
    response_sla_hours: 4,
    escalation_sla_hours: 24,
  });

  const saveMutation = useMutation({
    mutationFn: () => issuesApi.matrices.putClassificationCell(draft.issue_type, draft.severity, {
      default_owner_team_id: draft.default_owner_team_id,
      default_owner_user_id: draft.default_owner_user_id,
      response_sla_hours: draft.response_sla_hours,
      escalation_sla_hours: draft.escalation_sla_hours,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['issues-classification-matrix'] }),
  });

  if (isLoading || !data) {
    return <div className="h-[240px] rounded-xl border border-slate-200 bg-white animate-pulse" />;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Classification Matrix · Type × Severity</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Route new issues to the right team and SLA based on type + severity. Empty cells fall back to the Severity Matrix SLAs.
        </p>

        {data.cells.length === 0 ? (
          <p className="mt-4 py-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
            No classification cells yet — add one below to start routing issues.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Severity</th>
                  <th className="px-3 py-2 font-semibold">Team</th>
                  <th className="px-3 py-2 font-semibold">User</th>
                  <th className="px-3 py-2 font-semibold">Response SLA (h)</th>
                  <th className="px-3 py-2 font-semibold">Escalation SLA (h)</th>
                </tr>
              </thead>
              <tbody>
                {data.cells.map((c) => (
                  <tr key={`${c.issue_type}-${c.severity}`} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-800 capitalize">{c.issue_type.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2"><SeverityChip severity={c.severity} /></td>
                    <td className="px-3 py-2 text-slate-600">{c.default_owner_team_id ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{c.default_owner_user_id ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700 tabular-nums">{c.response_sla_hours ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700 tabular-nums">{c.escalation_sla_hours ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / upsert form */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700">
          <Plus className="h-3.5 w-3.5" /> Add / Update Cell
        </h4>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <select value={draft.issue_type} onChange={(e) => setDraft({ ...draft, issue_type: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs">
            {ISSUE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs">
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="number" placeholder="Team ID" value={draft.default_owner_team_id ?? ''}
            onChange={(e) => setDraft({ ...draft, default_owner_team_id: e.target.value ? Number(e.target.value) : null })}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs" />
          <input type="number" placeholder="User ID" value={draft.default_owner_user_id ?? ''}
            onChange={(e) => setDraft({ ...draft, default_owner_user_id: e.target.value ? Number(e.target.value) : null })}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs" />
          <input type="number" placeholder="Response (h)" value={draft.response_sla_hours ?? ''}
            onChange={(e) => setDraft({ ...draft, response_sla_hours: e.target.value ? Number(e.target.value) : null })}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs" />
          <input type="number" placeholder="Escalation (h)" value={draft.escalation_sla_hours ?? ''}
            onChange={(e) => setDraft({ ...draft, escalation_sla_hours: e.target.value ? Number(e.target.value) : null })}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs" />
        </div>
        <div className="mt-2.5 flex justify-end">
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">
            {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save Cell
          </button>
        </div>
      </div>
    </div>
  );
}
