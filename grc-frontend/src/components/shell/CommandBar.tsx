'use client';

// The command bar of the top bar: a button that opens the palette (Ctrl/Cmd K does the same). A box with its shortcut from 768; an icon below that (a phone's bar has no room
// for a box, and the palette goes full screen).
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useShell } from './ShellProvider';

/** "Ctrl" or, on a Mac, the command key: what the shortcuts are called on this computer. Ctrl until the browser says otherwise (the server cannot tell). */
export function useModifierName(): string {
  const [name, setName] = useState('Ctrl');
  useEffect(() => {
    try { if (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setName('⌘'); } catch { /* keep Ctrl */ }
  }, []);
  return name;
}

export default function CommandBar() {
  const { openPalette } = useShell();
  const mod = useModifierName();
  const label = `Search or jump to, ${mod} K`;
  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        aria-haspopup="dialog"
        aria-label={label}
        className="hidden h-ds-control w-[200px] shrink items-center gap-[8px] rounded-[8px] border border-ds-border-control bg-ds-surface-subtle px-[10px] text-ds-body text-ds-fg-muted hover:bg-ds-surface hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring md:flex lg:w-[240px] min-[1440px]:w-[260px]"
      >
        <Search size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Search or jump to…</span>
        <kbd aria-hidden className="inline-flex h-[20px] shrink-0 items-center rounded-[4px] border border-ds-border-strong bg-ds-surface px-[6px] font-sans text-ds-label text-ds-fg-muted">{mod} K</kbd>
      </button>
      <button
        type="button"
        onClick={openPalette}
        aria-haspopup="dialog"
        aria-label={label}
        title="Search or jump to"
        className="inline-flex h-ds-control w-ds-control shrink-0 items-center justify-center rounded-ds-control text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring md:hidden"
      >
        <Search size={18} strokeWidth={1.75} aria-hidden />
      </button>
    </>
  );
}
