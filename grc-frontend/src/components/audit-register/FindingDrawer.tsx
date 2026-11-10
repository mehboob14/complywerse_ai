'use client';

// The drawer of one finding: its head (title, the sheet it came from, previous / next through the list when the Register opened it), its tabs and a menu of the things that are about the finding
// as a whole (add another on the same report, open the full issue, delete). It guards unsaved edits (the kit asks before it closes), and is the same drawer from the Register, the Queues, the
// Reports and a notification's `?finding=` link. A finding that is not in the register says so instead of showing an empty drawer.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { EmptyState, IconButton, Menu, SidePanel, type MenuItem } from '@/components/ui/ds';
import { can, type RegisterRights } from '@/lib/auditRegister/rights';
import { referenceOf, sourceWord, type RegisterRow } from '@/lib/auditRegister/registerDef';
import { FindingTabs, type FindingTab } from './FindingTabs';
import { useFinding } from './registerData';

export interface DrawerNav { onStep: (dir: -1 | 1) => void; hasPrev: boolean; hasNext: boolean }
export interface DeleteTarget { id: number; label: string; source: string; addedInPlatform: boolean }

export function FindingDrawer({ id, row, rights, nav, onClose, onAddOnReport, onDelete }: {
  id: number | null; row?: RegisterRow | null; rights: RegisterRights; nav?: DrawerNav; onClose: () => void;
  onAddOnReport?: (row: RegisterRow) => void; onDelete: (target: DeleteTarget) => void;
}) {
  const router = useRouter();
  const finding = useFinding(id);
  const [dirty, setDirty] = useState(false);
  const lastOpen = useRef<number | null>(null);
  if (id != null) lastOpen.current = id;

  const data = finding.data;
  const title = data?.title || row?.title || 'Finding';
  const reference = row ? referenceOf(row) : data?.code;
  const source = row?.source ?? data?.source;
  const subtitle = [source ? sourceWord(source) : null, reference].filter(Boolean).join(' · ');
  const missing = finding.isError && !data;
  const owner = row?.owner_name ?? data?.owner_name ?? null;

  const items: MenuItem[] = id == null ? [] : [
    { key: 'issue', label: 'Open the full issue', icon: ArrowUpRight, onSelect: () => router.push(`/issues/${id}`) },
    { key: 'add', label: 'Add a finding on this report', icon: Plus, hidden: !row || !can(rights, 'addFinding') || !onAddOnReport, onSelect: () => row && onAddOnReport?.(row) },
    {
      key: 'delete', label: 'Delete this finding', icon: Trash2, danger: true, hidden: !can(rights, 'deleteFinding'),
      onSelect: () => onDelete({ id, label: [reference, title].filter(Boolean).join(' · '), source: source || '', addedInPlatform: row?.added_in_platform ?? !!data?.added_in_platform }),
    },
  ];
  const first: FindingTab = row?.awaiting_validation && can(rights, 'decideValidation') ? 'validation' : 'fields';

  return (
    <SidePanel
      open={id != null}
      onClose={() => { setDirty(false); onClose(); }}
      title={title}
      subtitle={subtitle || undefined}
      dockFrom={Infinity}
      width="md"
      dirty={dirty}
      restoreFocus={() => (lastOpen.current == null ? null : (Array.from(document.querySelectorAll<HTMLElement>(`[data-record-row="${lastOpen.current}"]`)).find((r) => r.getClientRects().length > 0) ?? null))}
      actions={(
        <>
          {nav && <IconButton label="Previous finding" aria-disabled={!nav.hasPrev || undefined} onClick={() => { if (nav.hasPrev) nav.onStep(-1); }}><ChevronUp aria-hidden /></IconButton>}
          {nav && <IconButton label="Next finding" aria-disabled={!nav.hasNext || undefined} onClick={() => { if (nav.hasNext) nav.onStep(1); }}><ChevronDown aria-hidden /></IconButton>}
          {items.length > 0 && <Menu iconOnly label="More actions for this finding" items={items} />}
        </>
      )}
    >
      {id != null && (missing
        ? <EmptyState bare kind="noMatches" title="This finding is not in the register" description="It may have been deleted. Deleted findings can be restored from the register's More menu." />
        : <FindingTabs key={id} issueId={id} rights={rights} subject={[reference, title].filter(Boolean).join(' · ')} owner={owner} initialTab={first} onDirtyChange={setDirty} />)}
    </SidePanel>
  );
}
