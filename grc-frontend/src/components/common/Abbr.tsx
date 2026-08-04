'use client';

/**
 * Abbr — inline abbreviation with a tooltip + small info-icon popover.
 *
 * Two render variants:
 *   <Abbr code="EPSS" />               renders the code itself + popover
 *   <Abbr code="EPSS">Exploit prob.</Abbr>
 *                                      renders custom child text + popover
 *
 * Semantics:
 *   - Wraps the code in a native <abbr title=...> so screen readers + the
 *     browser's built-in tooltip both work even when JS is disabled.
 *   - Underlines on hover (dotted) so the operator can tell it's clickable.
 *   - Popover opens on hover/focus and pins on click (so users can read the
 *     full text without their cursor disappearing).
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Info, ExternalLink } from 'lucide-react';
import { lookupAbbreviation } from './abbreviations';

interface AbbrProps {
  code: string;
  children?: React.ReactNode;
  /** Show the small info icon next to the term. Default true. */
  showIcon?: boolean;
  /** Class overrides for the visible label span. */
  className?: string;
}

export function Abbr({ code, children, showIcon = true, className }: AbbrProps) {
  const entry = lookupAbbreviation(code);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const tooltipId = useId();
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  // Close pinned popover on outside-click.
  useEffect(() => {
    if (!pinned) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setPinned(false);
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [pinned]);

  // If the code isn't in our glossary, render it as plain text so the
  // component is safe to drop in anywhere without breaking layout.
  if (!entry) {
    return <span className={className}>{children ?? code}</span>;
  }

  return (
    <span
      ref={wrapperRef}
      className={`relative inline-flex items-baseline gap-0.5 ${className ?? ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => !pinned && setOpen(false)}
    >
      <abbr
        title={`${entry.full}${entry.blurb ? ' — ' + entry.blurb : ''}`}
        aria-describedby={tooltipId}
        className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline"
        onClick={(e) => {
          // Toggle pin so a user can move the cursor without losing the popover.
          e.preventDefault();
          setPinned((p) => !p);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
        tabIndex={0}
      >
        {children ?? code}
      </abbr>
      {showIcon && (
        <Info
          className="h-3 w-3 text-slate-400 hover:text-slate-700 transition-colors -mb-px shrink-0"
          aria-hidden="true"
        />
      )}
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute z-50 left-1/2 -translate-x-1/2 top-full mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-left"
          // Stop the popover's own pointer-events from re-triggering hover
          // on the parent — important when the user mouses over the
          // popover to read it.
          onMouseEnter={() => setOpen(true)}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {code.toUpperCase()}
              </p>
              <p className="mt-0.5 text-xs font-semibold text-slate-900 leading-snug">
                {entry.full}
              </p>
            </div>
            {entry.source && (
              <span className="shrink-0 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-medium uppercase text-slate-600">
                {entry.source}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
            {entry.blurb}
          </p>
          {entry.href && (
            <a
              href={entry.href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Reference
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </span>
      )}
    </span>
  );
}
