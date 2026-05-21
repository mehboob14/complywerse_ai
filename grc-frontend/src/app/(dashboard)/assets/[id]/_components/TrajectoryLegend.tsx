'use client';

import { X } from 'lucide-react';

export function TrajectoryLegend({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute right-3 top-12 z-10 w-[260px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700">Map Legend</h4>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2.5 text-[11px]">
        <section>
          <div className="text-[9px] font-semibold uppercase text-slate-500 mb-1">Nodes</div>
          <ul className="space-y-1 text-slate-700">
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded border-l-4 border-l-rose-500 bg-white border border-slate-200" />Asset (criticality-tinted)</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded border-t-4 border-t-rose-500 bg-white border border-slate-200" />Vulnerability (severity-tinted)</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded border border-slate-300 bg-slate-50" />Control</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded border-l-4 border-l-orange-500 bg-white border border-slate-200" />Risk (tier-tinted)</li>
          </ul>
        </section>

        <section>
          <div className="text-[9px] font-semibold uppercase text-slate-500 mb-1">Edges</div>
          <ul className="space-y-1 text-slate-700">
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#3b82f6" strokeWidth="2" /></svg>Manual link</li>
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#6366f1" strokeWidth="2" strokeDasharray="3 3" /></svg>Auto-CWE link</li>
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#10b981" strokeWidth="2" /></svg>Mitigation: full</li>
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#f59e0b" strokeWidth="2" strokeDasharray="3 3" /></svg>Mitigation: partial</li>
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#f43f5e" strokeWidth="2" strokeDasharray="2 2" /></svg>Mitigation: minimal/none</li>
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#f43f5e" strokeWidth="2.5" /></svg>Direct asset → risk</li>
          </ul>
        </section>

        <section>
          <div className="text-[9px] font-semibold uppercase text-slate-500 mb-1">Interactions</div>
          <ul className="space-y-1 text-slate-600">
            <li>Click any node → highlight its sub-chain</li>
            <li>Hover → tooltip; click link → drill through</li>
            <li>Scroll to zoom, drag canvas to pan</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
