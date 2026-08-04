import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { riskPostureApi } from '@/lib/api';
import EmptyState from '@/components/common/EmptyState';
import WeightsPanel from './_weights-panel';
import { usePermissions } from '@/hooks/usePermissions';

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
  low: 'bg-green-100 text-green-800 border-green-200',
  moderate: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  critical: 'bg-red-100 text-red-800 border-red-200',
  unknown: 'bg-gray-100 text-gray-700 border-gray-200',
};

const BAND_BAR: Record<string, string> = {
  low: 'bg-green-500',
  moderate: 'bg-yellow-500',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
};

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
    return <div className="p-6 text-sm text-gray-500">Loading risk posture…</div>;
  }
  if (q.isError || !q.data) {
    return <div className="p-6 text-sm text-red-600">Failed to load risk posture.</div>;
  }

  const { summary, weights } = q.data;
  const bandKeys: Array<'low' | 'moderate' | 'high' | 'critical'> = ['low', 'moderate', 'high', 'critical'];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <WeightsPanel open={weightsOpen} onClose={() => setWeightsOpen(false)} />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-2xl font-semibold text-gray-900">Unified Risk Posture</h1>
          <p className="text-sm text-gray-600 mt-1">
            Composite risk score per asset combining CIS compliance, open
            vulnerabilities, CIA criticality, and control coverage. Score is
            0-100, higher means more risk.
          </p>
        </div>
        <button
          onClick={() => {
            if (!isAdmin) {
              // Show toast instead of hiding the button — normal users
              // still see Compliverse the same way the admin does,
              // they just bump into a lock when they try to change
              // tenant-wide settings.
              alert("🔒 Permission required\n\nOnly the Tenant Administrator can change risk weights. Ask your admin to give you the Administrator role if you need to tune the scoring formula.");
              return;
            }
            setWeightsOpen(true);
          }}
          className={`px-3 py-2 text-sm rounded-md border whitespace-nowrap flex-shrink-0 ${
            isAdmin
              ? "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              : "border-gray-300 bg-gray-50 text-gray-400 cursor-not-allowed hover:bg-gray-50"
          }`}
          title={isAdmin
            ? "Customise how each dimension contributes to the composite score"
            : "Tenant Administrators only — your role can view the scoring formula but not change it"}
        >
          {isAdmin ? "⚙ Tune weights" : "🔒 Tune weights"}
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm sm:col-span-2">
          <div className="text-xs uppercase tracking-wide text-gray-500">Average Risk Score</div>
          <div className="mt-1 text-3xl font-semibold text-gray-900">
            {summary.avg_score}
            <span className="text-base text-gray-400">/100</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            across {summary.scored_count} scored / {summary.asset_count} total
            {summary.by_band.unknown ? (
              <span className="text-amber-600 ml-1">({summary.by_band.unknown} unknown)</span>
            ) : null}
          </div>
        </div>
        {bandKeys.map((b) => (
          <button
            key={b}
            onClick={() => setFilterBand(filterBand === b ? '' : b)}
            className={`bg-white border rounded-lg p-4 shadow-sm text-left transition-shadow hover:shadow-md ${
              filterBand === b ? 'ring-2 ring-blue-500' : ''
            }`}
          >
            <div className={`text-xs uppercase tracking-wide font-medium ${
              b === 'low' ? 'text-green-700'
              : b === 'moderate' ? 'text-yellow-700'
              : b === 'high' ? 'text-orange-700' : 'text-red-700'
            }`}>
              {b}
            </div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">
              {summary.by_band[b] ?? 0}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              {b === 'low' ? '0–24'
              : b === 'moderate' ? '25–49'
              : b === 'high' ? '50–74' : '75+'}
            </div>
          </button>
        ))}
      </div>

      {/* Weights explanation */}
      <div className="bg-blue-50 border border-blue-100 rounded-md px-4 py-3 text-xs text-blue-900">
        <strong className="text-blue-700">Formula:</strong>{' '}
        Score = {Math.round(weights.cis * 100)}% CIS gap
        + {Math.round(weights.vuln * 100)}% vulnerabilities
        + {Math.round(weights.cia * 100)}% CIA criticality
        + {Math.round(weights.ctrl * 100)}% control gap
        + {Math.round(weights.risk * 100)}% linked-risk residual.
        Dimensions with no data are excluded and remaining weights are
        renormalized — the <strong>Data Quality</strong> column shows what
        percentage of the formula could actually be measured.
      </div>

      {/* Search + sort toolbar */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search asset name, host or type…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="text-xs text-gray-500">
          Showing <strong className="text-gray-900">{filtered.length}</strong> of {q.data.assets.length}
        </div>
        {(searchQ || filterBand) && (
          <button
            onClick={() => { setSearchQ(''); setFilterBand(''); }}
            className="text-xs text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Asset list */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
              <tr>
                <th className="text-left px-4 py-2.5 cursor-pointer select-none hover:text-gray-900" onClick={() => toggleSort('name')}>
                  Asset{sortIndicator('name')}
                </th>
                <th className="text-left px-4 py-2.5 w-32">Host</th>
                <th className="text-right px-4 py-2.5 w-28 cursor-pointer select-none hover:text-gray-900" onClick={() => toggleSort('score')}>
                  Risk Score{sortIndicator('score')}
                </th>
                <th className="text-right px-4 py-2.5 w-24 cursor-pointer select-none hover:text-gray-900" onClick={() => toggleSort('data_quality')}>
                  Data Quality{sortIndicator('data_quality')}
                </th>
                <th className="text-left px-4 py-2.5 w-44">Breakdown</th>
                <th className="text-right px-4 py-2.5 w-16 cursor-pointer select-none hover:text-gray-900" onClick={() => toggleSort('cis')}>
                  CIS{sortIndicator('cis')}
                </th>
                <th className="text-right px-4 py-2.5 w-16 cursor-pointer select-none hover:text-gray-900" onClick={() => toggleSort('open_vulns')}>
                  Vulns{sortIndicator('open_vulns')}
                </th>
                <th className="text-right px-4 py-2.5 w-16">Risks</th>
                <th className="text-right px-4 py-2.5 w-20">Ctrl</th>
                <th className="text-right px-4 py-2.5 w-20">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-2">
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
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/risk-posture/asset/${a.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {a.name}
                    </Link>
                    {a.criticality && (
                      <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-0.5">{a.criticality}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {a.host_name || <span className="text-gray-400 italic">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {a.score == null ? (
                        <span className="text-xs text-gray-400 italic">No data</span>
                      ) : (
                        <span className="text-base font-semibold text-gray-900">{a.score}</span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase ${
                          BAND_COLOR[a.band.label] ?? 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {a.band.label}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs font-medium ${
                        a.data_quality >= 75 ? 'text-green-700'
                        : a.data_quality >= 50 ? 'text-yellow-700'
                        : a.data_quality >= 25 ? 'text-orange-700'
                        : 'text-red-700'
                      }`}>
                        {a.data_quality}%
                      </span>
                      <div className="w-16 h-1 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            a.data_quality >= 75 ? 'bg-green-500'
                            : a.data_quality >= 50 ? 'bg-yellow-500'
                            : a.data_quality >= 25 ? 'bg-orange-500'
                            : 'bg-red-500'
                          }`}
                          style={{ width: `${a.data_quality}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {a.score == null ? (
                      <span className="text-xs text-gray-400 italic">Onboard to measure</span>
                    ) : (
                      <>
                        <div
                          className="flex h-2 w-full rounded-full overflow-hidden bg-gray-100"
                          title={`CIS ${a.contributions.cis} · Vuln ${a.contributions.vuln} · CIA ${a.contributions.cia} · Ctrl ${a.contributions.ctrl} · Risk ${a.contributions.risk}`}
                        >
                          <div className="bg-red-400" style={{ width: `${a.contributions.cis}%` }} />
                          <div className="bg-orange-400" style={{ width: `${a.contributions.vuln}%` }} />
                          <div className="bg-purple-400" style={{ width: `${a.contributions.cia}%` }} />
                          <div className="bg-blue-400" style={{ width: `${a.contributions.ctrl}%` }} />
                          <div className="bg-pink-400" style={{ width: `${a.contributions.risk}%` }} />
                        </div>
                        <div className="text-[10px] text-gray-500 mt-1 flex gap-1.5 flex-wrap">
                          <span><span className="inline-block w-1.5 h-1.5 bg-red-400 rounded-sm mr-0.5" />{a.contributions.cis}</span>
                          <span><span className="inline-block w-1.5 h-1.5 bg-orange-400 rounded-sm mr-0.5" />{a.contributions.vuln}</span>
                          <span><span className="inline-block w-1.5 h-1.5 bg-purple-400 rounded-sm mr-0.5" />{a.contributions.cia}</span>
                          <span><span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-sm mr-0.5" />{a.contributions.ctrl}</span>
                          <span><span className="inline-block w-1.5 h-1.5 bg-pink-400 rounded-sm mr-0.5" />{a.contributions.risk}</span>
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-700">
                    {a.cis_pass_rate == null ? <span className="text-gray-400">—</span> : `${a.cis_pass_rate}%`}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-700" title={`${a.active_vulns} active of ${a.total_vulns} total linked`}>
                    {a.active_vulns}
                    {a.total_vulns > a.active_vulns && (
                      <span className="text-gray-400 text-[10px]"> /{a.total_vulns}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-700" title={`${a.active_risks} active of ${a.total_risks} total linked`}>
                    {a.active_risks}
                    {a.total_risks > a.active_risks && (
                      <span className="text-gray-400 text-[10px]"> /{a.total_risks}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-700">{a.control_coverage_pct}%</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/risk-posture/asset/${a.id}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Drill down
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
