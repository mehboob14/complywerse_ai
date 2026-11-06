'use client';

// Author a control of your own: the fields the internal-control register
// carries, the guidance and evidence the control is worked from, its SCF
// mappings and links to anything else in the platform.
//
// Wherever the answer comes from a known list it is picked, not typed: the ID
// is allocated, categories, sources and people come from searchable lists, and
// short enumerations are one click. Only the control's own words are free text.
// SCF catalogue text stays read-only and no field is AI-drafted.

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle, BookOpenText, Check, ClipboardList, Hash, Layers, Link2, Plus, Settings2, Tag, Users, X,
} from 'lucide-react';
import { certificationsApi, scfApi, type AuthoredEvidence, type CustomControlOptions } from '@/lib/api';
import { MultiSelectDropdown, type MultiSelectDropdownItem } from '@/components/ui/MultiSelectDropdown';
import { RecordLinker, type LinkedRecord } from './RecordLinker';
import { ScfControlPicker } from './ScfControlPicker';

export const PPTDF_OPTS = ['People', 'Process', 'Technology', 'Data', 'Facility'] as const;
export const CADENCE_OPTS = ['Annual', 'Semi-Annual', 'Quarterly'] as const;
export const SUB_TYPE_OPTS = ['Manual', 'Automated', 'Hybrid', 'IT-Dependent Manual'] as const;
export const PRIORITY_OPTS = ['low', 'medium', 'high', 'critical'] as const;

const CONTROL_TYPES = [
  { value: 'preventive', label: 'Preventive', hint: 'stops it happening' },
  { value: 'detective', label: 'Detective', hint: 'finds it after' },
  { value: 'corrective', label: 'Corrective', hint: 'puts it right' },
];
const FREQUENCY_LABELS: Record<string, string> = {
  continuous: 'Continuous', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
  quarterly: 'Quarterly', annually: 'Annually', ad_hoc: 'Ad hoc (when triggered)',
};
const PRIORITY_TONE: Record<string, string> = {
  low: 'bg-slate-400', medium: 'bg-amber-400', high: 'bg-orange-500', critical: 'bg-rose-600',
};

export type CustomControlFormValues = {
  code: string;
  name: string;
  statement: string;
  domain: string;
  pptdf: string;
  conformity_cadence: string;
  control_sub_type: string;
  implements_scf_ids: string[];
  // classification
  category: string;
  sub_category: string;
  control_type: string;
  operating_frequency: string;
  // accountability
  department_id: number | null;
  owner_user_id: number | null;
  backup_owner_id: number | null;
  reviewer_user_id: number | null;
  priority: string;
  is_key_control: boolean;
  // provenance & dates
  regulatory_source: string;
  effective_date: string;
  review_date: string;
  // guidance the control is worked from
  objective: string;
  implementation_guidance: string;
  testing_guidance: string;
  recommended_evidence: AuthoredEvidence[];
  // cross-module links
  links: LinkedRecord[];
};

const empty: CustomControlFormValues = {
  code: '',
  name: '',
  statement: '',
  domain: '',
  pptdf: '',
  conformity_cadence: 'Annual',
  control_sub_type: 'Manual',
  implements_scf_ids: [],
  category: '',
  sub_category: '',
  control_type: '',
  operating_frequency: '',
  department_id: null,
  owner_user_id: null,
  backup_owner_id: null,
  reviewer_user_id: null,
  priority: 'medium',
  is_key_control: false,
  regulatory_source: '',
  effective_date: '',
  review_date: '',
  objective: '',
  implementation_guidance: '',
  testing_guidance: '',
  recommended_evidence: [],
  links: [],
};

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/15';

// ── building blocks ─────────────────────────────────────────────────────────

function Field({ label, required, hint, children, className = '' }: {
  label: string; required?: boolean; hint?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline gap-1 text-[12.5px] font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500" aria-hidden>*</span>}
      </div>
      {children}
      {hint && <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">{hint}</p>}
    </div>
  );
}

function SelectField({
  label, value, onChange, items, placeholder, required, hint, disabled, search = true, people = false, className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: MultiSelectDropdownItem[];
  placeholder?: string;
  required?: boolean;
  hint?: ReactNode;
  disabled?: boolean;
  search?: boolean;
  people?: boolean;
  className?: string;
}) {
  // A value saved before today's list existed still shows, rather than vanishing.
  const all = value && !items.some((i) => i.value === value) ? [{ value, label: value }, ...items] : items;
  return (
    <Field label={label} required={required} hint={hint} className={className}>
      <MultiSelectDropdown
        title={label}
        items={all}
        selectedValues={value ? [value] : []}
        onApply={(v) => onChange(v[0] ?? '')}
        multiSelect={false}
        triggerVariant="input"
        placeholder={placeholder || `Select ${label.toLowerCase()}`}
        searchPlaceholder={`Search ${label.toLowerCase()}…`}
        forceSearch={search}
        showAvatars={people}
        disabled={disabled}
        size="md"
        className="w-full"
        triggerClassName="w-full"
      />
    </Field>
  );
}

function Segmented({ value, onChange, options, ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; hint?: string; dot?: string }[];
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on}
            onClick={() => onChange(on ? '' : o.value)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              on ? 'border-primary-500 bg-primary-50 text-primary-800 ring-1 ring-primary-500/20'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}>
            {o.dot && <span className={`size-2 rounded-full ${o.dot}`} />}
            {o.label}
            {o.hint && <span className={`text-[11px] font-normal ${on ? 'text-primary-600' : 'text-slate-400'}`}>· {o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Switch({ checked, onChange, label, description }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left hover:bg-slate-50">
      <span className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
      <span>
        <span className="block text-[13px] font-medium text-slate-800">{label}</span>
        {description && <span className="block text-[11.5px] leading-relaxed text-slate-500">{description}</span>}
      </span>
    </button>
  );
}

function Section({ id, index, title, description, icon: Icon, children }: {
  id: string; index: number; title: string; description?: string;
  icon: typeof Tag; children: ReactNode;
}) {
  return (
    <section id={`cc-sec-${id}`} data-section={id} aria-labelledby={`cc-sec-${id}-title`}
      className="scroll-mt-3 rounded-xl border border-slate-200 bg-white">
      <header className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 id={`cc-sec-${id}-title`} className="text-[14px] font-semibold text-slate-900">
            <span className="mr-1.5 text-slate-400">{index}.</span>{title}
          </h3>
          {description && <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{description}</p>}
        </div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EvidenceRows({ rows, onChange }: { rows: AuthoredEvidence[]; onChange: (next: AuthoredEvidence[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const name = draft.trim();
    if (!name || rows.some((r) => r.name.toLowerCase() === name.toLowerCase())) { setDraft(''); return; }
    onChange([...rows, { name, collection_method: 'manual' }]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((row, i) => (
            <li key={`${row.name}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <ClipboardList className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{row.name}</span>
              <Segmented
                ariaLabel={`How ${row.name} is collected`}
                value={row.collection_method || 'manual'}
                onChange={(v) => onChange(rows.map((r, j) => (j === i
                  ? { ...r, collection_method: (v || 'manual') as AuthoredEvidence['collection_method'] } : r)))}
                options={[
                  { value: 'manual', label: 'Uploaded' },
                  { value: 'automated', label: 'Collector' },
                  { value: 'hybrid', label: 'Both' },
                ]}
              />
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}
                aria-label={`Remove ${row.name}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="e.g. Quarterly access review sign-off" className={inputCls} />
        <button type="button" onClick={add} disabled={!draft.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
    </div>
  );
}

// ── the form ────────────────────────────────────────────────────────────────

type SectionId = 'basics' | 'classification' | 'operation' | 'ownership' | 'guidance' | 'mappings' | 'links';

export function CustomControlForm({
  initial,
  codeLocked = false,
  showImplements = true,
  showLinks = true,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  formId,
  hideActions = false,
  context,
}: {
  initial?: Partial<CustomControlFormValues>;
  /** Editing an existing control: its ID is shown, not allocated. */
  codeLocked?: boolean;
  showImplements?: boolean;
  showLinks?: boolean;
  submitLabel: string;
  pending?: boolean;
  onSubmit: (values: CustomControlFormValues) => void;
  onCancel?: () => void;
  /** Lets a dialog footer submit the form with `<button form={formId}>`. */
  formId?: string;
  /** The caller renders the Cancel / Submit buttons (e.g. in a modal footer). */
  hideActions?: boolean;
  /** Shown above the first section — e.g. the statement this control comes from. */
  context?: ReactNode;
}) {
  const [values, setValues] = useState<CustomControlFormValues>({ ...empty, ...initial });
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<SectionId>('basics');
  const contentRef = useRef<HTMLDivElement>(null);

  const optionsQ = useQuery({
    queryKey: ['custom-control-options'],
    queryFn: async () => (await scfApi.getCustomControlOptions()).data as CustomControlOptions,
    staleTime: 60_000,
  });
  const usersQ = useQuery({
    queryKey: ['tenant-users-ownership'],
    queryFn: async () => (await certificationsApi.getTenantUsers()).data as
      { id: number; display_name?: string; username?: string; email?: string }[],
    staleTime: 5 * 60_000,
  });
  const options = optionsQ.data;

  const set = <K extends keyof CustomControlFormValues>(key: K, v: CustomControlFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const categoryItems = useMemo(
    () => (options?.categories ?? []).map((c) => ({ value: c.value, label: c.value })), [options],
  );
  const subCategoryItems = useMemo(
    () => (options?.categories.find((c) => c.value === values.category)?.sub_categories ?? [])
      .map((s) => ({ value: s, label: s })),
    [options, values.category],
  );
  const domainItems = useMemo(() => (options?.domains ?? []).map((d) => ({ value: d, label: d })), [options]);
  const frequencyItems = useMemo(
    () => (options?.operating_frequencies ?? Object.keys(FREQUENCY_LABELS))
      .map((f) => ({ value: f, label: FREQUENCY_LABELS[f] || f.replace(/_/g, ' ') })),
    [options],
  );
  const sourceItems = useMemo(
    () => (options?.regulatory_sources ?? []).map((s) => ({
      value: s.value, label: s.label, subLabel: s.detail ? `${s.group} · ${s.detail}` : s.group,
    })),
    [options],
  );
  const peopleItems = useMemo(
    () => (usersQ.data ?? []).map((u) => ({
      value: String(u.id), label: u.display_name || u.username || u.email || `User ${u.id}`,
      subLabel: u.email || undefined,
    })),
    [usersQ.data],
  );
  const departmentItems = useMemo(
    () => (options?.departments ?? []).map((d) => ({ value: String(d.id), label: d.name })), [options],
  );

  // A new category invalidates a sub-category from the old one.
  useEffect(() => {
    if (values.sub_category && subCategoryItems.length
      && !subCategoryItems.some((s) => s.value === values.sub_category)) {
      setValues((prev) => ({ ...prev, sub_category: '' }));
    }
  }, [subCategoryItems, values.sub_category]);

  const sections = useMemo(() => {
    const list: { id: SectionId; title: string; done: boolean; count?: number }[] = [
      { id: 'basics', title: 'Basics', done: !!values.name.trim() },
      { id: 'classification', title: 'Classification', done: !!(values.category && values.control_type) },
      { id: 'operation', title: 'Operation', done: !!(values.operating_frequency && values.priority) },
      { id: 'ownership', title: 'Ownership', done: !!values.owner_user_id },
      {
        id: 'guidance', title: 'Guidance & evidence',
        done: !!(values.implementation_guidance.trim() || values.testing_guidance.trim() || values.recommended_evidence.length),
      },
    ];
    if (showImplements) list.push({ id: 'mappings', title: 'SCF mappings', done: values.implements_scf_ids.length > 0, count: values.implements_scf_ids.length });
    if (showLinks) list.push({ id: 'links', title: 'Linked records', done: values.links.length > 0, count: values.links.length });
    return list;
  }, [values, showImplements, showLinks]);

  // Highlight the section being read, in whichever element scrolls.
  useEffect(() => {
    const root = contentRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const id = visible[0]?.target.getAttribute('data-section') as SectionId | null;
      if (id) setActive(id);
    }, { rootMargin: '-8% 0px -65% 0px' });
    root.querySelectorAll('[data-section]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections.length]);

  const jump = (id: SectionId) => {
    setActive(id);
    document.getElementById(`cc-sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!values.name.trim()) {
      setError('Give the control a name.');
      jump('basics');
      return;
    }
    if (values.effective_date && values.review_date && values.review_date < values.effective_date) {
      setError('The review date cannot be before the effective date.');
      jump('operation');
      return;
    }
    setError(null);
    onSubmit({
      ...values,
      code: codeLocked ? (initial?.code || values.code) : '',
      name: values.name.trim(),
      statement: values.statement.trim(),
      domain: values.domain.trim(),
    });
  };

  const requiredDone = sections.filter((s) => s.done).length;

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex min-h-full items-start">
      {/* Section rail */}
      <nav aria-label="Form sections"
        className="sticky top-0 hidden w-56 shrink-0 self-start border-r border-slate-100 bg-slate-50/60 px-3 py-4 lg:block">
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {requiredDone} of {sections.length} filled
        </p>
        <ol className="space-y-0.5">
          {sections.map((s, i) => (
            <li key={s.id}>
              <button type="button" onClick={() => jump(s.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] transition-colors ${
                  active === s.id ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/70'}`}>
                <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold ${
                  s.done ? 'bg-primary-600 text-white' : active === s.id ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-500'}`}>
                  {s.done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                {!!s.count && <span className="rounded-full bg-slate-200 px-1.5 text-[10.5px] font-semibold tabular-nums text-slate-600">{s.count}</span>}
              </button>
            </li>
          ))}
        </ol>
        <p className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[11.5px] leading-relaxed text-slate-500">
          Only the name is required — the rest can be completed later from the control&apos;s page.
          No field is AI-drafted, and SCF text is never copied in.
        </p>
      </nav>

      <div ref={contentRef} className="min-w-0 flex-1 space-y-4 p-4 sm:p-5">
        {context}

        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] font-medium text-rose-700">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <Section id="basics" index={1} title="Basics" icon={Hash}
          description="What the control is, in your own words.">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,12rem)_1fr]">
            <Field label="Control ID">
              <div className="flex h-10 items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3">
                <span className="font-mono text-sm font-semibold text-slate-700">
                  {codeLocked ? (initial?.code || values.code) : (options?.next_code || 'CTL-····')}
                </span>
                {!codeLocked && <span className="truncate text-[11px] text-slate-400">auto</span>}
              </div>
            </Field>
            <Field label="Name" required>
              <input value={values.name} onChange={(e) => set('name', e.target.value)} autoFocus={!codeLocked}
                placeholder="e.g. Quarterly privileged access review" className={inputCls} maxLength={255} />
            </Field>
          </div>
          {!codeLocked && (
            <p className="mt-1.5 text-[11.5px] text-slate-400">IDs are numbered for you in sequence and never reused.</p>
          )}
          <Field label="Control statement" className="mt-4" hint="What the control requires to be true, as your organisation states it.">
            <textarea value={values.statement} onChange={(e) => set('statement', e.target.value)} rows={3}
              placeholder="Privileged access to production systems is reviewed every quarter by the system owner…"
              className={`${inputCls} resize-y`} />
          </Field>
          <Field label="Control objective" className="mt-4">
            <textarea value={values.objective} onChange={(e) => set('objective', e.target.value)} rows={2}
              placeholder="What must hold when the control works — e.g. only approved staff hold privileged access."
              className={`${inputCls} resize-y`} />
          </Field>
        </Section>

        <Section id="classification" index={2} title="Classification" icon={Tag}
          description="The register's categories, so this control reports alongside the rest.">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Category" value={values.category} onChange={(v) => set('category', v)}
              items={categoryItems} placeholder="Select a category" />
            <SelectField label="Sub-category" value={values.sub_category} onChange={(v) => set('sub_category', v)}
              items={subCategoryItems} disabled={!values.category}
              placeholder={values.category ? 'Select a sub-category' : 'Choose a category first'} />
          </div>
          <Field label="Control type" className="mt-4">
            <Segmented ariaLabel="Control type" value={values.control_type} onChange={(v) => set('control_type', v)}
              options={CONTROL_TYPES} />
          </Field>
          <Field label="Nature" className="mt-4">
            <Segmented ariaLabel="Control nature" value={values.control_sub_type}
              onChange={(v) => set('control_sub_type', v || 'Manual')}
              options={SUB_TYPE_OPTS.map((o) => ({ value: o, label: o }))} />
          </Field>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <SelectField label="Domain" value={values.domain} onChange={(v) => set('domain', v)}
              items={domainItems} placeholder="Select an SCF domain" />
            <Field label="PPTDF">
              <Segmented ariaLabel="PPTDF" value={values.pptdf} onChange={(v) => set('pptdf', v)}
                options={PPTDF_OPTS.map((o) => ({ value: o, label: o }))} />
            </Field>
          </div>
        </Section>

        <Section id="operation" index={3} title="Operation" icon={Settings2}
          description="How often it runs, how often it is reassessed, how much it matters and where it comes from.">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Operating frequency" value={values.operating_frequency}
              onChange={(v) => set('operating_frequency', v)} items={frequencyItems} search={false}
              placeholder="How often the control runs" />
            <Field label="Reassess conformity">
              <Segmented ariaLabel="Conformity cadence" value={values.conformity_cadence}
                onChange={(v) => set('conformity_cadence', v || 'Annual')}
                options={CADENCE_OPTS.map((o) => ({ value: o, label: o }))} />
            </Field>
          </div>
          <Field label="Priority" className="mt-4">
            <Segmented ariaLabel="Priority" value={values.priority} onChange={(v) => set('priority', v || 'medium')}
              options={PRIORITY_OPTS.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1), dot: PRIORITY_TONE[p] }))} />
          </Field>
          <div className="mt-4">
            <Switch checked={values.is_key_control} onChange={(v) => set('is_key_control', v)} label="Key control"
              description="A control whose failure alone would let a material risk through; it is tested first and reported on its own." />
          </div>
          <SelectField className="mt-4" label="Regulatory source" value={values.regulatory_source}
            onChange={(v) => set('regulatory_source', v)} items={sourceItems}
            placeholder="Search frameworks, circulars and policies"
            hint="The framework, regulatory publication or internal document this control answers to." />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Effective date">
              <input type="date" value={values.effective_date} onChange={(e) => set('effective_date', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Next review date">
              <input type="date" value={values.review_date} min={values.effective_date || undefined}
                onChange={(e) => set('review_date', e.target.value)} className={inputCls} />
            </Field>
          </div>
        </Section>

        <Section id="ownership" index={4} title="Ownership" icon={Users}
          description="Who runs the control, who covers for them, and who signs off its testing.">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Owner" people value={values.owner_user_id ? String(values.owner_user_id) : ''}
              onChange={(v) => set('owner_user_id', v ? Number(v) : null)} items={peopleItems} placeholder="Unassigned" />
            <SelectField label="Backup owner" people value={values.backup_owner_id ? String(values.backup_owner_id) : ''}
              onChange={(v) => set('backup_owner_id', v ? Number(v) : null)} items={peopleItems} placeholder="None" />
            <SelectField label="Reviewer" people value={values.reviewer_user_id ? String(values.reviewer_user_id) : ''}
              onChange={(v) => set('reviewer_user_id', v ? Number(v) : null)} items={peopleItems} placeholder="None" />
            <SelectField label="Department" value={values.department_id ? String(values.department_id) : ''}
              onChange={(v) => set('department_id', v ? Number(v) : null)} items={departmentItems}
              disabled={!!options && departmentItems.length === 0}
              placeholder={options && departmentItems.length === 0 ? 'No business units configured' : 'Select a department'} />
          </div>
        </Section>

        <Section id="guidance" index={5} title="Guidance & evidence" icon={BookOpenText}
          description="What implementers and testers should do, and what the control should produce.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Implementation guidance">
              <textarea value={values.implementation_guidance} onChange={(e) => set('implementation_guidance', e.target.value)}
                rows={4} placeholder="How the control is put in place and kept running" className={`${inputCls} resize-y`} />
            </Field>
            <Field label="Testing guidance">
              <textarea value={values.testing_guidance} onChange={(e) => set('testing_guidance', e.target.value)}
                rows={4} placeholder="How a tester checks it, and what an exception looks like" className={`${inputCls} resize-y`} />
            </Field>
          </div>
          <Field label="Recommended evidence" className="mt-4" hint="Each item and how it is collected: uploaded by hand, from a collector, or both.">
            <EvidenceRows rows={values.recommended_evidence} onChange={(next) => set('recommended_evidence', next)} />
          </Field>
        </Section>

        {showImplements && (
          <Section id="mappings" index={6} title="SCF mappings" icon={Layers}
            description="The SCF controls this one implements. It inherits their framework requirements, maturity criteria and deliverables.">
            <ScfControlPicker value={values.implements_scf_ids} onChange={(ids) => set('implements_scf_ids', ids)} />
          </Section>
        )}

        {showLinks && (
          <Section id="links" index={showImplements ? 7 : 6} title="Linked records" icon={Link2}
            description="Risks it mitigates, assets it covers, documents that define it, issues it failed — anything it touches.">
            <RecordLinker selected={values.links} onChange={(next) => set('links', next)} label="" />
          </Section>
        )}

        {!hideActions && (
          <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
            {onCancel && (
              <button type="button" onClick={onCancel}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
            )}
            <button type="submit" disabled={pending}
              className="inline-flex items-center rounded-lg bg-primary-600 px-5 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50">
              {pending ? 'Saving…' : submitLabel}
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

/** The write body for the create/update endpoints, from form values.
 *
 * `clearTypes` names link types the control had before the edit: sending them
 * as empty arrays is how "I removed the last one of these" reaches the server.
 * No `code`: a new control's ID is allocated by the server.
 */
export function toWriteBody(v: CustomControlFormValues, clearTypes: string[] = []) {
  return {
    name: v.name,
    statement: v.statement || null,
    domain: v.domain || null,
    pptdf: v.pptdf || null,
    conformity_cadence: v.conformity_cadence || null,
    control_sub_type: v.control_sub_type || null,
    objective: v.objective || null,
    implementation_guidance: v.implementation_guidance || null,
    testing_guidance: v.testing_guidance || null,
    recommended_evidence: v.recommended_evidence,
    category: v.category || null,
    sub_category: v.sub_category || null,
    control_type: v.control_type || null,
    operating_frequency: v.operating_frequency || null,
    department_id: v.department_id,
    backup_owner_id: v.backup_owner_id,
    regulatory_source: v.regulatory_source || null,
    effective_date: v.effective_date || null,
    review_date: v.review_date || null,
    owner_user_id: v.owner_user_id,
    reviewer_user_id: v.reviewer_user_id,
    priority: v.priority || null,
    is_key_control: v.is_key_control,
    implements_scf_ids: v.implements_scf_ids,
    links: v.links.reduce<Record<string, number[]>>(
      (acc, row) => {
        (acc[row.type] = acc[row.type] || []).push(row.id);
        return acc;
      },
      Object.fromEntries(clearTypes.map((t) => [t, [] as number[]])),
    ),
  };
}
