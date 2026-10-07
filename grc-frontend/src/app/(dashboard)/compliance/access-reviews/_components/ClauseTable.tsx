'use client';
// The clauses of one framework that the listed rules relate to. A clause is listed when a rule tests a
// Secure Controls Framework control that the framework's crosswalk maps to it, so a requirement and its
// sub-requirements usually come out answered by the same rules: those clauses are shown once, together,
// instead of one row each. It follows the list it sits above, so filtering the rules (a system, a category,
// a search) narrows the clauses too. Below them, the framework's access clauses that no rule answers yet:
// a framework brings no rules of its own, so "all of its rules" is what is covered and what is still missing.

import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { FOCUS } from './ui';

export type Clause = { code: string; rules: string[] };
/** An access clause no rule answers, with the control(s) that make it an access clause. */
export type Gap = { code: string; scf: { id: string; name: string | null }[] };
type Listed = { id: string; name: string; runnable: boolean };

/** Clauses answered by exactly the same rules, in the order each group first appears. Only `visible` rules count. */
export function groupClauses(clauses: Clause[], visible?: ReadonlySet<string>): { codes: string[]; rules: string[] }[] {
  const groups = new Map<string, { codes: string[]; rules: string[] }>();
  for (const c of clauses) {
    const rules = visible ? c.rules.filter((id) => visible.has(id)) : c.rules;
    if (!rules.length) continue;
    const key = [...rules].sort().join('|');
    const hit = groups.get(key);
    if (hit) hit.codes.push(c.code); else groups.set(key, { codes: [c.code], rules });
  }
  return Array.from(groups.values());
}

/** Gaps that rest on the same controls (8.2.1 and 8.2.2 both on "Account Management"), in the order each first appears. */
export function groupGaps(gaps: Gap[]): { codes: string[]; scf: Gap['scf'] }[] {
  const groups = new Map<string, { codes: string[]; scf: Gap['scf'] }>();
  for (const g of gaps) {
    const key = g.scf.map((s) => s.id).join('|');
    const hit = groups.get(key);
    if (hit) hit.codes.push(g.code); else groups.set(key, { codes: [g.code], scf: g.scf });
  }
  return Array.from(groups.values());
}

const SHOWN = 6;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function RuleList({ ids, byId }: { ids: string[]; byId: Map<string, Listed> }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <ul className="space-y-0.5">
        {(all ? ids : ids.slice(0, SHOWN)).map((id) => {
          const r = byId.get(id);
          return (
            <li key={id} className={clsx(r && !r.runnable && 'italic text-slate-600')}>
              <span className="font-mono text-xs not-italic text-slate-600">{id}</span> {r?.name ?? id}
              {r && !r.runnable && <span className="sr-only"> (cannot run yet)</span>}
            </li>
          );
        })}
      </ul>
      {ids.length > SHOWN && (
        <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)}
          className={clsx('mt-1 rounded text-xs font-semibold text-teal-800 underline underline-offset-2', FOCUS)}>
          {all ? 'Show fewer rules' : `Show ${ids.length - SHOWN} more rule${ids.length - SHOWN === 1 ? '' : 's'}`}
        </button>
      )}
    </>
  );
}

export function ClauseTable({ clauses, rules, framework, gaps = [], access }: {
  clauses: Clause[]; rules: Listed[]; framework: string; gaps?: Gap[]; access?: { total: number; answered: number } | null;
}) {
  const byId = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const groups = useMemo(() => groupClauses(clauses, new Set(byId.keys())), [clauses, byId]);
  const open = useMemo(() => groupGaps(gaps), [gaps]);
  const count = groups.reduce((n, g) => n + g.codes.length, 0);
  return (
    <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className={clsx('cursor-pointer rounded-xl px-5 py-3 text-sm font-semibold text-slate-900', FOCUS)}>
        {count} clause{count === 1 ? '' : 's'} of {framework} relate to the rules listed below
        {gaps.length > 0 && <span className="font-normal text-amber-900"> · {plural(gaps.length, 'access clause')} with no rule yet</span>}
      </summary>
      <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-700">
        A clause is listed when a rule tests a Secure Controls Framework control that this framework&apos;s crosswalk maps to it.
        Clauses that exactly the same rules answer are shown together. Rules in italics cannot run yet.
      </p>
      {!groups.length ? (
        <p role="status" className="border-t border-slate-100 px-5 py-4 text-sm text-slate-700">No clause relates to the rules listed.</p>
      ) : (
        <div role="region" aria-label="Clauses and the rules that answer them" tabIndex={0} className={clsx('relative max-h-96 overflow-y-auto border-t border-slate-100', FOCUS)}>
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Clauses of {framework} and the rules that answer each</caption>
            <thead className="sticky top-0 bg-slate-50"><tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-700">
              <th scope="col" className="w-[240px] px-5 py-2">Clauses</th><th scope="col" className="px-3 py-2">Rules that answer them</th>
            </tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.codes[0]} className="border-b border-slate-100 align-top last:border-0">
                  <th scope="row" className="px-5 py-2 font-normal">
                    <span className="font-mono text-xs font-medium text-slate-900">{g.codes.join(', ')}</span>
                    {g.codes.length > 1 && <span className="mt-0.5 block text-xs text-slate-600">{g.codes.length} clauses</span>}
                  </th>
                  <td className="px-3 py-2 text-slate-800"><RuleList ids={g.rules} byId={byId} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {gaps.length > 0 && (
        <section aria-label="Access clauses with no rule yet" className="border-t border-slate-200">
          <h3 className="px-5 pt-3 text-sm font-semibold text-slate-900">No rule yet: {plural(gaps.length, 'access clause')}</h3>
          <p className="px-5 pb-3 pt-1 text-sm text-slate-700">
            {access ? `${access.answered} of ${access.total} access clauses of ${framework} have a rule. ` : ''}
            An access clause is one this framework&apos;s crosswalk maps to a control for identifying, authenticating or authorising people.
            These are the ones none of the rules listed tests, with the control that makes each of them an access clause.
          </p>
          <div role="region" aria-label="Access clauses no rule answers yet" tabIndex={0} className={clsx('relative max-h-96 overflow-y-auto border-t border-slate-100', FOCUS)}>
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Access clauses of {framework} that no rule answers yet, and the control each rests on</caption>
              <thead className="sticky top-0 bg-slate-50"><tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-700">
                <th scope="col" className="w-[240px] px-5 py-2">Clauses</th><th scope="col" className="px-3 py-2">Control that makes them access clauses</th>
              </tr></thead>
              <tbody>
                {open.map((g) => (
                  <tr key={g.codes[0]} className="border-b border-slate-100 align-top last:border-0">
                    <th scope="row" className="px-5 py-2 font-normal">
                      <span className="font-mono text-xs font-medium text-slate-900">{g.codes.join(', ')}</span>
                      {g.codes.length > 1 && <span className="mt-0.5 block text-xs text-slate-600">{g.codes.length} clauses</span>}
                    </th>
                    <td className="px-3 py-2 text-slate-800">
                      <ul className="space-y-0.5">
                        {g.scf.map((s) => (
                          <li key={s.id}><span className="font-mono text-xs text-slate-600">{s.id}</span> {s.name ?? ''}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </details>
  );
}
