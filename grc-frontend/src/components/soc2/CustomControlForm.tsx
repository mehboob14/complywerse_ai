'use client';

// Shared fields for create/edit of tenant custom controls. Blank authored
// fields only — never prefilled from SCF catalogue text or AI.

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

export const PPTDF_OPTS = ['People', 'Process', 'Technology', 'Data', 'Facility'] as const;
export const CADENCE_OPTS = ['Annual', 'Semi-Annual', 'Quarterly'] as const;
export const SUB_TYPE_OPTS = ['Manual', 'Automated', 'Hybrid'] as const;

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
};

const fieldCls =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none';
const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400';

function parseScfChip(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (!t) return null;
  return t;
}

export function CustomControlForm({
  initial,
  codeLocked = false,
  showImplements = true,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<CustomControlFormValues>;
  codeLocked?: boolean;
  showImplements?: boolean;
  submitLabel: string;
  pending?: boolean;
  onSubmit: (values: CustomControlFormValues) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<CustomControlFormValues>({ ...empty, ...initial });
  const [chipDraft, setChipDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CustomControlFormValues>(key: K, v: CustomControlFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  const addChip = (raw: string) => {
    const id = parseScfChip(raw);
    if (!id) return;
    if (values.implements_scf_ids.includes(id)) {
      setChipDraft('');
      return;
    }
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
    if (!codeLocked && !code) {
      setError('Code is required.');
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-500">
        SCF catalogue text stays read-only; write your own statement.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="cc-code">Code</label>
          <input
            id="cc-code"
            value={values.code}
            onChange={(e) => set('code', e.target.value)}
            disabled={codeLocked}
            required={!codeLocked}
            placeholder="e.g. CUST-01"
            className={`${fieldCls} font-mono disabled:bg-slate-50 disabled:text-slate-500`}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="cc-name">Name</label>
          <input
            id="cc-name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Short control name"
            className={fieldCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="cc-statement">Statement</label>
        <textarea
          id="cc-statement"
          value={values.statement}
          onChange={(e) => set('statement', e.target.value)}
          rows={4}
          placeholder="Tenant-authored control statement"
          className={`${fieldCls} resize-y`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="cc-domain">Domain</label>
          <input
            id="cc-domain"
            list="cc-domain-list"
            value={values.domain}
            onChange={(e) => set('domain', e.target.value)}
            placeholder="Select or type a domain"
            className={fieldCls}
          />
          <datalist id="cc-domain-list">
            {DOMAIN_OPTS.map((d) => <option key={d} value={d} />)}
          </datalist>
        </div>
        <div>
          <label className={labelCls} htmlFor="cc-pptdf">PPTDF</label>
          <select
            id="cc-pptdf"
            value={values.pptdf}
            onChange={(e) => set('pptdf', e.target.value)}
            className={fieldCls}
          >
            <option value="">—</option>
            {PPTDF_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="cc-cadence">Cadence</label>
          <select
            id="cc-cadence"
            value={values.conformity_cadence}
            onChange={(e) => set('conformity_cadence', e.target.value)}
            className={fieldCls}
          >
            {CADENCE_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="cc-type">Type</label>
          <select
            id="cc-type"
            value={values.control_sub_type}
            onChange={(e) => set('control_sub_type', e.target.value)}
            className={fieldCls}
          >
            {SUB_TYPE_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      {showImplements && (
        <div>
          <label className={labelCls} htmlFor="cc-implements">Implements SCF ids (optional)</label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-primary-500">
            {values.implements_scf_ids.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-700"
              >
                {id}
                <button
                  type="button"
                  onClick={() => set('implements_scf_ids', values.implements_scf_ids.filter((x) => x !== id))}
                  className="text-slate-400 hover:text-slate-700"
                  aria-label={`Remove ${id}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              id="cc-implements"
              value={chipDraft}
              onChange={(e) => setChipDraft(e.target.value)}
              onKeyDown={onChipKey}
              onBlur={() => { if (chipDraft.trim()) addChip(chipDraft); }}
              placeholder={values.implements_scf_ids.length ? '' : 'Type GOV-01, Enter…'}
              className="min-w-[8rem] flex-1 border-0 bg-transparent py-1 text-sm text-slate-700 outline-none"
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Press Enter or comma to add. Requirement links can be refined on the detail page.</p>
        </div>
      )}

      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
