'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { ShieldAlert, SlidersHorizontal, Search as SearchIcon, Crown, Eye } from 'lucide-react';
import { riskPostureApi } from '@/lib/api';
import EmptyState from '@/components/common/EmptyState';
import WeightsPanel from './_weights-panel';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/ui/ToastProvider';

type AssetRow = {
  id: number;
  name: string;
  host_name?: string | null;
  asset_type?: string | null;
  criticality?: string | null;
  score: number | null;
  band: { label: string; description: string };
  data_quality: number;
  known_dimensions: string[];
  contributions: { cis: number; vuln: number; cia: number; ctrl: number; risk: number };
  cis_pass_rate?: number | null;
  active_vulns: number;
  total_vulns: number;
  cia_known: boolean;
  control_coverage_pct: number;
  active_risks: number;
  total_risks: number;
};

type Dashboard = {
  assets: AssetRow[];
  summary: {
    asset_count: number;
    scored_count: number;
    avg_score: number;
    by_band: Record<string, number>;
    highest_score: number;
    highest_name?: string | null;
  };
  weights: { cis: number; vuln: number; cia: number; ctrl: number; risk: number };
};

const BAND_COLOR: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  moderate: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  unknown: 'bg-slate-100 text-slate-700 border-slate-200',
};

const BAND_BAR: Record<string, string> = {
  low: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  high: 'bg-orange-500',
  critical: 'bg-rose-500',
};

// Higher score = MORE risk, so the colour scale is inverted vs. compliance.
// This is a sanctioned severity ramp (low=emerald, moderate=amber, high=orange,
// critical=rose) — a genuine multi-value data scale, not brand chrome.
const BAND_HEX: Record<string, string> = {
  low: '#10b981', moderate: '#f59e0b', high: '#f97316', critical: '#f43f5e', unknown: '#cbd5e1',
};
function riskHex(score: number): string {
  if (score >= 75) return '#f43f5e';
  if (score >= 50) return '#f97316';
  if (score >= 25) return '#f59e0b';
  return '#10b981';
}
const BAND_META: Array<{ key: 'low' | 'moderate' | 'high' | 'critical'; label: string; range: string }> = [
  { key: 'critical', label: 'Critical', range: '75–100' },
  { key: 'high',     label: 'High',     range: '50–74' },
  { key: 'moderate', label: 'Moderate', range: '25–49' },
  { key: 'low',      label: 'Low',      range: '0–24' },
];

type SortKey = 'score' | 'name' | 'data_quality' | 'cis' | 'open_vulns';
type SortDir = 'asc' | 'desc';

export default function RiskPosturePage() {
  const [filterBand, setFilterBand] = useState<string>('');
  const [searchQ, setSearchQ] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [weightsOpen, setWeightsOpen] = useState(false);
  // Tune Weights modifies tenant-wide scoring formula — Tenant Admin only.
  // Scanning Admin can read but not change. Auditor / Banking User can't see.
  const { isAdmin } = usePermissions();
  const toast = useToast();

  const q = useQuery<Dashboard>({
    queryKey: ['risk-posture.dashboard'],
    queryFn: async () => (await riskPostureApi.dashboard()).data,
    refetchInterval: 30000,
  });

  const filtered = useMemo(() => {
    let rows = q.data?.assets ?? [];
    if (filterBand) rows = rows.filter((a) => a.band.label === filterBand);
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      rows = rows.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.host_name || '').toLowerCase().includes(q) ||
          (a.asset_type || '').toLowerCase().includes(q)
      );
    }
    const sortFns: Record<SortKey, (a: AssetRow) => number | string> = {
      score: (a) => a.score ?? -1,
      name: (a) => a.name.toLowerCase(),
      data_quality: (a) => a.data_quality,
      cis: (a) => a.cis_pass_rate ?? -1,
      open_vulns: (a) => a.active_vulns ?? 0,
    };
    rows = [...rows].sort((a, b) => {
      const av = sortFns[sortKey](a);
      const bv = sortFns[sortKey](b);
      const cmp = typeof av === 'string' ? (av as string).localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [q.data, filterBand, searchQ, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };
  const sortIndicator = (k: SortKey) => (sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  if (q.isLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading risk posture…</div>;
  }
  if (q.isError || !q.data) {
    return <div className="p-6 text-sm text-rose-600">Failed to load risk posture.</div>;
  }

  const { summary } = q.data;

  return (
    <div className="p-4 space-y-4">
      <WeightsPanel open={weightsOpen} onClose={() => setWeightsOpen(false)} />
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 ring-1 ring-rose-100">
            <ShieldAlert className="h-5 w-5 text-rose-600" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Risk Posture</h1>
            <p className="text-xs text-slate-500">Composite risk score per asset — higher means more risk.</p>
          </div>
        </div>
        <button
          onClick={() => {
            if (!isAdmin) {
              toast.toast({
                title: 'Permission required',
                message: 'Only the Tenant Administrator can change risk weights.',
                type: 'warning',
              });
              return;
            }
            setWeightsOpen(true);
          }}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm whitespace-nowrap ${
            isAdmin ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
          }`}
          title={isAdmin ? 'Customise how each dimension contributes to the score' : 'Tenant Administrators only'}
        >
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.75} /> Tune weights
        </button>
      </div>

      {/* ─── Executive hero: portfolio gauge + band distribution ──────── */}
      <section className="grid gap-3 lg:grid-cols-[260px_1fr]">
        {/* Portfolio risk gauge */}
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="relative h-[160px] w-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart innerRadius="76%" outerRadius="100%" data={[{ value: summary.avg_score }]} startAngle={90} endAngle={-270}>
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar dataKey="value" cornerRadius={10} fill={riskHex(summary.avg_score)} background={{ fill: '#f1f5f9' }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-bold tabular-nums" style={{ color: riskHex(summary.avg_score) }}>{summary.avg_score}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">avg risk / 100</span>
            </div>
          </div>
          <p className="mt-1 text-center text-xs text-slate-500">
            {summary.scored_count} of {summary.asset_count} assets scored
            {summary.by_band.unknown ? <span className="text-amber-600"> · {summary.by_band.unknown} unknown</span> : null}
          </p>
        </div>

        {/* Band distribution — clickable to filter the table below */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Assets by risk band</h3>
            {filterBand && (
              <button onClick={() => setFilterBand('')} className="text-[11px] font-medium text-primary-700 hover:underline">Clear filter</button>
            )}
          </div>
          {/* stacked distribution bar */}
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            {BAND_META.map((b) => {
              const n = summary.by_band[b.key] || 0;
              const total = BAND_META.reduce((a, x) => a + (summary.by_band[x.key] || 0), 0) || 1;
              return n > 0 && <div key={b.key} style={{ width: `${(n / total) * 100}%`, backgroundColor: BAND_HEX[b.key] }} title={`${b.label}: ${n}`} />;
            })}
          </div>
          {/* clickable band cards */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BAND_META.map((b) => {
              const n = summary.by_band[b.key] || 0;
              const active = filterBand === b.key;
              return (
                <button
                  key={b.key}
                  onClick={() => setFilterBand(active ? '' : b.key)}
                  className={`rounded-xl border p-3 text-left transition-all ${active ? 'shadow-md ring-2 ring-offset-1' : 'border-slate-200 hover:-translate-y-0.5 hover:shadow-sm'}`}
                  style={active ? { borderColor: BAND_HEX[b.key], boxShadow: `0 0 0 2px ${BAND_HEX[b.key]}` } : undefined}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BAND_HEX[b.key] }} />
                    <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: BAND_HEX[b.key] }}>{b.label}</span>
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{n}</div>
                  <div className="text-[10px] text-slate-400">score {b.range}</div>
                </button>
              );
            })}
          </div>
          {/* highest-risk callout */}
          {summary.highest_name && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-rose-100">
              <Crown className="h-3.5 w-3.5 shrink-0 text-rose-500" />
              <span className="flex-1">Highest risk: <strong>{summary.highest_name}</strong> at {summary.highest_score}/100</span>
            </div>
          )}
        </div>
      </section>

      {/* Search + sort toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search asset name, host or type…"
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div className="text-xs text-slate-500">
          Showing <strong className="text-slate-900">{filtered.length}</strong> of {q.data.assets.length}
        </div>
        {(searchQ || filterBand) && (
          <button
            onClick={() => { setSearchQ(''); setFilterBand(''); }}
            className="text-xs text-primary-700 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Asset list */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="text-left px-4 py-2.5 cursor-pointer select-none hover:text-slate-900" onClick={() => toggleSort('name')}>
                  Asset{sortIndicator('name')}
                </th>
                <th className="text-left px-4 py-2.5 w-32">Host</th>
                <th className="text-right px-4 py-2.5 w-28 cursor-pointer select-none hover:text-slate-900" onClick={() => toggleSort('score')}>
                  Risk Score{sortIndicator('score')}
                </th>
                <th className="text-left px-4 py-2.5 w-44">Breakdown</th>
                <th className="text-right px-4 py-2.5 w-16 cursor-pointer select-none hover:text-slate-900" onClick={() => toggleSort('cis')}>
                  CIS{sortIndicator('cis')}
                </th>
                <th className="text-right px-4 py-2.5 w-16 cursor-pointer select-none hover:text-slate-900" onClick={() => toggleSort('open_vulns')}>
                  Vulns{sortIndicator('open_vulns')}
                </th>
                <th className="text-right px-4 py-2.5 w-16">Risks</th>
                <th className="text-right px-4 py-2.5 w-20">Ctrl</th>
                <th className="text-right px-4 py-2.5 w-20">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-2">
                    <EmptyState
                      icon="🛡️"
                      title={
                        searchQ
                          ? `No assets match "${searchQ}"`
                          : filterBand
                          ? `No assets in the "${filterBand}" band`
                          : 'No assets in this tenant yet'
                      }
                      description={
                        searchQ || filterBand
                          ? 'Try clearing filters above.'
                          : 'Add assets via the IT Assets module — they arrive over the asset API from your CMDB or push agents, then AI classifies them for the right CIS rules.'
                      }
                      primaryAction={
                        searchQ || filterBand
                          ? { label: 'Clear filters', onClick: () => { setSearchQ(''); setFilterBand(''); } }
                          : { label: 'Go to IT Assets', href: '/assets' }
                      }
                      // Bulk Discovery secondary action removed — feature was
                      // cut per product owner direction.
                    />
                  </td>
                </tr>
              )}
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/risk-posture/asset/${a.id}`}
                      className="font-medium text-primary-700 hover:underline"
                    >
                      {a.name}
                    </Link>
                    {a.criticality && (
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-0.5">{a.criticality}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {a.host_name || <span className="text-slate-400 italic">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {a.score == null ? (
                        <span className="text-xs text-slate-400 italic">No data</span>
                      ) : (
                        <span className="text-base font-semibold text-slate-900">{a.score}</span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase ${
                          BAND_COLOR[a.band.label] ?? 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {a.band.label}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {a.score == null ? (
                      <span className="text-xs text-slate-400 italic">Onboard to measure</span>
                    ) : (
                      <>
                        {/* 5-series categorical data-viz: CIS / Vuln / CIA / Ctrl / Risk
                            dimensions. Palette preserved to match the dimension legend
                            in the weights panel and asset detail. */}
                        <div
                          className="flex h-2 w-full rounded-full overflow-hidden bg-slate-100"
                          title={`CIS ${a.contributions.cis} · Vuln ${a.contributions.vuln} · CIA ${a.contributions.cia} · Ctrl ${a.contributions.ctrl} · Risk ${a.contributions.risk}`}
                        >
                          <div className="bg-red-400" style={{ width: `${a.contributions.cis}%` }} />
                          <div className="bg-orange-400" style={{ width: `${a.contributions.vuln}%` }} />
                          <div className="bg-purple-400" style={{ width: `${a.contributions.cia}%` }} />
                          <div className="bg-blue-400" style={{ width: `${a.contributions.ctrl}%` }} />
                          <div className="bg-pink-400" style={{ width: `${a.contributions.risk}%` }} />
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1 flex gap-1.5 flex-wrap">
                          <span><span className="inline-block w-1.5 h-1.5 bg-red-400 rounded-sm mr-0.5" />{a.contributions.cis}</span>
                          <span><span className="inline-block w-1.5 h-1.5 bg-orange-400 rounded-sm mr-0.5" />{a.contributions.vuln}</span>
                          <span><span className="inline-block w-1.5 h-1.5 bg-purple-400 rounded-sm mr-0.5" />{a.contributions.cia}</span>
                          <span><span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-sm mr-0.5" />{a.contributions.ctrl}</span>
                          <span><span className="inline-block w-1.5 h-1.5 bg-pink-400 rounded-sm mr-0.5" />{a.contributions.risk}</span>
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-700">
                    {a.cis_pass_rate == null ? <span className="text-slate-400">—</span> : `${a.cis_pass_rate}%`}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-700" title={`${a.active_vulns} active of ${a.total_vulns} total linked`}>
                    {a.active_vulns}
                    {a.total_vulns > a.active_vulns && (
                      <span className="text-slate-400 text-[10px]"> /{a.total_vulns}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-700" title={`${a.active_risks} active of ${a.total_risks} total linked`}>
                    {a.active_risks}
                    {a.total_risks > a.active_risks && (
                      <span className="text-slate-400 text-[10px]"> /{a.total_risks}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-700">{a.control_coverage_pct}%</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/risk-posture/asset/${a.id}`}
                      title="View details"
                      aria-label="View details"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-primary-700"
                    >
                      <Eye className="h-4 w-4" strokeWidth={1.75} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
