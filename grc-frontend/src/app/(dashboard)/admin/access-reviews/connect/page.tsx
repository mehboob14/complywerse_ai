'use client';
// src/app/(dashboard)/admin/access-reviews/connect/page.tsx
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
    tier: 3, title: 'Business apps', sub: 'App-level permissions where the real risk sits',
    vendors: [
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

export default function ConnectSourcePage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [fieldsByKey, setFieldsByKey] = useState<Record<string, Field[]>>({});
  const [active, setActive] = useState<Vendor | null>(null);

  const load = useCallback(async () => {
    const [s, iga, apps] = await Promise.all([
      authedFetch(`${API}/connectors`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      authedFetch(`${API}/connectors/iga/vendors`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      authedFetch(`${API}/connectors/apps/catalog`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (s) setStatus(s);
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

  if (!status) return <PageLoader />;

  return (
    <div className="mx-auto max-w-[1180px] px-8 py-7 pb-16">
      <button onClick={() => router.push('/admin/access-reviews')} className="mb-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-500"><ChevronLeft size={14} /> Access Reviews</button>
      <h1 className="text-[23px] font-bold tracking-tight text-slate-900">Connect a source</h1>
      <p className="mb-6 mt-1 text-[13.5px] text-slate-500">Connect only the systems you have — they all feed one user table. Pick from any tier in any order.</p>

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
                      <span className="inline-flex items-center gap-1 rounded-md bg-[color:var(--color-base-soft)] px-2.5 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--color-base-strong)' }}><Check size={13} /> Connected</span>
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

function ConnectDrawer({ vendor, fields, onClose, onDone }: {
  vendor: Vendor; fields: Field[]; onClose: () => void; onDone: () => void;
}) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [baseUrl, setBaseUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const needsBaseUrl = (vendor.kind === 'iga') || (vendor.kind === 'app' && vendor.key !== 'database');

  const run = async (sample: boolean) => {
    setBusy(true); setMsg(null);
    try {
      let res: Response;
      if (vendor.kind === 'form') {
        res = await authedFetch(`${API}/connectors/${vendor.endpoint}/sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vals),
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
      setMsg({ ok: true, text: `Connected. Pulled ${(d.created ?? 0) + (d.updated ?? 0)} users${d.entitlements_linked != null ? `, ${d.entitlements_linked} entitlements` : ''}.` });
      setTimeout(onDone, 900);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Sync failed' }); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-40 flex justify-end bg-slate-900/45 backdrop-blur-[1px]">
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-[460px] max-w-[94%] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white" style={{ background: vendor.color }}>{vendor.initials}</div>
          <div className="min-w-0 flex-1"><div className="text-base font-bold text-slate-900">{vendor.name}</div><div className="text-xs text-slate-400">{vendor.sub} · Tier connector</div></div>
          <button onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <p className="mb-4 text-[12.5px] text-slate-500">Credentials are used for this sync only and are not stored. Users &amp; access land in one shared table.</p>
          {msg && <div className={`mb-4 rounded-md px-3 py-2 text-[13px] ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}

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
