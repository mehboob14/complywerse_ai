'use client';

/**
 * IT Asset Discovery — the real, wired screen.
 *
 * Replaces the former static design mock. Every number, row and action here is
 * backed by the /discovery API: campaigns + scopes, scheduled/manual runs, the
 * resolution inbox, and the encrypted credential store that powers authenticated
 * deep-collection (OS / software / antivirus on discovered hosts).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Radar, Inbox, Network, History, KeyRound, Play, Plus, Trash2, X,
  ShieldCheck, RefreshCw, Check,
} from 'lucide-react';
import { discoveryApi } from '@/lib/api';
import '../assets/_suite/asset-suite.css';

type Tab = 'overview' | 'campaigns' | 'inbox' | 'runs' | 'credentials';

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'overview',    label: 'Overview',     icon: Radar },
  { id: 'campaigns',   label: 'Campaigns',    icon: Network },
  { id: 'inbox',       label: 'Inbox',        icon: Inbox },
  { id: 'runs',        label: 'Scan history', icon: History },
  { id: 'credentials', label: 'Credentials',  icon: KeyRound },
];

/* ─── shared bits ──────────────────────────────────────────────────── */

function fmt(ts?: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function everySeconds(s?: number | null): string {
  if (!s) return 'Manual only';
  if (s % 86400 === 0) return `Every ${s / 86400}d`;
  if (s % 3600 === 0) return `Every ${s / 3600}h`;
  if (s % 60 === 0) return `Every ${s / 60}m`;
  return `Every ${s}s`;
}

const STATUS_TONE: Record<string, { c: string; bg: string }> = {
  succeeded: { c: 'var(--as-good)', bg: 'var(--as-good-bg)' },
  running:   { c: 'var(--as-blue)', bg: 'var(--as-blue-bg)' },
  queued:    { c: 'var(--as-slate)', bg: 'var(--as-slate-bg)' },
  failed:    { c: 'var(--as-danger-text)', bg: 'var(--as-danger-bg)' },
  cancelled: { c: 'var(--as-muted)', bg: 'var(--as-track)' },
};

function StatusPill({ status }: { status: string }) {
  const t = STATUS_TONE[status] || STATUS_TONE.queued;
  return <span className="as-pill" style={{ background: t.bg, color: t.c, textTransform: 'capitalize' }}>{status}</span>;
}

function SectionHead({ title, note, right }: { title: string; note?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--as-ink)' }}>{title}</div>
        {note && <div style={{ fontSize: 12.5, color: 'var(--as-faint)', marginTop: 2, maxWidth: 620 }}>{note}</div>}
      </div>
      {right}
    </div>
  );
}

function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div style={{ padding: '30px 18px', textAlign: 'center', border: '1px dashed var(--as-border)', borderRadius: 12, background: 'var(--as-subtle)' }}>
      <div style={{ fontSize: 13.5, color: 'var(--as-muted)', fontWeight: 500 }}>{text}</div>
      {hint && <div style={{ fontSize: 12, color: 'var(--as-faint)', marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left', padding: '9px 12px', fontSize: 10.5, letterSpacing: '.5px',
  textTransform: 'uppercase', color: 'var(--as-muted)', fontWeight: 600,
  background: 'var(--as-subtle)', borderBottom: '1px solid var(--as-border)', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid var(--as-row)', color: 'var(--as-secondary)', verticalAlign: 'top' };

/* ─── Overview ─────────────────────────────────────────────────────── */

function Overview({ go }: { go: (t: Tab) => void }) {
  const campaigns = useQuery({ queryKey: ['disc-campaigns'], queryFn: async () => (await discoveryApi.listCampaigns()).data.campaigns as any[] });
  const runs = useQuery({ queryKey: ['disc-runs'], queryFn: async () => (await discoveryApi.listRuns(undefined, 8)).data.runs as any[] });
  const inbox = useQuery({ queryKey: ['disc-inbox'], queryFn: async () => (await discoveryApi.inbox('open')).data.observations as any[] });

  const camps = campaigns.data ?? [];
  const runList = runs.data ?? [];
  const inboxCount = (inbox.data ?? []).length;
  const active = camps.filter((c) => c.is_active && c.schedule_seconds).length;
  const lastRun = runList[0];

  const KPIS = [
    { label: 'Campaigns', value: camps.length, note: `${active} scheduled`, tone: 'var(--as-ink)' },
    { label: 'Needs review', value: inboxCount, note: 'in the inbox', tone: inboxCount ? 'var(--as-rust-text)' : 'var(--as-good)' },
    { label: 'Last scan', value: lastRun ? lastRun.status : '—', note: lastRun ? fmt(lastRun.finished_at || lastRun.created_at) : 'no runs yet', tone: 'var(--as-ink)' },
    { label: 'Found last scan', value: lastRun ? (lastRun.assets_new + lastRun.assets_updated) : 0, note: lastRun ? `${lastRun.assets_new} new` : '—', tone: 'var(--as-ink)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="as-card as-kpi" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {KPIS.map((k, i) => (
          <div key={k.label} style={{ padding: '15px 18px', borderRight: i < 3 ? '1px solid var(--as-divider)' : 'none' }}>
            <div className="as-mono" style={{ fontSize: 22, fontWeight: 600, color: k.tone, textTransform: 'capitalize' }}>{k.value}</div>
            <div style={{ fontSize: 12.5, color: 'var(--as-secondary)', marginTop: 3 }}>{k.label}</div>
            <div style={{ fontSize: 11.5, color: 'var(--as-faint)', marginTop: 1 }}>{k.note}</div>
          </div>
        ))}
      </div>

      <div className="as-card" style={{ padding: '18px 20px' }}>
        <SectionHead title="Recent scans" note="Every run is recorded — the audit trail a regulator asks for first."
          right={<button className="as-btn as-btn-secondary" onClick={() => go('runs')}>View all</button>} />
        {runs.isLoading ? <Empty text="Loading…" /> : runList.length === 0 ? (
          <Empty text="No scans yet." hint="Create a campaign and run it, or let a schedule fire." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['When', 'Trigger', 'Status', 'Hosts', 'New', 'Updated'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {runList.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, color: 'var(--as-ink)' }}>{fmt(r.finished_at || r.created_at)}</td>
                    <td style={td}>{r.trigger}</td>
                    <td style={td}><StatusPill status={r.status} /></td>
                    <td className="as-mono" style={td}>{r.hosts_seen}</td>
                    <td className="as-mono" style={{ ...td, color: 'var(--as-good)' }}>{r.assets_new}</td>
                    <td className="as-mono" style={td}>{r.assets_updated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Campaigns ────────────────────────────────────────────────────── */

function Campaigns() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const campaigns = useQuery({ queryKey: ['disc-campaigns'], queryFn: async () => (await discoveryApi.listCampaigns()).data.campaigns as any[] });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['disc-campaigns'] }); qc.invalidateQueries({ queryKey: ['disc-runs'] }); qc.invalidateQueries({ queryKey: ['disc-runs-all'] }); };

  const run = useMutation({ mutationFn: (id: number) => discoveryApi.runNow(id), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: number) => discoveryApi.deleteCampaign(id), onSuccess: refresh });

  const list = campaigns.data ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="as-card" style={{ padding: '18px 20px' }}>
        <SectionHead title="Campaigns" note="What to scan and how often. A campaign is a set of address ranges (with exclusions)."
          right={<button className="as-btn as-btn-primary" onClick={() => setShowNew((v) => !v)}>
            {showNew ? <><X size={13} style={{ marginRight: 5, verticalAlign: -1 }} />Close</> : <><Plus size={13} style={{ marginRight: 5, verticalAlign: -1 }} />New campaign</>}
          </button>} />

        {showNew && <NewCampaignForm onDone={() => { setShowNew(false); refresh(); }} />}

        {campaigns.isLoading ? <Empty text="Loading…" /> : list.length === 0 ? (
          <Empty text="No campaigns yet." hint="Create one to start discovering devices on the network." />
        ) : (
          <div style={{ overflowX: 'auto', marginTop: showNew ? 16 : 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['Name', 'Method', 'Schedule', 'Scopes', 'Last run', 'Next run', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td style={{ ...td, fontWeight: 600, color: 'var(--as-ink)' }}>
                      {c.name}{!c.is_active && <span className="as-pill" style={{ marginLeft: 7, background: 'var(--as-track)', color: 'var(--as-muted)' }}>paused</span>}
                    </td>
                    <td style={td}>{c.method === 'active_directory' ? 'Active Directory' : 'Network'}</td>
                    <td style={td}>{everySeconds(c.schedule_seconds)}</td>
                    <td className="as-mono" style={td}>{c.scope_count}</td>
                    <td style={td}>{fmt(c.last_run_at)}</td>
                    <td style={td}>{fmt(c.next_run_at)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button className="as-btn as-btn-secondary" style={{ padding: '4px 9px', fontSize: 11.5 }}
                        disabled={run.isPending} onClick={() => run.mutate(c.id)} title="Run this campaign now">
                        <Play size={11} style={{ marginRight: 4, verticalAlign: -1 }} />Run now
                      </button>
                      <button className="as-btn as-btn-secondary" style={{ padding: '4px 8px', fontSize: 11.5, marginLeft: 6 }}
                        disabled={del.isPending} onClick={() => { if (confirm(`Delete campaign "${c.name}"? Its scan history is removed too.`)) del.mutate(c.id); }} title="Delete campaign">
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {run.isError && <p style={{ marginTop: 10, fontSize: 12.5, color: 'var(--as-danger-text)' }}>{(run.error as any)?.response?.data?.detail || 'Could not start the run.'}</p>}
        {run.isSuccess && <p style={{ marginTop: 10, fontSize: 12.5, color: 'var(--as-good)' }}>Scan started — watch progress under Scan history.</p>}
      </div>
    </div>
  );
}

function NewCampaignForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [method, setMethod] = useState('network');
  const [schedule, setSchedule] = useState('0');
  const [cidr, setCidr] = useState('');
  const create = useMutation({
    mutationFn: () => discoveryApi.createCampaign({
      name, method, schedule_seconds: Number(schedule) > 0 ? Number(schedule) : null,
      scopes: cidr.trim() ? [{ kind: 'cidr', value: cidr.trim() }] : [],
    }),
    onSuccess: onDone,
  });
  const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: 'var(--as-secondary)', display: 'block', marginBottom: 4 };
  return (
    <div style={{ padding: '16px', border: '1px solid var(--as-border)', borderRadius: 12, background: 'var(--as-subtle)', marginBottom: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div><label style={label}>Name</label><input className="as-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Corp network" /></div>
        <div><label style={label}>Method</label>
          <select className="as-input" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="network">Network sweep</option>
            <option value="active_directory">Active Directory</option>
          </select>
        </div>
        <div><label style={label}>Schedule</label>
          <select className="as-input" value={schedule} onChange={(e) => setSchedule(e.target.value)}>
            <option value="0">Manual only</option>
            <option value="3600">Every hour</option>
            <option value="21600">Every 6 hours</option>
            <option value="86400">Every day</option>
          </select>
        </div>
        <div><label style={label}>First range (CIDR)</label><input className="as-input" value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="10.0.0.0/24" /></div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="as-btn as-btn-primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Creating…' : 'Create campaign'}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--as-faint)' }}>A scheduled campaign first runs one interval from now — never at creation.</span>
        {create.isError && <span style={{ fontSize: 12.5, color: 'var(--as-danger-text)' }}>{(create.error as any)?.response?.data?.detail || 'Could not create the campaign.'}</span>}
      </div>
    </div>
  );
}

/* ─── Inbox ────────────────────────────────────────────────────────── */

function InboxView() {
  const qc = useQueryClient();
  const inbox = useQuery({ queryKey: ['disc-inbox'], queryFn: async () => (await discoveryApi.inbox('open')).data.observations as any[] });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['disc-inbox'] }); };
  const [mergeFor, setMergeFor] = useState<number | null>(null);
  const [mergeId, setMergeId] = useState('');

  const act = useMutation({
    mutationFn: (v: { id: number; action: 'adopt' | 'merge' | 'ignore'; target?: number }) =>
      discoveryApi.resolve(v.id, v.action, v.target),
    onSuccess: () => { setMergeFor(null); setMergeId(''); refresh(); },
  });

  const rows = inbox.data ?? [];
  return (
    <div className="as-card" style={{ padding: '18px 20px' }}>
      <SectionHead title="Inbox" note="Hosts a scan couldn't resolve on its own — usually an ambiguous match. Decide once; the choice sticks across future scans."
        right={<button className="as-btn as-btn-secondary" onClick={refresh}><RefreshCw size={12} style={{ marginRight: 5, verticalAlign: -1 }} />Refresh</button>} />
      {inbox.isLoading ? <Empty text="Loading…" /> : rows.length === 0 ? (
        <Empty text="Inbox clear." hint="Confident matches resolve automatically — only ambiguous ones land here." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['Host / IP', 'Source', 'Why it needs you', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td style={{ ...td, color: 'var(--as-ink)', fontWeight: 600 }}>
                    {o.host_name || o.ip_address || '—'}
                    {o.host_name && o.ip_address && <span className="as-mono" style={{ marginLeft: 7, fontSize: 11.5, color: 'var(--as-faint)' }}>{o.ip_address}</span>}
                  </td>
                  <td style={td}>{o.source}</td>
                  <td style={{ ...td, color: 'var(--as-muted)' }}>{o.resolution_note || 'Ambiguous match'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {mergeFor === o.id ? (
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input className="as-input" style={{ width: 96, padding: '4px 8px', fontSize: 12 }} value={mergeId}
                          onChange={(e) => setMergeId(e.target.value)} placeholder="Asset #" />
                        <button className="as-btn as-btn-primary" style={{ padding: '4px 9px', fontSize: 11.5 }}
                          disabled={!mergeId || act.isPending} onClick={() => act.mutate({ id: o.id, action: 'merge', target: Number(mergeId) })}>
                          <Check size={11} />
                        </button>
                        <button className="as-btn as-btn-secondary" style={{ padding: '4px 8px', fontSize: 11.5 }} onClick={() => { setMergeFor(null); setMergeId(''); }}><X size={11} /></button>
                      </span>
                    ) : (
                      <>
                        <button className="as-btn as-btn-primary" style={{ padding: '4px 9px', fontSize: 11.5 }}
                          disabled={act.isPending} onClick={() => act.mutate({ id: o.id, action: 'adopt' })} title="Create a new asset from this host">Adopt</button>
                        <button className="as-btn as-btn-secondary" style={{ padding: '4px 9px', fontSize: 11.5, marginLeft: 6 }}
                          onClick={() => setMergeFor(o.id)} title="Merge into an existing asset">Merge</button>
                        <button className="as-btn as-btn-secondary" style={{ padding: '4px 9px', fontSize: 11.5, marginLeft: 6 }}
                          disabled={act.isPending} onClick={() => act.mutate({ id: o.id, action: 'ignore' })} title="Dismiss — stays dismissed on future scans">Ignore</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Scan history ─────────────────────────────────────────────────── */

function Runs() {
  const runs = useQuery({ queryKey: ['disc-runs-all'], queryFn: async () => (await discoveryApi.listRuns(undefined, 100)).data.runs as any[] });
  const rows = runs.data ?? [];
  return (
    <div className="as-card" style={{ padding: '18px 20px' }}>
      <SectionHead title="Scan history" note="Every run is kept — who, when, over what, and what came back." />
      {runs.isLoading ? <Empty text="Loading…" /> : rows.length === 0 ? (
        <Empty text="No scans yet." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['When', 'Trigger', 'Status', 'Hosts seen', 'New', 'Updated', 'Note'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...td, color: 'var(--as-ink)' }}>{fmt(r.finished_at || r.created_at)}</td>
                  <td style={td}>{r.trigger}</td>
                  <td style={td}><StatusPill status={r.status} /></td>
                  <td className="as-mono" style={td}>{r.hosts_seen}</td>
                  <td className="as-mono" style={{ ...td, color: 'var(--as-good)' }}>{r.assets_new}</td>
                  <td className="as-mono" style={td}>{r.assets_updated}</td>
                  <td style={{ ...td, color: 'var(--as-danger-text)', maxWidth: 280 }}>{r.error || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Credentials ──────────────────────────────────────────────────── */

function Credentials() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const creds = useQuery({ queryKey: ['disc-creds'], queryFn: async () => (await discoveryApi.listCredentials()).data.credentials as any[] });
  const refresh = () => qc.invalidateQueries({ queryKey: ['disc-creds'] });
  const del = useMutation({ mutationFn: (id: number) => discoveryApi.deleteCredential(id), onSuccess: refresh });
  const list = creds.data ?? [];

  return (
    <div className="as-card" style={{ padding: '18px 20px' }}>
      <SectionHead title="Credentials"
        note="Used to authenticate to discovered hosts and pull their OS, software and antivirus. Secrets are encrypted and never shown again."
        right={<button className="as-btn as-btn-primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? <><X size={13} style={{ marginRight: 5, verticalAlign: -1 }} />Close</> : <><Plus size={13} style={{ marginRight: 5, verticalAlign: -1 }} />New credential</>}
        </button>} />

      {showNew && <NewCredentialForm onDone={() => { setShowNew(false); refresh(); }} />}

      {creds.isLoading ? <Empty text="Loading…" /> : list.length === 0 ? (
        <Empty text="No credentials yet." hint="Without a credential, discovery still finds hosts — it just can't read their OS, software or antivirus." />
      ) : (
        <div style={{ overflowX: 'auto', marginTop: showNew ? 16 : 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['Name', 'Type', 'Username', 'Applies to', 'Priority', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td style={{ ...td, fontWeight: 600, color: 'var(--as-ink)' }}>
                    {c.name}
                    {c.has_secret && <ShieldCheck size={12} style={{ marginLeft: 6, verticalAlign: -1, color: 'var(--as-good)' }} />}
                  </td>
                  <td style={{ ...td, textTransform: 'uppercase', fontSize: 11.5 }}>{c.kind}</td>
                  <td className="as-mono" style={td}>{c.username}</td>
                  <td style={td}>{(c.applies_to_cidrs && c.applies_to_cidrs.length) ? c.applies_to_cidrs.join(', ') : 'Any host'}</td>
                  <td className="as-mono" style={td}>{c.priority}</td>
                  <td style={td}>
                    <button className="as-btn as-btn-secondary" style={{ padding: '4px 8px', fontSize: 11.5 }}
                      disabled={del.isPending} onClick={() => { if (confirm(`Delete credential "${c.name}"?`)) del.mutate(c.id); }}><Trash2 size={11} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewCredentialForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: '', kind: 'winrm', username: '', secret: '', domain: '', cidrs: '', priority: '100' });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const create = useMutation({
    mutationFn: () => discoveryApi.createCredential({
      name: f.name, kind: f.kind, username: f.username, secret: f.secret,
      domain: f.domain || undefined,
      applies_to_cidrs: f.cidrs.trim() ? f.cidrs.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      priority: Number(f.priority) || 100,
    }),
    onSuccess: onDone,
  });
  const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: 'var(--as-secondary)', display: 'block', marginBottom: 4 };
  return (
    <div style={{ padding: '16px', border: '1px solid var(--as-border)', borderRadius: 12, background: 'var(--as-subtle)', marginBottom: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <div><label style={label}>Name</label><input className="as-input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Windows domain svc" /></div>
        <div><label style={label}>Type</label>
          <select className="as-input" value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="winrm">WinRM (Windows)</option>
            <option value="ssh">SSH (Linux)</option>
            <option value="ldap">LDAP (Active Directory)</option>
          </select>
        </div>
        <div><label style={label}>Username</label><input className="as-input" value={f.username} onChange={(e) => set('username', e.target.value)} placeholder="svc_scan" /></div>
        <div><label style={label}>Secret</label><input className="as-input" type="password" value={f.secret} onChange={(e) => set('secret', e.target.value)} placeholder="password or key" /></div>
        <div><label style={label}>Domain (optional)</label><input className="as-input" value={f.domain} onChange={(e) => set('domain', e.target.value)} placeholder="CORP" /></div>
        <div><label style={label}>Applies to (CIDRs, optional)</label><input className="as-input" value={f.cidrs} onChange={(e) => set('cidrs', e.target.value)} placeholder="10.0.0.0/24, 10.1.0.0/24" /></div>
        <div><label style={label}>Priority</label><input className="as-input" value={f.priority} onChange={(e) => set('priority', e.target.value)} /></div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="as-btn as-btn-primary" disabled={!f.name.trim() || !f.username.trim() || !f.secret || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Saving…' : 'Save credential'}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--as-faint)' }}>The secret is encrypted on save and never shown again.</span>
        {create.isError && <span style={{ fontSize: 12.5, color: 'var(--as-danger-text)' }}>{(create.error as any)?.response?.data?.detail || 'Could not save.'}</span>}
      </div>
    </div>
  );
}

/* ─── Shell ────────────────────────────────────────────────────────── */

export default function AssetDiscoveryPage() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="asset-suite as-fadeup" style={{ padding: '4px 2px' }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Radar size={20} strokeWidth={1.9} style={{ color: 'var(--as-green)' }} />
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--as-ink)', margin: 0 }}>IT Asset Discovery</h1>
        </div>
        <p style={{ fontSize: 13, color: 'var(--as-faint)', margin: '4px 0 0 30px' }}>
          Find devices on the network, profile them, and decide what enters the inventory.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--as-border)', marginBottom: 18, flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const on = t.id === tab;
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', fontSize: 13,
                fontWeight: on ? 700 : 500, color: on ? 'var(--as-green)' : 'var(--as-muted)',
                background: 'none', border: 'none', borderBottom: on ? '2px solid var(--as-green)' : '2px solid transparent',
                marginBottom: -1, cursor: 'pointer',
              }}>
              <Icon size={15} />{t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && <Overview go={setTab} />}
      {tab === 'campaigns' && <Campaigns />}
      {tab === 'inbox' && <InboxView />}
      {tab === 'runs' && <Runs />}
      {tab === 'credentials' && <Credentials />}
    </div>
  );
}
