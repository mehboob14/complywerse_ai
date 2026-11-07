'use client';

import { PageLoader } from '@/cyber-assurance/components/ui';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { advisoriesApi } from '@/cyber-assurance/lib/api';
import {
  AlertCircle, Upload, Loader2, RefreshCw, ExternalLink, ShieldAlert,
  Database, X, ChevronDown, ChevronRight, Server, Play, History,
} from 'lucide-react';
import {
  AdvisoryView, AdvisoryListResponse, MatchReportData, MatchTarget,
  SeverityBadge, StatusBadge, RichText, VulnCard, RegionPicker,
  MatchPanel, MatchReport, HistoryTimeline, FlowStrip,
} from './_components/ui';

interface AdvisorySource {
  key: string;
  name: string;
  region?: string;
  kind: string;
}

interface Flash {
  text: string;
  ok: boolean;
}

interface AffectedAsset {
  asset_id: number;
  asset_name: string;
  host?: string | null;
  items: { advisory_id: number; advisory_title: string; cve_id: string }[];
}

const ALL = 'all';
// Multinational buckets sort first, then countries alphabetically, Unclassified last.
const REGION_ORDER = ['US', 'EU', 'UK', 'Global'];

function FilterSelect({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <label className="flex shrink-0 flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide cw-text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-[5.5rem] shrink-0 truncate rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs cw-text-default">
        <option value={ALL}>All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function regionRank(region: string): number {
  if (region === 'Unclassified') return REGION_ORDER.length + 1;  // always last
  const i = REGION_ORDER.indexOf(region);
  return i < 0 ? REGION_ORDER.length : i;  // known buckets first, then countries A–Z
}

// Absolute date with year (publication / processing dates); '—' when absent.
function fmtDate(at?: string | null): string {
  if (!at) return '—';
  const dt = new Date(at);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Display source for grouping/filter. An uploaded advisory is labelled by the
// issuer we parsed (the external_id's leading code, e.g. 'NCA-17.240826' → 'NCA')
// instead of a generic 'Uploaded document'; falls back to the full id/title.
function sourceLabel(a: AdvisoryView): string {
  if (a.origin === 'upload') {
    const ext = (a.external_id || '').trim();
    const issuer = ext.replace(/\d.*$/, '').replace(/[-_.:\s]+$/, '').trim();
    return issuer || ext || 'Uploaded document';
  }
  return a.source_name || 'Unknown source';
}

// The advisory's year — from its real published date, else the ingest/upload
// date; 'Undated' when neither parses. Drives the year grouping level.
function advYear(a: AdvisoryView): string {
  const d = a.published_at || a.created_at;
  if (d) {
    const y = new Date(d).getFullYear();
    if (!isNaN(y)) return String(y);
  }
  return 'Undated';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
// The advisory's month name (within its year); 'Undated' when no date parses.
function advMonth(a: AdvisoryView): string {
  const d = a.published_at || a.created_at;
  if (d) { const m = new Date(d).getMonth(); if (!isNaN(m)) return MONTHS[m]; }
  return 'Undated';
}
const monthRank = (m: string) => (m === 'Undated' ? 99 : MONTHS.indexOf(m));

export default function AdvisoriesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourcesSeeded = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [affectedOpen, setAffectedOpen] = useState(false);
  const [syncMsg, setSyncMsg] = useState<Flash | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [feedKeys, setFeedKeys] = useState<Set<string>>(new Set());
  // Match selection + right-panel mode (detail | match | report | history).
  const [selAdv, setSelAdv] = useState<Set<number>>(new Set());
  const [selCve, setSelCve] = useState<Set<number>>(new Set());
  const [panelMode, setPanelMode] = useState<'detail' | 'match' | 'report'>('detail');
  const [report, setReport] = useState<MatchReportData | null>(null);
  const [reportTitle, setReportTitle] = useState<string>('Match report');
  const [reportSessionId, setReportSessionId] = useState<number | null>(null);

  const [fRegion, setFRegion] = useState(ALL);
  const [fOrigin, setFOrigin] = useState(ALL);
  const [fSource, setFSource] = useState(ALL);
  const [fSeverity, setFSeverity] = useState(ALL);
  const [fStatus, setFStatus] = useState(ALL);
  const [fYear, setFYear] = useState(ALL);

  const { data, isLoading, error } = useQuery({
    queryKey: ['advisories'],
    queryFn: async () => (await advisoriesApi.getAll()).data as AdvisoryListResponse,
  });

  const advisories = useMemo(() => data?.advisories ?? [], [data]);

  const { data: detail } = useQuery({
    queryKey: ['advisory', selectedId],
    queryFn: async () => (await advisoriesApi.getById(selectedId as number)).data as AdvisoryView,
    enabled: selectedId !== null,
  });

  const { data: sourcesData } = useQuery({
    queryKey: ['advisory-sources'],
    queryFn: async () => (await advisoriesApi.listSources()).data as { sources: AdvisorySource[] },
  });

  const { data: affectedData } = useQuery({
    queryKey: ['advisory-affected-assets'],
    queryFn: async () => (await advisoriesApi.affectedAssets()).data as { assets: AffectedAsset[]; total: number },
    enabled: affectedOpen,
  });

  const uploadMutation = useMutation({
    mutationFn: (fd: FormData) => advisoriesApi.upload(fd),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['advisories'] });
      setUploading(false);
      const id = res.data?.advisory?.id;
      if (id) router.push(`/cyber-assurance/advisories/${id}`);
    },
    onError: () => setUploading(false),
  });

  const syncMutation = useMutation({
    // Sync each selected feed (reuses the single-source endpoint) and aggregate the result.
    mutationFn: async (keys: string[]) => {
      const out = [];
      for (const k of keys) out.push((await advisoriesApi.syncSource(k)).data);
      return out;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['advisories'] });
      const created = results.reduce((n, d) => n + (d.created || 0), 0);
      const failed = results.filter((d) => d.ok === false);
      setSyncMsg(failed.length
        ? { text: `${created} new; ${failed.length} feed(s) unreachable: ${failed.map((f) => f.source).join(', ')}`, ok: created > 0 }
        : { text: `${created} new advisor${created === 1 ? 'y' : 'ies'} from ${results.length} feed${results.length > 1 ? 's' : ''}`, ok: true });
    },
    onError: () => setSyncMsg({ text: 'Sync failed — check the sources are reachable', ok: false }),
  });

  const matchMutation = useMutation({
    mutationFn: (target: MatchTarget) => advisoriesApi.match({
      advisory_ids: Array.from(selAdv),
      cve_ids: Array.from(selCve),
      mode: target.mode,
      asset_ids: target.asset_ids,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['advisories'] });
      queryClient.invalidateQueries({ queryKey: ['advisory-affected-assets'] });
      queryClient.invalidateQueries({ queryKey: ['advisory-match-sessions'] });
      if (selectedId !== null) queryClient.invalidateQueries({ queryKey: ['advisory', selectedId] });
      setReport(res.data.report as MatchReportData);
      setReportSessionId(res.data.session_id ?? null);
      setReportTitle('Match report');
      setPanelMode('report');
    },
  });

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    uploadMutation.mutate(fd);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const regionOptions = useMemo(
    () => Array.from(new Set(advisories.map((a) => a.region).filter(Boolean) as string[])).sort(),
    [advisories]);
  const sourceOptions = useMemo(
    () => Array.from(new Set(advisories.map((a) => sourceLabel(a)).filter(Boolean) as string[])).sort(),
    [advisories]);
  const yearOptions = useMemo(
    () => Array.from(new Set(advisories.map((a) => advYear(a)))).sort((a, b) =>
      (a === 'Undated' ? 1 : b === 'Undated' ? -1 : b.localeCompare(a))),
    [advisories]);

  const filtered = useMemo(() => advisories.filter((a) =>
    (fRegion === ALL || a.region === fRegion) &&
    (fOrigin === ALL || (fOrigin === 'synced' ? a.origin === 'sync' : a.origin !== 'sync')) &&
    (fSource === ALL || sourceLabel(a) === fSource) &&
    (fYear === ALL || advYear(a) === fYear) &&
    (fSeverity === ALL || (a.severity || '').toLowerCase() === fSeverity) &&
    (fStatus === ALL || a.status === fStatus)
  ), [advisories, fRegion, fOrigin, fSource, fYear, fSeverity, fStatus]);

  // Group the filtered list hierarchically: region → source → advisories.
  // Region order = REGION_ORDER then name; sources A–Z within a region.
  const grouped = useMemo(() => {
    const byRegion: Record<string, Record<string, Record<string, Record<string, AdvisoryView[]>>>> = {};
    for (const a of filtered) {
      const r = a.region || 'Other';
      const s = sourceLabel(a);
      const y = advYear(a);
      const m = advMonth(a);
      ((((byRegion[r] ||= {})[s] ||= {})[y] ||= {})[m] ||= []).push(a);
    }
    const newestFirst = (a: AdvisoryView, b: AdvisoryView) =>
      (b.published_at || b.created_at || '').localeCompare(a.published_at || a.created_at || '');
    return Object.keys(byRegion)
      .sort((x, y) => regionRank(x) - regionRank(y) || x.localeCompare(y))
      .map((region) => {
        const sources = Object.keys(byRegion[region]).sort().map((source) => {
          const yearMap = byRegion[region][source];
          const years = Object.keys(yearMap)
            // Oldest year first (2021 at the top), counting up; 'Undated' last.
            .sort((a, b) => (a === 'Undated' ? 1 : b === 'Undated' ? -1 : a.localeCompare(b)))
            .map((year) => {
              const monthMap = yearMap[year];
              const months = Object.keys(monthMap)
                .sort((a, b) => monthRank(a) - monthRank(b))  // Jan→Dec, Undated last
                .map((month) => ({ month, items: monthMap[month].slice().sort(newestFirst) }));
              return { year, months, items: months.flatMap((m) => m.items) };
            });
          const items = years.flatMap((y) => y.items);
          return { source, years, items };
        });
        const items = sources.flatMap((s) => s.items);
        return { region, sources, items };
      });
  }, [filtered]);

  // Clear the selection if the chosen advisory is filtered out — never auto-open one.
  useEffect(() => {
    if (selectedId !== null && !filtered.some((a) => a.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

  // Collapse every source, year AND month on first load so the list opens short:
  // region → sources → years → months, nothing auto-expanded. The user opens a
  // source, then a year, then a month, then its advisories.
  useEffect(() => {
    if (!sourcesSeeded.current && advisories.length > 0) {
      const keys = new Set<string>();
      for (const a of advisories) {
        const region = a.region || 'Other';
        const source = sourceLabel(a);
        const year = advYear(a);
        keys.add(srcKey(region, source));
        keys.add(yrKey(region, source, year));
        keys.add(mKey(region, source, year, advMonth(a)));
      }
      setCollapsed(keys);
      sourcesSeeded.current = true;
    }
  }, [advisories]);

  const toggleKey = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  const srcKey = (region: string, source: string) => `${region}\u0000${source}`;
  const yrKey = (region: string, source: string, year: string) => `${region}\u0000${source}\u0000${year}`;
  const mKey = (region: string, source: string, year: string, month: string) => `${region}\u0000${source}\u0000${year}\u0000${month}`;

  const toggleAdv = (id: number) => setSelAdv((p) => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const toggleCve = (id: number) => setSelCve((p) => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const toggleRegionSel = (items: AdvisoryView[]) => setSelAdv((p) => {
    const n = new Set(p);
    const all = items.every((a) => n.has(a.id));
    items.forEach((a) => (all ? n.delete(a.id) : n.add(a.id)));
    return n;
  });
  const clearSel = () => { setSelAdv(new Set()); setSelCve(new Set()); };
  const selCveTotal = useMemo(
    () => advisories.filter((a) => selAdv.has(a.id)).reduce((n, a) => n + (a.cve_count || 0), 0) + selCve.size,
    [advisories, selAdv, selCve]);

  const downloadReport = async (fmt: 'csv' | 'json') => {
    if (reportSessionId === null) return;
    try {
      const res = await advisoriesApi.downloadMatchSession(reportSessionId, fmt);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = `match-session-${reportSessionId}.${fmt}`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><PageLoader size="md" /></div>;
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-600" />
        <p className="mt-2 text-red-600">Failed to load advisories</p>
      </div>
    );
  }

  const summary = data?.summary ?? {};
  const affectedTotal = advisories.reduce((n, a) => n + (a.asset_affected_count || 0), 0);
  const apiSources = sourcesData?.sources ?? [];
  const sourceCount = apiSources.length;
  const uploadedDocs = advisories.filter((a) => a.origin === 'upload');

  return (
    <div className="space-y-3">
      {/* Title lives in the global app bar (PAGE_TITLES['/advisories']); here we keep just the actions.
          No viewport lock: the page flows as one column and the dashboard <main> owns the scroll. */}
      <div className="flex justify-end gap-2">
        <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleUpload} className="hidden" />
        <button onClick={() => setSourcesOpen(true)} className="btn-secondary flex items-center gap-2 text-sm">
          <Database size={15} /> Sources
        </button>
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="btn-primary flex items-center gap-2 text-sm">
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Upload advisory
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { l: 'Advisories', v: summary.total ?? advisories.length, hint: 'Show all',
            onClick: () => { setFStatus(ALL); setFRegion(ALL); setFSource(ALL); setFSeverity(ALL); setFOrigin(ALL); setFYear(ALL); } },
          { l: 'Open', v: summary.open ?? 0, hint: 'Filter open', onClick: () => setFStatus('open') },
          { l: 'Assets affected', v: affectedTotal, hint: 'See which', onClick: () => setAffectedOpen(true) },
          { l: 'Sources', v: sourceCount, hint: 'Manage', onClick: () => setSourcesOpen(true) },
        ].map((k) => (
          <button key={k.l} onClick={k.onClick}
            className="cw-card group flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:border-[var(--color-primary)]">
            <div className="min-w-0">
              <p className="text-[11px] font-medium cw-text-muted">{k.l}</p>
              <p className="mt-0.5 text-[10px] font-medium text-[var(--color-primary)]">{k.hint} →</p>
            </div>
            <p className="text-xl font-semibold leading-none cw-text-default">{k.v}</p>
          </button>
        ))}
      </div>

      <div className="cw-card p-3">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <button onClick={() => setPanelMode('match')} disabled={selCveTotal === 0}
            className="btn-primary mb-0.5 flex shrink-0 items-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
            <Play size={15} /> Match{selCveTotal > 0 ? ` ${selCveTotal} CVE${selCveTotal === 1 ? '' : 's'}` : ''}
          </button>
          {(selAdv.size > 0 || selCve.size > 0) && (
            <span className="mb-1.5 flex shrink-0 items-center gap-2 text-xs cw-text-default">
              <span><span className="font-semibold">{selAdv.size}</span> adv
                {selCve.size > 0 ? <> · <span className="font-semibold">{selCve.size}</span> CVE</> : null}</span>
              <button onClick={clearSel} className="font-medium text-[var(--color-primary)] hover:underline">Clear</button>
            </span>
          )}
          <div className="flex flex-1 flex-wrap items-end gap-x-3 gap-y-2">
            <FilterSelect label="Origin" value={fOrigin} options={['uploaded', 'synced']} onChange={setFOrigin} />
            <FilterSelect label="Region" value={fRegion} options={regionOptions} onChange={setFRegion} />
            <FilterSelect label="Year" value={fYear} options={yearOptions} onChange={setFYear} />
            <FilterSelect label="Source" value={fSource} options={sourceOptions} onChange={setFSource} />
            <FilterSelect label="Severity" value={fSeverity} options={['critical', 'high', 'medium', 'low']} onChange={setFSeverity} />
            <FilterSelect label="Status" value={fStatus} options={['pending', 'open', 'resolved', 'not_applicable']} onChange={setFStatus} />
          </div>
          <button onClick={() => router.push('/cyber-assurance/advisories/history')}
            className="btn-primary mb-0.5 flex shrink-0 items-center gap-1.5 text-sm">
            <History size={15} /> History
          </button>
        </div>
      </div>

      <div className="cw-card">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center cw-text-muted">
            <ShieldAlert className="mx-auto mb-2 h-8 w-8" />
            <p className="text-xs">No advisories match these filters.</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-20">
              <tr className="text-left text-[11px] uppercase tracking-wide">
                <th className="w-8 px-3 py-2 !bg-primary-700 !text-white"></th>
                <th className="px-3 py-2 font-bold !bg-primary-700 !text-white">Advisory</th>
                <th className="px-3 py-2 font-bold !bg-primary-700 !text-white">Published</th>
                <th className="px-3 py-2 font-bold !bg-primary-700 !text-white">Synced</th>
                <th className="px-3 py-2 text-right font-bold !bg-primary-700 !text-white">CVEs</th>
                <th className="px-3 py-2 text-right font-bold !bg-primary-700 !text-white">Affected</th>
                <th className="px-3 py-2 font-bold !bg-primary-700 !text-white">Severity</th>
                <th className="px-3 py-2 font-bold !bg-primary-700 !text-white">Status</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(({ region, sources, items }) => {
                const regionCollapsed = collapsed.has(region);
                return (
                  <Fragment key={region}>
                    <tr className="border-t border-[var(--color-border)] bg-[var(--color-subtle)]">
                      <td className="px-3 py-2">
                        <input type="checkbox" title="Select all in region"
                          checked={items.length > 0 && items.every((a) => selAdv.has(a.id))}
                          onChange={() => toggleRegionSel(items)} />
                      </td>
                      <td colSpan={6} className="px-1 py-2">
                        <button onClick={() => toggleKey(region)} className="flex items-center gap-2 text-left">
                          {regionCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                          <span className="text-sm font-bold uppercase tracking-wide cw-text-default">{region}</span>
                          <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-medium cw-text-muted">{sources.length} source{sources.length === 1 ? '' : 's'}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-semibold cw-text-muted">{items.length}</td>
                    </tr>
                    {!regionCollapsed && sources.map(({ source, items: sItems, years }) => {
                      const key = srcKey(region, source);
                      const srcCollapsed = collapsed.has(key);
                      return (
                        <Fragment key={key}>
                          <tr className="border-t border-[var(--color-border)]">
                            <td className="px-3 py-1.5">
                              <input type="checkbox" title="Select all from this source"
                                checked={sItems.length > 0 && sItems.every((a) => selAdv.has(a.id))}
                                onChange={() => toggleRegionSel(sItems)} />
                            </td>
                            <td colSpan={6} className="py-1.5 pl-6 pr-3">
                              <button onClick={() => toggleKey(key)} className="flex items-center gap-1.5 text-left">
                                {srcCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                                <span className="truncate text-xs font-semibold cw-text-default">{source}</span>
                              </button>
                            </td>
                            <td className="px-3 py-1.5 text-right text-[11px] cw-text-muted">{sItems.length}</td>
                          </tr>
                          {!srcCollapsed && years.map(({ year, months, items: yItems }) => {
                            const ykey = yrKey(region, source, year);
                            const yrCollapsed = collapsed.has(ykey);
                            return (
                              <Fragment key={ykey}>
                                <tr className="border-t border-[var(--color-border)] bg-[var(--color-surface)]">
                                  <td className="px-3 py-1">
                                    <input type="checkbox" title="Select all in year"
                                      checked={yItems.length > 0 && yItems.every((a) => selAdv.has(a.id))}
                                      onChange={() => toggleRegionSel(yItems)} />
                                  </td>
                                  <td colSpan={6} className="py-1 pl-10 pr-3">
                                    <button onClick={() => toggleKey(ykey)} className="flex items-center gap-1.5 text-left">
                                      {yrCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                      <span className="text-[11px] font-semibold text-[var(--color-primary)]">{year}</span>
                                    </button>
                                  </td>
                                  <td className="px-3 py-1 text-right text-[11px] cw-text-muted">{yItems.length}</td>
                                </tr>
                                {!yrCollapsed && months.map(({ month, items: mItems }) => {
                                  const mkey = mKey(region, source, year, month);
                                  const mCollapsed = collapsed.has(mkey);
                                  return (
                                    <Fragment key={mkey}>
                                      <tr className="border-t border-[var(--color-border)]">
                                        <td className="px-3 py-1">
                                          <input type="checkbox" title="Select all in month"
                                            checked={mItems.length > 0 && mItems.every((a) => selAdv.has(a.id))}
                                            onChange={() => toggleRegionSel(mItems)} />
                                        </td>
                                        <td colSpan={6} className="py-1 pl-14 pr-3">
                                          <button onClick={() => toggleKey(mkey)} className="flex items-center gap-1.5 text-left">
                                            {mCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                            <span className="text-[11px] font-medium cw-text-muted">{month}</span>
                                          </button>
                                        </td>
                                        <td className="px-3 py-1 text-right text-[11px] cw-text-muted">{mItems.length}</td>
                                      </tr>
                                      {!mCollapsed && mItems.map((a) => (
                                        <tr key={a.id} className="border-t border-[var(--color-border)] transition-colors hover:bg-[var(--color-hover)]">
                                          <td className="px-3 py-2">
                                            <input type="checkbox" checked={selAdv.has(a.id)} onChange={() => toggleAdv(a.id)} />
                                          </td>
                                          <td className="py-2 pl-[72px] pr-3">
                                            <button onClick={() => router.push(`/cyber-assurance/advisories/${a.id}`)}
                                              className="block max-w-sm truncate text-left text-xs font-medium cw-text-default hover:text-[var(--color-primary)]">
                                              {a.title}
                                            </button>
                                          </td>
                                          <td className="whitespace-nowrap px-3 py-2 cw-text-muted">{fmtDate(a.published_at)}</td>
                                          <td className="whitespace-nowrap px-3 py-2 cw-text-muted">{fmtDate(a.created_at)}</td>
                                          <td className="px-3 py-2 text-right cw-text-default">{a.cve_count}</td>
                                          <td className="px-3 py-2 text-right">
                                            {a.asset_affected_count > 0
                                              ? <span className="font-semibold text-red-600">{a.asset_affected_count}</span>
                                              : <span className="cw-text-muted">0</span>}
                                          </td>
                                          <td className="px-3 py-2"><SeverityBadge severity={a.severity} /></td>
                                          <td className="px-3 py-2"><StatusBadge status={a.status} /></td>
                                        </tr>
                                      ))}
                                    </Fragment>
                                  );
                                })}
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Match flow as a modal: pick scope, Run, then the rich results — the list
          stays behind, blurred. History has its own full page (/advisories/history). */}
      {panelMode !== 'detail' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPanelMode('detail')} />
          <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-xl">
            <div className="flex items-center justify-between bg-[var(--color-primary)] px-5 py-4 text-white">
              <h2 className="text-base font-bold">{panelMode === 'report' ? 'Match results' : 'Run match'}</h2>
              <button onClick={() => setPanelMode('detail')} className="rounded p-1 hover:bg-white/20"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {panelMode === 'report' && report ? (
                <MatchReport report={report} title={reportTitle}
                  onBack={() => setPanelMode('detail')}
                  onDownload={reportSessionId !== null ? downloadReport : undefined} />
              ) : (
                <MatchPanel selection={{ advisories: selAdv.size, cves: selCveTotal }}
                  onRun={(t) => matchMutation.mutate(t)} onCancel={() => setPanelMode('detail')}
                  isPending={matchMutation.isPending} />
              )}
            </div>
          </div>
        </div>
      )}

      {sourcesOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSourcesOpen(false)} />
          <div className="relative flex h-full w-full max-w-md flex-col overflow-hidden bg-[var(--color-surface)] shadow-xl">
            <div className="flex items-center justify-between bg-[var(--color-primary)] px-5 py-4 text-white">
              <h2 className="flex items-center gap-2 text-base font-bold"><Database size={18} /> Sources</h2>
              <button onClick={() => setSourcesOpen(false)} className="rounded p-1 hover:bg-white/20"><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div>
                <h3 className="text-base font-bold cw-text-default">Sync public feeds</h3>
                <p className="mt-0.5 mb-3 text-xs cw-text-muted">
                  Pick one or more feeds and sync their latest advisories — no upload needed.
                </p>
                <div className="space-y-1.5">
                  {apiSources.map((s) => {
                    const on = feedKeys.has(s.key);
                    return (
                      <label key={s.key}
                        className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-hover)]">
                        <input type="checkbox" checked={on}
                          onChange={() => setFeedKeys((prev) => {
                            const n = new Set(prev);
                            if (on) n.delete(s.key); else n.add(s.key);
                            return n;
                          })} />
                        <span className="min-w-0 flex-1 truncate cw-text-default">{s.name}</span>
                        {s.region && <span className="shrink-0 text-xs cw-text-muted">{s.region}</span>}
                      </label>
                    );
                  })}
                </div>
                <button onClick={() => syncMutation.mutate(Array.from(feedKeys))}
                  disabled={syncMutation.isPending || feedKeys.size === 0}
                  className="btn-secondary mt-3 flex items-center gap-1.5">
                  {syncMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Sync{feedKeys.size > 0 ? ` (${feedKeys.size})` : ''}
                </button>
                {syncMsg && <p className={`mt-2 text-xs ${syncMsg.ok ? 'text-green-700' : 'text-yellow-700'}`}>{syncMsg.text}</p>}
              </div>

              <div className="mt-5">
                <h3 className="text-base font-bold cw-text-default">Upload a PDF</h3>
                <p className="mt-0.5 text-xs cw-text-muted">
                  For an advisory with no public feed — any CERT or vendor, any country. Same parser; it auto-detects the region.
                </p>
                {uploadedDocs.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider cw-text-muted">Your uploads ({uploadedDocs.length})</p>
                    <div className="max-h-56 space-y-1 overflow-y-auto">
                      {uploadedDocs.map((a) => (
                        <button key={a.id} onClick={() => { setSelectedId(a.id); setSourcesOpen(false); }}
                          className="flex w-full items-center gap-2 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-left text-xs hover:bg-[var(--color-hover)]">
                          <span className="min-w-0 flex-1 truncate cw-text-default">{a.title}</span>
                          <span className="shrink-0 cw-text-muted">{a.region}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-[var(--color-border)] p-4">
              <button onClick={() => { setSourcesOpen(false); fileInputRef.current?.click(); }}
                className="btn-primary flex w-full items-center justify-center gap-2">
                <Upload size={16} /> Upload advisory PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {affectedOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setAffectedOpen(false)} />
          <div className="relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-xl">
            <div className="flex items-center justify-between bg-[var(--color-primary)] px-5 py-4 text-white">
              <h2 className="flex items-center gap-2 text-base font-bold"><Server size={18} /> Affected assets</h2>
              <button onClick={() => setAffectedOpen(false)} className="rounded p-1 hover:bg-white/20"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {!affectedData ? (
                <div className="flex justify-center py-10"><Loader2 className="animate-spin cw-text-muted" /></div>
              ) : affectedData.assets.length === 0 ? (
                <div className="py-10 text-center cw-text-muted">
                  <Server className="mx-auto mb-3 h-10 w-10" />
                  <p>No assets are affected yet.</p>
                  <p className="mt-1 text-xs">Advisories match against your inventory on re-check; affected assets show up here.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {affectedData.assets.map((a) => (
                    <li key={a.asset_id} className="rounded-lg border border-[var(--color-border)] p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium cw-text-default">{a.asset_name}{a.host ? <span className="cw-text-muted"> · {a.host}</span> : null}</p>
                        <span className="text-xs cw-text-muted">{a.items.length} finding{a.items.length === 1 ? '' : 's'}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {a.items.map((it, i) => (
                          <button key={i} onClick={() => { setAffectedOpen(false); router.push(`/cyber-assurance/advisories/${it.advisory_id}`); }}
                            title={it.advisory_title}
                            className="inline-flex items-center rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-100">
                            {it.cve_id}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
