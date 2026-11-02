'use client';

/**
 * ColumnFilter — an Excel / Airtable / Linear-style per-column header funnel for
 * the Vulnerability Register. Renders a small funnel button that sits beside a
 * column label on the brand-blue sticky header; clicking it opens a compact
 * popover listing that column's distinct values (each with a count). Single-select
 * per section, re-click clears. A column may carry several independent sections
 * (e.g. Linked asset also folds in Internet-exposed) — each AND-combines.
 *
 * Why custom (not <select>): native dropdowns don't render under the register's
 * .inv2 zoom:0.8 on Chrome, so every popover in this view is a positioned div.
 * The popover is absolute inside the sticky <th> (so it tracks the header on
 * scroll and isn't re-measured under zoom); it closes on Esc + outside click.
 */

import { useEffect, useRef, useState } from 'react';
import { Filter, Check } from 'lucide-react';

const AC = '#005B96', ACS = '#014A81', ACSOFT = '#EFF5FA';
const BORDER = '#E8ECEE', BORDER2 = '#F0F3F5', INK = '#0F1F2B', SEC = '#3A4653', MUTED = '#8A95A1';

export interface ColOption { value: string; label: string; count: number }
export interface ColSection {
  key: string;
  title?: string;               // shown when a column folds in more than its namesake dimension
  value: string;                // '' = this section inactive
  onChange: (v: string) => void; // re-select the active value to clear (sends '')
  options: ColOption[];
}

export function ColumnFilter({ columnLabel, sections, align = 'left' }: {
  columnLabel: string;
  sections: ColSection[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLSpanElement>(null);
  const usable = sections.filter((s) => s.options.length > 0);
  const active = usable.some((s) => s.value !== '');
  // Search only earns its space on long lists (e.g. the asset column); tiny lists like Severity don't need it.
  const showSearch = usable.reduce((n, s) => n + s.options.length, 0) > 8;
  const ql = q.trim().toLowerCase();

  useEffect(() => { if (!open) setQ(''); }, [open]);  // fresh search each open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, [open]);

  if (!usable.length) return null;

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', marginLeft: 6, verticalAlign: 'middle' }}>
      <button
        type="button"
        aria-label={active ? `Filter by ${columnLabel} (active)` : `Filter by ${columnLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{
          border: 0, cursor: 'pointer', padding: 2, borderRadius: 5, lineHeight: 0,
          display: 'inline-flex', alignItems: 'center', color: '#fff',
          background: active ? 'rgba(255,255,255,.26)' : 'none',
          opacity: active || open ? 1 : 0.68,
        }}
      >
        <Filter size={12} fill={active ? '#fff' : 'none'} />
      </button>
      {open && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 'calc(100% + 7px)', [align]: 0, zIndex: 50,
            minWidth: 198, maxWidth: 288, maxHeight: 332, overflowY: 'auto',
            background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 11,
            boxShadow: '0 18px 44px -14px rgba(16,24,40,.42)', padding: 5, color: INK,
            textTransform: 'none', letterSpacing: 0,
          }}
        >
          {showSearch && (
            <input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)} onClick={(e) => e.stopPropagation()}
              placeholder={`Search ${columnLabel.toLowerCase()}…`}
              style={{ width: '100%', boxSizing: 'border-box', height: 30, border: `1px solid ${BORDER}`, borderRadius: 7, padding: '0 9px', fontSize: 12, color: SEC, marginBottom: 5, outline: 'none' }}
            />
          )}
          {usable.map((s, i) => {
            const opts = ql ? s.options.filter((o) => o.label.toLowerCase().includes(ql)) : s.options;
            if (!opts.length) return null;
            return (
            <div key={s.key} style={i ? { borderTop: `1px solid ${BORDER2}`, marginTop: 5, paddingTop: 5 } : undefined}>
              {s.title && (
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: MUTED, padding: '4px 9px 5px' }}>{s.title}</div>
              )}
              {opts.map((o) => {
                const on = s.value === o.value;
                return (
                  <button
                    key={o.value}
                    role="menuitemradio"
                    aria-checked={on}
                    type="button"
                    className="colf-opt"
                    onClick={() => { s.onChange(on ? '' : o.value); setOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: 0,
                      background: on ? ACSOFT : 'none', color: on ? ACS : SEC, borderRadius: 8,
                      padding: '7px 9px', fontSize: 12, fontWeight: on ? 600 : 500, cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ width: 13, flex: 'none', display: 'inline-flex' }}>{on && <Check size={13} />}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.label}>{o.label}</span>
                    <span style={{ flex: 'none', color: on ? ACS : MUTED, fontWeight: 500, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{o.count}</span>
                  </button>
                );
              })}
            </div>
            );
          })}
          {ql && !usable.some((s) => s.options.some((o) => o.label.toLowerCase().includes(ql))) && (
            <div style={{ padding: '10px 9px', fontSize: 12, color: MUTED }}>No matches.</div>
          )}
        </div>
      )}
    </span>
  );
}

export default ColumnFilter;
