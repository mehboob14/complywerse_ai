'use client';

/**
 * IT Asset Discovery — the real, wired screen.
 *
 * Replaces the former static design mock. Every number, row and action here is
 * backed by the /discovery API: campaigns + scopes, scheduled/manual runs, the
 * resolution inbox, and the encrypted credential store that powers authenticated
 * deep-collection (OS / software / antivirus on discovered hosts).
 */
import { useState, useEffect, useRef, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Radar, Inbox, Network, History, Play, Plus, Trash2, X,
  ShieldCheck, RefreshCw, Check, Plug,
} from 'lucide-react';
import { discoveryApi } from '@/lib/api';
import { useTabParam } from '@/lib/useTabParam';
import ConnectWizardPage, { PLATFORMS, PLATFORM_GROUPS, type Platform } from '../admin/integrations/connect/page';
import AgentsAdminPage from '../admin/agents/page';
import '../assets/_suite/asset-suite.css';

// Tabs are kept. Only Campaigns + host logins + Connectors are consolidated
// into ONE "Discover → Connect" tab, shown as a numbered pipeline inside it.
// Overview, Inbox and Scan history stay as their own separate tabs.
type Tab = 'overview' | 'pipeline' | 'inbox' | 'runs';

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'overview', label: 'Overview',           icon: Radar },
  { id: 'pipeline', label: 'Discover → Connect',  icon: Plug },
  { id: 'inbox',    label: 'Inbox',              icon: Inbox },
  { id: 'runs',     label: 'Scan history',       icon: History },
];

/* ─── shared bits ──────────────────────────────────────────────────── */

// Live view of the credential sweep. Without this the operator clicks "try my
// login on 18 devices" and gets one line of text, then silence — no way to tell
// running from finished from crashed. Polls while work is in flight and keeps
// showing the result once it stops.
function SweepProgress({ active, onIdle }: { active: boolean; onIdle?: () => void }) {
  const p = useQuery({
    queryKey: ['disc-connect-progress'],
    queryFn: async () => (await discoveryApi.connectProgress()).data as any,
    // Always enabled, and paced by what the SERVER says is running — not by
    // local state. Two bugs came from the old `enabled: active` version:
    //  1. React Query pauses refetchInterval when the tab loses focus, so
    //     looking away froze the counter mid-sweep and it never resumed —
    //     the numbers only moved again after a manual refresh.
    //  2. After any page reload `active` is false, so a sweep still running
    //     server-side showed nothing at all.
    // Polling the server's own `running` flag fixes both, and survives a
    // refresh. The endpoint is an in-memory dict read — cheap to poll.
    refetchInterval: (q: any) => ((q?.state?.data?.running || active) ? 1500 : false),
    refetchIntervalInBackground: true,
  });
  const s = p.data;
  useEffect(() => { if (s && !s.running && s.total > 0) onIdle?.(); }, [s?.running, s?.total]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s || !s.total) return null;
  const pct = s.percent ?? 0;
  return (
    <div style={{ marginTop: 12, padding: '12px 14px', border: '1px solid var(--as-border)', borderRadius: 10, background: 'var(--as-subtle)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12.5, color: 'var(--as-ink)' }}>
          {s.running ? 'Trying your login…' : s.error ? 'Sweep stopped' : 'Finished'}
        </strong>
        <span className="as-mono" style={{ fontSize: 12, color: 'var(--as-secondary)' }}>
          {s.done} / {s.total}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--as-track, #e5e7eb)', marginTop: 8, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: s.error ? 'var(--as-danger-text)' : 'var(--as-green)', transition: 'width .4s ease' }} />
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 9, fontSize: 12, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--as-good)' }}><strong>{s.connected}</strong> connected</span>
        <span style={{ color: 'var(--as-danger-text)' }}><strong>{s.rejected}</strong> rejected the login</span>
        {s.unreachable > 0 && (
          <span style={{ color: 'var(--as-blue)' }} title="The host answered the sweep, but WinRM/SSH is not listening — the login was never tested">
            <strong>{s.unreachable}</strong> service not reachable
          </span>
        )}
        {s.no_login > 0 && (
          <span style={{ color: 'var(--as-blue)' }} title="No saved login of the right kind covers these devices">
            <strong>{s.no_login}</strong> no login for their type
          </span>
        )}
        {s.unknown_type > 0 && (
          <span style={{ color: 'var(--as-faint)' }} title="The sweep saw no Windows or Linux port, so no login type applies">
            <strong>{s.unknown_type}</strong> type unknown
          </span>
        )}
        {s.running && s.current && (
          <span style={{ color: 'var(--as-faint)' }}>now: <span className="as-mono">{s.current}</span></span>
        )}
      </div>
      {s.error && <div style={{ fontSize: 12, color: 'var(--as-danger-text)', marginTop: 7 }}>{s.error}</div>}
      {!s.running && !s.error && (
        <div style={{ fontSize: 11.5, color: 'var(--as-faint)', marginTop: 7 }}>
          {s.connected > 0
            ? <>The {s.connected} that accepted it were scanned in depth and are now in IT Asset Inventory.</>
            : <>Nothing accepted this login. Check the Status column for each device&apos;s reason — a local account only works on the machine it exists on.</>}
          {s.no_login > 0 && <> {s.no_login} device{s.no_login === 1 ? '' : 's'} were never tried because no login of their type covers them — add one and run this again.</>}
          {s.unreachable > 0 && <> {s.unreachable} answered the sweep but had no WinRM/SSH service listening — that is not a password problem: enable remote management on those machines, or onboard them with an agent.</>}
        </div>
      )}
    </div>
  );
}

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

function Overview({ go }: { go: (t?: string) => void }) {
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
              {/* Columns describe what a sweep can actually produce now: it
                  finds devices, it does not create assets. "Awaiting login" is
                  the number that matters — those are the devices Connect can
                  still turn into inventory. */}
              <thead><tr>{['When', 'Trigger', 'Status', 'Devices found', 'Awaiting login', 'Added to inventory', 'Matched existing'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {runList.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, color: 'var(--as-ink)' }}>{fmt(r.finished_at || r.created_at)}</td>
                    <td style={td}>{r.trigger}</td>
                    <td style={td}><StatusPill status={r.status} /></td>
                    <td className="as-mono" style={td}>{r.hosts_seen}</td>
                    <td className="as-mono" style={{ ...td, color: (r.awaiting_login ?? 0) > 0 ? 'var(--as-blue)' : undefined }}>{r.awaiting_login ?? 0}</td>
                    <td className="as-mono" style={{ ...td, color: 'var(--as-good)' }}>{r.in_inventory ?? 0}</td>
                    <td className="as-mono" style={td}>{r.matched_existing ?? 0}</td>
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
  const refresh = () => { qc.invalidateQueries({ queryKey: ['disc-campaigns'] }); qc.invalidateQueries({ queryKey: ['disc-runs'] }); qc.invalidateQueries({ queryKey: ['disc-runs-all'] }); qc.invalidateQueries({ queryKey: ['disc-runs-active'] }); };

  // Poll for in-flight runs so a scanning campaign shows a LIVE progress bar
  // instead of the static "a run is already in progress" error.
  const activeRuns = useQuery({
    queryKey: ['disc-runs-active'],
    queryFn: async () => (await discoveryApi.listRuns(undefined, 30)).data.runs as any[],
    refetchInterval: 2500,
  });
  const activeByCampaign = new Map<number, any>();
  (activeRuns.data ?? []).forEach((r: any) => {
    if ((r.status === 'running' || r.status === 'queued') && !activeByCampaign.has(r.campaign_id)) {
      activeByCampaign.set(r.campaign_id, r);
    }
  });
  // When the last in-flight run finishes, refresh the list + history so the
  // "Last run" column and Scan history update on their own.
  const activeCount = activeByCampaign.size;
  const prevActive = useRef(0);
  useEffect(() => {
    if (prevActive.current > 0 && activeCount === 0) refresh();
    prevActive.current = activeCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCount]);

  const run = useMutation({ mutationFn: (id: number) => discoveryApi.runNow(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['disc-runs-active'] }) });
  const del = useMutation({ mutationFn: (id: number) => discoveryApi.deleteCampaign(id), onSuccess: refresh });

  const list = campaigns.data ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <style>{`@keyframes discScan{0%{left:-42%}100%{left:100%}}.disc-scan-bar{animation:discScan 1.05s ease-in-out infinite}`}</style>
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
                {list.map((c) => {
                  const active = activeByCampaign.get(c.id);
                  return (
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
                      {active ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                          title={`Scan ${active.status} — started ${fmt(active.started_at || active.created_at)}`}>
                          <span style={{ position: 'relative', display: 'inline-block', width: 96, height: 6, borderRadius: 3, background: 'var(--as-track)', overflow: 'hidden' }}>
                            <span className="disc-scan-bar" style={{ position: 'absolute', top: 0, height: '100%', width: '42%', borderRadius: 3, background: 'var(--as-blue)' }} />
                          </span>
                          <span style={{ fontSize: 11.5, color: 'var(--as-blue)', fontWeight: 600 }}>Scanning…</span>
                        </span>
                      ) : (
                        <button className="as-btn as-btn-secondary" style={{ padding: '4px 9px', fontSize: 11.5 }}
                          disabled={run.isPending} onClick={() => run.mutate(c.id)} title="Run this campaign now">
                          <Play size={11} style={{ marginRight: 4, verticalAlign: -1 }} />Run now
                        </button>
                      )}
                      <button className="as-btn as-btn-secondary" style={{ padding: '4px 8px', fontSize: 11.5, marginLeft: 6 }}
                        disabled={del.isPending} onClick={() => { if (confirm(`Delete campaign "${c.name}"? Its scan history is removed too.`)) del.mutate(c.id); }} title="Delete campaign">
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {run.isError && <p style={{ marginTop: 10, fontSize: 12.5, color: 'var(--as-danger-text)' }}>{(run.error as any)?.response?.data?.detail || 'Could not start the run.'}</p>}
        {run.isSuccess && <p style={{ marginTop: 10, fontSize: 12.5, color: 'var(--as-good)' }}>Scan started — the <strong>Scanning…</strong> bar shows on the campaign row; results land under Scan history.</p>}
      </div>
    </div>
  );
}

function NewCampaignForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [method, setMethod] = useState('network');
  const [schedule, setSchedule] = useState('0');
  const [cidr, setCidr] = useState('');
  const [snmp, setSnmp] = useState('');
  const create = useMutation({
    mutationFn: () => discoveryApi.createCampaign({
      name, method, schedule_seconds: Number(schedule) > 0 ? Number(schedule) : null,
      snmp_communities: snmp.trim() || null,
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
        <div><label style={label}>SNMP community <span style={{ color: 'var(--as-faint)', fontWeight: 400 }}>(optional)</span></label><input className="as-input" value={snmp} onChange={(e) => setSnmp(e.target.value)} placeholder="public, private" /></div>
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

/* ─── DHCP enrichment ─────────────────────────────────────────────── */

// Reads the DHCP server's REAL lease table (over a saved SSH/WinRM login) and
// fills the blank names of silent devices from it. No fabrication: a device the
// router holds no name for stays unnamed. Nothing runs until you pick a saved
// login and press Enrich — this is a live read of the router, not demo data.
function DhcpEnrichPanel() {
  const qc = useQueryClient();
  const creds = useQuery({ queryKey: ['disc-creds'], queryFn: async () => (await discoveryApi.listCredentials()).data.credentials as any[] });
  const [credId, setCredId] = useState<string>('');
  const [ip, setIp] = useState('');
  const [stype, setStype] = useState<'mikrotik' | 'dnsmasq' | 'isc' | 'windows'>('mikrotik');
  const [open, setOpen] = useState(false);
  const run = useMutation({
    mutationFn: () => discoveryApi.dhcpEnrich({ credential_id: Number(credId), dhcp_ip: ip, source_type: stype }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['disc-inbox'] });
      qc.invalidateQueries({ queryKey: ['disc-run-obs'] });
    },
  });
  const credList = creds.data ?? [];
  const res = run.data?.data as any;
  const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--as-faint)' };
  const inp: React.CSSProperties = { border: '1px solid var(--as-row)', borderRadius: 6, padding: '6px 9px', fontSize: 12.5, background: 'var(--as-card)', color: 'var(--as-ink)', fontFamily: 'inherit' };
  return (
    <div className="as-card" style={{ padding: '14px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <Network size={15} style={{ color: 'var(--as-blue)' }} />
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>Enrich names from DHCP</div>
        <div style={{ fontSize: 11.5, color: 'var(--as-faint)', flex: 1 }}>Reads your DHCP server&apos;s real lease table to name the silent devices — never invents a name.</div>
        <span style={{ color: 'var(--as-faint)' }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={label}>Login (saved)</span>
              <select value={credId} onChange={(e) => setCredId(e.target.value)} style={{ ...inp, minWidth: 170 }}>
                <option value="">Select a saved login…</option>
                {credList.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={label}>DHCP server IP</span>
              <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="10.11.10.1" style={{ ...inp, width: 130 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={label}>Server type</span>
              <select value={stype} onChange={(e) => setStype(e.target.value as any)} style={inp}>
                <option value="mikrotik">MikroTik (RouterOS)</option>
                <option value="dnsmasq">Linux dnsmasq</option>
                <option value="isc">ISC dhcpd</option>
                <option value="windows">Windows DHCP</option>
              </select>
            </div>
            <button className="as-btn as-btn-primary" disabled={!credId || !ip || run.isPending}
              onClick={() => run.mutate()} style={{ height: 32 }}>
              {run.isPending ? 'Reading lease table…' : 'Enrich from DHCP'}
            </button>
          </div>
          {creds.data && credList.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--as-muted)' }}>
              No saved login yet. Add one under Connect first — an SSH login for your router lets us read its lease table.
            </div>
          )}
          {res && (
            <div style={{ marginTop: 12, fontSize: 12.5, background: 'var(--as-subtle)', borderRadius: 8, padding: '9px 12px' }}>
              Read <b>{res.leases_total ?? 0}</b> leases · matched <b>{res.matched ?? 0}</b> devices · named <b style={{ color: 'var(--as-good)' }}>{res.named ?? 0}</b> · typed <b>{res.typed ?? 0}</b>.
              {res.named === 0 && res.matched > 0 && <span style={{ color: 'var(--as-muted)' }}> (matched devices already had names, or the server holds none for them.)</span>}
            </div>
          )}
          {run.isError && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--as-danger-text)' }}>Could not read the DHCP source — check the login and the server IP.</div>}
        </div>
      )}
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
    <>
    <DhcpEnrichPanel />
    <div className="as-card" style={{ padding: '18px 20px' }}>
      <SectionHead title="Inbox" note="Every device a scan found that has not become an asset yet — either waiting for a login, or an ambiguous match only you can settle. A decision here sticks across future scans."
        right={<button className="as-btn as-btn-secondary" onClick={refresh}><RefreshCw size={12} style={{ marginRight: 5, verticalAlign: -1 }} />Refresh</button>} />
      {inbox.isLoading ? <Empty text="Loading…" /> : rows.length === 0 ? (
        <Empty text="Inbox clear." hint="Nothing found and unresolved. Run a campaign under Discover to populate it." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['Host / IP', 'State', 'Source', 'Why it needs you', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td style={{ ...td, color: 'var(--as-ink)', fontWeight: 600 }}>
                    {o.host_name || o.ip_address || '—'}
                    {o.host_name && o.ip_address && <span className="as-mono" style={{ marginLeft: 7, fontSize: 11.5, color: 'var(--as-faint)' }}>{o.ip_address}</span>}
                  </td>
                  <td style={td}>
                    {o.resolution === 'unclaimed'
                      ? <span className="as-pill" style={{ background: 'var(--as-subtle)', color: 'var(--as-secondary)' }}>Needs login</span>
                      : o.resolution === 'review'
                        ? <span className="as-pill" style={{ background: 'var(--as-warn-bg, var(--as-subtle))', color: 'var(--as-blue)' }}>Ambiguous</span>
                        : <span style={{ color: 'var(--as-faint)' }}>{o.resolution}</span>}
                  </td>
                  <td style={td}>{o.source}</td>
                  <td style={{ ...td, color: 'var(--as-muted)' }}>
                    {o.resolution === 'unclaimed'
                      ? (o.resolution_note?.startsWith('login failed')
                          ? o.resolution_note
                          : 'Found on the network. Give it a login under Connect and it is scanned and added.')
                      : (o.resolution_note || 'Ambiguous match')}
                  </td>
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
                        {/* Adopt = record this device we can't log into as an
                            UNMANAGED, evidence-only asset (IP+MAC+vendor+fingerprint).
                            An explicit human choice — not the silent auto-create
                            we removed. Hosts should instead get a login under
                            Connect for a full profile. */}
                        <button className="as-btn as-btn-secondary" style={{ padding: '4px 9px', fontSize: 11.5 }}
                          disabled={act.isPending} onClick={() => act.mutate({ id: o.id, action: 'adopt' })}
                          title="Record as an unmanaged, evidence-only asset (no login) — for gear you can't sign in to, like a printer, switch or Chromecast">Adopt</button>
                        <button className="as-btn as-btn-secondary" style={{ padding: '4px 9px', fontSize: 11.5, marginLeft: 6 }}
                          onClick={() => setMergeFor(o.id)} title="This is an asset I already track — link the evidence to it">Merge</button>
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
    </>
  );
}

/* ─── Scan history ─────────────────────────────────────────────────── */

// The devices a single run found — shown when a Scan history row is expanded.
// Scan-history results: a structured, professional asset table. Every field is
// its OWN column (never concatenated); secondary fields live in an expandable
// details drawer. Reads the flattened API fields — no string-parsing of `raw`.
const RD_DTYPE: Record<string, string> = {
  network_device: 'Network device', dns_server: 'DNS server', appliance: 'Appliance',
  printer: 'Printer', camera: 'Camera', voip: 'VoIP phone', host: 'Host',
  hypervisor: 'Hypervisor', storage: 'Storage', ups: 'UPS',
  // Service ports the sweep now probes (5432/3306/1433/1521/27017/6443/389…).
  database: 'Database', directory: 'Directory', cluster: 'Cluster',
};
const _cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const RD_OS: Record<string, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS', ios: 'iOS', android: 'Android' };
// Display-time OS inference from the hostname (mirror of the backend rule) so
// every DESKTOP-*/MacBook-*/Android-* reads consistently, even on older scans.
function rdOsFromName(name?: string | null): string | null {
  const n = (name || '').trim();
  if (!n) return null;
  const low = n.toLowerCase();
  if (/^(desktop|laptop|win|pc|wks)[-_]/i.test(n)) return 'windows';
  if (low.includes('macbook') || low.includes('imac') || /^mac[-_]/i.test(n) || /[-_]mac$/i.test(n)) return 'macos';
  if (low.includes('iphone') || low.includes('ipad')) return 'ios';
  if (/^android[-_ ]/i.test(n)) return 'android';
  return null;
}
function rdType(o: any): string {
  const dt = o.device_type;
  if (dt && RD_DTYPE[dt] && dt !== 'host') return RD_DTYPE[dt];
  const os = o.os_guess || o.asset_os_family || rdOsFromName(o.device_name || o.host_name);
  const osl = os ? (RD_OS[os] || _cap(os)) : null;
  if (os === 'android' || os === 'ios') return osl!;   // a phone, not a "host"
  if (osl) return `${osl} host`;                       // Windows/macOS/Linux host
  if (dt === 'host') return 'Host';
  if (dt === 'unknown' || o.mac_address) return 'Unknown';
  return '—';
}
type RdTier = 'identified' | 'partial' | 'dark';
// Green = we actually know WHAT the device is (a real type/OS). A hostname, a
// vendor (OUI), or an open port is evidence we FOUND it — not proof of its
// type — so those are "partial" (amber), never green. This keeps the dot and
// the Type badge from ever disagreeing (no more green "Unknown").
function rdTier(o: any): RdTier {
  const t = rdType(o);
  if (t !== 'Unknown' && t !== '—') return 'identified';               // type/OS confirmed
  if (o.host_name || o.device_name || o.vendor || (o.open_ports || []).length) return 'partial';  // found, type unknown
  return 'dark';                                                        // IP/MAC only
}
// Device Name = the REAL hostname only. Vendor is a separate field — never
// synthesize "Intel Corporate device" into the name column.
function rdName(o: any): { txt: string; real: boolean } {
  const nm = o.device_name || o.host_name;
  return nm ? { txt: nm, real: true } : { txt: '—', real: false };
}
// A friendly heading for the details popup (a label, not the Name field).
function rdHeading(o: any): string {
  const t = rdType(o);
  return o.device_name || o.host_name || o.vendor || (t !== '—' && t !== 'Unknown' ? t : `Device ${o.ip_address}`);
}
const RD_MGMT: Record<string, string> = {
  unclaimed: 'Needs login', pending: 'Needs login', review: 'Needs review',
  created: 'In inventory (managed)', merged: 'In inventory (managed)', ignored: 'Ignored',
};
// Rich device type for the connect queue — same labels as Scan history, from the
// queue's own fields. mac_address:true means a present-but-evidenceless device
// reads "Unknown" (not "—").
function discType(d: any): string {
  return rdType({
    device_type: d.device_type,
    os_guess: d.os_guess || rdOsFromName(d.host_name || d.name),
    asset_os_family: d.os_family,
    host_name: d.host_name || d.name,
    device_name: d.host_name,
    mac_address: true,
    ip_address: d.ip_address,
  });
}
const RD_RES: Record<string, string> = {
  created: 'New asset', merged: 'Updated', review: 'Needs review',
  ignored: 'Ignored', pending: 'Pending', unclaimed: 'Waiting to connect',
};
// Main table: IP · Device Name · Vendor · Type · Ports · Result. MAC and the rest
// live in the details popup. Vendor kept visible because it's often the only
// identity for a "—" name; it truncates within its own column (never merges).
const RD_GRID = '34px 128px minmax(180px,1.5fr) minmax(140px,1.1fr) minmax(115px,0.95fr) 96px minmax(140px,1.05fr)';
const RD_MINW = 1000;                 // scrolls rather than squeezing columns
const RD_HOVER = '#dceee5';           // clear green on hover
const RD_TIER_DOT: Record<RdTier, string> = { identified: '#0d5c48', partial: '#a06a12', dark: '#a1a79f' };

function RunDeviceRow({ o, onOpen }: { o: any; onOpen: () => void }) {
  const dn = rdName(o);
  const tier = rdTier(o);
  const resultCell = o.resolved_asset_id
    ? <a href={`/assets/${o.resolved_asset_id}`} onClick={(e) => e.stopPropagation()} style={{ color: C.green, fontWeight: 600 }}>{RD_RES[o.resolution] || o.resolution} · #{o.resolved_asset_id}</a>
    : <span style={{ color: o.resolution === 'review' ? '#a06a12' : C.muted }}>{RD_RES[o.resolution] || o.resolution}</span>;
  return (
    <div onClick={onOpen} title="Open full device details"
      onMouseEnter={(e) => (e.currentTarget.style.background = RD_HOVER)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      style={{ display: 'grid', gridTemplateColumns: RD_GRID, alignItems: 'center', gap: 16, padding: '15px 18px', borderBottom: `1px solid ${C.bRow}`, cursor: 'pointer', transition: 'background .12s' }}>
      <div style={{ color: C.muted, fontSize: 13 }}>⤢</div>
      <div style={{ font: `500 13px ${MONO}`, color: C.mono }}>{o.ip_address || '—'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span title={tier === 'partial' ? 'Found on the network — device type not yet identified' : tier === 'dark' ? 'Unidentified — IP/MAC only' : 'Identified device type'}
          style={{ width: 8, height: 8, borderRadius: '50%', background: RD_TIER_DOT[tier], flex: 'none' }} />
        <span style={{ font: `${dn.real ? 600 : 400} 13.5px ${FONT}`, color: dn.real ? C.ink : C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dn.txt}</span>
      </div>
      <div style={{ font: `500 12.5px ${FONT}`, color: o.vendor ? C.ink : C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.vendor || ''}>{o.vendor || '—'}</div>
      <div>
        <span style={{ display: 'inline-block', font: `500 12px ${FONT}`, color: tier === 'identified' ? C.green : C.faint, background: tier === 'identified' ? C.fillKnown : C.fillNeutral, padding: '3px 10px', borderRadius: 7, whiteSpace: 'nowrap' }}>{rdType(o)}</span>
      </div>
      <div style={{ font: `500 12px ${MONO}`, color: (o.open_ports || []).length ? C.mono : C.faint }}>{(o.open_ports || []).length ? o.open_ports.join(', ') : '—'}</div>
      <div style={{ font: `500 12.5px ${FONT}` }}>{resultCell}</div>
    </div>
  );
}

// Full device details as a centered popup over a blurred backdrop.
function RunDeviceModal({ o, onClose }: { o: any; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [onClose]);
  const dash = (v: any) => (v === 0 || (v != null && v !== '')) ? v : '—';
  const tier = rdTier(o);
  const confColor = o.confidence_label === 'High' ? C.green : o.confidence_label === 'Medium' ? '#a06a12' : C.faint;
  const Field = ({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ font: `600 10px ${FONT}`, letterSpacing: '.06em', textTransform: 'uppercase', color: C.label }}>{label}</span>
      <span style={{ font: `500 13px ${mono ? MONO : FONT}`, color: C.ink, wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(18,53,44,.30)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(700px, 96vw)', maxHeight: '88vh', overflowY: 'auto', background: '#fff', border: `1px solid ${C.bCard}`, borderRadius: 18, boxShadow: '0 30px 80px -20px rgba(18,53,44,.45)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '22px 24px 16px', borderBottom: `1px solid ${C.bLine}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
            <span title={tier === 'partial' ? 'Found — device type not yet identified' : tier === 'dark' ? 'Unidentified — IP/MAC only' : 'Identified device type'} style={{ width: 10, height: 10, borderRadius: '50%', background: RD_TIER_DOT[tier], flex: 'none' }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ font: `700 18px ${FONT}`, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis' }}>{rdHeading(o)}</div>
              <div style={{ font: `500 12.5px ${MONO}`, color: C.mono, marginTop: 2 }}>{o.ip_address}</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ border: 'none', background: C.fillNeutral, color: C.muted, width: 30, height: 30, borderRadius: 8, cursor: 'pointer', fontSize: 15, flex: 'none' }}>✕</button>
        </div>
        <div style={{ padding: '20px 24px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '18px 22px' }}>
          <Field label="Device name" value={dash(o.device_name || o.host_name)} />
          <Field label="Device type" value={<span style={{ display: 'inline-block', font: `600 12px ${FONT}`, color: tier === 'identified' ? C.green : C.faint, background: tier === 'identified' ? C.fillKnown : C.fillNeutral, padding: '3px 10px', borderRadius: 7 }}>{rdType(o)}</span>} />
          <Field label="Confidence" value={o.confidence_label ? <span style={{ color: confColor, fontWeight: 700 }}>{o.confidence_label}{o.confidence != null ? ` (${o.confidence})` : ''}</span> : '—'} />
          <Field label="MAC address" mono value={<>{o.mac_address || '—'}{o.mac_randomized ? <span style={{ font: `600 9px ${FONT}`, color: '#a06a12', background: '#fbf1dc', borderRadius: 5, padding: '1px 6px', marginLeft: 6 }}>RANDOMIZED</span> : null}</>} />
          <Field label="Vendor" value={dash(o.vendor)} />
          <Field label="Open ports" mono value={(o.open_ports || []).length ? o.open_ports.join(', ') : '—'} />
          <Field label="Services" value={(o.services || []).length ? o.services.join(', ') : '—'} />
          <Field label="OS" value={dash(o.asset_os_family ? _cap(o.asset_os_family) : (o.os_guess ? (RD_OS[o.os_guess] || _cap(o.os_guess)) : null))} />
          <Field label="Model / Firmware" value={dash(o.product)} />
          <Field label="Discovery sources" value={(o.discovery_sources || []).length ? o.discovery_sources.join(' + ') : '—'} />
          <Field label="Evidence" value={(o.evidence || []).length ? o.evidence.join(', ') : '—'} />
          <Field label="Vendor source" value={o.vendor_source === 'ieee_oui' ? 'IEEE OUI (MAC vendor)' : dash(o.vendor_source)} />
          <Field label="FQDN" value={dash(o.fqdn)} />
          <Field label="First seen" value={dash(o.created_at ? fmt(o.created_at) : null)} />
          <Field label="Last seen" value={dash(o.observed_at ? fmt(o.observed_at) : null)} />
          <Field label="Management status" value={RD_MGMT[o.resolution] || o.resolution} />
          <Field label="Result" value={RD_RES[o.resolution] || o.resolution} />
          <Field label="Asset ID" value={o.resolved_asset_id ? <a href={`/assets/${o.resolved_asset_id}`} style={{ color: C.green, fontWeight: 600 }}>#{o.resolved_asset_id}</a> : '—'} />
        </div>
      </div>
    </div>
  );
}

function RunDevices({ runId }: { runId: number }) {
  const q = useQuery({
    queryKey: ['disc-run-obs', runId],
    queryFn: async () => (await discoveryApi.runObservations(runId)).data.observations as any[],
  });
  const [query, setQuery] = useState('');
  const [ftype, setFtype] = useState('');
  const [openDark, setOpenDark] = useState(false);
  const [modal, setModal] = useState<any | null>(null);
  if (q.isLoading) return <div style={{ padding: '16px 20px', font: `500 13px ${FONT}`, color: C.muted2 }}>Loading devices…</div>;
  const obs = q.data ?? [];
  if (!obs.length) return <div style={{ padding: '16px 20px', font: `500 13px ${FONT}`, color: C.muted2 }}>No devices recorded for this run.</div>;

  const types = Array.from(new Set(obs.map(rdType))).sort();
  const matches = (o: any) => {
    if (ftype && rdType(o) !== ftype) return false;
    if (query) {
      const hay = [o.device_name, o.host_name, o.ip_address, o.mac_address, o.vendor, rdType(o), ...(o.services || [])].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  };
  const shown = obs.filter(matches);
  const bright = shown.filter((o) => rdTier(o) !== 'dark');
  const dark = shown.filter((o) => rdTier(o) === 'dark');
  const counts = { identified: 0, partial: 0, dark: 0 } as Record<RdTier, number>;
  obs.forEach((o) => { counts[rdTier(o)]++; });

  const inputStyle: React.CSSProperties = { border: `1px solid ${C.bInput}`, background: '#fff', color: C.ink, font: `500 13px ${FONT}`, padding: '9px 12px', borderRadius: 10, outline: 'none' };
  const HEAD = ['', 'IP Address', 'Device Name', 'Vendor', 'Type', 'Ports', 'Result'];

  return (
    <div style={{ background: '#fff', borderTop: `1px solid ${C.bLine}` }}>
      {/* filter bar (search + type) — preserved */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '12px 20px', background: C.toolbarBg, borderBottom: `1px solid ${C.bLine}` }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: 11, color: '#9aa19a', fontSize: 12, pointerEvents: 'none' }}>{CS_ICONS.search}</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search IP, name, MAC, vendor, service…" style={{ ...inputStyle, padding: '9px 12px 9px 30px', minWidth: 250 }} />
        </div>
        <select value={ftype} onChange={(e) => setFtype(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="">All types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ font: `500 11.5px ${FONT}`, color: C.muted, marginLeft: 'auto' }}>
          <b style={{ color: C.green }}>{counts.identified}</b> identified · <b style={{ color: '#a06a12' }}>{counts.partial}</b> found · type unknown · <b style={{ color: C.faint }}>{counts.dark}</b> unidentified
        </span>
      </div>

      {/* table — horizontally scrollable so every column stays separate & readable */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: RD_MINW }}>
          <div style={{ display: 'grid', gridTemplateColumns: RD_GRID, alignItems: 'center', gap: 14, padding: '12px 18px', background: C.headBg, borderBottom: `1px solid ${C.bLine}`, font: `600 10.5px ${FONT}`, letterSpacing: '.05em', color: C.label, textTransform: 'uppercase' }}>
            {HEAD.map((h, i) => <div key={i}>{h}</div>)}
          </div>
          {bright.map((o) => <RunDeviceRow key={o.id} o={o} onOpen={() => setModal(o)} />)}
          {!bright.length && <div style={{ padding: 20, textAlign: 'center', color: C.faint, font: `500 12.5px ${FONT}` }}>No device matches these filters.</div>}
        </div>
      </div>

      {/* unidentified group — collapsed by default */}
      {dark.length > 0 && (
        <div style={{ margin: '10px 20px 16px', border: `1px dashed ${C.bInput}`, borderRadius: 12, overflow: 'hidden' }}>
          <div onClick={() => setOpenDark(!openDark)} style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9, font: `500 12px ${FONT}` }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.faint, flex: 'none' }} />
            <b>{dark.length} unidentified device{dark.length === 1 ? '' : 's'}</b>
            <span style={{ color: C.faint }}>— privacy-randomized MAC / answered no probe. IP + MAC is all a scan can learn.</span>
            <span style={{ marginLeft: 'auto', color: C.faint }}>{openDark ? '▾' : '▸'}</span>
          </div>
          {openDark && (
            <div style={{ overflowX: 'auto', borderTop: `1px solid ${C.bLine}` }}>
              <div style={{ minWidth: RD_MINW }}>
                {dark.map((o) => <RunDeviceRow key={o.id} o={o} onOpen={() => setModal(o)} />)}
              </div>
            </div>
          )}
        </div>
      )}
      {modal && <RunDeviceModal o={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function Runs() {
  const runs = useQuery({ queryKey: ['disc-runs-all'], queryFn: async () => (await discoveryApi.listRuns(undefined, 100)).data.runs as any[] });
  const [open, setOpen] = useState<number | null>(null);
  const rows = runs.data ?? [];
  return (
    <div className="as-card" style={{ padding: '18px 20px' }}>
      <SectionHead title="Scan history" note="Every run is kept. Click a row to see the exact devices that scan found — IP, name and type." />
      {runs.isLoading ? <Empty text="Loading…" /> : rows.length === 0 ? (
        <Empty text="No scans yet." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['', 'When', 'Trigger', 'Status', 'Hosts seen', 'New', 'Updated', 'Note'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(open === r.id ? null : r.id)}
                    title="Click to see the devices this scan found">
                    <td style={{ ...td, width: 22, color: 'var(--as-muted)' }}>{open === r.id ? '▾' : '▸'}</td>
                    <td style={{ ...td, color: 'var(--as-ink)' }}>{fmt(r.finished_at || r.created_at)}</td>
                    <td style={td}>{r.trigger}</td>
                    <td style={td}><StatusPill status={r.status} /></td>
                    <td className="as-mono" style={td}>{r.hosts_seen}</td>
                    <td className="as-mono" style={{ ...td, color: 'var(--as-good)' }}>{r.assets_new}</td>
                    <td className="as-mono" style={td}>{r.assets_updated}</td>
                    <td style={{ ...td, color: 'var(--as-danger-text)', maxWidth: 280 }}>{r.error || ''}</td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={8} style={{ padding: 0, borderBottom: '1px solid var(--as-row)' }}>
                        <RunDevices runId={r.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Credentials ──────────────────────────────────────────────────── */

// The saved-logins ledger. Adding a login happens in ONE place — the
// "＋ Add connection → Agentless" popup — so this is management only: see what
// exists, see what it covers, revoke it.
// Saved logins, grouped by the kind of thing they log into so the list stays
// readable as every asset type starts saving here (not just Windows/Linux).
const CRED_CATEGORIES: { key: string; label: string; hint: string }[] = [
  { key: 'host',     label: 'Hosts',           hint: 'Windows & Linux servers (WinRM / SSH)' },
  { key: 'database', label: 'Databases',       hint: 'PostgreSQL · MySQL · SQL Server · Oracle' },
  { key: 'cloud',    label: 'Cloud accounts',  hint: 'AWS · Azure · DigitalOcean' },
  { key: 'network',  label: 'Network devices', hint: 'Cisco / SSH network gear' },
  { key: 'identity', label: 'Identity',        hint: 'Active Directory / LDAP' },
  { key: 'cluster',  label: 'Clusters',        hint: 'Kubernetes' },
];

function Credentials() {
  const qc = useQueryClient();
  const creds = useQuery({ queryKey: ['disc-creds'], queryFn: async () => (await discoveryApi.listCredentials()).data.credentials as any[] });
  const refresh = () => qc.invalidateQueries({ queryKey: ['disc-creds'] });
  const del = useMutation({ mutationFn: (id: number) => discoveryApi.deleteCredential(id), onSuccess: refresh });
  const list = creds.data ?? [];
  const byCat: Record<string, any[]> = {};
  for (const c of list) { const k = c.category || 'host'; (byCat[k] ||= []).push(c); }

  return (
    <div className="as-card" style={{ padding: '18px 20px' }}>
      <SectionHead title="Saved logins"
        note="Reusable logins for every kind of asset. You enter one once when you connect — it's kept here so you never re-type it. Secrets are encrypted and never shown again." />

      {creds.isLoading ? <Empty text="Loading…" /> : list.length === 0 ? (
        <Empty text="No saved logins yet." hint="Connect anything via ＋ Add connection and its login is saved here automatically — Windows, Linux, database, cloud, all of it." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {CRED_CATEGORIES.filter((cat) => (byCat[cat.key] || []).length > 0).map((cat) => (
            <div key={cat.key}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--as-ink)' }}>{cat.label}</span>
                <span style={{ fontSize: 11.5, color: 'var(--as-faint)' }}>{cat.hint}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--as-faint)' }}>{byCat[cat.key].length}</span>
              </div>
              <div style={{ overflowX: 'auto', border: '1px solid var(--as-line, #e8e4dc)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr>{['Name', 'Type', 'Username', 'Applies to', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {byCat[cat.key].map((c) => (
                      <tr key={c.id}>
                        <td style={{ ...td, fontWeight: 600, color: 'var(--as-ink)' }}>
                          {c.name}
                          {c.has_secret && <ShieldCheck size={12} style={{ marginLeft: 6, verticalAlign: -1, color: 'var(--as-good)' }} />}
                        </td>
                        <td style={{ ...td, textTransform: 'uppercase', fontSize: 11.5 }}>{c.kind}</td>
                        <td className="as-mono" style={td}>{c.username || '—'}</td>
                        <td style={td}>{(c.applies_to_cidrs && c.applies_to_cidrs.length) ? c.applies_to_cidrs.join(', ') : (cat.key === 'host' ? 'Any host' : 'Account-wide')}</td>
                        <td style={td}>
                          <button className="as-btn as-btn-secondary" style={{ padding: '4px 8px', fontSize: 11.5 }}
                            disabled={del.isPending} onClick={() => { if (confirm(`Delete login "${c.name}"?`)) del.mutate(c.id); }}><Trash2 size={11} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Agentless → Windows / Linux. This is the discovery→inventory bridge: the
// campaign already swept the range and parked the devices, so this form asks
// for the ONE thing still missing — the login — and then runs it against what
// discovery found. Devices that accept it get profiled (OS, hardware, software,
// posture) and a CIS-capable connection off the same credential; devices that
// reject it are skipped and stay in the queue.
//
// The subnet restriction is NOT asked for: it is derived from the campaign
// scopes that produced the devices. It stays available under Advanced because
// an unscoped domain credential is tried against every discovered device, and
// enough failures in a row trips AD account-lockout policy.
function HostLoginForm({ platform, onSaved }: { platform: 'windows' | 'linux'; onSaved: () => void }) {
  const isWin = platform === 'windows';
  const kind = isWin ? 'winrm' : 'ssh';
  const qc = useQueryClient();

  const campaigns = useQuery({
    queryKey: ['disc-campaigns'],
    queryFn: async () => (await discoveryApi.listCampaigns()).data.campaigns as any[],
  });
  const devices = useQuery({
    queryKey: ['disc-discovered-devices'],
    queryFn: async () => (await discoveryApi.discoveredDevices()).data.devices as any[],
  });
  // Only devices of THIS transport that are not yet in inventory are candidates
  // — that is the number this credential can actually change.
  const waiting = (devices.data ?? []).filter(
    (d: any) => !d.asset_id && d.transport === platform,
  ).length;

  // Every non-excluded CIDR the tenant's campaigns already sweep.
  const campaignCidrs: string[] = Array.from(new Set(
    (campaigns.data ?? []).flatMap((c: any) => (c.scopes ?? [])
      .filter((s: any) => s.kind === 'cidr' && !s.exclude)
      .map((s: any) => s.value as string)),
  ));

  const [f, setF] = useState({
    name: isWin ? 'Windows domain login' : 'Linux SSH login',
    username: '', secret: '', domain: '', cidrs: '', priority: '100',
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [advanced, setAdvanced] = useState(false);
  const [restrict, setRestrict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sweepMsg, setSweepMsg] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => discoveryApi.createCredential({
      name: f.name.trim(), kind, username: f.username.trim(), secret: f.secret,
      domain: f.domain.trim() || undefined,
      // Unrestricted by default — the campaign already decided the range.
      applies_to_cidrs: restrict
        ? (f.cidrs.trim() ? f.cidrs.split(',').map((s) => s.trim()).filter(Boolean) : campaignCidrs)
        : undefined,
      priority: Number(f.priority) || 100,
    }),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['disc-creds'] });
      qc.invalidateQueries({ queryKey: ['disc-discovered-devices'] });
      onSaved();
    },
  });

  const [sweeping, setSweeping] = useState(false);
  const sweep = useMutation({
    // Scoped to what was just saved: a Windows login is only ever offered to
    // Windows devices, a Linux one only to Linux.
    mutationFn: () => discoveryApi.connectAllDiscovered(kind as 'winrm' | 'ssh'),
    onSuccess: (r: any) => {
      setSweepMsg(r.data?.message || 'Trying your login on the discovered devices…');
      setSweeping(true);
      qc.invalidateQueries({ queryKey: ['disc-discovered-devices'] });
    },
    onError: (e: any) => setSweepMsg(e?.response?.data?.detail || 'Could not start the sweep.'),
  });

  const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: 'var(--as-secondary)', display: 'block', marginBottom: 4 };

  if (saved) {
    return (
      <div style={{ padding: '20px 4px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--as-ink)', marginBottom: 6 }}>
          <Check size={16} style={{ marginRight: 6, verticalAlign: -3, color: 'var(--as-good)' }} />Login saved
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--as-secondary)', lineHeight: 1.6, margin: '0 0 14px', maxWidth: 620 }}>
          {waiting > 0 ? (
            <>
              <strong>{waiting}</strong> discovered {waiting === 1 ? 'device is' : 'devices are'} still unprofiled.
              Run the login against them now — the ones that accept it are read for OS, hardware,
              software and posture, and land in IT Asset Inventory fully populated. The ones that
              reject it are skipped and stay in the queue.
            </>
          ) : (
            <>No unprofiled devices are waiting right now. The login is stored and will be applied automatically the next time a campaign finds something.</>
          )}
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {waiting > 0 && (
            <button className="as-btn as-btn-primary" disabled={sweep.isPending} onClick={() => sweep.mutate()}>
              {sweep.isPending ? 'Starting…' : `Try it on ${waiting} discovered ${waiting === 1 ? 'device' : 'devices'}`}
            </button>
          )}
          <button className="as-btn as-btn-secondary" onClick={() => { setSaved(false); setSweepMsg(null); setF({ ...f, username: '', secret: '' }); }}>
            Add another login
          </button>
          {sweepMsg && <span style={{ fontSize: 12.5, color: 'var(--as-secondary)' }}>{sweepMsg}</span>}
        </div>
        <SweepProgress active={sweeping} onIdle={() => {
          setSweeping(false);
          qc.invalidateQueries({ queryKey: ['disc-discovered-devices'] });
        }} />
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 4px 8px' }}>
      <p style={{ fontSize: 12.5, color: 'var(--as-secondary)', lineHeight: 1.6, margin: '0 0 14px', maxWidth: 620 }}>
        Discovery has already found the devices — this is the login it uses to read them.
        {waiting > 0 && <> <strong>{waiting}</strong> {isWin ? 'Windows' : 'Linux'} {waiting === 1 ? 'device is' : 'devices are'} waiting for one.</>}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <div><label style={label}>Name</label><input className="as-input" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div><label style={label}>Username</label><input className="as-input" value={f.username} onChange={(e) => set('username', e.target.value)} placeholder={isWin ? 'svc_scan' : 'root'} /></div>
        <div><label style={label}>{isWin ? 'Password' : 'Password or key'}</label><input className="as-input" type="password" value={f.secret} onChange={(e) => set('secret', e.target.value)} /></div>
        {isWin && <div><label style={label}>Domain (optional)</label><input className="as-input" value={f.domain} onChange={(e) => set('domain', e.target.value)} placeholder="CORP" /></div>}
      </div>

      <button
        onClick={() => setAdvanced((v) => !v)}
        style={{ marginTop: 12, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--as-blue)' }}>
        {advanced ? '− Hide advanced' : '+ Advanced — restrict which devices this login is tried on'}
      </button>

      {advanced && (
        <div style={{ marginTop: 10, padding: 14, border: '1px solid var(--as-border)', borderRadius: 10, background: 'var(--as-subtle)' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--as-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={restrict} style={{ marginTop: 3 }}
              onChange={(e) => {
                setRestrict(e.target.checked);
                if (e.target.checked && !f.cidrs) set('cidrs', campaignCidrs.join(', '));
              }} />
            <span>
              Only try this login on specific subnets.
              <span style={{ display: 'block', color: 'var(--as-faint)', fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>
                Leave off and it is tried on every device discovery finds. Turn it on when different
                subnets use different accounts — a domain account that fails repeatedly can trip
                account-lockout policy.
              </span>
            </span>
          </label>
          {restrict && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
              <div>
                <label style={label}>Subnets</label>
                <input className="as-input" value={f.cidrs} onChange={(e) => set('cidrs', e.target.value)} placeholder="10.0.0.0/24, 10.1.0.0/24" />
                <div style={{ fontSize: 11, color: 'var(--as-faint)', marginTop: 4 }}>
                  {campaignCidrs.length > 0
                    ? <>Pre-filled from your campaign scopes ({campaignCidrs.join(', ')}).</>
                    : <>No campaign CIDR scopes found — enter them manually.</>}
                </div>
              </div>
              <div><label style={label}>Priority</label><input className="as-input" value={f.priority} onChange={(e) => set('priority', e.target.value)} />
                <div style={{ fontSize: 11, color: 'var(--as-faint)', marginTop: 4 }}>Lower number wins when two logins cover the same device.</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="as-btn as-btn-primary"
          disabled={!f.name.trim() || !f.username.trim() || !f.secret || create.isPending}
          onClick={() => create.mutate()}>
          {create.isPending ? 'Saving…' : 'Save login'}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--as-faint)' }}>Encrypted on save and never shown again.</span>
        {create.isError && <span style={{ fontSize: 12.5, color: 'var(--as-danger-text)' }}>{(create.error as any)?.response?.data?.detail || 'Could not save.'}</span>}
      </div>
    </div>
  );
}

/* ─── Shell ────────────────────────────────────────────────────────── */

/* ─── Pipeline shell ───────────────────────────────────────────────────
   One page, three numbered steps in order, instead of scattered tabs:
     ① Discover  (Campaigns + host logins)   → find the devices
     ② Review    (Inbox + Scan history)       → see what was found
     ③ Connect   (Connect wizard)             → add what a scan can't find
   Each step just reuses the same components the tabs used to hold. */

// A discovered device's pre-filled connect form: IP + platform come from the
// scan, the operator only adds a login and approves.
function ConnectDeviceForm({ device, onDone }: { device: any; onDone: () => void }) {
  const [f, setF] = useState({ username: '', password: '', domain: '', port: '', database: '' });
  const [err, setErr] = useState<string | null>(null);
  const isWin = device.transport === 'windows';
  // Doors this device actually exposes: a host login (WinRM/SSH) and/or a typed
  // service the sweep saw listening (PostgreSQL on 5432, LDAP on 389…). Each kind
  // connects through its OWN door with its OWN credential.
  const svcs: any[] = device.service_suggestions || [];
  const hostOk = device.transport === 'windows' || device.transport === 'linux';
  const [mode, setMode] = useState<string>(hostOk ? 'host' : (svcs[0]?.kind || 'host'));
  const svc = svcs.find((s) => s.kind === mode);
  const m = useMutation({
    // Typed service → its own collector. Otherwise the host path:
    // already in inventory → re-collect onto that asset; not yet → promote the
    // observation, which only creates the asset if the login succeeds.
    mutationFn: () => svc
      ? discoveryApi.connectService(device.observation_id, {
          kind: svc.kind, username: f.username || undefined, password: f.password,
          port: f.port ? Number(f.port) : (svc.default_port || undefined),
          database: f.database || undefined,
        })
      : device.asset_id
      ? discoveryApi.reconnectAsset(device.asset_id, {
          username: f.username, password: f.password,
          domain: f.domain || undefined, transport: device.transport || undefined,
        })
      : discoveryApi.connectDevice(device.observation_id, {
          username: f.username, password: f.password,
          domain: f.domain || undefined, transport: device.transport || undefined,
        }),
    onSuccess: (res: any) => {
      if (res.data?.collected) onDone();
      else setErr(res.data?.error || 'Login saved, but the device could not be read. Check it and retry.');
    },
    onError: (e: any) => setErr(e?.response?.data?.detail || 'Could not connect.'),
  });
  const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: 'var(--as-secondary)', display: 'block', marginBottom: 4 };
  return (
    <div style={{ padding: '14px 16px', background: 'var(--as-subtle)', borderTop: '1px solid var(--as-row)' }}>
      <div style={{ fontSize: 12.5, color: 'var(--as-secondary)', marginBottom: 10 }}>
        Connecting <strong style={{ color: 'var(--as-ink)' }}>{device.name || device.ip_address}</strong>
        {' · '}<span className="as-mono">{device.ip_address}</span>
        {' · '}{svc ? `${svc.label} (port ${svc.default_port})` : (isWin ? 'WinRM (Windows)' : 'SSH (Linux)')}
        {' '}<span style={{ color: 'var(--as-faint)' }}>— pre-filled from the scan</span>
      </div>
      {/* "Connect as" — the sweep may have found MORE than one door on this box
          (a Windows host that also runs PostgreSQL). Each choice uses its own
          credential kind and produces a different asset model. */}
      {(svcs.length > 0) && (
        <div style={{ marginBottom: 10 }}>
          <label style={label}>Connect as</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(hostOk ? [{ kind: 'host', label: isWin ? 'Windows host (WinRM)' : 'Linux host (SSH)' }] : []).concat(
              svcs.map((s: any) => ({ kind: s.kind, label: `${s.label} · ${s.port}` })),
            ).map((o: any) => (
              <button key={o.kind} onClick={() => setMode(o.kind)}
                style={{ border: `1px solid ${mode === o.kind ? 'var(--as-good)' : 'var(--as-border)'}`,
                  background: mode === o.kind ? 'var(--as-good-bg, #e6f3ec)' : '#fff',
                  color: mode === o.kind ? 'var(--as-good)' : 'var(--as-secondary)',
                  font: '600 12px inherit', padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {!device.asset_id && (
        <div style={{ fontSize: 11.5, color: 'var(--as-faint)', marginBottom: 10, maxWidth: 620, lineHeight: 1.5 }}>
          {svc
            ? `This device is not in IT Asset Inventory yet. If the ${svc.label} login works it is inventoried as a ${svc.label} asset with its own component detail. If it fails, nothing is added.`
            : 'This device is not in IT Asset Inventory yet. If the login works it is scanned in depth and added with its OS, hardware and software. If it fails, nothing is added.'}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <div><label style={label}>{svc?.kind === 'k8s' ? 'Username (optional)' : 'Username'}</label><input className="as-input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder={svc ? (svc.kind === 'postgres' ? 'postgres' : svc.kind === 'mysql' ? 'root' : svc.kind === 'ldap' ? 'CN=svc,DC=corp,DC=local' : 'user') : (isWin ? 'Administrator' : 'root')} /></div>
        <div><label style={label}>{svc?.kind === 'k8s' ? 'Token' : 'Password'}</label><input className="as-input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        {!svc && isWin && <div><label style={label}>Domain (optional)</label><input className="as-input" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder={device.host_name || 'CORP'} /></div>}
        {svc && <div><label style={label}>Port</label><input className="as-input" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} placeholder={String(svc.default_port)} /></div>}
        {svc && ['postgres', 'mysql', 'mssql', 'oracle'].includes(svc.kind) && (
          <div><label style={label}>Database (optional)</label><input className="as-input" value={f.database} onChange={(e) => setF({ ...f, database: e.target.value })} placeholder={svc.kind === 'postgres' ? 'postgres' : 'default'} /></div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="as-btn as-btn-primary" disabled={!f.password || (!f.username && svc?.kind !== 'k8s') || m.isPending} onClick={() => { setErr(null); m.mutate(); }}>
          {m.isPending ? 'Connecting…' : (svc ? `Connect as ${svc.label}` : 'Approve & connect')}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--as-faint)' }}>
          {svc ? `Saves a ${svc.kind} login for this host and reads its ${svc.label} inventory.` : 'Saves a login for this one host and reads its OS + software.'}
        </span>
        {err && <span style={{ fontSize: 12, color: 'var(--as-danger-text)' }}>{err}</span>}
      </div>
    </div>
  );
}

// The review-and-approve queue: every device discovery found, with IP + type
// pre-filled. Approve one → it's profiled. This is the discovery-driven Connect.
// Design tokens from the Connect-screen handoff (high-fidelity light theme).
// ── Connect-screen design tokens + primitives (exact React handoff) ──────────
const C = {
  pageBg: '#eceae3', card: '#fff', toolbarBg: '#faf9f5', headBg: '#f7f6f1',
  green: '#0d5c48', link: '#0d6a52', linkHover: '#0a4f3d', ink: '#12352c',
  teal: '#12b886', tealDim: '#9fd8c3', amber: '#e0a92e', amberText: '#a06a12', amberFill: '#fbf1dc',
  dimDate: '#c98a5a', muted: '#67766f', muted2: '#5f6f69', muted3: '#7a8a84', label: '#8a9089',
  faint: '#a1a79f', mono: '#4a5a53', chipBg: '#e6e4db', fillKnown: '#e6f3ec', fillUnknown: '#eef0ea',
  fillNeutral: '#f0eee6', bCard: '#e4e2d9', bToggle: '#e0ded5', bTab: '#dddbd2', bInput: '#d8d6cc',
  bLine: '#ece9e0', bRow: '#f0eee6', bCheck: '#c3c1b6',
};
const FONT = "'Sora', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const CS_ICONS = { discover: '⊹', connect: '⚡', add: '+', search: '⌕', chevron: '▾', host: '🖥', ip: '⧉' };
const CS_GRID = '44px 1.7fr 1.15fr .95fr 1.35fr 1.15fr 118px';

const CsCheckbox = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
  <span role="checkbox" aria-checked={checked} onClick={onChange}
    style={{ display: 'inline-block', width: 17, height: 17, borderRadius: 5, cursor: 'pointer',
      border: `1.5px solid ${checked ? C.teal : C.bCheck}`, background: checked ? C.teal : '#fff' }} />
);
const CsSelect = ({ value, onChange, children, style }: any) => (
  <div style={{ position: 'relative', ...style }}>
    <select value={value} onChange={onChange}
      style={{ appearance: 'none', WebkitAppearance: 'none', border: `1px solid ${C.bInput}`, background: '#fff',
        color: C.ink, font: `500 13.5px ${FONT}`, padding: '10px 36px 10px 14px', borderRadius: 11, cursor: 'pointer' }}>
      {children}
    </select>
    <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: C.muted, fontSize: 11 }}>{CS_ICONS.chevron}</span>
  </div>
);
const CsPrimary = ({ children, onClick, disabled, style }: any) => (
  <button onClick={onClick} disabled={disabled}
    style={{ display: 'flex', alignItems: 'center', gap: 9, border: 'none', color: '#fff', font: `700 14px ${FONT}`,
      padding: '12px 22px', borderRadius: 11, cursor: disabled ? 'default' : 'pointer',
      background: disabled ? C.tealDim : C.teal, boxShadow: '0 2px 8px rgba(18,184,134,.28)', ...style }}>
    {children}
  </button>
);
function CsStat({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
      <span style={{ font: `700 24px ${FONT}`, color }}>{value}</span>
      <span style={{ font: `600 10.5px ${FONT}`, letterSpacing: '.06em', textTransform: 'uppercase', color: C.label }}>{label}</span>
    </div>
  );
}

// Fully custom dropdown (a native <select>'s option list can't be themed).
// Green selection, generous spacing, soft shadow, chevron flip, outside-click close.
function CsDropdown({ value, onChange, options, placeholder, minWidth }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string; sub?: string }[]; placeholder?: string; minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const selected = options.find((o) => o.value === value);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minWidth: minWidth || 170,
          border: `1px solid ${open ? C.green : C.bInput}`, background: '#fff', color: C.ink, font: `500 13.5px ${FONT}`,
          padding: '10px 14px', borderRadius: 11, cursor: 'pointer', boxShadow: open ? '0 0 0 3px rgba(13,92,72,.10)' : 'none', transition: 'border-color .12s, box-shadow .12s' }}>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected ? selected.label : (placeholder || '—')}</span>
        <span style={{ color: C.muted, fontSize: 11, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>{CS_ICONS.chevron}</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 40, minWidth: '100%', maxHeight: 320, overflowY: 'auto',
          background: '#fff', border: `1px solid ${C.bInput}`, borderRadius: 13, padding: 6, boxShadow: '0 16px 40px -10px rgba(18,53,44,.28)' }}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <div key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                onMouseEnter={(e) => { if (!on) (e.currentTarget as HTMLDivElement).style.background = C.fillKnown; }}
                onMouseLeave={(e) => { if (!on) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '9px 12px', borderRadius: 9, cursor: 'pointer',
                  font: `${on ? 600 : 500} 13.5px ${FONT}`, color: on ? C.green : C.ink, background: on ? C.fillKnown : 'transparent', whiteSpace: 'nowrap' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span>{o.label}</span>
                  {o.sub ? <span style={{ font: `500 11.5px ${FONT}`, color: C.faint }}>{o.sub}</span> : null}
                </span>
                {on && <span style={{ color: C.green, fontSize: 13 }}>✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Multi-select login picker: tick one or more saved logins to try. Same look as
// CsDropdown but with checkboxes (a native <select> can't multi-select cleanly).
function CsLoginPicker({ options, selected, onToggle, onToggleAll, minWidth }: {
  options: { id: number; name: string; kind: string }[];
  selected: Set<number>; onToggle: (id: number) => void; onToggleAll: (checked: boolean) => void; minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const label = selected.size ? `Logins to try (${selected.size})` : 'Logins to try (auto)';
  const allOn = options.length > 0 && options.every((o) => selected.has(o.id));
  const someOn = options.some((o) => selected.has(o.id));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((v) => !v)} title="Tick the saved login(s) to try — none ticked = best match per device"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minWidth: minWidth || 190,
          border: `1px solid ${open ? C.green : C.bInput}`, background: '#fff', color: C.ink, font: `500 13.5px ${FONT}`,
          padding: '10px 14px', borderRadius: 11, cursor: 'pointer', boxShadow: open ? '0 0 0 3px rgba(13,92,72,.10)' : 'none', transition: 'border-color .12s, box-shadow .12s' }}>
        <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ color: C.muted, fontSize: 11, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>{CS_ICONS.chevron}</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 40, minWidth: 260, maxHeight: 320, overflowY: 'auto',
          background: '#fff', border: `1px solid ${C.bInput}`, borderRadius: 13, padding: 6, boxShadow: '0 16px 40px -10px rgba(18,53,44,.28)' }}>
          {options.length === 0 ? (
            <div style={{ padding: '10px 12px', font: `500 12.5px ${FONT}`, color: C.muted }}>No host login saved yet — use ＋ Add connection.</div>
          ) : (
            <>
              {options.length > 1 && (
                <label onMouseEnter={(e) => ((e.currentTarget as HTMLLabelElement).style.background = C.fillKnown)}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLLabelElement).style.background = 'transparent')}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, cursor: 'pointer', borderBottom: `1px solid ${C.bLine}`, marginBottom: 3 }}>
                  <input type="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = someOn && !allOn; }}
                    onChange={() => onToggleAll(!allOn)} style={{ width: 15, height: 15, accentColor: C.teal, cursor: 'pointer' }} />
                  <span style={{ font: `700 12.5px ${FONT}`, color: C.muted }}>Select all</span>
                </label>
              )}
              {options.map((o) => {
                const on = selected.has(o.id);
                return (
                  <label key={o.id} onMouseEnter={(e) => { if (!on) (e.currentTarget as HTMLLabelElement).style.background = C.fillKnown; }}
                    onMouseLeave={(e) => { if (!on) (e.currentTarget as HTMLLabelElement).style.background = 'transparent'; }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, cursor: 'pointer', background: on ? C.fillKnown : 'transparent' }}>
                    <input type="checkbox" checked={on} onChange={() => onToggle(o.id)} style={{ width: 15, height: 15, accentColor: C.teal, cursor: 'pointer' }} />
                    <span style={{ font: `${on ? 600 : 500} 13.5px ${FONT}`, color: on ? C.green : C.ink }}>{o.name}</span>
                    <span style={{ marginLeft: 'auto', font: `600 10px ${FONT}`, color: C.faint, textTransform: 'uppercase' }}>{o.kind}</span>
                  </label>
                );
              })}
              <div style={{ padding: '8px 12px 4px', marginTop: 4, borderTop: `1px solid ${C.bLine}`, font: `500 11px ${FONT}`, color: C.faint }}>
                {selected.size ? 'Only ticked logins are tried — matched to each device by type.' : 'None ticked → best matching login is auto-picked per device.'}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Their DeviceRow, wired to a live discovered-device record.
function CsDeviceRow({ d, checked, onToggle, onConnect, onAdopt, adopting }: any) {
  const numeric = !(d.name || d.host_name) || d.name === d.ip_address;
  const nm = d.name || d.host_name || d.ip_address;
  const typeText = discType(d);
  const known = typeText !== 'Unknown' && typeText !== '—';
  const isDim = !!d.stale;
  const inInv = !!d.in_inventory;
  const inReview = d.resolution === 'review';
  const connectable = d.connectable === true;                              // WinRM/SSH port CONFIRMED open
  const hasSvc = (d.service_suggestions || []).length > 0;                 // a typed service door (Postgres/LDAP/…)
  // "attemptable" = there is SOME door we can authenticate through: a host OS
  // login (WinRM/SSH), or a detected service with its own credential kind.
  const attemptable = d.transport === 'windows' || d.transport === 'linux' || hasSvc;
  const identified = !inInv && !inReview && !attemptable && (!!d.device_type || !!d.os_guess || !!d.host_name);
  const silent = !inInv && !inReview && !attemptable && !identified;       // IP + MAC only
  // Selectable/Connect-able whenever it's a host OS — the attempt is safe even
  // when WinRM is off (fails as "unreachable", not a bad-password lockout).
  const canConnect = !d.connected && !inInv && !inReview && !isDim && !!d.observation_id && attemptable;
  // Why a device we recognise still can't take a host login.
  const noLoginReason =
    d.transport === 'windows' ? (d.login_state === 'closed' ? 'Windows · WinRM off' : 'Windows · WinRM unverified')
    : d.transport === 'linux' ? (d.login_state === 'closed' ? 'Linux · SSH off' : 'Linux · SSH unverified')
    // No host login, but a typed service IS listening — name it, so the operator
    // sees "PostgreSQL · needs login" instead of a dead-end "No login service".
    : hasSvc ? `${d.service_suggestions[0].label} · needs login`
    : 'No login service';
  return (
    <div onMouseEnter={(e) => (e.currentTarget.style.background = '#f4f8f5')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      style={{ display: 'grid', gridTemplateColumns: CS_GRID, alignItems: 'center', padding: '16px 28px', borderBottom: `1px solid ${C.bRow}`, opacity: isDim ? 0.5 : 1, transition: 'background .12s' }}>
      <div>{canConnect ? <CsCheckbox checked={checked} onChange={onToggle} /> : null}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, background: known ? C.fillKnown : C.fillUnknown, color: known ? C.green : C.label }}>
          {known ? CS_ICONS.host : (numeric ? CS_ICONS.ip : CS_ICONS.host)}
        </span>
        <span style={{ font: `600 14.5px ${FONT}`, color: C.ink }}>{nm}</span>
      </div>
      <div style={{ font: `500 13.5px ${MONO}`, color: C.mono, letterSpacing: '-.01em' }}>{d.ip_address}</div>
      <div>
        <span style={{ display: 'inline-block', font: `500 12.5px ${FONT}`, padding: '4px 11px', borderRadius: 7, color: known ? C.green : C.faint, background: known ? C.fillKnown : C.fillNeutral }}>{typeText}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: `500 13.5px ${FONT}`, color: isDim ? C.dimDate : C.muted2, whiteSpace: 'nowrap' }}>{d.last_seen_at ? fmt(d.last_seen_at) : '—'}</span>
        {d.last_seen_run_id ? <span style={{ font: `500 11.5px ${MONO}`, color: C.faint }}>run #{d.last_seen_run_id}</span> : null}
      </div>
      <div>
        {inInv ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: `500 13px ${FONT}`, color: C.green, background: C.fillKnown, padding: '5px 11px', borderRadius: 99 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green }} />{d.connected ? 'In inventory · connected' : 'In inventory'}
          </span>
        ) : inReview ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: `500 13px ${FONT}`, color: '#2b5c9b', background: '#e7ecf4', padding: '5px 11px', borderRadius: 99 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2b5c9b' }} />Needs review
          </span>
        ) : connectable ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: `500 13px ${FONT}`, color: C.amberText, background: C.amberFill, padding: '5px 11px', borderRadius: 99 }} title={d.attempt?.detail || 'WinRM/SSH is open — a login should connect.'}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.amber }} />{d.attempt?.label || 'Ready · needs login'}
          </span>
        ) : attemptable ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: `500 13px ${FONT}`, color: C.amberText, background: C.amberFill, padding: '5px 11px', borderRadius: 99 }} title="Recognised host, but WinRM/SSH wasn't seen open in the scan. You can still tick it and try your login — it connects if remote login is reachable, or reports 'unreachable' (a connection error, NOT a bad-password lockout) if it's off.">
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.amber }} />{noLoginReason}
          </span>
        ) : identified ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: `500 13px ${FONT}`, color: C.faint, background: C.fillNeutral, padding: '5px 11px', borderRadius: 99 }} title="Not a host we can log into (phone / printer / etc.). Adopt it as an evidence-only asset.">
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.faint }} />No login service
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: `500 13px ${FONT}`, color: C.faint, background: C.fillNeutral, padding: '5px 11px', borderRadius: 99 }} title="Only an IP and MAC were seen — no service answered. Adopt it from the Inbox to track it as an unmanaged asset.">
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.faint }} />Silent · IP only
          </span>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        {inInv ? (
          <a href={`/assets/${d.asset_id}`} style={{ font: `600 13.5px ${FONT}`, color: C.green }}>View</a>
        ) : inReview ? (
          <span style={{ font: `500 12.5px ${FONT}`, color: C.muted }}>Resolve in Inbox</span>
        ) : !attemptable ? (
          <button onClick={() => onAdopt?.(d.observation_id)} disabled={adopting || !d.observation_id}
            title="Bring this in as an unmanaged, evidence-only asset (IP/MAC/vendor/type). No login required."
            style={{ border: `1px solid ${C.bInput}`, background: '#fff', color: C.green, font: `600 13px ${FONT}`, padding: '8px 18px', borderRadius: 99, cursor: adopting ? 'default' : 'pointer' }}>
            {adopting ? 'Adopting…' : 'Adopt'}
          </button>
        ) : (
          <button onClick={onConnect} disabled={!canConnect}
            style={{ border: 'none', color: '#fff', font: `600 13.5px ${FONT}`, padding: '9px 20px', borderRadius: 99, background: canConnect ? C.teal : C.tealDim, cursor: canConnect ? 'pointer' : 'default' }}>Connect</button>
        )}
      </div>
    </div>
  );
}

function DiscoveredQueue() {
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedCreds, setSelectedCreds] = useState<Set<number>>(new Set());  // logins to try; empty = auto
  const toggleCred = (id: number) => setSelectedCreds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [search, setSearch] = useState('');
  const [ftype, setFtype] = useState('');
  const [fstatus, setFstatus] = useState('');
  const [runFilter, setRunFilter] = useState<number | undefined>(undefined);
  const [openFor, setOpenFor] = useState<number | null>(null);
  const didInit = useRef(false);
  const creds = useQuery({ queryKey: ['disc-creds'], queryFn: async () => (await discoveryApi.listCredentials()).data.credentials as any[] });
  const hostCreds = (creds.data ?? []).filter((c: any) => c.kind === 'winrm' || c.kind === 'ssh');
  const q = useQuery({
    queryKey: ['disc-discovered-devices', runFilter ?? 'all'],
    queryFn: async () => (await discoveryApi.discoveredDevices(runFilter)).data as {
      devices: any[]; runs: { run_id: number; device_count: number; finished_at: string | null; is_latest: boolean }[];
      latest_run_id: number | null;
    },
    refetchInterval: connecting ? 3000 : false,
  });
  const devices = q.data?.devices ?? [];
  const runs = q.data?.runs ?? [];
  // Three honest tiers for a discovered, not-yet-inventoried device:
  //  • connectable — the login port (WinRM 5985/6 or SSH 22) is confirmed open,
  //    so Connect-all can actually log in. (Backend `connectable`, not a type guess.)
  //  • identified  — we know what it is (Windows/Mac/printer/etc.) but no login
  //    service is reachable (e.g. Windows with WinRM off) → adopt, don't connect.
  //  • silent      — IP + MAC only, nothing to log into → adopt / SNMP.
  // Prefer the backend's reachability truth (`connectable` = login port confirmed
  // open). If that field is absent — e.g. the backend hasn't been restarted after
  // an upgrade — fall back to the port-type signal so the page degrades to the
  // old behaviour instead of hard-zeroing every device to "not connectable".
  // `connectable` = the login port (WinRM 5985/6 or SSH 22) was CONFIRMED open by
  // the sweep — a login will very likely succeed right now.
  const connOf = (d: any) => d.connectable === true;
  // `attemptable` = an OS we can drive a host login against (Windows→WinRM,
  // Linux→SSH), EVEN IF the sweep didn't see the port open. A shared / domain
  // credential may still reach a box whose WinRM the scan couldn't confirm; the
  // attempt fast-fails as "unreachable" (a connection error, NOT a bad password —
  // so it can't trip account lockout) when WinRM really is off. THIS is what makes
  // every Windows / Linux box selectable to try, instead of only the confirmed ones.
  const attemptOf = (d: any) => d.transport === 'windows' || d.transport === 'linux'
    || (d.service_suggestions || []).length > 0;   // typed service door (Postgres/LDAP/K8s…)
  const nonTerminal = (d: any) => !d.in_inventory && d.resolution !== 'review';
  const isIdentified = (d: any) => !attemptOf(d) && (!!d.device_type || !!d.os_guess || !!d.host_name);
  const cConnectable = devices.filter((d) => nonTerminal(d) && connOf(d)).length;   // WinRM/SSH confirmed open
  const cAttempt = devices.filter((d) => nonTerminal(d) && attemptOf(d)).length;    // Windows/Linux we can try
  const cIdentified = devices.filter((d) => nonTerminal(d) && isIdentified(d)).length;
  const cSilent = devices.filter((d) => nonTerminal(d) && !attemptOf(d) && !isIdentified(d)).length;
  const cInv = devices.filter((d) => d.in_inventory).length;
  const cReview = devices.filter((d) => !d.in_inventory && d.resolution === 'review').length;
  const pending = cAttempt;   // Connect-all now acts on every attemptable host
  // Land on the latest run by default (matches Scan history) instead of the
  // all-runs union, which mixes older scans and confuses the count.
  useEffect(() => {
    if (!didInit.current && runFilter === undefined && q.data?.latest_run_id) {
      didInit.current = true;
      setRunFilter(q.data.latest_run_id);
    }
  }, [q.data, runFilter]);
  const toggleSel = (id: number) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const runConnect = useMutation({
    mutationFn: (v: { ids: number[]; credIds: number[] }) => discoveryApi.connectSelected(v.ids, v.credIds.length ? v.credIds : null),
    onSuccess: () => { setSelected(new Set()); setConnecting(true); setTimeout(() => setConnecting(false), 90000); },
  });
  // A device we can't log into is NOT abandoned: Adopt brings it in as an
  // UNMANAGED, evidence-only asset (IP/MAC/vendor/type). This is the managed
  // home for the leftover devices — reachable right here, not only in the Inbox.
  const runAdopt = useMutation({
    mutationFn: async (ids: number[]) => {
      // No bulk endpoint yet — resolve each observation as 'adopt' in parallel.
      await Promise.all(ids.map((id) => discoveryApi.resolve(id, 'adopt')));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['disc-discovered-devices'] }); qc.invalidateQueries({ queryKey: ['disc-inbox'] }); },
  });
  useEffect(() => { if (connecting && pending === 0) setConnecting(false); }, [connecting, pending]);

  // ── DHCP name enrichment ──────────────────────────────────────────────────
  // Many devices come back nameless (they don't broadcast NetBIOS/mDNS). Their
  // real names live in the DHCP server's lease table — pull them from the router.
  const [dhcpOpen, setDhcpOpen] = useState(false);
  const namelessCount = devices.filter((d: any) => !d.host_name).length;
  const runDhcp = useMutation({
    mutationFn: (v: { credential_id: number; dhcp_ip: string; source_type: any }) =>
      discoveryApi.dhcpEnrich({ ...v, run_id: runFilter }),
    onSuccess: () => { setDhcpOpen(false); qc.invalidateQueries({ queryKey: ['disc-discovered-devices'] }); },
  });

  const qStatus = (d: any) => d.in_inventory ? 'inventory'
    : d.resolution === 'review' ? 'review'
    : attemptOf(d) ? 'connectable'   // Windows/Linux — selectable to try (WinRM confirmed OR off)
    : isIdentified(d) ? 'identified'
    : 'silent';
  const types = Array.from(new Set(devices.map(discType))).sort();
  const shown = devices.filter((d) => {
    if (fstatus && qStatus(d) !== fstatus) return false;
    if (ftype && discType(d) !== ftype) return false;
    if (search.trim()) {
      const hay = [d.name, d.host_name, d.ip_address, d.vendor, discType(d)].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });
  const selectableIds: number[] = shown.filter((d) => !d.connected && !d.in_inventory && !d.stale && d.resolution !== 'review' && d.observation_id && attemptOf(d)).map((d) => d.observation_id);
  // Non-host devices (phones/printers/silent) that can only be brought in via Adopt.
  const adoptableIds: number[] = shown.filter((d) => nonTerminal(d) && !attemptOf(d) && !d.stale && d.observation_id).map((d) => d.observation_id);
  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const targetIds = selected.size > 0 ? Array.from(selected) : selectableIds;
  const connectLabel = selected.size > 0 ? `Connect ${selected.size} selected` : `Connect all (${selectableIds.length})`;

  return (
    <div style={{ background: C.card, border: `1px solid ${C.bCard}`, borderRadius: 18, overflow: 'hidden', boxShadow: '0 1px 3px rgba(18,53,44,.04)' }}>
      {/* card header */}
      <div style={{ padding: '26px 28px 22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 40, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 style={{ margin: 0, font: `700 21px ${FONT}`, color: C.ink, letterSpacing: '-.01em' }}>Discovered — ready to connect</h1>
          <p style={{ margin: 0, font: `400 13.5px/1.55 ${FONT}`, color: C.muted }}>
            Devices the scan found across every campaign run. Tick any Windows/Linux host and <strong style={{ color: C.green, fontWeight: 600 }}>Connect all</strong> tries your login on the <strong style={{ color: C.green, fontWeight: 600 }}>{cAttempt}</strong> of them. <strong style={{ color: C.green, fontWeight: 600 }}>{cConnectable}</strong> have WinRM/SSH confirmed open (will connect); the rest are attempted too — if remote login is off they report “unreachable” (a connection error, never a bad-password lockout). The other {cIdentified + cSilent} (phones, printers, silent IPs) → <strong style={{ color: C.green, fontWeight: 600 }}>Adopt</strong>. Rows from an older run are dimmed.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 18 }}>
          <CsStat value={devices.length} color={C.teal} label="Discovered" />
          <div style={{ width: 1, alignSelf: 'stretch', background: C.bLine }} />
          <CsStat value={cAttempt} color={C.amber} label="Host logins" />
        </div>
      </div>

      {/* toolbar */}
      <div style={{ padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, background: C.toolbarBg, borderTop: `1px solid ${C.bLine}`, borderBottom: `1px solid ${C.bLine}`, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: 13, color: '#9aa19a', fontSize: 13, pointerEvents: 'none' }}>{CS_ICONS.search}</span>
            <input placeholder="Search device or IP" value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ border: `1px solid ${C.bInput}`, background: '#fff', color: C.ink, font: `500 13.5px ${FONT}`, padding: '10px 15px 10px 34px', borderRadius: 11, width: 220, outline: 'none' }} />
          </div>
          {runs.length > 1 && (
            <CsDropdown minWidth={200}
              value={runFilter != null ? String(runFilter) : ''}
              onChange={(v) => setRunFilter(v ? Number(v) : undefined)}
              options={[
                { value: '', label: 'All runs', sub: `${devices.length} in queue` },
                ...runs.map((r) => ({
                  value: String(r.run_id),
                  label: `${r.is_latest ? 'Latest · ' : ''}Run #${r.run_id}`,
                  sub: `${r.device_count} host${r.device_count === 1 ? '' : 's'} seen${r.finished_at ? ' · ' + fmt(r.finished_at) : ''}`,
                })),
              ]} />
          )}
          <CsDropdown minWidth={140}
            value={ftype} onChange={setFtype}
            options={[{ value: '', label: 'All types' }, ...types.map((t) => ({ value: t, label: t }))]} />
          <CsDropdown minWidth={160}
            value={fstatus} onChange={setFstatus}
            options={[
              { value: '', label: 'Any status', sub: `${devices.length} total` },
              { value: 'connectable', label: 'Windows / Linux (try login)', sub: `${cAttempt}` },
              { value: 'identified', label: 'Other device · no login', sub: `${cIdentified}` },
              { value: 'silent', label: 'Silent · IP only', sub: `${cSilent}` },
              { value: 'inventory', label: 'In inventory', sub: `${cInv}` },
              { value: 'review', label: 'Needs review', sub: `${cReview}` },
            ]} />
          {(ftype || fstatus || search) && (
            <button onClick={() => { setFtype(''); setFstatus(''); setSearch(''); }}
              style={{ border: 'none', background: 'transparent', color: C.link, font: `500 12.5px ${FONT}`, cursor: 'pointer', textDecoration: 'underline' }}>Clear</button>
          )}
          <CsLoginPicker options={hostCreds} selected={selectedCreds} onToggle={toggleCred}
            onToggleAll={(all) => setSelectedCreds(all ? new Set(hostCreds.map((c: any) => c.id)) : new Set())} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Fill the blank device names from the DHCP server's lease table — the
              one unauthenticated way to name devices that don't broadcast NetBIOS. */}
          {namelessCount > 0 && (
            <button onClick={() => setDhcpOpen(true)}
              title="Pull real device names from your DHCP server (router) lease table — names the devices that answered no name probe."
              style={{ border: `1px solid ${C.bInput}`, background: '#fff', color: C.green, font: `600 13.5px ${FONT}`, padding: '11px 18px', borderRadius: 99, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Fill names ({namelessCount})
            </button>
          )}
          {/* The non-connectable leftovers get a first-class bulk action, not just
              a pointer to the Inbox: adopt them as unmanaged evidence-only assets.
              Respects the active filter, so "filter → Silent → Adopt all" works. */}
          {adoptableIds.length > 0 && (
            <button
              onClick={() => { if (window.confirm(`Adopt ${adoptableIds.length} device${adoptableIds.length === 1 ? '' : 's'} as unmanaged, evidence-only assets?\n\nThey enter inventory with IP / MAC / vendor / type — no login, no deep scan. You can Connect them later if you get a credential.`)) runAdopt.mutate(adoptableIds); }}
              disabled={runAdopt.isPending}
              title="Bring the non-connectable devices in as unmanaged, evidence-only assets."
              style={{ border: `1px solid ${C.bInput}`, background: '#fff', color: C.green, font: `600 13.5px ${FONT}`, padding: '11px 20px', borderRadius: 99, cursor: runAdopt.isPending ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
              {runAdopt.isPending ? 'Adopting…' : `Adopt ${adoptableIds.length}`}
            </button>
          )}
          <CsPrimary onClick={() => runConnect.mutate({ ids: targetIds, credIds: Array.from(selectedCreds) })} disabled={connecting || runConnect.isPending || targetIds.length === 0}>
            <span style={{ fontSize: 15 }}>{CS_ICONS.connect}</span>
            <span style={{ whiteSpace: 'nowrap' }}>{connecting || runConnect.isPending ? 'Connecting…' : connectLabel}</span>
          </CsPrimary>
        </div>
      </div>

      <SweepProgress active={connecting} onIdle={() => { setConnecting(false); qc.invalidateQueries({ queryKey: ['disc-discovered-devices'] }); }} />
      {runConnect.isError && <div style={{ padding: '8px 28px', font: `500 12px ${FONT}`, color: '#b3261e', background: C.toolbarBg }}>{(runConnect.error as any)?.response?.data?.detail || 'Could not start connect.'}</div>}
      {runAdopt.isError && <div style={{ padding: '8px 28px', font: `500 12px ${FONT}`, color: '#b3261e', background: C.toolbarBg }}>{(runAdopt.error as any)?.response?.data?.detail || 'Could not adopt one or more devices.'}</div>}

      {/* table header */}
      <div style={{ display: 'grid', gridTemplateColumns: CS_GRID, alignItems: 'center', padding: '12px 28px', background: C.headBg, borderBottom: `1px solid ${C.bLine}`, font: `600 11.5px ${FONT}`, letterSpacing: '.06em', color: C.label, textTransform: 'uppercase' }}>
        <div><CsCheckbox checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(selectableIds))} /></div>
        <div>Device</div><div>IP</div><div>Type</div><div>Last seen</div><div>Status</div><div />
      </div>

      {/* rows */}
      {q.isLoading ? (
        <div style={{ padding: 26, textAlign: 'center', color: C.label, font: `500 13px ${FONT}` }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ padding: 26, textAlign: 'center', color: C.label, font: `500 13px ${FONT}` }}>{devices.length === 0 ? 'Nothing discovered yet — run a Campaign under Discover.' : 'No device matches these filters.'}</div>
      ) : shown.map((d) => (
        <Fragment key={d.observation_id ?? d.asset_id}>
          <CsDeviceRow d={d} checked={selected.has(d.observation_id)} onToggle={() => toggleSel(d.observation_id)}
            onConnect={() => setOpenFor(openFor === d.observation_id ? null : d.observation_id)}
            onAdopt={(id: number) => runAdopt.mutate([id])} adopting={runAdopt.isPending} />
          {openFor === d.observation_id && (
            <div style={{ borderBottom: `1px solid ${C.bRow}` }}>
              <ConnectDeviceForm device={d} onDone={() => { setOpenFor(null); qc.invalidateQueries({ queryKey: ['disc-discovered-devices'] }); }} />
            </div>
          )}
        </Fragment>
      ))}

      {/* footer */}
      <div style={{ padding: '16px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', font: `500 13px ${FONT}`, color: C.muted3 }}>
        <span>Showing {shown.length} of {devices.length} devices</span>
        {runFilter != null && <a onClick={() => setRunFilter(undefined)} style={{ color: C.link, cursor: 'pointer' }}>View all runs →</a>}
      </div>

      {dhcpOpen && (
        <DhcpEnrichModal
          creds={creds.data ?? []}
          nameless={namelessCount}
          pending={runDhcp.isPending}
          error={(runDhcp.error as any)?.response?.data?.detail || (runDhcp.isError ? 'Enrichment failed — check the router IP, source type and credential.' : null)}
          onClose={() => setDhcpOpen(false)}
          onRun={(v: any) => runDhcp.mutate(v)}
        />
      )}
    </div>
  );
}

// Pull real device names from the DHCP server's lease table — the only
// unauthenticated way to name devices that don't broadcast NetBIOS/mDNS.
function DhcpEnrichModal({ creds, nameless, pending, error, onClose, onRun }: any) {
  const [ip, setIp] = useState('');
  const [srcType, setSrcType] = useState<'mikrotik' | 'dnsmasq' | 'isc' | 'windows'>('mikrotik');
  const [credId, setCredId] = useState<number | ''>('');
  const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: C.muted2, display: 'block', marginBottom: 5 };
  const input: React.CSSProperties = { width: '100%', border: `1px solid ${C.bInput}`, background: '#fff', color: C.ink, font: `500 13.5px ${FONT}`, padding: '10px 13px', borderRadius: 10, outline: 'none' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 20px 60px rgba(18,45,36,0.35)' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.bLine}` }}>
          <div style={{ font: `700 16px ${FONT}`, color: C.ink }}>Fill names from DHCP</div>
          <div style={{ font: `400 12.5px ${FONT}`, color: C.faint, marginTop: 3, lineHeight: 1.5 }}>
            {nameless} device{nameless === 1 ? '' : 's'} answered no name probe. Your DHCP server (router) knows their names from the lease table — read it with a saved login.
          </div>
        </div>
        <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><label style={label}>DHCP server IP (your router)</label><input style={input} value={ip} onChange={(e) => setIp(e.target.value)} placeholder="10.11.10.1" /></div>
          <div>
            <label style={label}>Source type</label>
            <CsDropdown minWidth={220} value={srcType} onChange={(v) => setSrcType(v as any)}
              options={[
                { value: 'mikrotik', label: 'MikroTik (RouterOS)' },
                { value: 'dnsmasq', label: 'dnsmasq' },
                { value: 'isc', label: 'ISC dhcpd' },
                { value: 'windows', label: 'Windows DHCP' },
              ]} />
          </div>
          <div>
            <label style={label}>Login for the DHCP server</label>
            <CsDropdown minWidth={220} value={credId !== '' ? String(credId) : ''} onChange={(v) => setCredId(v ? Number(v) : '')}
              placeholder="Choose a saved login…"
              options={(creds || []).map((c: any) => ({ value: String(c.id), label: `${c.name} · ${c.kind}` }))} />
            {(creds || []).length === 0 && <div style={{ font: `400 11.5px ${FONT}`, color: C.amberText, marginTop: 6 }}>No saved logins yet — add one under Add connection first.</div>}
          </div>
          {error && <div style={{ font: `500 12px ${FONT}`, color: '#b3261e' }}>{error}</div>}
        </div>
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${C.bLine}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ border: `1px solid ${C.bInput}`, background: '#fff', color: C.muted, font: `600 13px ${FONT}`, padding: '9px 18px', borderRadius: 99, cursor: 'pointer' }}>Cancel</button>
          <CsPrimary onClick={() => onRun({ credential_id: Number(credId), dhcp_ip: ip.trim(), source_type: srcType })} disabled={pending || !ip.trim() || credId === ''}>
            <span style={{ whiteSpace: 'nowrap' }}>{pending ? 'Reading lease table…' : 'Fill names'}</span>
          </CsPrimary>
        </div>
      </div>
    </div>
  );
}

// Unified "Add connection" popup. Step 1 asks Agent vs Agentless; step 2 shows
// the right onboarding UI. It REUSES the already-working wizard (agentless — every
// target type, hosts included) and the agent page (installers) so every path is
// functional, rather than re-implementing a dozen forms.
function AddConnectionModal({ onClose }: { onClose: () => void }) {
  const [method, setMethod] = useState<'agent' | 'agentless' | null>(null);
  const [ptype, setPtype] = useState<Platform | ''>('');
  const back = () => { if (ptype) setPtype(''); else setMethod(null); };
  const choice = (id: 'agent' | 'agentless', title: string, desc: string, comingSoon = false) => (
    <button onClick={comingSoon ? undefined : () => setMethod(id)} disabled={comingSoon}
      title={comingSoon ? 'The signed endpoint-agent installer is still in progress.' : undefined}
      style={{
        flex: 1, minWidth: 250, textAlign: 'left', cursor: comingSoon ? 'not-allowed' : 'pointer',
        border: '1px solid var(--as-border)', borderRadius: 12, background: 'var(--as-subtle)', padding: '18px 20px',
        opacity: comingSoon ? 0.55 : 1,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--as-ink)' }}>{title}</span>
        {comingSoon && (
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
            color: 'var(--as-faint)', background: 'var(--as-border)', padding: '2px 8px', borderRadius: 99 }}>Coming soon</span>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--as-faint)', lineHeight: 1.5 }}>{desc}</div>
    </button>
  );
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div className="as-card" onClick={(e) => e.stopPropagation()} style={{
        padding: 0, width: '100%', maxWidth: 1080, maxHeight: '92vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '15px 20px', borderBottom: '1px solid var(--as-border)', flex: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {method !== null && (
              <button className="as-btn as-btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={back}>← Back</button>
            )}
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--as-ink)', margin: 0 }}>
              Add connection{method === 'agentless' ? ' · Agentless' : method === 'agent' ? ' · Agent' : ''}
            </h2>
          </div>
          <button onClick={onClose} className="as-btn as-btn-secondary" style={{ padding: '4px 8px' }}><X size={14} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {method === null && (
            <div style={{ padding: '22px 24px' }}>
              <p style={{ fontSize: 13.5, color: 'var(--as-secondary)', marginTop: 0, marginBottom: 16 }}>How do you want to connect?</p>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {choice('agentless', 'Agentless', 'Connect with a login — nothing installed on the target. Windows · Linux · database · cloud · network device · Active Directory.')}
                {choice('agent', 'Agent', "Install a small program on the machine — for endpoints you can't reach inbound: roaming laptops, NAT'd or firewalled boxes.")}
              </div>
            </div>
          )}
          {method === 'agentless' && (
            <div style={{ padding: '22px 24px' }}>
              <label htmlFor="ac-type" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--as-ink)', marginBottom: 6 }}>
                What are you connecting?
              </label>
              <select id="ac-type" className="as-input" style={{ maxWidth: 420 }}
                value={ptype} onChange={(e) => setPtype(e.target.value as Platform | '')}>
                <option value="">Select a type…</option>
                {PLATFORM_GROUPS.map((g) => (
                  <optgroup key={g.key} label={g.title}>
                    {g.ids.map((id) => {
                      const p = PLATFORMS.find((x) => x.id === id);
                      return p ? <option key={id} value={id}>{p.logo} {p.label}</option> : null;
                    })}
                  </optgroup>
                ))}
              </select>
              {!ptype && (
                <p style={{ fontSize: 12, color: 'var(--as-faint)', marginTop: 8, maxWidth: 620, lineHeight: 1.6 }}>
                  Windows and Linux ask only for a login — discovery already found the devices, so it is
                  applied to them. Databases, cloud accounts and network devices are named individually,
                  because a network sweep can&apos;t find them.
                </p>
              )}
              {(ptype === 'windows' || ptype === 'linux') && (
                <div style={{ marginTop: 18 }}>
                  <HostLoginForm platform={ptype} onSaved={() => { /* stays open — success panel offers the sweep */ }} />
                </div>
              )}
              {ptype && ptype !== 'windows' && ptype !== 'linux' && (
                <div style={{ marginTop: 6, marginLeft: -24, marginRight: -24 }}>
                  <ConnectWizardPage embedded initialPlatform={ptype} />
                </div>
              )}
            </div>
          )}
          {method === 'agent' && <AgentsAdminPage />}
        </div>
      </div>
    </div>
  );
}

// The "Discover & Connect" tab body: a 2-way toggle. Click Discover → only the
// find-a-network flow (Campaigns + the Host login it uses). Click Connect → only
// the onboard-other-targets flow (agents + agentless wizard). Overview, Inbox and
// Scan history stay as their own top-level tabs.
function DiscoverConnect() {
  const [sub, setSub] = useState<'discover' | 'connect'>('discover');
  const [showAdd, setShowAdd] = useState(false);
  // Within Connect: operational view (devices + logins-to-try) vs the saved-login
  // management table. Keeps the screen from spreading into stacked cards.
  const [connectView, setConnectView] = useState<'devices' | 'logins'>('devices');
  const SUBS: { id: 'discover' | 'connect'; label: string; icon: any }[] = [
    { id: 'discover', label: 'Discover', icon: Network },
    { id: 'connect',  label: 'Connect',  icon: Plug },
  ];
  const devQ = useQuery({ queryKey: ['disc-discovered-devices', 'all'], queryFn: async () => (await discoveryApi.discoveredDevices()).data as any });
  const credQ = useQuery({ queryKey: ['disc-creds'], queryFn: async () => (await discoveryApi.listCredentials()).data.credentials as any[] });
  const readyCount = (devQ.data?.devices ?? []).filter((d: any) => !d.asset_id).length;
  const savedCount = (credQ.data ?? []).length;
  return (
    <div>
      {/* Header row: mode toggle (white pill) + Add connection. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: `1px solid ${C.bToggle}`, borderRadius: 14, padding: 5 }}>
          {SUBS.map((s) => {
            const on = s.id === sub;
            const icon = s.id === 'discover' ? CS_ICONS.discover : CS_ICONS.connect;
            return (
              <button key={s.id} onClick={() => setSub(s.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, border: 'none', cursor: 'pointer', font: `600 14px ${FONT}`,
                  padding: '9px 18px', borderRadius: 10,
                  color: on ? '#fff' : C.muted2, background: on ? C.green : 'transparent',
                  boxShadow: on ? '0 1px 2px rgba(13,92,72,.3)' : 'none',
                }}>
                <span style={{ fontSize: 15 }}>{icon}</span><span>{s.label}</span>
              </button>
            );
          })}
        </div>
        {sub === 'connect' && (
          <CsPrimary onClick={() => setShowAdd(true)} style={{ boxShadow: '0 2px 8px rgba(18,184,134,.32)', padding: '12px 20px' }}>
            <span style={{ fontSize: 17, lineHeight: 1 }}>{CS_ICONS.add}</span>
            <span style={{ whiteSpace: 'nowrap' }}>Add connection</span>
          </CsPrimary>
        )}
      </div>

      {sub === 'discover' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ fontSize: 12.5, color: 'var(--as-faint)', margin: 0, maxWidth: 730 }}>
            <strong>Find devices on a network.</strong> A Campaign scans an IP range and lists every device on it.
            Found devices land in <strong>Scan history</strong> and in the <strong>Connect</strong> queue as
            unprofiled entries — give them a login over there and they are read and populated into IT Asset Inventory.
          </p>
          <Campaigns />
        </div>
      )}

      {sub === 'connect' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* Sub-tabs: underline style with count chips (design handoff). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 28, borderBottom: '1px solid #dddbd2' }}>
            {([['devices', 'Ready to connect', readyCount], ['logins', 'Saved logins', savedCount]] as const).map(([id, label, count]) => {
              const on = connectView === id;
              return (
                <button key={id} onClick={() => setConnectView(id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, border: 'none', background: 'transparent',
                    color: on ? '#0d5c48' : '#7a8a84', fontSize: 14, fontWeight: on ? 600 : 500, padding: '0 2px 14px',
                    borderBottom: on ? '2.5px solid #0d5c48' : '2.5px solid transparent', marginBottom: -1, cursor: 'pointer' }}>
                  {label}
                  <span style={{ background: on ? '#0d5c48' : '#e6e4db', color: on ? '#fff' : '#5f6f69', borderRadius: 99, padding: '2px 9px', fontSize: 12, fontWeight: 600 }}>{count}</span>
                </button>
              );
            })}
          </div>
          {connectView === 'devices' && <DiscoveredQueue />}
          {connectView === 'logins' && <Credentials />}
        </div>
      )}
      {showAdd && <AddConnectionModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

export default function AssetDiscoveryPage() {
  const [tab, setTab] = useTabParam<Tab>('pipeline', TABS.map((t) => t.id));
  return (
    <div className="asset-suite discovery-suite as-fadeup" style={{ padding: '4px 2px' }}>
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

      {tab === 'overview' && <Overview go={() => setTab('runs')} />}

      {tab === 'pipeline' && <DiscoverConnect />}

      {tab === 'inbox' && <InboxView />}
      {tab === 'runs' && <Runs />}
    </div>
  );
}
