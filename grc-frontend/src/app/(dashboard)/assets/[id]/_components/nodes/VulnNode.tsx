'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Bug, Zap, ExternalLink } from 'lucide-react';

export interface VulnNodeData extends Record<string, unknown> {
  vuln_id: string | null;
  db_id: number;
  title: string;
  severity: string;
  cvss_score: number | null;
  composite_priority: number | null;
  kev_flag: boolean;
  status: string;
  cve_id: string | null;
  cwe_id: string | null;
  isHighlighted: boolean;
}

const SEV_TONE: Record<string, { border: string; chip: string; bar: string }> = {
  critical: { border: 'border-t-rose-500',   chip: 'bg-rose-50 text-rose-700',     bar: 'bg-rose-500' },
  high:     { border: 'border-t-orange-500', chip: 'bg-orange-50 text-orange-700', bar: 'bg-orange-500' },
  medium:   { border: 'border-t-amber-500',  chip: 'bg-amber-50 text-amber-700',   bar: 'bg-amber-500' },
  low:      { border: 'border-t-blue-500',   chip: 'bg-blue-50 text-blue-700',     bar: 'bg-blue-500' },
  info:     { border: 'border-t-slate-400',  chip: 'bg-slate-100 text-slate-700',  bar: 'bg-slate-400' },
};

function VulnNodeBase({ data }: NodeProps) {
  const d = data as VulnNodeData;
  const tone = SEV_TONE[(d.severity || '').toLowerCase()] || SEV_TONE.medium;

  return (
    <div
      className={`min-w-[200px] max-w-[260px] rounded-lg border bg-white border-t-4 ${tone.border} shadow-sm transition-opacity ${d.isHighlighted ? 'opacity-100' : 'opacity-40'}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-slate-400 !w-2 !h-2" />
      <div className="p-2.5">
        <div className="flex items-center gap-1.5">
          <Bug className="h-3 w-3 text-slate-500" />
          <span className="text-[10px] font-semibold text-slate-600 truncate">
            {d.vuln_id || `VULN-${d.db_id}`}
          </span>
          {d.kev_flag && (
            <span className="ml-auto inline-flex items-center gap-0.5 rounded bg-rose-100 px-1 py-px text-[8px] font-bold uppercase text-rose-700 ring-1 ring-rose-200 animate-pulse">
              <Zap className="h-2 w-2" />
              KEV
            </span>
          )}
        </div>
        <div className="mt-1 text-xs font-semibold text-slate-900 line-clamp-2" title={d.title}>
          {d.title}
        </div>
        <div className="mt-1.5 flex items-center gap-1 flex-wrap">
          <span className={`rounded px-1.5 py-px text-[9px] font-bold uppercase ${tone.chip}`}>
            {d.severity || 'unknown'}
          </span>
          {d.cvss_score != null && (
            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px text-[9px] font-medium text-slate-700">
              CVSS {d.cvss_score.toFixed(1)}
            </span>
          )}
          {d.cwe_id && (
            <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-px text-[9px] font-medium text-indigo-700">
              {d.cwe_id}
            </span>
          )}
        </div>
        {d.composite_priority != null && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <div className="flex-1 h-1 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, d.composite_priority * 10)}%` }} />
            </div>
            <span className="text-[9px] font-semibold text-slate-600 tabular-nums">
              {d.composite_priority.toFixed(1)}
            </span>
          </div>
        )}
        <Link
          href={`/vulnerabilities/${d.db_id}`}
          onClick={(e) => e.stopPropagation()}
          className="mt-1.5 inline-flex items-center gap-0.5 text-[9px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
        >
          View detail <ExternalLink className="h-2 w-2" />
        </Link>
      </div>
    </div>
  );
}

export const VulnNode = memo(VulnNodeBase);
