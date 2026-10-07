'use client';
// Rule library: every rule a review can run — what must be true, what it reads, when it fails, how to put
// it right and the frameworks and clauses it relates to. Filter by what it tests (people, or one system —
// which lists what a review of that system can run), by framework, category and whether it can run; switch
// a rule off to leave it out of reviews that run "every enabled rule".

import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ListChecks, PlugZap, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { PageHeader, PageLoader } from '@/components/ui';
import { errorText, useRuleCatalog, useUpdateRule } from '../api';
import type { CatalogRule } from '../types';
import { ClauseTable } from '../_components/ClauseTable';
import { Combobox } from '../_components/Combobox';
import { FrameworkChips, byCategory, shortFramework } from '../_components/RuleResults';
import { Alert, Badge, Button, FOCUS, Field, SeverityTag, Stat, Switch, inputClass } from '../_components/ui';
import { usePageTitle } from '../_components/usePageTitle';

const crumbs = [{ label: 'Compliance', href: '/compliance' }, { label: 'Access reviews', href: '/compliance/access-reviews' }, { label: 'Rule library', href: '/compliance/access-reviews/rules' }];

const AVAILABILITY: Record<CatalogRule['status'], { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  runnable: { label: 'Can run now', cls: 'text-emerald-800', Icon: CheckCircle2 },
  needs_data: { label: 'Waiting for a data feed', cls: 'text-amber-900', Icon: AlertTriangle },
  needs_connector: { label: 'Waiting for a source', cls: 'text-slate-700', Icon: PlugZap },
};
type Row = CatalogRule & { domain: string };

// What an identity rule is for, in the words of the Sources page: the people in the sample, or the accounts
// of the systems it is restricted to; a rule that cannot run yet says what it is waiting to read.
const SOURCE_NAMES: Record<string, string> = {
  digitalocean: 'DigitalOcean', aws: 'AWS', github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket', azure_devops: 'Azure DevOps', database: 'Databases',
};
const runsOnLabel = (r: CatalogRule) =>
  r.kind === 'connector' ? r.connector_label || 'A source'
    : r.sources?.length ? `Accounts from ${r.sources.map((s) => SOURCE_NAMES[s] ?? s).join(', ')}` : 'People in the sample';

export default function RuleLibraryPage() {
  usePageTitle('Rule library');
  const search = useSearchParams();
  const [framework, setFramework] = useState('');
  const [runsOn, setRunsOn] = useState(search.get('source') ?? '');
  const [category, setCategory] = useState('');
  const [availability, setAvailability] = useState<'all' | 'runnable' | 'blocked'>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  // A system is asked of the server, which lists what a review of it can run (its own rules and the account
  // rules that apply to it); "people" is just the rules that test people, so it stays a filter here.
  const source = runsOn && runsOn !== 'people' ? runsOn : undefined;
  const { data, isLoading, isError, error, isFetching } = useRuleCatalog(framework || undefined, source);
  const update = useUpdateRule();

  const all = useMemo<Row[]>(() => (data?.domains ?? []).flatMap((d) => d.rules.map((r) => ({ ...r, domain: d.domain }))), [data]);
  const categories = useMemo(() => Array.from(new Set(all.map((r) => r.domain))).sort(), [all]);
  const connectors = data?.connectors ?? [];
  const frameworks = data?.frameworks ?? [];
  const frameworkName = frameworks.find((f) => f.slug === framework)?.name;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((r) => runsOn !== 'people' || r.kind !== 'connector')
      .filter((r) => !category || r.domain === category)
      .filter((r) => availability === 'all' ? true : availability === 'runnable' ? r.runnable : !r.runnable)
      .filter((r) => !needle || `${r.id} ${r.name} ${r.reads} ${r.trips}`.toLowerCase().includes(needle));
  }, [all, runsOn, category, availability, q]);
  const groups = useMemo(() => byCategory(rows), [rows]);

  if (isLoading) return <PageLoader />;
  if (isError || !data) return <Alert tone="error" title="The rule library could not be loaded">{errorText(error)}</Alert>;

  const sourceLabel = connectors.find((c) => c.key === source)?.label ?? source;
  const pool = data.summary.catalog_total ?? data.summary.total;
  const rulesHint = framework
    ? (sourceLabel ? `of ${pool} a review of ${sourceLabel} can run, these relate to this framework` : `of ${pool} relate to this framework`)
    : sourceLabel ? `a review of ${sourceLabel} can run` : 'across every category';
  const blocked = all.filter((r) => !r.runnable);
  const waitingSource = blocked.filter((r) => r.status === 'needs_connector').length;
  const waitingData = blocked.length - waitingSource;
  const filtered = !!(runsOn || category || q || framework || availability !== 'all');
  const clear = () => { setRunsOn(''); setCategory(''); setQ(''); setFramework(''); setAvailability('all'); };
  const toggle = (r: Row, on: boolean) => update.mutate({ ruleId: r.id, enabled: on }, {
    onSuccess: () => setAnnounce(`${r.name} switched ${on ? 'on' : 'off'}.`),
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Rule library" icon={ListChecks} breadcrumbs={crumbs}
        subtitle="Each rule states what must be true, what it reads and when it fails: it passes when that holds and fails when it does not. Choose a framework to see the rules that relate to it, or a system to see what a review of it can run." />

      <section aria-label="Summary">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Rules" value={data.summary.total} hint={rulesHint} />
          <Stat label="Can run now" value={data.summary.runnable} hint={`with the sources you have connected · ${data.summary.enabled_active} switched on`} tone="emerald" />
          <Stat label="Cannot run yet" value={blocked.length}
            hint={blocked.length ? [waitingSource && `${waitingSource} wait for a source`, waitingData && `${waitingData} for a data feed`].filter(Boolean).join(' · ') : 'every rule here can run'} tone={blocked.length ? 'amber' : undefined} />
          <Stat label="Frameworks covered" value={data.summary.frameworks_covered ?? frameworks.length} hint="in your crosswalk" />
        </dl>
        <details className="mt-3 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm text-slate-800 shadow-sm">
          <summary className={clsx('cursor-pointer rounded text-sm font-semibold text-slate-900', FOCUS)}>How rules, frameworks and sources fit together</summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li><strong>Rules</strong> are our own catalogue of access tests. A framework brings no rules of its own: choosing one lists the rules whose Secure Controls Framework controls map to its clauses, and the access clauses that no rule tests yet.</li>
            <li><strong>Sources</strong> decide what can run. A rule runs only when a source supplies what it reads: {data.summary.runnable} here read data you already have; {blocked.length} wait for a source, such as DigitalOcean, SAP or your network devices, or for a data feed.</li>
            <li><strong>Runs on</strong> narrows the list to what a review of one system can run. The other rules belong to other systems.</li>
          </ul>
        </details>
      </section>

      <form role="search" aria-label="Filter the rules" onSubmit={(e) => e.preventDefault()} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <Field label="Search">
            {(aria) => (
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden />
                <input {...aria} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, ID, what it reads" className={clsx(inputClass, 'pl-9')} />
              </div>
            )}
          </Field>
        </div>
        <Field label="Runs on" hint="A system lists what a review of it can run.">
          {(aria) => (
            <select {...aria} value={runsOn} onChange={(e) => setRunsOn(e.target.value)} className={inputClass}>
              <option value="">Everything</option>
              <option value="people">People in the sample</option>
              {connectors.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          )}
        </Field>
        <div className="lg:col-span-2">
          <Field label="Framework" hint={framework ? undefined : `${frameworks.length} frameworks in your library`}>
            {({ id, ...aria }) => (
              <Combobox id={id} label="Frameworks" placeholder="Any framework" emptyText="No framework matches." clearLabel="Clear the framework"
                value={framework} onChange={setFramework} describedBy={aria['aria-describedby']}
                options={frameworks.map((f) => ({ value: f.slug, label: f.name, hint: `${f.rules} rule${f.rules === 1 ? '' : 's'}${f.library ? ` · ${f.library}` : ''}` }))} />
            )}
          </Field>
        </div>
        <Field label="Category">
          {(aria) => (
            <select {...aria} value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </Field>
        <Field label="Availability">
          {(aria) => (
            <select {...aria} value={availability} onChange={(e) => setAvailability(e.target.value as typeof availability)} className={inputClass}>
              <option value="all">All rules</option>
              <option value="runnable">Can run now</option>
              <option value="blocked">Needs a source or data</option>
            </select>
          )}
        </Field>
        <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-5">
          <p role="status" className="text-sm text-slate-700">Showing <span className="font-semibold tabular-nums">{rows.length}</span> of {all.length} rules.</p>
          {filtered && <Button size="sm" variant="ghost" onClick={clear}>Clear filters</Button>}
        </div>
      </form>

      {framework && (!!data.clauses?.length || !!data.gaps?.length) && (
        <ClauseTable clauses={data.clauses ?? []} rules={rows} framework={shortFramework(frameworkName ?? framework)}
          gaps={data.gaps} access={data.access} />
      )}

      <div aria-busy={isFetching} className="space-y-6">
        {!groups.length && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-700">
            No rule matches these filters. {filtered && <button type="button" onClick={clear} className={clsx('rounded font-semibold text-teal-800 underline underline-offset-2', FOCUS)}>Clear the filters</button>}
          </div>
        )}
        {groups.map(([domain, list]) => (
          <section key={domain} aria-labelledby={`cat-${domain.replace(/\W+/g, '-')}`}>
            <h2 id={`cat-${domain.replace(/\W+/g, '-')}`} className="mb-2 text-base font-semibold text-slate-900">
              {domain} <span className="text-sm font-normal text-slate-600">({list.length})</span>
            </h2>
            <div role="region" aria-label={`${domain} rules`} tabIndex={0} className={clsx('relative overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm', FOCUS)}>
              <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                <caption className="sr-only">{domain} rules</caption>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-700">
                    <th scope="col" className="w-[72px] px-4 py-3">On</th>
                    <th scope="col" className="px-3 py-3">Rule</th>
                    <th scope="col" className="w-[170px] px-3 py-3">Runs on</th>
                    <th scope="col" className="w-[110px] px-3 py-3">Severity</th>
                    <th scope="col" className="w-[250px] px-3 py-3">Frameworks</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const a = AVAILABILITY[r.status];
                    const detail = `rule-detail-${r.id}`;
                    return (
                      <Fragment key={r.id}>
                        <tr className={clsx('border-b border-slate-100 align-top', !r.runnable && 'bg-slate-50/60')}>
                          <td className="px-4 py-3">
                            <Switch checked={r.enabled && r.runnable} disabled={!r.runnable || (update.isPending && update.variables?.ruleId === r.id)}
                              label={`Include ${r.name} in reviews`} onChange={(on) => toggle(r, on)} />
                          </td>
                          <td className="px-3 py-3">
                            <button type="button" aria-expanded={open === r.id} aria-controls={detail} onClick={() => setOpen(open === r.id ? null : r.id)}
                              className={clsx('flex w-full items-start gap-2 rounded text-left', FOCUS)}>
                              {open === r.id ? <ChevronDown size={16} className="mt-0.5 shrink-0 text-slate-700" aria-hidden /> : <ChevronRight size={16} className="mt-0.5 shrink-0 text-slate-700" aria-hidden />}
                              <span className="min-w-0">
                                <span className="block font-semibold text-slate-900">{r.name}</span>
                                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                  <span className="font-mono text-slate-700">{r.id}</span>
                                  <span className={clsx('inline-flex items-center gap-1 font-medium', a.cls)}><a.Icon size={13} aria-hidden /> {a.label}</span>
                                </span>
                              </span>
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            {r.kind === 'connector' || (r.runnable && !r.sources?.length)
                              ? <Badge tone={r.kind === 'connector' ? 'sky' : 'slate'}>{runsOnLabel(r)}</Badge>
                              : <span className="text-xs text-slate-800">{r.runnable ? runsOnLabel(r) : `Needs ${r.reads}`}</span>}
                          </td>
                          <td className="px-3 py-3"><SeverityTag severity={r.severity} /></td>
                          <td className="px-3 py-3"><FrameworkChips refs={r.frameworks} total={r.frameworks_total} max={2} /></td>
                        </tr>
                        {open === r.id && (
                          <tr id={detail} className="border-b border-slate-100 bg-slate-50">
                            <td />
                            <td colSpan={4} className="px-3 pb-4 pt-1 text-sm text-slate-800">
                              <div className="grid gap-4 md:grid-cols-2">
                                <section aria-label="What it reads"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">What it reads</h3><p className="mt-1">{r.reads || '—'}</p></section>
                                <section aria-label="When it fails"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">When it fails</h3><p className="mt-1">{r.trips ? `There is ${r.trips}.` : '—'}</p></section>
                                {r.fix && <section aria-label="How to put it right" className="md:col-span-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">How to put it right</h3><p className="mt-1">{r.fix}</p></section>}
                                {!r.runnable && (
                                  <p className="md:col-span-2 text-slate-700">
                                    {r.kind === 'connector' ? `Connect ${r.connector_label || 'the source it reads'} under Sources before this rule can run.`
                                      : r.status === 'needs_connector' ? `It needs a source that reports ${r.reads}. None of your connected sources does yet, so it cannot run.`
                                        : `It needs a data feed (${r.reads}) that is not connected yet, so it cannot run.`}
                                  </p>
                                )}
                                <section aria-label="Frameworks" className="md:col-span-2">
                                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">Frameworks and clauses it relates to</h3>
                                  <div className="mt-1"><FrameworkChips refs={r.frameworks} total={r.frameworks_total} max={12} /></div>
                                  {!!r.scf?.length && <p className="mt-1 text-xs text-slate-600">Secure Controls Framework: {r.scf.join(', ')}</p>}
                                </section>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>
      {update.isError && <Alert tone="error">{errorText(update.error, 'The rule could not be changed.')}</Alert>}
    </div>
  );
}
