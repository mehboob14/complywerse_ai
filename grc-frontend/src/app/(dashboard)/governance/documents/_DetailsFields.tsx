'use client';

// The details a new document is asked for - title, type, classification, description, owner, department, review cycle, effective
// date and next review - shared by the library's New Document, the AI Studio's Upload and Move to the library. Choosing a file
// reads them from it (POST /governance/documents/read-details) into the fields the person has not touched, each saying where its
// value came from. The lists share their React Query keys (and shapes) with the document pages, so they come from one cache.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient, { tenantApi } from '@/lib/api';
import { MultiSelectDropdown, type MultiSelectDropdownItem as Item } from '@/components/ui/MultiSelectDropdown';
import { EMPTY_DETAILS, applyRead, change, type DetailKey, type Details, type Origin, type ReadResult } from './_detailsRead';

export const DOC_TYPES: [string, string][] = [
  ['policy', 'Policy'], ['standard', 'Standard'], ['procedure', 'Procedure'],
  ['guideline', 'Guideline'], ['charter', 'Charter'], ['framework', 'Framework'],
];
export const CLASSES: [string, string][] = [
  ['public', 'Public'], ['internal', 'Internal'], ['confidential', 'Confidential'], ['restricted', 'Restricted'],
];
export const CYCLES: [number, string][] = [[6, 'Every 6 months'], [12, 'Every year'], [24, 'Every two years'], [36, 'Every three years']];

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
/** The fixed options, plus the stored value when it is none of them. */
export const withCurrent = <T extends string | number>(opts: [T, string][], value: T | null | '', label: (v: T) => string): [T, string][] =>
  value === null || value === '' || opts.some(([v]) => v === value) ? opts : [...opts, [value as T, label(value as T)]];

/** The organisation's people (same key and shape as useAssigneeOptions in ./_SignoffControl, users only). */
export function useOrgUsers(tenantId?: number, enabled = true) {
  return useQuery({
    queryKey: ['signoff-users', tenantId],
    queryFn: async () => {
      try {
        const d: any = (await tenantApi.getTenantUsers(tenantId)).data;
        return (Array.isArray(d) ? d : d?.users || []) as any[];
      } catch { return []; }
    },
    enabled,
  });
}

/** The organisation's departments (grc_departments: the table department_id points at, as studio/setup.py reads it). */
export function useOrgDepartments(enabled = true) {
  return useQuery({
    queryKey: ['org-departments'],
    queryFn: async () => {
      try {
        const d: any = (await apiClient.get('/vuln-management/departments', { params: { limit: 500 } })).data;
        return (Array.isArray(d) ? d : []) as Array<{ id: number; name: string; is_active?: boolean }>;
      } catch { return []; }
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** The form's state: the owner starts as the person; `read(file)` fills what the person has not touched. */
export function useDocumentDetails(start: Partial<Details> = {}) {
  // same key and query as the documents page
  const me = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => ((await apiClient.get('/auth/me')).data?.user?.id ?? null) as number | null,
    staleTime: 5 * 60 * 1000,
  });
  const [form, setForm] = useState<Details>(() => ({ ...EMPTY_DETAILS, ...start }));
  const [from, setFrom] = useState<Partial<Record<DetailKey, Origin>>>({});
  const [ownerStated, setOwnerStated] = useState<string | null>(null);
  const touched = useRef(new Set<string>());
  const latest = useRef(form);
  latest.current = form;
  const initial = (): Details => ({ ...EMPTY_DETAILS, ...start, owner_id: start.owner_id ?? me.data ?? null });

  useEffect(() => {
    if (me.data == null) return;
    setForm((f) => (f.owner_id == null && !touched.current.has('owner_id') ? { ...f, owner_id: me.data as number } : f));
  }, [me.data]);

  const reader = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return (await apiClient.post('/governance/documents/read-details', body, { headers: { 'Content-Type': 'multipart/form-data' } })).data as ReadResult;
    },
    onSuccess: (r) => {
      const out = applyRead(initial(), latest.current, touched.current, r);
      setForm(out.form);
      setFrom(out.from);
      setOwnerStated(out.ownerStated);
    },
  });

  const set = (patch: Partial<Details>) => {
    for (const k of Object.keys(patch)) touched.current.add(k);
    setForm((f) => change(f, patch));
    setFrom((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !(k in patch))));
  };
  const read = (file: File) => {
    // the file's name until its details arrive (and if they cannot be read)
    if (!touched.current.has('title')) setForm((f) => ({ ...f, title: file.name.replace(/\.[^.]+$/, '') }));
    reader.mutate(file);
  };
  return { form, set, from, ownerStated, read, reading: reader.isPending, readFailed: reader.isError };
}

export type DocumentDetails = ReturnType<typeof useDocumentDetails>;

const INPUT = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-1.5 text-sm text-[#1f2933] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]';
const TRIGGER = 'w-full !h-[34px] !border-[#b8c4c8] !text-sm';

function Field({ label, wide, note, children }: { label: string; wide?: boolean; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-[#26323d]">{label}</span>
        {children}
      </label>
      {note}
    </div>
  );
}

export function DocumentDetailsFields({ d, tenantId }: { d: DocumentDetails; tenantId?: number }) {
  const { form, set, from } = d;
  const usersQ = useOrgUsers(tenantId);
  const deptQ = useOrgDepartments();

  const ownerItems = useMemo<Item[]>(() => {
    const out: Item[] = (usersQ.data || []).map((u: any) => ({
      value: String(u.id), label: u.display_name || u.username || u.email || `User ${u.id}`, subLabel: u.email || undefined,
    }));
    if (form.owner_id != null && !out.some((i) => i.value === String(form.owner_id))) out.unshift({ value: String(form.owner_id), label: `User ${form.owner_id}` });
    return out;
  }, [usersQ.data, form.owner_id]);
  const deptItems = useMemo<Item[]>(
    () => (deptQ.data || []).filter((x) => x.is_active !== false || x.id === form.department_id).map((x) => ({ value: String(x.id), label: x.name })),
    [deptQ.data, form.department_id],
  );

  const tag = (key: DetailKey) => (from[key]
    ? <span className="mt-0.5 block text-[11px] text-[#586472]">{from[key] === 'ai' ? 'By Comply Agent' : 'From the file'}</span>
    : null);
  const one = (v: number | null) => (v == null ? [] : [String(v)]);
  const toId = (vals: string[]) => (vals[0] ? Number(vals[0]) : null);
  const types = withCurrent(DOC_TYPES, form.doc_type, titleCase);
  const classes = withCurrent(CLASSES, form.classification, titleCase);
  const cycles = withCurrent(CYCLES, form.review_cycle_months, (n) => `Every ${n} months`);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {d.reading && (
        <span className="flex items-center gap-1.5 text-xs text-[#586472] sm:col-span-2" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Reading the file to fill in its details…
        </span>
      )}
      {d.readFailed && <span className="text-xs text-[#8a1c1c] sm:col-span-2" role="status">The details could not be read from the file. Fill them in below.</span>}
      <Field label="Title" wide note={tag('title')}>
        <input type="text" value={form.title} onChange={(e) => set({ title: e.target.value })} required aria-invalid={!form.title.trim()} className={INPUT} />
      </Field>
      <Field label="Type" note={tag('doc_type')}>
        <select value={form.doc_type} onChange={(e) => set({ doc_type: e.target.value })} className={INPUT}>
          {types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Classification" note={tag('classification')}>
        <select value={form.classification} onChange={(e) => set({ classification: e.target.value })} className={INPUT}>
          {classes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Owner" note={<>{tag('owner_id')}{d.ownerStated && <span className="mt-0.5 block text-[11px] text-[#586472]">The file names the owner: {d.ownerStated}</span>}</>}>
        <MultiSelectDropdown title="Owner" items={ownerItems} selectedValues={one(form.owner_id)} onApply={(v) => set({ owner_id: toId(v) })}
          multiSelect={false} autoApply triggerVariant="input" size="sm" forceSearch placeholder="Choose a person" triggerClassName={TRIGGER} />
      </Field>
      <Field label="Department" note={tag('department_id')}>
        <MultiSelectDropdown title="Department" items={deptItems} selectedValues={one(form.department_id)} onApply={(v) => set({ department_id: toId(v) })}
          multiSelect={false} autoApply triggerVariant="input" size="sm" forceSearch showAvatars={false} placeholder="Choose a department" triggerClassName={TRIGGER} />
      </Field>
      <Field label="Review cycle" note={tag('review_cycle_months')}>
        <select value={form.review_cycle_months} onChange={(e) => set({ review_cycle_months: Number(e.target.value) })} className={INPUT}>
          {cycles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Effective date" note={tag('effective_date')}>
        <input type="date" value={form.effective_date} onChange={(e) => set({ effective_date: e.target.value })} className={INPUT} />
      </Field>
      <Field label="Next review" note={tag('next_review_date') || (!form.next_review_date && <span className="mt-0.5 block text-[11px] text-[#586472]">Left empty: today plus the review cycle</span>)}>
        <input type="date" value={form.next_review_date} onChange={(e) => set({ next_review_date: e.target.value })} className={INPUT} />
      </Field>
      <Field label="Description" wide note={tag('description')}>
        <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={2} className={INPUT} />
      </Field>
    </div>
  );
}
