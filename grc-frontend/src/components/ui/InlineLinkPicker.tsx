'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2, Plus, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { createPortal } from 'react-dom';

export interface InlineLinkPickerItem {
  value: string;
  label: string;
  /** Secondary line shown below label (e.g. category, severity) */
  subLabel?: string;
}

export interface InlineLinkPickerProps {
  /** Trigger button label (defaults to "Link") */
  triggerLabel?: ReactNode;
  /** Custom trigger className. Defaults to a primary blue button. */
  triggerClassName?: string;
  /** Optional icon shown to the left of the label (defaults to Plus) */
  triggerIcon?: ReactNode;
  /** Disable the trigger */
  disabled?: boolean;
  /** Items to choose from */
  items: InlineLinkPickerItem[];
  /** Fires when the user picks an item; popover auto-closes after */
  onSelect: (value: string) => void;
  searchPlaceholder?: string;
  /** Shown when items list is empty + isLoading is false */
  emptyText?: string;
  /** Shows a loading message in the list area */
  isLoading?: boolean;
  /** Optional className applied to the popover container */
  popoverClassName?: string;
  /** Width of the popover (defaults to 320px) */
  popoverWidth?: number;
}

const DEFAULT_TRIGGER_CLASS =
  'flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 transition-colors disabled:opacity-50';

export function InlineLinkPicker({
  triggerLabel = 'Link',
  triggerClassName,
  triggerIcon,
  disabled = false,
  items,
  onSelect,
  searchPlaceholder = 'Search...',
  emptyText = 'No items',
  isLoading = false,
  popoverClassName,
  popoverWidth = 320,
}: InlineLinkPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setIsOpen(false);
      setQuery('');
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const left = Math.max(8, Math.min(rect.right - popoverWidth, viewportWidth - popoverWidth - 8));
      setPosition({ top: rect.bottom + 6, left });
    };

    updatePosition();
    requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    // Focus search after the popover mounts
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, popoverWidth]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const lowered = query.toLowerCase();
    return items.filter((item) => {
      return (
        item.label.toLowerCase().includes(lowered) ||
        Boolean(item.subLabel?.toLowerCase().includes(lowered))
      );
    });
  }, [items, query]);

  const handleSelect = (value: string) => {
    onSelect(value);
    setIsOpen(false);
    setQuery('');
  };

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={triggerClassName || DEFAULT_TRIGGER_CLASS}
      >
        {triggerIcon ?? <Plus className="h-4 w-4" />}
        {triggerLabel}
      </button>

      {isOpen && position && createPortal(
        <div
          ref={popoverRef}
          className={clsx(
            'fixed z-[9999] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl animate-fade-in',
            popoverClassName,
          )}
          style={{
            top: position.top,
            left: position.left,
            width: popoverWidth,
          }}
        >
          <div className="border-b border-slate-200 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/15"
              />
            </div>
          </div>

          <div className="scrollbar-primary-thin max-h-64 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-500">
                {items.length === 0 ? emptyText : 'No matches'}
              </div>
            ) : (
              filteredItems.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => handleSelect(item.value)}
                  className="flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800">{item.label}</p>
                    {item.subLabel && (
                      <p className="truncate text-xs text-slate-500">{item.subLabel}</p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default InlineLinkPicker;
