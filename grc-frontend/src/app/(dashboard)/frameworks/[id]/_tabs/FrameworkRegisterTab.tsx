'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Plus, Trash2, RotateCcw, ShieldAlert, ExternalLink, Loader2, Pencil, Sparkles, Search, X,
} from 'lucide-react';
import { frameworkTemplatesApi } from '@/lib/api';
import { AnimatedModal, RightSlidePanel, MultiSelectDropdown } from '@/components/ui';
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
  frameworkControls?: Array<{ code: string; title: string }>;
}

type Draft = Partial<RegisterEntry>;

interface FrameworkRisk {
  id: number;
  title: string;
  description?: string | null;
  category?: string | null;
  status?: string | null;
  register_type?: string | null;
}

/** Standard single-select dropdown used across the platform, wrapped for a form field. */
function FormDropdown({ value, items, placeholder, onChange, searchable }: {
  value: string;
  items: Array<{ value: string; label: string; subLabel?: string }>;
  placeholder?: string;
  onChange: (v: string) => void;
  searchable?: boolean;
}) {
  return (
    <MultiSelectDropdown
      title={placeholder || 'Select'}
      items={items}
      selectedValues={value ? [value] : []}
      onApply={(vals) => onChange(vals[0] || '')}
      multiSelect={false}
      triggerVariant="input"
      size="md"
      showSelectionInTrigger
      forceSearch={searchable ?? items.length > 8}
      placeholder={placeholder}
      className="w-full"
    />
  );
}

export default function FrameworkRegisterTab({ registerType, journeyId, frameworkId, frameworkName, tenantUsers, frameworkControls = [] }: Props) {
  const config = REGISTER_CONFIGS[registerType];
  const qc = useQueryClient();
  const { toast } = useToast();
  const queryKey = ['ft-register', registerType, journeyId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => (await frameworkTemplatesApi.registers.list(registerType, { journey_id: journeyId, framework_id: frameworkId })).data as RegisterResponse,
    enabled: !!journeyId,
  });
  const rows = useMemo(() => data?.entries || [], [data]);

  // Risk Treatment: risks created or moved from this framework, for the picker.
  const { data: frameworkRisksData } = useQuery({
    queryKey: ['ft-framework-risks', journeyId, frameworkName],
    queryFn: async () => (await frameworkTemplatesApi.registers.frameworkRisks({ journey_id: journeyId, framework_name: frameworkName })).data as { risks: FrameworkRisk[] },
    enabled: !!journeyId && registerType === 'risk_treatment',
  });
  const frameworkRisks = frameworkRisksData?.risks || [];

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ mode: 'add' | 'edit'; draft: Draft } | null>(null);
  const [deleteRow, setDeleteRow] = useState<RegisterEntry | null>(null);
  const [moveCtx, setMoveCtx] = useState<{ entry: RegisterEntry; title: string; description: string } | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<number | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey });
  const userName = (id: number | null | undefined) => (id == null ? '' : tenantUsers.find((u) => u.id === id)?.name || '');

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: (payload: { mode: 'add' | 'edit'; id?: number; body: Record<string, unknown> }) =>
      payload.mode === 'add'
        ? frameworkTemplatesApi.registers.create(registerType, { journey_id: journeyId, framework_id: frameworkId }, payload.body)
        : frameworkTemplatesApi.registers.update(payload.id!, payload.body),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: () => toast({ type: 'error', title: 'Could not save', message: 'Please try again.' }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => frameworkTemplatesApi.registers.remove(id),
    onSuccess: () => { setDeleteRow(null); invalidate(); },
  });
  const resetMut = useMutation({
    mutationFn: () => frameworkTemplatesApi.registers.reset(registerType, { journey_id: journeyId, framework_id: frameworkId }),
    onSuccess: invalidate,
  });
  const moveMut = useMutation({
    mutationFn: ({ id, title, description }: { id: number; title: string; description: string }) =>
      frameworkTemplatesApi.registers.moveToRisk(id, { title, description, framework_name: frameworkName }),
    onSuccess: (res) => {
      setMoveCtx(null); invalidate();
      const riskId = (res.data as { risk_id?: number })?.risk_id;
      toast({ type: 'success', title: 'Moved to risk register', message: riskId ? `Created Risk #${riskId}` : 'Risk created' });
    },
    onError: () => toast({ type: 'error', title: 'Could not create risk', message: 'Please try again.' }),
  });
  const aiMut = useMutation({
    mutationFn: async (subset: RegisterEntry[]) => {
      const res = await frameworkTemplatesApi.ai.register({
        register_type: registerType,
        framework_name: frameworkName,
        rows: subset.map((r) => ({ id: r.id, reference: r.reference, title: r.title, status: r.status, result: r.result, action: r.action, notes: r.notes })),
      });
      const out = res.data as { suggestions: Array<Record<string, unknown>>; summary: string };
      const items = (out.suggestions || [])
        .filter((s) => s && s.id != null)
        .map((s) => ({
          id: Number(s.id),
          fields: {
            status: s.status, result: s.result, finding_type: s.finding_type,
            treatment_option: s.treatment_option, linked_control: s.linked_control,
            action: s.action, notes: s.notes, residual_risk: s.residual_risk,
          } as Record<string, unknown>,
        }));
      if (items.length) await frameworkTemplatesApi.registers.applyAI(registerType, { journey_id: journeyId }, items);
      return { summary: out.summary || '', count: items.length };
    },
    onSuccess: (r) => {
      setBusyRowId(null); invalidate(); setAiSummary(r.summary || 'AI assessment applied.');
      toast({ type: 'success', title: 'AI assessment applied', message: `${r.count} row${r.count === 1 ? '' : 's'} updated.` });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      setBusyRowId(null);
      toast({ type: 'error', title: 'AI assist failed', message: e?.response?.data?.detail || 'Try again.' });
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.reference || ''} ${r.title || ''} ${r.action || ''} ${r.notes || ''}`.toLowerCase().includes(q));
  }, [rows, search]);

  const coverage = useMemo(() => {
    if (!config.coverage) return null;
    const applicable = rows.filter((r) => (r.status || '') !== 'not_applicable');
    const covered = applicable.filter((r) => (r.status || '') === 'covered');
    return applicable.length ? Math.round((100 * covered.length) / applicable.length) : 0;
  }, [rows, config.coverage]);
  const movedCount = rows.filter((r) => r.risk_register_id).length;

  const optionMeta = (col: RegisterColumn, value: string | null | undefined): SelectOption | undefined =>
    col.options?.find((o) => o.value === (value || ''));

  // ── Read-only cell (table) ──────────────────────────────────────────────────
  const displayCell = (row: RegisterEntry, col: RegisterColumn) => {
    const raw = row[col.key];
    if (col.type === 'select') {
      const meta = optionMeta(col, raw as string);
      if (!meta || !meta.value) return <span className="text-xs text-slate-300">—</span>;
      return <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[meta.tone || 'slate']}`}>{meta.label}</span>;
    }
    if (col.type === 'owner') {
      const n = userName(row.owner_id) || row.owner_name;
      return n ? <span className="text-sm text-slate-700">{n}</span> : <span className="text-xs text-slate-300">Unassigned</span>;
    }
    if (col.type === 'date') {
      return raw ? <span className="text-sm text-slate-600">{new Date(String(raw)).toLocaleDateString()}</span> : <span className="text-xs text-slate-300">—</span>;
    }
    const txt = (raw as string) || '';
    return txt ? <span className="line-clamp-2 text-sm text-slate-700">{txt}</span> : <span className="text-xs text-slate-300">—</span>;
  };

  // ── Editable form field (panel) ─────────────────────────────────────────────
  const formField = (col: RegisterColumn) => {
    const val = editing?.draft[col.key];
    const set = (v: unknown) => setEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, [col.key]: v } } : prev));
    const cls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/30';
    if (col.picker === 'framework_risks') {
      const items = frameworkRisks.map((r) => ({ value: String(r.id), label: `#${r.id} — ${r.title}` }));
      const selectedId = (editing?.draft.risk_register_id as number | null) ?? null;
      return (
        <div>
          <FormDropdown
            value={selectedId != null ? String(selectedId) : ''}
            items={items}
            placeholder="Select a risk from this framework…"
            searchable
            onChange={(v) => {
              const rid = v ? Number(v) : null;
              const risk = frameworkRisks.find((r) => r.id === rid);
              setEditing((prev) => prev ? { ...prev, draft: {
                ...prev.draft,
                risk_register_id: rid,
                reference: risk ? `#${risk.id}` : prev.draft.reference,
                title: risk ? (risk.title || prev.draft.title || '') : prev.draft.title,
              } } : prev);
            }}
          />
          {frameworkRisks.length === 0 && (
            <p className="mt-1 text-[11px] text-slate-400">No framework risks yet. Move risks over from Gap Analysis or Internal Audit (or add them to the ERM register under this framework), then they’ll appear here.</p>
          )}
        </div>
      );
    }
    if (col.picker === 'framework_controls') {
      const cur = (val as string) || '';
      // When autofillTitleKey is set, pick a requirement by its code and also
      // fill the companion description column — one dropdown fills ref + text.
      if (col.autofillTitleKey) {
        const titleKey = col.autofillTitleKey;
        const items = frameworkControls.map((c) => ({ value: c.code, label: c.title ? `${c.code} — ${c.title}` : c.code }));
        if (cur && !frameworkControls.some((c) => c.code === cur)) items.unshift({ value: cur, label: cur });
        return (
          <div>
            <FormDropdown value={cur} items={items} placeholder="Select a requirement…" searchable
              onChange={(v) => {
                const ctrl = frameworkControls.find((c) => c.code === v);
                setEditing((prev) => prev ? { ...prev, draft: {
                  ...prev.draft,
                  [col.key]: v,
                  [titleKey]: ctrl?.title ? ctrl.title : prev.draft[titleKey],
                } } : prev);
              }} />
            {frameworkControls.length === 0 && (
              <p className="mt-1 text-[11px] text-slate-400">Requirements load from this framework’s Requirements tab.</p>
            )}
          </div>
        );
      }
      const opts = frameworkControls.map((c) => (c.title ? `${c.code} — ${c.title}` : c.code));
      const items = opts.map((o) => ({ value: o, label: o }));
      if (cur && !opts.includes(cur)) items.unshift({ value: cur, label: cur });
      return (
        <div>
          <FormDropdown value={cur} items={items} placeholder="Select a clause / control…" searchable onChange={(v) => set(v)} />
          {frameworkControls.length === 0 && (
            <p className="mt-1 text-[11px] text-slate-400">Controls load from this framework’s Requirements tab.</p>
          )}
        </div>
      );
    }
    if (col.picker === 'users') {
      const items = tenantUsers.map((u) => ({ value: u.name, label: u.name }));
      const cur = (val as string) || '';
      if (cur && !items.some((i) => i.value === cur)) items.unshift({ value: cur, label: cur });
      return <FormDropdown value={cur} items={items} placeholder="Unassigned" onChange={(v) => set(v)} />;
    }
    if (col.type === 'select') {
      const items = col.options!.filter((o) => o.value !== '').map((o) => ({ value: o.value, label: o.label }));
      return <FormDropdown value={(val as string) || ''} items={items} placeholder={col.label} onChange={(v) => set(v)} />;
    }
    if (col.type === 'owner') {
      const items = tenantUsers.map((u) => ({ value: String(u.id), label: u.name }));
      const cur = val != null ? String(val) : '';
      return <FormDropdown value={cur} items={items} placeholder="Unassigned" onChange={(v) => set(v ? Number(v) : null)} />;
    }
    if (col.type === 'date') {
      return <input type="date" value={val ? String(val).slice(0, 10) : ''} onChange={(e) => set(e.target.value || null)} className={cls} />;
    }
    if (col.type === 'textarea') {
      return <textarea rows={3} value={(val as string) ?? ''} onChange={(e) => set(e.target.value)} className={`${cls} resize-y`} />;
    }
    return <input type="text" value={(val as string) ?? ''} onChange={(e) => set(e.target.value)} className={cls} />;
  };

  const openAdd = () => setEditing({ mode: 'add', draft: { status: registerType === 'gap_analysis' ? 'not_started' : undefined } });
  const openEdit = (row: RegisterEntry) => setEditing({ mode: 'edit', draft: { ...row } });

  const submitForm = () => {
    if (!editing) return;
    const d = editing.draft;
    const body: Record<string, unknown> = {};
    for (const col of config.columns) body[col.key as string] = d[col.key] ?? null;
    // Persist the risk link chosen in the Risk-Treatment picker.
    if (d.risk_register_id !== undefined) body.risk_register_id = d.risk_register_id ?? null;
    saveMut.mutate(editing.mode === 'add' ? { mode: 'add', body } : { mode: 'edit', id: d.id as number, body });
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
        <div className="flex flex-shrink-0 items-center gap-2">
          <button type="button" onClick={() => aiMut.mutate(rows)} disabled={aiMut.isPending || rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 disabled:opacity-50">
            {aiMut.isPending && busyRowId === null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
            AI assess all
          </button>
          <button type="button" onClick={() => resetMut.mutate()} disabled={resetMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} /> Reset
          </button>
          <button type="button" onClick={openAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600">
            <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Add row
          </button>
        </div>
      </div>

      {/* AI summary panel */}
      {aiSummary && (
        <div className="flex items-start gap-2 rounded-xl border border-purple-200 bg-purple-50 p-3">
          <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-purple-600" strokeWidth={1.75} />
          <p className="flex-1 text-sm text-purple-900">{aiSummary}</p>
          <button type="button" onClick={() => setAiSummary(null)} className="text-purple-400 hover:text-purple-700" aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Toolbar: search + summary chips */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rows…"
            className="w-56 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{rows.length} rows</span>
        {config.coverage && <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700">Coverage {coverage}%</span>}
        {movedCount > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700"><ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} /> {movedCount} moved to risk</span>}
      </div>

      {/* Register table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {config.columns.map((c) => (
                <th key={String(c.key)} style={{ minWidth: c.minWidth }} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{c.label}</th>
              ))}
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((row) => (
              <tr key={row.id} className="align-top transition-colors hover:bg-slate-50/60">
                {config.columns.map((c) => (
                  <td key={String(c.key)} className="px-3 py-2.5">{displayCell(row, c)}</td>
                ))}
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => { setBusyRowId(row.id); aiMut.mutate([row]); }}
                      disabled={aiMut.isPending}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-purple-50 hover:text-purple-600 disabled:opacity-40" title="AI assess this row" aria-label="AI assess row">
                      {busyRowId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
                    </button>
                    {row.risk_register_id ? (
                      <Link href={`/erm/risks/${row.risk_register_id}`} className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100" title="Open linked risk">
                        Risk #{row.risk_register_id} <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      <button type="button" onClick={() => setMoveCtx({ entry: row, title: (row.title || row.reference || '').slice(0, 200), description: '' })}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Move to risk register" aria-label="Move to risk">
                        <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    )}
                    <button type="button" onClick={() => openEdit(row)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit" aria-label="Edit row">
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                    <button type="button" onClick={() => setDeleteRow(row)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Delete" aria-label="Delete row">
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={config.columns.length + 1} className="px-3 py-12 text-center text-sm text-slate-400">
                {rows.length === 0 ? 'No rows yet. Use “Add row” or “Reset”.' : 'No rows match your search.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit slide-over */}
      <RightSlidePanel
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.mode === 'add' ? `Add ${config.label} row` : `Edit ${config.label} row`}
        subtitle={frameworkName}
        width="620px"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={submitForm} disabled={saveMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
              {saveMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {editing?.mode === 'add' ? 'Add row' : 'Save changes'}
            </button>
          </div>
        }
      >
        {editing && (
          <div className="space-y-6">
            {(config.formSections || [{ title: '', keys: config.columns.map((c) => c.key) }]).map((section) => (
              <div key={section.title || 'all'}>
                {section.title && <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{section.title}</h3>}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {section.keys.map((key) => {
                    const col = config.columns.find((c) => c.key === key);
                    if (!col) return null;
                    return (
                      <div key={String(key)} className={col.grow || col.type === 'textarea' ? 'sm:col-span-2' : ''}>
                        <label className="mb-1 block text-xs font-medium text-slate-600">{col.label}</label>
                        {formField(col)}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </RightSlidePanel>

      {/* Delete confirm */}
      <AnimatedModal isOpen={!!deleteRow} onClose={() => setDeleteRow(null)} title="Delete row" size="md">
        {deleteRow && (
          <div className="space-y-4 p-5">
            <p className="text-sm text-slate-600">Delete <span className="font-medium text-slate-900">{deleteRow.reference || deleteRow.title || 'this row'}</span>? This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteRow(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => deleteMut.mutate(deleteRow.id)} disabled={deleteMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                {deleteMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Delete
              </button>
            </div>
          </div>
        )}
      </AnimatedModal>

      {/* Move-to-risk */}
      <AnimatedModal isOpen={!!moveCtx} onClose={() => setMoveCtx(null)} title="Move to risk register" subtitle={frameworkName} size="md">
        {moveCtx && (
          <div className="space-y-4 p-5">
            <p className="text-sm text-slate-500">Create a risk in the ERM register from this {config.label.toLowerCase()} entry. It will be linked back here and tagged under {frameworkName}.</p>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Risk title</label>
              <input value={moveCtx.title} onChange={(e) => setMoveCtx({ ...moveCtx, title: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Description (optional)</label>
              <textarea rows={3} value={moveCtx.description} onChange={(e) => setMoveCtx({ ...moveCtx, description: e.target.value })}
                className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMoveCtx(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" disabled={!moveCtx.title.trim() || moveMut.isPending}
                onClick={() => moveMut.mutate({ id: moveCtx.entry.id, title: moveCtx.title.trim(), description: moveCtx.description.trim() })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
                {moveMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create risk
              </button>
            </div>
          </div>
        )}
      </AnimatedModal>
    </div>
  );
}
