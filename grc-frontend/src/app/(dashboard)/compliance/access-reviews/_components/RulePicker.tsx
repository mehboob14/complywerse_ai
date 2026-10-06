'use client';
// Which rules a review runs. Three ways to say it — every rule switched on for the source,
// the rules that evidence one framework, or a set picked by hand — and, whichever it is, the
// exact rules that means before anything runs: how many test the connected estate directly,
// how many test the people in the sample, and (for a framework) which of its clauses they answer.

import { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { clsx } from 'clsx';
import { useRuleCatalog } from '../api';
import type { CatalogRule, RuleCatalogView, RuleSelection } from '../types';
import { Combobox } from './Combobox';
import { shortFramework } from './RuleResults';
import { Badge, Field, FOCUS, RadioCards, SeverityTag, inputClass } from './ui';

export type PickerRule = CatalogRule & { domain: string };
const flat = (view?: RuleCatalogView): PickerRule[] => (view?.domains ?? []).flatMap((d) => d.rules.map((r) => ({ ...r, domain: d.domain })));

/** The rules a selection runs, as the library stands — what the review will test. */
export function useRulesFor(sel: RuleSelection, source?: string | null) {
  const all = useRuleCatalog(undefined, source || undefined);
  const framework = sel.rule_scope === 'framework' && sel.rule_framework ? sel.rule_framework : undefined;
  const scoped = useRuleCatalog(framework, source || undefined);
  const everything = useMemo(() => flat(all.data).filter((r) => r.runnable), [all.data]);
  const rules = useMemo(() => {
    if (sel.rule_scope === 'framework') return framework ? flat(scoped.data).filter((r) => r.runnable) : [];
    if (sel.rule_scope === 'custom') return everything.filter((r) => (sel.rule_ids ?? []).includes(r.id));
    return everything.filter((r) => r.enabled);
  }, [sel, framework, scoped.data, everything]);
  return {
    rules, everything,
    frameworks: all.data?.frameworks ?? [],
    connectors: all.data?.connectors ?? [],
    clauses: framework ? scoped.data?.clauses ?? [] : [],
    blocked: flat(all.data).filter((r) => !r.runnable).length,
    loading: all.isLoading || (!!framework && scoped.isLoading),
  };
}

/** Is this a selection a review can run? (a framework picked, or at least one rule) */
export const selectionReady = (sel: RuleSelection, count: number) =>
  count > 0 && (sel.rule_scope !== 'framework' || !!sel.rule_framework);

const group = (list: PickerRule[]) => {
  const out = new Map<string, PickerRule[]>();
  list.forEach((r) => out.set(r.domain, [...(out.get(r.domain) ?? []), r]));
  return Array.from(out.entries());
};

export function RulePicker({ value, onChange, source, sourceLabel }: {
  value: RuleSelection; onChange: (v: RuleSelection) => void;
  /** a review scoped to one source runs that source's rules */
  source?: string | null; sourceLabel?: string | null;
}) {
  const base = useId();
  const { rules, everything, frameworks, connectors, clauses, blocked, loading } = useRulesFor(value, source);
  const [q, setQ] = useState('');
  const picked = new Set(value.rule_ids ?? []);
  const needle = q.trim().toLowerCase();
  const set = (patch: Partial<RuleSelection>) => onChange({ ...value, ...patch });
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    set({ rule_ids: everything.map((r) => r.id).filter((id) => next.has(id)) });
  };
  const where = sourceLabel || 'your connected sources';

  return (
    <div className="space-y-4">
      <RadioCards legend="Which rules should this review run?" name={`${base}-scope`} columns={3}
        value={value.rule_scope} onChange={(k) => set({ rule_scope: k })}
        options={[
          { value: 'enabled', label: 'Every enabled rule', description: `All rules switched on in the Rule library that can run on ${where}.` },
          { value: 'framework', label: 'One framework', description: 'Only the rules that evidence a framework you choose, with its own clauses.' },
          { value: 'custom', label: 'Pick rules', description: 'Choose them one by one.' },
        ]} />

      {value.rule_scope === 'framework' && (
        <Field label="Framework" hint={frameworks.length ? `${frameworks.length} frameworks have rules that can run on ${where}. The number is how many.` : undefined}>
          {({ id, ...aria }) => (
            <Combobox id={id} label="Frameworks" placeholder="Search frameworks, e.g. ISO, SOC 2, PCI" emptyText="No framework matches."
              clearLabel="Clear the framework" value={value.rule_framework ?? ''} onChange={(slug) => set({ rule_framework: slug || null })}
              describedBy={aria['aria-describedby']}
              options={frameworks.map((f) => ({ value: f.slug, label: f.name, hint: `${f.runnable} rule${f.runnable === 1 ? '' : 's'}` }))} />
          )}
        </Field>
      )}

      {value.rule_scope === 'custom' ? (
        <div className="rounded-lg border border-slate-300 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-3 py-2">
            <div className="relative min-w-[200px] flex-1">
              <label htmlFor={`${base}-search`} className="sr-only">Search rules</label>
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden />
              <input id={`${base}-search`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rules" className={clsx(inputClass, 'pl-9')} />
            </div>
            <p role="status" className="text-sm text-slate-700"><span className="font-semibold tabular-nums">{picked.size}</span> of {everything.length} picked</p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading ? <p className="p-4 text-sm text-slate-600">Loading the rules…</p> : group(everything.filter((r) => !needle || `${r.id} ${r.name} ${r.domain}`.toLowerCase().includes(needle))).map(([domain, list]) => {
              const all = list.every((r) => picked.has(r.id));
              const hid = `${base}-${domain.replace(/\W+/g, '-')}`;
              return (
                <div key={domain} role="group" aria-labelledby={hid}>
                  <div className="sticky top-0 flex items-center justify-between bg-[#eef1f4] px-3 py-1.5">
                    <h3 id={hid} className="text-xs font-semibold uppercase tracking-wide text-slate-800">{domain}</h3>
                    <button type="button" onClick={() => toggle(list.map((r) => r.id), !all)} className={clsx('rounded px-1 text-xs font-semibold text-teal-800 underline underline-offset-2', FOCUS)}>
                      {all ? 'Clear' : 'Select all'}<span className="sr-only"> in {domain}</span>
                    </button>
                  </div>
                  {list.map((r) => (
                    <label key={r.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50 has-[:focus-visible]:bg-teal-50">
                      <input type="checkbox" checked={picked.has(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} className="h-4 w-4 shrink-0 accent-teal-700" />
                      <span className="min-w-0 flex-1 text-sm text-slate-900">{r.name}<span className="ml-2 font-mono text-xs text-slate-600">{r.id}</span></span>
                      {r.connector_label && <Badge tone="sky">{r.connector_label}</Badge>}
                      <SeverityTag severity={r.severity} />
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <Summary rules={rules} loading={loading} scope={value.rule_scope} framework={value.rule_framework} frameworkName={frameworks.find((f) => f.slug === value.rule_framework)?.name}
          clauses={clauses} connectors={connectors} where={where} />
      )}

      {value.rule_scope === 'custom' && <Summary rules={rules} loading={loading} scope="custom" connectors={connectors} where={where} compact />}
      {blocked > 0 && !source && (
        <p className="text-xs text-slate-600">{blocked} more rules in the library need a source that is not connected yet, so they cannot run. See the Rule library.</p>
      )}
    </div>
  );
}

function Summary({ rules, loading, scope, framework, frameworkName, clauses = [], connectors, where, compact }: {
  rules: PickerRule[]; loading: boolean; scope: RuleSelection['rule_scope']; framework?: string | null; frameworkName?: string;
  clauses?: { code: string; rules: string[] }[]; connectors: { key: string; label: string }[]; where: string; compact?: boolean;
}) {
  const estate = rules.filter((r) => r.kind === 'connector');
  const people = rules.length - estate.length;
  const labels = Array.from(new Set(estate.map((r) => r.connector_label ?? connectors.find((c) => c.key === r.connector)?.label ?? ''))).filter(Boolean);
  return (
    <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800">
      {loading ? <p>Loading the rules…</p>
        : scope === 'framework' && !framework ? <p>Choose a framework to see the rules that evidence it.</p>
          : rules.length === 0 ? (
            <p role="status" className="font-medium text-amber-900">
              {scope === 'framework' ? `No rule that can run on ${where} evidences this framework.` : 'No rule is selected.'}
            </p>
          ) : (
            <>
              <p role="status">
                <span className="font-semibold">{rules.length} rule{rules.length === 1 ? '' : 's'}</span> will run
                {estate.length > 0 && <>: {estate.length} test{estate.length === 1 ? 's' : ''} {labels.join(' and ') || 'the connected estate'} directly</>}
                {people > 0 && <>{estate.length > 0 ? ' and ' : ': '}{people} test{people === 1 ? 's' : ''} the people in the sample</>}.
                {scope === 'framework' && frameworkName && clauses.length > 0 && <> Together they answer {clauses.length} clause{clauses.length === 1 ? '' : 's'} of {shortFramework(frameworkName)}.</>}
              </p>
              {!compact && (
                <details className="mt-2">
                  <summary className={clsx('cursor-pointer rounded text-sm font-semibold text-teal-800 underline underline-offset-2', FOCUS)}>See the rules</summary>
                  <div role="region" aria-label="The rules that will run" tabIndex={0} className={clsx('relative mt-2 max-h-64 space-y-2 overflow-y-auto rounded', FOCUS)}>
                    {group(rules).map(([domain, list]) => (
                      <section key={domain} aria-label={domain}>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">{domain}</h4>
                        <ul className="mt-0.5">
                          {list.map((r) => (
                            <li key={r.id} className="flex items-center gap-2 py-0.5">
                              <span className="font-mono text-xs text-slate-600">{r.id}</span>
                              <span className="min-w-0 flex-1 truncate">{r.name}</span>
                              {scope === 'framework' && r.frameworks?.[0] && <span className="shrink-0 font-mono text-xs text-slate-700">{r.frameworks[0].codes.slice(0, 2).join(', ')}</span>}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
    </div>
  );
}
