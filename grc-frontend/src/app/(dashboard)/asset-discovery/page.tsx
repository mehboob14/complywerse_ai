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
                        {/* No "Adopt". A device cannot be promoted straight into
                            inventory — it earns a row by accepting a login, which
                            happens under Connect. The backend rejects adopt too. */}
                        <button className="as-btn as-btn-secondary" style={{ padding: '4px 9px', fontSize: 11.5 }}
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
  );
}

/* ─── Scan history ─────────────────────────────────────────────────── */

// The devices a single run found — shown when a Scan history row is expanded.
function RunDevices({ runId }: { runId: number }) {
  const q = useQuery({
    queryKey: ['disc-run-obs', runId],
    queryFn: async () => (await discoveryApi.runObservations(runId)).data.observations as any[],
  });
  const pad: React.CSSProperties = { padding: '12px 16px' };
  if (q.isLoading) return <div style={{ ...pad, fontSize: 12.5, color: 'var(--as-faint)' }}>Loading devices…</div>;
  const obs = q.data ?? [];
  if (!obs.length) return <div style={{ ...pad, fontSize: 12.5, color: 'var(--as-faint)' }}>No devices recorded for this run.</div>;

  const kind = (ports: number[]): string => {
    if (ports.includes(445) || ports.includes(3389)) return 'Windows';
    if (ports.includes(22)) return 'Linux / SSH';
    return ports.length ? 'Other' : '—';
  };
  const RES: Record<string, string> = {
    created: 'New asset', merged: 'Updated', review: 'Needs review',
    ignored: 'Ignored', pending: 'Pending',
  };
  return (
    <div style={{ background: 'var(--as-subtle)', padding: '4px 8px 10px' }}>
      <div style={{ fontSize: 11.5, color: 'var(--as-faint)', padding: '6px 8px 8px' }}>
        {obs.length} device{obs.length === 1 ? '' : 's'} found by this scan
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead><tr>{['IP', 'Name', 'Type', 'Open ports', 'Result'].map((h) => (
          <th key={h} style={{ ...th, background: 'transparent' }}>{h}</th>
        ))}</tr></thead>
        <tbody>
          {obs.map((o) => {
            const ports: number[] = (o.raw && o.raw.open_ports) || [];
            return (
              <tr key={o.id}>
                <td className="as-mono" style={{ ...td, color: 'var(--as-ink)' }}>{o.ip_address}</td>
                <td style={td}>{o.asset_name || o.host_name || <span style={{ color: 'var(--as-faint)' }}>—</span>}</td>
                <td style={td}>{o.asset_os_family
                  ? <span style={{ textTransform: 'capitalize' }}>{o.asset_os_family}</span>
                  : kind(ports)}</td>
                <td className="as-mono" style={td}>{ports.join(', ') || '—'}</td>
                <td style={td}>
                  {o.resolved_asset_id
                    ? <a href={`/assets/${o.resolved_asset_id}`} style={{ color: 'var(--as-blue)', fontWeight: 600 }}>
                        {RES[o.resolution] || o.resolution} · #{o.resolved_asset_id}
                      </a>
                    : (RES[o.resolution] || o.resolution)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
function Credentials() {
  const qc = useQueryClient();
  const creds = useQuery({ queryKey: ['disc-creds'], queryFn: async () => (await discoveryApi.listCredentials()).data.credentials as any[] });
  const refresh = () => qc.invalidateQueries({ queryKey: ['disc-creds'] });
  const del = useMutation({ mutationFn: (id: number) => discoveryApi.deleteCredential(id), onSuccess: refresh });
  const list = creds.data ?? [];

  return (
    <div className="as-card" style={{ padding: '18px 20px' }}>
      <SectionHead title="Saved logins"
        note="Every login discovery can use, and which devices each one covers. Add one with ＋ Add connection → Agentless. Secrets are encrypted and never shown again." />

      {creds.isLoading ? <Empty text="Loading…" /> : list.length === 0 ? (
        <Empty text="No logins yet." hint="Without one, discovery still finds devices — it just can't read their OS, software or hardware, so they stay unprofiled." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
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
  const [f, setF] = useState({ username: '', password: '', domain: '' });
  const [err, setErr] = useState<string | null>(null);
  const isWin = device.transport === 'windows';
  const m = useMutation({
    // Already in inventory → re-collect onto that asset. Not yet → promote the
    // observation, which only creates the asset if the login succeeds.
    mutationFn: () => device.asset_id
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
        {' · '}{isWin ? 'WinRM (Windows)' : 'SSH (Linux)'} <span style={{ color: 'var(--as-faint)' }}>— pre-filled from the scan</span>
      </div>
      {!device.asset_id && (
        <div style={{ fontSize: 11.5, color: 'var(--as-faint)', marginBottom: 10, maxWidth: 620, lineHeight: 1.5 }}>
          This device is not in IT Asset Inventory yet. If the login works it is scanned in depth and
          added with its OS, hardware and software. If it fails, nothing is added.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <div><label style={label}>Username</label><input className="as-input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder={isWin ? 'Administrator' : 'root'} /></div>
        <div><label style={label}>Password</label><input className="as-input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        {isWin && <div><label style={label}>Domain (optional)</label><input className="as-input" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder={device.host_name || 'CORP'} /></div>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="as-btn as-btn-primary" disabled={!f.username || !f.password || m.isPending} onClick={() => { setErr(null); m.mutate(); }}>
          {m.isPending ? 'Connecting…' : 'Approve & connect'}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--as-faint)' }}>Saves a login for this one host and reads its OS + software.</span>
        {err && <span style={{ fontSize: 12, color: 'var(--as-danger-text)' }}>{err}</span>}
      </div>
    </div>
  );
}

// The review-and-approve queue: every device discovery found, with IP + type
// pre-filled. Approve one → it's profiled. This is the discovery-driven Connect.
function DiscoveredQueue() {
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  // Run filter. undefined = full backlog (every unclaimed device across all
  // runs); a number scopes the queue AND Connect-all to that one run.
  const [runFilter, setRunFilter] = useState<number | undefined>(undefined);
  const q = useQuery({
    queryKey: ['disc-discovered-devices', runFilter ?? 'all'],
    queryFn: async () => (await discoveryApi.discoveredDevices(runFilter)).data as {
      devices: any[]; runs: { run_id: number; device_count: number; finished_at: string | null; is_latest: boolean }[];
      latest_run_id: number | null;
    },
    refetchInterval: connecting ? 3000 : false,
  });
  const [openFor, setOpenFor] = useState<number | null>(null);
  const devices = q.data?.devices ?? [];
  const runs = q.data?.runs ?? [];
  // Found but not yet in inventory — the queue's actual backlog.
  const pending = devices.filter((d) => !d.asset_id).length;
  const typeLabel = (t: string | null) => t === 'windows' ? 'Windows' : t === 'linux' ? 'Linux' : '—';
  const connectAll = useMutation({
    mutationFn: () => discoveryApi.connectAllDiscovered(undefined, runFilter),
    onSuccess: () => { setConnecting(true); setTimeout(() => setConnecting(false), 90000); },
  });
  const disconnect = useMutation({
    mutationFn: (assetId: number) => discoveryApi.disconnectDevice(assetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['disc-discovered-devices'] });
      qc.invalidateQueries({ queryKey: ['disc-creds'] });
    },
  });
  useEffect(() => { if (connecting && pending === 0) setConnecting(false); }, [connecting, pending]);
  return (
    <div className="as-card" style={{ padding: '18px 20px' }}>
      <SectionHead title="Discovered — ready to connect"
        note="Devices the scan found, across every campaign run. Add a login with ＋ Add connection → Agentless, then hit Connect all — it tries that login on the devices shown and profiles the ones that accept it. Use the run filter to work just the latest scan; devices last seen in an older run are dimmed (that machine may have been off since)."
        right={(
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {runs.length > 1 && (
              <select className="as-input" style={{ padding: '6px 10px', fontSize: 12 }}
                value={runFilter ?? ''} onChange={(e) => setRunFilter(e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">All runs ({runs.reduce((a, r) => a + r.device_count, 0)})</option>
                {runs.map((r) => (
                  <option key={r.run_id} value={r.run_id}>
                    Run #{r.run_id}{r.is_latest ? ' (latest)' : ''} — {r.device_count}
                    {r.finished_at ? ` · ${fmt(r.finished_at)}` : ''}
                  </option>
                ))}
              </select>
            )}
            {pending > 0 && (
              <button className="as-btn as-btn-primary" disabled={connecting || connectAll.isPending}
                onClick={() => connectAll.mutate()}
                title={runFilter ? `Try your saved login on run #${runFilter}'s devices` : 'Try your saved login on every discovered device'}>
                {connecting ? 'Connecting…' : `Connect all (${pending})`}
              </button>
            )}
          </div>
        )} />
      <SweepProgress active={connecting} onIdle={() => {
        setConnecting(false);
        qc.invalidateQueries({ queryKey: ['disc-discovered-devices'] });
      }} />
      {connectAll.isError && <p style={{ fontSize: 12, color: 'var(--as-danger-text)', margin: '6px 0 0' }}>{(connectAll.error as any)?.response?.data?.detail || 'Could not start bulk connect.'}</p>}
      {q.isLoading ? <Empty text="Loading…" /> : devices.length === 0 ? (
        <Empty text="Nothing discovered yet." hint="Run a Campaign under the Discover tab first." />
      ) : (
        <>
          <div style={{ fontSize: 12, color: 'var(--as-faint)', margin: '2px 0 12px' }}>
            {devices.length} discovered · {pending} still need a login
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['Device', 'IP', 'Type', 'Last seen', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {devices.map((d) => (
                  <Fragment key={d.observation_id ?? d.asset_id}>
                    <tr style={d.stale ? { opacity: 0.55 } : undefined}
                      title={d.stale ? 'Not seen in the latest scan — this machine may have been powered off since.' : undefined}>
                      <td style={{ ...td, fontWeight: 600, color: 'var(--as-ink)' }}>{d.name || d.host_name || d.ip_address}</td>
                      <td className="as-mono" style={td}>{d.ip_address}</td>
                      <td style={td}>{typeLabel(d.transport)}</td>
                      <td style={td}>
                        <span style={{ fontSize: 11.5, color: d.stale ? 'var(--as-danger-text)' : 'var(--as-faint)' }}>
                          {d.last_seen_at ? fmt(d.last_seen_at) : '—'}
                          {d.last_seen_run_id ? <span style={{ marginLeft: 5, color: 'var(--as-faint)' }}>run #{d.last_seen_run_id}</span> : null}
                        </span>
                      </td>
                      <td style={td}>
                        {d.connected
                          ? <span className="as-pill" style={{ background: 'var(--as-good-bg)', color: 'var(--as-good)' }}>In inventory</span>
                          : d.profiled
                            ? <span style={{ color: 'var(--as-secondary)' }}>In inventory · login revoked</span>
                            : d.attempt
                              // The reason, not silence — and each code implies a
                              // different fix, so they must not read alike.
                              ? <span title={d.attempt.detail}
                                  style={{ color: d.attempt.code === 'rejected' ? 'var(--as-danger-text)' : 'var(--as-blue)' }}>
                                  {d.attempt.label}
                                </span>
                              : <span style={{ color: 'var(--as-faint)' }}>Needs login</span>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {d.asset_id && (
                            <a href={`/assets/${d.asset_id}`} className="as-btn as-btn-secondary" style={{ padding: '4px 9px', fontSize: 11.5 }}>View</a>
                          )}
                          {d.connected ? (
                            <button className="as-btn as-btn-secondary" style={{ padding: '4px 9px', fontSize: 11.5 }}
                              disabled={disconnect.isPending}
                              onClick={() => {
                                if (confirm(`Disconnect ${d.name || d.ip_address}?\n\nThe login for this device is revoked and it becomes connectable again. Everything already collected (OS, hardware, software) is kept.`)) {
                                  disconnect.mutate(d.asset_id);
                                }
                              }}>
                              Disconnect
                            </button>
                          ) : (
                            <button className="as-btn as-btn-primary" style={{ padding: '4px 9px', fontSize: 11.5 }}
                              onClick={() => setOpenFor(openFor === d.observation_id ? null : d.observation_id)}>
                              {openFor === d.observation_id ? 'Cancel' : d.asset_id ? 'Reconnect' : 'Connect'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {openFor === d.observation_id && (
                      <tr>
                        <td colSpan={6} style={{ padding: 0 }}>
                          <ConnectDeviceForm device={d} onDone={() => { setOpenFor(null); qc.invalidateQueries({ queryKey: ['disc-discovered-devices'] }); }} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
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
  const choice = (id: 'agent' | 'agentless', title: string, desc: string) => (
    <button onClick={() => setMethod(id)}
      style={{
        flex: 1, minWidth: 250, textAlign: 'left', cursor: 'pointer',
        border: '1px solid var(--as-border)', borderRadius: 12, background: 'var(--as-subtle)', padding: '18px 20px',
      }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--as-ink)', marginBottom: 5 }}>{title}</div>
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
  const SUBS: { id: 'discover' | 'connect'; label: string; icon: any }[] = [
    { id: 'discover', label: 'Discover', icon: Network },
    { id: 'connect',  label: 'Connect',  icon: Plug },
  ];
  return (
    <div>
      <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'var(--as-subtle)', border: '1px solid var(--as-border)', borderRadius: 10, marginBottom: 18 }}>
        {SUBS.map((s) => {
          const on = s.id === sub;
          const Icon = s.icon;
          return (
            <button key={s.id} onClick={() => setSub(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '8px 18px', fontSize: 13,
                fontWeight: on ? 700 : 500, color: on ? '#fff' : 'var(--as-muted)',
                background: on ? 'var(--as-green)' : 'transparent', border: 'none', borderRadius: 8, cursor: 'pointer',
              }}>
              <Icon size={15} />{s.label}
            </button>
          );
        })}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Discovery-driven: approve the devices the scan already found. */}
          <DiscoveredQueue />
          {/* ONE entry point for everything else — a popup that first asks
              Agent vs Agentless, then the right form per target type. */}
          <div className="as-card" style={{ padding: '20px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--as-ink)' }}>Add a connection</div>
              <div style={{ fontSize: 12.5, color: 'var(--as-faint)', marginTop: 2, maxWidth: 700 }}>
                One popup for every way in. <strong>Agentless → Windows / Linux</strong> is the login discovery
                applies to the devices above. <strong>Agentless → database, cloud, network device or AD</strong>
                {' '}covers what a sweep can&apos;t find. <strong>Agent</strong> is for machines you can&apos;t reach inbound.
              </div>
            </div>
            <button className="as-btn as-btn-primary" style={{ whiteSpace: 'nowrap' }} onClick={() => setShowAdd(true)}>
              <Plus size={14} style={{ marginRight: 6, verticalAlign: -2 }} />Add connection
            </button>
          </div>
          <Credentials />
        </div>
      )}
      {showAdd && <AddConnectionModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

export default function AssetDiscoveryPage() {
  const [tab, setTab] = useTabParam<Tab>('pipeline', TABS.map((t) => t.id));
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

      {tab === 'overview' && <Overview go={() => setTab('runs')} />}

      {tab === 'pipeline' && <DiscoverConnect />}

      {tab === 'inbox' && <InboxView />}
      {tab === 'runs' && <Runs />}
    </div>
  );
}
