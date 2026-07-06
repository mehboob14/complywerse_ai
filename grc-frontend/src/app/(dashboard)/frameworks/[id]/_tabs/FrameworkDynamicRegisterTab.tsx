'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, RotateCcw, Loader2, Pencil, Search } from 'lucide-react';
import { frameworkTemplatesApi, evidenceApi } from '@/lib/api';
import { AnimatedModal, RightSlidePanel, MultiSelectDropdown } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { TONE_CLASSES, type Tone, type TenantUserOption } from './templateConfigs';

// ── Dynamic (framework-driven) register config, from the backend definition ──
export interface DynColumn {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'date' | string;
  options?: Array<{ value: string; label: string; tone?: string }>;
  picker?: 'users' | 'evidence' | string;
}
export interface DynRegisterConfig {
  type: string;
  label: string;
  description?: string;
  columns: DynColumn[];
  formSections?: Array<{ title: string; keys: string[] }>;
}
interface DynEntry {
  id: number;
  seq: number;
  is_seed: boolean;
  data: Record<string, unknown>;
}
interface Props {
  config: DynRegisterConfig;
  journeyId: number;
  frameworkId: number | null;
  frameworkName: string;
  tenantUsers: TenantUserOption[];
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

export default function FrameworkDynamicRegisterTab({ config, journeyId, frameworkId, frameworkName, tenantUsers }: Props) {
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
  const { data: evidenceLib } = useQuery({
    queryKey: ['evidence-all'],
    queryFn: async () => (await evidenceApi.getAll()).data as unknown as Array<{ id: number; name?: string; title?: string; file_name?: string }>,
    enabled: hasEvidenceCol,
    staleTime: 60_000,
  });
  const evidenceItems = (evidenceLib || []).map((e) => ({ value: e.name || e.title || e.file_name || `Evidence #${e.id}`, label: e.name || e.title || e.file_name || `Evidence #${e.id}` }));

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ mode: 'add' | 'edit'; id?: number; draft: Record<string, unknown> } | null>(null);
  const [deleteRow, setDeleteRow] = useState<DynEntry | null>(null);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => Object.values(r.data || {}).some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [rows, search]);

  const optionMeta = (col: DynColumn, value: unknown) => col.options?.find((o) => o.value === String(value ?? ''));

  // ── read-only display cell ──
  const displayCell = (row: DynEntry, col: DynColumn) => {
    const raw = (row.data || {})[col.key];
    if (col.type === 'select') {
      const meta = optionMeta(col, raw);
      if (!meta || !meta.value) return <span className="text-xs text-slate-300">—</span>;
      return <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[(meta.tone as Tone) || 'slate'] || TONE_CLASSES.slate}`}>{meta.label}</span>;
    }
    if (col.type === 'date') return raw ? <span className="text-sm text-slate-600">{new Date(String(raw)).toLocaleDateString()}</span> : <span className="text-xs text-slate-300">—</span>;
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
    if (col.type === 'select') {
      const items = (col.options || []).filter((o) => o.value !== '').map((o) => ({ value: o.value, label: o.label }));
      return <FormDropdown value={(val as string) || ''} items={items} placeholder={col.label} onChange={set} />;
    }
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
    </div>
  );
}
