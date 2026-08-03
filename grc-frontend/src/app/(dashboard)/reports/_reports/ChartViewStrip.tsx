'use client';

// Chart / table view picker — grouped tiles with a unique mini-preview glyph
// per option so each of the 12 chart types is visually distinct at a glance.

import type { ReactNode } from 'react';
import { Table2 } from 'lucide-react';
import { CHART_GROUPS, CHART_TYPES } from './PivotChart';
import type { ChartKind } from './types';
import { SERIES } from './vizPalette';

const C = {
  a: SERIES[0],
  b: SERIES[1],
  c: SERIES[2],
  d: SERIES[4],
  mute: '#cbd5e1',
  ink: '#64748b',
};

/** Tiny SVG previews — one silhouette per chart kind. */
function ChartGlyph({ kind, active }: { kind: ChartKind; active: boolean }) {
  const o = active ? 1 : 0.85;
  switch (kind) {
    case 'bar':
      return (
        <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
          <rect x="4" y="14" width="6" height="10" rx="1" fill={C.a} opacity={o} />
          <rect x="13" y="8" width="6" height="16" rx="1" fill={C.b} opacity={o} />
          <rect x="22" y="11" width="6" height="13" rx="1" fill={C.c} opacity={o} />
          <rect x="31" y="5" width="6" height="19" rx="1" fill={C.d} opacity={o} />
        </svg>
      );
    case 'hbar':
      return (
        <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
          <rect x="4" y="4" width="22" height="4" rx="1" fill={C.a} opacity={o} />
          <rect x="4" y="12" width="30" height="4" rx="1" fill={C.b} opacity={o} />
          <rect x="4" y="20" width="16" height="4" rx="1" fill={C.c} opacity={o} />
        </svg>
      );
    case 'stacked':
      return (
        <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
          <rect x="6" y="16" width="8" height="8" rx="1" fill={C.a} opacity={o} />
          <rect x="6" y="10" width="8" height="6" rx="0" fill={C.b} opacity={o} />
          <rect x="6" y="5" width="8" height="5" rx="1" fill={C.c} opacity={o} />
          <rect x="20" y="12" width="8" height="12" rx="1" fill={C.a} opacity={o} />
          <rect x="20" y="7" width="8" height="5" rx="0" fill={C.b} opacity={o} />
          <rect x="20" y="3" width="8" height="4" rx="1" fill={C.c} opacity={o} />
        </svg>
      );
    case 'stacked100':
      return (
        <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
          <rect x="5" y="4" width="8" height="20" rx="1" fill={C.a} opacity={o} />
          <rect x="5" y="14" width="8" height="6" fill={C.b} opacity={o} />
          <rect x="5" y="20" width="8" height="4" rx="1" fill={C.c} opacity={o} />
          <rect x="17" y="4" width="8" height="20" rx="1" fill={C.a} opacity={o} />
          <rect x="17" y="10" width="8" height="8" fill={C.b} opacity={o} />
          <rect x="17" y="18" width="8" height="6" rx="1" fill={C.c} opacity={o} />
          <rect x="29" y="4" width="8" height="20" rx="1" fill={C.a} opacity={o} />
          <rect x="29" y="8" width="8" height="6" fill={C.b} opacity={o} />
          <rect x="29" y="14" width="8" height="10" rx="1" fill={C.c} opacity={o} />
        </svg>
      );
    case 'line':
      return (
        <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
          <polyline fill="none" stroke={C.a} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points="3,20 12,14 20,17 28,8 37,11" opacity={o} />
          <circle cx="12" cy="14" r="1.5" fill={C.a} />
          <circle cx="28" cy="8" r="1.5" fill={C.a} />
        </svg>
      );
    case 'area':
      return (
        <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
          <path d="M3,22 L12,14 L20,17 L28,8 L37,11 L37,24 L3,24 Z" fill={C.a} opacity={active ? 0.35 : 0.22} />
          <polyline fill="none" stroke={C.a} strokeWidth="1.75" strokeLinejoin="round" points="3,22 12,14 20,17 28,8 37,11" opacity={o} />
        </svg>
      );
    case 'pie':
      return (
        <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
          <circle cx="20" cy="14" r="10" fill={C.mute} opacity={0.35} />
          <path d="M20,14 L20,4 A10,10 0 0,1 29.5,18 Z" fill={C.a} opacity={o} />
          <path d="M20,14 L29.5,18 A10,10 0 0,1 12,22.5 Z" fill={C.b} opacity={o} />
          <path d="M20,14 L12,22.5 A10,10 0 0,1 20,4 Z" fill={C.c} opacity={o} />
        </svg>
      );
    case 'donut':
      return (
        <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
          <circle cx="20" cy="14" r="10" fill={C.a} opacity={o} />
          <path d="M20,14 L20,4 A10,10 0 0,1 29.5,18 Z" fill={C.b} opacity={o} />
          <path d="M20,14 L29.5,18 A10,10 0 0,1 11,19 Z" fill={C.c} opacity={o} />
          <circle cx="20" cy="14" r="4.5" fill="#fff" />
        </svg>
      );
    case 'treemap':
      return (
        <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
          <rect x="3" y="3" width="18" height="22" rx="1.5" fill={C.a} opacity={o} />
          <rect x="23" y="3" width="14" height="12" rx="1.5" fill={C.b} opacity={o} />
          <rect x="23" y="17" width="14" height="8" rx="1.5" fill={C.c} opacity={o} />
        </svg>
      );
    case 'radar':
      return (
        <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
          <polygon points="20,4 32,12 28,24 12,24 8,12" fill="none" stroke={C.mute} strokeWidth="1" />
          <polygon points="20,8 28,13 25,21 15,21 12,13" fill={C.a} opacity={active ? 0.35 : 0.22} stroke={C.a} strokeWidth="1.25" />
        </svg>
      );
    case 'scatter':
      return (
        <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
          <line x1="4" y1="24" x2="36" y2="24" stroke={C.mute} strokeWidth="1" />
          <line x1="4" y1="24" x2="4" y2="4" stroke={C.mute} strokeWidth="1" />
          <circle cx="12" cy="16" r="2.2" fill={C.a} opacity={o} />
          <circle cx="18" cy="10" r="2.2" fill={C.b} opacity={o} />
          <circle cx="24" cy="14" r="2.2" fill={C.c} opacity={o} />
          <circle cx="30" cy="7" r="2.2" fill={C.d} opacity={o} />
          <circle cx="22" cy="19" r="2.2" fill={C.a} opacity={o} />
        </svg>
      );
    case 'heatmap':
      return (
        <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
          <rect x="4" y="3" width="9" height="6" rx="1" fill={C.a} opacity={0.35} />
          <rect x="15" y="3" width="9" height="6" rx="1" fill={C.a} opacity={0.7} />
          <rect x="26" y="3" width="9" height="6" rx="1" fill={C.a} opacity={1} />
          <rect x="4" y="11" width="9" height="6" rx="1" fill={C.a} opacity={0.55} />
          <rect x="15" y="11" width="9" height="6" rx="1" fill={C.a} opacity={0.25} />
          <rect x="26" y="11" width="9" height="6" rx="1" fill={C.a} opacity={0.85} />
          <rect x="4" y="19" width="9" height="6" rx="1" fill={C.a} opacity={0.9} />
          <rect x="15" y="19" width="9" height="6" rx="1" fill={C.a} opacity={0.45} />
          <rect x="26" y="19" width="9" height="6" rx="1" fill={C.a} opacity={0.6} />
        </svg>
      );
    default:
      return null;
  }
}

function TableGlyph({ active }: { active: boolean }) {
  const stroke = active ? SERIES[0] : C.ink;
  return (
    <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
      <rect x="3" y="3" width="34" height="22" rx="2" fill="#fff" stroke={stroke} strokeWidth="1.25" />
      <rect x="3" y="3" width="34" height="6" rx="2" fill={active ? `${SERIES[0]}22` : '#f1f5f9'} />
      <line x1="3" y1="15" x2="37" y2="15" stroke={C.mute} strokeWidth="1" />
      <line x1="3" y1="21" x2="37" y2="21" stroke={C.mute} strokeWidth="1" />
      <line x1="14" y1="3" x2="14" y2="25" stroke={C.mute} strokeWidth="1" />
      <line x1="25" y1="3" x2="25" y2="25" stroke={C.mute} strokeWidth="1" />
    </svg>
  );
}

/** Compact, grouped view switcher with a preview glyph per option. */
export default function ChartViewStrip({
  view,
  onChange,
}: {
  view: 'table' | ChartKind;
  onChange: (v: 'table' | ChartKind) => void;
}) {
  const activeMeta = view === 'table'
    ? { label: 'Table', blurb: 'Full rows with filters, sort and export', tip: 'Best when you need detail, not a summary shape.' }
    : CHART_TYPES.find((c) => c.kind === view);

  return (
    <div className="flex flex-col">
      <div className="flex items-stretch gap-0 overflow-x-auto scrollbar-thin px-2 py-2">
        {/* Table */}
        <div className="flex shrink-0 items-center gap-1.5 pr-2">
          <ViewTile
            active={view === 'table'}
            label="Table"
            onClick={() => onChange('table')}
            title="Table · Full rows with filters, sort and export"
            glyph={<TableGlyph active={view === 'table'} />}
          />
        </div>

        {CHART_GROUPS.map((group) => (
          <div key={group} className="flex shrink-0 items-center gap-1.5 border-l border-slate-200 px-2">
            <span className="w-14 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-slate-400">{group}</span>
            <div className="flex items-center gap-1">
              {CHART_TYPES.filter((c) => c.group === group).map((c) => (
                <ViewTile
                  key={c.kind}
                  active={view === c.kind}
                  label={c.label}
                  onClick={() => onChange(c.kind)}
                  title={`${c.label} · ${c.blurb}`}
                  glyph={<ChartGlyph kind={c.kind} active={view === c.kind} />}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {activeMeta && (
        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-3 py-1.5">
          {view === 'table'
            ? <Table2 className="h-3.5 w-3.5 shrink-0 text-primary-600" />
            : <span className="shrink-0"><ChartGlyph kind={view} active /></span>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-800">
              {activeMeta.label}
              <span className="ml-1.5 font-normal text-slate-500">— {activeMeta.blurb}</span>
            </p>
            {'tip' in activeMeta && activeMeta.tip && (
              <p className="truncate text-[10px] text-slate-400">{activeMeta.tip}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ViewTile({
  active, label, onClick, title, glyph,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  title?: string;
  glyph: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title || label}
      onClick={onClick}
      className={`group flex w-[4.5rem] shrink-0 flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-center transition-all ${
        active
          ? 'border-primary-400 bg-primary-50 shadow-sm ring-1 ring-primary-200'
          : 'border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-white'
      }`}
    >
      <span className={`flex h-8 w-full items-center justify-center rounded-md ${active ? 'bg-white/80' : 'bg-slate-50 group-hover:bg-white'}`}>
        {glyph}
      </span>
      <span className={`max-w-full truncate text-[10px] font-medium leading-tight ${active ? 'text-primary-800' : 'text-slate-600'}`}>
        {label}
      </span>
    </button>
  );
}
