'use client';

/**
 * ScanLauncher — the register's "new scan" action. This is the RICH lane-card launcher recovered
 * from the pre-v2 pentest Hub (git 2bbb1e6) and REPURPOSED for register-owned scanning: its Start
 * calls the register scan endpoints (inventory → POST /vuln-management/assets/{id}/scan; add-target
 * → POST /vuln-management/scan/adhoc) instead of creating a pentest run. Manual lane selection is
 * KEPT (v3) — the chosen engine lane is sent as the `lane` override and honored by the backend.
 *
 * Styling reuses the pentest redesign CSS via a `.ptx` wrapper (same btn/lbl/mono/CSS-var classes).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Globe, Server, KeyRound, Cloud, Code2, Boxes, Radar, Database, X, Check, Loader2, ArrowRight, ShieldCheck } from 'lucide-react';
import { assetsApi, discoveryApi, vulnManagementApi } from '@/cyber-assurance/lib/api';
import '../../pentest/_components/pentest-redesign.css';

type SubLane = { key: string; label: string; Icon: any; fleet: string[]; tools: string };
type TopLane = { key: string; label: string; Icon: any; tools: string; fleet?: string[]; subs?: SubLane[] };
const TOP_LANES: TopLane[] = [
  { key: 'external', label: 'External / Web', Icon: Globe, fleet: ['web'], tools: 'nuclei · nmap · zap' },
  { key: 'host', label: 'Host', Icon: Server, tools: 'nessus · openvas', subs: [
    { key: 'windows', label: 'Windows', Icon: Server, fleet: ['windows'], tools: 'nessus · netexec' },
    { key: 'linux', label: 'Linux', Icon: Server, fleet: ['linux'], tools: 'nessus · openvas' },
    { key: 'network', label: 'Network / Infra', Icon: Radar, fleet: ['network'], tools: 'nmap · openvas' },
  ] },
  { key: 'database', label: 'Database', Icon: Database, fleet: ['database'], tools: 'nessus · openvas' },
  { key: 'ad', label: 'Active Directory', Icon: KeyRound, fleet: ['ad'], tools: 'SPN enum · signing audit' },
  { key: 'cloud', label: 'Cloud (AWS/Azure)', Icon: Cloud, fleet: ['cloud'], tools: 'prowler · steampipe' },
  { key: 'code', label: 'Code / Repo', Icon: Code2, fleet: ['repo'], tools: 'semgrep · trivy · gitleaks' },
  { key: 'container', label: 'Container / K8s', Icon: Boxes, fleet: ['k8s'], tools: 'trivy · kube-hunter' },
];
const LANE_TARGET_HINT: Record<string, { label: string; ph: string }> = {
  external: { label: 'Website, IP or hostname', ph: 'demo.testfire.net, 203.0.113.10 — Enter to add' },
  windows: { label: 'IP or hostname', ph: '10.0.0.5, dc01.internal — Enter to add' },
  linux: { label: 'IP or hostname', ph: '172.17.0.3, host.internal — Enter to add' },
  network: { label: 'IP, hostname or CIDR', ph: '10.0.0.0/24, switch.internal — Enter to add' },
  database: { label: 'IP or hostname', ph: '10.0.0.7, db01.corp.local — Enter to add' },
  ad: { label: 'Domain or DC host', ph: 'dc01.corp.local — Enter to add' },
  cloud: { label: 'Account id or endpoint', ph: 'account / endpoint — Enter to add' },
  code: { label: 'Git repository URL', ph: 'github.com/org/repo — Enter to add' },
  container: { label: 'Image or cluster host', ph: 'image:tag or cluster host — Enter to add' },
};

// Lane (fleet key) → the saved-credential kinds that lane can scan with. Web/K8s scan unauthenticated,
// so they have no credential step. Mirrors the old pentest RunLauncher's laneCredBackendKinds.
const LANE_CRED_KINDS: Record<string, string[]> = {
  windows: ['winrm', 'ssh'], linux: ['ssh'], network: ['ssh', 'winrm'],
  database: ['ssh', 'winrm'], ad: ['winrm', 'ssh'], cloud: ['aws', 'azure', 'gcp'], repo: ['github'],
};

type AssetLite = { id: number; label: string; ip: string | null; type: string | null; fleet_lane: string | null };
type CredLite = { id: number; name: string; kind: string; username?: string };

export default function ScanLauncher({ onClose, onStarted }: {
  onClose: () => void;
  onStarted: (assetId: number, jobId: number) => void;
}) {
  const { data: invAssets } = useQuery<AssetLite[]>({
    queryKey: ['vuln-scan-launch-assets'],
    queryFn: async () => ((await assetsApi.getAll({ limit: 1000 })).data as any[] ?? []).map((a) => ({
      id: a.id, label: a.hostname || a.name || a.ip_address || `Asset ${a.id}`, ip: a.ip_address ?? null,
      type: a.asset_type ?? null, fleet_lane: a.fleet_lane ?? null,
    })),
  });
  const assets = invAssets ?? [];

  const [lane, setLane] = useState('external');
  const [sub, setSub] = useState('windows');
  const [flow, setFlow] = useState<'inventory' | 'target'>('inventory');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [targets, setTargets] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [credId, setCredId] = useState<number | null>(null);
  // Inventory flow: assets the operator UNticked (scan surface-only). Default = use the matched login.
  const [credOff, setCredOff] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const top = TOP_LANES.find((l) => l.key === lane)!;
  const subLane = top.subs ? (top.subs.find((s) => s.key === sub) ?? top.subs[0]) : null;
  const effFleet = subLane ? subLane.fleet : (top.fleet ?? []);   // fleet key sent as the `lane` override
  const effKey = subLane ? subLane.key : top.key;
  const laneName = subLane ? `${top.label} · ${subLane.label}` : top.label;
  const laneOverride = effFleet[0];                               // e.g. 'web' | 'windows' | 'linux' | …
  const pickTop = (k: string) => { setLane(k); setPicked(new Set()); setCredId(null); setCredOff(new Set()); const t = TOP_LANES.find((l) => l.key === k); if (t?.subs) setSub(t.subs[0].key); };
  const pickSub = (k: string) => { setSub(k); setPicked(new Set()); setCredId(null); setCredOff(new Set()); };

  // Credentials — restored from the old pentest RunLauncher: a creds-capable lane (host/cloud/repo)
  // shows the asset's saved logins so one can be ATTACHED to the scan (threaded as credential_id).
  const credKinds = LANE_CRED_KINDS[laneOverride] ?? [];
  const usesCreds = credKinds.length > 0;
  const { data: allCreds = [], isLoading: credsLoading } = useQuery<CredLite[]>({
    queryKey: ['disc-creds'],
    queryFn: async () => ((await discoveryApi.listCredentials()).data?.credentials ?? []) as CredLite[],
    enabled: usesCreds,
  });
  const laneCreds = useMemo(() => allCreds.filter((c) => credKinds.includes(c.kind)), [allCreds, credKinds]);
  const list = useMemo(() => assets.filter((a) => a.fleet_lane && effFleet.includes(a.fleet_lane)), [assets, effFleet]);
  // Per-asset matched login (inventory rows) — each host's OWN CIDR-matched credential, shown inline,
  // so there's no global dropdown to hand-pick: tick a host to scan it with its own login, untick for surface.
  const listIds = useMemo(() => list.map((a) => a.id), [list]);
  const { data: matchedCreds = {} } = useQuery<Record<string, { cred_id: number; cred_name: string; cred_kind: string; cred_username: string }>>({
    queryKey: ['scan-matched-creds', effKey, listIds.join(',')],
    queryFn: async () => (await vulnManagementApi.scan.matchedCredentials(listIds)).data ?? {},
    enabled: flow === 'inventory' && usesCreds && listIds.length > 0,
  });
  const credToggle = (id: number) => setCredOff((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const hint = LANE_TARGET_HINT[effKey] ?? LANE_TARGET_HINT.external;
  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const addTargets = (raw: string) => {
    const parts = raw.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length) setTargets((t) => Array.from(new Set([...t, ...parts])));
    setDraft('');
  };

  const ready = flow === 'target' ? (targets.length > 0 || !!draft.trim()) && authorized : picked.size > 0;
  const start = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      if (flow === 'target') {
        const t = Array.from(new Set([...targets, ...draft.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)]));
        if (!t.length) { setBusy(false); return; }
        let first: { asset_id: number; job_id: number } | null = null;
        for (const target of t) {
          const { data } = await vulnManagementApi.scan.adhoc({ target, authorized, lane: laneOverride, ...(credId ? { credential_id: credId } : {}) });
          if (!first && data?.asset_id && data?.job_id) first = { asset_id: data.asset_id, job_id: data.job_id };
        }
        if (first) onStarted(first.asset_id, first.job_id);
        else onClose();
      } else {
        const ids = Array.from(picked);
        let firstJob: number | null = null;
        for (const id of ids) {
          // Each host uses its OWN matched login when ticked; unticked (or no login) -> surface scan.
          // Agent-managed host -> no credential at all (the agent is inside; it's always a depth scan).
          const mc = matchedCreds[String(id)];
          const isAgent = mc?.cred_kind === 'agent';
          const useCred = usesCreds && !!mc && !isAgent && !credOff.has(id);
          const credArgs = isAgent ? {} : (useCred ? { credential_id: mc.cred_id } : (usesCreds ? { allow_uncredentialed: true } : {}));
          const { data } = await vulnManagementApi.scan.start(id, { lane: laneOverride, ...credArgs });
          if (firstJob == null && data?.job_id) firstJob = data.job_id;
        }
        if (firstJob != null) onStarted(ids[0], firstJob);
        else onClose();
      }
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Failed to start the scan.');
      setBusy(false);
    }
  };

  return (
    <div className="ptx" style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.45)' }} />
      <aside style={{ position: 'relative', width: 'min(560px,100%)', height: '100%', background: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '-10px 0 40px rgba(15,23,42,.2)' }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--line)' }}>
          <div><h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>New scan</h3><div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Pick an engine lane, then the assets or a target to scan. Findings land in the register.</div></div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: 7 }}><X width={16} height={16} /></button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          <div className="lbl" style={{ marginBottom: 8 }}>1 · Engine lane — choose one</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
            {TOP_LANES.map((l) => { const sel = lane === l.key; return (
              <button key={l.key} onClick={() => pickTop(l.key)} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${sel ? 'var(--base)' : 'var(--border)'}`, background: sel ? 'var(--base-soft)' : '#fff', borderRadius: 9, padding: '9px 11px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                <l.Icon width={16} height={16} color={sel ? 'var(--base)' : 'var(--muted)'} />
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 11.5, fontWeight: 600, color: sel ? 'var(--base)' : '#475569' }}>{l.label}{l.subs ? <span style={{ fontWeight: 500, color: 'var(--faint)' }}> ›</span> : null}</div><div className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{l.subs ? l.subs.map((s) => s.label).join(' · ') : l.tools}</div></div>
              </button>
            ); })}
          </div>
          {top.subs && (
            <>
              <div className="lbl" style={{ margin: '14px 0 7px' }}>{top.label} — pick a type</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${top.subs.length},1fr)`, gap: 7 }}>
                {top.subs.map((s) => { const on = sub === s.key; return (
                  <button key={s.key} onClick={() => pickSub(s.key)} style={{ display: 'flex', alignItems: 'center', gap: 7, border: `1px solid ${on ? 'var(--base)' : 'var(--border)'}`, background: on ? 'var(--base-soft)' : '#fff', borderRadius: 9, padding: '8px 10px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                    <s.Icon width={14} height={14} color={on ? 'var(--base)' : 'var(--muted)'} />
                    <div style={{ minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 600, color: on ? 'var(--base)' : '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</div><div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.tools}</div></div>
                  </button>
                ); })}
              </div>
            </>
          )}
          <div className="lbl" style={{ margin: '16px 0 8px' }}>2 · Assets — {laneName}</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {([['inventory', 'From inventory'], ['target', 'Add a target']] as const).map(([k, lab]) => { const on = flow === k; return (
              <button key={k} onClick={() => setFlow(k)} style={{ flex: 1, border: `1px solid ${on ? 'var(--base)' : 'var(--border)'}`, background: on ? 'var(--base-soft)' : '#fff', color: on ? 'var(--base)' : '#475569', borderRadius: 8, padding: '6px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{lab}</button>
            ); })}
          </div>
          {flow === 'inventory' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {list.length ? list.map((a) => { const sel = picked.has(a.id); const mc = matchedCreds[String(a.id)]; const credOn = sel && usesCreds && !!mc && !credOff.has(a.id); return (
              <div key={a.id} style={{ border: `1px solid ${sel ? '#9cc3de' : 'var(--line)'}`, background: sel ? '#f0f7fc' : '#fff', borderRadius: 10, overflow: 'hidden' }}>
                <button onClick={() => toggle(a.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, border: 'none', background: 'transparent', padding: '9px 11px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <span style={{ display: 'grid', placeItems: 'center', height: 20, width: 20, borderRadius: 6, border: `2px solid ${sel ? 'var(--base)' : '#cbd5e1'}`, background: sel ? 'var(--base)' : '#fff', color: '#fff', flexShrink: 0 }}>{sel && <Check width={13} height={13} />}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.label}</div>
                    {(a.ip || a.type) && <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{[a.ip, a.type].filter(Boolean).join(' · ')}</div>}
                  </div>
                </button>
                {sel && usesCreds && (
                  mc?.cred_kind === 'agent' ? (
                    // Agent-managed host: the agent is inside the box, so it's always a depth scan with
                    // NO credential — never a borrowed login. Informational, not a toggle.
                    <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid #cfe8da', background: '#eafaf1', padding: '7px 11px 7px 42px' }}>
                      <ShieldCheck width={13} height={13} style={{ color: '#1e7a42', flexShrink: 0 }} />
                      <span className="mono" style={{ fontSize: 10.5, color: '#1e7a42', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Agent · always depth scan<span style={{ color: 'var(--faint)', fontWeight: 400 }}> · no password (agent runs inside the host)</span></span>
                    </div>
                  ) : mc ? (
                    // The host's OWN stored login (the credential that promoted it in Discovery).
                    <button onClick={() => credToggle(a.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, border: 'none', borderTop: '1px solid #d7e7f2', background: credOn ? '#e6f3ea' : '#fff', padding: '7px 11px 7px 42px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                      <span style={{ display: 'grid', placeItems: 'center', height: 16, width: 16, borderRadius: 4, border: `2px solid ${credOn ? '#2f9e5a' : '#cbd5e1'}`, background: credOn ? '#2f9e5a' : '#fff', color: '#fff', flexShrink: 0 }}>{credOn && <Check width={11} height={11} />}</span>
                      <KeyRound width={12} height={12} style={{ color: credOn ? '#2f9e5a' : 'var(--faint)', flexShrink: 0 }} />
                      <span className="mono" style={{ fontSize: 10.5, color: credOn ? '#1e7a42' : 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mc.cred_username}<span style={{ color: 'var(--faint)', fontWeight: 400 }}> · {mc.cred_name} ({mc.cred_kind})</span></span>
                    </button>
                  ) : (
                    // No stored login for this host → honest surface scan (we don't borrow another host's).
                    <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--line)', background: '#fff', padding: '7px 11px 7px 42px' }}>
                      <Radar width={12} height={12} style={{ color: 'var(--faint)', flexShrink: 0 }} />
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Surface scan<span style={{ fontWeight: 400 }}> · no saved login for this host</span></span>
                    </div>
                  )
                )}
              </div>
            ); }) : <div style={{ padding: '24px 8px', textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>No inventory assets in the {laneName} lane — use <b>Add a target</b>.</div>}
          </div>
          ) : (
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: '#475569', marginBottom: 2 }}>{hint.label}</div>
            <div style={{ fontSize: 10.5, color: 'var(--faint)', marginBottom: 7 }}>Bring a target that isn’t in inventory — scanned as an ad-hoc asset (stored & viewable, excluded from the dashboard).</div>
            {targets.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {targets.map((t) => (
                  <span key={t} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', background: 'var(--subtle)', borderRadius: 20, padding: '3px 6px 3px 10px', fontSize: 11.5 }}>
                    {t}
                    <button onClick={() => setTargets((x) => x.filter((v) => v !== t))} aria-label={`Remove ${t}`} style={{ display: 'grid', placeItems: 'center', height: 16, width: 16, borderRadius: 20, border: 'none', background: 'transparent', color: 'var(--faint)', cursor: 'pointer' }}><X width={11} height={11} /></button>
                  </span>
                ))}
              </div>
            )}
            <input value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTargets(draft); } else if (e.key === 'Backspace' && !draft && targets.length) { setTargets((x) => x.slice(0, -1)); } }}
              onBlur={() => addTargets(draft)}
              placeholder={hint.ph}
              className="mono" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px', fontSize: 12.5, outline: 'none', fontFamily: 'inherit' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontSize: 11.5, color: '#475569' }}>
              <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
              I am authorized to test {targets.length > 1 ? 'these targets' : 'this target'}.
            </label>
          </div>
          )}
          {flow === 'target' && usesCreds && (
            <div style={{ marginTop: 16 }}>
              <div className="lbl" style={{ marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6 }}><KeyRound width={13} height={13} />Credentials <span style={{ fontWeight: 400, color: 'var(--faint)' }}>— optional, for this ad-hoc target</span></div>
              {credsLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 2px', fontSize: 12, color: 'var(--muted)' }}><Loader2 width={14} height={14} className="spin" />Loading saved credentials…</div>
              ) : laneCreds.length ? (
                // Dropdown, not an open list: pick the saved login to authenticate with, or run
                // unauthenticated (the default). The chosen credential is threaded as credential_id.
                <select value={credId ?? ''} onChange={(e) => setCredId(e.target.value ? Number(e.target.value) : null)}
                  style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
                  <option value="">Unauthenticated — no login (surface scan)</option>
                  {laneCreds.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} · {c.kind}{c.username ? ` · ${c.username}` : ''}</option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--faint)' }}>No saved credentials for this lane — the scan runs unauthenticated.</div>
              )}
            </div>
          )}
          {err && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
        </div>
        <footer style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}><b style={{ color: 'var(--text)' }}>{flow === 'target' ? (targets.length || (draft.trim() ? 1 : 0)) : picked.size}</b> {flow === 'target' ? `target${targets.length === 1 ? '' : 's'}` : `asset${picked.size === 1 ? '' : 's'}`} · {laneName}</span>
          <button className="btn btn-primary" onClick={start} disabled={!ready || busy}>{busy ? <Loader2 width={15} height={15} className="spin" /> : null}Start scan <ArrowRight width={15} height={15} /></button>
        </footer>
      </aside>
    </div>
  );
}
