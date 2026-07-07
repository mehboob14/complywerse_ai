'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus, Trash2, RotateCcw, Loader2, Pencil, Search, Sparkles, ShieldAlert, ExternalLink, X, Paperclip, RefreshCw, MinusCircle } from 'lucide-react';
import { frameworkTemplatesApi, evidenceApi, certificationsApi } from '@/lib/api';
import { AnimatedModal, RightSlidePanel, MultiSelectDropdown } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { TONE_CLASSES, type Tone, type TenantUserOption } from './templateConfigs';

// ── Dynamic (framework-driven) register config, from the backend definition ──
export interface DynColumn {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'date' | 'datetime' | 'auto' | string;
  options?: Array<{ value: string; label: string; tone?: string }>;
  picker?: 'users' | 'evidence' | 'framework_controls' | string;
}
export interface DynRegisterConfig {
  type: string;
  label: string;
  description?: string;
  columns: DynColumn[];
  formSections?: Array<{ title: string; keys: string[] }>;
  assetSource?: string;
}
interface DynEntry {
  id: number;
  seq: number;
  is_seed: boolean;
  data: Record<string, unknown>;
  risk_register_id?: number | null;
}
interface Props {
  config: DynRegisterConfig;
  journeyId: number;
  frameworkId: number | null;
  frameworkName: string;
  tenantUsers: TenantUserOption[];
  frameworkControls?: Array<{ code: string; title: string }>;
}

function FormDropdown({ value, items, placeholder, onChange, searchable }: {
  value: string;
  items: Array<{ value: string; label: string }>;
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

export default function FrameworkDynamicRegisterTab({ config, journeyId, frameworkId, frameworkName, tenantUsers, frameworkControls = [] }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const queryKey = ['ft-register', config.type, journeyId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => (await frameworkTemplatesApi.registers.list(config.type, { journey_id: journeyId, framework_id: frameworkId })).data as { entries: DynEntry[] },
    enabled: !!journeyId,
  });
  const rows = useMemo(() => data?.entries || [], [data]);

  const hasEvidenceCol = config.columns.some((c) => c.picker === 'evidence');
  const [editing, setEditing] = useState<{ mode: 'add' | 'edit'; id?: number; draft: Record<string, unknown> } | null>(null);
  const { data: evidenceLib } = useQuery({
    queryKey: ['evidence-all'],
    queryFn: async () => (await evidenceApi.getAll()).data as unknown as Array<{ id: number; name?: string; title?: string; file_name?: string }>,
    enabled: hasEvidenceCol || editing != null,
    staleTime: 60_000,
  });
  const evidenceItems = (evidenceLib || []).map((e) => ({ value: e.name || e.title || e.file_name || `Evidence #${e.id}`, label: e.name || e.title || e.file_name || `Evidence #${e.id}` }));

  const [search, setSearch] = useState('');
  const [deleteRow, setDeleteRow] = useState<DynEntry | null>(null);
  const [moveCtx, setMoveCtx] = useState<{ entry: DynEntry; title: string; description: string } | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<number | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey });
  const userName = (v: unknown) => String(v ?? '');

  const saveMut = useMutation({
    mutationFn: (p: { mode: 'add' | 'edit'; id?: number; data: Record<string, unknown> }) =>
      p.mode === 'add'
        ? frameworkTemplatesApi.registers.create(config.type, { journey_id: journeyId, framework_id: frameworkId }, { data: p.data })
        : frameworkTemplatesApi.registers.update(p.id!, { data: p.data }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: () => toast({ type: 'error', title: 'Could not save', message: 'Please try again.' }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => frameworkTemplatesApi.registers.remove(id),
    onSuccess: () => { setDeleteRow(null); invalidate(); },
  });
  const resetMut = useMutation({
    mutationFn: () => frameworkTemplatesApi.registers.reset(config.type, { journey_id: journeyId, framework_id: frameworkId }),
    onSuccess: invalidate,
  });
  const aiMut = useMutation({
    mutationFn: async (subset: DynEntry[]) => {
      const res = await frameworkTemplatesApi.ai.register({
        register_type: config.type, framework_name: frameworkName,
        rows: subset.map((r) => ({ id: r.id, ...(r.data || {}) })),
      });
      const out = res.data as { suggestions: Array<Record<string, unknown>>; summary: string; keys: string[] };
      const keys = out.keys || [];
      const items = (out.suggestions || [])
        .filter((s) => s && s.id != null)
        .map((s) => {
          const fields: Record<string, unknown> = {};
          keys.forEach((k) => { if (s[k] != null && s[k] !== '') fields[k] = s[k]; });
          return { id: Number(s.id), fields };
        })
        .filter((it) => Object.keys(it.fields).length > 0);
      if (items.length) await frameworkTemplatesApi.registers.applyAI(config.type, { journey_id: journeyId }, items);
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
  // AI assist inside the item popup — fills the draft form for the user to review + save.
  const popupAiMut = useMutation({
    mutationFn: async () => {
      if (!editing) return {} as Record<string, unknown>;
      const res = await frameworkTemplatesApi.ai.register({
        register_type: config.type, framework_name: frameworkName,
        rows: [{ id: editing.id ?? 0, ...editing.draft }],
      });
      const out = res.data as { suggestions: Array<Record<string, unknown>>; keys: string[] };
      const sug = (out.suggestions || [])[0] || {};
      const patch: Record<string, unknown> = {};
      (out.keys || []).forEach((k) => { if (sug[k] != null && sug[k] !== '') patch[k] = sug[k]; });
      return patch;
    },
    onSuccess: (patch) => {
      setEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev));
      toast({ type: 'success', title: 'AI filled the form', message: 'Review the suggestions, then Save.' });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast({ type: 'error', title: 'AI assist failed', message: e?.response?.data?.detail || 'Try again.' }),
  });

  // ── Cardholder Data Inventory: sync rows from the CDE assets in the system ──
  const isCdeInventory = config.assetSource === 'cde';
  const cdeSyncMut = useMutation({
    mutationFn: async () => {
      const res = await certificationsApi.getCDESystems();
      const systems = ((res.data as { systems?: Array<{ id: number; name: string; asset_type?: string; owner_name?: string }> })?.systems) || [];
      const haveIds = new Set(rows.map((r) => (r.data as Record<string, unknown>).__asset_id).filter(Boolean).map(Number));
      const haveNames = new Set(rows.map((r) => String((r.data as Record<string, unknown>).system_process || '').trim().toLowerCase()).filter(Boolean));
      const toAdd = systems.filter((s) => !haveIds.has(s.id) && !haveNames.has((s.name || '').trim().toLowerCase()));
      for (const s of toAdd) {
        await frameworkTemplatesApi.registers.create(config.type, { journey_id: journeyId, framework_id: frameworkId }, {
          data: { system_process: s.name, in_cde: 'Yes', owner: s.owner_name || '', __asset_id: s.id, __asset_type: s.asset_type || '' },
        });
      }
      return { added: toAdd.length, total: systems.length };
    },
    onSuccess: (r) => { invalidate(); toast({ type: 'success', title: 'Synced CDE assets', message: `${r.added} added${r.total ? ` from ${r.total} CDE system${r.total === 1 ? '' : 's'}` : ''}.` }); },
    onError: () => toast({ type: 'error', title: 'Sync failed', message: 'Could not load CDE assets.' }),
  });
  const removeCdeMut = useMutation({
    mutationFn: async (row: DynEntry) => {
      const assetId = (row.data as Record<string, unknown>).__asset_id;
      if (assetId) { try { await certificationsApi.updateCDESystemScope(Number(assetId), { cde_environment: false }); } catch { /* asset may be gone */ } }
      await frameworkTemplatesApi.registers.remove(row.id);
    },
    onSuccess: () => { invalidate(); toast({ type: 'success', title: 'Removed from CDE', message: 'Asset unflagged and row removed.' }); },
    onError: () => toast({ type: 'error', title: 'Could not remove', message: 'Try again.' }),
  });

  // Most meaningful value in a row — used as the default risk title.
  const rowTitle = (row: DynEntry) => {
    const data = row.data || {};
    for (const c of config.columns) {
      if (c.type === 'textarea' && !c.picker) {
        const s = String(data[c.key] ?? '').trim();
        if (s.length > 2) return s;
      }
    }
    for (const c of config.columns) {
      if (c.type === 'text' && !c.picker) {
        const s = String(data[c.key] ?? '').trim();
        if (s.length > 3 && !/^\d+([.,]\d+)?$/.test(s)) return s;
      }
    }
    const vals = Object.values(data).map((x) => String(x ?? '').trim());
    return vals.find((s) => s.length > 3 && !/^\d+$/.test(s)) || vals.find(Boolean) || '';
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => Object.values(r.data || {}).some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [rows, search]);

  const optionMeta = (col: DynColumn, value: unknown) => col.options?.find((o) => o.value === String(value ?? ''));

  // ── read-only display cell ──
  const displayCell = (row: DynEntry, col: DynColumn) => {
    const raw = (row.data || {})[col.key];
    if (col.type === 'auto') return raw ? <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{String(raw)}</span> : <span className="text-xs text-slate-300">—</span>;
    if (col.type === 'select') {
      const meta = optionMeta(col, raw);
      if (!meta || !meta.value) return <span className="text-xs text-slate-300">—</span>;
      return <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[(meta.tone as Tone) || 'slate'] || TONE_CLASSES.slate}`}>{meta.label}</span>;
    }
    if (col.type === 'datetime') return raw ? <span className="text-sm text-slate-600">{new Date(String(raw)).toLocaleString()}</span> : <span className="text-xs text-slate-300">—</span>;
    if (col.type === 'date') return raw ? <span className="text-sm text-slate-600">{new Date(String(raw)).toLocaleDateString()}</span> : <span className="text-xs text-slate-300">—</span>;
    if (col.picker === 'framework_controls') return raw ? <span className="rounded bg-primary-50 px-1.5 py-0.5 font-mono text-[11px] text-primary-700">{String(raw)}</span> : <span className="text-xs text-slate-300">—</span>;
    const txt = raw == null ? '' : String(raw);
    if (!txt) return <span className="text-xs text-slate-300">—</span>;
    if (col.picker === 'users') return <span className="text-sm text-slate-700">{userName(txt)}</span>;
    return <span className="line-clamp-2 text-sm text-slate-700">{txt}</span>;
  };

  // ── editable form field ──
  const formField = (col: DynColumn) => {
    const val = editing?.draft[col.key];
    const set = (v: unknown) => setEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, [col.key]: v } } : prev));
    const cls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/30';
    if (col.picker === 'users') {
      const items = tenantUsers.map((u) => ({ value: u.name, label: u.name }));
      const cur = (val as string) || '';
      if (cur && !items.some((i) => i.value === cur)) items.unshift({ value: cur, label: cur });
      return <FormDropdown value={cur} items={items} placeholder="Unassigned" onChange={set} />;
    }
    if (col.picker === 'evidence') {
      const cur = (val as string) || '';
      const items = [...evidenceItems];
      if (cur && !items.some((i) => i.value === cur)) items.unshift({ value: cur, label: cur });
      return <FormDropdown value={cur} items={items} placeholder="Link evidence…" searchable onChange={set} />;
    }
    if (col.picker === 'framework_controls') {
      const cur = (val as string) || '';
      const items = frameworkControls.map((c) => ({ value: c.code, label: c.title ? `${c.code} — ${c.title}` : c.code }));
      if (cur && !frameworkControls.some((c) => c.code === cur)) items.unshift({ value: cur, label: cur });
      return (
        <div>
          <FormDropdown value={cur} items={items} placeholder="Select a requirement…" searchable onChange={set} />
          {frameworkControls.length === 0 && <p className="mt-1 text-[11px] text-slate-400">Requirements load from this framework’s Requirements tab.</p>}
        </div>
      );
    }
    if (col.type === 'auto') {
      return <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-500">{(val as string) || 'Auto-generated on save'}</div>;
    }
    if (col.type === 'select') {
      const items = (col.options || []).filter((o) => o.value !== '').map((o) => ({ value: o.value, label: o.label }));
      return <FormDropdown value={(val as string) || ''} items={items} placeholder={col.label} onChange={set} />;
    }
    if (col.type === 'datetime') return <input type="datetime-local" value={val ? String(val).slice(0, 16) : ''} onChange={(e) => set(e.target.value || null)} className={cls} />;
    if (col.type === 'date') return <input type="date" value={val ? String(val).slice(0, 10) : ''} onChange={(e) => set(e.target.value || null)} className={cls} />;
    if (col.type === 'textarea') return <textarea rows={3} value={(val as string) ?? ''} onChange={(e) => set(e.target.value)} className={`${cls} resize-y`} />;
    return <input type="text" value={(val as string) ?? ''} onChange={(e) => set(e.target.value)} className={cls} />;
  };

  const openAdd = () => setEditing({ mode: 'add', draft: {} });
  const openEdit = (row: DynEntry) => setEditing({ mode: 'edit', id: row.id, draft: { ...(row.data || {}) } });
  const submitForm = () => {
    if (!editing) return;
    saveMut.mutate({ mode: editing.mode, id: editing.id, data: editing.draft });
  };

  const sections = config.formSections && config.formSections.length
    ? config.formSections
    : [{ title: '', keys: config.columns.map((c) => c.key) }];

  if (isLoading) return <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="text-base font-semibold text-slate-900">{config.label}</h3>
          {config.description && <p className="mt-1 text-sm text-slate-500">{config.description}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {isCdeInventory && (
            <button type="button" onClick={() => cdeSyncMut.mutate()} disabled={cdeSyncMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50">
              {cdeSyncMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />} Sync from CDE assets
            </button>
          )}
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

      {aiSummary && (
        <div className="flex items-start gap-2 rounded-xl border border-purple-200 bg-purple-50 p-3">
          <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-purple-600" strokeWidth={1.75} />
          <p className="flex-1 text-sm text-purple-900">{aiSummary}</p>
          <button type="button" onClick={() => setAiSummary(null)} className="text-purple-400 hover:text-purple-700" aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rows…"
            className="w-56 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{rows.length} rows</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {config.columns.map((c) => (
                <th key={c.key} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{c.label}</th>
              ))}
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((row) => (
              <tr key={row.id} className="align-top transition-colors hover:bg-slate-50/60">
                {config.columns.map((c) => <td key={c.key} className="px-3 py-2.5">{displayCell(row, c)}</td>)}
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {row.data && (row.data as Record<string, unknown>).__evidence ? (
                      <span className="text-emerald-500" title={`Evidence: ${String((row.data as Record<string, unknown>).__evidence)}`}><Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} /></span>
                    ) : null}
                    {row.risk_register_id ? (
                      <Link href={`/erm/risks/${row.risk_register_id}`} className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100" title="Open linked risk">
                        Risk #{row.risk_register_id} <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      <button type="button" onClick={() => setMoveCtx({ entry: row, title: rowTitle(row).slice(0, 200), description: '' })}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Move to risk register" aria-label="Move to risk">
                        <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    )}
                    {isCdeInventory && (row.data as Record<string, unknown>).__asset_id ? (
                      <button type="button" onClick={() => removeCdeMut.mutate(row)} className="rounded-md p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600" title="Remove from CDE (unflag the asset)" aria-label="Remove from CDE">
                        <MinusCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    ) : null}
                    <button type="button" onClick={() => openEdit(row)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit" aria-label="Edit row"><Pencil className="h-3.5 w-3.5" strokeWidth={1.75} /></button>
                    <button type="button" onClick={() => setDeleteRow(row)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Delete" aria-label="Delete row"><Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={config.columns.length + 1} className="px-3 py-12 text-center text-sm text-slate-400">{rows.length === 0 ? 'No rows yet. Use “Add row” or “Reset”.' : 'No rows match your search.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <RightSlidePanel
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.mode === 'add' ? `Add ${config.label} row` : `Edit ${config.label} row`}
        subtitle={frameworkName}
        width="620px"
        footer={
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => popupAiMut.mutate()} disabled={popupAiMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm font-semibold text-purple-700 hover:bg-purple-100 disabled:opacity-50">
              {popupAiMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" strokeWidth={1.75} />} AI assess this item
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={submitForm} disabled={saveMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
                {saveMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {editing?.mode === 'add' ? 'Add row' : 'Save changes'}
              </button>
            </div>
          </div>
        }
      >
        {editing && (
          <div className="space-y-6">
            {sections.map((section) => (
              <div key={section.title || 'all'}>
                {section.title && <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{section.title}</h3>}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {section.keys.map((key) => {
                    const col = config.columns.find((c) => c.key === key);
                    if (!col) return null;
                    return (
                      <div key={key} className={col.type === 'textarea' ? 'sm:col-span-2' : ''}>
                        <label className="mb-1 block text-xs font-medium text-slate-600">{col.label}</label>
                        {formField(col)}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {!hasEvidenceCol && (
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Evidence</h3>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Linked evidence</label>
                  <FormDropdown
                    value={(editing.draft.__evidence as string) || ''}
                    items={(evidenceLib || []).map((e) => { const n = e.name || e.title || e.file_name || `Evidence #${e.id}`; return { value: n, label: n }; })}
                    placeholder="Link evidence…"
                    searchable
                    onChange={(v) => setEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, __evidence: v } } : prev))}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </RightSlidePanel>

      <AnimatedModal isOpen={!!deleteRow} onClose={() => setDeleteRow(null)} title="Delete row" size="md">
        {deleteRow && (
          <div className="space-y-4 p-5">
            <p className="text-sm text-slate-600">Delete this row? This cannot be undone.</p>
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
                placeholder="Additional context for the risk owner…"
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
