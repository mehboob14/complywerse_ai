'use client';

// Cells the registers share. A person in a narrow column is an avatar alone (the name is the cell's accessible text); with room it is the avatar and the name. Nobody is "Unassigned"
// in words only where there is room for the word.
import { PersonChip } from '@/components/ui/ds';
import { EMPTY, UNASSIGNED } from '@/lib/format';

export function OwnerCell({ name, wide }: { name?: string | null; wide: boolean }) {
  if (!name) return wide ? <span className="whitespace-nowrap text-ds-body text-ds-fg-muted">{UNASSIGNED}</span> : <span title={UNASSIGNED} className="text-ds-body text-ds-fg-muted"><span aria-hidden>{EMPTY}</span><span className="sr-only">{UNASSIGNED}</span></span>;
  return <PersonChip name={name} className={wide ? undefined : '[&>span:last-child]:sr-only'} />;
}
