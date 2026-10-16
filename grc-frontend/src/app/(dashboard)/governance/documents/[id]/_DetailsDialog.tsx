'use client';

// The document's Details popup: title, code, type, classification, owner, department, review cycle and dates, frameworks, parent,
// tags and description. Read-only for people who cannot edit; otherwise Save sends only what changed (PUT /governance/documents/{id}).
// The lists share their React Query keys (and shapes) with the document pages, so they come from one cache.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient, { governanceApi, tenantApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { MultiSelectDropdown, type MultiSelectDropdownItem as Item } from '@/components/ui/MultiSelectDropdown';
import { useToast } from '@/components/ui/ToastProvider';

const TYPES: [string, string][] = [
  ['policy', 'Policy'], ['standard', 'Standard'], ['procedure', 'Procedure'],
  ['guideline', 'Guideline'], ['charter', 'Charter'], ['framework', 'Framework'],
];
const CLASSES: [string, string][] = [
  ['public', 'Public'], ['internal', 'Internal'], ['confidential', 'Confidential'], ['restricted', 'Restricted'],
];
const CYCLES: [number, string][] = [[6, 'Every 6 months'], [12, 'Every year'], [24, 'Every two years'], [36, 'Every three years']];

const INPUT = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-1.5 text-sm text-[#1f2933] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]';
const TRIGGER = 'w-full !h-[34px] !border-[#b8c4c8] !text-sm';
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50';
const SECONDARY = 'rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#26323d] hover:bg-[#f3f6f8]';

type Form = {
  title: string; document_code: string; doc_type: string; classification: string;
  owner_id: number | null; department_id: number | null; review_cycle_months: number | null;
  effective_date: string; next_review_date: string; applicable_framework_ids: number[];
  parent_document_id: number | null; tags: string[]; description: string;
};

const fromDoc = (doc: any): Form => ({
  title: doc?.title || '',
  document_code: doc?.document_code || '',
  doc_type: doc?.doc_type || '',
  classification: String(doc?.classification || '').toLowerCase(),
  owner_id: doc?.owner_id ?? null,
  department_id: doc?.department_id ?? null,
  review_cycle_months: doc?.review_cycle_months ?? null,
  effective_date: String(doc?.effective_date || '').slice(0, 10),   // a date, stored as naive-UTC midnight
  next_review_date: String(doc?.next_review_date || '').slice(0, 10),
  applicable_framework_ids: [...(doc?.applicable_framework_ids || [])],
  parent_document_id: doc?.parent_document_id ?? null,
  tags: [...(doc?.tags || [])],
  description: doc?.description || '',
});

const NULL_WHEN_EMPTY = new Set<string>(['document_code', 'description', 'effective_date', 'next_review_date']);

/** Only the fields that differ from `base`; text trimmed, an emptied optional text or date sent as null. */
function changes(base: Form, form: Form): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(form) as (keyof Form)[]) {
    let a: unknown = base[k];
    let b: unknown = form[k];
    if (typeof b === 'string') { b = b.trim(); a = String(a ?? '').trim(); }
    const same = Array.isArray(b)
      ? JSON.stringify([...b].sort()) === JSON.stringify([...(a as unknown[])].sort())
      : a === b;
    if (!same) patch[k] = b === '' && NULL_WHEN_EMPTY.has(k) ? null : b;
  }
  return patch;
}

/** YYYY-MM-DD plus whole months, the day clamped to the month's end (31 Jan + 1 = 28/29 Feb). */
function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return '';
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
const suggestNext = (f: Form) => (f.effective_date && f.review_cycle_months ? addMonths(f.effective_date, f.review_cycle_months) : '');

const day = (ymd: string) =>
  ymd ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
/** The fixed options, plus the stored value when it is none of them. */
const withCurrent = <T extends string | number>(opts: [T, string][], value: T | null | '', label: (v: T) => string): [T, string][] =>
  value === null || value === '' || opts.some(([v]) => v === value) ? opts : [...opts, [value as T, label(value as T)]];
const labelOf = <T,>(opts: [T, string][], value: T) => opts.find(([v]) => v === value)?.[1] || '';

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-semibold text-[#26323d]">{label}</span>
      {children}
    </label>
  );
}

function Value({ label, wide, mono, children }: { label: string; wide?: boolean; mono?: boolean; children: React.ReactNode }) {
  const empty = children === '' || children === null || children === undefined || (Array.isArray(children) && children.length === 0);
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-xs font-semibold text-[#26323d]">{label}</dt>
      <dd className={`mt-0.5 whitespace-pre-wrap break-words text-sm text-[#1f2933] ${mono ? 'font-mono' : ''}`}>
        {empty ? <span className="text-sm text-[#586472]">—</span> : children}
      </dd>
    </div>
  );
}

export default function DetailsDialog({ doc, open, onClose, canEdit }: { doc: any; open: boolean; onClose: () => void; canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [base, setBase] = useState<Form>(() => fromDoc(doc));
  const [form, setForm] = useState<Form>(() => fromDoc(doc));

  useEffect(() => {
    if (!open) return;
    const f = fromDoc(doc);
    setBase(f);
    setForm(f);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when the popup opens

  const tenantId: number | undefined = doc?.tenant_id;
  // Same key and shape as useAssigneeOptions in ../_SignoffControl (users only here).
  const usersQ = useQuery({
    queryKey: ['signoff-users', tenantId],
    queryFn: async () => {
      try {
        const r = await tenantApi.getTenantUsers(tenantId);
        const d: any = r.data;
        return (Array.isArray(d) ? d : d?.users || []) as any[];
      } catch { return []; }
    },
    enabled: open && canEdit,
  });
  // The organisation's departments (grc_departments: the table department_id points at, as studio/setup.py reads it).
  const deptQ = useQuery({
    queryKey: ['org-departments'],
    queryFn: async () => {
      try {
        const d: any = (await apiClient.get('/vuln-management/departments', { params: { limit: 500 } })).data;
        return (Array.isArray(d) ? d : []) as Array<{ id: number; name: string; is_active?: boolean }>;
      } catch { return []; }
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  // Same key and query as the documents list's create/edit modal.
  const fwQ = useQuery({
    queryKey: ['document-modal-frameworks'],
    queryFn: async () => {
      const response = await apiClient.get('/framework-upload/upload');
      const data = response.data;
      const items = Array.isArray(data) ? data : data?.items || data?.frameworks || [];
      const filtered = (items as any[]).filter((f) =>
        f.is_active && ['parsed', 'published', 'classified', 'completed'].includes(f.upload_status),
      );
      const byName = new Map<string, any>();
      for (const f of filtered) {
        const key = String(f.name || '').trim().toLowerCase();
        const existing = byName.get(key);
        if (!existing || (f.id || 0) > (existing.id || 0)) byName.set(key, f);
      }
      return Array.from(byName.values());
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  // Same key and query as the document page's compare list.
  const docsQ = useQuery({
    queryKey: ['governance-documents-for-compare'],
    queryFn: async () => {
      const response = await governanceApi.getDocuments({ skip: 0, limit: 1000, sort_by: 'title', sort_order: 'asc' } as any);
      const payload = response.data as any;
      return (payload?.items || []) as Array<{ id: number; title: string; doc_type: string }>;
    },
    enabled: open && canEdit,
    staleTime: 60 * 1000,
  });

  const ownerItems = useMemo<Item[]>(() => {
    const out: Item[] = (usersQ.data || []).map((u: any) => ({
      value: String(u.id), label: u.display_name || u.username || u.email || `User ${u.id}`, subLabel: u.email || undefined,
    }));
    if (form.owner_id != null && !out.some((i) => i.value === String(form.owner_id))) {
      out.unshift({ value: String(form.owner_id), label: doc?.owner_name || `User ${form.owner_id}` });
    }
    return out;
  }, [usersQ.data, form.owner_id, doc?.owner_name]);

  const departments = deptQ.data || [];
  const deptItems = useMemo<Item[]>(
    () => departments.filter((d) => d.is_active !== false || d.id === form.department_id).map((d) => ({ value: String(d.id), label: d.name })),
    [departments, form.department_id],
  );

  const frameworks = (fwQ.data || []) as any[];
  const fwItems = useMemo<Item[]>(() => {
    const out: Item[] = frameworks.map((f) => ({ value: String(f.id), label: f.name || `Framework ${f.id}` }));
    for (const id of form.applicable_framework_ids) {
      if (!out.some((i) => i.value === String(id))) out.push({ value: String(id), label: `Framework ${id}` });
    }
    return out;
  }, [frameworks, form.applicable_framework_ids]);

  const others = docsQ.data || [];
  // ponytail: excludes this document and its direct children only; a deeper descendant can still be picked (a cycle).
  const childIds = useMemo(() => new Set<number>((doc?.child_documents || []).map((c: any) => c.id)), [doc?.child_documents]);
  const parentItems = useMemo<Item[]>(() => {
    const out: Item[] = others
      .filter((d) => d.id !== doc?.id && !childIds.has(d.id))
      .map((d) => ({ value: String(d.id), label: d.title || `Document ${d.id}`, subLabel: d.doc_type ? titleCase(d.doc_type) : undefined }));
    const p = doc?.parent_document;
    if (form.parent_document_id != null && !out.some((i) => i.value === String(form.parent_document_id))) {
      out.unshift({ value: String(form.parent_document_id), label: p?.id === form.parent_document_id ? p.title : `Document ${form.parent_document_id}` });
    }
    return out;
  }, [others, doc?.id, doc?.parent_document, childIds, form.parent_document_id]);

  const tagItems = useMemo<Item[]>(() => {
    const all = new Set<string>(form.tags);
    for (const d of others as any[]) for (const t of d.tags || []) if (typeof t === 'string' && t.trim()) all.add(t.trim());
    return Array.from(all).sort((a, b) => a.localeCompare(b)).map((t) => ({ value: t, label: t }));
  }, [others, form.tags]);

  const patch = useMemo(() => changes(base, form), [base, form]);
  const dirty = Object.keys(patch).length > 0;

  const save = useMutation({
    mutationFn: async () => governanceApi.updateDocument(doc.id, patch as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['governance-document', doc.id] });
      qc.invalidateQueries({ queryKey: ['document-access', doc.id] });
      qc.invalidateQueries({ queryKey: ['studio', 'setup'] });
      toast({ type: 'success', title: 'Details saved' });
      onClose();
    },
    onError: (e: any) => {
      const d = e?.response?.data?.detail;
      const message = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x: any) => x?.msg).filter(Boolean).join('; ') : '';
      toast({ type: 'error', title: 'Not saved', message: message || 'Could not save the details.' });
    },
  });

  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  // A Next review that was empty or still the old suggestion follows the effective date and the cycle.
  const setSchedule = (p: Partial<Form>) => setForm((f) => {
    const n = { ...f, ...p };
    const s = suggestNext(n);
    if (s && (!f.next_review_date || f.next_review_date === suggestNext(f))) n.next_review_date = s;
    return n;
  });

  const types = withCurrent(TYPES, form.doc_type, titleCase);
  const classes = withCurrent(CLASSES, form.classification, titleCase);
  const cycles = withCurrent(CYCLES, form.review_cycle_months, (n) => `Every ${n} months`);
  const one = (v: number | null) => (v == null ? [] : [String(v)]);
  const toId = (vals: string[]) => (vals[0] ? Number(vals[0]) : null);

  const row = (label: string, shown: React.ReactNode, editor: React.ReactNode, opts: { wide?: boolean; mono?: boolean } = {}) =>
    canEdit
      ? <Field key={label} label={label} wide={opts.wide}>{editor}</Field>
      : <Value key={label} label={label} wide={opts.wide} mono={opts.mono}>{shown}</Value>;

  const fields = [
    row('Title', form.title,
      <input type="text" value={form.title} onChange={(e) => set({ title: e.target.value })} required aria-invalid={!form.title.trim()} className={INPUT} />,
      { wide: true }),
    row('Code', form.document_code,
      <input type="text" value={form.document_code} onChange={(e) => set({ document_code: e.target.value })} placeholder="e.g. POL-001" className={`${INPUT} font-mono`} />,
      { mono: true }),
    row('Type', labelOf(types, form.doc_type),
      <select value={form.doc_type} onChange={(e) => set({ doc_type: e.target.value })} className={INPUT}>
        {!form.doc_type && <option value="">Choose…</option>}
        {types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>),
    row('Classification', labelOf(classes, form.classification),
      <select value={form.classification} onChange={(e) => set({ classification: e.target.value })} className={INPUT}>
        {!form.classification && <option value="">Choose…</option>}
        {classes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>),
    row('Owner', doc?.owner_name || '',
      <MultiSelectDropdown title="Owner" items={ownerItems} selectedValues={one(form.owner_id)} onApply={(v) => set({ owner_id: toId(v) })}
        multiSelect={false} triggerVariant="input" size="sm" forceSearch placeholder="Choose a person" triggerClassName={TRIGGER} />),
    row('Department', departments.find((d) => d.id === form.department_id)?.name || '',
      <MultiSelectDropdown title="Department" items={deptItems} selectedValues={one(form.department_id)} onApply={(v) => set({ department_id: toId(v) })}
        multiSelect={false} triggerVariant="input" size="sm" forceSearch showAvatars={false} placeholder="Choose a department" triggerClassName={TRIGGER} />),
    row('Review cycle', form.review_cycle_months == null ? '' : labelOf(cycles, form.review_cycle_months),
      <select value={form.review_cycle_months ?? ''} onChange={(e) => setSchedule({ review_cycle_months: e.target.value ? Number(e.target.value) : null })} className={INPUT}>
        {form.review_cycle_months == null && <option value="">Not set</option>}
        {cycles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>),
    row('Effective date', day(form.effective_date),
      <input type="date" value={form.effective_date} onChange={(e) => setSchedule({ effective_date: e.target.value })} className={INPUT} />),
    row('Next review', day(form.next_review_date),
      <input type="date" value={form.next_review_date} onChange={(e) => set({ next_review_date: e.target.value })} className={INPUT} />),
    row('Frameworks', form.applicable_framework_ids.map((id) => fwItems.find((i) => i.value === String(id))?.label || `Framework ${id}`).join(', '),
      <MultiSelectDropdown title="Frameworks" items={fwItems} selectedValues={form.applicable_framework_ids.map(String)}
        onApply={(v) => set({ applicable_framework_ids: v.map(Number).filter((n) => !Number.isNaN(n)) })}
        multiSelect triggerVariant="input" size="sm" forceSearch showAvatars={false} placeholder="Choose frameworks" triggerClassName={TRIGGER} />,
      { wide: true }),
    row('Parent document', doc?.parent_document?.title || '',
      <MultiSelectDropdown title="Parent document" items={parentItems} selectedValues={one(form.parent_document_id)}
        onApply={(v) => set({ parent_document_id: toId(v) })}
        multiSelect={false} triggerVariant="input" size="sm" forceSearch showAvatars={false} placeholder="None" triggerClassName={TRIGGER} />),
    row('Tags', form.tags.length ? (
      <span className="flex flex-wrap gap-1">
        {form.tags.map((t) => <span key={t} className="rounded-full border border-[#d5dbe1] px-2 py-0.5 text-[11px] text-[#26323d]">{t}</span>)}
      </span>
    ) : '',
      <MultiSelectDropdown title="Tags" items={tagItems} selectedValues={form.tags} onApply={(v) => set({ tags: v })}
        onCreate={(text) => { const t = text.trim(); if (t && !form.tags.includes(t)) set({ tags: [...form.tags, t] }); }}
        multiSelect triggerVariant="input" size="sm" forceSearch showAvatars={false} placeholder="Add tags" triggerClassName={TRIGGER} />),
    row('Description', form.description,
      <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={3} className={INPUT} />,
      { wide: true }),
  ];

  const footer = canEdit ? (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className={SECONDARY}>Cancel</button>
      <button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending || !form.title.trim()} className={PRIMARY}>
        {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save
      </button>
    </div>
  ) : (
    <div className="flex justify-end">
      <button type="button" onClick={onClose} className={SECONDARY}>Close</button>
    </div>
  );

  return (
    <AnimatedModal isOpen={open} onClose={onClose} title="Details" subtitle={doc?.title} size="lg" footer={footer}
      className="max-sm:max-h-[100dvh] max-sm:h-[100dvh] max-sm:rounded-none">
      {canEdit ? (
        <form className="grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5" onSubmit={(e) => { e.preventDefault(); if (dirty && form.title.trim() && !save.isPending) save.mutate(); }}>
          {fields}
        </form>
      ) : (
        <dl className="grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5">{fields}</dl>
      )}
    </AnimatedModal>
  );
}
