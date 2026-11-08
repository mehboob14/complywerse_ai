'use client';

// "Choose a file": a button that opens the file dialog. The input is visually hidden but real (it takes focus, Space and Enter open the dialog), and the label around it shows the focus ring and is
// as tall as a control (44px on touch). The value is cleared after each pick so the same file can be chosen again.
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';

export interface FilePickProps {
  children: ReactNode;
  onPick: (file: File) => void;
  busy?: boolean;
  disabled?: boolean;
  primary?: boolean;
  icon?: ReactNode;
  className?: string;
}

const BASE = 'relative inline-flex h-ds-control cursor-pointer items-center gap-[6px] rounded-ds-control border px-[12px] text-ds-body font-medium focus-within:shadow-ds-ring';
const PRIMARY = 'border-ds-primary bg-ds-primary text-ds-on-primary hover:bg-ds-primary-hover';
const PLAIN = 'border-ds-border-control bg-ds-surface text-ds-fg-body hover:bg-ds-surface-hover';

export function FilePick({ children, onPick, busy = false, disabled = false, primary = false, icon, className }: FilePickProps) {
  const off = busy || disabled;
  return (
    <label className={clsx(BASE, primary ? PRIMARY : PLAIN, off && 'pointer-events-none opacity-60', className)}>
      <input
        type="file"
        className="sr-only"
        disabled={off}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.currentTarget.value = '';
        }}
      />
      {busy ? <Loader2 aria-hidden className="h-[16px] w-[16px] animate-spin" strokeWidth={1.75} /> : icon}
      <span>{children}</span>
    </label>
  );
}
