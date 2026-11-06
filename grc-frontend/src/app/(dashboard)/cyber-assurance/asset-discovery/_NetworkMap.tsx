'use client';

// NetworkMap — the discovery topology tab.
// ─────────────────────────────────────────────────────────────────────────
// Reads /discovery/topology (built by the Phase-1 topology linker) and draws
// the LAN as a graph: devices grouped by subnet, each host linked to its
// gateway. One backend round trip; deterministic depth-from-gateway layout
// (gateway on top, its hosts below) so it renders the Phase-1 star today and
// becomes the switch tree automatically once Phase-2 (SNMP) adds those edges.
// Map/List toggle; click-drag to rearrange; auto-refresh after a sweep.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ReactFlow, Background, Controls, ReactFlowProvider,
  Handle, Position, MarkerType,
  type Node, type Edge, type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2, AlertCircle, Radar, RefreshCw } from 'lucide-react';
import { discoveryApi } from '@/cyber-assurance/lib/api';

interface ApiNode { id: number; label: string; ip: string | null; type: string; subnet: string | null; in_inventory: boolean; }
interface ApiEdge { source: number; target: number; measured?: boolean; }
interface TopoPayload { nodes: ApiNode[]; edges: ApiEdge[]; }
interface NodeData { label: string; ip: string | null; type: string; isGateway: boolean; }

const ICON: Record<string, string> = {
  firewall: '🛡️', router: '🌐', gateway: '🌐', network_device: '🌐', switch: '🔀',
  host: '🖥️', pc: '🖥️', laptop: '💻', server: '🗄️', printer: '🖨️',
  camera: '📷', voip: '☎️', dns_server: '🗂️', appliance: '📦',
  hypervisor: '🧱', storage: '💾', ups: '🔋', subnet: '▦', unknown: '❓',
};
const icon = (t: string) => ICON[t] || '❓';
const typeLabel = (t: string) =>
  ({ network_device: 'Network device', dns_server: 'DNS server', voip: 'VoIP phone', pc: 'Windows PC' } as Record<string, string>)[t]
  || (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Unknown');

// ─── Custom node ───────────────────────────────────────────────────────
function TopoCard({ data }: { data: NodeData }) {
  const isSubnet = data.type === 'subnet';
  const accent = isSubnet || data.type === 'switch' ? 'var(--as-blue, #1d4ed8)'
    : data.isGateway ? 'var(--as-amber, #b45309)'
    : 'var(--as-border, #cbd5e1)';
  return (
    <div style={{
      width: 150, background: 'var(--as-card, #fff)', border: `2px solid ${accent}`,
      borderRadius: 10, padding: '8px 10px', textAlign: 'center',
      boxShadow: '0 1px 2px rgba(16,24,40,.06)',
    }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div style={{ fontSize: 16, lineHeight: 1 }}>{icon(data.type)}</div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--as-ink, #141a22)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.label}</div>
      {data.ip && <div style={{ fontSize: 10.5, fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--as-faint, #8b96a5)' }}>{data.ip}</div>}
      {isSubnet
        ? <div style={{ marginTop: 4, fontSize: 9, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--as-blue, #1d4ed8)' }}>segment</div>
        : data.isGateway && <div style={{ marginTop: 4, fontSize: 9, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--as-amber, #b45309)' }}>Gateway</div>}
    </div>
  );
}
const nodeTypes: NodeTypes = { topo: TopoCard };

// ─── Layout: subnet clusters, depth from gateway ───────────────────────
const ROW_H = 128, COL_W = 180, SUBNET_GAP = 70, TOP = 20, MAX_COLS = 8;

function build(payload: TopoPayload) {
  const links = payload.edges;   // all edges are host→anchor connects_to (endpoint no longer tags a type)
  const byId = new Map<number, ApiNode>(payload.nodes.map((n) => [n.id, n] as [number, ApiNode]));
  const parentOf = new Map<number, number>();
  links.forEach((e) => { if (!parentOf.has(e.source)) parentOf.set(e.source, e.target); });
  const targets = new Set(links.map((e) => e.target));

  const depthMemo = new Map<number, number>();
  const depth = (id: number, seen = new Set<number>()): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    const p = parentOf.get(id);
    let d = 0;
    if (p != null && p !== id && byId.has(p) && !seen.has(id)) { seen.add(id); d = 1 + depth(p, seen); }
    depthMemo.set(id, d);
    return d;
  };
  const isGateway = (n: ApiNode) => depth(n.id) === 0 && targets.has(n.id);

  // group by subnet
  const subnets = new Map<string, ApiNode[]>();
  payload.nodes.forEach((n) => {
    const k = n.subnet || 'other';
    const arr = subnets.get(k) || [];
    arr.push(n); subnets.set(k, arr);
  });

  const nodes: Node[] = [];
  let xCursor = 0;
  for (const [, members] of Array.from(subnets.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    const rows = new Map<number, ApiNode[]>();
    members.forEach((n) => { const d = depth(n.id); const arr = rows.get(d) || []; arr.push(n); rows.set(d, arr); });
    // Band width = the widest level; a level with many nodes (e.g. 30 hosts off one
    // gateway) WRAPS into a grid of up to MAX_COLS columns instead of one huge row.
    let bandCols = 1;
    for (const r of Array.from(rows.values())) bandCols = Math.max(bandCols, Math.min(r.length, MAX_COLS));
    const bandW = bandCols * COL_W;
    let yCursor = TOP;
    for (const [, rowNodes] of Array.from(rows.entries()).sort((a, b) => a[0] - b[0])) {
      rowNodes.sort((a, b) => (a.ip || '').localeCompare(b.ip || '', undefined, { numeric: true }));
      const cols = Math.min(rowNodes.length, MAX_COLS);
      const rowsNeeded = Math.ceil(rowNodes.length / cols);
      rowNodes.forEach((n, i) => {
        const cx = i % cols, cy = Math.floor(i / cols);
        const inThisRow = Math.min(cols, rowNodes.length - cy * cols);   // last grid-row may be short → center it
        const offset = (bandW - inThisRow * COL_W) / 2;
        nodes.push({
          id: String(n.id), type: 'topo',
          position: { x: xCursor + offset + cx * COL_W, y: yCursor + cy * ROW_H },
          data: { label: n.label, ip: n.ip, type: n.type, isGateway: isGateway(n) },
        });
      });
      yCursor += rowsNeeded * ROW_H;
    }
    xCursor += bandW + SUBNET_GAP;
  }

  // Edges drawn parent→child (gateway on top) so they route top-down cleanly.
  // Solid green = measured over SNMP (LLDP/CDP/FDB); dashed grey = inferred gateway.
  const edges: Edge[] = links.map((e, i) => {
    const measured = !!e.measured;
    const color = measured ? 'var(--as-green, #15803d)' : 'var(--as-faint, #94a3b8)';
    return {
      id: `e${i}`, source: String(e.target), target: String(e.source), type: 'default',
      style: { stroke: color, strokeWidth: measured ? 2 : 1.6, strokeDasharray: measured ? undefined : '5 4' },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    };
  });

  // Rows for the list view.
  const rows = payload.nodes
    .map((n) => {
      const parent = parentOf.get(n.id);
      const p = parent != null ? byId.get(parent) : undefined;
      return { ...n, isGateway: isGateway(n), connectsTo: p || null };
    })
    .sort((a, b) => (a.subnet || '').localeCompare(b.subnet || '', undefined, { numeric: true }) || (a.ip || '').localeCompare(b.ip || '', undefined, { numeric: true }));

  return { nodes, edges, rows };
}

// ─── shared small bits ─────────────────────────────────────────────────
function Seg({ view, setView }: { view: 'map' | 'list'; setView: (v: 'map' | 'list') => void }) {
  const btn = (v: 'map' | 'list', label: string): React.CSSProperties => ({
    border: 0, background: view === v ? 'var(--as-card, #fff)' : 'transparent',
    color: view === v ? 'var(--as-ink, #141a22)' : 'var(--as-muted, #586675)',
    font: 'inherit', fontWeight: 650, fontSize: 13, padding: '6px 13px', borderRadius: 7, cursor: 'pointer',
    boxShadow: view === v ? '0 1px 2px rgba(16,24,40,.08)' : 'none',
  });
  return (
    <div style={{ display: 'inline-flex', background: 'var(--as-track, #e9edf2)', border: '1px solid var(--as-border, #dbe1e9)', borderRadius: 10, padding: 3 }}>
      <button style={btn('map', 'Map')} onClick={() => setView('map')}>◱ Map</button>
      <button style={btn('list', 'List')} onClick={() => setView('list')}>≣ List</button>
    </div>
  );
}

const legend = (
  <span style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--as-muted)' }}>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--as-amber, #b45309)' }} />Gateway</span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--as-blue, #1d4ed8)' }} />Switch</span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--as-faint, #8b96a5)' }} />Host / device</span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 18, height: 0, borderTop: '2px solid var(--as-green, #15803d)' }} />measured</span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 18, height: 0, borderTop: '2px dashed var(--as-faint, #94a3b8)' }} />inferred</span>
  </span>
);

// ─── the tab ───────────────────────────────────────────────────────────
export default function NetworkMap() {
  const [view, setView] = useState<'map' | 'list'>('map');
  const [runId, setRunId] = useState<number | null>(null);
  const runsQ = useQuery({
    queryKey: ['disc-runs-map'],
    queryFn: async () => (await discoveryApi.listRuns(undefined, 50)).data.runs as any[],
  });
  const { data, isLoading, error, isFetching, refetch } = useQuery<TopoPayload>({
    queryKey: ['disc-topology', runId],
    queryFn: async () => (await discoveryApi.topology(runId ?? undefined)).data as TopoPayload,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const graph = useMemo(() => (data ? build(data) : { nodes: [], edges: [], rows: [] }), [data]);

  const head = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <span className="eyebrow">Asset Discovery</span>
        <h2 style={{ margin: '2px 0 0' }}>Network map</h2>
      </div>
      <select value={runId ?? ''} onChange={(e) => setRunId(e.target.value ? Number(e.target.value) : null)}
        title="Show devices from one discovery run, or the current state across all runs"
        style={{ border: '1px solid var(--as-border)', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: 'var(--as-card)', color: 'var(--as-ink)', fontFamily: 'inherit' }}>
        <option value="">All runs (current state)</option>
        {(runsQ.data ?? []).map((r: any) => (
          <option key={r.id} value={r.id}>Run #{r.id} · {r.hosts_seen ?? 0} hosts · {new Date(r.finished_at || r.created_at).toLocaleDateString()}</option>
        ))}
      </select>
      <Seg view={view} setView={setView} />
      <button className="btn btn-secondary" onClick={() => refetch()} title="Refresh" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Refresh
      </button>
      {view === 'map' && legend}
    </div>
  );

  if (isLoading) {
    return (
      <div className="disc-cc">{head}
        <div style={{ height: 300, display: 'grid', placeItems: 'center', color: 'var(--as-muted)', border: '1px solid var(--as-border)', borderRadius: 14, background: 'var(--as-card)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Loader2 size={18} className="animate-spin" /> Building the map…</span>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="disc-cc">{head}
        <div style={{ height: 240, display: 'grid', placeItems: 'center', gap: 8, color: 'var(--as-danger-text)', border: '1px solid var(--as-danger-bg)', borderRadius: 14, background: 'var(--as-danger-bg)' }}>
          <AlertCircle size={22} /><span style={{ fontSize: 13 }}>Could not load the topology.</span>
          <button className="btn btn-secondary" onClick={() => refetch()}>Try again</button>
        </div>
      </div>
    );
  }
  if (!data || data.nodes.length === 0) {
    return (
      <div className="disc-cc">{head}
        <div style={{ padding: '40px 18px', textAlign: 'center', border: '1px dashed var(--as-border)', borderRadius: 14, background: 'var(--as-subtle)' }}>
          <Radar size={26} style={{ color: 'var(--as-faint)' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--as-muted)', marginTop: 8 }}>No network devices mapped yet.</div>
          <div style={{ fontSize: 12.5, color: 'var(--as-faint)', marginTop: 4 }}>Run a network sweep — discovered devices are linked to their gateway automatically and show up here.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="disc-cc">{head}
      {view === 'map' ? (
        <div style={{ height: 640, border: '1px solid var(--as-border)', borderRadius: 14, overflow: 'hidden', background: 'var(--as-card)' }}>
          <ReactFlowProvider>
            <ReactFlow
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.25}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
              nodesConnectable={false}
              elementsSelectable
            >
              <Background gap={20} size={1} color="var(--as-border, #e2e8f0)" />
              <Controls showInteractive={false} position="bottom-right" style={{ background: 'var(--as-card)', border: '1px solid var(--as-border)', borderRadius: 8 }} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--as-border)', borderRadius: 14, background: 'var(--as-card)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['Device', 'IP', 'Type', 'Subnet', 'Connects to'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 13px', fontSize: 10.5, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--as-muted)', fontWeight: 700, background: 'var(--as-subtle)', borderBottom: '1px solid var(--as-border)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {graph.rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: '10px 13px', borderBottom: '1px solid var(--as-row)', color: 'var(--as-ink)' }}>
                    <span style={{ fontSize: 15, marginRight: 6 }}>{icon(r.type)}</span><b>{r.label}</b>
                    {r.isGateway && <span style={{ marginLeft: 7, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--as-amber, #b45309)' }}>Gateway</span>}
                  </td>
                  <td style={{ padding: '10px 13px', borderBottom: '1px solid var(--as-row)', fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--as-secondary)' }}>{r.ip || '—'}</td>
                  <td style={{ padding: '10px 13px', borderBottom: '1px solid var(--as-row)', color: 'var(--as-secondary)' }}>{typeLabel(r.type)}</td>
                  <td style={{ padding: '10px 13px', borderBottom: '1px solid var(--as-row)', fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--as-faint)' }}>{r.subnet || '—'}</td>
                  <td style={{ padding: '10px 13px', borderBottom: '1px solid var(--as-row)', color: 'var(--as-secondary)' }}>
                    {r.connectsTo
                      ? <><span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.connectsTo.label}</span> <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--as-faint)' }}>{r.connectsTo.ip}</span></>
                      : <span style={{ color: 'var(--as-faint)' }}>— gateway —</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
