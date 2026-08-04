'use client';

/**
 * Right-hand slide-over showing the explanation for the currently-selected
 * GuideMarker. Deliberately NOT a modal dialog that blocks/dims the whole
 * screen — it is a docked panel with a light, click-through-to-close
 * backdrop so the marked element on the underlying page stays visible while
 * the note is open.
 *
 * Mount this once, high in the tree (see (dashboard)/layout.tsx). It reads
 * `activeId` from GuideContext and renders nothing when no note is selected
 * or guide mode is off.
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useGuide } from './GuideContext';
import { GUIDE_NOTES } from '@/lib/guide-notes';

export default function GuidePanel() {
  const { enabled, activeId, select } = useGuide();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const note = activeId ? GUIDE_NOTES[activeId] : null;
  const open = enabled && !!activeId && !!note;

  // Escape closes; Tab is trapped inside the panel while it is open.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        select(null);
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, select]);

  // Move focus into the panel when it opens, for keyboard/screen-reader users.
  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  if (!open || !note) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[90] bg-slate-900/10"
        onClick={() => select(null)}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={`Guide: ${note.title}`}
        className="fixed right-0 top-0 z-[91] flex h-full w-full max-w-md flex-col overflow-hidden border-l border-[var(--color-border)] bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-sm font-semibold leading-snug text-[var(--color-text)]">{note.title}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => select(null)}
            aria-label="Close guide"
            className="flex-shrink-0 rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-subtle)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-[var(--color-text)]">
          <GuideSection label="What" text={note.what} />
          <GuideSection label="Where" text={note.where} />
          <GuideSection label="Why" text={note.why} />
          <GuideSection label="How to read it" text={note.misreading} />
        </div>
      </div>
    </>
  );
}

function GuideSection({ label, text }: { label: string; text?: string }) {
  if (!text || !text.trim()) return null;
  const paragraphs = text.split('\n\n').filter((p) => p.trim().length > 0);
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary-600">{label}</p>
      {paragraphs.map((p, i) => (
        <p key={i} className={i > 0 ? 'mt-2' : undefined}>
          {p}
        </p>
      ))}
    </div>
  );
}
