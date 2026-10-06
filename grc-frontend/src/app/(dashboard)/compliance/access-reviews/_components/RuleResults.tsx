'use client';
// What every rule found in a review. One row per rule, failures first: the result in words
// (Failed, Not run, Passed, Not applicable), what it tested, its category and the frameworks
// it evidences. Open a row for what it checks, what it found (the failing resources or
// identities, or why it could not be judged), how to put it right and the clauses it answers.
// "Not applicable" rules are kept out of the way until asked for: they judged nothing.

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { shortFramework } from '../pipeline';
import type { ConnectorNote, FrameworkRef, Outcome, ReviewItem, RuleResult } from '../types';
import { Badge, FOCUS, FilterChip, OutcomePill, SeverityTag, inputClass, outcomeLabel } from './ui';

export { shortFramework };

export function FrameworkChips({ refs, total, max = 3 }: { refs?: FrameworkRef[]; total?: number | null; max?: number }) {
  const list = refs ?? [];
  if (!list.length) return <span className="text-xs text-slate-600">No framework mapped</span>;
  const more = (total ?? list.length) - Math.min(list.length, max);
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Frameworks this rule evidences">
      {list.slice(0, max).map((f) => (
        <li key={f.slug} title={`${f.name}: ${f.codes.join(', ')}`}
          className="max-w-[220px] truncate rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-800">
          {shortFramework(f.name)}{f.codes.length ? <span className="font-mono font-normal text-slate-700"> {f.codes.slice(0, 2).join(', ')}</span> : null}
        </li>
      ))}
      {more > 0 && <li className="px-0.5 py-0.5 text-xs font-medium text-slate-700">+{more} more</li>}
    </ul>
  );
}

/** Rules grouped by category, in the order they first appear. */
export function byCategory<T extends { domain: string }>(rules: T[]): [string, T[]][] {
  const out = new Map<string, T[]>();
  rules.forEach((r) => out.set(r.domain, [...(out.get(r.domain) ?? []), r]));
  return Array.from(out.entries());
}

export const RESULT_ORDER: Outcome[] = ['fail', 'not_run', 'pass', 'not_applicable'];
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const normalise = (o: Outcome): Outcome => (o === 'error' ? 'not_run' : o);

/** Tested 3 of 3 · Tested 2 of 4 (1 not run, 1 not applicable). */
function testedText(r: RuleResult): string {
  const pop = r.population ?? 0; const tested = r.tested ?? 0;
  if (r.status === 'not_applicable' || r.status === 'not_run' || r.status === 'error') return tested ? `${tested} of ${pop}` : '—';
  const noun = r.kind === 'connector' ? '' : ' identities';
  return `${tested} of ${pop}${noun}`;
}

export function RuleResultsTable({ results, items = [], onUser, notes = [], caption = 'Rules and what each found', compact = false }: {
  results: RuleResult[]; items?: ReviewItem[]; onUser?: (itemId: number) => void; notes?: ConnectorNote[]; caption?: string;
  /** for a narrow place (a drawer): the category and framework columns move into each row's details */
  compact?: boolean;
}) {
  const [filter, setFilter] = useState<'all' | Outcome>('all');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [runsOn, setRunsOn] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [showNA, setShowNA] = useState(false);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: results.length, fail: 0, not_run: 0, pass: 0, not_applicable: 0 };
    results.forEach((r) => { c[normalise(r.status)] += 1; });
    return c;
  }, [results]);
  const categories = useMemo(() => Array.from(new Set(results.map((r) => r.domain))).sort(), [results]);
  const sources = useMemo(() => Array.from(new Set(results.map((r) => (r.kind === 'connector' ? r.connector ?? '' : 'people')))).filter(Boolean), [results]);
  const labelFor = (key: string) => (key === 'people' ? 'People in the sample' : notes.find((n) => n.connector === key)?.label ?? key);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return results
      .filter((r) => (filter === 'all' ? true : normalise(r.status) === filter))
      .filter((r) => !category || r.domain === category)
      .filter((r) => !runsOn || (runsOn === 'people' ? r.kind !== 'connector' : r.connector === runsOn))
      .filter((r) => !needle || `${r.id} ${r.name} ${r.domain}`.toLowerCase().includes(needle))
      .sort((a, b) => RESULT_ORDER.indexOf(normalise(a.status)) - RESULT_ORDER.indexOf(normalise(b.status))
        || (b.failed ?? 0) - (a.failed ?? 0) || (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || a.id.localeCompare(b.id));
  }, [results, filter, q, category, runsOn]);

  // Rules that judged nothing stay collapsed under "All" — they are the long tail, not the news.
  const tail = filter === 'all' && !showNA ? shown.filter((r) => r.status === 'not_applicable') : [];
  const rows = tail.length ? shown.filter((r) => r.status !== 'not_applicable') : shown;

  const FILTERS: { key: 'all' | Outcome; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'fail', label: 'Failed' }, { key: 'not_run', label: 'Not run' },
    { key: 'pass', label: 'Passed' }, { key: 'not_applicable', label: 'Not applicable' },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Filter by result" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => <FilterChip key={f.key} pressed={filter === f.key} onClick={() => setFilter(f.key)} count={counts[f.key]}>{f.label}</FilterChip>)}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <label htmlFor="rule-search" className="sr-only">Search rules</label>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden />
          <input id="rule-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rules" className={clsx(inputClass, 'pl-9')} />
        </div>
        <div>
          <label htmlFor="rule-category" className="sr-only">Category</label>
          <select id="rule-category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {sources.length > 1 && (
          <div>
            <label htmlFor="rule-runs-on" className="sr-only">Runs on</label>
            <select id="rule-runs-on" value={runsOn} onChange={(e) => setRunsOn(e.target.value)} className={inputClass}>
              <option value="">Everything it runs on</option>
              {sources.map((s) => <option key={s} value={s}>{labelFor(s)}</option>)}
            </select>
          </div>
        )}
      </div>
      <p role="status" className="mb-2 text-sm text-slate-600">
        Showing {shown.length} of {results.length} rule{results.length === 1 ? '' : 's'}.
      </p>

      {!shown.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-600">
          {results.length ? 'No rule matches these filters.' : 'No rules have run yet.'}
        </div>
      ) : (
        <div role="region" aria-label={caption} tabIndex={0} className={clsx('relative overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm', FOCUS)}>
          <table className={clsx('w-full border-collapse text-left text-sm', compact ? 'min-w-[560px]' : 'min-w-[860px]')}>
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-700">
                <th scope="col" className="w-[150px] px-4 py-3">Result</th>
                <th scope="col" className="px-4 py-3">Rule</th>
                <th scope="col" className="w-[150px] px-4 py-3">Tested</th>
                {!compact && <th scope="col" className="w-[170px] px-4 py-3">Category</th>}
                {!compact && <th scope="col" className="w-[260px] px-4 py-3">Frameworks</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <RuleRow key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} items={items} onUser={onUser} labelFor={labelFor} compact={compact} />)}
              {tail.length > 0 && (
                <tr className="border-t border-slate-200 bg-slate-50">
                  <td colSpan={compact ? 3 : 5} className="px-4 py-3">
                    <button type="button" onClick={() => setShowNA(true)} className={clsx('text-sm font-semibold text-teal-800 underline underline-offset-2 hover:text-teal-900', FOCUS, 'rounded')}>
                      Show {tail.length} rule{tail.length === 1 ? '' : 's'} that did not apply
                    </button>
                    <span className="ml-2 text-sm text-slate-600">They had nothing to judge in this review, so they neither passed nor failed.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RuleRow({ r, open, onToggle, items, onUser, labelFor, compact }: {
  r: RuleResult; open: boolean; onToggle: () => void; items: ReviewItem[]; onUser?: (id: number) => void; labelFor: (k: string) => string; compact: boolean;
}) {
  const detailId = `rule-detail-${r.id}`;
  const failed = r.status === 'fail';
  const who = failed && r.kind !== 'connector'
    ? items.map((it) => ({ it, hit: (it.rules ?? []).find((x) => x.id === r.id && x.status === 'fail') })).filter((x) => x.hit)
    : [];
  return (
    <Fragment>
      <tr className={clsx('border-b border-slate-100 align-top', failed ? 'bg-rose-50/60' : 'bg-white')}>
        <td className="px-4 py-3"><OutcomePill outcome={r.status} /></td>
        <td className="px-4 py-3">
          <button type="button" aria-expanded={open} aria-controls={detailId} onClick={onToggle}
            className={clsx('flex w-full items-start gap-2 rounded text-left', FOCUS)}>
            {open ? <ChevronDown size={16} className="mt-0.5 shrink-0 text-slate-700" aria-hidden /> : <ChevronRight size={16} className="mt-0.5 shrink-0 text-slate-700" aria-hidden />}
            <span className="min-w-0">
              <span className="block font-semibold text-slate-900">{r.name}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-700">
                <span className="font-mono">{r.id}</span>
                <SeverityTag severity={r.severity} />
                <Badge tone={r.kind === 'connector' ? 'sky' : 'slate'}>{r.kind === 'connector' ? labelFor(r.connector ?? '') : 'People in the sample'}</Badge>
                {compact && r.domain && <span>{r.domain}</span>}
              </span>
            </span>
          </button>
        </td>
        <td className="px-4 py-3 tabular-nums text-slate-800">
          {testedText(r)}
          {failed && <span className="block text-xs font-semibold text-rose-800">{r.failed} failed</span>}
        </td>
        {!compact && <td className="px-4 py-3 text-slate-800">{r.domain || '—'}</td>}
        {!compact && <td className="px-4 py-3"><FrameworkChips refs={r.frameworks} total={r.frameworks_total} max={2} /></td>}
      </tr>
      {open && (
        <tr id={detailId} className="border-b border-slate-100 bg-slate-50">
          <td />
          <td colSpan={compact ? 2 : 4} className="px-4 pb-4 pt-1 text-sm text-slate-800">
            <div className="grid gap-4 md:grid-cols-2">
              <section aria-label="What it checks">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">What it checks</h4>
                <p className="mt-1">{r.reads ? <>It reads {r.reads}. </> : null}{r.trips ? <>It fails when there is {r.trips}.</> : (!r.reads && 'No description recorded.')}</p>
              </section>
              <section aria-label="What it found">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">What it found</h4>
                <Found r={r} who={who} onUser={onUser} />
              </section>
              {r.fix && failed && (
                <section aria-label="How to fix it" className="md:col-span-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">How to put it right</h4>
                  <p className="mt-1">{r.fix}</p>
                </section>
              )}
              <section aria-label="Frameworks" className="md:col-span-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">Frameworks and clauses it evidences</h4>
                <div className="mt-1"><FrameworkChips refs={r.frameworks} total={r.frameworks_total} max={8} /></div>
                {!!r.scf?.length && <p className="mt-1 text-xs text-slate-600">Secure Controls Framework: {r.scf.join(', ')}</p>}
              </section>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function Found({ r, who, onUser }: { r: RuleResult; who: { it: ReviewItem; hit?: { detail?: string | null } }[]; onUser?: (id: number) => void }) {
  if (r.status === 'not_run' || r.status === 'not_applicable' || r.status === 'error') {
    return (
      <p className="mt-1">
        <strong>{outcomeLabel(r.status)}.</strong> {r.reason || r.detail || 'It could not be judged.'}
        {r.kind !== 'connector' && (r.not_applicable || r.not_run) ? (
          <span className="block text-xs text-slate-600">{r.not_applicable ?? 0} not applicable, {r.not_run ?? 0} not run, of {r.population ?? 0} identities.</span>
        ) : null}
      </p>
    );
  }
  if (r.status === 'pass') {
    return (
      <p className="mt-1">
        {r.kind === 'connector'
          ? <>All {r.tested} checked {r.tested === 1 ? 'resource' : 'resources'} passed.</>
          : <>All {r.tested} identities it could judge passed{(r.not_applicable || r.not_run) ? `; ${(r.not_applicable ?? 0) + (r.not_run ?? 0)} could not be judged by this rule.` : '.'}</>}
        {r.detail && r.kind === 'connector' && /\(/.test(r.detail) ? <span className="block text-xs text-slate-600">{r.detail}</span> : null}
      </p>
    );
  }
  if (r.kind === 'connector') {
    const more = (r.failed ?? 0) - (r.failures?.length ?? 0);
    return (
      <div className="mt-1">
        <p>{r.failed} of {r.tested} failed:</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {/* the detail usually opens with the resource's own name: say it once */}
          {(r.failures ?? []).map((f) => <li key={f.resource}><strong>{f.resource}</strong> {f.detail.startsWith(f.resource) ? f.detail.slice(f.resource.length).trimStart() : `— ${f.detail}`}</li>)}
        </ul>
        {more > 0 && <p className="mt-1 text-xs text-slate-600">and {more} more.</p>}
      </div>
    );
  }
  return (
    <ul className="mt-1 space-y-1">
      {who.map(({ it, hit }) => (
        <li key={it.id}>
          {onUser
            ? <button type="button" onClick={() => onUser(it.id)} className={clsx('rounded font-semibold text-teal-800 underline underline-offset-2 hover:text-teal-900', FOCUS)}>{it.display_name || it.email}</button>
            : <strong>{it.display_name || it.email}</strong>}
          {hit?.detail && <span> — {hit.detail}</span>}
        </li>
      ))}
    </ul>
  );
}
