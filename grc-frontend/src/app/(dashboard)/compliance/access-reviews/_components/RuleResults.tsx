'use client';
// src/app/(dashboard)/compliance/access-reviews/_components/RuleResults.tsx
// What each rule found in a review, grouped by category: pass or fail with how
// many people each, the frameworks (and their clauses) the rule evidences, and —
// opened — what it checks and who failed it, and why.

import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, XCircle } from 'lucide-react';
import { severityClass } from '../pipeline';
import type { FrameworkRef, ReviewItem, RuleResult } from '../types';

/** "EMEA Saudi Arabia ECC-1 2018" reads as "ECC-1 2018" on a chip. */
export function shortFramework(name: string): string {
  return name.replace(/^(EMEA|APAC|AMER|Americas)\s+/, '').replace(/^(Saudi Arabia|Australia|Japan|Canada|Spain)\s+/, '')
    .replace(/\s*\(used for SOC 2\)/, ' (SOC 2)').slice(0, 26);
}

export function FrameworkChips({ refs, total, max = 3 }: { refs?: FrameworkRef[]; total?: number; max?: number }) {
  const list = refs ?? [];
  if (!list.length) return <span className="text-[11px] text-slate-400">No framework mapped</span>;
  const more = (total ?? list.length) - Math.min(list.length, max);
  return (
    <span className="flex flex-wrap gap-1" title={list.map((f) => `${f.name}: ${f.codes.join(', ')}`).join('\n')}>
      {list.slice(0, max).map((f) => (
        <span key={f.slug} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
          {shortFramework(f.name)}{f.codes.length ? <span className="font-mono font-normal text-slate-500"> {f.codes.slice(0, 2).join(', ')}</span> : null}
        </span>
      ))}
      {more > 0 && <span className="px-0.5 py-0.5 text-[10px] font-semibold text-slate-400">+{more}</span>}
    </span>
  );
}

/** Rules grouped by category, the categories with failures first. */
export function byCategory<T extends { domain: string }>(rules: T[]): [string, T[]][] {
  const out = new Map<string, T[]>();
  rules.forEach((r) => out.set(r.domain, [...(out.get(r.domain) ?? []), r]));
  return Array.from(out.entries());
}

type Filter = 'all' | 'fail' | 'pass';

export function RuleResultsTable({ results, items, onUser, filter = 'all' }: {
  results: RuleResult[]; items: ReviewItem[]; onUser?: (itemId: number) => void; filter?: Filter;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const shown = useMemo(() => results.filter((r) => filter === 'all' || r.status === filter), [results, filter]);
  if (!shown.length) {
    return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-[13px] text-slate-500">
      {results.length ? 'No rule matches this filter.' : 'No rules have run yet.'}
    </div>;
  }
  return (
    <div className="space-y-3">
      {byCategory(shown).map(([category, rules]) => {
        const failed = rules.filter((r) => r.status === 'fail').length;
        return (
          <section key={category} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2">
              <h3 className="text-[12.5px] font-bold text-slate-900">{category}</h3>
              <span className="text-[11.5px] text-slate-500">
                {rules.length} rule{rules.length === 1 ? '' : 's'}
                {failed > 0 ? <span className="font-semibold text-rose-600"> · {failed} failed</span> : <span className="text-emerald-600"> · all passed</span>}
              </span>
            </div>
            {rules.map((r) => {
              const isOpen = !!open[r.id];
              const total = (r.failed ?? 0) + (r.passed ?? 0);
              const who = r.status === 'fail'
                ? items.map((it) => ({ it, hit: (it.rules ?? []).find((x) => x.id === r.id && x.status === 'fail') })).filter((x) => x.hit)
                : [];
              return (
                <div key={r.id} className="border-b border-slate-100 last:border-0">
                  <button type="button" onClick={() => setOpen({ ...open, [r.id]: !isOpen })} aria-expanded={isOpen}
                    className="grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 md:grid-cols-[1rem_minmax(0,1fr)_4.5rem_minmax(0,15rem)_8rem]">
                    {isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                    <span className="flex min-w-0 items-center gap-2">
                      {r.status === 'fail' ? <XCircle size={15} className="shrink-0 text-rose-500" /> : <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />}
                      <span className="shrink-0 font-mono text-[11px] text-slate-400">{r.id}</span>
                      <span className="truncate text-[13px] font-medium text-slate-800">{r.name}</span>
                    </span>
                    <span className="hidden md:block"><span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase ${severityClass[r.severity]}`}>{r.severity}</span></span>
                    <span className="hidden min-w-0 md:block"><FrameworkChips refs={r.frameworks} max={2} /></span>
                    <span className="text-right">
                      <span className={`font-mono text-[12.5px] font-semibold ${r.failed ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {r.failed ? `${r.failed} failed` : 'Passed'}
                      </span>
                      <span className="block text-[10.5px] text-slate-400">{r.passed ?? 0} of {total} passed</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-2.5 bg-slate-50/60 px-4 pb-3.5 pl-11 pt-1 text-[12px] text-slate-600">
                      {(r.reads || r.trips) && (
                        <p><span className="text-slate-400">Reads</span> {r.reads} <span className="text-slate-400">· fails when</span> {r.trips}</p>
                      )}
                      <div>
                        <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Evidences</p>
                        <FrameworkChips refs={r.frameworks} max={6} />
                      </div>
                      {who.length > 0 && (
                        <div>
                          <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Failed by</p>
                          <ul className="space-y-1">
                            {who.map(({ it, hit }) => (
                              <li key={it.id} className="flex items-start gap-2">
                                {onUser ? (
                                  <button type="button" onClick={() => onUser(it.id)} className="shrink-0 font-semibold text-slate-800 hover:underline">
                                    {it.display_name || it.email}
                                  </button>
                                ) : <span className="shrink-0 font-semibold text-slate-800">{it.display_name || it.email}</span>}
                                {hit?.detail && <span className="text-slate-500">— {hit.detail}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
