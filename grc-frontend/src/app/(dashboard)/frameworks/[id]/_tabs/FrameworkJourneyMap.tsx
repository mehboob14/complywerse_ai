'use client';

/**
 * FrameworkJourneyMap — the "Map" view of a framework's compliance journey.
 * Interactive React-Flow canvas (mirroring the asset Risk-Trajectory pattern):
 * the main stage cards run left→right joined by the journey arrows, and each
 * stage fans out with two derived cards — its Deliverables and its Evidence &
 * artifacts. The continual-improvement loop-back is a real curved edge arcing
 * over the top back to its target stage. Click any card to focus a stage.
 */

import { memo, useMemo, useState } from 'react';
import {
  ReactFlow, Background, Controls, ReactFlowProvider,
  Handle, Position, MarkerType,
  type Node, type Edge, type NodeTypes, type NodeProps, type EdgeMarker,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Building2, FileText, MousePointerClick, Paperclip, Repeat, UserRound } from 'lucide-react';
import type { FrameworkFlow } from '../_data/frameworkFlows';

interface Props {
  flow: FrameworkFlow;
  liveControls?: number;
  /** 0–1 completion of the live journey, used to mark stage status. */
  progressRatio?: number;
}

type StageStatus = 'done' | 'in_progress' | 'upcoming';
function stageStatus(i: number, total: number, ratio: number): StageStatus {
  if (ratio >= 1) return 'done';
  const current = Math.floor(ratio * total);
  if (i < current) return 'done';
  if (i === current) return 'in_progress';
  return 'upcoming';
}
const STATUS_PILL: Record<StageStatus, { label: string; cls: string }> = {
  done: { label: 'Done', cls: 'border-primary-200 bg-primary-50 text-primary-700' },
  in_progress: { label: 'In progress', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  upcoming: { label: 'Upcoming', cls: 'border-slate-200 bg-slate-100 text-slate-500' },
};

// ── Layout — one cluster (main + 2 derived cards) per stage ───────────
const MAIN_W = 240;
const CHILD_W = 216;
const PITCH = 520;       // horizontal distance between stage clusters
const MAIN_Y = 132;      // room above for the loop-back arc
const CHILD_Y = 344;
const CHILD_DX = 118;    // derived-card centre offset from the cluster centre

// ── Edge colours (React-Flow needs raw hex, not Tailwind classes) ─────
const TEAL = '#1ed4b0';
const TEAL_DEEP = '#0d9488';
const AMBER = '#f59e0b';

/* ── Main stage node ───────────────────────────────────────────────── */
interface StageNodeData extends Record<string, unknown> {
  n: number; name: string; ext: boolean; coverage: string; owner: string;
  total: number; isLoopTarget: boolean; selected: boolean; dimmed: boolean; status: StageStatus;
}

function StageNodeBase({ data }: NodeProps) {
  const d = data as StageNodeData;
  const ext = d.ext;
  return (
    <div
      className={`w-[240px] rounded-xl border bg-white shadow-sm transition-all ${ext ? 'border-amber-200' : 'border-slate-200'} ${d.selected ? 'ring-2 ring-primary-500 ring-offset-2' : ''} ${d.dimmed ? 'opacity-40' : 'opacity-100'}`}
    >
      <Handle id="in" type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-slate-300" />
      <Handle id="out" type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-slate-300" />
      <Handle id="d-out" type="source" position={Position.Bottom} style={{ left: '28%' }} className="!h-2 !w-2 !border-0 !bg-slate-300" />
      <Handle id="e-out" type="source" position={Position.Bottom} style={{ left: '72%' }} className="!h-2 !w-2 !border-0 !bg-slate-300" />
      <Handle id="loop-in" type="target" position={Position.Top} style={{ left: '40%' }} className="!h-2 !w-2 !border-0 !bg-primary-400" />
      <Handle id="loop-out" type="source" position={Position.Top} style={{ left: '60%' }} className="!h-2 !w-2 !border-0 !bg-primary-400" />
      <div className="relative overflow-hidden rounded-xl">
        <span className={`absolute inset-y-0 left-0 w-1 ${ext ? 'bg-amber-400' : 'bg-primary-500'}`} />
        <div className="p-3.5 pl-4">
          <div className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-md border text-xs font-bold ${ext ? 'border-amber-300 bg-amber-100 text-amber-700' : 'border-primary-600 bg-primary-500 text-[#0a0a0a]'}`}>
              {d.n}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${ext ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-primary-200 bg-primary-50 text-primary-700'}`}>
              {ext ? <><Building2 className="h-2.5 w-2.5" strokeWidth={2} />External</> : 'Internal'}
            </span>
            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${STATUS_PILL[d.status].cls}`}>{STATUS_PILL[d.status].label}</span>
            <span className="ml-auto text-[9px] font-semibold uppercase tracking-wider text-slate-400">{d.n}/{d.total}</span>
            {d.isLoopTarget && <Repeat className="h-3.5 w-3.5 text-primary-600" strokeWidth={2.25} />}
          </div>
          <h4 className="mt-2 text-[13px] font-semibold leading-snug text-slate-900">{d.name}</h4>
          <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-slate-500">{d.coverage}</p>
          <div className="mt-2.5 flex items-center gap-1.5 border-t border-slate-100 pt-2">
            <UserRound className="h-3 w-3 flex-shrink-0 text-slate-400" strokeWidth={1.9} />
            <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Owner</span>
            <span className="truncate text-[11px] font-medium text-slate-700" title={d.owner}>{d.owner}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
const StageNode = memo(StageNodeBase);

/* ── Derived bundle node (Deliverables / Evidence) ─────────────────── */
interface BundleNodeData extends Record<string, unknown> {
  kind: 'deliverables' | 'evidence';
  items: string[]; ext: boolean; dimmed: boolean;
}

function BundleNodeBase({ data }: NodeProps) {
  const d = data as BundleNodeData;
  const isDeliv = d.kind === 'deliverables';
  const dot = d.ext ? 'bg-amber-400' : 'bg-primary-500';
  return (
    <div
      className={`w-[216px] rounded-lg border bg-white shadow-sm transition-all ${d.ext ? 'border-amber-200' : 'border-slate-200'} ${d.dimmed ? 'opacity-40' : 'opacity-100'}`}
    >
      <Handle id="in" type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-slate-300" />
      <div className="relative overflow-hidden rounded-lg">
        <span className={`absolute inset-y-0 left-0 w-0.5 ${d.ext ? 'bg-amber-300' : 'bg-primary-400'}`} />
        <div className="p-2.5 pl-3">
          <h5 className="mb-1.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            {isDeliv ? <FileText className="h-3 w-3" strokeWidth={1.9} /> : <Paperclip className="h-3 w-3" strokeWidth={1.9} />}
            {isDeliv ? 'Deliverables' : 'Evidence & artifacts'}
          </h5>
          <ul className="space-y-1">
            {d.items.map((it, idx) => (
              <li key={idx} className="flex gap-1.5 text-[11px] leading-snug text-slate-700">
                <span className={`mt-1.5 h-1 w-1 flex-shrink-0 rounded-full ${dot}`} />
                <span>{it}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
const BundleNode = memo(BundleNodeBase);

const nodeTypes: NodeTypes = { stage: StageNode, bundle: BundleNode };

export default function FrameworkJourneyMap({ flow, progressRatio = 0 }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const total = flow.phases.length;

  const graph = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    flow.phases.forEach((p, i) => {
      const cx = i * PITCH + PITCH / 2;
      const stageDim = selected != null && selected !== p.n;

      // Main stage card
      nodes.push({
        id: `stage-${p.n}`,
        type: 'stage',
        position: { x: cx - MAIN_W / 2, y: MAIN_Y },
        data: {
          n: p.n, name: p.name, ext: p.ext, coverage: p.coverage, owner: p.owner, total,
          isLoopTarget: p.n === flow.loopback.to,
          selected: selected === p.n,
          dimmed: stageDim,
          status: stageStatus(i, total, progressRatio),
        } as StageNodeData,
        draggable: false,
      });

      // Derived cards — Deliverables (left) + Evidence (right)
      nodes.push({
        id: `del-${p.n}`,
        type: 'bundle',
        position: { x: cx - CHILD_DX - CHILD_W / 2, y: CHILD_Y },
        data: { kind: 'deliverables', items: p.deliverables, ext: p.ext, dimmed: stageDim } as BundleNodeData,
        draggable: false,
      });
      nodes.push({
        id: `ev-${p.n}`,
        type: 'bundle',
        position: { x: cx + CHILD_DX - CHILD_W / 2, y: CHILD_Y },
        data: { kind: 'evidence', items: p.evidence, ext: p.ext, dimmed: stageDim } as BundleNodeData,
        draggable: false,
      });

      // Fan-out arrows from the stage card to its two derived cards
      const tone = p.ext ? AMBER : TEAL;
      const fanOp = selected != null && selected !== p.n ? 0.18 : 0.9;
      edges.push({
        id: `fan-del-${p.n}`, source: `stage-${p.n}`, target: `del-${p.n}`,
        sourceHandle: 'd-out', targetHandle: 'in', type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, color: tone, width: 14, height: 14 } as EdgeMarker,
        style: { stroke: tone, strokeWidth: 1.5, opacity: fanOp },
      });
      edges.push({
        id: `fan-ev-${p.n}`, source: `stage-${p.n}`, target: `ev-${p.n}`,
        sourceHandle: 'e-out', targetHandle: 'in', type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, color: tone, width: 14, height: 14 } as EdgeMarker,
        style: { stroke: tone, strokeWidth: 1.5, opacity: fanOp },
      });
    });

    // Main journey arrows between consecutive stages
    for (let i = 0; i < flow.phases.length - 1; i++) {
      const a = flow.phases[i];
      const b = flow.phases[i + 1];
      const involves = selected != null && (selected === a.n || selected === b.n);
      edges.push({
        id: `chain-${a.n}-${b.n}`,
        source: `stage-${a.n}`, target: `stage-${b.n}`,
        sourceHandle: 'out', targetHandle: 'in', type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, color: b.ext ? AMBER : TEAL } as EdgeMarker,
        style: { stroke: b.ext ? AMBER : TEAL, strokeWidth: 2.5, opacity: selected != null && !involves ? 0.18 : 1 },
      });
    }

    // Loop-back — arcs over the top from its origin stage to its target stage
    const lf = flow.loopback.from;
    const lt = flow.loopback.to;
    const loopInvolves = selected != null && (selected === lf || selected === lt);
    edges.push({
      id: `loop-${lf}-${lt}`,
      source: `stage-${lf}`, target: `stage-${lt}`,
      sourceHandle: 'loop-out', targetHandle: 'loop-in', type: 'default', animated: true,
      label: `↻ ${flow.loopback.label}`,
      labelStyle: { fontSize: 10, fill: '#0f766e', fontWeight: 600 },
      labelBgStyle: { fill: '#f0fdfa', fillOpacity: 0.96 },
      labelBgPadding: [5, 3], labelBgBorderRadius: 5,
      markerEnd: { type: MarkerType.ArrowClosed, color: TEAL_DEEP } as EdgeMarker,
      style: { stroke: TEAL_DEEP, strokeWidth: 1.8, strokeDasharray: '6 4', opacity: selected != null && !loopInvolves ? 0.22 : 1 },
    });

    return { nodes, edges };
  }, [flow, selected, total, progressRatio]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <MousePointerClick className="h-3.5 w-3.5 text-primary-600" strokeWidth={1.9} />
          Each stage fans out to its Deliverables and Evidence &amp; artifacts · drag to pan · scroll to zoom · click to focus a stage
        </div>
        {selected != null && (
          <button
            onClick={() => setSelected(null)}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Reset focus
          </button>
        )}
      </div>
      <div className="h-[640px] bg-slate-50/40">
        <ReactFlowProvider>
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            defaultViewport={{ x: 24, y: 12, zoom: 0.66 }}
            minZoom={0.2}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => {
              const n = Number(String(node.id).split('-').pop());
              if (!Number.isNaN(n)) setSelected((cur) => (cur === n ? null : n));
            }}
            onPaneClick={() => setSelected(null)}
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
