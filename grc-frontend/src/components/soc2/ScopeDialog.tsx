'use client';

// Configure scope. The frameworks a tenant is assessed against and the profile
// answers that decide which SCF controls apply, in one dialog. Preview shows
// the change without saving anything; Save and apply saves the answers and
// recomputes applicability together, so a saved scope is always the one every
// control view reflects.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Check, Loader2, Search } from 'lucide-react';
import { scfApi, type ScfFramework, type ScfScope, type ScfScopeUpdateBody } from '@/lib/api';
import { AnimatedModal, useToast } from '@/components/ui';
import { frameworkColor } from './ui';

type Obligation = 'MCR' | 'DSR';

interface FormState {
  slugs: string[];
  obligations: Record<string, Obligation>;
  firm_size: number | '';
  esp_level: number;
  target_cmm: number;
  has_facilities: boolean;
  processes_personal_data: boolean;
  scope_statement: string;
}

interface Impact {
  added?: string[];
  removed?: string[];
  added_count?: number;
  removed_count?: number;
  unchanged?: number;
  applicable_count?: number;
  total_count?: number;
  journeys?: { created?: unknown[]; missing_frameworks?: string[] };
}

const CMM_LEVELS = [
  'Not performed', 'Performed informally', 'Planned & tracked', 'Well defined', 'Quantitatively controlled', 'Continuously improving',
];

/** Query keys whose data depends on scope, refreshed once a scope is applied. */
const SCOPED_KEYS = [
  'automation-common', 'common-overview', 'scf-default-scope', 'scf-scope-default', 'automation-common-detail',
  'control-assurance', 'control-evidence', 'control-artifacts', 'automation-coverage', 'scf-assurance-summary',
];

function fromScope(s: ScfScope): FormState {
  const obligations: Record<string, Obligation> = {};
  for (const slug of s.framework_slugs || []) {
    obligations[slug] = String(s.framework_obligations?.[slug] || 'DSR').toUpperCase() === 'MCR' ? 'MCR' : 'DSR';
  }
  return {
    slugs: [...(s.framework_slugs || [])],
    obligations,
    firm_size: s.firm_size ?? '',
    esp_level: s.esp_level ?? 0,
    target_cmm: s.target_cmm ?? 3,
    has_facilities: !!s.has_facilities,
    processes_personal_data: !!s.processes_personal_data,
    scope_statement: s.scope_statement || '',
  };
}

function errMessage(err: unknown, fallback: string): string {
  if (!axios.isAxiosError(err)) return fallback;
  const status = err.response?.status;
  if (status === 403) return 'You don’t have permission to change scope. Ask an admin with framework write access.';
  if (status === 503) return 'The SCF catalog isn’t imported for this tenant yet. Import an SCF release first.';
  const detail = err.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail?.reason) return String(detail.reason);
  return fallback;
}

const count = (list?: string[], n?: number) => n ?? list?.length ?? 0;

export function ScopeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [search, setSearch] = useState('');
  const [impact, setImpact] = useState<Impact | null>(null);
  const [error, setError] = useState<string | null>(null);

  const frameworksQ = useQuery({
    queryKey: ['scf-frameworks'],
    queryFn: async () => (await scfApi.listFrameworks()).data.frameworks as ScfFramework[],
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const scopeQ = useQuery({
    queryKey: ['scf-scope-default'],
    queryFn: async () => (await scfApi.getDefaultScope()).data as ScfScope,
    enabled: open,
    retry: false,
  });

  // Each opening starts from the saved scope, not from an abandoned edit.
  useEffect(() => {
    if (!open) { setForm(null); setImpact(null); setError(null); setSearch(''); return; }
    if (scopeQ.data && !form) setForm(fromScope(scopeQ.data));
  }, [open, scopeQ.data, form]);

  const frameworks = useMemo(() => frameworksQ.data ?? [], [frameworksQ.data]);
  const labelOf = useMemo(() => new Map(frameworks.map((f) => [f.slug, f.label])), [frameworks]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? frameworks.filter((f) => f.label.toLowerCase().includes(q) || f.slug.toLowerCase().includes(q))
      : frameworks;
    // selected first, so what is in scope is visible without scrolling
    return [...list].sort((a, b) => Number(form?.slugs.includes(b.slug)) - Number(form?.slugs.includes(a.slug)));
  }, [frameworks, search, form?.slugs]);

  const update = (patch: Partial<FormState>) => {
    if (!form) return;
    setForm({ ...form, ...patch });
    setImpact(null);
    setError(null);
  };
  const toggle = (slug: string) => {
    if (!form) return;
    const on = form.slugs.includes(slug);
    const obligations = { ...form.obligations };
    if (on) delete obligations[slug]; else obligations[slug] = 'DSR';
    update({ slugs: on ? form.slugs.filter((s) => s !== slug) : [...form.slugs, slug], obligations });
  };

  const body = (): ScfScopeUpdateBody | null => form && ({
    framework_slugs: form.slugs,
    framework_obligations: Object.fromEntries(form.slugs.map((s) => [s, form.obligations[s] || 'DSR'])),
    esp_level: form.esp_level,
    firm_size: form.firm_size === '' ? null : form.firm_size,
    target_cmm: form.target_cmm,
    has_facilities: form.has_facilities,
    processes_personal_data: form.processes_personal_data,
    scope_statement: form.scope_statement.trim() || null,
    locations: scopeQ.data?.locations ?? [],
    business_unit_ids: scopeQ.data?.business_unit_ids ?? [],
  });

  const preview = useMutation({
    mutationFn: async () => (await scfApi.previewScope(scopeQ.data!.id, body()!)).data as Impact,
    onSuccess: setImpact,
    onError: (e) => setError(errMessage(e, 'Couldn’t preview the change.')),
  });

  const apply = useMutation({
    mutationFn: async () => {
      await scfApi.updateScope(scopeQ.data!.id, body()!);
      return (await scfApi.recompute(scopeQ.data!.id, true)).data as Impact;
    },
    onSuccess: (r) => {
      for (const key of SCOPED_KEYS) qc.invalidateQueries({ queryKey: [key] });
      const missing = r.journeys?.missing_frameworks ?? [];
      toast({
        type: missing.length ? 'warning' : 'success',
        title: `Scope applied: ${r.applicable_count ?? '—'} controls in scope`,
        message: `${count(r.added, r.added_count)} added · ${count(r.removed, r.removed_count)} removed`
          + (missing.length ? ` · Not uploaded yet: ${missing.join(', ')}` : ''),
      });
      onClose();
    },
    onError: (e) => setError(errMessage(e, 'Couldn’t apply the scope.')),
  });

  const saved = scopeQ.data ? fromScope(scopeQ.data) : null;
  const dirty = !!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved);
  const busy = preview.isPending || apply.isPending;
  const selCls = 'mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-primary-500 focus:outline-none';

  return (
    <AnimatedModal
      isOpen={open}
      onClose={() => { if (!apply.isPending) onClose(); }}
      size="2xl"
      title="Configure scope"
      subtitle="The frameworks you are assessed against and the answers that decide which controls apply"
      footer={form && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || !scopeQ.data} onClick={() => preview.mutate()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {preview.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Preview impact
          </button>
          <span className="text-[11px] text-slate-400">Preview changes nothing until you apply.</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={apply.isPending}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
            <button type="button" disabled={busy || !scopeQ.data || (form.slugs.length === 0 && form.esp_level <= 0)} onClick={() => apply.mutate()}
              title={form.slugs.length === 0 && form.esp_level <= 0 ? 'Select at least one framework' : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
              {apply.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {dirty ? 'Save and apply' : 'Apply'}
            </button>
          </div>
        </div>
      )}
    >
      {scopeQ.isLoading || frameworksQ.isLoading || (open && !form && !scopeQ.isError) ? (
        <div className="flex h-48 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : scopeQ.isError || !form ? (
        <p className="m-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {errMessage(scopeQ.error, 'Couldn’t load the scope.')}
        </p>
      ) : (
        <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_17rem]">
          <section className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">Frameworks</h3>
              <span className="text-[11px] tabular-nums text-slate-500">{form.slugs.length} selected</span>
            </div>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search frameworks…"
                className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs focus:border-primary-500 focus:outline-none" />
            </div>
            <ul className="mt-2 max-h-[46vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {shown.map((f) => {
                const on = form.slugs.includes(f.slug);
                return (
                  <li key={f.slug} className={`flex items-center gap-2 px-3 py-1.5 ${on ? 'bg-primary-50/50' : ''}`}>
                    <button type="button" onClick={() => toggle(f.slug)} aria-pressed={on}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                      <span className={`flex size-4 shrink-0 items-center justify-center rounded border ${on ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'}`}>
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: frameworkColor(f.slug) }} />
                      <span className="truncate text-[13px] text-slate-800">{f.label}</span>
                      {f.expected != null && <span className="shrink-0 text-[10px] tabular-nums text-slate-400">~{f.expected} controls</span>}
                    </button>
                    {on && (
                      <div className="flex shrink-0 overflow-hidden rounded-md border border-slate-200 text-[10px] font-semibold">
                        {(['DSR', 'MCR'] as const).map((ob) => (
                          <button key={ob} type="button" onClick={() => update({ obligations: { ...form.obligations, [f.slug]: ob } })}
                            title={ob === 'MCR' ? 'Minimum compliance requirement: you must meet it' : 'Discretionary security requirement: you choose to meet it'}
                            className={`px-1.5 py-0.5 ${(form.obligations[f.slug] || 'DSR') === ob ? 'bg-primary-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                            {ob}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
              {!shown.length && <li className="px-3 py-6 text-center text-xs text-slate-400">No frameworks match.</li>}
            </ul>
            {form.slugs.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-1">
                {form.slugs.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: frameworkColor(s) }} />
                    {labelOf.get(s) || s} · {form.obligations[s] || 'DSR'}
                  </span>
                ))}
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">Organisation profile</h3>
            <label className="block text-xs font-medium text-slate-600">
              Firm size (BLS 1–9)
              <select className={selCls} value={form.firm_size === '' ? '' : String(form.firm_size)}
                onChange={(e) => update({ firm_size: e.target.value === '' ? '' : Number(e.target.value) })}>
                <option value="">Not set</option>
                {Array.from({ length: 9 }, (_, i) => i + 1).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              ESP level (0–3)
              <select className={selCls} value={form.esp_level} onChange={(e) => update({ esp_level: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((v) => <option key={v} value={v}>{v === 0 ? '0 — none' : v}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Target maturity
              <select className={selCls} value={form.target_cmm} onChange={(e) => update({ target_cmm: Number(e.target.value) })}>
                {CMM_LEVELS.map((name, level) => <option key={level} value={level}>CMM {level} — {name}</option>)}
              </select>
              <span className="mt-0.5 block text-[11px] font-normal text-slate-400">The default target for every control; a control can set its own.</span>
            </label>
            <div className="space-y-1.5 pt-1">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.has_facilities} onChange={(e) => update({ has_facilities: e.target.checked })}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
                Has physical facilities
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.processes_personal_data} onChange={(e) => update({ processes_personal_data: e.target.checked })}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
                Processes personal data
              </label>
            </div>
            <label className="block text-xs font-medium text-slate-600">
              Scope statement
              <textarea rows={3} value={form.scope_statement} onChange={(e) => update({ scope_statement: e.target.value })}
                placeholder="What is in and out of scope…"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-primary-500 focus:outline-none" />
            </label>
          </section>

          {(impact || error) && (
            <div className="md:col-span-2">
              {error ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
              ) : impact && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-semibold text-slate-800">If applied:</span>
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    +{count(impact.added, impact.added_count)} controls apply
                  </span>
                  <span className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                    −{count(impact.removed, impact.removed_count)} no longer apply
                  </span>
                  <span className="text-xs text-slate-500">{(impact.unchanged ?? 0).toLocaleString()} unchanged</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </AnimatedModal>
  );
}
