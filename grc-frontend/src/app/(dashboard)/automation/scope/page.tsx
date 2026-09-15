'use client';

// Automation → Scope. Answer four questions, save the SCF scope, preview then
// apply applicability. No card dashboard — one purposeful form.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Search } from 'lucide-react';
import axios from 'axios';
import { scfApi, type ScfFramework, type ScfScope } from '@/lib/api';

type Obligation = 'MCR' | 'DSR';

type FormState = {
  slugs: string[];
  obligations: Record<string, Obligation>;
  firm_size: number | '';
  esp_level: number;
  has_facilities: boolean;
  processes_personal_data: boolean;
  scope_statement: string;
};

type RecomputeResult = {
  commit?: boolean;
  added_count?: number;
  removed_count?: number;
  added?: string[];
  removed?: string[];
  unchanged?: number;
  summary?: string;
  applicable_count?: number;
  total_count?: number;
  journeys?: {
    created?: unknown[];
    existing?: unknown[];
    missing_frameworks?: string[];
  };
  links?: { linked?: number; skipped?: number };
};

const selCls =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-600 focus:border-primary-500 focus:outline-none';

function fromScope(s: ScfScope): FormState {
  const obligations: Record<string, Obligation> = {};
  for (const slug of s.framework_slugs || []) {
    const raw = String(s.framework_obligations?.[slug] || 'DSR').toUpperCase();
    obligations[slug] = raw === 'MCR' ? 'MCR' : 'DSR';
  }
  return {
    slugs: [...(s.framework_slugs || [])],
    obligations,
    firm_size: s.firm_size ?? '',
    esp_level: s.esp_level ?? 0,
    has_facilities: !!s.has_facilities,
    processes_personal_data: !!s.processes_personal_data,
    scope_statement: s.scope_statement || '',
  };
}

function errMessage(err: unknown, fallback: string): string {
  if (!axios.isAxiosError(err)) return fallback;
  const status = err.response?.status;
  if (status === 403) return 'You don’t have permission to change scope. Ask an admin with framework write access.';
  if (status === 503) return 'SCF catalog isn’t imported for this tenant yet. Import an SCF release first.';
  if (status === 409) {
    const d = err.response?.data?.detail;
    if (typeof d === 'string') return d;
    if (d?.reason) return String(d.reason);
  }
  const detail = err.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  return fallback;
}

function isNotProvisioned(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 503;
}

export default function AutomationScopePage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [fwSearch, setFwSearch] = useState('');
  const [preview, setPreview] = useState<RecomputeResult | null>(null);
  const [applyResult, setApplyResult] = useState<RecomputeResult | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const frameworksQ = useQuery({
    queryKey: ['scf-frameworks'],
    queryFn: async () => (await scfApi.listFrameworks()).data.frameworks as ScfFramework[],
  });

  const scopeQ = useQuery({
    queryKey: ['scf-scope-default'],
    queryFn: async () => (await scfApi.getDefaultScope()).data as ScfScope,
    retry: false,
  });

  useEffect(() => {
    if (scopeQ.data && !form) setForm(fromScope(scopeQ.data));
  }, [scopeQ.data, form]);

  const frameworks = frameworksQ.data ?? [];
  const shown = useMemo(() => {
    const q = fwSearch.trim().toLowerCase();
    if (!q) return frameworks;
    return frameworks.filter(
      (f) =>
        f.label.toLowerCase().includes(q) ||
        f.slug.toLowerCase().includes(q) ||
        (f.scf_keys || []).some((k) => k.toLowerCase().includes(q)),
    );
  }, [frameworks, fwSearch]);

  const toggleSlug = (slug: string) => {
    if (!form) return;
    const on = form.slugs.includes(slug);
    if (on) {
      const rest = { ...form.obligations };
      delete rest[slug];
      setForm({ ...form, slugs: form.slugs.filter((s) => s !== slug), obligations: rest });
    } else {
      setForm({
        ...form,
        slugs: [...form.slugs, slug],
        obligations: { ...form.obligations, [slug]: 'DSR' },
      });
    }
    setPreview(null);
    setApplyResult(null);
  };

  const setObligation = (slug: string, ob: Obligation) => {
    if (!form) return;
    setForm({ ...form, obligations: { ...form.obligations, [slug]: ob } });
    setPreview(null);
    setApplyResult(null);
  };

  const bodyFromForm = () => {
    if (!form) return null;
    const obligations: Record<string, string> = {};
    for (const slug of form.slugs) obligations[slug] = form.obligations[slug] || 'DSR';
    return {
      framework_slugs: form.slugs,
      framework_obligations: obligations,
      esp_level: form.esp_level,
      firm_size: form.firm_size === '' ? null : form.firm_size,
      has_facilities: form.has_facilities,
      processes_personal_data: form.processes_personal_data,
      scope_statement: form.scope_statement.trim() || null,
      locations: scopeQ.data?.locations ?? [],
      business_unit_ids: scopeQ.data?.business_unit_ids ?? [],
    };
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = bodyFromForm();
      if (!scopeQ.data || !body) throw new Error('Scope not loaded');
      return (await scfApi.updateScope(scopeQ.data.id, body)).data as ScfScope;
    },
    onSuccess: (data) => {
      setBanner('Scope saved. Preview impact, then apply to refresh Common Controls.');
      setForm(fromScope(data));
      setPreview(null);
      setApplyResult(null);
      qc.invalidateQueries({ queryKey: ['scf-scope-default'] });
      qc.invalidateQueries({ queryKey: ['automation-common'] });
      qc.invalidateQueries({ queryKey: ['common-overview'] });
    },
    onError: (err) => setBanner(errMessage(err, 'Couldn’t save scope.')),
  });

  const recompute = useMutation({
    mutationFn: async (commit: boolean) => {
      if (!scopeQ.data) throw new Error('Scope not loaded');
      return (await scfApi.recompute(scopeQ.data.id, commit)).data as RecomputeResult;
    },
    onSuccess: (data, commit) => {
      if (commit) {
        setApplyResult(data);
        setPreview(null);
        setBanner(null);
        qc.invalidateQueries({ queryKey: ['automation-common'] });
        qc.invalidateQueries({ queryKey: ['common-overview'] });
      } else {
        setPreview(data);
        setApplyResult(null);
      }
    },
    onError: (err) => setBanner(errMessage(err, 'Recompute failed.')),
  });

  if (scopeQ.isLoading || frameworksQ.isLoading) {
    return (
      <div className="flex h-48 items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (scopeQ.isError && isNotProvisioned(scopeQ.error)) {
    return (
      <div className="mx-auto max-w-2xl px-1 py-8">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Automation</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Scope</h1>
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          SCF catalog isn’t imported for this tenant yet. Import an SCF release before configuring scope.
        </p>
      </div>
    );
  }

  if (scopeQ.isError || !form) {
    return (
      <div className="mx-auto max-w-2xl px-1 py-8">
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errMessage(scopeQ.error, 'Couldn’t load the default scope.')}
        </p>
      </div>
    );
  }

  const empty = form.slugs.length === 0 && form.esp_level <= 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-1 py-1">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Automation</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Scope</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Choose frameworks and profile answers. Common Controls stays empty until you select frameworks and apply.
        </p>
      </div>

      {empty && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          No frameworks selected — the{' '}
          <Link href="/automation/soc2-controls" className="font-semibold text-primary-700 hover:underline">
            Common Controls
          </Link>{' '}
          list will stay empty until you scope and apply.
        </div>
      )}

      {banner && (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{banner}</p>
      )}

      {/* 1. Frameworks */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">1. Frameworks in scope</h2>
        <p className="text-[12px] text-slate-500">
          Tick frameworks you’re assessed against. Optional MCR/DSR per framework (default DSR).
        </p>
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={fwSearch}
            onChange={(e) => setFwSearch(e.target.value)}
            placeholder="Search frameworks…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-2 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-50">
          {shown.map((f) => {
            const on = form.slugs.includes(f.slug);
            return (
              <li key={f.slug} className={`flex items-center gap-3 px-3 py-2 ${on ? 'bg-primary-50/40' : ''}`}>
                <button
                  type="button"
                  onClick={() => toggleSlug(f.slug)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                      on ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'
                    }`}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="truncate text-sm font-medium text-slate-800">{f.label}</span>
                  {f.expected != null && (
                    <span className="shrink-0 text-[10px] tabular-nums text-slate-400">~{f.expected}</span>
                  )}
                </button>
                {on && (
                  <div className="flex shrink-0 gap-1">
                    {(['DSR', 'MCR'] as const).map((ob) => (
                      <button
                        key={ob}
                        type="button"
                        onClick={() => setObligation(f.slug, ob)}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          (form.obligations[f.slug] || 'DSR') === ob
                            ? 'bg-primary-600 text-white'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {ob}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-slate-400">No frameworks match.</li>
          )}
        </ul>
        <p className="text-[11px] text-slate-400">
          {form.slugs.length} selected
          {form.slugs.length > 0 && (
            <span className="ml-2 inline-flex flex-wrap gap-1">
              {form.slugs.map((s) => (
                <span key={s} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {frameworks.find((f) => f.slug === s)?.label || s} · {form.obligations[s] || 'DSR'}
                </span>
              ))}
            </span>
          )}
        </p>
      </section>

      {/* 2–4. Profile */}
      <section className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-slate-800">2. Firm size (BLS 1–9)</span>
          <select
            className={`block w-full ${selCls}`}
            value={form.firm_size === '' ? '' : String(form.firm_size)}
            onChange={(e) => {
              const v = e.target.value;
              setForm({ ...form, firm_size: v === '' ? '' : Number(v) });
              setPreview(null);
              setApplyResult(null);
            }}
          >
            <option value="">Not set</option>
            {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-slate-800">3. ESP level (0–3)</span>
          <select
            className={`block w-full ${selCls}`}
            value={form.esp_level}
            onChange={(e) => {
              setForm({ ...form, esp_level: Number(e.target.value) });
              setPreview(null);
              setApplyResult(null);
            }}
          >
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? '0 — none' : n}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">4. Facilities & personal data</h2>
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.has_facilities}
              onChange={(e) => {
                setForm({ ...form, has_facilities: e.target.checked });
                setPreview(null);
                setApplyResult(null);
              }}
              className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            Has facilities
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.processes_personal_data}
              onChange={(e) => {
                setForm({ ...form, processes_personal_data: e.target.checked });
                setPreview(null);
                setApplyResult(null);
              }}
              className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            Processes personal data
          </label>
        </div>
      </section>

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-slate-800">Scope statement (optional)</span>
        <textarea
          rows={3}
          value={form.scope_statement}
          onChange={(e) => setForm({ ...form, scope_statement: e.target.value })}
          placeholder="Brief description of what is in / out of scope…"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save scope
        </button>
        <button
          type="button"
          disabled={recompute.isPending || !scopeQ.data}
          onClick={() => recompute.mutate(false)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {recompute.isPending && recompute.variables === false ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          Preview impact
        </button>
        <button
          type="button"
          disabled={recompute.isPending || !scopeQ.data}
          onClick={() => recompute.mutate(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-100 disabled:opacity-50"
        >
          {recompute.isPending && recompute.variables === true ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          Apply scope
        </button>
        <Link
          href="/automation/soc2-controls"
          className="ml-auto text-xs font-medium text-primary-700 hover:underline"
        >
          Common Controls →
        </Link>
      </div>

      {preview && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          <p className="font-semibold text-slate-800">Preview</p>
          <p className="mt-1 text-slate-600">
            {preview.summary ||
              `${preview.added_count ?? preview.added?.length ?? 0} added · ${preview.removed_count ?? preview.removed?.length ?? 0} removed · ${preview.unchanged ?? 0} unchanged`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              +{preview.added_count ?? preview.added?.length ?? 0} applicable
            </span>
            <span className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
              −{preview.removed_count ?? preview.removed?.length ?? 0} no longer
            </span>
          </div>
        </div>
      )}

      {applyResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-slate-700">
          <p className="font-semibold text-emerald-900">Scope applied</p>
          <ul className="mt-1.5 space-y-0.5 text-[13px] text-slate-600">
            <li>
              Applicable controls:{' '}
              <span className="font-semibold tabular-nums text-slate-800">
                {applyResult.applicable_count ?? '—'}
              </span>
              {applyResult.total_count != null && (
                <span className="text-slate-400"> / {applyResult.total_count}</span>
              )}
            </li>
            <li>
              Added {applyResult.added_count ?? applyResult.added?.length ?? 0} · removed{' '}
              {applyResult.removed_count ?? applyResult.removed?.length ?? 0}
            </li>
            {applyResult.journeys && (
              <li>
                Journeys created: {applyResult.journeys.created?.length ?? 0}
                {(applyResult.journeys.existing?.length ?? 0) > 0 &&
                  ` · ${applyResult.journeys.existing!.length} already existed`}
              </li>
            )}
            {(applyResult.journeys?.missing_frameworks?.length ?? 0) > 0 && (
              <li className="text-amber-800">
                Missing uploaded frameworks: {applyResult.journeys!.missing_frameworks!.join(', ')}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
