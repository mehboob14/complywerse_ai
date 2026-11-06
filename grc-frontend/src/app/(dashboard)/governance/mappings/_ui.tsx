'use client';

// The few pieces the Mappings page's parts share. Page-local on purpose: the kit has no search field yet (the Exceptions page hand-rolls the same clear
// button), so this is the place a second module would promote it from.
import { useRef } from 'react';
import { Search, X } from 'lucide-react';
import { TextInput } from '@/components/ui/ds';

/** A search box on the kit's text input: named, with a clear button that keeps the focus in the box. */
export function SearchBox({ value, onChange, label, placeholder, className }: {
  value: string;
  onChange: (value: string) => void;
  /** what it searches: the accessible name ("Search documents") */
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const box = useRef<HTMLInputElement>(null);
  return (
    <TextInput
      ref={box}
      className={className}
      type="text"
      inputMode="search"
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      placeholder={placeholder ?? label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      leftAdornment={<Search aria-hidden />}
      rightAdornment={value ? (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => { onChange(''); box.current?.focus(); }}
          className="grid h-[24px] w-[24px] place-items-center rounded-full text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring"
        >
          <X aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px]" />
        </button>
      ) : undefined}
    />
  );
}
