'use client';

// TrajectoryMap
// ─────────────────────────────────────────────────────────────────────────
// 3-column interactive diagram: Asset → Vulnerability → linked Risk.
// One backend round trip via assetsApi.getTrajectory(); deterministic
// column layout (no force direction); click any node to highlight its
// sub-chain; client-side filter chips; auto-refresh every 30s.
//
// Bridge controls (the mechanism by which a vuln influences a risk) are
// surfaced as edge metadata + edge labels rather than as their own column,
// so the diagram reads as the user described: "this vuln on this asset
// drives that risk." Hover an edge to see the underlying control(s).

import { useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeMarker,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2, AlertCircle, Sparkles } from 'lucide-react';

import { assetsApi } from '@/lib/api';
import { AssetNode } from './nodes/AssetNode';
import { VulnNode } from './nodes/VulnNode';
import { RiskNode } from './nodes/RiskNode';
import { TrajectoryToolbar, type TrajectoryFilters } from './TrajectoryToolbar';
import { TrajectoryLegend } from './TrajectoryLegend';

// ─── Types matching the backend response ───────────────────────────────
interface AssetPayload {
  id: number; name: string; type: string;
  criticality: string; criticality_score: number | null;
  internet_facing: boolean;
  confidentiality_rating: number | null;
  integrity_rating: number | null;
  availability_rating: number | null;
}
interface VulnPayload {
  id: number; vuln_id: string | null; title: string;
  severity: string; cvss_score: number | null;
  composite_priority: number | null; kev_flag: boolean;
  epss_score: number | null; status: string;
  cve_id: string | null; cwe_id: string | null;
}
interface RiskPayload {
  id: number; title: string; status: string;
  inherent_score: number | null; residual_score: number | null;
  tier: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  source: 'direct' | 'via_control';
}
interface BridgeControl {
  code: string | null;
  name: string | null;
  framework_short_code: string | null;
  target_type: 'parsed' | 'framework' | 'normalized' | 'internal';
  source: 'manual' | 'auto_cwe';
  auto_cwe: string | null;
  effectiveness: string | null;
}
interface EdgePayload {
  from: string; to: string; kind: string;
  link_source?: string; auto_linked?: boolean; impact?: string | null;
  severity?: string;
  bridge_controls?: BridgeControl[];
  weakest_effectiveness?: string | null;
}
interface TrajectoryPayload {
  asset: AssetPayload;
  vulnerabilities: VulnPayload[];
  risks: RiskPayload[];
  edges: EdgePayload[];
  stats: {
    open_vulns: number;
    kev_count: number;
    vulns_with_risk_path: number;
    bridge_controls_total: number;
    risks_direct: number;
    risks_transitive: number;
    max_residual: number;
  };
}

// ─── Layout constants — 3 dense columns ────────────────────────────────
const COL_X = { asset: 40, vuln: 460, risk: 880 } as const;
const VULN_GAP = 14;
const VULN_HEIGHT = 138;
const RISK_GAP = 14;
const RISK_HEIGHT = 132;
const ASSET_HEIGHT = 170;

const nodeTypes: NodeTypes = {
  asset: AssetNode,
  vuln: VulnNode,
  risk: RiskNode,
};

// ─── Edge styling ──────────────────────────────────────────────────────
function edgeStyle(e: EdgePayload): { stroke: string; strokeWidth: number; strokeDasharray?: string; label?: string } {
  if (e.kind === 'affects') {
    const sev = (e.severity || '').toLowerCase();
    const w = sev === 'critical' ? 3.5 : sev === 'high' ? 2.5 : sev === 'medium' ? 1.8 : 1.2;
    return {
      stroke: sev === 'critical' ? '#f43f5e' : sev === 'high' ? '#fb923c' : sev === 'medium' ? '#f59e0b' : '#94a3b8',
      strokeWidth: w,
      strokeDasharray: e.auto_linked ? '4 3' : undefined,
      label: e.impact ? (e.impact[0]?.toUpperCase() ?? undefined) : undefined,
    };
  }
  if (e.kind === 'via_control') {
    const eff = (e.weakest_effectiveness || '').toLowerCase();
    const bridges = e.bridge_controls || [];
    const stroke =
      eff === 'full' ? '#10b981'
      : eff === 'partial' ? '#f59e0b'
      : eff === 'minimal' || eff === 'none' ? '#f43f5e'
      : '#6366f1';  // unknown effectiveness — indigo
    const dashed = eff !== 'full';
    const firstBridge = bridges[0];
    const label =
      bridges.length === 1 && firstBridge?.code
        ? `via ${firstBridge.code}`
        : bridges.length > 1
          ? `via ${bridges.length} ctrls`
          : 'via control';
    return {
      stroke,
      strokeWidth: 1.8,
      strokeDasharray: dashed ? '5 3' : undefined,
      label,
    };
  }
  if (e.kind === 'direct') {
    return { stroke: '#f43f5e', strokeWidth: 2.5, label: 'Direct' };
  }
  return { stroke: '#cbd5e1', strokeWidth: 1 };
}

// ─── Adjacency for highlight ripple ────────────────────────────────────
function buildAdjacency(edges: EdgePayload[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    if (!adj.has(e.to)) adj.set(e.to, new Set());
    adj.get(e.from)!.add(e.to);
    adj.get(e.to)!.add(e.from);
  }
  return adj;
}
function reachableFrom(start: string, adj: Map<string, Set<string>>): Set<string> {
  const visited = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    const neighbours = adj.get(cur);
    if (!neighbours) continue;
    neighbours.forEach((n) => {
      if (!visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    });
  }
  return visited;
}

interface Props {
  assetId: number;
}

export function TrajectoryMap({ assetId }: Props) {
  const { data, isLoading, error, isFetching, refetch } = useQuery<TrajectoryPayload>({
    queryKey: ['asset-trajectory', assetId],
    queryFn: async () => (await assetsApi.getTrajectory(assetId)).data as TrajectoryPayload,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const [filters, setFilters] = useState<TrajectoryFilters>({
    kevOnly: false,
    criticalOnly: false,
    riskBearingOnly: false,
    hideDirect: false,
  });
  const [showLegend, setShowLegend] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // ── Apply client-side filters ───────────────────────────────────────
  const filtered = useMemo(() => {
    if (!data) return null;

    // Compute which vulns have at least one outgoing risk edge — used for
    // the "Risk-bearing vulns only" filter chip.
    const vulnsWithRisk = new Set(
      data.edges.filter((e) => e.kind === 'via_control').map((e) => e.from),
    );

    let vulns = data.vulnerabilities;
    if (filters.kevOnly) vulns = vulns.filter((v) => v.kev_flag);
    if (filters.criticalOnly) vulns = vulns.filter((v) => v.severity?.toLowerCase() === 'critical');
    if (filters.riskBearingOnly) vulns = vulns.filter((v) => vulnsWithRisk.has(`vuln:${v.id}`));
    const vulnIds = new Set(vulns.map((v) => `vuln:${v.id}`));

    let edges = data.edges;
    if (filters.kevOnly || filters.criticalOnly || filters.riskBearingOnly) {
      edges = edges.filter((e) => {
        if (e.kind === 'affects') return vulnIds.has(e.to);
        if (e.kind === 'via_control') return vulnIds.has(e.from);
        return true;
      });
    }
    if (filters.hideDirect) edges = edges.filter((e) => e.kind !== 'direct');

    // Hide risks that have no inbound edges left after filtering
    const riskIdsAfter = new Set(edges.filter((e) => e.to.startsWith('risk:')).map((e) => e.to));
    const risks = data.risks.filter((r) => riskIdsAfter.has(`risk:${r.id}`));

    return { asset: data.asset, vulnerabilities: vulns, risks, edges, stats: data.stats };
  }, [data, filters]);

  // ── Adjacency for highlight ripple ──────────────────────────────────
  const adjacency = useMemo(
    () => (filtered ? buildAdjacency(filtered.edges) : new Map<string, Set<string>>()),
    [filtered],
  );
  const highlightedSet = useMemo(
    () => (selectedNodeId ? reachableFrom(selectedNodeId, adjacency) : null),
    [selectedNodeId, adjacency],
  );
  const isHighlighted = useCallback(
    (id: string) => !highlightedSet || highlightedSet.has(id),
    [highlightedSet],
  );

  // ── Build xyflow nodes + edges ──────────────────────────────────────
  const flowGraph = useMemo(() => {
    if (!filtered) return { nodes: [], edges: [] };

    const nodes: Node[] = [];

    // Sort vulns: KEV first, then by composite_priority desc
    const vulnsSorted = [...filtered.vulnerabilities].sort((a, b) => {
      if (a.kev_flag !== b.kev_flag) return a.kev_flag ? -1 : 1;
      return (b.composite_priority ?? 0) - (a.composite_priority ?? 0);
    });
    // Sort risks by residual desc
    const risksSorted = [...filtered.risks].sort(
      (a, b) => (b.residual_score ?? 0) - (a.residual_score ?? 0),
    );

    // Compute column heights so we can centre the asset node vertically
    // against the taller of (vulns, risks).
    const vulnsTotalHeight = vulnsSorted.length * VULN_HEIGHT + Math.max(0, vulnsSorted.length - 1) * VULN_GAP;
    const risksTotalHeight = risksSorted.length * RISK_HEIGHT + Math.max(0, risksSorted.length - 1) * RISK_GAP;
    const tallestColumn = Math.max(vulnsTotalHeight, risksTotalHeight, ASSET_HEIGHT);

    // Asset: centred vertically against the tallest column
    nodes.push({
      id: 'asset',
      type: 'asset',
      position: { x: COL_X.asset, y: 40 + (tallestColumn - ASSET_HEIGHT) / 2 },
      data: { ...filtered.asset, isHighlighted: isHighlighted('asset') },
      draggable: false,
      selectable: true,
    });

    // Vulns: top-anchored
    vulnsSorted.forEach((v, i) => {
      const id = `vuln:${v.id}`;
      nodes.push({
        id,
        type: 'vuln',
        position: { x: COL_X.vuln, y: 40 + i * (VULN_HEIGHT + VULN_GAP) },
        data: {
          db_id: v.id,
          vuln_id: v.vuln_id,
          title: v.title,
          severity: v.severity,
          cvss_score: v.cvss_score,
          composite_priority: v.composite_priority,
          kev_flag: v.kev_flag,
          status: v.status,
          cve_id: v.cve_id,
          cwe_id: v.cwe_id,
          isHighlighted: isHighlighted(id),
        },
        draggable: false,
      });
    });

    // Risks: top-anchored
    risksSorted.forEach((r, i) => {
      const id = `risk:${r.id}`;
      nodes.push({
        id,
        type: 'risk',
        position: { x: COL_X.risk, y: 40 + i * (RISK_HEIGHT + RISK_GAP) },
        data: {
          risk_id: r.id,
          title: r.title,
          status: r.status,
          inherent_score: r.inherent_score,
          residual_score: r.residual_score,
          tier: r.tier,
          source: r.source,
          isHighlighted: isHighlighted(id),
        },
        draggable: false,
      });
    });

    // Edges — only render those whose endpoints still exist in this filter slice.
    const liveNodeIds = new Set(nodes.map((n) => n.id));
    const edges: Edge[] = filtered.edges
      .filter((e) => liveNodeIds.has(e.from) && liveNodeIds.has(e.to))
      .map((e, i): Edge => {
        const s = edgeStyle(e);
        const dim = highlightedSet && !(highlightedSet.has(e.from) && highlightedSet.has(e.to));
        const marker: EdgeMarker = { type: MarkerType.ArrowClosed, color: s.stroke };
        const bridgeTooltip =
          e.kind === 'via_control' && e.bridge_controls && e.bridge_controls.length
            ? e.bridge_controls
                .map((b) => `${b.code || 'Control'} (${b.effectiveness || 'mitigation unknown'})`)
                .join('\n')
            : undefined;
        return {
          id: `e-${i}-${e.from}->${e.to}`,
          source: e.from,
          target: e.to,
          type: 'default',
          animated: e.kind === 'affects' && (e.severity === 'critical' || e.severity === 'high'),
          label: s.label,
          labelStyle: { fontSize: 9, fill: '#475569', fontWeight: 600 },
          labelBgStyle: { fill: '#fff', fillOpacity: 0.92 },
          labelBgPadding: [3, 2],
          labelBgBorderRadius: 3,
          ariaLabel: bridgeTooltip,
          style: {
            stroke: s.stroke,
            strokeWidth: s.strokeWidth,
            strokeDasharray: s.strokeDasharray,
            opacity: dim ? 0.15 : 1,
          },
          markerEnd: marker,
        };
      });

    return { nodes, edges };
  }, [filtered, isHighlighted, highlightedSet]);

  // ── States ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-[500px] items-center justify-center rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Building trajectory map…</span>
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex h-[500px] flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-700">
        <AlertCircle className="mb-2 h-6 w-6" />
        <p className="text-sm">Could not load trajectory data.</p>
        <button
          onClick={() => refetch()}
          className="mt-3 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
        >
          Try again
        </button>
      </div>
    );
  }

  const hasContent = data.vulnerabilities.length > 0 || data.risks.length > 0;
  if (!hasContent) {
    return (
      <div className="flex h-[500px] flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50/50 text-center">
        <Sparkles className="mb-2 h-7 w-7 text-slate-300" />
        <h3 className="text-sm font-semibold text-slate-700">Nothing linked yet</h3>
        <p className="mt-1 max-w-sm text-xs text-slate-500">
          As vulnerabilities are detected and risks are linked to this asset, they&apos;ll appear here
          as an interactive trajectory: Asset → Vulnerability → Risk.
        </p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <TrajectoryToolbar
        filters={filters}
        setFilters={setFilters}
        onRefresh={() => refetch()}
        isFetching={isFetching}
        onShowLegend={() => setShowLegend((s) => !s)}
        stats={data.stats}
      />
      {showLegend && <TrajectoryLegend onClose={() => setShowLegend(false)} />}
      <div className="h-[640px]">
        <ReactFlowProvider>
          <ReactFlow
            nodes={flowGraph.nodes}
            edges={flowGraph.edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.35}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => {
              setSelectedNodeId((cur) => (cur === node.id ? null : node.id));
            }}
            onPaneClick={() => setSelectedNodeId(null)}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
          >
            <Background gap={20} size={1} color="#e2e8f0" />
            <Controls
              showInteractive={false}
              position="bottom-right"
              style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}
            />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
