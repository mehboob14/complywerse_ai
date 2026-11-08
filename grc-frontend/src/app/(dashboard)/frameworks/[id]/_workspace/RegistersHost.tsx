'use client';

// Registers: the framework's own registers and documents (gap analysis, risk register, CDE inventory, scope statement...) behind ONE tab, as a list on
// the left and the open one on the right (a Select on a phone). They used to be two drop-down menus of up to twenty entries. The open item is kept
// in the address (?tab=registers&item=<type>); an old ?tab=<type> still opens it. The registers themselves are the Framework*Tab components.
import { FileText, Table2 } from 'lucide-react';
import { EmptyState, Select } from '@/components/ui/ds';

export interface RegisterItem { id: string; label: string; kind: 'register' | 'document' }

interface Props {
  items: RegisterItem[];
  open: string | null;
  onOpen: (id: string) => void;
  render: (id: string) => React.ReactNode;
  label: string;
}

export default function RegistersHost({ items, open, onOpen, render, label }: Props) {
  if (items.length === 0 || !open) {
    return <EmptyState kind="firstUse" title="No registers for this framework" description="This framework has no registers or documents of its own." bare />;
  }
  const groups: Array<{ title: string; icon: typeof Table2; items: RegisterItem[] }> = [
    { title: 'Registers', icon: Table2, items: items.filter((i) => i.kind === 'register') },
    { title: 'Documents', icon: FileText, items: items.filter((i) => i.kind === 'document') },
  ];
  return (
    <div className="grid grid-cols-1 gap-[16px] md:grid-cols-[240px_minmax(0,1fr)]">
      <div className="md:hidden">
        <Select aria-label={`${label} registers and documents`} value={open} onChange={(e) => onOpen(e.target.value)}>
          {groups.filter((g) => g.items.length).map((g) => (
            <optgroup key={g.title} label={g.title}>{g.items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</optgroup>
          ))}
        </Select>
      </div>
      <nav aria-label={`${label} registers and documents`} className="hidden space-y-[16px] md:block">
        {groups.filter((g) => g.items.length).map((g) => (
          <div key={g.title}>
            <h3 className="mb-[4px] flex items-center gap-[6px] px-[8px] !text-ds-label !font-[600] !text-ds-fg-muted"><g.icon aria-hidden className="h-[14px] w-[14px]" />{g.title}</h3>
            <ul>
              {g.items.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(i.id)}
                    aria-current={i.id === open ? 'page' : undefined}
                    className={`flex min-h-ds-control w-full items-center rounded-ds-control px-[8px] py-[4px] text-left text-ds-body focus-visible:outline-none focus-visible:shadow-ds-ring ${i.id === open ? 'bg-ds-primary-soft font-[600] text-ds-primary-text' : 'text-ds-fg-body hover:bg-ds-surface-hover'}`}
                  >
                    {i.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="min-w-0">{render(open)}</div>
    </div>
  );
}
