'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { createPortal } from 'react-dom';

export interface MultiSelectDropdownItem {
  value: string;
  label: string;
  /** Secondary line shown under the label (e.g. user email) */
  subLabel?: string;
  /** Optional initials for the avatar circle. If `subLabel` is set and this is omitted, initials are derived from `label`. */
  avatarInitials?: string;
  disabled?: boolean;
}

export interface MultiSelectDropdownProps {
  title: string;
  items: MultiSelectDropdownItem[];
  selectedValues: string[];
  onApply: (values: string[]) => void;
  multiSelect?: boolean;
  triggerVariant?: 'pill' | 'input';
  placeholder?: string;
  searchPlaceholder?: string;
  searchThreshold?: number;
  forceSearch?: boolean;
  /**
   * Auto-commit mode. When true:
   *  - Hides the footer (Select All / Apply / Reset)
   *  - Fires `onApply` immediately on every toggle
   *  - Closes the dropdown after a selection in single-select mode
   * Use this for user pickers and other single-value selects that should feel immediate.
   * Pair with `forceSearch` to keep the search input always visible regardless of item count.
   */
  autoApply?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  triggerClassName?: string;
  dropdownClassName?: string;
  listClassName?: string;
  showSelectionInTrigger?: boolean;
}

const sizeStyles = {
  sm: 'h-8 text-xs',
  md: 'h-10 text-sm',
  lg: 'h-11 text-sm',
};

export function MultiSelectDropdown({
  title,
  items,
  selectedValues,
  onApply,
  multiSelect = true,
  triggerVariant = 'pill',
  placeholder,
  searchPlaceholder = 'Search',
  searchThreshold = 10,
  forceSearch = false,
  autoApply = false,
  size = 'md',
  className,
  triggerClassName,
  dropdownClassName,
  listClassName,
  showSelectionInTrigger = true,
}: MultiSelectDropdownProps) {
  const getInitials = (text: string) => {
    const cleaned = text.trim();
    if (!cleaned) return 'U';

    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return `${words[0][0]}${words[1][0]}`.toUpperCase();
    }

    const compact = cleaned.replace(/[^a-zA-Z0-9]/g, '');
    return compact.slice(0, 2).toUpperCase() || 'U';
  };

  const [isOpen, setIsOpen] = useState(false);
  const [draftValues, setDraftValues] = useState<string[]>(selectedValues);
  const [query, setQuery] = useState('');
  const [dropdownStyle, setDropdownStyle] = useState<{
    top: number;
    left: number;
    width: number;
    placeAbove: boolean;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraftValues(selectedValues);
  }, [selectedValues]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const targetNode = event.target as Node;
      const clickedTrigger = containerRef.current?.contains(targetNode);
      const clickedDropdown = dropdownRef.current?.contains(targetNode);

      if (!clickedTrigger && !clickedDropdown) {
        setIsOpen(false);
        setDraftValues(selectedValues);
        setQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedValues]);

  useEffect(() => {
    if (!isOpen) return;

    const updateDropdownPosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;

      // Always open downward — consistent placement across the platform.
      setDropdownStyle({
        top: rect.bottom + 8,
        left: Math.max(8, Math.min(rect.left, viewportWidth - 328)),
        width: Math.max(rect.width, 220),
        placeAbove: false,
      });
    };

    updateDropdownPosition();
    requestAnimationFrame(updateDropdownPosition);
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);

    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [isOpen]);

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const draftSet = useMemo(() => new Set(draftValues), [draftValues]);

  const selectedLabels = useMemo(
    () => items.filter((item) => selectedSet.has(item.value)).map((item) => item.label),
    [items, selectedSet]
  );

  const shouldShowSearch = forceSearch || items.length > searchThreshold;

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const lowered = query.toLowerCase();
    return items.filter((item) => {
      const inLabel = item.label.toLowerCase().includes(lowered);
      const inSubLabel = item.subLabel?.toLowerCase().includes(lowered);
      return inLabel || Boolean(inSubLabel);
    });
  }, [items, query]);

  const hasAppliedFilter = selectedValues.length > 0;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;

  const toggleDraftValue = (value: string) => {
    if (!multiSelect) {
      setDraftValues((current) => {
        const next = current[0] === value ? [] : [value];
        if (autoApply) {
          onApply(next);
          // Single-select with autoApply: commit + close so the picker feels instant.
          setIsOpen(false);
          setQuery('');
        }
        return next;
      });
      return;
    }

    setDraftValues((current) => {
      const next = current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value];
      if (autoApply) {
        onApply(next);
      }
      return next;
    });
  };

  const handleApply = () => {
    onApply(draftValues);
    setIsOpen(false);
    setQuery('');
  };

  const handleReset = () => {
    setDraftValues([]);
    onApply([]);
    setIsOpen(false);
    setQuery('');
  };

  const handleSelectAll = () => {
    if (!multiSelect) return;
    const enabledValues = items.filter((item) => !item.disabled).map((item) => item.value);
    setDraftValues(enabledValues);
  };

  const triggerLabel = (() => {
    if (selectedLabels.length === 0) {
      return placeholder || title;
    }
    if (selectedLabels.length === 1) {
      return selectedLabels[0];
    }
    return `${selectedLabels.length} selected`;
  })();

  return (
    <div ref={containerRef} className={clsx('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={clsx(
          'inline-flex items-center gap-2 rounded-full border bg-white px-3 text-left text-slate-900 transition-colors',
          sizeStyles[size],
          hasAppliedFilter
            ? 'border-primary-500 shadow-[0_0_0_1px_rgba(34,197,94,0.18)]'
            : 'border-slate-300 hover:border-slate-400',
          triggerVariant === 'input' && 'rounded-lg',
          triggerVariant !== 'input' && 'whitespace-nowrap',
          triggerClassName
        )}
      >
        {triggerVariant === 'input' ? (
          <span className="min-w-0 flex-1 truncate text-slate-700">{triggerLabel}</span>
        ) : (
          <>
            <span className="text-slate-900">{title}:</span>
            {showSelectionInTrigger && (
              <span className="min-w-0 flex-1 truncate text-slate-600">{triggerLabel}</span>
            )}
          </>
        )}

        {hasAppliedFilter && (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary-100 px-1.5 text-[11px] font-medium text-primary-700">
            {selectedValues.length}
          </span>
        )}

        <ChevronDown
          className={clsx(
            'h-4 w-4 flex-shrink-0 text-slate-700 transition-transform duration-200',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {isOpen && dropdownStyle && createPortal(
        <div
          ref={dropdownRef}
          className={clsx(
            'fixed z-[9999] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl',
            'animate-fade-in',
            dropdownClassName
          )}
          style={{
            top: dropdownStyle.top,
            left: dropdownStyle.left,
            width: Math.min(dropdownStyle.width, viewportWidth - 16),
            transform: dropdownStyle.placeAbove ? 'translateY(-100%)' : 'none',
          }}
        >
          {shouldShowSearch && (
            <div className="border-b border-slate-200 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full rounded-full border border-primary-500 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div
            className={clsx('scrollbar-primary-thin max-h-64 overflow-auto overflow-x-auto p-2', listClassName)}
          >
            {filteredItems.length === 0 ? (
              <div className="px-2 py-3 text-sm text-slate-500">No items found</div>
            ) : (
              filteredItems.map((item) => {
                const checked = draftSet.has(item.value);
                const hasAvatar = Boolean(item.avatarInitials || item.subLabel);
                const initials = item.avatarInitials || getInitials(item.label);
                return (
                  <label
                    key={item.value}
                    className={clsx(
                      'flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50',
                      item.disabled && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={item.disabled}
                      onChange={() => toggleDraftValue(item.value)}
                      className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    />

                    {hasAvatar && (
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-cyan-100 text-sm font-semibold text-cyan-700">
                        {initials}
                      </span>
                    )}

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-800">{item.label}</span>
                      {item.subLabel && (
                        <span className="block truncate text-xs text-slate-500">{item.subLabel}</span>
                      )}
                    </span>

                    {checked && <Check className="ml-auto h-4 w-4 text-primary-600" />}
                  </label>
                );
              })
            )}
          </div>

          {!autoApply && (
            <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2">
              <button
                type="button"
                onClick={handleSelectAll}
                disabled={!multiSelect || filteredItems.length === 0}
                className="text-sm font-medium text-slate-900 underline disabled:cursor-not-allowed disabled:text-slate-400"
              >
                Select All
              </button>
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={handleApply}
                  className="min-w-20 rounded-full border  bg-primary-600 px-3 py-1 text-sm font-medium text-black hover:bg-primary-700"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="min-w-20 rounded-full border border-slate-400 bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800 hover:bg-slate-200"
                >
                  Reset
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export default MultiSelectDropdown;
