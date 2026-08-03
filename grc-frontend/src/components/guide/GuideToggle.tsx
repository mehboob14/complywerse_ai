'use client';

/**
 * Small "Guide" button for the app header — flips guide mode on/off.
 * Purely a state toggle; it does not itself render any explanation content.
 */

import { HelpCircle } from 'lucide-react';
import { useGuide } from './GuideContext';

export default function GuideToggle() {
  const { enabled, toggle } = useGuide();

  return (
    <button
      type="button"
      onClick={toggle}
      title={enabled ? 'Turn off Guide mode' : 'Turn on Guide mode'}
      aria-pressed={enabled}
      aria-label="Toggle Guide mode"
      className={
        'flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ' +
        (enabled
          ? 'border-primary-500 bg-primary-50 text-primary-700 hover:bg-primary-100'
          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-text)]')
      }
    >
      <HelpCircle size={14} strokeWidth={1.75} />
      <span className="hidden sm:inline">Guide</span>
    </button>
  );
}
