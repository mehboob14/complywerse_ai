'use client';

// The document's Details popup: title, type, classification, owner, department, review cycle and dates, frameworks, parent,
// tags, description, and who reviews and approves it. Read-only for people who cannot edit; otherwise Save sends only what changed
// (PUT /governance/documents/{id}; the reviewers and approvers to …/signoff/participants, while it is a draft or on its way).
// The code (document_code) is neither shown nor sent: a document keeps the one it has.
// The lists share their React Query keys (and shapes) with the document pages, so they come from one cache.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import apiClient, { governanceApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { MultiSelectDropdown, type MultiSelectDropdownItem as Item } from '@/components/ui/MultiSelectDropdown';
import { useToast } from '@/components/ui/ToastProvider';
import { BTN as SECONDARY, BTN_PRIMARY as PRIMARY } from '@/components/governance/docUi';
import { departmentPlaceholder } from '@/lib/departments';
import { personOf } from '@/lib/people';
import { CLASSES, CYCLES, DOC_TYPES as TYPES, ParentPicker, titleCase, useLibraryDocuments, useOrgDepartments, useOrgUsers, withCurrent } from '../_DetailsFields';
import { addMonths } from '../_detailsRead';
import { MAX_TAGS, addTags, leftOut, splitTags, tagSuggestions } from '../_tags';
import { ReviewerApproverFields, useSignoff, type Participant, type SignoffChoice } from '../_SignoffControl';

const INPUT = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-1.5 text-sm text-[#1f2933] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]';
const TRIGGER = 'w-full !h-[34px] !border-[#b8c4c8] !text-sm';
// (the buttons are the Documents area's shared ones, components/governance/docUi: SECONDARY = BTN, PRIMARY = BTN_PRIMARY)

type Form = {
  title: string; doc_type: string; classification: string;
  owner_id: number | null; department_id: number | null; review_cycle_months: number | null;
  effective_date: string; next_review_date: string; applicable_framework_ids: number[];
  parent_document_id: number | null; tags: string[]; description: string;
};

const fromDoc = (doc: any): Form => ({
  title: doc?.title || '',
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

const NULL_WHEN_EMPTY = new Set<string>(['description', 'effective_date', 'next_review_date']);

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

const suggestNext = (f: Form) => (f.effective_date && f.review_cycle_months ? addMonths(f.effective_date, f.review_cycle_months) : '');

const day = (ymd: string) =>
  ymd ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
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

/** Chips with a remove button, a box to type a new one (Enter or a comma adds it; Backspace in the empty box removes the last), and
 *  the tags other documents use to pick from. The typed text is the popup's (`text`), so Save adds what is still in the box. */
function TagField({ value, onChange, text, onText, used, labelledBy }: {
  value: string[]; onChange: (tags: string[]) => void; text: string; onText: (text: string) => void; used: string[]; labelledBy: string;
}) {
  const [left, setLeft] = useState<string[]>([]);                          // typed past the limit, so not added
  const box = useRef<HTMLInputElement>(null);
  const lastRemove = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const full = value.length >= MAX_TAGS;
  const parts = splitTags(text);                                           // a comma separates several
  const isNew = parts.some((p) => !value.some((t) => t.toLowerCase() === p.toLowerCase()));
  const hints = full ? [] : tagSuggestions(used, value, text);
  // after adding or removing, the focus stays in the field: the box, or, when the limit hides it, the last tag's remove button
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    (box.current ?? lastRemove.current)?.focus();
  });
  const add = (parts: string[]) => {
    const tags = addTags(value, parts);
    onChange(tags); onText(''); setLeft(leftOut(tags, parts)); refocus.current = true;
  };
  const remove = (t: string) => { onChange(value.filter((x) => x !== t)); setLeft([]); refocus.current = true; };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();                                     // Enter would also submit the popup's form
      if (parts.length) add(parts);
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    // a press anywhere in the field keeps the typing in the box (a button's click still runs); leaving the field keeps the text in the box
    <div onMouseDown={(e) => { if (e.target !== box.current) { e.preventDefault(); box.current?.focus(); } }}>
      <div className="flex min-h-[34px] flex-wrap items-center gap-1.5 rounded-lg border border-[#b8c4c8] bg-white px-2 py-1 focus-within:ring-2 focus-within:ring-[#1ed4b0]">
        {value.map((t, i) => (
          <span key={t} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#d5dbe1] bg-[#f3f6f8] py-0.5 pl-2 pr-1 text-xs text-[#26323d]">
            <span className="min-w-0 truncate">{t}</span>
            <button ref={i === value.length - 1 ? lastRemove : undefined} type="button" onClick={() => remove(t)} aria-label={`Remove tag ${t}`}
              className="rounded-full p-0.5 text-[#586472] hover:bg-[#e3e8ec] hover:text-[#1f2933] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1ed4b0]">
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
        {!full && (
          <input ref={box} type="text" value={text} onChange={(e) => onText(e.target.value)} onKeyDown={onKeyDown}
            aria-labelledby={labelledBy} placeholder={value.length ? 'Add a tag' : 'Add a tag, press Enter'} title="Press Enter or a comma to add"
            className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-[#1f2933] placeholder:text-[#7b8794] focus:outline-none focus:ring-0" />
        )}
      </div>
      {/* always there, so a screen reader hears the limit when the focus has moved to a remove button */}
      <div role="status" className="text-xs text-[#586472]">
        {full && (
          <span className="mt-1.5 block break-words">
            {left.length ? `Not added (up to ${MAX_TAGS} tags): ${left.join(', ')}. ` : `Up to ${MAX_TAGS} tags. `}Remove one to add more.
          </span>
        )}
      </div>
      {((isNew && !full) || hints.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {isNew && !full && (
            <button type="button" onClick={() => add(parts)}
              className="max-w-full truncate rounded-full border border-[#0f766e] bg-[#ecf8f5] px-2 py-0.5 text-xs font-semibold text-[#0b6b58] hover:bg-[#d7f0ea] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1ed4b0]">
              + Add “{parts.join(', ')}”
            </button>
          )}
          {hints.length > 0 && <span className="text-xs text-[#586472]">{text.trim() ? 'Matching:' : 'Used elsewhere:'}</span>}
          {hints.map((h) => (
            <button key={h} type="button" onClick={() => add([h])} aria-label={`Add tag ${h}`}
              className="max-w-full truncate rounded-full border border-dashed border-[#9fb3b8] bg-white px-2 py-0.5 text-xs text-[#26323d] hover:border-[#0f766e] hover:bg-[#ecf8f5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1ed4b0]">
              + {h}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DetailsDialog({ doc, open, onClose, canEdit, onSaved }: {
  doc: any; open: boolean; onClose: () => void; canEdit: boolean;
  /** after a save, with what changed (the AI Studio keeps its own title and type in step) */
  onSaved?: (patch: Record<string, unknown>) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [base, setBase] = useState<Form>(() => fromDoc(doc));
  const [form, setForm] = useState<Form>(() => fromDoc(doc));
  // who reviews and approves it: changed here while it is a draft or on its way (the server refuses it once approved)
  const signoffQ = useSignoff(doc?.id);
  // a route of its own is changed in Submit for review (its stages, order and rules do not fit two lists)
  const ownRoute = signoffQ.data?.route?.custom ? signoffQ.data.route : null;
  const peopleEditable = canEdit && !ownRoute && ['draft', 'pending_review', 'pending_approval'].includes(doc?.status);
  const serverPeople = useMemo<SignoffChoice>(() => {
    const keep = (l?: Participant[]) => (l ?? []).map(({ target_type, target_id, display }) => ({ target_type, target_id, display }));
    return { reviewers: keep(signoffQ.data?.participants.reviewer), approvers: keep(signoffQ.data?.participants.approver) };
  }, [signoffQ.data]);
  const [people, setPeople] = useState<SignoffChoice | null>(null);          // null: as the server has them
  const [tagText, setTagText] = useState('');                                 // typed in the tag box, not added yet: Save adds it

  useEffect(() => {
    if (!open) return;
    const f = fromDoc(doc);
    setBase(f);
    setForm(f);
    setPeople(null);
    setTagText('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when the popup opens

  const tenantId: number | undefined = doc?.tenant_id;
  const usersQ = useOrgUsers(tenantId, open && canEdit);
  const deptQ = useOrgDepartments(open);
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
  const docsQ = useLibraryDocuments(open && canEdit);

  const ownerItems = useMemo<Item[]>(() => {
    const out: Item[] = (usersQ.data || []).map((u: any) => {
      const p = personOf(u);           // the person (user_id), never the membership row's own id
      return { value: String(p.id), label: p.name, subLabel: p.email };
    });
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
  // the document and everything under it, at any depth: the server refuses any of them as the parent (a cycle)
  const notParents = useMemo(() => {
    const out = new Set<number>([doc?.id]);
    for (let size = 0; size !== out.size;) {
      size = out.size;
      for (const d of others) if (d.parent_document_id != null && out.has(d.parent_document_id)) out.add(d.id);
    }
    return out;
  }, [doc?.id, others]);

  const usedTags = useMemo(() => others.filter((d) => d.id !== doc?.id).flatMap((d) => d.tags || []), [others, doc?.id]);
  const tagsLabel = useId();

  const typed = useMemo(() => splitTags(tagText), [tagText]);
  const saveTags = useMemo(() => addTags(form.tags, typed), [form.tags, typed]);
  const patch = useMemo(() => changes(base, { ...form, tags: saveTags }), [base, form, saveTags]);
  const keyOf = (l: Participant[]) => l.map((p) => `${p.target_type}:${p.target_id}`).sort().join(',');
  const peopleChanged = people !== null
    && (keyOf(people.reviewers) !== keyOf(serverPeople.reviewers) || keyOf(people.approvers) !== keyOf(serverPeople.approvers));
  const dirty = Object.keys(patch).length > 0 || peopleChanged;

  const save = useMutation({
    mutationFn: async () => {
      if (Object.keys(patch).length) await governanceApi.updateDocument(doc.id, patch as any);
      if (peopleChanged && people) {
        const ids = (l: Participant[]) => l.map(({ target_type, target_id }) => ({ target_type, target_id }));
        // the participants are replaced as a whole: prepared-by is sent back as it is
        await governanceApi.setSignoffParticipants(doc.id, { prepared_by: ids(signoffQ.data?.participants.prepared_by ?? []),
                                                             reviewers: ids(people.reviewers), approvers: ids(people.approvers) });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['governance-document', doc.id] });
      qc.invalidateQueries({ queryKey: ['document-access', doc.id] });
      qc.invalidateQueries({ queryKey: ['studio', 'setup'] });
      qc.invalidateQueries({ queryKey: ['doc-signoff', doc.id] });
      qc.invalidateQueries({ queryKey: ['document-lifecycle'] });
      onSaved?.(patch);
      const notAdded = leftOut(saveTags, typed);                              // typed past the limit
      toast({ type: 'success', title: 'Details saved',
              message: notAdded.length ? `Not added (up to ${MAX_TAGS} tags): ${notAdded.join(', ')}.` : undefined });
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
        multiSelect={false} triggerVariant="input" size="sm" forceSearch showAvatars={false}
        placeholder={departmentPlaceholder({ loading: deptQ.isLoading, failed: deptQ.isError, count: deptItems.length })} triggerClassName={TRIGGER} />),
    row('Review cycle', form.review_cycle_months == null ? '' : labelOf(cycles, form.review_cycle_months),
      <select value={form.review_cycle_months ?? ''} onChange={(e) => setSchedule({ review_cycle_months: e.target.value ? Number(e.target.value) : null })} className={INPUT}>
        {form.review_cycle_months == null && <option value="">Not set</option>}
        {cycles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>),
    row('Effective date', day(form.effective_date),
      <input type="date" value={form.effective_date} onChange={(e) => setSchedule({ effective_date: e.target.value })} className={INPUT} />),
    row('Next review', day(form.next_review_date),
      <input type="date" value={form.next_review_date} onChange={(e) => set({ next_review_date: e.target.value })} className={INPUT} />),
    // next to Next review, so the half-width fields pair up in two columns
    row('Parent document', doc?.parent_document?.title || '',
      <ParentPicker value={form.parent_document_id} onChange={(id) => set({ parent_document_id: id })} exclude={notParents} enabled={open}
        title={doc?.parent_document?.id === form.parent_document_id ? doc?.parent_document?.title : undefined} />),
    row('Frameworks', form.applicable_framework_ids.map((id) => fwItems.find((i) => i.value === String(id))?.label || `Framework ${id}`).join(', '),
      <MultiSelectDropdown title="Frameworks" items={fwItems} selectedValues={form.applicable_framework_ids.map(String)}
        onApply={(v) => set({ applicable_framework_ids: v.map(Number).filter((n) => !Number.isNaN(n)) })}
        multiSelect triggerVariant="input" size="sm" forceSearch showAvatars={false} placeholder="Choose frameworks" triggerClassName={TRIGGER} />,
      { wide: true }),
    // not a <label>: one around the chips' remove buttons would press the first of them when "Tags" is clicked
    canEdit ? (
      <div key="Tags" className="min-w-0 sm:col-span-2">
        <span id={tagsLabel} className="mb-1 block text-xs font-semibold text-[#26323d]">Tags</span>
        <TagField value={form.tags} onChange={(tags) => set({ tags })} text={tagText} onText={setTagText} used={usedTags} labelledBy={tagsLabel} />
      </div>
    ) : (
      <Value key="Tags" label="Tags" wide>
        {form.tags.length ? (
          <span className="flex flex-wrap gap-1">
            {form.tags.map((t) => <span key={t} className="rounded-full border border-[#d5dbe1] px-2 py-0.5 text-[11px] text-[#26323d]">{t}</span>)}
          </span>
        ) : ''}
      </Value>
    ),
    row('Description', form.description,
      <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={3} className={INPUT} />,
      { wide: true }),
    peopleEditable ? (
      <div key="people" className="sm:col-span-2">
        <ReviewerApproverFields value={people ?? serverPeople} onChange={setPeople} tenantId={tenantId}
          note={doc?.status === 'draft' ? undefined : 'Saving asks anyone you add at the current step, and cancels the request of anyone you remove.'} />
        {/* a consequence, not an explanation: it stays on the page */}
        {doc?.status !== 'draft' && <p className="mt-1 text-[12px] text-[#586472]">Removing someone cancels their open request.</p>}
      </div>
    ) : ownRoute ? (
      <Value key="route" label="Approval route">
        {ownRoute.stages.map((st) => `${st.name}: ${st.people.map((p) => p.display).join(st.order === 'in_turn' ? ', then ' : ', ')}`).join(' · ')}
      </Value>
    ) : [
      <Value key="reviewers" label="Reviewers">{serverPeople.reviewers.map((p) => p.display || `${p.target_type} ${p.target_id}`).join(', ')}</Value>,
      <Value key="approvers" label="Approvers">{serverPeople.approvers.map((p) => p.display || `${p.target_type} ${p.target_id}`).join(', ')}</Value>,
    ],
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
