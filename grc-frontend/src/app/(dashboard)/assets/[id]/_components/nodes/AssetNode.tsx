'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Server, Globe, Lock } from 'lucide-react';

export interface AssetNodeData extends Record<string, unknown> {
  name: string;
  type: string;
  criticality: string;
  criticality_score: number | null;
  internet_facing: boolean;
  confidentiality_rating: number | null;
  integrity_rating: number | null;
  availability_rating: number | null;
  isHighlighted: boolean;
}

const CRITICALITY_TONE: Record<string, { border: string; chip: string }> = {
  critical: { border: 'border-l-rose-500',   chip: 'bg-rose-50 text-rose-700 border-rose-200' },
  high:     { border: 'border-l-orange-500', chip: 'bg-orange-50 text-orange-700 border-orange-200' },
  medium:   { border: 'border-l-amber-500',  chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  low:      { border: 'border-l-emerald-500',chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

function AssetNodeBase({ data }: NodeProps) {
  const d = data as AssetNodeData;
  const tone = CRITICALITY_TONE[(d.criticality || '').toLowerCase()] || CRITICALITY_TONE.medium;
  const cia = (label: string, v: number | null) => (
    <div className="flex items-center gap-1">
      <span className="text-[9px] font-semibold text-slate-500">{label}</span>
      <span className={`rounded px-1 text-[9px] font-semibold ${
        (v ?? 0) >= 4 ? 'bg-rose-50 text-rose-700'
        : (v ?? 0) >= 3 ? 'bg-amber-50 text-amber-700'
        : 'bg-slate-100 text-slate-600'
      }`}>{v ?? '—'}</span>
    </div>
  );

  return (
    <div
      className={`min-w-[220px] max-w-[260px] rounded-xl border bg-white border-l-4 ${tone.border} shadow-md transition-opacity ${d.isHighlighted ? 'opacity-100' : 'opacity-40'}`}
    >
      <Handle type="source" position={Position.Right} className="!bg-slate-400 !w-2 !h-2" />
      <div className="p-3">
        <div className="flex items-start gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100 shrink-0">
            <Server className="h-3.5 w-3.5 text-blue-600" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Asset</div>
            <div className="truncate text-sm font-semibold text-slate-900" title={d.name}>{d.name}</div>
            <div className="mt-0.5 flex items-center gap-1 flex-wrap">
              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px text-[9px] font-medium uppercase text-slate-600">
                {d.type}
              </span>
              <span className={`rounded border px-1.5 py-px text-[9px] font-medium uppercase ${tone.chip}`}>
                {d.criticality}
              </span>
              {d.internet_facing && (
                <span className="inline-flex items-center gap-0.5 rounded border border-rose-200 bg-rose-50 px-1.5 py-px text-[9px] font-medium uppercase text-rose-700">
                  <Globe className="h-2.5 w-2.5" /> Exposed
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-1.5">
          <Lock className="h-3 w-3 text-slate-400" />
          {cia('C', d.confidentiality_rating)}
          {cia('I', d.integrity_rating)}
          {cia('A', d.availability_rating)}
          {d.criticality_score != null && (
            <span className="ml-auto text-[10px] font-semibold text-slate-700 tabular-nums">
              {d.criticality_score.toFixed(1)}/10
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export const AssetNode = memo(AssetNodeBase);
