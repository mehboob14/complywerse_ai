'use client';

// The workspace's drawer for one control, opened by `?item=<id>` from a lens that is not the requirements table (the DPIA risks, the NCA register rows, the KPIs): the lens says which
// controls it lists (so Previous and Next walk them) and the host draws the drawer, or says the control is not in this assessment. The remarks of these types hold the type's own
// data, so the drawer never offers them as text.
import { useMemo } from 'react';
import { Button, Notice } from '@/components/ui/ds';
import { ItemDrawer } from '../workspace/ItemDrawer';
import { neighbours } from '../workspace/itemModel';
import { useSlaDays } from '../workspace/RemediationTab';
import type { LensItem } from './lensData';

export function ItemPanelHost({ assessmentId, assessmentName, all, listed, itemId, setItem, readOnly, onChanged, noun }: {
  assessmentId: number;
  assessmentName: string;
  all: readonly LensItem[];
  /** the controls the lens lists, in the order it lists them */
  listed: readonly LensItem[];
  itemId: number;
  setItem: (id: number) => void;
  readOnly: boolean;
  onChanged: () => void;
  noun: string;
}) {
  const { days } = useSlaDays();
  const open = itemId ? all.find((i) => i.id === itemId) ?? null : null;
  const near = neighbours(listed, open?.id ?? null);
  const domains = useMemo(() => Array.from(new Set(all.map((i) => i.domain))), [all]);
  if (open) {
    return (
      <ItemDrawer
        assessmentId={assessmentId} assessmentName={assessmentName} item={open} domains={domains} days={days} readOnly={readOnly} structuredRemarks
        prev={near.prev} next={near.next} onOpen={setItem} onClose={() => setItem(0)} onChanged={onChanged}
      />
    );
  }
  if (itemId > 0) return <Notice tone="warning" title={`That ${noun} is not in this assessment`} action={<Button size="sm" onClick={() => setItem(0)}>Close</Button>}>It may have been deleted.</Notice>;
  return null;
}
