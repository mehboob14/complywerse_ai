import { Link, useRoute } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { riskPostureApi } from '@/lib/api';

type Posture = {
  asset: {
    id: number;
    name: string;
    host_name?: string | null;
    ip_address?: string | null;
    asset_type?: string | null;
    criticality?: string | null;
    owner_name?: string | null;
  };
  score: number | null;
  band: { label: string; description: string };
  weights: { cis: number; vuln: number; cia: number; ctrl: number; risk: number };
  data_quality: number;
  known_dimensions: string[];
  components: {
    cis: { score: number; known: boolean; passed: number; failed: number; never_scanned?: number; total: number; pass_rate: number | null };
    vuln: { score: number; known: boolean; raw_points: number; open_count: number; active_count: number; total_linked: number; by_severity: Record<string, number>; by_status: Record<string, number> };
    cia: { score: number; known: boolean; confidentiality: number | null; integrity: number | null; availability: number | null; missing: boolean };
    ctrl: { score: number; known: boolean; coverage_pct: number; linked_count: number; target: number };
    risk: { score: number; known: boolean; open_count: number; active_count: number; total_linked: number; raw_points: number; by_status: Record<string, number> };
  };
  contributions: { cis: number; vuln: number; cia: number; ctrl: number; risk: number };
};

const BAND_COLOR: Record<string, string> = {
  low: 'bg-green-100 text-green-800 border-green-200',
  moderate: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  critical: 'bg-red-100 text-red-800 border-red-200',
  unknown: 'bg-gray-100 text-gray-700 border-gray-200',
};

const RING: Record<string, string> = {
  low: 'text-green-600',
  moderate: 'text-yellow-600',
  high: 'text-orange-600',
  critical: 'text-red-600',
  unknown: 'text-gray-400',
};

export default function RiskPostureAssetPage() {
  const [, params] = useRoute<{ id: string }>('/risk-posture/asset/:id');
  const assetId = params ? Number(params.id) : 0;

  const q = useQuery<Posture>({
    queryKey: ['risk-posture.asset', assetId],
    queryFn: async () => (await riskPostureApi.asset(assetId)).data,
    enabled: assetId > 0,
  });

  if (q.isLoading) return <div className="p-6 text-sm text-gray-500">Loading risk breakdown…</div>;
  if (q.isError || !q.data) {
    return (
      <div className="p-6">
        <Link href="/risk-posture" className="text-sm text-blue-600 hover:underline">
          ← Back to Risk Posture
        </Link>
        <div className="mt-4 text-sm text-red-600">Failed to load asset.</div>
      </div>
    );
  }

  const { asset, score, band, weights, components, contributions, data_quality, known_dimensions } = q.data;
  const bandLabel = band.label;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Link href="/risk-posture" className="text-sm text-blue-600 hover:underline">
        ← Back to Risk Posture
      </Link>

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              {asset.asset_type || 'Asset'}
            </div>
            <h1 className="text-2xl font-semibold text-gray-900">{asset.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-600">
              {asset.host_name && (
                <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{asset.host_name}</span>
              )}
              {asset.ip_address && (
                <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{asset.ip_address}</span>
              )}
              {asset.owner_name && <span>Owner: {asset.owner_name}</span>}
              {asset.criticality && (
                <span className="capitalize">Criticality: {asset.criticality}</span>
              )}
            </div>
          </div>
          <div className="text-center">
            <div className={`text-5xl font-bold ${RING[bandLabel] ?? 'text-gray-900'}`}>
              {score == null ? '—' : score}
            </div>
            <div className="text-xs text-gray-500">/ 100 risk score</div>
            <span
              className={`mt-2 inline-block px-3 py-1 rounded-full text-xs font-medium border uppercase ${
                BAND_COLOR[bandLabel] ?? 'bg-gray-100 text-gray-700'
              }`}
            >
              {bandLabel} — {band.description}
            </span>
            <div className="text-[10px] text-gray-500 mt-2">
              Data quality: <strong className={
                data_quality >= 75 ? 'text-green-700'
                : data_quality >= 50 ? 'text-yellow-700'
                : data_quality >= 25 ? 'text-orange-700'
                : 'text-red-700'
              }>{data_quality}%</strong>
              {' '}({known_dimensions.length}/5 dimensions)
            </div>
          </div>
        </div>
      </div>

      {/* Stacked contributions */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Score breakdown — which dimension contributed how much
        </h2>
        <div className="flex h-6 w-full rounded-md overflow-hidden bg-gray-100">
          <div className="bg-red-400 flex items-center justify-center text-[10px] text-white font-medium"
               style={{ width: `${contributions.cis}%` }}
               title={`CIS contributes ${contributions.cis} of ${score} points`}>
            {contributions.cis > 4 && contributions.cis}
          </div>
          <div className="bg-orange-400 flex items-center justify-center text-[10px] text-white font-medium"
               style={{ width: `${contributions.vuln}%` }}
               title={`Vulns contribute ${contributions.vuln} points`}>
            {contributions.vuln > 4 && contributions.vuln}
          </div>
          <div className="bg-purple-400 flex items-center justify-center text-[10px] text-white font-medium"
               style={{ width: `${contributions.cia}%` }}
               title={`CIA contributes ${contributions.cia} points`}>
            {contributions.cia > 4 && contributions.cia}
          </div>
          <div className="bg-blue-400 flex items-center justify-center text-[10px] text-white font-medium"
               style={{ width: `${contributions.ctrl}%` }}
               title={`Control gap contributes ${contributions.ctrl} points`}>
            {contributions.ctrl > 4 && contributions.ctrl}
          </div>
          <div className="bg-pink-400 flex items-center justify-center text-[10px] text-white font-medium"
               style={{ width: `${contributions.risk}%` }}
               title={`Linked risks contribute ${contributions.risk} points`}>
            {contributions.risk > 4 && contributions.risk}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-700">
          <span className={`flex items-center gap-1.5 ${!components.cis.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-red-400 rounded-sm" /> CIS gap ({Math.round(weights.cis * 100)}%) → {contributions.cis} pts {!components.cis.known && '(no data)'}
          </span>
          <span className={`flex items-center gap-1.5 ${!components.vuln.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-orange-400 rounded-sm" /> Vulnerabilities ({Math.round(weights.vuln * 100)}%) → {contributions.vuln} pts
          </span>
          <span className={`flex items-center gap-1.5 ${!components.cia.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-purple-400 rounded-sm" /> CIA value ({Math.round(weights.cia * 100)}%) → {contributions.cia} pts {!components.cia.known && '(no data)'}
          </span>
          <span className={`flex items-center gap-1.5 ${!components.ctrl.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-blue-400 rounded-sm" /> Control gap ({Math.round(weights.ctrl * 100)}%) → {contributions.ctrl} pts
          </span>
          <span className={`flex items-center gap-1.5 ${!components.risk.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-pink-400 rounded-sm" /> Linked risks ({Math.round(weights.risk * 100)}%) → {contributions.risk} pts {!components.risk.known && '(no data)'}
          </span>
        </div>
      </div>

      {/* Four detail panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* CIS panel */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">
              <span className="inline-block w-2 h-2 bg-red-400 rounded-sm mr-2" />
              CIS Benchmark
            </h3>
            <Link
              href={`/compliance/plugins/asset/${asset.id}`}
              className="text-xs text-blue-600 hover:underline"
            >
              View CIS details →
            </Link>
          </div>
          {components.cis.total === 0 ? (
            <p className="text-xs text-gray-500">
              No approved CIS rules in the library yet. Upload a CIS PDF in
              Plugin Automation to start scoring this dimension.
            </p>
          ) : components.cis.pass_rate == null ? (
            <p className="text-xs text-gray-500">No scans yet for this asset.</p>
          ) : (
            <>
              <div className="flex items-end gap-3">
                <div className="text-3xl font-semibold text-gray-900">{components.cis.pass_rate}%</div>
                <div className="text-xs text-gray-500 pb-1">pass rate</div>
              </div>
              <div className="text-xs text-gray-600 mt-2 space-y-0.5">
                <div>✅ Passed: <strong>{components.cis.passed}</strong></div>
                <div>❌ Failed: <strong>{components.cis.failed}</strong></div>
                {components.cis.never_scanned ? (
                  <div>⏳ Never scanned: <strong>{components.cis.never_scanned}</strong> (counted toward gap)</div>
                ) : null}
                <div>Total rules: {components.cis.total}</div>
              </div>
            </>
          )}
        </div>

        {/* Vulns panel */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">
              <span className="inline-block w-2 h-2 bg-orange-400 rounded-sm mr-2" />
              Vulnerabilities
            </h3>
            <Link
              href="/vulnerabilities"
              className="text-xs text-blue-600 hover:underline"
            >
              View all vulns →
            </Link>
          </div>
          <div className="flex items-end gap-3">
            <div className="text-3xl font-semibold text-gray-900">{components.vuln.active_count}</div>
            <div className="text-xs text-gray-500 pb-1">
              active
              {components.vuln.total_linked > components.vuln.active_count && (
                <span className="text-gray-400"> ({components.vuln.total_linked} total linked)</span>
              )}
            </div>
          </div>
          <div className="text-xs text-gray-600 mt-2 space-y-0.5">
            <div>🔴 Critical: <strong>{components.vuln.by_severity.critical}</strong></div>
            <div>🟠 High: <strong>{components.vuln.by_severity.high}</strong></div>
            <div>🟡 Medium: <strong>{components.vuln.by_severity.medium}</strong></div>
            <div>🟢 Low: <strong>{components.vuln.by_severity.low}</strong></div>
            {Object.keys(components.vuln.by_status).length > 0 && (
              <div className="pt-1 text-gray-500">
                Status mix:{' '}
                {Object.entries(components.vuln.by_status).map(([s, n], i) => (
                  <span key={s}>
                    {i > 0 && ', '}{n} {s}
                  </span>
                ))}
              </div>
            )}
            <div className="pt-1 text-gray-400">Severity-weighted points: {components.vuln.raw_points}</div>
          </div>
        </div>

        {/* CIA panel */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">
              <span className="inline-block w-2 h-2 bg-purple-400 rounded-sm mr-2" />
              CIA Criticality
            </h3>
            <Link
              href={`/assets/${asset.id}`}
              className="text-xs text-blue-600 hover:underline"
            >
              Edit ratings →
            </Link>
          </div>
          {components.cia.missing ? (
            <p className="text-xs text-amber-700">
              CIA ratings missing on this asset. Update in IT Assets to refine
              the risk score. Defaulted to moderate (0.5).
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="text-center">
                <div className="text-2xl font-semibold text-gray-900">
                  {components.cia.confidentiality ?? '–'}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Confidentiality</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-gray-900">
                  {components.cia.integrity ?? '–'}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Integrity</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-gray-900">
                  {components.cia.availability ?? '–'}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Availability</div>
              </div>
            </div>
          )}
        </div>

        {/* Controls panel */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">
              <span className="inline-block w-2 h-2 bg-blue-400 rounded-sm mr-2" />
              Control Coverage
            </h3>
            <Link
              href={`/assets/${asset.id}`}
              className="text-xs text-blue-600 hover:underline"
            >
              Link controls →
            </Link>
          </div>
          <div className="flex items-end gap-3">
            <div className="text-3xl font-semibold text-gray-900">{components.ctrl.coverage_pct}%</div>
            <div className="text-xs text-gray-500 pb-1">covered</div>
          </div>
          <div className="text-xs text-gray-600 mt-2">
            <strong>{components.ctrl.linked_count}</strong> of target{' '}
            <strong>{components.ctrl.target}</strong> controls linked to this asset.
          </div>
          {components.ctrl.coverage_pct < 50 && (
            <div className="mt-2 text-xs text-amber-700">
              Coverage below 50% — link more controls in IT Assets to reduce
              this dimension's risk contribution.
            </div>
          )}
        </div>

        {/* Risks panel */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">
              <span className="inline-block w-2 h-2 bg-pink-400 rounded-sm mr-2" />
              Linked Risks
            </h3>
            <Link href="/risks" className="text-xs text-blue-600 hover:underline">
              View all risks →
            </Link>
          </div>
          {components.risk.total_linked === 0 ? (
            <p className="text-xs text-gray-500">
              No risks have been linked to this asset yet. Link them from the
              Risk Management module to factor them into the score.
            </p>
          ) : (
            <>
              <div className="flex items-end gap-3">
                <div className="text-3xl font-semibold text-gray-900">{components.risk.active_count}</div>
                <div className="text-xs text-gray-500 pb-1">
                  active
                  {components.risk.total_linked > components.risk.active_count && (
                    <span className="text-gray-400"> ({components.risk.total_linked} total linked)</span>
                  )}
                </div>
              </div>
              <div className="text-xs text-gray-600 mt-2 space-y-0.5">
                {Object.entries(components.risk.by_status).map(([s, n]) => (
                  <div key={s}>
                    <span className="capitalize">{s}</span>: <strong>{n}</strong>
                  </div>
                ))}
                <div className="pt-1 text-gray-400">
                  Residual-score points: {components.risk.raw_points}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
