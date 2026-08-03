'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check, Search, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// ComboBoxInput
// ---------------------------------------------------------------------------
// A single-select dropdown with three properties that the plain HTML <select>
// can't give us together:
//   1. Type-to-search filtering of the option list.
//   2. Option-group headings (optgroup-style).
//   3. Free-text entry — the user can type a value that isn't in the list
//      and the component will commit it on Enter or blur. This is the
//      "or type manually" path the assets form needs.
//
// Keep this dumb on purpose: it's a controlled input (`value` + `onChange`)
// and accepts a flat list of options with an optional `group`. No portal,
// no fancy keyboard navigation library — just an absolutely-positioned panel
// closed on outside-click. Good enough for form-field-sized dropdowns and
// avoids pulling in another dependency.

export interface ComboBoxOption {
  value: string;
  label: string;
  group?: string;
  hint?: string; // small grey suffix shown after the label (e.g. badge text)
}

export interface ComboBoxInputProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboBoxOption[];
  placeholder?: string;
  allowCustom?: boolean;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** When true, the input shows the option's label rather than its value
   *  (display vs storage divergence — e.g. a business-function id is
   *  stored but the user sees the human label). */
  displayLabelInsteadOfValue?: boolean;
}

export function ComboBoxInput({
  value,
  onChange,
  options,
  placeholder = 'Select or type…',
  allowCustom = true,
  emptyText = 'No matches — press Enter to use as-is.',
  className = '',
  disabled = false,
  ariaLabel,
  displayLabelInsteadOfValue = false,
}: ComboBoxInputProps) {
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The input text shown to the user. Diverges from `value` while the
  // dropdown is open so the user can type a query without losing the
  // committed selection.
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string>('');

  // Display value when closed.
  const displayValue = useMemo(() => {
    if (!displayLabelInsteadOfValue) return value;
    const match = options.find((o) => o.value === value);
    return match ? match.label : value;
  }, [value, options, displayLabelInsteadOfValue]);

  // What the user sees in the input: query while open, display value otherwise.
  const inputValue = open ? query : displayValue;

  // Filter options against the typed query.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.group?.toLowerCase().includes(q) ?? false),
    );
  }, [query, options]);

  // Group filtered options by `group`. Options without a group land in `''`.
  const grouped = useMemo(() => {
    const out: Array<[string, ComboBoxOption[]]> = [];
    const map = new Map<string, ComboBoxOption[]>();
    for (const o of filtered) {
      const key = o.group ?? '';
      const bucket = map.get(key) ?? [];
      bucket.push(o);
      map.set(key, bucket);
    }
    // Preserve the first-seen order.
    for (const o of filtered) {
      const key = o.group ?? '';
      if (map.has(key)) {
        out.push([key, map.get(key)!]);
        map.delete(key);
      }
    }
    return out;
  }, [filtered]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        commitAndClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, options, allowCustom]);

  const commitAndClose = () => {
    if (open) {
      // On close: if the typed query exactly matches an option, prefer it.
      // Otherwise, accept the free-text value when allowCustom.
      const q = query.trim();
      if (q.length > 0) {
        const exact = options.find(
          (o) => o.label.toLowerCase() === q.toLowerCase() || o.value.toLowerCase() === q.toLowerCase(),
        );
        if (exact) {
          onChange(exact.value);
        } else if (allowCustom) {
          onChange(q);
        }
        // else: ignore the typed query — keep the prior value.
      }
      setOpen(false);
      setQuery('');
    }
  };

  const choose = (opt: ComboBoxOption) => {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Enter accepts the first filtered match if any, otherwise the typed
      // query as a custom value (when allowed).
      if (filtered.length > 0) {
        choose(filtered[0]);
      } else if (allowCustom && query.trim()) {
        onChange(query.trim());
        setOpen(false);
        setQuery('');
      } else {
        commitAndClose();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        className={`flex items-center gap-1 rounded border bg-white px-3 py-1.5 text-sm transition-colors ${
          open ? 'border-blue-500' : 'border-slate-200'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        onClick={() => {
          if (disabled) return;
          if (!open) setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {open && <Search className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />}
        <input
          ref={inputRef}
          id={inputId}
          aria-label={ariaLabel}
          type="text"
          value={inputValue}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            if (!disabled) {
              setOpen(true);
              setQuery('');
            }
          }}
          onKeyDown={onInputKeyDown}
          className="flex-1 min-w-0 bg-transparent text-slate-900 focus:outline-none"
        />
        {value && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              // Prevent the input from losing focus before clear runs.
              e.preventDefault();
              onChange('');
              setQuery('');
              setOpen(false);
            }}
            className="text-slate-400 hover:text-slate-700"
            title="Clear"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </div>

      {open && !disabled && (
        <div
          className="absolute left-0 right-0 z-40 mt-1 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"
          role="listbox"
        >
          {grouped.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500 italic">
              {allowCustom ? emptyText : 'No matches.'}
            </div>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group}>
                {group && (
                  <div className="sticky top-0 bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                    {group}
                  </div>
                )}
                {items.map((opt) => {
                  const selected = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onMouseDown={(e) => {
                        // Prevent the wrapper input from blurring before
                        // onClick fires (which would commit the typed query
                        // and override this selection).
                        e.preventDefault();
                      }}
                      onClick={() => choose(opt)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                        selected ? 'bg-blue-50 text-blue-900' : 'text-slate-700 hover:bg-slate-50'
                      }`}
                      role="option"
                      aria-selected={selected}
                    >
                      <span className="flex-1 truncate">{opt.label}</span>
                      {opt.hint && (
                        <span className="text-[11px] text-slate-400">{opt.hint}</span>
                      )}
                      {selected && <Check className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {allowCustom && query.trim().length > 0 && !filtered.some(
            (o) =>
              o.label.toLowerCase() === query.trim().toLowerCase() ||
              o.value.toLowerCase() === query.trim().toLowerCase(),
          ) && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(query.trim());
                setOpen(false);
                setQuery('');
              }}
              className="flex w-full items-center gap-2 border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
            >
              <span className="text-slate-500">Use “</span>
              <span className="font-medium text-slate-900">{query.trim()}</span>
              <span className="text-slate-500">”</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default ComboBoxInput;
