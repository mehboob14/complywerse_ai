'use client';
// src/app/(dashboard)/compliance/access-reviews/_components/RulePicker.tsx
// Which rules a review runs: every rule switched on in the library, the rules
// that evidence one framework, or a set picked by hand — and, whichever it is,
// exactly which rules that means before anything runs.

import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { MultiSelectDropdown } from '@/components/ui';
import { useRuleCatalog } from '../api';
import { severityClass } from '../pipeline';
import type { CatalogRule, RuleSelection } from '../types';

type Rule = CatalogRule & { domain: string };

const ACCENT = { background: 'var(--color-base)', color: 'var(--color-on-base)' } as const;
const SCOPES = [['enabled', 'All enabled rules'], ['framework', 'One framework'], ['custom', 'Pick rules']] as const;

const runnableOf = (domains?: { domain: string; rules: CatalogRule[] }[]): Rule[] =>
  (domains ?? []).flatMap((d) => d.rules.map((r) => ({ ...r, domain: d.domain }))).filter((r) => r.runnable);

/** The rules a selection runs, as the catalog stands — what the review will check. */
export function useRulesFor(sel: RuleSelection) {
  const all = useRuleCatalog();
  const framework = sel.rule_scope === 'framework' && sel.rule_framework ? sel.rule_framework : undefined;
  const scoped = useRuleCatalog(framework);
  const everything = useMemo(() => runnableOf(all.data?.domains), [all.data]);
  const rules = useMemo(() => {
    if (sel.rule_scope === 'framework') return framework ? runnableOf(scoped.data?.domains) : [];
    if (sel.rule_scope === 'custom') return everything.filter((r) => (sel.rule_ids ?? []).includes(r.id));
    return everything.filter((r) => r.enabled);
  }, [sel, framework, scoped.data, everything]);
  return { rules, everything, frameworks: all.data?.frameworks ?? [], loading: all.isLoading || (!!framework && scoped.isLoading) };
}

/** Is this a selection a review can run? (a framework picked, or at least one rule) */
export const selectionReady = (sel: RuleSelection, count: number) =>
  count > 0 && (sel.rule_scope !== 'framework' || !!sel.rule_framework);

export function RulePicker({ value, onChange }: { value: RuleSelection; onChange: (v: RuleSelection) => void }) {
  const { rules, everything, frameworks, loading } = useRulesFor(value);
  const [q, setQ] = useState('');
  const picked = new Set(value.rule_ids ?? []);
  const needle = q.trim().toLowerCase();

  const set = (patch: Partial<RuleSelection>) => onChange({ ...value, ...patch });
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    set({ rule_ids: everything.map((r) => r.id).filter((id) => next.has(id)) });
  };
  const grouped = (list: Rule[]) => {
    const out = new Map<string, Rule[]>();
    list.forEach((r) => out.set(r.domain, [...(out.get(r.domain) ?? []), r]));
    return Array.from(out.entries());
  };

  return (
    <div>
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
        {SCOPES.map(([k, label]) => (
          <button key={k} type="button" onClick={() => set({ rule_scope: k })} style={value.rule_scope === k ? ACCENT : undefined}
            className={`flex-1 rounded-md px-2.5 py-2 text-[12.5px] font-semibold ${value.rule_scope === k ? 'shadow-sm' : 'text-slate-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {value.rule_scope === 'framework' && (
        <div className="mt-3">
          <MultiSelectDropdown title="Pick a framework" triggerVariant="input" size="md" multiSelect={false} autoApply forceSearch
            showAvatars={false} searchPlaceholder="Search frameworks"
            items={frameworks.map((f) => ({ value: f.slug, label: f.name, subLabel: `${f.rules} rules mapped` }))}
            selectedValues={value.rule_framework ? [value.rule_framework] : []}
            onApply={(v) => set({ rule_framework: v[0] || null })} />
        </div>
      )}

      {value.rule_scope === 'custom' ? (
        <div className="mt-3 rounded-lg border border-slate-200">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search size={14} className="text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rules"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" />
            <span className="font-mono text-[11px] text-slate-400">{picked.size} of {everything.length} picked</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {grouped(everything.filter((r) => !needle || `${r.id} ${r.name} ${r.domain}`.toLowerCase().includes(needle))).map(([domain, list]) => {
              const all = list.every((r) => picked.has(r.id));
              return (
                <div key={domain}>
                  <div className="sticky top-0 flex items-center justify-between bg-slate-50 px-3 py-1.5">
                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{domain}</span>
                    <button type="button" onClick={() => toggle(list.map((r) => r.id), !all)} className="text-[11px] font-semibold" style={{ color: 'var(--color-base-strong)' }}>
                      {all ? 'Clear' : 'All'}
                    </button>
                  </div>
                  {list.map((r) => (
                    <label key={r.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-slate-50">
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${picked.has(r.id) ? 'border-transparent' : 'border-slate-300'}`}
                        style={picked.has(r.id) ? ACCENT : undefined}>
                        {picked.has(r.id) && <Check size={11} />}
                      </span>
                      <input type="checkbox" className="sr-only" checked={picked.has(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} />
                      <span className="font-mono text-[11px] text-slate-400">{r.id}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-800">{r.name}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase ${severityClass[r.severity]}`}>{r.severity}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
          {loading ? <p className="text-[12px] text-slate-400">Loading the rules…</p>
            : value.rule_scope === 'framework' && !value.rule_framework ? (
              <p className="text-[12px] text-slate-500">Pick a framework to see the rules that evidence it.</p>
            ) : rules.length === 0 ? (
              <p className="text-[12px] text-amber-700">No rule that can run today evidences this framework.</p>
            ) : (
              <>
                <p className="mb-1.5 text-[12px] text-slate-600">
                  <span className="font-semibold text-slate-900">{rules.length} rule{rules.length === 1 ? '' : 's'}</span> will run
                  {value.rule_scope === 'enabled' ? ' — every rule switched on in the Rule library.' : ', each with this framework’s clause:'}
                </p>
                <div className="max-h-40 overflow-y-auto">
                  {grouped(rules).map(([domain, list]) => (
                    <div key={domain} className="mb-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{domain}</div>
                      {list.map((r) => (
                        <div key={r.id} className="flex items-center gap-2 py-0.5 text-[12px]">
                          <span className="font-mono text-[10.5px] text-slate-400">{r.id}</span>
                          <span className="min-w-0 flex-1 truncate text-slate-700">{r.name}</span>
                          {value.rule_scope === 'framework' && r.frameworks?.[0] && (
                            <span className="shrink-0 font-mono text-[10.5px] text-slate-500">{r.frameworks[0].codes.slice(0, 2).join(', ')}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
        </div>
      )}
    </div>
  );
}
