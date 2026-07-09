'use client';

/**
 * TabDropdown — a single nav control that collapses many framework-specific tabs
 * (Templates or Documents) into one dropdown. The button reads as a tab (active
 * when one of its items is selected, showing the active item's name); the menu
 * lists every item in stage-wise sequence, numbered, with the active one marked.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface DropdownItem { id: string; label: string }

interface Props {
  label: string;
  items: DropdownItem[];
  activeId: string;
  onSelect: (id: string) => void;
  icon?: React.ReactNode;
}

export default function TabDropdown({ label, items, activeId, onSelect, icon }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = items.find((i) => i.id === activeId) || null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-medium transition-colors ${
          active ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-600 hover:text-slate-900'
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon}
        <span>{label}</span>
        {active && <span className="max-w-[150px] truncate font-normal text-slate-400">· {active.label}</span>}
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{items.length}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-[65vh] w-72 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {label} · {items.length}
          </div>
          {items.map((it, idx) => {
            const isActive = it.id === activeId;
            return (
              <button
                key={it.id}
                onClick={() => { onSelect(it.id); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                  isActive ? 'bg-primary-50 font-medium text-primary-700' : 'text-slate-700 hover:bg-slate-50'
                }`}
                role="menuitem"
              >
                <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] font-semibold ${
                  isActive ? 'bg-primary-500 text-[#0a0a0a]' : 'bg-slate-100 text-slate-500'
                }`}>
                  {idx + 1}
                </span>
                <span className="flex-1 truncate">{it.label}</span>
                {isActive && <Check className="h-3.5 w-3.5 flex-shrink-0 text-primary-600" strokeWidth={2.25} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
