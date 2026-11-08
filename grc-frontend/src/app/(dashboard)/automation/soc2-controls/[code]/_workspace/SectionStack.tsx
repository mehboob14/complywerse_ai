'use client';

// The shape of the three working tabs (Testing, Evidence, Links): a row of "jump to" buttons that stays in view while the page scrolls, then the sections one below the other, each folding in
// place. A section is open or shut in the workspace's state, so a link (?tab=tests, the header's next step) can open the one it is about. Nothing here loads data: a section's body asks
// for its own requests, and a shut one is still mounted (the kit's accordion keeps it), so the requests of every section of an open tab run once, in parallel.
import type { ReactNode } from 'react';
import { AccordionRow, Button } from '@/components/ui/ds';
import { SECTIONS_OF, SECTION_LABEL, type SectionKey, type TabKey } from './workspaceModel';
import { useWorkspace } from './workspaceContext';

export interface StackSection {
  key: SectionKey;
  /** one line of facts beside the title: "6 objectives · 5 apply" */
  meta?: ReactNode;
  /** a pill or a count at the end of the header (not interactive) */
  trailing?: ReactNode;
  hidden?: boolean;
  children: ReactNode;
}

export function SectionStack({ label, sections }: { label: string; sections: readonly StackSection[] }) {
  const { open, setOpen, go } = useWorkspace();
  const shown = sections.filter((s) => !s.hidden);
  return (
    <div className="flex flex-col gap-[12px]">
      <nav aria-label={`Jump to a section of ${label}`} className="sticky top-0 z-[5] -mx-[4px] flex flex-wrap gap-[6px] bg-ds-bg px-[4px] py-[6px]">
        {shown.map((s) => (
          <Button key={s.key} size="sm" variant={open.has(s.key) ? 'secondary' : 'ghost'} aria-pressed={open.has(s.key)} onClick={() => go(sectionTab(s.key), s.key)}>{SECTION_LABEL[s.key]}</Button>
        ))}
      </nav>
      {shown.map((s) => (
        <div key={s.key} id={`ws-${s.key}`} className="scroll-mt-[64px] rounded-ds-card border border-ds-border bg-ds-surface p-[4px]">
          <AccordionRow title={SECTION_LABEL[s.key]} meta={s.meta} trailing={s.trailing} open={open.has(s.key)} onOpenChange={(o) => setOpen(s.key, o)} region={false} level={2}>
            <div className="px-[12px] pb-[12px] pt-[4px]">{s.children}</div>
          </AccordionRow>
        </div>
      ))}
    </div>
  );
}

/** The tab a section belongs to (the three working tabs have disjoint sections). */
function sectionTab(key: SectionKey): TabKey {
  return (['testing', 'evidence', 'links'] as const).find((t) => (SECTIONS_OF[t] as readonly string[]).includes(key)) ?? 'summary';
}
