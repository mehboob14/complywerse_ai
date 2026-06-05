'use client';

// Severity matrix admin — 3×3 Impact × Urgency grid. Click a cell to edit
// the computed severity + SLA hours. Defaults shown until tenant overrides.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, X } from 'lucide-react';
import { issuesApi } from '@/lib/api';
import { SEVERITIES, SeverityChip } from './shared';

interface Cell {
  impact: string;
  urgency: string;
  severity: string;
  sla_ack_hours: number;
  sla_resolve_hours: number;
  is_default: boolean;
}

export function SeverityMatrixEditor() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ tenant_id: number; cells: Cell[] }>({
    queryKey: ['issues-severity-matrix'],
    queryFn: async () => (await issuesApi.matrices.getSeverity()).data,
    staleTime: 60_000,
  });

  const [editing, setEditing] = useState<{ impact: string; urgency: string; cell: Cell } | null>(null);
  const [draftSeverity, setDraftSeverity] = useState('medium');
  const [draftAck, setDraftAck] = useState(24);
  const [draftResolve, setDraftResolve] = useState(168);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('no cell selected');
      return issuesApi.matrices.putSeverityCell(editing.impact, editing.urgency, {
        severity: draftSeverity,
        sla_ack_hours: draftAck,
        sla_resolve_hours: draftResolve,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues-severity-matrix'] });
      setEditing(null);
    },
  });

  if (isLoading || !data) {
    return <div className="h-[240px] rounded-xl border border-slate-200 bg-white animate-pulse" />;
  }

  const cellMap = new Map<string, Cell>();
  data.cells.forEach((c) => cellMap.set(`${c.impact}|${c.urgency}`, c));

  const openEdit = (impact: string, urgency: string) => {
    const cell = cellMap.get(`${impact}|${urgency}`);
    if (!cell) return;
    setEditing({ impact, urgency, cell });
    setDraftSeverity(cell.severity);
    setDraftAck(cell.sla_ack_hours);
    setDraftResolve(cell.sla_resolve_hours);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">Severity Matrix · Impact × Urgency</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Click any cell to override what counts as Critical/High/Medium/Low/Info at this tenant, and the SLA windows
          that apply. Defaults are used until you save your own values.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="w-24"></th>
              {['high', 'medium', 'low'].map((u) => (
                <th key={u} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600 border border-slate-200 bg-slate-50">
                  Urgency: {u}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {['high', 'medium', 'low'].map((impact) => (
              <tr key={impact}>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600 border border-slate-200 bg-slate-50 text-left">
                  Impact: {impact}
                </th>
                {['high', 'medium', 'low'].map((urgency) => {
                  const cell = cellMap.get(`${impact}|${urgency}`);
                  if (!cell) return <td key={urgency} className="border border-slate-200" />;
                  return (
                    <td
                      key={urgency}
                      onClick={() => openEdit(impact, urgency)}
                      className="cursor-pointer border border-slate-200 p-3 hover:bg-slate-50 align-top"
                    >
                      <div className="mb-1.5"><SeverityChip severity={cell.severity} /></div>
                      <div className="text-[10px] text-slate-500">
                        Ack {cell.sla_ack_hours}h · Resolve {cell.sla_resolve_hours}h
                      </div>
                      {cell.is_default && (
                        <div className="mt-1 text-[9px] uppercase tracking-wider text-slate-400">Default</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <h4 className="text-sm font-semibold text-slate-900">
                Impact: <span className="capitalize">{editing.impact}</span> · Urgency: <span className="capitalize">{editing.urgency}</span>
              </h4>
              <button onClick={() => setEditing(null)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <div className="px-4 py-3 space-y-2.5">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Severity</label>
                <select value={draftSeverity} onChange={(e) => setDraftSeverity(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs">
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Ack SLA (hours)</label>
                  <input type="number" value={draftAck} onChange={(e) => setDraftAck(Number(e.target.value))} className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Resolve SLA (hours)</label>
                  <input type="number" value={draftResolve} onChange={(e) => setDraftResolve(Number(e.target.value))} className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-2.5 bg-slate-50">
              <button onClick={() => setEditing(null)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
              <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">
                {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
