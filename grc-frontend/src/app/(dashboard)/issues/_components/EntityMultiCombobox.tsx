'use client';

// EntityMultiCombobox
// ─────────────────────────────────────────────────────────────────────────
// Reusable searchable multi-select dropdown for picking N entities from a
// list. Generalises the AssetPicker pattern (see
// `/assets/criticality-assessments/page.tsx`) so any module can drop in
// a "Linkages" picker without rewriting the open/close/search plumbing.
//
//   • Click trigger → opens a panel with a Search input + scrollable list
//   • Click an option → toggles its inclusion in `value`; the panel stays
//     open so an operator can pick several in one go
//   • Click an X chip in the trigger → removes that one selection
//   • Outside click or Esc → closes the panel
//   • Selected items are chip-rendered in the trigger so the operator can
//     see what they've picked without opening the menu

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Loader2, Search, X, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface EntityOption {
  id: number;
  /** Primary line shown in the trigger chip + list row. */
  label: string;
  /** Optional secondary line shown beneath the label in the list. */
  subtitle?: string;
  /** Optional inline meta (e.g. severity chip) shown at the right edge of the list row. */
  meta?: string;
}

export interface EntityMultiComboboxProps {
  /** Stable cache key for the underlying useQuery. */
  queryKey: readonly unknown[];
  /** Fetches the option list. Called once and cached; the search input
   *  filters client-side so the list endpoint doesn't have to support a
   *  `search` query param. */
  queryFn: () => Promise<EntityOption[]>;
  /** Currently selected ids. */
  value: number[];
  /** Fires with the new id list whenever the operator adds / removes. */
  onChange: (next: number[]) => void;
  /** Trigger placeholder when nothing is picked. */
  placeholder: string;
  /** Empty-state message shown when the query returns no rows. */
  emptyMessage?: string;
  /** Lucide icon shown inside the trigger button. */
  icon: LucideIcon;
  /** Optional max display height for the dropdown panel. Default 320px. */
  maxHeight?: number;
  /** Disabled forces the trigger button into a read-only state. */
  disabled?: boolean;
}

export function EntityMultiCombobox({
  queryKey,
  queryFn,
  value,
  onChange,
  placeholder,
  emptyMessage = 'No matching items.',
  icon: Icon,
  maxHeight = 320,
  disabled = false,
}: EntityMultiComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const listQ = useQuery<EntityOption[]>({
    queryKey,
    queryFn,
    // Only fetch when the panel has been opened at least once. This keeps
    // a form with 10 comboboxes from firing 10 list calls on mount.
    enabled: open || value.length > 0,
    staleTime: 60_000,
  });

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Auto-focus the search input on open.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const allOptions = listQ.data ?? [];
  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedOptions = useMemo(
    () => allOptions.filter((o) => selectedSet.has(o.id)),
    [allOptions, selectedSet],
  );

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter(
      (o) =>
        o.label.toLowerCase().includes(q)
        || (o.subtitle || '').toLowerCase().includes(q)
        || (o.meta || '').toLowerCase().includes(q),
    );
  }, [allOptions, search]);

  const toggle = (id: number) => {
    if (selectedSet.has(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const removeOne = (id: number) => onChange(value.filter((v) => v !== id));
  const clearAll = () => onChange([]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-2 rounded-md border bg-white text-slate-900 px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
          open ? 'border-primary-500 ring-1 ring-primary-500' : 'border-slate-300 hover:border-slate-400'
        }`}
      >
        <Icon className={`h-3.5 w-3.5 shrink-0 ${selectedOptions.length > 0 ? 'text-primary-600' : 'text-slate-400'}`} />
        <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1 text-left">
          {selectedOptions.length === 0 ? (
            <span className="text-slate-500">{placeholder}</span>
          ) : (
            selectedOptions.map((o) => (
              <span
                key={o.id}
                className="inline-flex items-center gap-1 rounded bg-primary-50 text-primary-700 border border-primary-200 px-1.5 py-0.5 max-w-[180px]"
              >
                <span className="truncate" title={o.label}>{o.label}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeOne(o.id); }}
                  className="shrink-0 inline-flex items-center justify-center h-3 w-3 rounded text-primary-600 hover:bg-primary-100"
                  title={`Remove ${o.label}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))
          )}
        </div>
        {selectedOptions.length > 0 && !disabled && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); clearAll(); }}
            className="shrink-0 inline-flex items-center justify-center h-4 w-4 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            title="Clear all"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="relative border-b border-slate-100">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Type to search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-2 py-2 text-xs bg-white text-slate-900 focus:outline-none"
            />
          </div>
          <div className="overflow-y-auto py-1" style={{ maxHeight }}>
            {listQ.isLoading ? (
              <div className="flex items-center justify-center py-6 text-xs text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : listQ.isError ? (
              <p className="px-3 py-3 text-xs text-rose-600 text-center">
                Failed to load options. Check your connection.
              </p>
            ) : filteredOptions.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-500 text-center">
                {search.trim() ? `No matches for "${search.trim()}"` : emptyMessage}
              </p>
            ) : (
              filteredOptions.map((o) => {
                const isSelected = selectedSet.has(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(o.id)}
                    className={`w-full flex items-start gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      isSelected ? 'bg-primary-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`mt-0.5 inline-flex items-center justify-center h-3.5 w-3.5 rounded border shrink-0 ${
                        isSelected ? 'bg-primary-600 border-primary-600 text-[#0a0a0a]' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate font-medium ${isSelected ? 'text-primary-800' : 'text-slate-800'}`}>
                        {o.label}
                      </p>
                      {o.subtitle && (
                        <p className="truncate text-[10px] text-slate-500">{o.subtitle}</p>
                      )}
                    </div>
                    {o.meta && (
                      <span className="shrink-0 text-[10px] text-slate-500 uppercase">{o.meta}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 flex items-center justify-between text-[10px] text-slate-500">
            <span>
              {selectedOptions.length} selected
              {allOptions.length > 0 && ` of ${allOptions.length}`}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-200"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
