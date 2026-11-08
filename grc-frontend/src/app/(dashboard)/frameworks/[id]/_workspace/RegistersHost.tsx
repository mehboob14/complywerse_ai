'use client';

// Registers: the framework's own registers and documents (gap analysis, risk register, CDE inventory, scope statement...) behind ONE tab, as a list on
// the left and the open one on the right (a Select where the page is too narrow for both). They used to be two drop-down menus of up to twenty entries.
// The open item is kept in the address (?tab=registers&item=<type>); an old ?tab=<type> still opens it. The registers themselves are the Framework*Tab
// components. Each item is drawn under its own key, so a register's search and an open form never carry over to the next one, and a document with unsaved
// text asks before another item replaces it (the editor says so through `useUnsavedGuard`).
import { useCallback, useMemo, useRef, useState } from 'react';
import { FileText, Table2 } from 'lucide-react';
import { EmptyState, Select, useConfirm } from '@/components/ui/ds';
import { LEAVE_QUESTION, groupItems, stepItem } from '../_registers/hostModel';
import { UnsavedContext } from '../_registers/unsavedGuard';

export interface RegisterItem { id: string; label: string; kind: 'register' | 'document' }

interface Props {
  items: RegisterItem[];
  open: string | null;
  onOpen: (id: string) => void;
  render: (id: string) => React.ReactNode;
  label: string;
}

const GROUP_ICON = { register: Table2, document: FileText } as const;

export default function RegistersHost({ items, open, onOpen, render, label }: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const dirty = useRef(false);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const [roving, setRoving] = useState<string | null>(null);
  const [, redraw] = useState(0);
  const guard = useMemo(() => ({ set: (d: boolean) => { dirty.current = d; } }), []);

  const request = useCallback(async (id: string) => {
    if (id === open) return;
    if (dirty.current && !(await confirm(LEAVE_QUESTION))) { redraw((n) => n + 1); return; }   // a Select that was refused shows the open item again
    dirty.current = false;
    onOpen(id);
  }, [open, onOpen, confirm]);

  if (items.length === 0 || !open) {
    return <EmptyState kind="firstUse" title="No registers for this framework" description="This framework has no registers or documents of its own." bare />;
  }
  const groups = groupItems(items);
  const stop = roving ?? open;

  // the arrow keys move focus through the list (one tab stop for the whole list); Enter or Space opens the one that has focus
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const here = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.item ?? stop : stop;
    const target = stepItem(items, here, e.key);
    if (!target) return;
    e.preventDefault();
    setRoving(target);
    buttons.current[target]?.focus();
  };

  return (
    <UnsavedContext.Provider value={guard}>
      <div className="grid grid-cols-1 gap-[16px] xl:grid-cols-[200px_minmax(0,1fr)]">
        <div className="xl:hidden">
          <Select aria-label={`${label} registers and documents`} value={open} onChange={(e) => { void request(e.target.value); }}>
            {groups.map((g) => (
              <optgroup key={g.key} label={g.title}>{g.items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</optgroup>
            ))}
          </Select>
        </div>
        <nav aria-label={`${label} registers and documents`} className="hidden space-y-[16px] xl:block" onKeyDown={onKeyDown}>
          {groups.map((g) => {
            const Icon = GROUP_ICON[g.key];
            return (
              <div key={g.key}>
                <h3 className="mb-[4px] flex items-center gap-[6px] px-[8px] !text-ds-label !font-[600] !text-ds-fg-muted"><Icon aria-hidden className="h-[14px] w-[14px]" />{g.title}</h3>
                <ul>
                  {g.items.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        ref={(el) => { buttons.current[i.id] = el; }}
                        data-item={i.id}
                        tabIndex={i.id === stop ? 0 : -1}
                        onClick={() => { setRoving(i.id); void request(i.id); }}
                        aria-current={i.id === open ? 'page' : undefined}
                        className={`flex min-h-ds-control w-full items-center rounded-ds-control px-[8px] py-[4px] text-left text-ds-body focus-visible:outline-none focus-visible:shadow-ds-ring ${i.id === open ? 'bg-ds-primary-soft font-[600] text-ds-primary-text' : 'text-ds-fg-body hover:bg-ds-surface-hover'}`}
                      >
                        {i.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div key={open} className="min-w-0">{render(open)}</div>
      </div>
      {confirmDialog}
    </UnsavedContext.Provider>
  );
}
