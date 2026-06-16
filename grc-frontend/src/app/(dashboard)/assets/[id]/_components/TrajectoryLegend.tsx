'use client';

import { X } from 'lucide-react';

export function TrajectoryLegend({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute right-3 top-12 z-10 w-[280px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700">Map Legend</h4>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2.5 text-[11px]">
        <section>
          <div className="text-[9px] font-semibold uppercase text-slate-500 mb-1">Columns</div>
          <ul className="space-y-1 text-slate-700">
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded border-l-4 border-l-rose-500 bg-white border border-slate-200" />Asset (criticality-tinted)</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded border-t-4 border-t-rose-500 bg-white border border-slate-200" />Vulnerability (severity-tinted)</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded border-l-4 border-l-orange-500 bg-white border border-slate-200" />Risk (tier-tinted)</li>
          </ul>
        </section>

        <section>
          <div className="text-[9px] font-semibold uppercase text-slate-500 mb-1">Asset → Vulnerability</div>
          <ul className="space-y-1 text-slate-700">
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#f43f5e" strokeWidth="3" /></svg>Critical</li>
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#fb923c" strokeWidth="2.5" /></svg>High</li>
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="4 3" /></svg>Auto-linked</li>
          </ul>
        </section>

        <section>
          <div className="text-[9px] font-semibold uppercase text-slate-500 mb-1">Vulnerability → Risk</div>
          <ul className="space-y-1 text-slate-700">
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#10b981" strokeWidth="1.8" /></svg>Mitigation: full</li>
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#f59e0b" strokeWidth="1.8" strokeDasharray="5 3" /></svg>Mitigation: partial</li>
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#f43f5e" strokeWidth="1.8" strokeDasharray="5 3" /></svg>Mitigation: minimal / none</li>
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#6366f1" strokeWidth="1.8" strokeDasharray="5 3" /></svg>Mitigation unknown</li>
            <li className="text-[10px] text-slate-500 pt-0.5">Edge label shows the bridge control(s) — e.g. <code className="bg-slate-100 px-1 rounded text-[10px]">via PCI-6.5.1</code></li>
          </ul>
        </section>

        <section>
          <div className="text-[9px] font-semibold uppercase text-slate-500 mb-1">Asset → Risk (direct)</div>
          <ul className="space-y-1 text-slate-700">
            <li className="flex items-center gap-2"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#f43f5e" strokeWidth="2.5" /></svg>Standing risk linked to this asset</li>
          </ul>
        </section>

        <section>
          <div className="text-[9px] font-semibold uppercase text-slate-500 mb-1">Interactions</div>
          <ul className="space-y-1 text-slate-600">
            <li>Click any node → highlight its sub-chain</li>
            <li>Hover an edge for bridge-control detail</li>
            <li>Scroll to zoom · drag canvas to pan</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
