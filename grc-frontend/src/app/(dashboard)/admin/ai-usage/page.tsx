'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  adminApi,
  TokenUsageOverview,
  TokenBudgets,
  TokenBudgetsUpdate,
} from '@/lib/api';

/* ------------------------------------------------------------------ tokens */
const C = {
  pageBg: '#F4F3EE', card: '#FFFFFF', cardBorder: '#E3E2D9', rowBorder: '#F2F1E9',
  subtle: '#FAF9F4', subtle2: '#FCFBF7', ink: '#1C221F', ink2: '#39423C', muted: '#5B655F',
  faint: '#77807A', disabled: '#9BA69F', track: '#EDECE4', inputBorder: '#DDDDD4',
  green: '#0E5A46', greenHover: '#0A483A', amber: '#B08420', rust: '#A33B1F',
  rustBg: '#F7E4DC', rustBorder: '#E4BCA9', rustText: '#7A2D17', sep: '#C6CBC6',
  slateFallback: '#55606B',
};
const SANS = '"IBM Plex Sans", system-ui, -apple-system, Segoe UI, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const GRID = 'minmax(170px,1fr) 84px 72px minmax(90px,120px) 60px';

/* ------------------------------------------------------------------ format */
const fmtTokens = (n: number) => {
  const a = Math.abs(n || 0);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n || 0);
};
const fmtFull = (n: number) => new Intl.NumberFormat().format(n || 0);
const money = (n: number) => '$' + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const utilColor = (pct: number) => (pct >= 85 ? C.rust : pct >= 70 ? C.amber : C.green);

const RANGES = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: 'cycle', label: 'Billing cycle' },
] as const;

function Trend({ v }: { v: number }) {
  if (!v) return <span style={{ color: C.disabled, fontFamily: MONO, fontSize: 12 }}>–</span>;
  const up = v > 0;
  return (
    <span style={{ color: up ? C.rust : C.green, fontFamily: MONO, fontSize: 12, fontWeight: 500 }}>
      {up ? '▲' : '▼'} {Math.abs(v).toFixed(1)}%
    </span>
  );
}

/* ================================================================== page */
export default function TokenUsagePage() {
  const [range, setRange] = useState<string>('24h');
  const [data, setData] = useState<TokenUsageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [showBudgets, setShowBudgets] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [live, setLive] = useState(true);
  const firstPaint = useRef(true);

  // Load IBM Plex at runtime (progressive enhancement; falls back to system fonts).
  useEffect(() => {
    const id = 'ibm-plex-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res = await adminApi.getTokenUsageOverview(range);
      setData(res.data);
      setLastUpdated(Date.now());
      // default: first (largest) module expanded
      setExpanded((prev) => (Object.keys(prev).length ? prev : (res.data.modules[0] ? { [res.data.modules[0].module_key]: true } : {})));
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load token usage.');
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [range]);

  useEffect(() => { firstPaint.current = true; load(); }, [load]);

  // Real-time: poll every 15s while live, and refresh the moment the tab regains focus.
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => { if (!document.hidden) load(true); }, 15000);
    const onVis = () => { if (!document.hidden) load(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [live, load]);

  // Disable entrance animations after the first paint so silent refreshes don't flicker.
  useEffect(() => {
    if (!data) return;
    const t = window.setTimeout(() => { firstPaint.current = false; }, 600);
    return () => window.clearTimeout(t);
  }, [data]);
  const animate = firstPaint.current;

  const rangeDateFrom = useCallback(() => {
    const d = new Date();
    if (range === 'cycle') { d.setDate(1); d.setHours(0, 0, 0, 0); }
    else if (range === '24h') d.setHours(d.getHours() - 24);
    else d.setDate(d.getDate() - Number(range.replace('d', '')));
    return d.toISOString();
  }, [range]);

  // Axis/tooltip labels: clock time for the hourly (24h) view, calendar date otherwise.
  const fmtAxis = useCallback((iso: string) => {
    const d = new Date(iso);
    return data?.granularity === 'hour'
      ? d.toLocaleTimeString([], { hour: 'numeric' })
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }, [data?.granularity]);

  const exportCsv = async () => {
    const res = await adminApi.exportAIUsage({ date_from: rangeDateFrom() });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url; a.download = `token-usage-${range}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  /* ---------- table search + expansion ---------- */
  const q = query.trim().toLowerCase();
  const filteredModules = useMemo(() => {
    if (!data) return [];
    if (!q) return data.modules;
    return data.modules
      .map((m) => {
        const modHit = m.label.toLowerCase().includes(q) || m.module_key.toLowerCase().includes(q);
        const feats = m.features.filter((f) => f.label.toLowerCase().includes(q) || f.feature_key.toLowerCase().includes(q));
        if (modHit) return m;
        if (feats.length) return { ...m, features: feats };
        return null;
      })
      .filter(Boolean) as typeof data.modules;
  }, [data, q]);

  const isExpanded = (key: string) => (q ? true : !!expanded[key]);
  const toggle = (key: string) => setExpanded((p) => ({ ...p, [key]: !p[key] }));
  const expandAll = () => data && setExpanded(Object.fromEntries(data.modules.map((m) => [m.module_key, true])));
  const collapseAll = () => setExpanded({});

  /* ---------- chart ---------- */
  const chart = useMemo(() => {
    if (!data) return null;
    const modules = data.modules;
    const visible = modules.filter((m) => !hidden[m.module_key]);
    const totals = data.series.map((pt) => visible.reduce((s, m) => s + (pt.values[m.module_key] || 0), 0));
    const max = Math.max(1, ...totals);
    return { modules, visible, totals, max };
  }, [data, hidden]);

  return (
    <div style={{ background: C.pageBg, minHeight: '100%', fontFamily: SANS, color: C.ink }}>
      <style>{`
        @keyframes tuBar{from{transform:scaleY(0)}to{transform:scaleY(1)}}
        @keyframes tuFade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes tuPulse{0%,100%{opacity:1}50%{opacity:.3}}
        .tu-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
        .tu-row2{display:grid;grid-template-columns:2fr 1fr;gap:14px}
        @media(max-width:1100px){.tu-row2{grid-template-columns:1fr}}
        @media(max-width:720px){.tu-cards{grid-template-columns:repeat(2,1fr)}}
        .tu-tab:hover{color:${C.ink}!important}
        .tu-btn:hover{background:${C.greenHover}!important}
        .tu-row:hover{background:${C.subtle}}
        .tu-legend:hover{background:${C.pageBg}}
        .tu-link:hover{text-decoration:underline}
        .tu-txtbtn:hover{opacity:.7}
        .tu-input:focus{border-color:${C.green};background:#fff;outline:none}
        .tu-bar{transform-origin:bottom;animation:tuBar .5s ease both}
      `}</style>

      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '2px 2px 20px' }}>
        {/* breadcrumb */}
        <div style={{ fontSize: 12.5, color: C.faint, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>Administration</span>
          <span style={{ color: C.sep }}>/</span>
          <span style={{ color: C.ink, fontWeight: 500 }}>Token usage</span>
        </div>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.4px' }}>Token usage</h1>
            <p style={{ margin: '6px 0 0', fontSize: 13.5, color: C.muted }}>
              AI token consumption across modules · {data?.range_label ?? '—'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: live ? C.green : C.disabled, animation: live && !refreshing ? 'tuPulse 1.8s ease-in-out infinite' : undefined }} />
              <span style={{ fontSize: 12, color: C.faint }}>
                {refreshing ? 'Refreshing…' : live ? 'Live' : 'Paused'}
                {lastUpdated && !refreshing ? ` · updated ${new Date(lastUpdated).toLocaleTimeString()}` : ''}
              </span>
              <button onClick={() => load(true)} className="tu-txtbtn" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: C.green, fontFamily: SANS }}>Refresh</button>
              <button onClick={() => setLive((v) => !v)} className="tu-txtbtn" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: C.faint, fontFamily: SANS }}>{live ? 'Pause' : 'Go live'}</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', background: '#fff', border: `1px solid ${C.inputBorder}`, borderRadius: 8, padding: 3, gap: 2 }}>
              {RANGES.map((t) => {
                const active = range === t.key;
                return (
                  <button
                    key={t.key}
                    className="tu-tab"
                    onClick={() => setRange(t.key)}
                    style={{
                      border: 'none', cursor: 'pointer', fontFamily: SANS, fontSize: 12.5, fontWeight: 600,
                      padding: '7px 13px', borderRadius: 6,
                      background: active ? C.ink : 'transparent', color: active ? '#fff' : C.faint,
                    }}
                  >{t.label}</button>
                );
              })}
            </div>
            <button
              onClick={() => setShowBudgets(true)}
              className="tu-txtbtn"
              style={{ background: '#fff', border: `1px solid ${C.inputBorder}`, color: C.ink2, borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, fontFamily: SANS, cursor: 'pointer' }}
            >Budgets</button>
            <button
              onClick={exportCsv}
              className="tu-btn"
              style={{ background: C.green, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, fontFamily: SANS, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >Export CSV</button>
          </div>
        </div>

        {error && <div style={{ marginTop: 18, background: C.rustBg, border: `1px solid ${C.rustBorder}`, borderRadius: 10, padding: '12px 18px', color: C.rustText, fontSize: 13 }}>{error}</div>}

        {loading || !data ? (
          <div style={{ padding: '80px 0', textAlign: 'center', color: C.faint, fontSize: 14 }}>Loading token usage…</div>
        ) : (
          <>
            {/* alert banner */}
            {data.alert && (
              <div style={{ marginTop: 20, background: C.rustBg, border: `1px solid ${C.rustBorder}`, borderRadius: 10, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, animation: animate ? 'tuFade .4s ease both' : undefined }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.rust, flex: 'none' }} />
                <span style={{ fontSize: 13, color: C.rustText, fontWeight: 500, flex: 1 }}>{data.alert.text}</span>
                <button onClick={() => setShowBudgets(true)} className="tu-link" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: C.rust, fontFamily: SANS }}>Review budgets →</button>
              </div>
            )}

            {/* summary cards */}
            <div className="tu-cards" style={{ marginTop: 14, animation: animate ? 'tuFade .45s ease .05s both' : undefined }}>
              <SummaryCard label="Tokens used">
                <BigNum>{fmtTokens(data.summary.total_tokens)}</BigNum>
                <div style={{ marginTop: 12, height: 6, background: C.track, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(data.quota.cycle_pct, 100)}%`, background: data.quota.cycle_pct > 85 ? C.rust : C.green }} />
                </div>
                <Caption>{data.quota.cycle_pct}% of {fmtTokens(data.quota.monthly_quota)} monthly quota</Caption>
              </SummaryCard>

              <SummaryCard label="Estimated cost">
                <BigNum>{data.cost_configured ? money(data.summary.total_cost) : '—'}</BigNum>
                <Caption style={{ marginTop: 25 }}>
                  {data.cost_configured ? `Blended rate ${money(data.blended_rate_per_million)} / 1M tokens` : 'Rate not configured'}
                </Caption>
              </SummaryCard>

              <SummaryCard label="Daily average">
                <BigNum>{fmtTokens(data.summary.daily_average)}</BigNum>
                <Caption style={{ marginTop: 12 }}>
                  <Trend v={data.summary.trend_pct} /> <span style={{ color: C.muted }}>vs previous period</span>
                </Caption>
              </SummaryCard>

              {/* top module — inverted */}
              <div style={{ background: C.ink, border: `1px solid ${C.ink}`, borderRadius: 12, padding: '18px 20px', color: C.pageBg }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#9BA69F', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Top module</div>
                {data.top_module ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: data.top_module.color, flex: 'none' }} />
                      <span style={{ fontSize: 16, fontWeight: 600 }}>{data.top_module.label}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: '#9BA69F', marginTop: 10 }}>
                      <b style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, color: C.pageBg }}>{fmtTokens(data.top_module.tokens)}</b> · {data.top_module.share}% of all usage
                    </div>
                  </>
                ) : <div style={{ marginTop: 12, color: '#9BA69F', fontSize: 13 }}>No usage yet</div>}
              </div>
            </div>

            {/* chart row */}
            <div className="tu-row2" style={{ marginTop: 14, animation: animate ? 'tuFade .45s ease .12s both' : undefined }}>
              {/* usage over time */}
              <Card>
                <CardHead title="Usage over time" hint="stacked by module · click legend to isolate" />
                <div style={{ padding: '14px 20px 16px' }}>
                  <div style={{ height: 180, display: 'flex', alignItems: 'flex-end', gap: (chart && chart.totals.length > 40) ? 2 : 4 }}>
                    {chart && chart.totals.map((tot, i) => {
                      const pt = data.series[i];
                      const dateLabel = fmtAxis(pt.date);
                      return (
                        <div key={pt.date} className={animate ? 'tu-bar' : undefined} title={`${dateLabel} · ${fmtFull(tot)} tokens`}
                          style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', height: `${(tot / chart.max) * 100}%`, minHeight: tot ? 2 : 0, animationDelay: `${Math.min(i * 0.012, 0.4)}s` }}>
                          {chart.visible.map((m) => {
                            const v = pt.values[m.module_key] || 0;
                            if (!v) return null;
                            return <div key={m.module_key} style={{ height: `${(v / tot) * 100}%`, background: m.color, borderRadius: '2px 2px 0 0' }} />;
                          })}
                        </div>
                      );
                    })}
                  </div>
                  {/* x axis */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontFamily: MONO, fontSize: 11, color: C.disabled }}>
                    {data.series.length > 0 && (
                      <>
                        <span>{fmtAxis(data.series[0].date)}</span>
                        <span>{fmtAxis(data.series[Math.floor(data.series.length / 2)].date)}</span>
                        <span>{fmtAxis(data.series[data.series.length - 1].date)}</span>
                      </>
                    )}
                  </div>
                  {/* legend */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                    {data.modules.map((m) => {
                      const off = !!hidden[m.module_key];
                      return (
                        <button key={m.module_key} className="tu-legend"
                          onClick={() => setHidden((p) => ({ ...p, [m.module_key]: !p[m.module_key] }))}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 99, padding: '3px 8px', fontSize: 12, fontFamily: SANS, color: off ? C.disabled : C.ink2, textDecoration: off ? 'line-through' : 'none' }}>
                          <span style={{ width: 9, height: 9, borderRadius: 3, background: off ? '#D5D4CA' : m.color }} />
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Card>

              {/* budget utilization */}
              <Card>
                <CardHead title="Budget utilization" />
                <div style={{ padding: '6px 20px 4px' }}>
                  {data.utilization.length === 0 ? (
                    <div style={{ padding: '28px 0', textAlign: 'center', color: C.faint, fontSize: 12.5 }}>
                      No module budgets set. <button onClick={() => setShowBudgets(true)} className="tu-link" style={{ background: 'none', border: 'none', color: C.green, cursor: 'pointer', fontWeight: 600, fontFamily: SANS, fontSize: 12.5 }}>Set budgets →</button>
                    </div>
                  ) : data.utilization.map((u) => (
                    <div key={u.module_key} style={{ padding: '11px 0', borderBottom: `1px solid ${C.rowBorder}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: C.ink2 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: u.color }} />{u.label}
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>{fmtTokens(u.used)} / {fmtTokens(u.budget)}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
                        <div style={{ flex: 1, height: 6, background: C.track, borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(u.pct, 100)}%`, background: utilColor(u.pct), borderRadius: 3 }} />
                        </div>
                        <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: utilColor(u.pct), minWidth: 34, textAlign: 'right' }}>{u.pct.toFixed(0)}%</span>
                      </div>
                    </div>
                  ))}
                  <div style={{ borderTop: data.utilization.length ? `1px solid #EFEEE6` : 'none', marginTop: 4, padding: '12px 0 8px', fontSize: 12, color: C.muted }}>
                    Projected month-end usage:{' '}
                    <b style={{ fontFamily: MONO, color: data.projection_note.over ? C.rust : C.ink2 }}>{fmtTokens(data.projection_note.value)}</b>{' '}
                    of {fmtTokens(data.projection_note.quota)} quota
                  </div>
                </div>
              </Card>
            </div>

            {/* table row */}
            <div className="tu-row2" style={{ marginTop: 14, animation: animate ? 'tuFade .45s ease .2s both' : undefined }}>
              {/* usage by module */}
              <Card>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 20px', borderBottom: `1px solid ${C.rowBorder}`, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>Usage by module</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <input className="tu-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search modules & features"
                      style={{ maxWidth: 260, width: 200, background: C.subtle, border: `1px solid ${C.inputBorder}`, borderRadius: 7, padding: '7px 10px', fontSize: 12.5, fontFamily: SANS, color: C.ink }} />
                    <button onClick={expandAll} className="tu-txtbtn" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: C.green, fontFamily: SANS }}>Expand all</button>
                    <button onClick={collapseAll} className="tu-txtbtn" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: C.faint, fontFamily: SANS }}>Collapse</button>
                  </div>
                </div>
                {/* column header */}
                <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '8px 22px', background: C.subtle, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: C.faint, letterSpacing: '0.4px' }}>
                  <span>Module</span>
                  <span style={{ textAlign: 'right' }}>Tokens</span>
                  <span style={{ textAlign: 'right' }}>Cost</span>
                  <span>Share of total</span>
                  <span style={{ textAlign: 'right' }}>Trend</span>
                </div>
                <div>
                  {filteredModules.length === 0 ? (
                    <div style={{ padding: '32px 0', textAlign: 'center', color: C.faint, fontSize: 13 }}>{q ? 'No matches.' : 'No usage recorded yet.'}</div>
                  ) : filteredModules.map((m) => {
                    const open = isExpanded(m.module_key);
                    const overBudget = m.budget_pct != null && m.budget_pct > 70;
                    return (
                      <div key={m.module_key}>
                        <div className="tu-row" onClick={() => toggle(m.module_key)}
                          style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '10px 22px', borderTop: `1px solid ${C.rowBorder}`, cursor: 'pointer', alignItems: 'center' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>
                            <span style={{ color: C.disabled, fontSize: 10, width: 10 }}>{open ? '▾' : '▸'}</span>
                            <span style={{ width: 9, height: 9, borderRadius: 3, background: m.color, flex: 'none' }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
                            {overBudget && <span style={{ fontSize: 10.5, fontWeight: 600, color: C.rust, background: C.rustBg, borderRadius: 99, padding: '2px 7px', whiteSpace: 'nowrap' }}>{m.budget_pct!.toFixed(0)}% of budget</span>}
                          </span>
                          <span style={{ textAlign: 'right', fontFamily: MONO, fontSize: 12.5 }}>{fmtTokens(m.tokens)}</span>
                          <span style={{ textAlign: 'right', fontFamily: MONO, fontSize: 12, color: C.muted }}>{data.cost_configured ? money(m.cost) : '—'}</span>
                          <ShareCell share={m.share} color={m.color} />
                          <span style={{ textAlign: 'right' }}><Trend v={m.trend} /></span>
                        </div>
                        {open && m.features.map((f) => (
                          <div key={f.feature_key} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '7px 22px', borderTop: `1px solid ${C.rowBorder}`, background: C.subtle2, alignItems: 'center' }}>
                            <span style={{ paddingLeft: 27, fontSize: 12.5, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</span>
                            <span style={{ textAlign: 'right', fontFamily: MONO, fontSize: 12, color: C.ink2 }}>{fmtTokens(f.tokens)}</span>
                            <span style={{ textAlign: 'right', fontFamily: MONO, fontSize: 12, color: C.muted }}>{data.cost_configured ? money(f.cost) : '—'}</span>
                            <ShareCell share={f.share} color="#C9C8BE" thin />
                            <span style={{ textAlign: 'right' }}><Trend v={f.trend} /></span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* top consumers */}
              <Card>
                <div style={{ padding: '13px 20px 4px' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>Top consumers</div>
                  <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>Heaviest users this period</div>
                </div>
                <div style={{ padding: '4px 20px 0' }}>
                  {data.consumers.length === 0 ? (
                    <div style={{ padding: '24px 0', textAlign: 'center', color: C.faint, fontSize: 12.5 }}>No user activity yet.</div>
                  ) : data.consumers.map((c, i) => {
                    const top = data.consumers[0].tokens || 1;
                    const color = data.modules[i % Math.max(data.modules.length, 1)]?.color || C.slateFallback;
                    return (
                      <div key={c.username + i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 0', borderBottom: i < data.consumers.length - 1 ? `1px solid ${C.rowBorder}` : 'none' }}>
                        <span style={{ width: 34, height: 34, borderRadius: '50%', background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flex: 'none' }}>{c.initials}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.display_name}</div>
                          <div style={{ fontSize: 11.5, color: C.faint }}>{c.department || '—'}</div>
                        </div>
                        <div style={{ textAlign: 'right', flex: 'none' }}>
                          <div style={{ fontFamily: MONO, fontSize: 12.5 }}>{fmtTokens(c.tokens)}</div>
                          <div style={{ width: 64, height: 4, background: C.track, borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${(c.tokens / top) * 100}%`, background: color, borderRadius: 2 }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ padding: '13px 0', fontSize: 12, color: C.muted }}>
                    {fmtFull(data.active_user_count)} active user{data.active_user_count === 1 ? '' : 's'} consumed tokens this period.
                  </div>
                </div>
              </Card>
            </div>

            <div style={{ marginTop: 16, fontSize: 11.5, color: C.disabled, textAlign: 'center' }}>
              Token counts are captured per provider call · cost estimated at the configured blended rate · trends compare against the immediately preceding window.
            </div>
          </>
        )}
      </div>

      {showBudgets && <BudgetModal onClose={() => setShowBudgets(false)} onSaved={() => { setShowBudgets(false); load(); }} />}
    </div>
  );
}

/* ------------------------------------------------------------- primitives */
function Card({ children }: { children: React.ReactNode }) {
  return <section style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 12, overflow: 'hidden' }}>{children}</section>;
}
function CardHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 20px', borderBottom: `1px solid ${C.rowBorder}` }}>
      <span style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</span>
      {hint && <span style={{ fontSize: 12, color: C.faint }}>{hint}</span>}
    </div>
  );
}
function SummaryCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{label}</div>
      {children}
    </div>
  );
}
function BigNum({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: MONO, fontSize: 27, fontWeight: 600, marginTop: 8, letterSpacing: '-0.5px' }}>{children}</div>;
}
function Caption({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 12, color: C.muted, marginTop: 7, ...style }}>{children}</div>;
}
function ShareCell({ share, color, thin }: { share: number; color: string; thin?: boolean }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ flex: 1, height: thin ? 4 : 5, background: C.track, borderRadius: 3, overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.min(share, 100)}%`, background: color, borderRadius: 3 }} />
      </span>
      <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.muted, minWidth: 34, textAlign: 'right' }}>{share.toFixed(1)}%</span>
    </span>
  );
}

/* ------------------------------------------------------------- budget modal */
function BudgetModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [b, setB] = useState<TokenBudgets | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    adminApi.getTokenBudgets().then((r) => setB(r.data)).catch((e) => setErr(e?.response?.data?.detail || 'Failed to load budgets.'));
  }, []);

  const save = async () => {
    if (!b) return;
    setSaving(true); setErr('');
    try {
      const payload: TokenBudgetsUpdate = {
        monthly_quota: b.monthly_quota,
        blended_rate_per_million: b.blended_rate_per_million,
        billing_cycle_day: b.billing_cycle_day,
        modules: b.modules.map((m) => ({ module_key: m.module_key, monthly_budget: m.monthly_budget })),
      };
      await adminApi.updateTokenBudgets(payload);
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const inM = (n: number) => (n / 1e6);
  const setModuleBudgetM = (key: string, m: number) =>
    setB((p) => p ? { ...p, modules: p.modules.map((x) => x.module_key === key ? { ...x, monthly_budget: Math.max(0, Math.round(m * 1e6)) } : x) } : p);

  const field: React.CSSProperties = { width: 90, background: C.subtle, border: `1px solid ${C.inputBorder}`, borderRadius: 7, padding: '7px 9px', fontSize: 12.5, fontFamily: MONO, color: C.ink, textAlign: 'right' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(28,34,31,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 50, fontFamily: SANS }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 14, width: 'min(560px,100%)', maxHeight: '86vh', overflow: 'auto', border: `1px solid ${C.cardBorder}` }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.rowBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Token budgets & quota</div>
            <div style={{ fontSize: 12.5, color: C.faint, marginTop: 2 }}>Monthly limits used for alerts, utilization, and projections.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: C.faint, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {err && <div style={{ margin: '14px 22px 0', background: C.rustBg, border: `1px solid ${C.rustBorder}`, borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: C.rustText }}>{err}</div>}
        {!b ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: C.faint }}>Loading…</div>
        ) : (
          <div style={{ padding: '18px 22px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <label style={{ fontSize: 12.5, color: C.ink2 }}>
                <div style={{ marginBottom: 6, fontWeight: 600 }}>Monthly quota (M tokens)</div>
                <input ref={firstRef} type="number" min={0} step={1} style={{ ...field, width: '100%', textAlign: 'left' }}
                  value={inM(b.monthly_quota)} onChange={(e) => setB({ ...b, monthly_quota: Math.max(0, Math.round(Number(e.target.value) * 1e6)) })} />
              </label>
              <label style={{ fontSize: 12.5, color: C.ink2 }}>
                <div style={{ marginBottom: 6, fontWeight: 600 }}>Blended rate ($ / 1M)</div>
                <input type="number" min={0} step={0.01} style={{ ...field, width: '100%', textAlign: 'left' }}
                  value={b.blended_rate_per_million} onChange={(e) => setB({ ...b, blended_rate_per_million: Math.max(0, Number(e.target.value)) })} />
              </label>
              <label style={{ fontSize: 12.5, color: C.ink2 }}>
                <div style={{ marginBottom: 6, fontWeight: 600 }}>Billing cycle day</div>
                <input type="number" min={1} max={28} step={1} style={{ ...field, width: '100%', textAlign: 'left' }}
                  value={b.billing_cycle_day} onChange={(e) => setB({ ...b, billing_cycle_day: Math.min(28, Math.max(1, Number(e.target.value))) })} />
              </label>
            </div>

            <div style={{ marginTop: 20, fontSize: 12.5, fontWeight: 600, color: C.ink2 }}>Per-module budgets (M tokens)</div>
            <div style={{ marginTop: 8 }}>
              {b.modules.length === 0 ? (
                <div style={{ fontSize: 12.5, color: C.faint, padding: '10px 0' }}>
                  No modules configured yet. Modules appear here automatically once they record usage; per-module budgets can be added after that.
                </div>
              ) : b.modules.map((m) => (
                <div key={m.module_key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: `1px solid ${C.rowBorder}` }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.ink2 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: m.color }} />{m.label}
                  </span>
                  <input type="number" min={0} step={0.5} style={field} value={inM(m.monthly_budget)} onChange={(e) => setModuleBudgetM(m.module_key, Number(e.target.value))} />
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${C.rowBorder}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ background: '#fff', border: `1px solid ${C.inputBorder}`, borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, color: C.ink2, cursor: 'pointer', fontFamily: SANS }}>Cancel</button>
          <button onClick={save} disabled={saving || !b} className="tu-btn" style={{ background: C.green, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: SANS }}>{saving ? 'Saving…' : 'Save budgets'}</button>
        </div>
      </div>
    </div>
  );
}
