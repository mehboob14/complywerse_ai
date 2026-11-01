'use client';

/**
 * Assets Risk Posture — C-level executive dashboard (redesign).
 *
 * Answers, in order: how exposed are we (mean asset risk + band), where does the
 * risk concentrate (bands, concentration list, risk-vs-criticality heat), which
 * dimensions drive it (contribution decomposition), external vs internal, how
 * complete is the picture (measurement coverage), and what to fix first.
 *
 * Every number is read live from ONE endpoint (/risk-posture/dashboard) and every
 * aggregate below is computed client-side from that payload — nothing is sampled,
 * trended or faked. A dimension with no evidence drops out of the score (backend),
 * so coverage is reported honestly and unscored assets are never shown as 0.
 *
 * Built on the Performance dashboard's primitives (../../dashboard/_components) so
 * the two exec views share one visual system: product tokens (#005B96, Poppins,
 * white cards on a grey canvas), the AA-validated band palette, equal-height
 * flex-fill cards, and the zoom:0.8 density lever. Layout is a STRICT 2-per-row
 * grid under one thin hero strip; the shell <main> owns the page scroll.
 */
import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search as SearchIcon, RefreshCw, SlidersHorizontal, Activity, ShieldAlert, Target, Layers } from 'lucide-react';
import { riskPostureApi } from '@/cyber-assurance/lib/api';
import { dnsName, externalUnitKey, isExternalAsset } from '@/cyber-assurance/lib/domains';
import WeightsPanel from '../_weights-panel';
import { usePermissions } from '@/cyber-assurance/hooks/usePermissions';
import { useToast } from '@/cyber-assurance/components/ui/ToastProvider';
import {
  T, FONT, CARD_SHADOW, Card, Eyebrow, Pill, Empty, Loading,
  BAND, BAND_ORDER, toBand, nfmt, alpha, type Band,
} from '../../dashboard/_components/kit';
import { Gauge, StackBar, PartLegend, BarList, type Part, type BarRow } from '../../dashboard/_components/charts';

const MUTED = '#64748B', FAINT = '#94A3B8', INK = '#0F172A';

/* Real backend dashboard shape (risk_posture/service.py::compute_tenant_posture). */
type AssetRow = {
  id: number; name: string; host_name?: string | null; asset_type?: string | null;
  mode?: string | null; criticality?: string | null;
  internet_facing?: boolean | null; is_internet_facing?: boolean | null; origin_source?: string | null; last_seen_source?: string | null;
  is_external?: boolean | null; owner_id?: number | null; cde_environment?: boolean | null;
  score: number | null; band: { label: string; description?: string };
  data_quality: number; known_dimensions: string[];
  contributions: Record<string, number>;
  cis_pass_rate?: number | null; active_vulns?: number | null; total_vulns?: number | null;
  cia_known?: boolean; control_coverage_pct?: number | null; active_risks?: number | null; total_risks?: number | null;
};
type Dashboard = {
  assets: AssetRow[];
  summary: { asset_count: number; scored_count: number; avg_score: number | null; by_band: Record<string, number>; highest_score: number | null; highest_name?: string | null };
  weights: Record<string, number>;
};

/* Friendly dimension labels — mirrors the backend's internal + outside-in dimension keys. */
const DIM: Record<string, string> = {
  vuln: 'Vulnerabilities', cis: 'CIS hardening gap', cia: 'Business-impact value', ctrl: 'Control gap', risk: 'Linked risks',
  hygiene: 'Exposure hygiene', exploitability: 'Exploitability', exposure: 'Internet exposure', business: 'Business impact', subdomains: 'Subdomain exposure',
};
const isExternal = (a: AssetRow) => isExternalAsset(a);  // single source of truth (@/lib/domains)
const titleCase = (s?: string | null) => (s || '').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const bandKey = (a: AssetRow): Band => toBand(a.band?.label, a.score);
const isUnassessed = (c?: string | null) => !c || /not assessed/i.test(c);

/** Top driver for one asset = the dimension contributing the most points to its score. */
function topDriver(a: AssetRow): string {
  const entries = Object.entries(a.contributions || {}) as [string, number][];
  if (!entries.length) return 'No dominant driver yet';
  const [k, v] = entries.reduce((m, e) => (e[1] > m[1] ? e : m), ['', -1] as [string, number]);
  if (v <= 0) return 'No dominant driver';
  const ev = k === 'vuln' ? `${a.active_vulns ?? 0} active vuln${a.active_vulns === 1 ? '' : 's'}`
    : k === 'cis' ? (a.cis_pass_rate != null ? `CIS ${a.cis_pass_rate}% pass` : 'CIS fails')
    : k === 'ctrl' ? `${a.control_coverage_pct ?? 0}% controls covered`
    : k === 'risk' ? `${a.active_risks ?? 0} active risk${a.active_risks === 1 ? '' : 's'}`
    : a.criticality ? `criticality ${a.criticality.toLowerCase()}` : '';
  return (DIM[k] || titleCase(k)) + (ev ? ` · ${ev}` : '');
}

/** Avg contribution points per dimension across a set of assets (only where the dimension is measured). */
function driverRows(list: AssetRow[], dims: string[]): BarRow[] {
  return dims.map((k) => {
    const known = list.filter((a) => (a.known_dimensions ?? []).includes(k));
    const avg = known.length ? known.reduce((s, a) => s + (a.contributions?.[k] ?? 0), 0) / known.length : null;
    return { key: k, label: DIM[k] ?? titleCase(k), n: avg, value: avg == null ? undefined : avg.toFixed(1), title: `${known.length} of ${list.length} assets measured` };
  }).filter((r) => (r.n ?? 0) > 0).sort((a, b) => (b.n ?? -1) - (a.n ?? -1));
}

const Insight = ({ children }: { children: ReactNode }) => (
  <p className="m-0 mb-3 text-[12px] leading-[1.55] text-[#334155]">{children}</p>
);
const BandWord = ({ k }: { k: Band }) => <b className="font-semibold" style={{ color: BAND[k].ink }}>{BAND[k].label.toLowerCase()}</b>;
const Hl = ({ children }: { children: ReactNode }) => <b className="font-semibold text-[#0F172A]">{children}</b>;

export default function RiskPostureWorkspace() {
  const router = useRouter();
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const toast = useToast();
  const [term, setTerm] = useState('');
  const [weightsOpen, setWeightsOpen] = useState(false);
  // Auto-refresh cadence in minutes (0 = Off). Default 5; remembered per viewer.
  // Loaded in an effect (not the initializer) to avoid an SSR hydration mismatch.
  const [refreshMin, setRefreshMin] = useState<number>(5);
  useEffect(() => {
    try { const v = Number(localStorage.getItem('rp.refreshMin')); if (Number.isFinite(v) && v >= 0 && v <= 10) setRefreshMin(v); } catch {}
  }, []);
  const setRefresh = (m: number) => { setRefreshMin(m); try { localStorage.setItem('rp.refreshMin', String(m)); } catch {} };

  const q = useQuery<Dashboard>({ queryKey: ['risk-posture.dashboard'], queryFn: async () => (await riskPostureApi.dashboard()).data, refetchInterval: refreshMin ? refreshMin * 60000 : false });

  const assets = useMemo(() => q.data?.assets ?? [], [q.data]);
  const summary = q.data?.summary;
  const weights = q.data?.weights ?? {};

  const D = useMemo(() => {
    const scored = assets.filter((a) => a.score != null);
    const ext = assets.filter(isExternal);
    const int = assets.filter((a) => !isExternal(a));
    const avg = (rows: AssetRow[]) => { const s = rows.filter((a) => a.score != null); return s.length ? Math.round(s.reduce((t, a) => t + (a.score || 0), 0) / s.length) : null; };
    // External assets roll up by registrable (apex) domain — ONE domain = one
    // asset — so the count reconciles with the register and the mean isn't swamped
    // by one domain's subdomains. Each apex takes the WEAKEST (highest-risk) score
    // among its names (the register's domain rule), then we average those.
    const extUnits = new Map<string, number | null>();
    for (const a of ext) {
      const k = externalUnitKey(a, dnsName(a));
      const cur = extUnits.get(k);
      if (a.score != null) extUnits.set(k, cur == null ? a.score : Math.max(cur, a.score));
      else if (!extUnits.has(k)) extUnits.set(k, null);
    }
    const extUnitScores = Array.from(extUnits.values()).filter((v): v is number => v != null);
    const extCount = extUnits.size;
    const extAvgRolled = extUnitScores.length ? Math.round(extUnitScores.reduce((t, v) => t + v, 0) / extUnitScores.length) : null;

    // Driver decomposition — avg points per dimension, split by model (outside-in vs tunable-weight).
    const extDims = Array.from(new Set(ext.flatMap((a) => a.known_dimensions ?? [])));
    const intDims = Object.keys(weights).length ? Object.keys(weights) : Array.from(new Set(int.flatMap((a) => a.known_dimensions ?? [])));
    const intDrivers = driverRows(int, intDims);
    const extDrivers = driverRows(ext, extDims);

    // Measurement coverage — the two scan-driven dimensions are the real blind spots
    // (cia/ctrl/risk are policy-counted on every asset by the backend).
    const cisN = int.filter((a) => (a.known_dimensions ?? []).includes('cis')).length;
    const vulnN = assets.filter((a) => (a.known_dimensions ?? []).includes('vuln')).length;
    const extScored = ext.filter((a) => a.score != null).length;
    const avgDQ = scored.length ? Math.round(scored.reduce((s, a) => s + (a.data_quality || 0), 0) / scored.length) : null;

    // Exposure gaps.
    const critNotAssessed = assets.filter((a) => isUnassessed(a.criticality)).length;
    const noControls = int.filter((a) => (a.control_coverage_pct ?? 0) === 0).length;
    const openVulns = assets.reduce((s, a) => s + (a.active_vulns || 0), 0);
    const unscored = assets.filter((a) => a.score == null).length;

    // Risk × business-criticality heat.
    const CRIT: { key: string; label: string }[] = [
      { key: 'critical', label: 'Critical' }, { key: 'high', label: 'High' }, { key: 'medium', label: 'Medium' }, { key: 'low', label: 'Low' }, { key: 'na', label: 'Not assessed' },
    ];
    const cols: Band[] = [...BAND_ORDER, ...(unscored ? (['unknown'] as Band[]) : [])];
    const matrix: Record<string, Record<string, number>> = {};
    CRIT.forEach((c) => { matrix[c.key] = {}; cols.forEach((b) => (matrix[c.key][b] = 0)); });
    assets.forEach((a) => {
      const ck = isUnassessed(a.criticality) ? 'na' : (a.criticality || '').toLowerCase();
      if (!matrix[ck]) return;
      matrix[ck][bandKey(a)] += 1;
    });
    const critRows = CRIT.filter((c) => cols.reduce((s, b) => s + matrix[c.key][b], 0) > 0);
    const heatMax = Math.max(1, ...CRIT.flatMap((c) => cols.map((b) => matrix[c.key][b])));
    const dangerCount = ['critical', 'high'].reduce((s, ck) => s + (matrix[ck]?.severe || 0) + (matrix[ck]?.elevated || 0), 0);

    // Act-first worklist = severe + elevated, worst first.
    const actFirst = scored.filter((a) => bandKey(a) === 'severe' || bandKey(a) === 'elevated').sort((a, b) => (b.score || 0) - (a.score || 0));

    return {
      scored, ext, int, extAvg: extAvgRolled, intAvg: avg(int), extCount,
      intDrivers, extDrivers, topIntDriver: intDrivers[0] ?? null,
      cisN, vulnN, extScored, avgDQ,
      critNotAssessed, noControls, openVulns, unscored,
      CRIT: critRows, cols, matrix, heatMax, dangerCount, actFirst,
    };
  }, [assets, weights]);

  const total = summary?.asset_count ?? 0;
  // `total` is the rolled MANAGED-asset count (apex domain = one asset, same basis
  // as the register); `hosts` is the flat host count the drill-down lists show. They
  // differ when external domains fold subdomains in, so label the host figure to
  // keep "6 assets" and a 12-host list from reading like a contradiction.
  const hosts = assets.length;
  const hostNote = hosts !== total ? ` (${nfmt(hosts)} hosts)` : '';

  const recalc = () => {
    qc.invalidateQueries({ queryKey: ['risk-posture.dashboard'] });
    toast.toast({ title: 'Recalculating', message: `Re-scoring ${total} assets from live signals.`, type: 'info' });
  };
  const tuneWeights = () => {
    if (!hasPermission('compliance:scan:execute')) {
      toast.toast({ title: 'Permission required', message: 'Only an administrator or scan operator can change risk weights.', type: 'warning' });
      return;
    }
    setWeightsOpen(true);
  };

  if (q.isLoading) return (
    <Shell weightsOpen={weightsOpen} setWeightsOpen={setWeightsOpen}>
      <section className={`rounded-[14px] border border-[#E2E5EC] bg-white p-6 ${CARD_SHADOW}`}>
        <Loading rows={5} note="Scoring every asset live from scan, hardening and business-impact signals — this takes a few seconds." />
      </section>
    </Shell>
  );
  if (q.isError || !q.data || !summary) return (
    <Shell weightsOpen={weightsOpen} setWeightsOpen={setWeightsOpen}>
      <section className={`rounded-[14px] border border-[#E2E5EC] bg-white p-4 ${CARD_SHADOW}`}>
        <Empty icon={<ShieldAlert size={16} />} title="Risk posture didn't load" body="The scoring service didn't respond. Try again in a moment." />
      </section>
    </Shell>
  );

  const avg = summary.avg_score;
  const avgBand: Band = toBand(null, avg);
  const severe = summary.by_band.severe ?? 0, elevated = summary.by_band.elevated ?? 0;
  const bandParts: Part[] = [...BAND_ORDER.map((k) => ({ key: k, label: BAND[k].label, n: summary.by_band[k] ?? 0, c: BAND[k].c })),
    ...(summary.by_band.unknown ? [{ key: 'unknown', label: 'Unscored', n: summary.by_band.unknown, c: BAND.unknown.c }] : [])];
  const weightRows: BarRow[] = Object.entries(weights).map(([k, w]) => ({ key: k, label: DIM[k] ?? titleCase(k), n: Math.round(w * 100), value: `${Math.round(w * 100)}%` }))
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0));

  const concentration = assets
    .filter((a) => { const t = term.trim().toLowerCase(); return !t || a.name.toLowerCase().includes(t) || (a.host_name || '').toLowerCase().includes(t) || (a.asset_type || '').toLowerCase().includes(t); })
    .slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return (
    <Shell weightsOpen={weightsOpen} setWeightsOpen={setWeightsOpen}>
      {/* ── Hero strip — the only full-width element ── */}
      <section className={`flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[14px] border border-[#E2E5EC] bg-white px-4 py-3 ${CARD_SHADOW}`} style={{ borderLeft: `3px solid ${T.base}` }}>
        <div className="min-w-0 flex-1 basis-[320px]">
          <Eyebrow>Executive summary</Eyebrow>
          <p className="m-0 mt-0.5 text-[13.5px] leading-[1.5]">
            {avg == null ? (
              <>No asset has a risk score yet — connect telemetry or run a scan to measure posture across <Hl>{nfmt(total)}</Hl> assets{hostNote}.</>
            ) : (
              <>Mean asset risk is <Hl>{avg}</Hl>/100 (<BandWord k={avgBand} />) across <Hl>{nfmt(total)}</Hl> assets{hostNote} — <Hl>{nfmt(severe)}</Hl> severe, <Hl>{nfmt(elevated)}</Hl> elevated.
                {' '}External <Hl>{nfmt(D.extCount)}</Hl> avg <Hl>{D.extAvg ?? '—'}</Hl> · internal <Hl>{nfmt(D.int.length)}</Hl> avg <Hl>{D.intAvg ?? '—'}</Hl>.</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11.5px] text-[#64748B]">
          <span>Scored <b className="tabular-nums text-[#0F172A]">{nfmt(summary.scored_count)}</b> of {nfmt(total)} · live</span>
          <label className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#E2E5EC] bg-white pl-2.5 pr-1.5 text-[12px] font-semibold text-[#334155]" title="How often the dashboard recalculates risk on its own">
            <RefreshCw size={12} aria-hidden className={q.isFetching ? 'animate-spin' : ''} style={{ color: T.base }} />
            <span className="text-[#64748B]">Auto-refresh</span>
            <select value={refreshMin} onChange={(e) => setRefresh(Number(e.target.value))} aria-label="Auto-refresh interval"
              className="cursor-pointer border-0 bg-transparent pr-1 text-[12px] font-semibold text-[#0F172A] outline-none">
              <option value={0}>Off</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
          <button type="button" onClick={tuneWeights}
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#E2E5EC] bg-white px-3 text-[12px] font-semibold text-[#334155] hover:bg-[#F6F7FB]">
            <SlidersHorizontal size={13} aria-hidden style={{ color: T.base }} />Tune weights
          </button>
          <button type="button" onClick={recalc} disabled={q.isFetching}
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#005B96] bg-[#005B96] px-3 text-[12px] font-semibold text-white hover:bg-[#014A81] disabled:opacity-70">
            <RefreshCw size={13} aria-hidden className={q.isFetching ? 'animate-spin' : ''} />{q.isFetching ? 'Recalculating' : 'Recalculate'}
          </button>
        </div>
      </section>

      {/* ── 2-per-row grid ── every row stretches to equal heights; each card body flex-fills ── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">

        {/* Row 1A — Mean asset risk gauge */}
        <Card title="Mean asset risk" sub="Average across the estate · 0–100, higher is worse">
          {avg == null || !summary.scored_count ? (
            <Empty icon={<Activity size={16} />} title="No asset scored yet" body="Scores appear once assets carry scan, hardening or business-impact data." />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center">
              <div className="relative max-w-full">
                <Gauge value={avg} color={BAND[avgBand].c} label={`Mean asset risk ${avg} of 100, band ${BAND[avgBand].label}`} width={236} />
                <div className="pointer-events-none absolute inset-x-0 bottom-[26px] flex flex-col items-center">
                  <span className="text-[34px] font-semibold leading-none text-[#0F172A] tabular-nums">{avg}</span>
                  <span className="mt-1 text-[10.5px] text-[#94A3B8]">avg risk / 100</span>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-2"><Pill tone={BAND[avgBand]} /><span className="text-[12px] text-[#64748B]">{BAND[avgBand].desc}</span></div>
              <div className="mt-4 grid w-full grid-cols-2 gap-2.5">
                <div className="rounded-[10px] border border-[#E7EBF0] bg-[#F8FAFC] px-3 py-2">
                  <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[.05em] text-[#2E63A8]">Internal</p>
                  <p className="m-0 flex items-baseline gap-1.5"><b className="text-[19px] tabular-nums">{nfmt(D.int.length)}</b><span className="text-[11px] text-[#64748B]">avg {D.intAvg ?? '—'}</span></p>
                  <p className="m-0 text-[10px] text-[#94A3B8]">agent-collected</p>
                </div>
                <div className="rounded-[10px] border border-[#E7EBF0] bg-[#F8FAFC] px-3 py-2">
                  <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[.05em] text-[#6A54C9]">External</p>
                  <p className="m-0 flex items-baseline gap-1.5"><b className="text-[19px] tabular-nums">{nfmt(D.extCount)}</b><span className="text-[11px] text-[#64748B]">avg {D.extAvg ?? '—'}</span></p>
                  <p className="m-0 text-[10px] text-[#94A3B8]">outside-in</p>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Row 1B — Assets by risk band */}
        <Card title="Assets by risk band" sub="Where the estate sits on the risk scale">
          {!total ? <Empty icon={<Layers size={16} />} title="No assets in scope" /> : (
            <div className="flex flex-1 flex-col">
              <Insight>
                {severe + elevated > 0
                  ? <><Hl>{nfmt(severe + elevated)}</Hl> asset{severe + elevated === 1 ? '' : 's'} need attention — <BandWord k="severe" /> or <BandWord k="elevated" />.</>
                  : <>No asset is in a <BandWord k="severe" /> or <BandWord k="elevated" /> band — the estate looks healthy.</>}
              </Insight>
              <div className="mb-3 flex items-baseline justify-between"><Eyebrow>Distribution</Eyebrow><span className="text-[11px] text-[#64748B]">{nfmt(summary.scored_count)} of {nfmt(total)} scored</span></div>
              <StackBar parts={bandParts} label="Assets by risk band" height={16} />
              <div className="mt-3 flex-1"><PartLegend parts={bandParts.map((p) => ({ ...p, hint: BAND[p.key as Band]?.desc }))} total={total} cols={1} fill /></div>
              {summary.highest_name && (
                <div className="mt-3 flex items-center gap-2 rounded-[10px] bg-[#FBEAEA] px-3 py-2 text-[11.5px]">
                  <ShieldAlert size={14} aria-hidden style={{ color: BAND.severe.c }} />
                  <span className="min-w-0 flex-1 truncate text-[#7F1D1D]">Highest risk · <b className="font-semibold">{summary.highest_name}</b></span>
                  <b className="shrink-0 tabular-nums" style={{ color: BAND.severe.c }}>{summary.highest_score}</b>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Row 2A — What drives the risk */}
        <Card title="What drives the risk" sub="Avg points each dimension adds to the score">
          {!summary.scored_count ? <Empty icon={<Target size={16} />} title="Nothing scored yet" body="Driver mix appears once assets are scored." /> : (
            <div className="flex flex-1 flex-col">
              <Insight>
                {D.topIntDriver
                  ? <><Hl>{D.topIntDriver.label}</Hl> is the biggest driver of internal risk (<Hl>{D.topIntDriver.value}</Hl> avg pts).</>
                  : <>External exposure is the only scored dimension so far.</>}
              </Insight>
              <div className="flex flex-1 flex-col gap-3">
                {[
                  { show: D.int.length > 0 && D.intDrivers.length > 0, label: 'Internal', c: '#475569', bg: '#F1F5F9', note: 'tunable weights', rows: D.intDrivers },
                  { show: D.ext.length > 0 && D.extDrivers.length > 0, label: 'External', c: T.base, bg: alpha(T.base, 0.07), note: 'outside-in model', rows: D.extDrivers },
                ].filter((g) => g.show).map((g) => {
                  const max = Math.max(1, ...g.rows.map((r) => r.n ?? 0));
                  return (
                    <div key={g.label} className="flex flex-1 flex-col">
                      <div className="flex items-center gap-2 rounded-[8px] py-[6px] pl-3 pr-2.5" style={{ background: g.bg, boxShadow: `inset 3px 0 0 ${g.c}` }}>
                        <h3 className="m-0 whitespace-nowrap font-semibold !text-[12px] !leading-[1.3]" style={{ color: g.c }}>{g.label} assets</h3>
                        <span className="shrink-0 rounded-full bg-white px-[7px] text-[10.5px] font-semibold leading-[18px] tabular-nums" style={{ color: g.c }}>{nfmt(g.label === 'Internal' ? D.int.length : D.ext.length)}</span>
                        <span className="ml-auto text-[10.5px] text-[#64748B]">{g.note}</span>
                      </div>
                      <div className="flex flex-1 flex-col pl-3 pt-2.5">
                        <BarList rows={g.rows.slice(0, 4)} max={max} labelWidth={150} color={g.c} fill />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        {/* Row 2B — Risk concentration (searchable ranked list of all assets) */}
        <Card title="Risk concentration" sub="Every host ranked by score · open the breakdown">
          <div className="relative mb-2.5">
            <SearchIcon aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[#94A3B8]" />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search assets…"
              className="h-9 w-full rounded-[9px] border border-[#E2E5EC] bg-white pl-8 pr-3 text-[12px] outline-none focus:border-[#005B96]" />
          </div>
          {concentration.length === 0 ? (
            <Empty compact title="No assets match" body={term ? 'Clear the search to see the full estate.' : undefined} />
          ) : (
            <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-px overflow-y-auto p-0 pr-0.5" style={{ maxHeight: 340 }}>
              {concentration.map((a) => {
                const tone = BAND[bandKey(a)];
                const sub = [titleCase(a.asset_type), a.host_name].filter(Boolean).join(' · ');
                return (
                  <li key={a.id}>
                    <button onClick={() => router.push(`/cyber-assurance/risk-posture/asset/${a.id}`)}
                      className="flex w-full items-center gap-3 rounded-[8px] px-2 py-[7px] text-left hover:bg-[#F6F8FB]">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[12.5px] font-semibold text-[#0F172A]">{a.name}</span>
                          <span className="shrink-0 rounded-[4px] px-1 py-px text-[8.5px] font-bold tracking-[.03em]" style={{ background: isExternal(a) ? '#EEEBFA' : '#E9F1FB', color: isExternal(a) ? '#6A54C9' : '#2E63A8' }}>{isExternal(a) ? 'EXT' : 'INT'}</span>
                        </span>
                        <span className="block truncate text-[10.5px] text-[#94A3B8]">{sub || '—'}</span>
                      </span>
                      {a.score == null ? (
                        <span className="text-[11px] italic text-[#94A3B8]">Unscored</span>
                      ) : (
                        <>
                          <span className="h-[7px] w-[80px] shrink-0 overflow-hidden rounded-full bg-[#EEF1F5]"><i className="block h-full rounded-full" style={{ width: `${a.score}%`, background: tone.c }} /></span>
                          <b className="w-[24px] shrink-0 text-right text-[12.5px] tabular-nums" style={{ color: tone.c }}>{a.score}</b>
                          <span className="w-[76px] shrink-0 text-right"><Pill tone={tone} /></span>
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Row 3A — Risk vs business criticality heat */}
        <Card title="Risk vs. business criticality" sub="Does danger sit on the assets that matter most?">
          {D.CRIT.length === 0 ? <Empty icon={<Target size={16} />} title="Nothing to map yet" /> : (
            <div className="flex flex-1 flex-col">
              <Insight>
                {D.dangerCount > 0
                  ? <><Hl>{nfmt(D.dangerCount)}</Hl> business-critical / high asset{D.dangerCount === 1 ? '' : 's'} sit in <BandWord k="severe" /> or <BandWord k="elevated" /> — fix these first.</>
                  : <>No critical or high-criticality asset is in a <BandWord k="severe" /> or <BandWord k="elevated" /> band.</>}
              </Insight>
              <div className="min-h-0 flex-1">
              <table className="h-full w-full table-fixed" style={{ borderCollapse: 'separate', borderSpacing: 3 }}>
                <colgroup><col style={{ width: 92 }} />{D.cols.map((b) => <col key={b} />)}<col style={{ width: 34 }} /></colgroup>
                <thead>
                  <tr>
                    <th className="pb-1 text-left align-bottom text-[10px] font-semibold text-[#64748B]">Criticality</th>
                    {D.cols.map((b) => (
                      <th key={b} className="pb-1 text-center align-bottom text-[10px] font-semibold" style={{ color: BAND[b].ink }} title={BAND[b].label}>{BAND[b].label}</th>
                    ))}
                    <th className="pb-1 pr-0.5 text-right align-bottom text-[10px] font-semibold text-[#64748B]">Σ</th>
                  </tr>
                </thead>
                <tbody>
                  {D.CRIT.map((c) => {
                    const rowTotal = D.cols.reduce((s, b) => s + D.matrix[c.key][b], 0);
                    return (
                      <tr key={c.key}>
                        <th scope="row" className="text-left text-[11.5px] font-medium text-[#334155]" style={{ color: c.key === 'na' ? FAINT : '#334155' }}>{c.label}</th>
                        {D.cols.map((b) => {
                          const n = D.matrix[c.key][b];
                          return (
                            <td key={b} title={`${c.label} · ${BAND[b].label}: ${n}`}
                              className="rounded-[6px] text-center text-[12.5px] tabular-nums"
                              style={{ padding: '7px 1px', fontWeight: n ? 700 : 400, background: n ? alpha(BAND[b].c, 0.14 + 0.26 * (n / D.heatMax)) : '#F6F7FB', color: n ? BAND[b].ink : '#CBD5E1' }}>
                              {n || '·'}
                            </td>
                          );
                        })}
                        <td className="pr-0.5 text-right text-[12px] font-semibold tabular-nums text-[#0F172A]">{rowTotal}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </Card>

        {/* Row 3B — Scoring policy (weights) */}
        <Card title="Scoring policy" sub="How this tenant's composite risk score is weighted">
          <div className="flex flex-1 flex-col">
            <Insight>Scores blend five dimensions on your tenant's policy. Any dimension with no evidence drops out, so every asset is judged only on what's actually measured.</Insight>
            {weightRows.length ? (
              <div className="flex-1"><BarList rows={weightRows} max={100} labelWidth={150} color={T.base} fill /></div>
            ) : <Empty compact title="Using default weights" />}
            <p className="m-0 mt-3 rounded-[8px] bg-[#F6F7FB] px-3 py-2 text-[11px] leading-[1.5] text-[#64748B]">
              External assets use a fixed <b className="font-medium text-[#334155]">outside-in</b> model — exposure, exploitability, hygiene and business impact — not these weights.
            </p>
            <button type="button" onClick={tuneWeights}
              className="mt-2.5 inline-flex h-9 items-center justify-center gap-1.5 rounded-[9px] border border-[#E2E5EC] bg-white text-[12px] font-semibold text-[#334155] hover:bg-[#F6F7FB]">
              <SlidersHorizontal size={13} aria-hidden style={{ color: T.base }} />Tune weights
            </button>
          </div>
        </Card>

        {/* Row 4A — Where to act first */}
        <Card title="Where to act first" sub="Severe & elevated assets, worst first" href="/cyber-assurance/vulnerabilities" cta="Open findings">
          {D.actFirst.length === 0 ? (
            <Empty icon={<Target size={16} />} title="Nothing in Severe or Elevated" body="No asset currently needs urgent remediation — healthy posture across the estate." />
          ) : (
            <>
              <Insight><Hl>{nfmt(D.actFirst.length)}</Hl> asset{D.actFirst.length === 1 ? '' : 's'} in <BandWord k="severe" /> / <BandWord k="elevated" /> — each row shows the dominant driver to brief the fix.</Insight>
              <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-1.5 overflow-y-auto p-0 pr-0.5" style={{ maxHeight: 340 }}>
                {D.actFirst.map((a) => {
                  const tone = BAND[bandKey(a)];
                  return (
                    <li key={a.id}>
                      <button onClick={() => router.push(`/cyber-assurance/risk-posture/asset/${a.id}`)}
                        className="flex w-full items-start gap-3 rounded-[9px] border border-[#F0F3F5] px-3 py-2 text-left hover:border-[#E2E5EC] hover:bg-[#F6F8FB]">
                        <span className="mt-px grid h-[32px] w-[32px] shrink-0 place-items-center rounded-[8px] text-[14px] font-bold tabular-nums" style={{ background: tone.bg, color: tone.ink }}>{a.score}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[12.5px] font-semibold text-[#0F172A]">{a.name}</span>
                            <span className="shrink-0"><Pill tone={tone} /></span>
                          </span>
                          <span className="block truncate text-[11px] text-[#475569]">{topDriver(a)}</span>
                          <span className="block truncate text-[10.5px] text-[#94A3B8]">{isExternal(a) ? 'External' : 'Internal'} · criticality {a.criticality ? a.criticality.toLowerCase() : 'not assessed'}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>

        {/* Row 4B — Measurement coverage & gaps */}
        <Card title="Measurement coverage" sub="How complete the risk picture is — and the blind spots">
          <div className="flex flex-1 flex-col">
            <Insight>
              {D.avgDQ != null
                ? <>The risk picture is <Hl>{D.avgDQ}%</Hl> complete on average. Hardening is measured on <Hl>{nfmt(D.cisN)}</Hl> of {nfmt(D.int.length)} internal assets; vulnerability data on <Hl>{nfmt(D.vulnN)}</Hl> of {nfmt(total)}.</>
                : <>Nothing is scored yet — connect telemetry or run a scan to start measuring coverage.</>}
            </Insight>
            <div className="flex flex-1 flex-col justify-between gap-2.5 py-1">
              <CoverageBar label="CIS hardening scanned" n={D.cisN} d={D.int.length} />
              <CoverageBar label="Vulnerability data linked" n={D.vulnN} d={total} />
              <CoverageBar label="External hosts graded" n={D.extScored} d={D.ext.length} />
            </div>
            <div className="flex flex-wrap gap-1.5 pt-3">
              <GapPill n={D.critNotAssessed} label="criticality not assessed" tone="warn" />
              <GapPill n={D.noControls} label="no controls mapped" tone="muted" />
              <GapPill n={D.unscored} label="not yet scored" tone="muted" />
              <GapPill n={D.openVulns} label="active vulns" tone="danger" onClick={() => router.push('/cyber-assurance/vulnerabilities')} />
            </div>
          </div>
        </Card>

      </div>
    </Shell>
  );
}

/* ---- shell + small presentational helpers ---- */
function Shell({ weightsOpen, setWeightsOpen, children }: { weightsOpen: boolean; setWeightsOpen: (v: boolean) => void; children: ReactNode }) {
  return (
    <div data-risk-dash className="mx-auto flex w-full max-w-[1880px] flex-col gap-3 pb-6 text-[#0F172A]" style={{ fontFamily: FONT, zoom: 0.8 }}>
      <style>{'main:has([data-risk-dash]){background:#EDF0F5}'}</style>
      <h1 className="sr-only">Assets Risk Posture — executive view</h1>
      <WeightsPanel open={weightsOpen} onClose={() => setWeightsOpen(false)} />
      {children}
    </div>
  );
}

function CoverageBar({ label, n, d }: { label: string; n: number; d: number }) {
  const pct = d > 0 ? Math.round((n / d) * 100) : null;
  const full = pct != null && pct >= 90;
  const col = pct == null ? '#CBD5E1' : pct >= 75 ? '#047857' : pct >= 40 ? '#B45309' : '#B91C1C';
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11.5px]">
        <span className="text-[#334155]">{label}</span>
        <span className="tabular-nums text-[#64748B]">{d === 0 ? 'none in scope' : <><b className="font-semibold text-[#0F172A]">{nfmt(n)}</b> of {nfmt(d)}{pct != null && <span className="ml-1 text-[#94A3B8]">· {pct}%{full ? '' : ''}</span>}</>}</span>
      </div>
      <div className="mt-1 h-[8px] overflow-hidden rounded-[4px] bg-[#EEF1F5]">
        {pct != null && <i className="block h-full rounded-[4px]" style={{ width: `${Math.max(pct, n > 0 ? 3 : 0)}%`, background: col }} />}
      </div>
    </div>
  );
}

function GapPill({ n, label, tone, onClick }: { n: number; label: string; tone: 'warn' | 'danger' | 'muted'; onClick?: () => void }) {
  const dot = tone === 'danger' ? '#B91C1C' : tone === 'warn' ? '#B45309' : '#94A3B8';
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border border-[#E2E5EC] bg-white px-2.5 py-1 text-[11px] ${onClick ? 'cursor-pointer hover:bg-[#F6F7FB]' : 'cursor-default'}`}>
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot }} />
      <b className="tabular-nums text-[#0F172A]">{nfmt(n)}</b>
      <span className="text-[#5B6673]">{label}</span>
      {onClick && <span className="text-[#C6CDD4]">›</span>}
    </button>
  );
}
