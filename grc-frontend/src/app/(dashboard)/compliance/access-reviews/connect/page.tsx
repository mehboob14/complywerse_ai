'use client';
// src/app/(dashboard)/compliance/access-reviews/connect/page.tsx
// Connect a source — the tier menu (Directories / IGA / Business apps). Sources
// are a MENU, not a sequence: connect only what you have, in any order; they all
// feed one user table. Wired to GET /connectors + the per-vendor …/sync POSTs.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Check, X, Upload } from 'lucide-react';
import { PageLoader } from '@/components/ui';
import { authedFetch } from '@/lib/auth-fetch';

const API = '/api/access-reviews';
const ACCENT = { background: 'var(--color-base)', color: 'var(--color-on-base)' } as const;

type Field = { name: string; label: string; secret?: boolean; ph?: string };
type Vendor = {
  key: string; name: string; sub: string; initials: string; color: string;
  kind: 'sso' | 'form' | 'iga' | 'app' | 'upload';
  endpoint?: string;          // for tier-1 form connectors
  /** its credential can be kept (encrypted) so later reviews refresh on their own */
  remembers?: boolean;
  fields?: Field[];           // tier-1 fields (iga/app fields come from catalog)
};
type Tier = { tier: 1 | 2 | 3; title: string; sub: string; vendors: Vendor[] };

const TIERS: Tier[] = [
  {
    tier: 1, title: 'Directories & login', sub: 'Identity and basic roles',
    vendors: [
      { key: 'entra', name: 'Microsoft Entra ID', sub: 'SSO + user provisioning', initials: 'MS', color: '#2563EB', kind: 'sso' },
      { key: 'okta', name: 'Okta', sub: 'SCIM / API token', initials: 'O', color: '#0F172A', kind: 'form', endpoint: 'okta',
        fields: [{ name: 'domain', label: 'Okta domain', ph: 'acme.okta.com' }, { name: 'token', label: 'API token', secret: true }] },
      { key: 'google', name: 'Google Workspace', sub: 'OAuth directory', initials: 'G', color: '#EA4335', kind: 'form', endpoint: 'google',
        fields: [{ name: 'access_token', label: 'Access token', secret: true }, { name: 'customer', label: 'Customer ID', ph: 'my_customer' }] },
      { key: 'ldap', name: 'Active Directory / LDAP', sub: 'On-prem directory', initials: 'AD', color: '#2563EB', kind: 'form', endpoint: 'ldap',
        fields: [{ name: 'server', label: 'Server', ph: 'dc01.acme.local' }, { name: 'base_dn', label: 'Base DN', ph: 'DC=acme,DC=local' }, { name: 'bind_dn', label: 'Bind DN' }, { name: 'bind_password', label: 'Bind password', secret: true }] },
      { key: 'excel', name: 'Excel / CSV', sub: 'One-time upload', initials: '↓', color: '#16A34A', kind: 'upload' },
    ],
  },
  {
    tier: 2, title: 'IAM / IGA governance', sub: 'Full entitlements + approvals — the richest source',
    vendors: [
      { key: 'sailpoint', name: 'SailPoint', sub: 'IdentityIQ / ISC', initials: 'SP', color: '#0F172A', kind: 'iga' },
      { key: 'saviynt', name: 'Saviynt', sub: 'EIC', initials: 'SV', color: '#EA580C', kind: 'iga' },
      { key: 'oracle_ig', name: 'Oracle Identity', sub: 'OIG', initials: 'OI', color: '#DC2626', kind: 'iga' },
      { key: 'ibm_verify', name: 'IBM Verify', sub: 'Security Verify', initials: 'IB', color: '#2563EB', kind: 'iga' },
      { key: 'one_identity', name: 'One Identity', sub: 'Manager', initials: '1I', color: '#1D4ED8', kind: 'iga' },
      { key: 'ping', name: 'Ping Identity', sub: 'PingOne', initials: 'PI', color: '#B91C1C', kind: 'iga' },
      { key: 'jumpcloud', name: 'JumpCloud', sub: 'Directory platform', initials: 'JC', color: '#16A34A', kind: 'iga' },
      { key: 'cyberark', name: 'CyberArk', sub: 'Identity Security', initials: 'CA', color: '#1E40AF', kind: 'iga' },
      { key: 'beyondtrust', name: 'BeyondTrust', sub: 'PRA', initials: 'BT', color: '#EA580C', kind: 'iga' },
    ],
  },
  {
    tier: 3, title: 'Business apps & cloud', sub: 'App-level permissions where the real risk sits',
    vendors: [
      // DigitalOcean publishes no team-member endpoint, so this pulls what it
      // does expose: the keys, tokens and database users that reach the estate.
      { key: 'digitalocean', name: 'DigitalOcean', sub: 'SSH keys, Spaces keys, database users', initials: 'DO', color: '#0080FF',
        kind: 'form', endpoint: 'digitalocean', remembers: true,
        fields: [{ name: 'token', label: 'Read-only API token', secret: true, ph: 'leave blank to use the connected token' }] },
      { key: 'core_banking', name: 'Core Banking', sub: 'REST API', initials: 'CB', color: '#0F172A', kind: 'app' },
      { key: 'sap', name: 'SAP', sub: 'Roles & profiles', initials: 'SAP', color: '#0EA5E9', kind: 'app' },
      { key: 'salesforce', name: 'Salesforce', sub: 'Permission sets', initials: 'SF', color: '#2563EB', kind: 'app' },
      { key: 'oracle_ebs', name: 'Oracle EBS', sub: 'Responsibilities', initials: 'OE', color: '#DC2626', kind: 'app' },
      { key: 'servicenow', name: 'ServiceNow', sub: 'Roles', initials: 'SN', color: '#16A34A', kind: 'app' },
      { key: 'database', name: 'Databases', sub: 'Granted privileges', initials: 'DB', color: '#334155', kind: 'app' },
    ],
  },
];

interface Status { [k: string]: { connected?: boolean; vendor?: string; app?: string } | number }

/** A tool already connected as an evidence collector, whose people a review
 *  can pull with that same stored credential. */
type Collector = { key: string; label: string; category: string; connected: boolean; reads: string };

/** What a source has actually put in the population. */
type SourceStat = { key: string; label: string; people: number; entitlements: number; last_synced?: string | null };
type Person = {
  id: number; email: string; display_name: string; designation?: string | null;
  account_enabled?: boolean | null; access: string[]; other_access: string[];
};

/** What the source's credentials reach, as of its last sync. */
type Estate = {
  droplets?: { name: string; region?: string; status?: string; size?: string; ip?: string | null }[];
  volumes?: { name: string; size_gb?: number; region?: string; attached_to?: number[] }[];
  databases?: { name: string; engine?: string; version?: string; region?: string; nodes?: number }[];
  kubernetes?: { name: string; region?: string; version?: string }[];
  /** what the last sync read, and anything the credential could not see */
  read?: Record<string, number>;
  skipped?: { resource: string; reason: string }[];
};

export default function ConnectSourcePage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [fieldsByKey, setFieldsByKey] = useState<Record<string, Field[]>>({});
  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [sources, setSources] = useState<SourceStat[]>([]);
  const [inspect, setInspect] = useState<SourceStat | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [active, setActive] = useState<Vendor | null>(null);

  const load = useCallback(async () => {
    const [s, iga, apps, coll] = await Promise.all([
      authedFetch(`${API}/connectors`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      authedFetch(`${API}/connectors/iga/vendors`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      authedFetch(`${API}/connectors/apps/catalog`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      authedFetch(`${API}/connectors/collectors`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (s) setStatus(s);
    setSources(s?.sources ?? []);
    setCollectors(coll?.collectors ?? []);
    const fm: Record<string, Field[]> = {};
    (iga?.vendors || []).forEach((v: { key: string; fields: Field[] }) => (fm[v.key] = v.fields));
    (apps?.apps || []).forEach((a: { key: string; fields: Field[] }) => (fm[a.key] = a.fields));
    setFieldsByKey(fm);
  }, []);
  useEffect(() => { load(); }, [load]);

  const isConnected = useCallback((v: Vendor): boolean => {
    if (!status) return false;
    if (v.kind === 'iga') { const g = status.iga as { connected?: boolean; vendor?: string }; return !!g?.connected && g.vendor === v.key; }
    if (v.kind === 'app') { const a = status.apps as { connected?: boolean; app?: string }; return !!a?.connected && a.app === v.key; }
    const row = status[v.key] as { connected?: boolean } | undefined;
    return !!row?.connected;
  }, [status]);

  const syncCollector = async (c: Collector) => {
    setSyncing(c.key); setNote(null);
    try {
      const res = await authedFetch(`${API}/connectors/collector/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: c.key }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.detail || 'Sync failed');
      setNote({ ok: true, text: `${c.label}: pulled ${(d.created ?? 0) + (d.updated ?? 0)} people`
        + `${d.entitlements_linked ? `, ${d.entitlements_linked} entitlements` : ''}`
        + `${d.partial ? ` (${d.partial})` : ''}.` });
      await load();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'Sync failed' });
    } finally { setSyncing(null); }
  };

  const sourceStat = (key: string): SourceStat =>
    sources.find((x) => x.key === key)
    ?? { key, label: key, people: 0, entitlements: 0, last_synced: null };

  if (!status) return <PageLoader />;

  return (
    <div className="mx-auto max-w-[1180px] px-8 py-7 pb-16">
      <button onClick={() => router.push('/compliance/access-reviews')} className="mb-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-500"><ChevronLeft size={14} /> Access Reviews</button>
      <h1 className="text-[23px] font-bold tracking-tight text-slate-900">Connect a source</h1>
      <p className="mb-6 mt-1 text-[13.5px] text-slate-500">Connect only the systems you have — they all feed one user table. Pick from any tier in any order.</p>

      {collectors.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="rounded-full bg-[color:var(--color-base-soft)] px-2.5 py-0.5 text-[11px] font-bold" style={{ color: 'var(--color-base-strong)' }}>Tools</span>
            <span className="text-[14.5px] font-bold text-slate-900">Tools you already connect</span>
            <span className="text-[12.5px] text-slate-400">· pulls their people with the credential already stored</span>
            <span className="ml-auto font-mono text-[12px] text-slate-400">{collectors.filter((c) => c.connected).length}/{collectors.length} connected</span>
          </div>
          {note && <div className={`mb-3 rounded-md px-3 py-2 text-[13px] ${note.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{note.text}</div>}
          <div className="grid grid-cols-3 gap-3.5">
            {collectors.map((c) => (
              <div key={c.key} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                style={c.connected ? { borderColor: 'var(--color-base)' } : undefined}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[12px] font-bold text-slate-500">
                  {c.label.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold text-slate-900">{c.label}</div>
                  <div className="truncate text-[11.5px] text-slate-400">{c.connected ? 'credential on file' : 'connect it under Evidence Collectors'}</div>
                </div>
                {c.connected && (sourceStat(c.key).people || 0) > 0 ? (
                  <button onClick={() => setInspect(sourceStat(c.key))}
                    className="rounded-md bg-[color:var(--color-base-soft)] px-3 py-1.5 text-[12px] font-semibold hover:brightness-95"
                    style={{ color: 'var(--color-base-strong)' }}>
                    {sourceStat(c.key).people} people
                  </button>
                ) : c.connected ? (
                  <button disabled={syncing === c.key} onClick={() => syncCollector(c)}
                    className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60">
                    {syncing === c.key ? 'Syncing…' : 'Pull people'}
                  </button>
                ) : (
                  <button onClick={() => router.push(`/admin?tab=evidence-collectors&connector=${c.key}`)}
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-500">Connect</button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {TIERS.map((t) => {
        const connectedN = t.vendors.filter(isConnected).length;
        return (
          <section key={t.tier} className="mb-8">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="rounded-full bg-[color:var(--color-base-soft)] px-2.5 py-0.5 text-[11px] font-bold" style={{ color: 'var(--color-base-strong)' }}>Tier {t.tier}</span>
              <span className="text-[14.5px] font-bold text-slate-900">{t.title}</span>
              <span className="text-[12.5px] text-slate-400">· {t.sub}</span>
              <span className="ml-auto font-mono text-[12px] text-slate-400">{connectedN}/{t.vendors.length} connected</span>
            </div>
            <div className="grid grid-cols-3 gap-3.5">
              {t.vendors.map((v) => {
                const on = isConnected(v);
                return (
                  <div key={v.key} className={`flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm ${on ? '' : 'border-slate-200'}`}
                    style={on ? { borderColor: 'var(--color-base)', boxShadow: '0 0 0 1px var(--color-base)' } : undefined}>
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white" style={{ background: v.color }}>{v.initials}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-bold text-slate-900">{v.name}</div>
                      <div className="truncate text-[11.5px] text-slate-400">{v.sub}</div>
                    </div>
                    {on ? (
                      <button onClick={() => setInspect(sourceStat(v.key))}
                        className="inline-flex items-center gap-1 rounded-md bg-[color:var(--color-base-soft)] px-2.5 py-1.5 text-[12px] font-semibold hover:brightness-95"
                        style={{ color: 'var(--color-base-strong)' }}>
                        <Check size={13} /> {(sourceStat(v.key).people || 0) > 0 ? `${sourceStat(v.key).people} people` : 'Connected'}
                      </button>
                    ) : (
                      <button onClick={() => setActive(v)} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-100">Connect</button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {inspect && (
        <SourceDrawer
          source={inspect}
          onClose={() => setInspect(null)}
          onResync={() => {
            const vendor = TIERS.flatMap((t) => t.vendors).find((v) => v.key === inspect.key);
            setInspect(null);
            if (vendor) setActive(vendor);
            else syncCollector({ key: inspect.key, label: inspect.label, category: '', connected: true, reads: '' });
          }}
        />
      )}

      {active && (
        <ConnectDrawer
          vendor={active}
          fields={active.fields || fieldsByKey[active.key] || []}
          onClose={() => setActive(null)}
          onDone={async () => { setActive(null); await load(); }}
        />
      )}
    </div>
  );
}

/** What a connected source put in the population: who it pulled, what each of
 *  them holds, and the way on to a review of it. A card that only says
 *  "Connected" tells nobody whether it worked. */
function SourceDrawer({ source, onClose, onResync }: {
  source: SourceStat; onClose: () => void; onResync: () => void;
}) {
  const router = useRouter();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [estate, setEstate] = useState<Estate>({});
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    authedFetch(`${API}/connectors/${encodeURIComponent(source.key)}/people`)
      .then((r) => (r.ok ? r.json() : { people: [] }))
      .then((d) => { if (live) { setPeople(d.people ?? []); setEstate(d.estate ?? {}); } })
      .catch(() => { if (live) setPeople([]); });
    return () => { live = false; };
  }, [source.key]);

  const startReview = async () => {
    setStarting(true); setErr(null);
    try {
      const res = await authedFetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${source.label} access review — ${new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`,
          review_type: 'user_access', sampling_method: 'full',
          requested_sample_size: Math.max(source.people, 1), source: source.key,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.detail || 'Could not start the review');
      router.push(`/compliance/access-reviews/${d.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the review');
      setStarting(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-40 flex justify-end bg-slate-900/45">
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-[560px] max-w-[96%] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold text-slate-900">{source.label}</div>
            <div className="text-xs text-slate-400">
              {source.people} {source.people === 1 ? 'identity' : 'identities'} · {source.entitlements} access grants
              {source.last_synced ? ` · synced ${new Date(source.last_synced).toLocaleString()}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500"><X size={15} /></button>
        </div>

        <div className="flex gap-2 border-b border-slate-100 px-5 py-3">
          <button onClick={startReview} disabled={starting || source.people === 0} style={ACCENT}
            className="rounded-md px-4 py-2 text-[13px] font-semibold shadow-sm disabled:opacity-60">
            {starting ? 'Starting…' : 'Start a review of this source'}
          </button>
          <button onClick={onResync} className="rounded-md border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-600">Re-sync</button>
        </div>
        {err && <div className="mx-5 mt-3 rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{err}</div>}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {(estate.read || estate.skipped?.length) ? (
            <div className="mb-4 rounded-lg border border-slate-100 px-3 py-2">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Last sync read</div>
              <div className="mt-0.5 text-[12px] text-slate-600">
                {Object.entries(estate.read ?? {}).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ') || '—'}
              </div>
              {(estate.skipped ?? []).length > 0 && (
                <div className="mt-1 text-[11.5px] text-amber-700">
                  Not readable with this token: {(estate.skipped ?? []).map((x) => `${x.resource} (${x.reason})`).join('; ')}
                </div>
              )}
            </div>
          ) : null}

          {(estate.droplets?.length || estate.volumes?.length || estate.databases?.length || estate.kubernetes?.length) ? (
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">What this access reaches</div>
              <div className="flex flex-col gap-2.5">
                {(estate.droplets ?? []).length > 0 && (
                  <div>
                    <div className="text-[11.5px] font-semibold text-slate-600">Virtual machines ({estate.droplets!.length})</div>
                    <ul className="mt-0.5 flex flex-col gap-0.5">
                      {estate.droplets!.map((d) => (
                        <li key={d.name} className="text-[12px] text-slate-700">
                          • {d.name} <span className="text-slate-400">{[d.size, d.region, d.status].filter(Boolean).join(' · ')}{d.ip ? ` · ${d.ip}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(estate.volumes ?? []).length > 0 && (
                  <div>
                    <div className="text-[11.5px] font-semibold text-slate-600">Storage volumes ({estate.volumes!.length})</div>
                    <ul className="mt-0.5 flex flex-col gap-0.5">
                      {estate.volumes!.map((v) => (
                        <li key={v.name} className="text-[12px] text-slate-700">
                          • {v.name} <span className="text-slate-400">{[v.size_gb ? `${v.size_gb} GB` : null, v.region,
                            v.attached_to?.length ? `attached to ${v.attached_to.length} VM${v.attached_to.length === 1 ? '' : 's'}` : 'unattached'].filter(Boolean).join(' · ')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(estate.databases ?? []).length > 0 && (
                  <div>
                    <div className="text-[11.5px] font-semibold text-slate-600">Databases ({estate.databases!.length})</div>
                    <ul className="mt-0.5 flex flex-col gap-0.5">
                      {estate.databases!.map((d) => (
                        <li key={d.name} className="text-[12px] text-slate-700">
                          • {d.name} <span className="text-slate-400">{[d.engine, d.version, d.region, d.nodes ? `${d.nodes} nodes` : null].filter(Boolean).join(' · ')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(estate.kubernetes ?? []).length > 0 && (
                  <div>
                    <div className="text-[11.5px] font-semibold text-slate-600">Kubernetes ({estate.kubernetes!.length})</div>
                    <ul className="mt-0.5 flex flex-col gap-0.5">
                      {estate.kubernetes!.map((k) => (
                        <li key={k.name} className="text-[12px] text-slate-700">• {k.name} <span className="text-slate-400">{[k.region, k.version].filter(Boolean).join(' · ')}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                An SSH key opens the machines it was added to; DigitalOcean does not report which, so the review lists the machines it could reach.
                Local accounts on each machine need the Compliance Agent.
              </p>
            </div>
          ) : null}

          {people === null ? (
            <div className="text-[13px] text-slate-400">Loading…</div>
          ) : people.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-[13px] text-slate-500">
              Nothing pulled yet. Re-sync to fetch this source&apos;s people and their access.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {people.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-slate-900">{p.display_name}</span>
                    {p.account_enabled === false && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">disabled in source</span>}
                    <span className="ml-auto shrink-0 truncate font-mono text-[11px] text-slate-400">{p.email}</span>
                  </div>
                  {p.designation && <div className="mt-0.5 text-[11.5px] text-slate-400">{p.designation}</div>}
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {p.access.map((a) => <li key={a} className="text-[12px] text-slate-700">• {a}</li>)}
                  </ul>
                  {p.other_access.length > 0 && (
                    <div className="mt-1 text-[11px] text-slate-400">also holds: {p.other_access.join(' · ')}</div>
                  )}
                </div>
              ))}
              {people.length < source.people && (
                <div className="py-2 text-center text-[11.5px] text-slate-400">showing {people.length} of {source.people}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectDrawer({ vendor, fields, onClose, onDone }: {
  vendor: Vendor; fields: Field[]; onClose: () => void; onDone: () => void;
}) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [baseUrl, setBaseUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const needsBaseUrl = (vendor.kind === 'iga') || (vendor.kind === 'app' && vendor.key !== 'database');

  const run = async (sample: boolean) => {
    setBusy(true); setMsg(null);
    try {
      let res: Response;
      if (vendor.kind === 'form') {
        res = await authedFetch(`${API}/connectors/${vendor.endpoint}/sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vendor.remembers ? { ...vals, remember } : vals),
        });
      } else if (vendor.kind === 'iga') {
        res = await authedFetch(`${API}/connectors/iga/sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendor: vendor.key, base_url: baseUrl, credentials: vals, sample }),
        });
      } else if (vendor.kind === 'app') {
        res = await authedFetch(`${API}/connectors/apps/sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app: vendor.key, base_url: baseUrl, credentials: vals, sample }),
        });
      } else if (vendor.kind === 'upload') {
        if (!file) { setMsg({ ok: false, text: 'Choose a .csv or .xlsx file first.' }); setBusy(false); return; }
        const fd = new FormData(); fd.append('file', file);
        res = await authedFetch(`${API}/connectors/spreadsheet/import`, { method: 'POST', body: fd });
      } else { setBusy(false); return; }
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.detail || 'Sync failed');
      // A source can be partly readable — a token scoped to some resources and
      // not others. Say what was left out rather than reporting a clean pull.
      const left = (d.skipped ?? []).map((s: { resource: string }) => s.resource).join(', ');
      setMsg({
        ok: true,
        text: `Connected. Pulled ${(d.created ?? 0) + (d.updated ?? 0)} accounts`
          + `${d.entitlements_linked != null ? `, ${d.entitlements_linked} entitlements` : ''}.`
          + (left ? ` Not readable with this token: ${left}.` : ''),
      });
      setTimeout(onDone, 900);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Sync failed' }); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-40 flex justify-end bg-slate-900/45">
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-[460px] max-w-[94%] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white" style={{ background: vendor.color }}>{vendor.initials}</div>
          <div className="min-w-0 flex-1"><div className="text-base font-bold text-slate-900">{vendor.name}</div><div className="text-xs text-slate-400">{vendor.sub} · Tier connector</div></div>
          <button onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <p className="mb-4 text-[12.5px] text-slate-500">
            {vendor.remembers
              ? 'Leave the token blank to reuse the one already connected. Users & access land in one shared table.'
              : 'Credentials are used for this sync only and are not stored. Users & access land in one shared table.'}
          </p>
          {msg && <div className={`mb-4 rounded-md px-3 py-2 text-[13px] ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{msg.text}</div>}

          {vendor.kind === 'sso' ? (
            <button onClick={() => router.push('/admin?tab=identity')} style={ACCENT} className="w-full rounded-md px-4 py-2.5 text-[13px] font-semibold shadow-sm">Connect with Microsoft →</button>
          ) : vendor.kind === 'upload' ? (
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-[13px] font-semibold text-slate-600">
              <Upload size={16} /> {file ? file.name : 'Choose .csv / .xlsx file'}
              <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          ) : (
            <div className="flex flex-col gap-3.5">
              {needsBaseUrl && (
                <div><label className="mb-1.5 block text-xs font-semibold text-slate-600">API base URL</label>
                  <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] outline-none" /></div>
              )}
              {fields.map((f) => (
                <div key={f.name}><label className="mb-1.5 block text-xs font-semibold text-slate-600">{f.label}</label>
                  <input type={f.secret ? 'password' : 'text'} placeholder={f.ph} value={vals[f.name] ?? ''}
                    onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))}
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] outline-none" /></div>
              ))}
              {vendor.remembers && (
                <label className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-600">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5" />
                  <span>Keep this token, encrypted, so later reviews can refresh without it being entered again. It is the same credential the evidence collector uses.</span>
                </label>
              )}
            </div>
          )}
        </div>

        {vendor.kind !== 'sso' && (
          <div className="flex gap-2.5 border-t border-slate-100 px-5 py-4">
            <button onClick={() => run(false)} disabled={busy} style={ACCENT} className="flex-1 rounded-md px-4 py-2.5 text-[13px] font-semibold shadow-sm disabled:opacity-60">{busy ? 'Connecting…' : 'Connect & sync'}</button>
            {(vendor.kind === 'iga' || vendor.kind === 'app') && (
              <button onClick={() => run(true)} disabled={busy} className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">Load sample data</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
