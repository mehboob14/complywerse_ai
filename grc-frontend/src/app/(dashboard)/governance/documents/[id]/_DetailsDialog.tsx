'use client';

// The document's Details popup: title, type, classification, owner, department, review cycle and dates, frameworks, parent,
// tags, description, and who reviews and approves it. Read-only for people who cannot edit; otherwise Save sends only what changed
// (PUT /governance/documents/{id}; the reviewers and approvers to …/signoff/participants, while it is a draft or on its way): the
// rules for what is sent are _view/detailsForm.ts, tested. The code (document_code) is neither shown nor sent: a document keeps the one it has.
// The fields are the kit's (FormField with TextInput, Select, Textarea); the four pickers that search (owner, department, parent, frameworks) are still
// MultiSelectDropdown, which the kit has no replacement for yet, under a label of their own. The popup asks "Discard changes?" before Escape or the X
// throws typed input away. A save is reported after the server answered (the server's words when it refused, Retry when repeating can help).
// The lists share their React Query keys (and shapes) with the document pages, so they come from one cache.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import apiClient, { governanceApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { MultiSelectDropdown, type MultiSelectDropdownItem as Item } from '@/components/ui/MultiSelectDropdown';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, FormField, Select, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { departmentPickItems, departmentPlaceholder } from '@/lib/departments';
import { personOf } from '@/lib/people';
import { useDepartmentLevels } from '@/components/admin/DepartmentForm';
import { CLASSES, CYCLES, DOC_TYPES as TYPES, ParentPicker, titleCase, useLibraryDocuments, useOrgDepartments, useOrgUsers, withCurrent } from '../_DetailsFields';
import { MAX_TAGS, addTags, leftOut, splitTags, tagSuggestions } from '../_tags';
import { ReviewerApproverFields, useSignoff, type Participant, type SignoffChoice } from '../_SignoffControl';
import type { FrameworkInfo } from '../_workspace/libraryModel';
import { calendarDay } from '../_view/docDates';
import { changes, fromDoc, suggestNext, type DetailsForm as Form } from '../_view/detailsForm';
import { FrameworksValue } from './_FrameworksValue';

const TRIGGER = 'w-full !h-[34px] !border-[#b8c4c8] !text-sm';

const labelOf = <T,>(opts: [T, string][], value: T) => opts.find(([v]) => v === value)?.[1] || '';

/** A label for a picker that is not a kit control: it names its group, with the (i) beside it when it has one. */
function PickerField({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={`flex min-w-0 flex-col gap-[4px] ${wide ? 'sm:col-span-2' : ''}`}>
      <span id={id} className="text-ds-label text-ds-fg">{label}</span>
      {children}
    </div>
  );
}

function Value({ label, wide, mono, children }: { label: string; wide?: boolean; mono?: boolean; children: ReactNode }) {
  const empty = children === '' || children === null || children === undefined || (Array.isArray(children) && children.length === 0);
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-ds-label text-ds-fg">{label}</dt>
      <dd className={`mt-[2px] whitespace-pre-wrap break-words text-ds-body text-ds-fg-body ${mono ? 'font-mono' : ''}`}>
        {empty ? <span className="text-ds-fg-muted">—</span> : children}
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
  const CHIP_BUTTON = 'inline-flex min-h-[24px] max-w-full items-center truncate rounded-full px-[8px] text-ds-label focus-visible:outline-none focus-visible:shadow-ds-ring';
  return (
    // a press anywhere in the field keeps the typing in the box (a button's click still runs); leaving the field keeps the text in the box
    <div onMouseDown={(e) => { if (e.target !== box.current) { e.preventDefault(); box.current?.focus(); } }}>
      <div className="flex min-h-ds-control flex-wrap items-center gap-[6px] rounded-ds-control border border-ds-border-control bg-ds-surface px-[8px] py-[3px] focus-within:shadow-ds-ring">
        {value.map((t, i) => (
          <span key={t} className="inline-flex max-w-full items-center gap-[2px] rounded-full border border-ds-border bg-ds-surface-subtle pl-[8px] text-ds-label text-ds-fg-body">
            <span className="min-w-0 truncate">{t}</span>
            <button ref={i === value.length - 1 ? lastRemove : undefined} type="button" onClick={() => remove(t)} aria-label={`Remove tag ${t}`}
              className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring">
              <X className="h-[12px] w-[12px]" aria-hidden />
            </button>
          </span>
        ))}
        {!full && (
          <input ref={box} type="text" value={text} onChange={(e) => onText(e.target.value)} onKeyDown={onKeyDown}
            aria-labelledby={labelledBy} placeholder={value.length ? 'Add a tag' : 'Add a tag, press Enter'} title="Press Enter or a comma to add"
            className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-ds-body text-ds-fg placeholder:text-ds-fg-muted focus:outline-none focus:ring-0" />
        )}
      </div>
      {/* always there, so a screen reader hears the limit when the focus has moved to a remove button */}
      <div role="status" className="text-ds-label font-normal text-ds-fg-muted">
        {full && (
          <span className="mt-[6px] block break-words">
            {left.length ? `Not added (up to ${MAX_TAGS} tags): ${left.join(', ')}. ` : `Up to ${MAX_TAGS} tags. `}Remove one to add more.
          </span>
        )}
      </div>
      {((isNew && !full) || hints.length > 0) && (
        <div className="mt-[6px] flex flex-wrap items-center gap-[6px]">
          {isNew && !full && (
            <button type="button" onClick={() => add(parts)} className={`${CHIP_BUTTON} border border-ds-primary bg-ds-primary-soft font-semibold text-ds-primary-text hover:bg-ds-surface-hover`}>
              + Add “{parts.join(', ')}”
            </button>
          )}
          {hints.length > 0 && <span className="text-ds-label font-normal text-ds-fg-muted">{text.trim() ? 'Matching:' : 'Used elsewhere:'}</span>}
          {hints.map((h) => (
            <button key={h} type="button" onClick={() => add([h])} aria-label={`Add tag ${h}`}
              className={`${CHIP_BUTTON} border border-dashed border-ds-border-strong bg-ds-surface font-normal text-ds-fg-body hover:border-ds-primary hover:bg-ds-primary-soft`}>
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

  const levelNames = useDepartmentLevels().data?.labels;            // the organisation's words for the levels; the default names until they arrive
  const departments = deptQ.data || [];
  // every department in tree order by its whole path with its level under it; one switched off is listed only while this document sits in it
  const deptItems = useMemo<Item[]>(
    () => departmentPickItems(departments, { labels: levelNames, keep: [form.department_id] }),
    [departments, levelNames, form.department_id],
  );

  const frameworks = (fwQ.data || []) as any[];
  const fwItems = useMemo<Item[]>(() => {
    const out: Item[] = frameworks.map((f) => ({ value: String(f.id), label: f.name || `Framework ${f.id}` }));
    for (const id of form.applicable_framework_ids) {
      if (!out.some((i) => i.value === String(id))) out.push({ value: String(id), label: `Framework ${id}` });
    }
    return out;
  }, [frameworks, form.applicable_framework_ids]);
  // the read-only value's chips: the short code beside the full name, as the library's chips carry them (the list this popup already reads, no extra request)
  const fwInfo = useMemo(() => {
    const out: Record<string, FrameworkInfo> = {};
    for (const f of frameworks) {
      const short = String(f.short_code || '').trim();
      const name = String(f.name || '').trim();
      out[String(f.id)] = { short: short || name || `#${f.id}`, name: name || short || `#${f.id}` };
    }
    return out;
  }, [frameworks]);

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

  const save = useReportedMutation({
    mutationFn: async () => {
      if (Object.keys(patch).length) await governanceApi.updateDocument(doc.id, patch as any);
      if (peopleChanged && people) {
        const ids = (l: Participant[]) => l.map(({ target_type, target_id }) => ({ target_type, target_id }));
        // the participants are replaced as a whole: prepared-by is sent back as it is
        await governanceApi.setSignoffParticipants(doc.id, { prepared_by: ids(signoffQ.data?.participants.prepared_by ?? []),
                                                             reviewers: ids(people.reviewers), approvers: ids(people.approvers) });
      }
    },
    success: () => {
      const notAdded = leftOut(saveTags, typed);                              // typed past the limit
      return notAdded.length ? { title: 'Details saved', message: `Not added (up to ${MAX_TAGS} tags): ${notAdded.join(', ')}.` } : 'Details saved';
    },
    failure: 'Not saved',
    fallback: 'Could not save the details.',
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['governance-document', doc.id] });
      qc.invalidateQueries({ queryKey: ['document-access', doc.id] });
      qc.invalidateQueries({ queryKey: ['studio', 'setup'] });
      qc.invalidateQueries({ queryKey: ['doc-signoff', doc.id] });
      qc.invalidateQueries({ queryKey: ['document-lifecycle'] });
      onSaved?.(patch);
      onClose();
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

  const wide = (on?: boolean) => (on ? 'sm:col-span-2' : undefined);
  /** The popup's row: its label and value when it is read-only, its label and kit field when it can be changed (`picker`: a control the kit has no field for). */
  const row = (label: string, shown: ReactNode, editor: ReactNode, opts: { wide?: boolean; mono?: boolean; picker?: boolean } = {}) => {
    if (!canEdit) return <Value key={label} label={label} wide={opts.wide} mono={opts.mono}>{shown}</Value>;
    return opts.picker
      ? <PickerField key={label} label={label} wide={opts.wide}>{editor}</PickerField>
      : <FormField key={label} label={label} className={wide(opts.wide)}>{editor}</FormField>;
  };

  const fields = [
    canEdit ? (
      <FormField key="Title" label="Title" required error={form.title.trim() ? undefined : 'Enter a title'} className="sm:col-span-2">
        <TextInput type="text" value={form.title} onChange={(e) => set({ title: e.target.value })} />
      </FormField>
    ) : <Value key="Title" label="Title" wide>{form.title}</Value>,
    row('Type', labelOf(types, form.doc_type),
      <Select value={form.doc_type} onChange={(e) => set({ doc_type: e.target.value })}>
        {!form.doc_type && <option value="">Choose…</option>}
        {types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>),
    row('Classification', labelOf(classes, form.classification),
      <Select value={form.classification} onChange={(e) => set({ classification: e.target.value })}>
        {!form.classification && <option value="">Choose…</option>}
        {classes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>),
    row('Owner', doc?.owner_name || '',
      <MultiSelectDropdown title="Owner" items={ownerItems} selectedValues={one(form.owner_id)} onApply={(v) => set({ owner_id: toId(v) })}
        multiSelect={false} triggerVariant="input" size="sm" forceSearch placeholder="Choose a person" triggerClassName={TRIGGER} />, { picker: true }),
    row('Department', deptItems.find((i) => i.value === String(form.department_id))?.label || '',
      <MultiSelectDropdown title="Department" items={deptItems} selectedValues={one(form.department_id)} onApply={(v) => set({ department_id: toId(v) })}
        multiSelect={false} triggerVariant="input" size="sm" forceSearch showAvatars={false}
        placeholder={departmentPlaceholder({ loading: deptQ.isLoading, failed: deptQ.isError, count: deptItems.length })} triggerClassName={TRIGGER} />, { picker: true }),
    row('Review cycle', form.review_cycle_months == null ? '' : labelOf(cycles, form.review_cycle_months),
      <Select value={form.review_cycle_months ?? ''} onChange={(e) => setSchedule({ review_cycle_months: e.target.value ? Number(e.target.value) : null })}>
        {form.review_cycle_months == null && <option value="">Not set</option>}
        {cycles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>),
    // the effective date and the review date are DAYS (stored as a DateTime at midnight): read as written, in every time zone
    row('Effective date', form.effective_date ? calendarDay(form.effective_date) : '',
      <TextInput type="date" value={form.effective_date} onChange={(e) => setSchedule({ effective_date: e.target.value })} />),
    row('Next review', form.next_review_date ? calendarDay(form.next_review_date) : '',
      <TextInput type="date" value={form.next_review_date} onChange={(e) => set({ next_review_date: e.target.value })} />),
    // next to Next review, so the half-width fields pair up in two columns
    row('Parent document', doc?.parent_document?.title || '',
      <ParentPicker value={form.parent_document_id} onChange={(id) => set({ parent_document_id: id })} exclude={notParents} enabled={open}
        title={doc?.parent_document?.id === form.parent_document_id ? doc?.parent_document?.title : undefined} />, { picker: true }),
    // read-only: the first two as chips and "+N" for the rest (the full list one press away), as the library cuts them
    row('Frameworks', form.applicable_framework_ids.length ? <FrameworksValue ids={form.applicable_framework_ids} info={fwInfo} /> : '',
      <MultiSelectDropdown title="Frameworks" items={fwItems} selectedValues={form.applicable_framework_ids.map(String)}
        onApply={(v) => set({ applicable_framework_ids: v.map(Number).filter((n) => !Number.isNaN(n)) })}
        multiSelect triggerVariant="input" size="sm" forceSearch showAvatars={false} placeholder="Choose frameworks" triggerClassName={TRIGGER} />,
      { wide: true, picker: true }),
    // not a <label>: one around the chips' remove buttons would press the first of them when "Tags" is clicked
    canEdit ? (
      <div key="Tags" className="min-w-0 sm:col-span-2">
        <span id={tagsLabel} className="mb-[4px] block text-ds-label text-ds-fg">Tags</span>
        <TagField value={form.tags} onChange={(tags) => set({ tags })} text={tagText} onText={setTagText} used={usedTags} labelledBy={tagsLabel} />
      </div>
    ) : (
      <Value key="Tags" label="Tags" wide>
        {form.tags.length ? (
          <span className="flex flex-wrap gap-[6px]">
            {form.tags.map((t) => <span key={t} className="inline-flex h-[24px] items-center rounded-full border border-ds-border px-[8px] text-ds-label text-ds-fg-body">{t}</span>)}
          </span>
        ) : ''}
      </Value>
    ),
    canEdit ? (
      <FormField key="Description" label="Description" className="sm:col-span-2">
        <Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={3} />
      </FormField>
    ) : <Value key="Description" label="Description" wide>{form.description}</Value>,
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
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={save.isPending} disabled={!dirty || !form.title.trim()} onClick={() => save.mutate()}>Save</Button>
    </div>
  ) : (
    <div className="flex justify-end">
      <Button onClick={onClose}>Close</Button>
    </div>
  );

  return (
    <AnimatedModal isOpen={open} onClose={onClose} title="Details" subtitle={doc?.title} size="lg" footer={footer} dirty={canEdit && dirty}
      className="max-sm:max-h-[100dvh] max-sm:h-[100dvh] max-sm:rounded-none">
      {canEdit ? (
        <form className="grid grid-cols-1 gap-[12px] px-4 py-4 sm:grid-cols-2 sm:px-5" onSubmit={(e) => { e.preventDefault(); if (dirty && form.title.trim() && !save.isPending) save.mutate(); }}>
          {fields}
        </form>
      ) : (
        <dl className="grid grid-cols-1 gap-[12px] px-4 py-4 sm:grid-cols-2 sm:px-5">{fields}</dl>
      )}
    </AnimatedModal>
  );
}
