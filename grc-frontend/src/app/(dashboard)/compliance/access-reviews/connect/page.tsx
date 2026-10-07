'use client';
// Sources: the systems a review draws its people and access from. Connect only what you have,
// in any order; everything feeds one population. A source that has rules of its own (DigitalOcean
// today) is also tested directly, and says so on its card.

import { useMemo, useState } from 'react';
import { CheckCircle2, ListChecks, Plug, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { PageHeader, PageLoader } from '@/components/ui';
import { errorText, useCollectors, useConnectorFields, useConnectors, useRuleCatalog, useSyncSource, type Collector } from '../api';
import type { ConnectorSource } from '../types';
import { Alert, Badge, Button, ButtonLink, FilterChip, Stat, inputClass } from '../_components/ui';
import { usePageTitle } from '../_components/usePageTitle';
import { ALL_VENDORS, CATEGORIES, isConnected, plural, sourceKeys, statFor, type Vendor } from './_parts/catalog';
import { ConnectDialog } from './_parts/ConnectDialog';
import { SourceDrawer, type Resolved } from './_parts/SourceDrawer';
import { SourceRulesDialog } from './_parts/SourceRulesDialog';

const crumbs = [{ label: 'Compliance', href: '/compliance' }, { label: 'Access reviews', href: '/compliance/access-reviews' }, { label: 'Sources', href: '/compliance/access-reviews/connect' }];

type Entry = {
  id: string; name: string; sub: string; initials: string; color: string; connected: boolean;
  people: number; rules: number; vendor?: Vendor; collector?: Collector; stat?: ConnectorSource;
};
type Filter = 'all' | 'connected' | 'available';

export default function SourcesPage() {
  usePageTitle('Sources');
  const status = useConnectors();
  const collectorsQ = useCollectors();
  const fieldsQ = useConnectorFields();
  const rulesQ = useRuleCatalog();
  const sync = useSyncSource();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [active, setActive] = useState<Vendor | null>(null);
  const [inspect, setInspect] = useState<{ entry: Entry; resolved: Resolved } | null>(null);
  const [rulesOf, setRulesOf] = useState<Entry | null>(null);        // the source whose rules are being read
  const [syncing, setSyncing] = useState<string | null>(null);
  const [allTools, setAllTools] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const sources = useMemo(() => status.data?.sources ?? [], [status.data]);
  const ruleBy = useMemo(() => new Map((rulesQ.data?.connectors ?? []).map((c) => [c.key, c])), [rulesQ.data]);
  const ruleOf = (key: string) => ruleBy.get(key);

  const { groups, connectedCount, totalCount } = useMemo(() => {
    const vendorEntry = (v: Vendor): Entry => {
      const stat = statFor(sources, v);
      return { id: v.key, name: v.name, sub: v.sub, initials: v.initials, color: v.color, connected: isConnected(status.data, v),
        people: stat?.people ?? 0, rules: ruleBy.get(v.key)?.rules ?? 0, vendor: v, stat };
    };
    const own = new Set(ALL_VENDORS.map((v) => v.key));
    const tools: Entry[] = (collectorsQ.data ?? []).filter((c) => !own.has(c.key)).map((c) => {
      const stat = sources.find((s) => s.key === c.key);
      return { id: `collector-${c.key}`, name: c.label, sub: c.connected ? 'Credential already on file' : 'Connect it under Evidence Collectors', initials: c.label.slice(0, 2).toUpperCase(),
        color: '#334155', connected: c.connected, people: stat?.people ?? 0, rules: 0, collector: c, stat };
    });
    // the catalogue first; the evidence collectors you already run come last, as a long optional list
    const all = [
      ...CATEGORIES.map((c) => ({ id: c.id, title: c.title, sub: c.sub, entries: c.vendors.map(vendorEntry) })),
      ...(tools.length ? [{ id: 'tools', title: 'Tools you already connect', sub: 'Evidence collectors can also supply their people, with the credential already stored for them.', entries: tools }] : []),
    ];
    const needle = q.trim().toLowerCase();
    const every = all.flatMap((g) => g.entries);
    return {
      connectedCount: every.filter((e) => e.connected).length, totalCount: every.length,
      groups: all.map((g) => ({
        ...g, total: g.entries.length, connected: g.entries.filter((e) => e.connected).length,
        entries: [...g.entries].sort((a, b) => Number(b.connected) - Number(a.connected))       // connected first
          .filter((e) => (filter === 'connected' ? e.connected : filter === 'available' ? !e.connected : true))
          .filter((e) => !needle || `${e.name} ${e.sub}`.toLowerCase().includes(needle)),
      })).filter((g) => g.entries.length),
    };
  }, [status.data, sources, ruleBy, collectorsQ.data, q, filter]);

  if (status.isLoading) return <PageLoader />;
  if (status.isError) return <Alert tone="error" title="The sources could not be loaded">{errorText(status.error)}</Alert>;

  const shown = groups.reduce((n, g) => n + g.entries.length, 0);
  const withRules = (rulesQ.data?.connectors ?? []).filter((c) => c.rules > 0);

  const pullPeople = (c: Collector) => {
    setSyncing(c.key); setNote(null);
    sync.mutate({ url: '/connectors/collector/sync', body: { provider: c.key } }, {
      onSuccess: (d) => setNote({ ok: true, text: `${c.label}: pulled ${plural(Number(d.created ?? 0) + Number(d.updated ?? 0), 'person', 'people')}${d.entitlements_linked ? `, ${plural(Number(d.entitlements_linked), 'access grant')}` : ''}${d.partial ? ` (${String(d.partial)})` : ''}.` }),
      onError: (e) => setNote({ ok: false, text: e instanceof Error && e.message ? e.message : `${c.label} could not be synced.` }),
      onSettled: () => setSyncing(null),
    });
  };

  const open = (e: Entry) => setInspect({
    entry: e,
    resolved: { key: e.stat?.key ?? (e.vendor ? sourceKeys(e.vendor)[0] : e.collector!.key), label: e.name, people: e.stat?.people ?? 0, entitlements: e.stat?.entitlements ?? 0, lastSynced: e.stat?.last_synced },
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Sources" icon={Plug} breadcrumbs={crumbs}
        subtitle="Connect the systems that hold your people and their access. Everything you connect feeds one population, and a source with rules of its own is tested directly." />

      <section aria-label="Summary">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="Sources connected" value={`${connectedCount} of ${totalCount}`} hint="in the catalogue below" />
          <Stat label="Identities in the population" value={status.data?.user_count ?? 0} hint="across every source" />
          <Stat label="Sources tested directly" value={withRules.filter((c) => c.connected).length} hint={withRules.length ? `${withRules.map((c) => c.label).join(', ')}: ${withRules.reduce((n, c) => n + c.rules, 0)} rules` : 'none have rules yet'} />
        </dl>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <label htmlFor="source-search" className="sr-only">Search sources</label>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden />
          <input id="source-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sources" className={clsx(inputClass, 'pl-9')} />
        </div>
        <div role="group" aria-label="Show sources" className="flex flex-wrap gap-1.5">
          {([['all', 'All'], ['connected', 'Connected'], ['available', 'Not connected']] as const).map(([k, label]) => (
            <FilterChip key={k} pressed={filter === k} onClick={() => setFilter(k)}>{label}</FilterChip>
          ))}
        </div>
        <p role="status" className="text-sm text-slate-600">{shown} source{shown === 1 ? '' : 's'} shown.</p>
      </div>

      {note && <Alert tone={note.ok ? 'success' : 'error'}>{note.text}</Alert>}

      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-700">No source matches. Clear the search or the filter.</div>
      )}

      {groups.map((g) => {
        // the evidence collectors are a long, optional list: show a few until asked (or until you search or filter)
        const long = g.id === 'tools' && g.entries.length > 6 && !q && filter === 'all';
        const list = long && !allTools ? g.entries.slice(0, 6) : g.entries;
        return (
        <section key={g.id} aria-labelledby={`group-${g.id}`}>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
            <h2 id={`group-${g.id}`} className="text-base font-semibold text-slate-900">{g.title}</h2>
            <span className="text-sm text-slate-600">{g.connected} of {g.total} connected</span>
          </div>
          <p className="mb-3 text-sm text-slate-700">{g.sub}</p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((e) => (
              <li key={e.id} className={clsx('flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm', e.connected ? 'border-teal-700' : 'border-slate-200')}>
                <div className="flex items-start gap-3">
                  <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: e.color }}>{e.initials}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-slate-900">{e.name}</h3>
                    <p className="text-xs text-slate-600">{e.sub}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {e.connected ? <Badge tone="emerald" icon={CheckCircle2}>Connected</Badge> : <Badge>Not connected</Badge>}
                  {e.people > 0 && <Badge>{plural(e.people, 'identity', 'identities')}</Badge>}
                  {e.rules > 0 && <Badge tone="sky" icon={ListChecks}>{plural(e.rules, 'rule')}</Badge>}
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  {e.vendor ? (e.connected
                    ? <Button size="sm" onClick={() => open(e)} aria-label={`Details for ${e.name}`}>Details</Button>
                    : <Button size="sm" variant="primary" onClick={() => setActive(e.vendor!)} aria-label={`${e.vendor.kind === 'upload' ? 'Upload a file for' : 'Connect'} ${e.name}`}>{e.vendor.kind === 'upload' ? 'Upload' : 'Connect'}</Button>
                  ) : e.collector && (e.connected
                    ? (e.people > 0
                      ? <Button size="sm" onClick={() => open(e)} aria-label={`Details for ${e.name}`}>Details</Button>
                      : <Button size="sm" variant="primary" loading={syncing === e.collector.key} disabled={!!syncing} onClick={() => pullPeople(e.collector!)} aria-label={`Pull people from ${e.name}`}>Pull people</Button>)
                    : <ButtonLink size="sm" href={`/admin?tab=evidence-collectors&connector=${encodeURIComponent(e.collector.key)}`}>Connect<span className="sr-only"> {e.name} under Evidence Collectors</span></ButtonLink>)}
                  {e.rules > 0 && <Button size="sm" icon={ListChecks} onClick={() => setRulesOf(e)} aria-label={`View the ${plural(e.rules, 'rule')} for ${e.name}`}>View rules</Button>}
                </div>
              </li>
            ))}
          </ul>
          {long && (
            <Button className="mt-3" aria-expanded={allTools} onClick={() => setAllTools((v) => !v)}>
              {allTools ? 'Show fewer tools' : `Show all ${g.entries.length} tools`}
            </Button>
          )}
        </section>
        );
      })}

      {inspect && (
        <SourceDrawer source={inspect.resolved} ruleCount={ruleOf(inspect.resolved.key)?.rules ?? 0} limits={ruleOf(inspect.resolved.key)?.limits}
          onClose={() => setInspect(null)}
          onResync={() => {
            const { entry } = inspect;
            setInspect(null);
            if (entry.vendor) setActive(entry.vendor); else if (entry.collector) pullPeople(entry.collector);
          }} />
      )}
      {rulesOf && (
        <SourceRulesDialog source={rulesOf.id} label={rulesOf.name} connected={rulesOf.connected} limits={ruleOf(rulesOf.id)?.limits}
          onClose={() => setRulesOf(null)}
          onConnect={rulesOf.vendor && !rulesOf.connected ? () => { const v = rulesOf.vendor!; setRulesOf(null); setActive(v); } : undefined} />
      )}
      {active && <ConnectDialog vendor={active} fields={active.fields ?? fieldsQ.data?.[active.key] ?? []} onClose={() => setActive(null)} />}
    </div>
  );
}
