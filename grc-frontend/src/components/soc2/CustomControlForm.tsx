'use client';

// Author a control of your own: the same fields the internal-control register
// carries, plus the guidance and evidence a control needs to be worked, plus
// links to anything else in the platform.
//
// Every field starts blank. SCF catalogue text stays read-only and no field is
// AI-drafted — what a tenant writes here is the tenant's own text.

import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { certificationsApi, scfApi, type AuthoredEvidence, type CustomControlOptions } from '@/lib/api';
import { RecordLinker, type LinkedRecord } from './RecordLinker';

export const PPTDF_OPTS = ['People', 'Process', 'Technology', 'Data', 'Facility'] as const;
export const CADENCE_OPTS = ['Annual', 'Semi-Annual', 'Quarterly'] as const;
export const SUB_TYPE_OPTS = ['Manual', 'Automated', 'Hybrid', 'IT-Dependent Manual'] as const;
export const PRIORITY_OPTS = ['low', 'medium', 'high', 'critical'] as const;

/** Common SCF domain names for a compact select (tenant may still type free text). */
export const DOMAIN_OPTS = [
  'Security, Compliance & Resilience Governance',
  'Asset Management',
  'Business Continuity & Disaster Recovery',
  'Change Management',
  'Cloud Security',
  'Compliance',
  'Configuration Management',
  'Continuous Monitoring',
  'Cryptographic Protections',
  'Data Classification & Handling',
  'Endpoint Security',
  'Human Resources Security',
  'Identification & Authentication',
  'Incident Response',
  'Network Security',
  'Physical & Environmental Security',
  'Data Privacy',
  'Risk Management',
  'Security Operations',
  'Security Awareness & Training',
  'Third-Party Management',
  'Vulnerability & Patch Management',
] as const;

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

const fieldCls =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none';
const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400';
const sectionCls = 'rounded-xl border border-slate-200 bg-white p-3.5';

function parseScfChip(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (!t) return null;
  return t;
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className={sectionCls}>
      <div className="mb-3">
        <h3 className="text-[13px] font-semibold text-slate-800">{title}</h3>
        {note && <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function EvidenceRows({
  rows, onChange,
}: { rows: AuthoredEvidence[]; onChange: (next: AuthoredEvidence[]) => void }) {
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
        <ul className="space-y-1.5">
          {rows.map((row, i) => (
            <li key={`${row.name}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-700">{row.name}</span>
              <select
                value={row.collection_method || 'manual'}
                onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, collection_method: e.target.value as AuthoredEvidence['collection_method'] } : r)))}
                className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[11.5px] text-slate-600"
              >
                <option value="manual">Uploaded by hand</option>
                <option value="automated">From a collector</option>
                <option value="hybrid">Both</option>
              </select>
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}
                aria-label={`Remove ${row.name}`} className="text-slate-400 hover:text-slate-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="e.g. Quarterly access review sign-off"
          className={fieldCls}
        />
        <button type="button" onClick={add}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
    </div>
  );
}

export function CustomControlForm({
  initial,
  codeLocked = false,
  showImplements = true,
  showLinks = true,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<CustomControlFormValues>;
  codeLocked?: boolean;
  showImplements?: boolean;
  showLinks?: boolean;
  submitLabel: string;
  pending?: boolean;
  onSubmit: (values: CustomControlFormValues) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<CustomControlFormValues>({ ...empty, ...initial });
  const [chipDraft, setChipDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const optionsQ = useQuery({
    queryKey: ['custom-control-options'],
    queryFn: async () => (await scfApi.getCustomControlOptions()).data as CustomControlOptions,
    staleTime: 10 * 60_000,
  });
  const usersQ = useQuery({
    queryKey: ['tenant-users-ownership'],
    queryFn: async () => (await certificationsApi.getTenantUsers()).data as
      { id: number; display_name?: string; username?: string; email?: string }[],
    staleTime: 5 * 60_000,
  });
  const options = optionsQ.data;
  const users = usersQ.data ?? [];
  const userLabel = (u: { display_name?: string; username?: string; email?: string }) =>
    u.display_name || u.username || u.email || 'User';

  const subCategories = useMemo(
    () => options?.categories.find((c) => c.value === values.category)?.sub_categories ?? [],
    [options, values.category],
  );

  useEffect(() => {
    if (values.sub_category && subCategories.length && !subCategories.includes(values.sub_category)) {
      setValues((prev) => ({ ...prev, sub_category: '' }));
    }
  }, [subCategories, values.sub_category]);

  // Offer the next code rather than demanding one; it stays editable.
  useEffect(() => {
    if (codeLocked || !options?.next_code) return;
    setValues((prev) => (prev.code.trim() ? prev : { ...prev, code: options.next_code as string }));
  }, [codeLocked, options?.next_code]);

  const set = <K extends keyof CustomControlFormValues>(key: K, v: CustomControlFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  const addChip = (raw: string) => {
    const id = parseScfChip(raw);
    if (!id) return;
    if (values.implements_scf_ids.includes(id)) { setChipDraft(''); return; }
    set('implements_scf_ids', [...values.implements_scf_ids, id]);
    setChipDraft('');
  };

  const onChipKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addChip(chipDraft.replace(/,/g, ''));
    } else if (e.key === 'Backspace' && !chipDraft && values.implements_scf_ids.length) {
      set('implements_scf_ids', values.implements_scf_ids.slice(0, -1));
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const code = values.code.trim();
    if (!codeLocked && !code) { setError('Code is required.'); return; }
    if (!values.name.trim()) { setError('Name is required.'); return; }
    if (values.effective_date && values.review_date && values.review_date < values.effective_date) {
      setError('The review date cannot be before the effective date.');
      return;
    }
    const pendingChip = parseScfChip(chipDraft.replace(/,/g, ''));
    const implementsIds = pendingChip && !values.implements_scf_ids.includes(pendingChip)
      ? [...values.implements_scf_ids, pendingChip]
      : values.implements_scf_ids;
    setError(null);
    onSubmit({
      ...values,
      code: codeLocked ? (initial?.code || values.code) : code,
      name: values.name.trim(),
      statement: values.statement.trim(),
      domain: values.domain.trim(),
      implements_scf_ids: implementsIds,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-500">
        Fields start blank — no SCF prose or AI drafting. Where this control implements SCF controls,
        their maturity criteria and evidence requests are shown on the control page as published.
      </p>

      <Section title="Identity">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="cc-code">Code</label>
            <input id="cc-code" value={values.code} onChange={(e) => set('code', e.target.value)}
              disabled={codeLocked} required={!codeLocked} placeholder="e.g. CUST-01"
              className={`${fieldCls} font-mono disabled:bg-slate-50 disabled:text-slate-500`} />
            {!codeLocked && (
              <p className="mt-1 text-[11px] text-slate-400">Numbered for you — change it to match your own scheme.</p>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="cc-name">Name</label>
            <input id="cc-name" value={values.name} onChange={(e) => set('name', e.target.value)}
              placeholder="Short control name" className={fieldCls} />
          </div>
        </div>
        <div className="mt-3">
          <label className={labelCls} htmlFor="cc-statement">Statement</label>
          <textarea id="cc-statement" value={values.statement} onChange={(e) => set('statement', e.target.value)}
            rows={3} placeholder="What the control requires, in your own words" className={`${fieldCls} resize-y`} />
        </div>
        <div className="mt-3">
          <label className={labelCls} htmlFor="cc-objective">Control objective</label>
          <textarea id="cc-objective" value={values.objective} onChange={(e) => set('objective', e.target.value)}
            rows={2} placeholder="What must be true when this control works" className={`${fieldCls} resize-y`} />
        </div>
      </Section>

      <Section title="Classification" note="The same categories the internal-control register uses.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="cc-category">Category</label>
            <input id="cc-category" list="cc-category-list" value={values.category}
              onChange={(e) => set('category', e.target.value)} placeholder="Select or type"
              className={fieldCls} />
            <datalist id="cc-category-list">
              {(options?.categories ?? []).map((c) => <option key={c.value} value={c.value} />)}
            </datalist>
          </div>
          <div>
            <label className={labelCls} htmlFor="cc-subcategory">Sub-category</label>
            <input id="cc-subcategory" list="cc-subcategory-list" value={values.sub_category}
              onChange={(e) => set('sub_category', e.target.value)}
              placeholder={values.category ? 'Select or type' : 'Pick a category first'}
              className={fieldCls} />
            <datalist id="cc-subcategory-list">
              {subCategories.map((sc) => <option key={sc} value={sc} />)}
            </datalist>
          </div>
          <div>
            <label className={labelCls} htmlFor="cc-control-type">Control type</label>
            <select id="cc-control-type" value={values.control_type}
              onChange={(e) => set('control_type', e.target.value)} className={fieldCls}>
              <option value="">—</option>
              {(options?.control_types ?? ['preventive', 'detective', 'corrective']).map((t) => (
                <option key={t} value={t} className="capitalize">{t[0].toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="cc-type">Control nature</label>
            <select id="cc-type" value={values.control_sub_type}
              onChange={(e) => set('control_sub_type', e.target.value)} className={fieldCls}>
              {SUB_TYPE_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="cc-domain">Domain</label>
            <input id="cc-domain" list="cc-domain-list" value={values.domain}
              onChange={(e) => set('domain', e.target.value)} placeholder="Select or type a domain"
              className={fieldCls} />
            <datalist id="cc-domain-list">
              {DOMAIN_OPTS.map((d) => <option key={d} value={d} />)}
            </datalist>
          </div>
          <div>
            <label className={labelCls} htmlFor="cc-pptdf">PPTDF</label>
            <select id="cc-pptdf" value={values.pptdf} onChange={(e) => set('pptdf', e.target.value)}
              className={fieldCls}>
              <option value="">—</option>
              {PPTDF_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
      </Section>

      <Section title="How it operates"
        note="How often the control runs, how often its conformity is reassessed, and how much it matters.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="cc-frequency">Operating frequency</label>
            <select id="cc-frequency" value={values.operating_frequency}
              onChange={(e) => set('operating_frequency', e.target.value)} className={fieldCls}>
              <option value="">—</option>
              {(options?.operating_frequencies ?? []).map((f) => (
                <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="cc-cadence">Reassess conformity</label>
            <select id="cc-cadence" value={values.conformity_cadence}
              onChange={(e) => set('conformity_cadence', e.target.value)} className={fieldCls}>
              {CADENCE_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="cc-priority">Priority</label>
            <select id="cc-priority" value={values.priority}
              onChange={(e) => set('priority', e.target.value)} className={fieldCls}>
              {PRIORITY_OPTS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
          <label className="flex items-end gap-2 pb-2 text-[13px] text-slate-600">
            <input type="checkbox" checked={values.is_key_control}
              onChange={(e) => set('is_key_control', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300" />
            Key control
          </label>
          <div>
            <label className={labelCls} htmlFor="cc-effective">Effective date</label>
            <input id="cc-effective" type="date" value={values.effective_date}
              onChange={(e) => set('effective_date', e.target.value)} className={fieldCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="cc-review">Next review date</label>
            <input id="cc-review" type="date" value={values.review_date}
              onChange={(e) => set('review_date', e.target.value)} className={fieldCls} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="cc-regulatory">Regulatory source</label>
            <input id="cc-regulatory" value={values.regulatory_source}
              onChange={(e) => set('regulatory_source', e.target.value)}
              placeholder="e.g. SBP ETGRMF 4.2, Board resolution 2026-04" className={fieldCls} />
          </div>
        </div>
      </Section>

      <Section title="Accountability">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="cc-owner">Owner</label>
            <select id="cc-owner" value={values.owner_user_id ?? ''}
              onChange={(e) => set('owner_user_id', e.target.value ? Number(e.target.value) : null)}
              className={fieldCls}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="cc-backup">Backup owner</label>
            <select id="cc-backup" value={values.backup_owner_id ?? ''}
              onChange={(e) => set('backup_owner_id', e.target.value ? Number(e.target.value) : null)}
              className={fieldCls}>
              <option value="">—</option>
              {users.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="cc-reviewer">Reviewer</label>
            <select id="cc-reviewer" value={values.reviewer_user_id ?? ''}
              onChange={(e) => set('reviewer_user_id', e.target.value ? Number(e.target.value) : null)}
              className={fieldCls}>
              <option value="">—</option>
              {users.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="cc-department">Department</label>
            <select id="cc-department" value={values.department_id ?? ''}
              onChange={(e) => set('department_id', e.target.value ? Number(e.target.value) : null)}
              className={fieldCls}>
              <option value="">—</option>
              {(options?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {options && options.departments.length === 0 && (
              <p className="mt-1 text-[11px] text-slate-400">No business units configured yet.</p>
            )}
          </div>
        </div>
      </Section>

      <Section title="Guidance and evidence"
        note="What implementers and testers should do, and what this control is expected to produce.">
        <div className="space-y-3">
          <div>
            <label className={labelCls} htmlFor="cc-impl">Implementation guidance</label>
            <textarea id="cc-impl" value={values.implementation_guidance}
              onChange={(e) => set('implementation_guidance', e.target.value)} rows={3}
              placeholder="How this control is put in place and kept running" className={`${fieldCls} resize-y`} />
          </div>
          <div>
            <label className={labelCls} htmlFor="cc-testing">Testing guidance</label>
            <textarea id="cc-testing" value={values.testing_guidance}
              onChange={(e) => set('testing_guidance', e.target.value)} rows={3}
              placeholder="How a tester should check it, and what an exception looks like"
              className={`${fieldCls} resize-y`} />
          </div>
          <div>
            <span className={labelCls}>Recommended evidence</span>
            <EvidenceRows rows={values.recommended_evidence}
              onChange={(next) => set('recommended_evidence', next)} />
          </div>
        </div>
      </Section>

      {showImplements && (
        <Section title="Mappings"
          note="Naming the SCF controls this one implements inherits their framework requirements, maturity criteria and deliverables.">
          <label className={labelCls} htmlFor="cc-implements">Implements SCF ids</label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-primary-500">
            {values.implements_scf_ids.map((id) => (
              <span key={id}
                className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-700">
                {id}
                <button type="button"
                  onClick={() => set('implements_scf_ids', values.implements_scf_ids.filter((x) => x !== id))}
                  className="text-slate-400 hover:text-slate-700" aria-label={`Remove ${id}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input id="cc-implements" value={chipDraft} onChange={(e) => setChipDraft(e.target.value)}
              onKeyDown={onChipKey} onBlur={() => { if (chipDraft.trim()) addChip(chipDraft); }}
              placeholder={values.implements_scf_ids.length ? '' : 'Type GOV-01, Enter…'}
              className="min-w-[8rem] flex-1 border-0 bg-transparent py-1 text-sm text-slate-700 outline-none" />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Press Enter or comma to add. Framework requirement links are managed on the control&apos;s Requirements tab.
          </p>
        </Section>
      )}

      {showLinks && (
        <Section title="Linked records"
          note="Anything this control touches — risks it mitigates, assets it covers, documents that define it, issues it failed.">
          <RecordLinker selected={values.links} onChange={(next) => set('links', next)} label="" />
        </Section>
      )}

      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
        )}
        <button type="submit" disabled={pending}
          className="inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** The write body for the create/update endpoints, from form values.
 *
 * `clearTypes` names link types the control had before the edit: sending them
 * as empty arrays is how "I removed the last one of these" reaches the server.
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
