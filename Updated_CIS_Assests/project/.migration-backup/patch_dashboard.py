#!/usr/bin/env python3
"""Patch dashboard page.tsx with new visual components."""
import re

FILE = r"c:\Users\Admin\Documents\GRC-Tenant\grc-frontend\src\app\(dashboard)\dashboard\page.tsx"

with open(FILE, "r", encoding="utf-8") as f:
    content = f.read()

# ─── 1. Insert ComplianceOrbitChart + GrcNetworkFlow before export default ───
NEW_COMPONENTS = r'''
// ─── Compliance Orbit Chart ──────────────────────────────────────────────────
function ComplianceOrbitChart({
  frameworks,
  compSummaryStats,
}: {
  frameworks: Array<{ name: string; score: number; fill: string }>;
  compSummaryStats: { compliant: number; partial: number; nonCompliant: number; pendingReview: number };
}) {
  const RING_COLORS = ['#4338CA', '#1D9E75', '#EF9F27', '#E24B4A', '#8b5cf6', '#06b6d4'];
  const RING_RADII = [120, 92, 64, 36];
  const cx = 155, cy = 155, size = 310;

  if (frameworks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[220px]">
        <Shield className="h-8 w-8 text-gray-300 mb-2" />
        <p className="text-xs text-gray-400">No framework data yet</p>
        <Link href="/compliance" className="text-[11px] text-blue-600 hover:underline mt-1">Track frameworks →</Link>
      </div>
    );
  }

  const rings = frameworks.slice(0, 4).map((f, i) => {
    const r = RING_RADII[i] ?? 28;
    const circumference = 2 * Math.PI * r;
    const dash = (f.score / 100) * circumference;
    const gap = circumference - dash;
    const color = RING_COLORS[i % RING_COLORS.length];
    const duration = 14 + i * 4;
    return { ...f, r, circumference, dash, gap, color, duration, i };
  });

  const avgScore = frameworks.length > 0
    ? Math.round(frameworks.reduce((s, f) => s + f.score, 0) / frameworks.length)
    : 0;

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-center">
      <div className="flex-shrink-0 mx-auto lg:mx-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          {/* Track rings */}
          {rings.map((rng) => (
            <circle key={`track-${rng.i}`} cx={cx} cy={cy} r={rng.r}
              fill="none" stroke="#F1EFE8" strokeWidth={8} />
          ))}
          {/* Progress arcs */}
          {rings.map((rng) => (
            <circle key={`arc-${rng.i}`} cx={cx} cy={cy} r={rng.r}
              fill="none" stroke={rng.color} strokeWidth={8}
              strokeLinecap="round"
              strokeDasharray={`${rng.dash} ${rng.gap}`}
              transform={`rotate(-90 ${cx} ${cy})`}
              opacity={0.9}
            />
          ))}
          {/* Center score */}
          <circle cx={cx} cy={cy} r={20} fill="#2C2C2A" />
          <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
            fontSize={11} fontWeight={600} fill="#FFFFFF">{avgScore}%</text>
          {/* Orbiting dots */}
          {rings.map((rng) => (
            <g key={`orbit-${rng.i}`}>
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`${rng.i * 90} ${cx} ${cy}`}
                to={`${rng.i * 90 + 360} ${cx} ${cy}`}
                dur={`${rng.duration}s`}
                repeatCount="indefinite"
              />
              <circle cx={cx + rng.r} cy={cy} r={4} fill={rng.color} />
            </g>
          ))}
        </svg>
      </div>

      <div className="flex-1 space-y-3 min-w-0">
        {/* Status pills */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {[
            { label: 'Compliant', value: compSummaryStats.compliant, color: '#22c55e', bg: '#f0fdf4' },
            { label: 'Partial', value: compSummaryStats.partial, color: '#f59e0b', bg: '#fffbeb' },
            { label: 'At Risk', value: compSummaryStats.nonCompliant, color: '#ef4444', bg: '#fef2f2' },
            { label: 'Pending', value: compSummaryStats.pendingReview, color: '#94a3b8', bg: '#f9fafb' },
          ].filter((s) => s.value > 0).map((s) => (
            <span key={s.label} className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ color: s.color, backgroundColor: s.bg, border: `1px solid ${s.color}40` }}>
              {s.value} {s.label}
            </span>
          ))}
        </div>

        {/* Per-framework rows */}
        {rings.map((rng) => (
          <div key={rng.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: rng.color }} />
            <span className="text-[11px] font-medium text-gray-700 flex-1 truncate">{rng.name}</span>
            <div className="w-24 h-1.5 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
              <div className="h-full rounded-full" style={{ width: `${rng.score}%`, backgroundColor: rng.color }} />
            </div>
            <span className="text-[11px] font-bold flex-shrink-0" style={{ color: rng.color }}>{rng.score}%</span>
          </div>
        ))}
        {frameworks.length > 4 && (
          <p className="text-[10px] text-gray-400">+{frameworks.length - 4} more frameworks tracked</p>
        )}
      </div>
    </div>
  );
}

// ─── GRC Network Flow ────────────────────────────────────────────────────────
const NETWORK_NODES = [
  { id: 'risk',       label: 'Risks',       x: 150, y: 60,  color: '#ef4444', icon: '⚠' },
  { id: 'compliance', label: 'Compliance',  x: 300, y: 60,  color: '#3b82f6', icon: '✓' },
  { id: 'controls',   label: 'Controls',    x: 375, y: 180, color: '#10b981', icon: '🔒' },
  { id: 'evidence',   label: 'Evidence',    x: 300, y: 295, color: '#f59e0b', icon: '📎' },
  { id: 'governance', label: 'Governance',  x: 150, y: 295, color: '#8b5cf6', icon: '📋' },
  { id: 'vulns',      label: 'Vulns',       x: 75,  y: 180, color: '#f97316', icon: '🐛' },
];
const NETWORK_EDGES = [
  ['risk','compliance'],['risk','controls'],['risk','vulns'],
  ['compliance','controls'],['compliance','evidence'],
  ['controls','evidence'],['controls','governance'],
  ['evidence','governance'],
  ['governance','risk'],['vulns','controls'],
];

function GrcNetworkFlow({ counts }: {
  counts: { risks: number; compliance: number; controls: number; evidence: number; governance: number; vulns: number }
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="relative">
      <svg viewBox="0 0 450 360" width="100%" height="100%" style={{ overflow: 'visible' }}>
        <defs>
          {NETWORK_NODES.map((nd) => (
            <radialGradient key={nd.id} id={`ng-${nd.id}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={nd.color} stopOpacity="0.15" />
              <stop offset="100%" stopColor={nd.color} stopOpacity="0" />
            </radialGradient>
          ))}
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#d1d5db" />
          </marker>
        </defs>

        {/* Edges */}
        {NETWORK_EDGES.map(([a, b]) => {
          const na = NETWORK_NODES.find((n) => n.id === a)!;
          const nb = NETWORK_NODES.find((n) => n.id === b)!;
          const isHov = hovered === a || hovered === b;
          const col = isHov ? na.color : '#e5e7eb';
          return (
            <line key={`${a}-${b}`}
              x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
              stroke={col} strokeWidth={isHov ? 2 : 1}
              strokeOpacity={isHov ? 0.8 : 0.5}
              strokeDasharray={isHov ? '' : '4 4'}
              markerEnd={isHov ? 'url(#arrow)' : undefined}
            />
          );
        })}

        {/* Nodes */}
        {NETWORK_NODES.map((nd) => {
          const isHov = hovered === nd.id;
          const val = counts[nd.id as keyof typeof counts] ?? 0;
          return (
            <g key={nd.id}
              transform={`translate(${nd.x},${nd.y})`}
              onMouseEnter={() => setHovered(nd.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'default' }}>
              {/* glow */}
              {isHov && <circle r={32} fill={`url(#ng-${nd.id})`} />}
              {/* ring */}
              <circle r={24}
                fill="white"
                stroke={nd.color}
                strokeWidth={isHov ? 2.5 : 1.5}
                opacity={isHov ? 1 : 0.8}
              />
              {/* value */}
              <text y={-3} textAnchor="middle" dominantBaseline="middle"
                fontSize={11} fontWeight={700} fill={nd.color}>{val || '—'}</text>
              {/* label */}
              <text y={10} textAnchor="middle" dominantBaseline="middle"
                fontSize={8} fill="#9ca3af">{nd.label}</text>
              {/* pulse on hover */}
              {isHov && (
                <circle r={24} fill="none" stroke={nd.color} strokeWidth={1} opacity={0.4}>
                  <animate attributeName="r" values="24;36;24" dur="1.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0;0.4" dur="1.5s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
        {NETWORK_NODES.map((nd) => (
          <div key={nd.id} className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: nd.color }} />
            {nd.label}
          </div>
        ))}
      </div>
    </div>
  );
}

'''

# Insert before "export default function MainDashboard"
MARKER = "export default function MainDashboard()"
content = content.replace(MARKER, NEW_COMPONENTS + MARKER, 1)

# ─── 2. Replace the GRC Flow & Network chord section ─────────────────────────
# Find and replace the chord diagram card
old_chord = '''        {/* GRC Flow & Network — Chord Diagram */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <SectionHeader
            title="GRC Flow & Network"
            sub="Cross-domain coverage overlap · hover a segment to highlight flows"
            href="/risks"
          />
          <div className="flex items-center justify-center" style={{ height: 320 }}>
            <GrcChordDiagram nodes={CHORD_NODES} matrix={chordMatrix} size={300} />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
            {CHORD_NODES.map((nd) => (
              <div key={nd.label} className="flex items-center gap-1 text-[10px] text-gray-500">
                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: nd.color }} />
                {nd.label}
              </div>
            ))}
          </div>
        </div>'''

new_chord = '''        {/* GRC Flow & Network — Network Diagram */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <SectionHeader
            title="GRC Flow & Network"
            sub="Cross-domain relationships · hover a node to highlight flows"
            href="/risks"
          />
          <GrcNetworkFlow counts={{
            risks: openRisks,
            compliance: compSummaryStats.compliant,
            controls: unified?.compliance?.controls_implemented ?? 0,
            evidence: totalEvidence,
            governance: (unified?.governance?.pending_approvals ?? 0) + (unified?.attestations?.active_campaigns ?? 0),
            vulns: totalVulns,
          }} />
        </div>'''

content = content.replace(old_chord, new_chord, 1)

# ─── 3. Replace Compliance Framework Coverage section ────────────────────────
# Find the entire section from opening comment to closing </div></div>
# Using regex for flexibility
pattern_coverage = r'\{/\* â"€â"€ Row 2: COSO/ERM Wheel \+ Compliance Framework Coverage.*?\{/\* -- Row 3'
match = re.search(pattern_coverage, content, re.DOTALL)
if match:
    old_coverage_block = match.group(0)[:-len('{/* -- Row 3')]  # remove trailing part
    new_coverage_block = '''      {/* ── Row 2: Compliance Framework Orbit ──────────────────────────────── */}
      <div className="grid gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <SectionHeader
            title="Compliance Framework Coverage"
            sub="Ring = framework · completion = readiness score · hover for details"
            href="/compliance"
          />
          <ComplianceOrbitChart frameworks={frameworkCoverageData} compSummaryStats={compSummaryStats} />
        </div>
      </div>

      {/* -- Row 3'''
    content = content.replace(old_coverage_block, new_coverage_block, 1)
    print("✓ Replaced Compliance Framework Coverage section")
else:
    print("✗ Could not find Compliance Framework Coverage section — trying simpler match")
    # Try a different approach
    # find "Row 2" comment line and the next "Row 3" comment line
    idx2 = content.find("Row 2: COSO/ERM Wheel")
    idx3 = content.find("Row 3: Framework")
    if idx2 > 0 and idx3 > 0:
        # Find the block start (the {/* comment start)
        block_start = content.rfind('{/*', 0, idx2)
        old_block = content[block_start:idx3]
        new_block = '''      {/* ── Row 2: Compliance Framework Orbit ──────────────────────────────── */}
      <div className="grid gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <SectionHeader
            title="Compliance Framework Coverage"
            sub="Ring = framework · completion = readiness score"
            href="/compliance"
          />
          <ComplianceOrbitChart frameworks={frameworkCoverageData} compSummaryStats={compSummaryStats} />
        </div>
      </div>

      '''
        content = content.replace(old_block, new_block, 1)
        print("✓ Replaced Compliance Framework Coverage section (fallback)")
    else:
        print(f"✗ Could not find Row 2 section. idx2={idx2}, idx3={idx3}")

# ─── 4. Replace GRC Snapshot section ─────────────────────────────────────────
old_snapshot = '''{/* Quick stats summary */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-black">GRC Snapshot</h2>
          {[
            { label: 'Frameworks Tracked', value: unified?.compliance?.frameworks_tracked ?? 0, color: '#3b82f6', href: '/compliance' },
            { label: 'Controls Implemented', value: unified?.compliance?.controls_implemented ?? 0, sub: `of ${unified?.compliance?.controls_total ?? 0}`, color: '#22c55e', href: '/control-library' },
            { label: 'Pending Actions', value: unified?.executive_summary?.pending_actions ?? 0, color: '#f59e0b', href: '/risks' },
            { label: 'Open Issues', value: unified?.executive_summary?.open_issues ?? 0, color: '#ef4444', href: '/risks' },
            { label: 'Active Attestations', value: unified?.attestations?.active_campaigns ?? 0, color: '#8b5cf6', href: '/governance/attestations' },
            { label: 'Pending Approvals', value: unified?.governance?.pending_approvals ?? 0, color: '#06b6d4', href: '/governance/approvals' },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50 transition-colors"
            >
              <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
              <span className="flex-1 text-xs text-gray-600">{item.label}</span>
              <span className="text-sm font-bold text-black">{item.value}</span>
              {\'sub\' in item && item.sub && <span className="text-[10px] text-gray-400">{item.sub}</span>}
            </Link>
          ))}
        </div>'''

new_snapshot = '''{/* GRC Posture Snapshot */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold text-black">GRC Snapshot</h2>
            <p className="text-[10px] text-gray-400">Compliance posture · live</p>
          </div>
          {/* Big score */}
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold leading-none"
              style={{ color: complianceScore >= 75 ? '#16a34a' : complianceScore >= 50 ? '#d97706' : '#dc2626' }}>
              {complianceScore}
            </span>
            <span className="text-sm text-gray-400">/100</span>
            {complianceScore >= 75 && <span className="text-[11px] text-green-600 font-semibold">▲ on track</span>}
          </div>
          {/* Thermometer */}
          <div>
            <div className="h-2 rounded-full overflow-hidden mb-1" style={{
              background: 'linear-gradient(to right, #ef4444 0%, #f59e0b 45%, #22c55e 100%)'
            }}>
              <div className="relative h-full">
                <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-gray-700 shadow"
                  style={{ left: `calc(${Math.min(complianceScore, 100)}% - 6px)` }} />
              </div>
            </div>
            <div className="flex justify-between text-[9px] text-gray-400 font-medium">
              <span>AT RISK</span><span>PARTIAL</span><span>COMPLIANT</span>
            </div>
          </div>
          {/* Status cards */}
          {(unified?.executive_summary?.open_issues ?? 0) > 0 && (
            <Link href="/risks" className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:opacity-90"
              style={{ backgroundColor: '#fef2f2' }}>
              <span className="h-2 w-2 rounded-full flex-shrink-0 animate-pulse" style={{ backgroundColor: '#dc2626' }} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-red-900">{unified?.executive_summary?.open_issues} open issues</p>
                <p className="text-[10px] text-red-700">needs action</p>
              </div>
            </Link>
          )}
          {(unified?.executive_summary?.pending_actions ?? 0) > 0 && (
            <Link href="/risks" className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:opacity-90"
              style={{ backgroundColor: '#fffbeb' }}>
              <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#d97706' }} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-amber-900">{unified?.executive_summary?.pending_actions} pending actions</p>
                <p className="text-[10px] text-amber-700">due this week</p>
              </div>
            </Link>
          )}
          <Link href="/control-library" className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:opacity-90"
            style={{ backgroundColor: '#f0fdf4' }}>
            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#16a34a' }} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-green-900">{unified?.compliance?.controls_implemented ?? 0} controls</p>
              <p className="text-[10px] text-green-700">passing today</p>
            </div>
          </Link>
          {/* links row */}
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100">
            {[
              { label: `${unified?.compliance?.frameworks_tracked ?? 0} frameworks`, href: '/compliance' },
              { label: `${unified?.attestations?.active_campaigns ?? 0} attestations`, href: '/governance/attestations' },
              { label: `${unified?.governance?.pending_approvals ?? 0} approvals`, href: '/governance/approvals' },
            ].map((lk) => (
              <Link key={lk.href} href={lk.href}
                className="text-[10px] text-blue-600 hover:underline bg-blue-50 rounded-full px-2 py-0.5">
                {lk.label}
              </Link>
            ))}
          </div>
        </div>'''

if old_snapshot in content:
    content = content.replace(old_snapshot, new_snapshot, 1)
    print("✓ Replaced GRC Snapshot")
else:
    print("✗ GRC Snapshot not found — trying to find it")
    idx = content.find("GRC Snapshot")
    print(f"  Found 'GRC Snapshot' at index: {idx}")
    print(f"  Context: {repr(content[idx-200:idx+100])}")

with open(FILE, "w", encoding="utf-8") as f:
    f.write(content)

print(f"\nDone. File size: {len(content)} chars")
