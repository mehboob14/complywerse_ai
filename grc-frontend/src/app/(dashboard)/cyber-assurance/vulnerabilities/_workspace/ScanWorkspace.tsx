'use client';

/**
 * ScanWorkspace — the register-owned Plan + Scan running SCREEN (moved wholesale from the
 * AI-Pentest engine). Left: the in-page asset+CVE sidebar. Right, for the selected asset: the
 * plan/recon preview (auto-routed lane + scanner + credential decision, from assess()), a Run-scan
 * control with live progress, and the asset's findings. Two input modes — from-inventory and ad-hoc
 * target — with NO manual lane pick (the engine auto-routes from asset type). Ad-hoc results are
 * stored & viewable here but excluded from the inventory-only dashboard rollup (backend exclude_adhoc).
 *
 * Reuses the backend seam only: vulnManagementApi.scan.* (plan=assess, start/adhoc=start_scan,
 * job=poll) + /pentest/scanned-assets for the rail. No new scanner.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScanLine, ShieldCheck, Server, Globe, KeyRound, Target, Plus, Trash2, ArrowLeft, Ban, Crosshair } from 'lucide-react';
import apiClient, { vulnManagementApi } from '@/cyber-assurance/lib/api';
import { AssetCveSidebar, type SidebarAsset } from '@/cyber-assurance/components/scan/AssetCveSidebar';
import ScanLauncher from './ScanLauncher';
import { shortenVulnTitle, type Vulnerability } from './lib';

const AC = '#005B96', ACS = '#014A81', ACSOFT = '#EFF5FA', BORDER = '#E8ECEE', INK = '#0F1F2B', MUTED = '#8A95A1', FAINT = '#AEB8C2', SEC = '#3A4653';
const SEVC: Record<string, { c: string; bg: string }> = {
  critical: { c: '#C2453F', bg: '#FBEAEA' }, high: { c: '#C0682F', bg: '#FCEEE2' },
  medium: { c: '#9A6410', bg: '#FBF2DF' }, low: { c: '#1F7A54', bg: '#E7F5EE' }, info: { c: '#6B7787', bg: '#EEF1F3' },
};
const sev = (s?: string) => { const k = (s || 'info').toLowerCase(); return SEVC[k] || SEVC.info; };
const btn: React.CSSProperties = { border: `1px solid #E4E8EC`, background: '#fff', color: SEC, borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' };
const btnGreen: React.CSSProperties = { ...btn, background: AC, borderColor: AC, color: '#fff', fontWeight: 600 };

type Filter = 'all' | 'inventory' | 'adhoc';
const TERMINAL = new Set(['done', 'failed', 'complete', 'completed', 'error', 'none', 'cancelled', 'canceled']);
const FAILED = new Set(['failed', 'error']);
const CANCELLED = new Set(['cancelled', 'canceled']);

type ScanJob = {
  job_id: number; asset_id: number; asset_name: string; target?: string; adhoc?: boolean;
  lane?: string; lane_label?: string; find_mcp?: string; scanner_label?: string; status?: string; progress?: number; findings_count?: number;
  created_at?: string; started_at?: string; finished_at?: string;
};
const fmtWhen = (s?: string) => { if (!s) return '—'; const d = new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z'); return isNaN(+d) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const fmtDur = (a?: string, b?: string) => { if (!a || !b) return '—'; const ms = +new Date(b + (b.endsWith('Z') ? '' : 'Z')) - +new Date(a + (a.endsWith('Z') ? '' : 'Z')); if (!(ms > 0)) return '—'; const m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000); return m ? `${m}m ${s}s` : `${s}s`; };
const STATUSC: Record<string, { c: string; bg: string }> = {
  running: { c: '#005B96', bg: '#EAF2F9' }, queued: { c: '#6B7787', bg: '#EEF1F3' },
  done: { c: '#1F7A54', bg: '#E7F5EE' }, failed: { c: '#B23A3A', bg: '#FBEAEA' },
  cancelled: { c: '#6B7787', bg: '#EEF1F3' },
};
const statusKey = (s?: string) => { const k = (s || '').toLowerCase(); if (CANCELLED.has(k)) return 'cancelled'; if (FAILED.has(k)) return 'failed'; if (k === 'done' || k === 'complete' || k === 'completed') return 'done'; if (k === 'running') return 'running'; return 'queued'; };

export function ScanWorkspace({ assetItems = [], vulns = [] }: {
  assetItems?: { value: string; label: string }[];
  vulns?: Vulnerability[];
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [showLauncher, setShowLauncher] = useState(false);
  const [sevFilter, setSevFilter] = useState<string>('all');   // scan findings severity filter chip
  const [catFilter, setCatFilter] = useState<string>('all');   // scan findings category filter (SAST/CI-CD/Secret/…)
  const [job, setJob] = useState<{ status?: string; progress?: number; stage?: string; findings_count?: number; error?: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  // assets WITH findings (+ ad-hoc flag + count) — the authoritative per-asset count source.
  const { data: scanned } = useQuery<{ assets: { asset_id: number; name: string; host: string; finding_count: number; adhoc: boolean }[] }>({
    queryKey: ['register', 'scanned-assets'],
    queryFn: async () => (await apiClient.get('/pentest/scanned-assets')).data ?? { assets: [] },
    refetchInterval: 8000,
  });
  const countMap = useMemo(() => { const m = new Map<number, number>(); (scanned?.assets ?? []).forEach((a) => m.set(a.asset_id, a.finding_count)); return m; }, [scanned]);

  // Scan SESSIONS — the default (no-asset-selected) view: aggregated, live-polled history of every
  // scan launched (inventory + ad-hoc). Reuses GET /vuln-management/scan-jobs (grc_pentest_scan_jobs).
  const { data: jobsData } = useQuery<{ jobs: ScanJob[] }>({
    queryKey: ['register', 'scan-jobs'],
    queryFn: async () => (await vulnManagementApi.scan.list(100)).data ?? { jobs: [] },
    refetchInterval: 4000,
  });
  const jobs = jobsData?.jobs ?? [];
  const jobStats = useMemo(() => {
    let running = 0, done = 0, failed = 0, findings = 0;
    for (const j of jobs) { const k = statusKey(j.status); if (k === 'running' || k === 'queued') running++; else if (k === 'done') done++; else if (k === 'failed') failed++; findings += j.findings_count ?? 0; }
    return { total: jobs.length, running, done, failed, findings };
  }, [jobs]);
  // CVE chips per asset — derived from the already-fetched register list by linked-asset NAME (cosmetic).
  const cvesByName = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const v of vulns) { if (!v.cve_id) continue; for (const n of v.linked_assets || []) { if (!m.has(n)) m.set(n, new Set()); m.get(n)!.add(v.cve_id); } }
    return m;
  }, [vulns]);

  const sidebarAssets = useMemo<SidebarAsset[]>(() => {
    const invIds = new Set(assetItems.map((a) => Number(a.value)));
    const inv: SidebarAsset[] = assetItems.map((a) => ({ id: Number(a.value), label: a.label, findingCount: countMap.get(Number(a.value)) ?? 0, cves: Array.from(cvesByName.get(a.label) ?? []), adhoc: false }));
    const adhoc: SidebarAsset[] = (scanned?.assets ?? []).filter((a) => a.adhoc && !invIds.has(a.asset_id))
      .map((a) => ({ id: a.asset_id, label: a.name || a.host, sub: a.host, findingCount: a.finding_count, cves: Array.from(cvesByName.get(a.name) ?? cvesByName.get(a.host) ?? []), adhoc: true }));
    const all = [...inv, ...adhoc];
    const f = filter === 'inventory' ? all.filter((a) => !a.adhoc) : filter === 'adhoc' ? all.filter((a) => a.adhoc) : all;
    return f.sort((a, b) => (b.findingCount ?? 0) - (a.findingCount ?? 0));
  }, [assetItems, scanned, countMap, cvesByName, filter]);

  // plan/recon preview (assess) for the selected asset — auto-routed lane + scanner + creds + findings.
  const { data: plan, isFetching: planLoading, refetch: refetchPlan } = useQuery<any>({
    queryKey: ['register', 'scan-plan', selected],
    queryFn: async () => (await vulnManagementApi.scan.plan(selected!)).data,
    enabled: selected != null,
  });

  const poll = (jobId: number) => {
    pollRef.current = setTimeout(async () => {
      try {
        const { data } = await vulnManagementApi.scan.job(jobId);
        setJob(data);
        if (TERMINAL.has(String(data?.status))) {
          qc.invalidateQueries({ queryKey: ['register', 'scanned-assets'] });
          qc.invalidateQueries({ queryKey: ['vulnerabilities'] });
          qc.invalidateQueries({ queryKey: ['vuln-dashboard'] });
          refetchPlan();
          return;
        }
        poll(jobId);
      } catch { setJob({ status: 'error', error: 'lost track of the scan job' }); }
    }, 3000);
  };

  // The rich launcher started one or more scans; focus the first scanned asset and poll its job.
  const onLauncherStarted = (assetId: number, jobId: number) => {
    setShowLauncher(false);
    setSelected(assetId);
    setJob({ status: 'queued', stage: 'starting' });
    qc.invalidateQueries({ queryKey: ['register', 'scanned-assets'] });
    poll(jobId);
  };

  // Delete a scan SESSION (history row). Findings stay in the register; a still-running scan is refused.
  const [deleting, setDeleting] = useState<number | null>(null);
  const delJob = async (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation();
    if (!window.confirm('Delete this scan session? The findings it produced stay in the register.')) return;
    setDeleting(jobId);
    try { await vulnManagementApi.scan.remove(jobId); qc.invalidateQueries({ queryKey: ['register', 'scan-jobs'] }); }
    catch (err: any) { window.alert(err?.response?.data?.detail || 'Failed to delete the scan session.'); }
    finally { setDeleting(null); }
  };

  // Stop a stuck/running scan — marks the job cancelled so a frozen 'running' row clears
  // (a restart does NOT clear orphaned scan-jobs) and becomes deletable. Findings already
  // written to the register are kept.
  const [cancelling, setCancelling] = useState<number | null>(null);
  const cancelJob = async (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation();
    if (!window.confirm('Stop this scan? It is marked cancelled; any findings already produced stay in the register.')) return;
    setCancelling(jobId);
    try { await vulnManagementApi.scan.cancel(jobId); qc.invalidateQueries({ queryKey: ['register', 'scan-jobs'] }); }
    catch (err: any) { window.alert(err?.response?.data?.detail || 'Failed to stop the scan.'); }
    finally { setCancelling(null); }
  };

  // On opening an asset, reconcile the detail view to its LATEST scan job — so an already-running scan
  // (started from the launcher or earlier) shows its live progress bar + polls here too, not only in the
  // sessions table. Clears any prior poll so we don't double-poll.
  useEffect(() => {
    if (selected == null) return;
    let cancelled = false;
    vulnManagementApi.scan.latest(selected).then(({ data }: any) => {
      if (cancelled || !data || data.status === 'none') return;
      if (!TERMINAL.has(String(data.status))) {
        setJob(data);
        if (pollRef.current) clearTimeout(pollRef.current);
        if (data.job_id) poll(data.job_id);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selected]);

  // Register auto-sync: when ANY scan session transitions to terminal (incl. one that finished in the
  // background while the operator was elsewhere), invalidate the register + dashboard + scanned-assets
  // so the new findings appear WITHOUT a manual refresh. Fires only on a NEW completion (not on mount).
  const prevDoneRef = useRef<Set<number> | null>(null);
  useEffect(() => {
    const nowDone = new Set<number>(jobs.filter((j) => TERMINAL.has(String(j.status))).map((j) => j.job_id));
    if (prevDoneRef.current !== null) {
      let newly = false;
      for (const id of nowDone) if (!prevDoneRef.current.has(id)) { newly = true; break; }
      if (newly) {
        qc.invalidateQueries({ queryKey: ['vulnerabilities'] });
        qc.invalidateQueries({ queryKey: ['vuln-dashboard'] });
        qc.invalidateQueries({ queryKey: ['register', 'scanned-assets'] });
      }
    }
    prevDoneRef.current = nowDone;
  }, [jobs, qc]);

  const scanning = job != null && !TERMINAL.has(String(job.status));
  const planVulns: any[] = plan?.vulns ?? [];
  // category list (SAST / CI-CD / Secret / Dependency CVE / IaC for repos, Web for web, …) present in this
  // asset's findings, + the combined (severity AND category) filtered view the Findings list renders.
  const planCats: string[] = Array.from(new Set(planVulns.map((v) => v.category).filter(Boolean))) as string[];
  const shownVulns = planVulns.filter((v) =>
    (sevFilter === 'all' || (v.severity || 'info').toLowerCase() === sevFilter) &&
    (catFilter === 'all' || v.category === catFilter));
  const routing = plan?.routing ?? {}; const creds = plan?.credentials ?? {}; const summary = plan?.summary ?? {};
  const selMeta = sidebarAssets.find((a) => a.id === selected);

  const header = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button style={{ ...btnGreen, justifyContent: 'center' }} onClick={() => setShowLauncher(true)}><Plus size={14} />New scan</button>
      <button style={{ ...btn, justifyContent: 'center' }} onClick={() => router.push('/cyber-assurance/pentest')} title="Go to the Gate / Exploit workspace"><Crosshair size={14} />Gate &amp; Exploit</button>
      <div style={{ display: 'inline-flex', background: '#EAEEF1', borderRadius: 9, padding: 3, gap: 2 }}>
        {(['all', 'inventory', 'adhoc'] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{ flex: 1, height: 26, border: 0, borderRadius: 7, background: filter === f ? '#fff' : 'none', color: filter === f ? ACS : '#6B7787', fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>{f === 'adhoc' ? 'Ad-hoc' : f}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: 12, height: '100%', minHeight: 0 }}>
      <AssetCveSidebar assets={sidebarAssets} selectedId={selected} onSelect={(id) => { setSelected(id); setJob(null); }} title="Assets & CVEs" emptyText="No assets in this view." headerExtra={header} groupByDomain />
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        {selected == null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* summary header */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10 }}>
              <Stat label="Scans" value={jobStats.total} />
              <Stat label="Running" value={jobStats.running} tone={jobStats.running ? AC : undefined} />
              <Stat label="Done" value={jobStats.done} tone={jobStats.done ? '#1F7A54' : undefined} />
              <Stat label="Failed" value={jobStats.failed} tone={jobStats.failed ? '#B23A3A' : undefined} />
              <Stat label="Findings" value={jobStats.findings} />
            </div>
            {/* sessions table */}
            <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: `1px solid ${BORDER}` }}>
                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: INK }}>Scan sessions</h3>
                <span style={{ fontSize: 11.5, color: MUTED }}>newest first · live</span>
              </div>
              {jobs.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: FAINT }}>
                  <ScanLine size={28} style={{ opacity: 0.5 }} /><p style={{ marginTop: 8, fontSize: 13 }}>No scans yet. Start one with <b>New scan</b>, or pick an asset to plan &amp; scan it.</p>
                </div>
              ) : (
                <div style={{ maxHeight: 560, overflowY: 'auto', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#FAFBFC' }}>
                        {['Target / asset', 'Lane', 'Status', 'Progress', 'Findings', 'Started', 'Finished / duration'].map((h, i) => (
                          <th key={h} style={{ textAlign: i >= 3 && i <= 4 ? 'right' : 'left', padding: '8px 12px', fontSize: 10, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                        <th aria-label="actions" style={{ borderBottom: `1px solid ${BORDER}`, width: 40 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((j) => { const sk = statusKey(j.status); const sc = STATUSC[sk]; const active = sk === 'running' || sk === 'queued'; return (
                        <tr key={j.job_id} onClick={() => { setSelected(j.asset_id); setJob(null); }} style={{ borderBottom: `1px solid #F0F3F5`, cursor: 'pointer' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#F7FAFC')} onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
                          <td style={{ padding: '9px 12px', maxWidth: 240 }}>
                            <div style={{ fontWeight: 600, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.asset_name}{j.adhoc && <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, background: '#EEF1F3', borderRadius: 5, padding: '1px 5px', marginLeft: 6 }}>AD-HOC</span>}</div>
                            {j.target && j.target !== j.asset_name && <div style={{ fontSize: 10, color: FAINT, fontFamily: 'ui-monospace,Consolas,monospace' }}>{j.target}</div>}
                          </td>
                          <td style={{ padding: '9px 12px', color: SEC }}><div style={{ maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${j.lane_label || j.lane || ''}${(j.scanner_label || j.find_mcp) ? ' · ' + (j.scanner_label || j.find_mcp) : ''}`}>{j.lane_label || j.lane || '—'}{(j.scanner_label || j.find_mcp) ? <span style={{ color: FAINT }}> · {j.scanner_label || j.find_mcp}</span> : null}</div></td>
                          <td style={{ padding: '9px 12px' }}><span style={{ fontSize: 10, fontWeight: 600, color: sc.c, background: sc.bg, borderRadius: 999, padding: '2px 8px', textTransform: 'capitalize' }}>{sk}</span></td>
                          <td style={{ padding: '9px 12px', width: 110, textAlign: 'right' }}>
                            {active ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                                <div style={{ width: 54, height: 6, borderRadius: 4, background: '#EAEEF1', overflow: 'hidden' }}><div style={{ width: `${j.progress ?? 5}%`, height: '100%', background: AC }} /></div>
                                <span style={{ fontSize: 10.5, color: MUTED, fontFamily: 'ui-monospace,Consolas,monospace' }}>{j.progress ?? 0}%</span>
                              </div>
                            ) : <span style={{ fontSize: 11, color: FAINT }}>{sk === 'done' ? '100%' : '—'}</span>}
                          </td>
                          <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'ui-monospace,Consolas,monospace', color: INK }}>{j.findings_count ?? 0}</td>
                          <td style={{ padding: '9px 12px', color: MUTED, whiteSpace: 'nowrap' }}>{fmtWhen(j.started_at || j.created_at)}</td>
                          <td style={{ padding: '9px 12px', color: MUTED, whiteSpace: 'nowrap' }}>{active ? <span style={{ color: FAINT }}>running…</span> : (j.finished_at ? fmtDur(j.started_at || j.created_at, j.finished_at) : '—')}</td>
                          <td style={{ padding: '9px 8px', textAlign: 'center' }}>
                            {active ? (
                              <button onClick={(e) => cancelJob(e, j.job_id)} disabled={cancelling === j.job_id}
                                title="Stop this scan"
                                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#B23A3A', opacity: cancelling === j.job_id ? 0.4 : 1, padding: 4, borderRadius: 6, display: 'inline-flex' }}>
                                <Ban size={14} />
                              </button>
                            ) : (
                              <button onClick={(e) => delJob(e, j.job_id)} disabled={deleting === j.job_id}
                                title="Delete this scan session"
                                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#B23A3A', opacity: deleting === j.job_id ? 0.4 : 1, padding: 4, borderRadius: 6, display: 'inline-flex' }}>
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ); })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button onClick={() => { setSelected(null); setJob(null); }}
              style={{ ...btn, alignSelf: 'flex-start', padding: '6px 11px' }}><ArrowLeft size={14} /> Back to scan sessions</button>
            {/* plan / recon preview */}
            <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '13px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ display: 'grid', placeItems: 'center', height: 34, width: 34, borderRadius: 9, background: ACSOFT, color: AC }}>{selMeta?.adhoc ? <Globe size={17} /> : <Server size={17} />}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: INK }}>{plan?.asset?.name || selMeta?.label || `Asset ${selected}`}{selMeta?.adhoc && <span style={{ fontSize: 9.5, fontWeight: 700, color: MUTED, background: '#EEF1F3', borderRadius: 5, padding: '2px 6px', marginLeft: 8 }}>AD-HOC</span>}{plan?.asset?.agent_managed && <span style={{ fontSize: 9.5, fontWeight: 700, color: '#1F7A54', background: '#E7F5EE', borderRadius: 5, padding: '2px 6px', marginLeft: 8 }}>AGENT-MANAGED</span>}</h2>
                  <div style={{ fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,Consolas,monospace' }}>{[plan?.asset?.ip, plan?.asset?.hostname, plan?.asset?.asset_type].filter(Boolean).join(' · ') || '—'}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
                <Meta icon={<Target size={13} />} label="Routed lane" value={routing.lane_label || routing.lane || '—'} />
                <Meta icon={<ScanLine size={13} />} label="Scanner (auto)" value={routing.scanner_label || routing.selected_find || '—'} />
                <Meta icon={<KeyRound size={13} />} label="Credentials" value={creds.action === 'reuse' ? `reuse · ${creds.profile_label || 'saved'}` : creds.action === 'available' ? 'available' : creds.action === 'prompt' ? 'none (required)' : creds.action === 'uncredentialed' ? 'uncredentialed' : (creds.mode || '—')} />
                <Meta icon={<ShieldCheck size={13} />} label="Findings" value={String(summary.total ?? planVulns.length ?? 0)} />
              </div>
              {scanning && (
                <div style={{ marginTop: 11 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUTED, marginBottom: 4 }}><span>{job?.stage || job?.status || 'scanning'}…</span><span>{job?.progress != null ? `${job.progress}%` : ''}</span></div>
                  <div style={{ height: 7, borderRadius: 5, background: '#EAEEF1', overflow: 'hidden' }}><div style={{ width: `${job?.progress ?? 10}%`, height: '100%', background: AC, transition: 'width .4s' }} /></div>
                </div>
              )}
              {job && TERMINAL.has(String(job.status)) && (
                <div style={{ marginTop: 11, fontSize: 12, fontWeight: 500, borderRadius: 8, padding: '8px 11px', background: job.status === 'failed' || job.status === 'error' ? '#FBEAEA' : '#E7F5EE', color: job.status === 'failed' || job.status === 'error' ? '#B23A3A' : '#1F7A54' }}>
                  {job.status === 'failed' || job.status === 'error' ? `Scan failed: ${job.error || 'see pentest logs'}.` : `Scan complete — ${job.findings_count ?? summary.total ?? 0} finding(s) in the register.`}
                </div>
              )}
            </div>
            {/* findings — these belong to the ASSET's register. While a scan is running they are the
                PREVIOUS results; the panel says so and refreshes (refetchPlan) when the scan completes,
                so a re-scan is never mistaken for "reused the old session". */}
            <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: `1px solid ${BORDER}` }}>
                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: INK }}>Findings</h3>
                <span style={{ fontSize: 11.5, color: MUTED }}>{planLoading ? 'loading…' : scanning ? 'scan in progress' : (sevFilter === 'all' && catFilter === 'all' ? `${planVulns.length} shown` : `${shownVulns.length} of ${planVulns.length}`)}</span>
              </div>
              {/* one filter toolbar: severity chips (ranks present) + a divider + category chips (SAST / CI-CD /
                  Secret / Web …, only when >1 category). Combined into a single strip so the filters are clearly
                  placed together and the findings list isn't pushed down by two separate bars. */}
              {!scanning && planVulns.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '9px 16px', borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(['all', 'critical', 'high', 'medium', 'low', 'info'] as const).map((s) => {
                      const n = s === 'all' ? planVulns.length : planVulns.filter((v) => (v.severity || 'info').toLowerCase() === s).length;
                      if (s !== 'all' && n === 0) return null;
                      const on = sevFilter === s;
                      const sc = s === 'all' ? { c: AC, bg: ACSOFT } : SEVC[s];
                      return (
                        <button key={s} type="button" onClick={() => setSevFilter(s)}
                          style={{ border: `1px solid ${on ? sc.c : '#E4E8EC'}`, background: on ? sc.bg : '#fff', color: on ? sc.c : SEC, borderRadius: 999, padding: '4px 11px', fontSize: 11.5, fontWeight: on ? 700 : 500, cursor: 'pointer', textTransform: 'capitalize', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          {s}<span style={{ fontVariantNumeric: 'tabular-nums', color: on ? sc.c : MUTED, fontWeight: 600 }}>{n}</span>
                        </button>
                      );
                    })}
                  </div>
                  {planCats.length > 1 && (
                    <>
                      <span style={{ width: 1, alignSelf: 'stretch', background: BORDER, margin: '0 2px' }} />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {['all', ...planCats].map((cName) => {
                          const n = cName === 'all' ? planVulns.length : planVulns.filter((v) => v.category === cName).length;
                          const on = catFilter === cName;
                          return (
                            <button key={cName} type="button" onClick={() => setCatFilter(cName)}
                              style={{ border: `1px solid ${on ? AC : '#E4E8EC'}`, background: on ? ACSOFT : '#fff', color: on ? AC : SEC, borderRadius: 999, padding: '4px 11px', fontSize: 11.5, fontWeight: on ? 700 : 500, cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              {cName === 'all' ? 'All categories' : cName}<span style={{ fontVariantNumeric: 'tabular-nums', color: on ? AC : MUTED, fontWeight: 600 }}>{n}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* While a scan runs, DON'T show the asset's earlier findings — they're from a previous scan
                  and reading them as this run's output is misleading. Show a clean progress state; the real
                  results appear (via refetchPlan) when the scan finishes. */}
              {scanning ? (
                <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: AC }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: AC }} />Scan in progress — {job?.stage || 'scanning'}…
                  </div>
                  <div style={{ marginTop: 7, fontSize: 12, color: MUTED }}>This run’s findings appear here when it finishes (and land in the Register at the gate).{planVulns.length > 0 ? ` This asset already has ${planVulns.length} finding(s) from an earlier scan — they stay in the Register.` : ''}</div>
                </div>
              ) : (
              <div style={{ maxHeight: 460, overflowY: 'auto' }}>
                {planVulns.length === 0 ? (
                  <div style={{ padding: 26, textAlign: 'center', fontSize: 12, color: FAINT }}>{planLoading ? 'Loading…' : 'No findings yet — run a scan.'}</div>
                ) : shownVulns.length === 0 ? (
                  <div style={{ padding: 26, textAlign: 'center', fontSize: 12, color: FAINT }}>No findings match this filter.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {shownVulns.map((v) => { const sm = sev(v.severity); return (
                        <tr key={v.id} style={{ borderBottom: `1px solid #F0F3F5` }}>
                          <td style={{ padding: '9px 12px', width: 70 }}><span style={{ fontSize: 10, fontWeight: 600, color: sm.c, background: sm.bg, borderRadius: 999, padding: '2px 8px', textTransform: 'capitalize' }}>{(v.severity || 'info')}</span></td>
                          <td style={{ padding: '9px 8px' }}><div style={{ fontSize: 12, fontWeight: 600, color: INK }}>{shortenVulnTitle(v.title)}</div><div style={{ fontSize: 9.5, color: FAINT, fontFamily: 'ui-monospace,Consolas,monospace' }}>{v.cve_id || v.source} {v.category ? `· ${v.category}` : ''}</div></td>
                          <td style={{ padding: '9px 12px', width: 60, textAlign: 'right', fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 11, color: sm.c }}>{v.cvss ?? '—'}</td>
                        </tr>
                      ); })}
                    </tbody>
                  </table>
                )}
              </div>
              )}
            </div>
          </div>
        )}
      </div>
      {showLauncher && <ScanLauncher onClose={() => setShowLauncher(false)} onStarted={onLauncherStarted} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '11px 14px' }}>
      <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone || INK, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 9, padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '.04em' }}>{icon}{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: INK, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    </div>
  );
}

export default ScanWorkspace;
