'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, ExternalLink } from 'lucide-react';

export interface RiskNodeData extends Record<string, unknown> {
  risk_id: number;
  title: string;
  status: string;
  inherent_score: number | null;
  residual_score: number | null;
  tier: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  source: 'direct' | 'via_control';
  isHighlighted: boolean;
}

const TIER_TONE: Record<string, { border: string; text: string; chip: string }> = {
  critical: { border: 'border-l-rose-500',    text: 'text-rose-700',    chip: 'bg-rose-50 text-rose-700 border-rose-200' },
  high:     { border: 'border-l-orange-500',  text: 'text-orange-700',  chip: 'bg-orange-50 text-orange-700 border-orange-200' },
  medium:   { border: 'border-l-amber-500',   text: 'text-amber-700',   chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  low:      { border: 'border-l-emerald-500', text: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  unknown:  { border: 'border-l-slate-300',   text: 'text-slate-600',   chip: 'bg-slate-100 text-slate-700 border-slate-200' },
};

function RiskNodeBase({ data }: NodeProps) {
  const d = data as RiskNodeData;
  const tone = TIER_TONE[d.tier] || TIER_TONE.unknown;

  return (
    <div
      className={`min-w-[200px] max-w-[260px] rounded-lg border bg-white border-l-4 ${tone.border} shadow-sm transition-opacity ${d.isHighlighted ? 'opacity-100' : 'opacity-40'}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400 !w-2 !h-2" />
      <div className="p-2.5">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className={`h-3 w-3 ${tone.text}`} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Risk</span>
          <span className={`ml-auto rounded border px-1 py-px text-[8px] font-bold uppercase ${
            d.source === 'direct'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-blue-200 bg-blue-50 text-blue-700'
          }`}>
            {d.source === 'direct' ? 'Direct' : 'Via Ctrl'}
          </span>
        </div>
        <div className="mt-1 text-xs font-semibold text-slate-900 line-clamp-2" title={d.title}>
          {d.title}
        </div>
        <div className="mt-1.5 flex items-end gap-2">
          {d.residual_score != null && (
            <div className="flex flex-col">
              <span className="text-[8px] font-medium uppercase text-slate-500">Residual</span>
              <span className={`text-lg font-bold tabular-nums ${tone.text}`}>{d.residual_score}</span>
            </div>
          )}
          {d.inherent_score != null && (
            <div className="flex flex-col">
              <span className="text-[8px] font-medium uppercase text-slate-400">Inherent</span>
              <span className="text-xs font-semibold text-slate-500 tabular-nums">{d.inherent_score}</span>
            </div>
          )}
          <span className={`ml-auto rounded border px-1.5 py-px text-[9px] font-medium uppercase ${tone.chip}`}>
            {d.tier === 'unknown' ? '—' : d.tier}
          </span>
        </div>
        <Link
          href={`/erm/risks/${d.risk_id}`}
          onClick={(e) => e.stopPropagation()}
          className="mt-1.5 inline-flex items-center gap-0.5 text-[9px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
        >
          View risk <ExternalLink className="h-2 w-2" />
        </Link>
      </div>
    </div>
  );
}

export const RiskNode = memo(RiskNodeBase);
