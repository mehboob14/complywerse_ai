'use client';
// What a connected source holds and how it tests: who it put in the population, what each of them
// can reach, what the last sync read and could not read, and — for a source with rules of its own —
// a button that runs them now and shows each rule's result, read-only, before any review exists.

import { Play, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { errorText, useRunConnectorRules, useSourcePeople } from '../../api';
import { Dialog } from '../../_components/Dialog';
import { RuleResultsTable } from '../../_components/RuleResults';
import { Alert, Badge, Button, ButtonLink, FOCUS, Spinner } from '../../_components/ui';
import { plural } from './catalog';

export type Resolved = { key: string; label: string; people: number; entitlements: number; lastSynced?: string | null };

function Reach({ title, items }: { title: string; items: { name: string; meta: string }[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-900">{title} ({items.length})</h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-800">
        {items.map((i) => <li key={i.name}>{i.name}{i.meta && <span className="text-slate-600"> · {i.meta}</span>}</li>)}
      </ul>
    </div>
  );
}

export function SourceDrawer({ source, ruleCount, limits, onClose, onResync }: {
  source: Resolved; ruleCount: number; limits?: string; onClose: () => void; onResync: () => void;
}) {
  const people = useSourcePeople(source.key);
  const run = useRunConnectorRules();
  const estate = people.data?.estate ?? {};
  const ran = run.data;
  const n = (s: string) => (ran?.results ?? []).filter((r) => r.status === s || (s === 'not_run' && r.status === 'error')).length;
  const list = people.data?.people ?? [];
  const reachable = [
    { title: 'Virtual machines', items: (estate.droplets ?? []).map((d) => ({ name: d.name, meta: [d.size, d.region, d.status, d.ip].filter(Boolean).join(' · ') })) },
    { title: 'Storage volumes', items: (estate.volumes ?? []).map((v) => ({ name: v.name, meta: [v.size_gb ? `${v.size_gb} GB` : null, v.region, v.attached_to?.length ? `attached to ${plural(v.attached_to.length, 'machine')}` : 'unattached'].filter(Boolean).join(' · ') })) },
    { title: 'Databases', items: (estate.databases ?? []).map((d) => ({ name: d.name, meta: [d.engine, d.version, d.region, d.nodes ? plural(d.nodes, 'node') : null].filter(Boolean).join(' · ') })) },
    { title: 'Kubernetes clusters', items: (estate.kubernetes ?? []).map((k) => ({ name: k.name, meta: [k.region, k.version].filter(Boolean).join(' · ') })) },
  ];

  return (
    <Dialog open onClose={onClose} side width="max-w-4xl" title={source.label}
      description={`${plural(source.people, 'identity', 'identities')} · ${plural(source.entitlements, 'access grant')}${source.lastSynced ? ` · synced ${new Date(source.lastSynced).toLocaleString()}` : ''}`}
      footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/compliance/access-reviews/new?source=${encodeURIComponent(source.key)}`} variant="primary">Start a review of this source</ButtonLink>
          <Button icon={RefreshCw} onClick={onResync}>Re-sync</Button>
        </div>

        {ruleCount > 0 && (
          <section aria-label={`Rules for ${source.label}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-base font-semibold text-slate-900">Rules for {source.label}</h3>
            <p className="mt-1 text-sm text-slate-700">
              {plural(ruleCount, 'rule')} test this source&apos;s own configuration, each with the frameworks it relates to. Running them here only reads the source: nothing is stored and no review is created.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" icon={Play} loading={run.isPending} onClick={() => run.mutate(source.key)}>{ran ? 'Run the rules again' : `Run the ${ruleCount} rules now`}</Button>
              <ButtonLink href={`/compliance/access-reviews/rules?source=${encodeURIComponent(source.key)}`}>See the rules</ButtonLink>
            </div>
            {run.isPending && <p role="status" className="mt-3 text-sm text-slate-700">Reading {source.label} and testing the rules. This can take a minute…</p>}
            {run.isError && <Alert tone="error" className="mt-3">{errorText(run.error, 'The rules could not be run.')}</Alert>}
            {ran && !run.isPending && (
              <div className="mt-4 space-y-3">
                <p role="status" className="text-sm text-slate-800">
                  <span className="font-semibold">{n('fail') ? `${plural(n('fail'), 'rule')} failed` : 'No rule failed'}</span>
                  {' · '}{n('not_run')} could not run · {n('pass')} passed · {n('not_applicable')} did not apply. Ran {new Date(ran.ran_at).toLocaleString()}.
                  {ran.read && Object.keys(ran.read).length > 0 && <> Read: {Object.entries(ran.read).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ')}.</>}
                </p>
                {!ran.connected && <Alert tone="warning">{ran.label} is not connected, so no rule could run.</Alert>}
                {(ran.limits || limits) && <Alert tone="info" title="What these rules cannot see">{ran.limits || limits}</Alert>}
                <RuleResultsTable compact results={ran.results} notes={[{ connector: ran.connector, label: ran.label, limits: ran.limits }]} caption={`${ran.label} rules and what each found`} />
              </div>
            )}
          </section>
        )}

        {(estate.read || estate.skipped?.length) ? (
          <section aria-label="What the last sync read">
            <h3 className="text-base font-semibold text-slate-900">What the last sync read</h3>
            <p className="mt-1 text-sm text-slate-800">{Object.entries(estate.read ?? {}).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ') || '—'}</p>
            {(estate.skipped ?? []).length > 0 && (
              <Alert tone="warning" className="mt-2" title="Not readable with this token">
                {(estate.skipped ?? []).map((x) => `${x.resource} (${x.reason})`).join('; ')}
              </Alert>
            )}
          </section>
        ) : null}

        {reachable.some((r) => r.items.length) && (
          <section aria-label="What this access reaches" className="space-y-3">
            <h3 className="text-base font-semibold text-slate-900">What this access reaches</h3>
            {reachable.map((r) => <Reach key={r.title} {...r} />)}
            <p className="text-xs text-slate-600">An SSH key opens the machines it was added to; DigitalOcean does not report which, so a review lists the machines it could reach. Local accounts on each machine need the Compliance Agent.</p>
          </section>
        )}

        <section aria-label="People and access">
          <h3 className="text-base font-semibold text-slate-900">People and access</h3>
          {people.isLoading ? <div className="mt-2"><Spinner label="Loading the people" /></div>
            : people.isError ? <Alert tone="error" className="mt-2">{errorText(people.error, 'The people could not be loaded.')}</Alert>
              : !list.length ? <p className="mt-1 text-sm text-slate-700">Nothing has been pulled yet. Re-sync to fetch this source&apos;s people and their access.</p> : (
                <>
                  <div role="region" aria-label="People this source reported" tabIndex={0} className={clsx('relative mt-2 max-h-[420px] overflow-auto rounded-lg border border-slate-200', FOCUS)}>
                    <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                      <caption className="sr-only">People this source reported and the access each holds from it</caption>
                      <thead className="sticky top-0 bg-slate-50">
                        <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-700">
                          <th scope="col" className="px-3 py-2">Identity</th>
                          <th scope="col" className="px-3 py-2">Access from {source.label}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((p) => (
                          <tr key={p.id} className="border-b border-slate-100 align-top last:border-0">
                            <th scope="row" className="px-3 py-2 font-normal">
                              <span className="font-semibold text-slate-900">{p.display_name}</span>
                              {p.account_enabled === false && <Badge tone="slate" className="ml-2">Disabled in source</Badge>}
                              <span className="block text-xs text-slate-600">{p.email}{p.designation ? ` · ${p.designation}` : ''}</span>
                            </th>
                            <td className="px-3 py-2">
                              {p.access.length ? <ul className="list-disc pl-4 text-slate-800">{p.access.map((a) => <li key={a}>{a}</li>)}</ul> : <span className="text-slate-600">None recorded</span>}
                              {p.other_access.length > 0 && <p className="mt-1 text-xs text-slate-600">Also holds: {p.other_access.join(' · ')}</p>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {list.length < (people.data?.total ?? 0) && <p className="mt-1 text-xs text-slate-600">Showing {list.length} of {people.data?.total}.</p>}
                </>
              )}
        </section>
      </div>
    </Dialog>
  );
}
