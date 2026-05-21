'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Shield, Sparkles, ExternalLink } from 'lucide-react';

export interface ControlNodeData extends Record<string, unknown> {
  target_type: 'parsed' | 'framework' | 'normalized' | 'internal';
  control_id: number;
  code: string | null;
  name: string | null;
  framework_short_code: string | null;
  source: 'manual' | 'auto_cwe';
  auto_cwe: string | null;
  isHighlighted: boolean;
}

const TYPE_TONE: Record<string, { dot: string; label: string }> = {
  parsed:     { dot: 'bg-indigo-500',  label: 'Framework' },
  framework:  { dot: 'bg-blue-500',    label: 'Framework' },
  normalized: { dot: 'bg-violet-500',  label: 'Normalized' },
  internal:   { dot: 'bg-slate-500',   label: 'Internal' },
};

function ControlNodeBase({ data }: NodeProps) {
  const d = data as ControlNodeData;
  const tone = TYPE_TONE[d.target_type] || TYPE_TONE.framework;
  const detailHref =
    d.target_type === 'framework'
      ? `/erm/framework-controls/${d.control_id}`
      : d.target_type === 'internal'
        ? `/erm/internal-controls/${d.control_id}`
        : `/controls?framework_control_id=${d.control_id}`;

  return (
    <div
      className={`min-w-[200px] max-w-[260px] rounded-lg border border-slate-200 bg-slate-50/60 shadow-sm transition-opacity ${d.isHighlighted ? 'opacity-100' : 'opacity-40'}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-slate-400 !w-2 !h-2" />
      <div className="p-2.5">
        <div className="flex items-center gap-1.5">
          <Shield className="h-3 w-3 text-slate-500" />
          <span className="text-[10px] font-semibold text-slate-600">
            {d.code || `Control #${d.control_id}`}
          </span>
          {d.framework_short_code && (
            <span className="ml-auto rounded border border-slate-200 bg-white px-1.5 py-px text-[9px] font-medium uppercase text-slate-700">
              {d.framework_short_code}
            </span>
          )}
        </div>
        <div className="mt-1 text-xs font-medium text-slate-800 line-clamp-2" title={d.name || ''}>
          {d.name || 'Untitled control'}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[9px] font-medium text-slate-500">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
            {tone.label}
          </span>
          {d.source === 'auto_cwe' ? (
            <span className="inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-indigo-50 px-1 py-px text-[9px] font-medium text-indigo-700">
              <Sparkles className="h-2 w-2" />
              {d.auto_cwe ? `Auto · ${d.auto_cwe}` : 'Auto'}
            </span>
          ) : (
            <span className="rounded border border-slate-200 bg-white px-1 py-px text-[9px] font-medium text-slate-700">
              Manual
            </span>
          )}
        </div>
        <Link
          href={detailHref}
          onClick={(e) => e.stopPropagation()}
          className="mt-1.5 inline-flex items-center gap-0.5 text-[9px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
        >
          View control <ExternalLink className="h-2 w-2" />
        </Link>
      </div>
    </div>
  );
}

export const ControlNode = memo(ControlNodeBase);
