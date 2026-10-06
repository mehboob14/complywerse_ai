'use client';
// A searchable single-choice list (ARIA 1.2 "combobox with list autocomplete"): type to
// narrow, arrow keys to move, Enter to choose, Escape to close. A native <select> is fine for
// five options and miserable for a hundred frameworks.

import { clsx } from 'clsx';
import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { FOCUS, inputClass } from './ui';

export type ComboOption = { value: string; label: string; hint?: string };
const MAX_SHOWN = 200;

export function Combobox({ label, options, value, onChange, placeholder = 'Search…', emptyText = 'Nothing matches.', clearLabel, describedBy, labelledBy, id: idProp }: {
  /** the visible label is the caller's <label htmlFor={id}>; this one is for the listbox */
  label: string; options: ComboOption[]; value: string; onChange: (value: string) => void;
  placeholder?: string; emptyText?: string; clearLabel?: string; describedBy?: string; labelledBy?: string; id?: string;
}) {
  const auto = useId();
  const inputId = idProp ?? `${auto}-input`;
  const listId = `${auto}-list`;
  const chosen = options.find((o) => o.value === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = q ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q)) : options;
    return hits.slice(0, MAX_SHOWN);
  }, [options, query]);
  const total = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q)).length : options.length;
  }, [options, query]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (o: ComboOption) => { onChange(o.value); setOpen(false); setQuery(''); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Home' && open) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && open) { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === 'Enter' && open && shown[active]) { e.preventDefault(); choose(shown[active]); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQuery(''); }
    else if (e.key === 'Tab') { setOpen(false); setQuery(''); }
  };

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <input id={inputId} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" autoComplete="off"
          aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined} aria-describedby={describedBy} aria-labelledby={labelledBy}
          value={open ? query : (chosen?.label ?? '')} placeholder={chosen ? undefined : placeholder}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
          className={clsx(inputClass, 'pr-16')} />
        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
          {chosen && clearLabel && (
            <button type="button" aria-label={clearLabel} onClick={() => { onChange(''); setQuery(''); }}
              className={clsx('flex h-8 w-8 items-center justify-center rounded text-slate-600 hover:bg-slate-100', FOCUS)}>
              <X size={14} aria-hidden />
            </button>
          )}
          <button type="button" tabIndex={-1} aria-label={`${open ? 'Hide' : 'Show'} the ${label} list`} onClick={() => setOpen((o) => !o)}
            className="flex h-8 w-8 items-center justify-center rounded text-slate-600 hover:bg-slate-100">
            <ChevronDown size={16} aria-hidden />
          </button>
        </div>
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-lg">
          <ul ref={list} id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto py-1">
            {shown.map((o, i) => (
              <li key={o.value} id={`${listId}-${i}`} data-index={i} role="option" aria-selected={o.value === value}
                onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)} onMouseMove={() => setActive(i)}
                className={clsx('flex cursor-pointer items-center gap-2 px-3 py-2 text-sm', i === active ? 'bg-teal-50' : '', o.value === value && 'font-semibold')}>
                <Check size={14} className={o.value === value ? 'text-teal-800' : 'invisible'} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs text-slate-600">{o.hint}</span>}
              </li>
            ))}
          </ul>
          {!shown.length && <p className="px-3 py-2 text-sm text-slate-700">{emptyText}</p>}
          {total > MAX_SHOWN && <p className="border-t border-slate-200 px-3 py-1.5 text-xs text-slate-600">Showing the first {MAX_SHOWN} of {total}. Keep typing to narrow it.</p>}
        </div>
      )}
      <div role="status" className="sr-only">
        {open ? (shown.length ? `${total} result${total === 1 ? '' : 's'}` : emptyText) : ''}
      </div>
    </div>
  );
}
