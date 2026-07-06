'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus, Trash2, RotateCcw, ShieldAlert, ExternalLink, Loader2 } from 'lucide-react';
import { frameworkTemplatesApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import {
  REGISTER_CONFIGS, TONE_CLASSES,
  type RegisterEntry, type RegisterResponse, type RegisterColumn,
  type TenantUserOption, type SelectOption,
} from './templateConfigs';

interface Props {
  registerType: 'gap_analysis' | 'internal_audit' | 'risk_treatment';
  journeyId: number;
  frameworkId: number | null;
  frameworkName: string;
  tenantUsers: TenantUserOption[];
}

export default function FrameworkRegisterTab({ registerType, journeyId, frameworkId, frameworkName, tenantUsers }: Props) {
  const config = REGISTER_CONFIGS[registerType];
  const qc = useQueryClient();
  const { toast } = useToast();
  const queryKey = ['ft-register', registerType, journeyId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => (await frameworkTemplatesApi.registers.list(registerType, { journey_id: journeyId, framework_id: frameworkId })).data as RegisterResponse,
    enabled: !!journeyId,
  });

  // Local, immediately-editable copy of the rows. Field edits patch this and
  // persist in the background; structural ops (add/delete/move/reset) refetch.
  const [rows, setRows] = useState<RegisterEntry[]>([]);
  useEffect(() => { if (data?.entries) setRows(data.entries); }, [data]);

  const [moveCtx, setMoveCtx] = useState<{ entry: RegisterEntry; title: string; description: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      frameworkTemplatesApi.registers.update(id, payload),
  });
  const addMut = useMutation({
    mutationFn: () => frameworkTemplatesApi.registers.create(registerType, { journey_id: journeyId, framework_id: frameworkId }, {}),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => frameworkTemplatesApi.registers.remove(id),
    onSuccess: invalidate,
  });
  const resetMut = useMutation({
    mutationFn: () => frameworkTemplatesApi.registers.reset(registerType, { journey_id: journeyId, framework_id: frameworkId }),
    onSuccess: invalidate,
  });
  const moveMut = useMutation({
    mutationFn: ({ id, title, description }: { id: number; title: string; description: string }) =>
      frameworkTemplatesApi.registers.moveToRisk(id, { title, description, framework_name: frameworkName }),
    onSuccess: (res) => {
      setMoveCtx(null);
      invalidate();
      const riskId = (res.data as { risk_id?: number })?.risk_id;
      toast({ type: 'success', title: 'Moved to risk register', message: riskId ? `Created Risk #${riskId}` : 'Risk created' });
    },
    onError: () => toast({ type: 'error', title: 'Could not create risk', message: 'Please try again.' }),
  });

  const patchLocal = (id: number, key: keyof RegisterEntry, value: unknown) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  const commit = (id: number, key: keyof RegisterEntry, value: unknown) =>
    updateMut.mutate({ id, payload: { [key]: value } });

  const userName = (id: number | null) => (id == null ? '' : tenantUsers.find((u) => u.id === id)?.name || '');

  const coverage = useMemo(() => {
    if (!config.coverage) return null;
    const applicable = rows.filter((r) => (r.status || '') !== 'not_applicable');
    const covered = applicable.filter((r) => (r.status || '') === 'covered');
    return applicable.length ? Math.round((100 * covered.length) / applicable.length) : 0;
  }, [rows, config.coverage]);

  const movedCount = rows.filter((r) => r.risk_register_id).length;

  const optionMeta = (col: RegisterColumn, value: string | null): SelectOption | undefined =>
    col.options?.find((o) => o.value === (value || ''));

  const renderCell = (row: RegisterEntry, col: RegisterColumn) => {
    const raw = row[col.key];
    if (col.type === 'select') {
      const meta = optionMeta(col, (raw as string) ?? '');
      const tone = meta?.tone || 'slate';
      return (
        <select
          value={(raw as string) ?? ''}
          onChange={(e) => { patchLocal(row.id, col.key, e.target.value); commit(row.id, col.key, e.target.value); }}
          className={`w-full rounded-md border px-2 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/30 ${TONE_CLASSES[tone]}`}
        >
          {col.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    if (col.type === 'owner') {
      return (
        <select
          value={(row.owner_id as number | null) ?? ''}
          onChange={(e) => {
            const v = e.target.value ? Number(e.target.value) : null;
            patchLocal(row.id, 'owner_id', v);
            commit(row.id, 'owner_id', v);
          }}
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
        >
          <option value="">{row.owner_name || 'Unassigned'}</option>
          {tenantUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      );
    }
    if (col.type === 'date') {
      const v = raw ? String(raw).slice(0, 10) : '';
      return (
        <input
          type="date"
          value={v}
          onChange={(e) => { patchLocal(row.id, col.key, e.target.value || null); commit(row.id, col.key, e.target.value || null); }}
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
        />
      );
    }
    // text / textarea
    const common = {
      value: (raw as string) ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => patchLocal(row.id, col.key, e.target.value),
      onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => commit(row.id, col.key, e.target.value),
      className: 'w-full resize-y rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/30',
    };
    return col.type === 'textarea'
      ? <textarea rows={2} {...common} />
      : <input type="text" {...common} />;
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="text-base font-semibold text-slate-900">{config.label}</h3>
          <p className="mt-1 text-sm text-slate-500">{config.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => resetMut.mutate()}
            disabled={resetMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} /> Reset to template
          </button>
          <button
            type="button"
            onClick={() => addMut.mutate()}
            disabled={addMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Add row
          </button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{rows.length} rows</span>
        {config.coverage && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700">
            Coverage {coverage}%
          </span>
        )}
        {movedCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
            <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} /> {movedCount} moved to risk
          </span>
        )}
      </div>

      {/* Register table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {config.columns.map((c) => (
                <th key={String(c.key)} style={{ minWidth: c.minWidth }} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{c.label}</th>
              ))}
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 align-top last:border-0 hover:bg-slate-50/50">
                {config.columns.map((c) => (
                  <td key={String(c.key)} className={`px-3 py-2 ${c.grow ? 'w-[22%]' : ''}`}>{renderCell(row, c)}</td>
                ))}
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    {row.risk_register_id ? (
                      <Link
                        href={`/erm/risks/${row.risk_register_id}`}
                        className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
                        title="Open the linked risk"
                      >
                        Risk #{row.risk_register_id} <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : config.moveToRisk ? (
                      <button
                        type="button"
                        onClick={() => setMoveCtx({ entry: row, title: (row.title || row.reference || '').slice(0, 200), description: '' })}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-rose-300 hover:text-rose-700"
                        title="Move to risk register"
                      >
                        <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} /> To risk
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => { if (confirm('Delete this row?')) deleteMut.mutate(row.id); }}
                      className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      title="Delete row"
                      aria-label="Delete row"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={config.columns.length + 1} className="px-3 py-10 text-center text-sm text-slate-400">No rows yet. Use “Add row” or “Reset to template”.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Move-to-risk modal */}
      <AnimatedModal isOpen={!!moveCtx} onClose={() => setMoveCtx(null)} title="Move to risk register" subtitle={frameworkName} size="md">
        {moveCtx && (
          <div className="space-y-4 p-5">
            <p className="text-sm text-slate-500">Create a risk in the ERM register from this {config.label.toLowerCase()} entry. It will be linked back here and tagged under {frameworkName}.</p>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Risk title</label>
              <input
                value={moveCtx.title}
                onChange={(e) => setMoveCtx({ ...moveCtx, title: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Description (optional)</label>
              <textarea
                rows={3}
                value={moveCtx.description}
                onChange={(e) => setMoveCtx({ ...moveCtx, description: e.target.value })}
                placeholder="Additional context for the risk owner…"
                className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMoveCtx(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button
                type="button"
                disabled={!moveCtx.title.trim() || moveMut.isPending}
                onClick={() => moveMut.mutate({ id: moveCtx.entry.id, title: moveCtx.title.trim(), description: moveCtx.description.trim() })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50"
              >
                {moveMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create risk
              </button>
            </div>
          </div>
        )}
      </AnimatedModal>
    </div>
  );
}
