"use client";

// ---------------------------------------------------------------------------
// GovernanceOverview — production React/Next.js 14 component.
// Zero runtime dependencies (hand-built SVG chart). Client component because of
// hover/click interactivity. Data is passed in from the live documents-overview
// API (see /app/(dashboard)/governance/page.tsx). Best / Focus / section deltas
// are derived from the real sections + trend rather than hard-coded.
// ---------------------------------------------------------------------------

import { useMemo, useState, type CSSProperties } from "react";
import styles from "./GovernanceOverview.module.css";
import type { Section, Metric } from "./data";

export interface GovernanceOverviewProps {
  /** Section dataset (from the documents-overview API). */
  sections?: Section[];
  /** 12-month score history (oldest → newest). */
  trendValues?: number[];
  /** Month labels index-aligned with trendValues. */
  trendLabels?: string[];
  /** Year shown in the hover tooltip. */
  trendYear?: string;
  /** Month-over-month delta per section (index-aligned with sections). */
  sectionDeltas?: number[];
  /** Accent color for the line/fill/dots. Default teal #1ed4b0. */
  accent?: string;
  /** Show the Strong/Fair/Weak performance bands behind the line. Default true. */
  showBands?: boolean;
  /** Target score line (60–100). Default 85. */
  targetScore?: number;
}

// --- scoring band helper ----------------------------------------------------
interface Band { hex: string; soft: string; pillBg: string; pillText: string; pillBorder: string; label: string; }
function band(s: number | null): Band {
  if (s == null) return { hex: "#94a3b8", soft: "#f1f5f9", pillBg: "#f8fafc", pillText: "#64748b", pillBorder: "#e2e8f0", label: "no data" };
  if (s >= 80) return { hex: "#059669", soft: "#d1fae5", pillBg: "#ecfdf5", pillText: "#047857", pillBorder: "#a7f3d0", label: "strong" };
  if (s >= 60) return { hex: "#d97706", soft: "#fef3c7", pillBg: "#fffbeb", pillText: "#b45309", pillBorder: "#fde68a", label: "fair" };
  return { hex: "#e11d48", soft: "#ffe4e6", pillBg: "#fff1f2", pillText: "#be123c", pillBorder: "#fecdd3", label: "weak" };
}

function shade(hex: string): string {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return hex;
  const f = (i: number) => Math.max(0, Math.round(parseInt(h.slice(i, i + 2), 16) * 0.85));
  return `rgb(${f(0)},${f(2)},${f(4)})`;
}

const GRADES: Record<string, string> = { strong: "A", fair: "B", weak: "C" };

export default function GovernanceOverview({
  sections = [],
  trendValues = [],
  trendLabels = [],
  trendYear = "",
  sectionDeltas = [],
  accent = "#1ed4b0",
  showBands = true,
  targetScore = 85,
}: GovernanceOverviewProps) {
  const accentStrong = useMemo(() => shade(accent), [accent]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // --- computed sections ----------------------------------------------------
  const computed = useMemo(() => {
    const secs = sections.map((s, i) => {
      const rawScore = typeof s.score === "number" ? s.score
        : (s.metrics.length ? Math.round(s.metrics.reduce((a, m) => a + m.score * m.w, 0)) : null);
      const hasScore = rawScore != null;
      const score = rawScore ?? 0;
      const b = band(rawScore);
      const d = hasScore ? (sectionDeltas[i] || 0) : 0;
      const end = score, start = end - d * 2, pts: number[] = [];
      for (let j = 0; j < 8; j++) pts.push(start + (end - start) * (j / 7) + Math.sin(j * 1.7 + i) * 3);
      const mn = Math.min(...pts), mx = Math.max(...pts), rng = mx - mn || 1;
      const X = (j: number) => (1 + (j / 7) * 58).toFixed(1);
      const Y = (v: number) => (1 + 20 - ((v - mn) / rng) * 18).toFixed(1);
      return {
        ...s, score, rawScore, hasScore, band: b,
        scoreText: hasScore ? String(score) : "—",
        weightPct: Math.round(s.weight * 100),
        delta: hasScore ? (d > 0 ? "+" : "") + d : "",
        deltaColor: d > 0 ? "#059669" : d < 0 ? "#e11d48" : "#94a3b8",
        sparkLine: hasScore ? pts.map((v, j) => `${j === 0 ? "M" : "L"}${X(j)},${Y(v)}`).join(" ") : "M1,11 L59,11",
      };
    });
    const scored = secs.filter((s) => s.hasScore);
    const totalW = scored.reduce((a, s) => a + s.weight, 0) || 1;
    const perfScore = scored.length ? Math.round(scored.reduce((a, s) => a + s.score * s.weight, 0) / totalW) : 0;
    const pb = band(scored.length ? perfScore : null);
    const dashN = (r: number) => { const c = 2 * Math.PI * r; return `${(c * perfScore / 100).toFixed(1)} ${c.toFixed(1)}`; };
    // Best / Focus derived from the real (scored) sections (highest / lowest).
    const ranked = [...scored].sort((a, b2) => b2.score - a.score);
    const best = ranked[0] ? { label: ranked[0].short, score: ranked[0].score } : { label: "—", score: 0 };
    const focus = ranked.length ? { label: ranked[ranked.length - 1].short, score: ranked[ranked.length - 1].score } : { label: "—", score: 0 };
    return {
      secs, perfScore, perfBand: pb,
      grade: GRADES[pb.label] ?? "—",
      labelCap: pb.label.charAt(0).toUpperCase() + pb.label.slice(1),
      dash132: dashN(59), best, focus,
    };
  }, [sections, sectionDeltas]);

  // --- trend geometry -------------------------------------------------------
  // Pad a single real point to a flat 2-point segment so the chart renders
  // while history is still accruing (real snapshots start from today).
  const vals = trendValues.length === 1 ? [trendValues[0], trendValues[0]] : trendValues;
  const labs = trendLabels.length === 1 ? [trendLabels[0], trendLabels[0]] : trendLabels;
  // A single real snapshot shows the "building" placeholder (with the current
  // score) rather than a misleading flat line; ≥2 months draws the real trend.
  const hasTrend = trendValues.length >= 2;

  const trend = useMemo(() => {
    const target = Math.max(50, Math.min(100, Math.round(targetScore)));
    const W = 600, H = 230, pL = 40, pR = 58, pT = 20, pB = 34, lo = 45, hi = 92;
    const n = Math.max(2, vals.length);
    const sp = (W - pL - pR) / (n - 1), plotBottom = H - pB, plotW = W - pL - pR;
    const X = (i: number) => pL + i * sp;
    const Y = (v: number) => pT + (1 - (v - lo) / (hi - lo)) * (H - pT - pB);
    const line = vals.map((v, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    const points = vals.map((v, i) => ({ i, x: +X(i).toFixed(1), y: +Y(v).toFixed(1), label: labs[i], score: v, delta: i > 0 ? v - vals[i - 1] : 0 }));
    const zones = [
      { label: "Strong", color: "#ecfdf5", tColor: "#059669", hi: 92, low: 80 },
      { label: "Fair", color: "#fffbeb", tColor: "#b45309", hi: 80, low: 60 },
      { label: "Weak", color: "#fff1f2", tColor: "#be123c", hi: 60, low: 45 },
    ].map((z) => ({ ...z, x: pL, w: plotW, y: Y(z.hi), h: Y(z.low) - Y(z.hi), tx: W - pR + 7, ty: (Y(z.hi) + Y(z.low)) / 2 + 3 }));
    return {
      W, H, pL, pR, pT, plotBottom, sp, gridX2: W - pR, line,
      area: `${line} L${X(vals.length - 1).toFixed(1)},${plotBottom.toFixed(1)} L${X(0).toFixed(1)},${plotBottom.toFixed(1)} Z`,
      points, zones,
      target: { y: Y(target), ty: Y(target) - 5, x1: pL, x2: W - pR, tx: pL + 4, label: `Target ${target}` },
      valueLabels: points.map((p, i) => ({ x: p.x, y: p.y - 10, score: p.score, weight: i === points.length - 1 ? 700 : 500, fill: i === points.length - 1 ? "#0f172a" : "#64748b" })),
      yGrid: [50, 60, 70, 80, 90].map((val) => ({ val, y: Y(val), ty: Y(val) + 3 })),
    };
  }, [targetScore, vals, labs]);

  // --- hover tooltip --------------------------------------------------------
  const hover = useMemo(() => {
    if (hoverIdx == null || !trend.points[hoverIdx]) return null;
    const p = trend.points[hoverIdx];
    const bw = 104, bh = 50;
    const bx = Math.max(trend.pL, Math.min(p.x - bw / 2, trend.W - trend.pR - bw));
    const by = p.y - bh - 12 < trend.pT ? p.y + 14 : p.y - bh - 12;
    const d = p.delta;
    return {
      p, bx, by, bw,
      deltaTxt: (d > 0 ? "▲ +" + d : d < 0 ? "▼ " + Math.abs(d) : "no change") + (d !== 0 ? " pts" : ""),
      deltaColor: d > 0 ? "#4ade80" : d < 0 ? "#fb7185" : "#94a3b8",
    };
  }, [hoverIdx, trend]);

  // trend headline: total change across the available window
  const trendDelta = hasTrend ? Math.round(vals[vals.length - 1] - vals[0]) : 0;

  // --- modal drawer ---------------------------------------------------------
  const drawer = useMemo(() => {
    if (!openKey) return null;
    const s = computed.secs.find((x) => x.key === openKey);
    if (!s) return null;
    const C = 2 * Math.PI * 34;
    return {
      title: s.label, subtitle: `${s.weightPct}% of the governance score`,
      score: s.score, band: s.band,
      ringDash: `${(C * s.score / 100).toFixed(1)} ${C.toFixed(1)}`,
      metrics: s.metrics.map((m: Metric) => ({
        label: m.label, weightPct: Math.round(m.w * 100),
        frac: m.den > 0 ? `${m.num} / ${m.den}` : "derived",
        color: band(m.score).hex, score: m.score, formula: m.formula, contrib: (m.score * m.w).toFixed(1),
      })),
      equation: s.metrics.map((m: Metric) => `(${m.score} × ${Math.round(m.w * 100)}%)`).join("  +  "),
    };
  }, [openKey, computed]);

  const F = "Poppins, system-ui, sans-serif";
  const rootVars = { "--gov-accent": accent, "--gov-accent-strong": accentStrong } as CSSProperties;
  const card: CSSProperties = { border: "1px solid #e2e8f0", background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,.06)" };

  return (
    <div className={styles.root} style={rootVars}>
      <div className={styles.inner}>
        {/* trend + current */}
        <div className={styles.heroGrid}>
          {/* TREND CARD */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#334155" }}>Governance Health · 12-month trend</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>weighted module score over time</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: accentStrong, lineHeight: 1 }}>
                    {computed.perfScore}<span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}> /100</span>
                  </div>
                  <div style={{ fontSize: 9.5, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 3 }}>
                    Current · {computed.grade} {computed.labelCap}
                  </div>
                </div>
                {hasTrend && trendDelta !== 0 && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: trendDelta > 0 ? "#ecfdf5" : "#fff1f2", color: trendDelta > 0 ? "#047857" : "#be123c", borderRadius: 999, padding: "4px 11px", fontSize: 11, fontWeight: 600 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">{trendDelta > 0 ? <><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></> : <><polyline points="22 17 13.5 8.5 8.5 13.5 2 7" /><polyline points="16 17 22 17 22 11" /></>}</svg>
                    {trendDelta > 0 ? "+" : ""}{trendDelta} pts
                  </div>
                )}
              </div>
            </div>

            {/* CHART */}
            {hasTrend ? (
              <svg viewBox="0 0 600 230" style={{ width: "100%", height: 252, display: "block" }} onMouseLeave={() => setHoverIdx(null)}>
                <defs>
                  <linearGradient id="govTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accent} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={accent} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                {showBands && trend.zones.map((z, i) => (
                  <g key={`z${i}`}>
                    <rect x={z.x} y={z.y} width={z.w} height={z.h} fill={z.color} />
                    <text x={z.tx} y={z.ty} fontSize={8.5} fontWeight={600} fontFamily={F} fill={z.tColor}>{z.label}</text>
                  </g>
                ))}
                {trend.yGrid.map((g, i) => (
                  <g key={`g${i}`}>
                    <line x1={40} y1={g.y} x2={trend.gridX2} y2={g.y} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="2 3" />
                    <text x={34} y={g.ty} textAnchor="end" fontSize={11} fontWeight={600} fontFamily={F} fill="#475569">{g.val}</text>
                  </g>
                ))}
                <line x1={trend.target.x1} y1={trend.target.y} x2={trend.target.x2} y2={trend.target.y} stroke="#34d399" strokeWidth={1.5} strokeDasharray="5 4" />
                <text x={trend.target.tx} y={trend.target.ty} fontSize={9} fontWeight={600} fontFamily={F} fill="#059669">{trend.target.label}</text>
                <path d={trend.area} fill="url(#govTrend)" />
                <path d={trend.line} fill="none" stroke={accentStrong} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                {trend.points.map((p) => (
                  <circle key={`d${p.i}`} cx={p.x} cy={p.y} r={3.5} fill="#fff" stroke={accentStrong} strokeWidth={2} />
                ))}
                {trend.valueLabels.map((v, i) => (
                  <text key={`v${i}`} x={v.x} y={v.y} textAnchor="middle" fontSize={9} fontWeight={v.weight} fontFamily={F} fill={v.fill}>{v.score}</text>
                ))}
                {trend.points.map((p) => (
                  <text key={`x${p.i}`} x={p.x} y={215} textAnchor="middle" fontSize={11} fontWeight={500} fontFamily={F} fill="#475569">{p.label}</text>
                ))}
                {trend.points.map((p) => (
                  <rect key={`h${p.i}`} x={p.x - trend.sp / 2} y={trend.pT} width={trend.sp} height={trend.plotBottom - trend.pT}
                    fill="transparent" style={{ cursor: "pointer" }} onMouseEnter={() => setHoverIdx(p.i)} />
                ))}
                {hover && (
                  <g>
                    <line x1={hover.p.x} y1={trend.pT} x2={hover.p.x} y2={trend.plotBottom} stroke="#0f172a" strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.4} />
                    <circle cx={hover.p.x} cy={hover.p.y} r={5.5} fill={accentStrong} stroke="#fff" strokeWidth={2.5} />
                    <rect x={hover.bx} y={hover.by} width={hover.bw} height={50} rx={9} fill="#0f172a" />
                    <text x={hover.bx + 13} y={hover.by + 19} fontSize={10} fontFamily={F} fill="#94a3b8">{hover.p.label} {trendYear}</text>
                    <text x={hover.bx + 13} y={hover.by + 40} fontSize={16} fontWeight={700} fontFamily={F} fill="#fff">{hover.p.score}</text>
                    <text x={hover.bx + 13 + String(hover.p.score).length * 10 + 4} y={hover.by + 40} fontSize={9} fontFamily={F} fill="#94a3b8">/100</text>
                    <text x={hover.bx + hover.bw - 13} y={hover.by + 40} textAnchor="end" fontSize={10} fontWeight={600} fontFamily={F} fill={hover.deltaColor}>{hover.deltaTxt}</text>
                  </g>
                )}
              </svg>
            ) : (
              <div style={{ height: 252, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#94a3b8", textAlign: "center" }}>
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>Trend is building</div>
                <div style={{ fontSize: 11.5, maxWidth: 320 }}>The 12-month health-score line fills in as daily snapshots accrue. Current score is {computed.perfScore}/100.</div>
              </div>
            )}

            {/* legend */}
            {hasTrend && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 8, fontSize: 10.5, color: "#64748b", flexWrap: "wrap" }}>
                <LegendSwatch bg="#ecfdf5" border="#a7f3d0" label="Strong 80+" />
                <LegendSwatch bg="#fffbeb" border="#fde68a" label="Fair 60–79" />
                <LegendSwatch bg="#fff1f2" border="#fecdd3" label="Weak <60" />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 16, borderTop: "2px dashed #34d399" }} />{trend.target.label}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 16, height: 2.5, background: accentStrong, borderRadius: 2 }} />Health score</span>
              </div>
            )}
          </div>

          {/* CURRENT CARD */}
          <div style={{ ...card, background: "linear-gradient(160deg,#fff,#f6fbfa)", padding: 18, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".1em", color: "#64748b" }}>Current</div>
            <div style={{ position: "relative", width: 132, height: 132, margin: "14px 0 8px" }}>
              <svg width="132" height="132" viewBox="0 0 132 132" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="66" cy="66" r="59" fill="none" stroke={computed.perfBand.soft} strokeWidth={11} />
                <circle cx="66" cy="66" r="59" fill="none" stroke={computed.perfBand.hex} strokeWidth={11} strokeLinecap="round" strokeDasharray={computed.dash132} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 40, fontWeight: 700, color: computed.perfBand.hex, lineHeight: 1 }}>{computed.perfScore}</span>
                <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em", color: "#94a3b8" }}>/ 100</span>
              </div>
            </div>
            <span style={{ border: `1px solid ${computed.perfBand.pillBorder}`, background: computed.perfBand.pillBg, color: computed.perfBand.pillText, borderRadius: 999, padding: "3px 12px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>
              {computed.grade} · {computed.perfBand.label}
            </span>
            <div style={{ display: "flex", gap: 22, marginTop: 18 }}>
              <div><div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".05em" }}>Best</div><div style={{ fontSize: 14, fontWeight: 600, color: "#059669" }}>{computed.best.label} {computed.best.score}</div></div>
              <div><div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".05em" }}>Focus</div><div style={{ fontSize: 14, fontWeight: 600, color: "#e11d48" }}>{computed.focus.label} {computed.focus.score}</div></div>
            </div>
          </div>
        </div>

        {/* SECTION MOMENTUM */}
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #eef2f6" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>Section momentum</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>click a section for its scoring breakdown</span>
          </div>
          <div className={styles.momentumGrid}>
            {computed.secs.map((s) => (
              <button key={s.key} type="button" disabled={!s.hasScore} onClick={() => s.hasScore && setOpenKey(s.key)}
                className={styles.row} style={{ opacity: s.hasScore ? 1 : 0.55, cursor: s.hasScore ? "pointer" : "default" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, color: "#334155", textAlign: "left" }}>{s.label}</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>{s.weightPct}%</span>
                <svg width="72" height="24" viewBox="0 0 60 22" style={{ flexShrink: 0 }}><path d={s.sparkLine} fill="none" stroke={s.band.hex} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span style={{ width: 32, textAlign: "right", fontSize: 15, fontWeight: 700, color: s.band.hex }}>{s.scoreText}</span>
                <span style={{ width: 30, textAlign: "right", fontSize: 12, fontWeight: 700, color: s.deltaColor }}>{s.delta}</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, visibility: s.hasScore ? "visible" : "hidden" }}><path d="m9 18 6-6-6-6" /></svg>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* MODAL */}
      {drawer && (
        <div className={styles.modalWrap}>
          <div className={styles.backdrop} onClick={() => setOpenKey(null)} />
          <div className={styles.modal}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "22px 24px", borderBottom: "1px solid #eef2f6" }}>
              <div style={{ position: "relative", width: 64, height: 64, flexShrink: 0 }}>
                <svg width="64" height="64" viewBox="0 0 72 72" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx="36" cy="36" r="34" fill="none" stroke={drawer.band.soft} strokeWidth={6} />
                  <circle cx="36" cy="36" r="34" fill="none" stroke={drawer.band.hex} strokeWidth={6} strokeLinecap="round" strokeDasharray={drawer.ringDash} />
                </svg>
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 700, color: drawer.band.hex }}>{drawer.score}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 600, color: "#0f172a" }}>{drawer.title}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <span style={{ border: `1px solid ${drawer.band.pillBorder}`, background: drawer.band.pillBg, color: drawer.band.pillText, borderRadius: 999, padding: "2px 9px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>{drawer.band.label}</span>
                  <span style={{ fontSize: 11.5, color: "#64748b" }}>{drawer.subtitle}</span>
                </div>
              </div>
              <button type="button" onClick={() => setOpenKey(null)} className={styles.close}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 24px 20px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", color: "#94a3b8", padding: "14px 0 6px" }}>Weighted metrics</div>
              {drawer.metrics.map((m, i) => (
                <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid #f6f8fa" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.label}</span>
                      <span style={{ flexShrink: 0, background: "#f1f5f9", color: "#64748b", borderRadius: 6, padding: "1px 7px", fontSize: 10, fontWeight: 600 }}>weight {m.weightPct}%</span>
                    </span>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{m.frac}</span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: m.color }}>{m.score}</span>
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: "#f1f5f9", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 999, background: m.color, width: `${m.score}%` }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                    <span style={{ fontSize: 10.5, color: "#94a3b8" }}>= {m.formula}</span>
                    <span style={{ fontSize: 10.5, color: "#64748b" }}>contributes <strong style={{ color: "#334155" }}>{m.contrib}</strong> pts</span>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 16, background: "#f8fafc", border: "1px solid #eef2f6", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", color: "#94a3b8", marginBottom: 6 }}>How this score is calculated</div>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: "#475569" }}>{drawer.equation} = <strong style={{ color: "#0f172a", fontSize: 14 }}>{drawer.score}</strong></p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LegendSwatch({ bg, border, label }: { bg: string; border: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 11, height: 11, borderRadius: 3, background: bg, border: `1px solid ${border}` }} />
      {label}
    </span>
  );
}
