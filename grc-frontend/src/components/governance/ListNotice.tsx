'use client';

// A notice above a register: what the list is not (it is cut, a source is missing), in a title and one line under it. Written with the design-system
// tokens only (the kit rules apply: no named classes, no hex), so it looks the same inside the dashboard shell and in a dialog. The kit has no
// banner yet; this is the Governance registers' own until a second module needs one (UX revamp Phase 1, group D: "kit gaps").
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

export function ListNotice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-[8px] rounded-ds-card border border-ds-border bg-ds-warning-soft px-[12px] py-[8px]">
      <Info aria-hidden strokeWidth={1.75} className="mt-[2px] h-[16px] w-[16px] shrink-0 text-ds-warning" />
      <div className="min-w-0">
        <p className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{title}</p>
        {children && <p className="text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{children}</p>}
      </div>
    </div>
  );
}
