'use client';

// The list of chats: grouped Today / Yesterday / Earlier, the newest first, one line each (its title and how many messages it holds) with a menu of its own
// (Rename, Delete). Always visible, reachable by keyboard, 44px targets on a phone. At 1024px and wider it is the column beside the conversation; below that
// the page shows the same list in a Sheet.
import { useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Menu, type MenuItem } from '@/components/ui/ds/Menu';
import { TextInput } from '@/components/ui/ds/TextInput';
import { groupChats, messageCount, type Conversation } from './chatModel';

export interface RailProps {
  chats: readonly Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function ChatRail({ chats, activeId, onSelect, onRename, onDelete }: RailProps) {
  const groups = useMemo(() => groupChats(chats), [chats]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const settled = useRef(false);                                // Enter and the blur that follows must save once

  const start = (c: Conversation) => { settled.current = false; setDraft(c.title); setRenaming(c.id); };
  const finish = (c: Conversation, save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    setRenaming(null);
    if (save && draft.trim() && draft.trim() !== c.title) onRename(c.id, draft.trim());
  };

  return (
    <nav aria-label="Chats" className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pr-[2px]">
        {groups.length === 0 && <p className="px-[8px] py-[6px] text-ds-body text-ds-fg-muted">Your chats will be listed here.</p>}
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label} className="mb-[12px] last:mb-0">
            <h2 className="px-[8px] pb-[4px] !text-ds-label !font-medium !text-ds-fg-muted">{group.label}</h2>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-[2px]">
              {group.items.map((c) => {
                const active = c.id === activeId;
                const items: MenuItem[] = [
                  { key: 'rename', label: 'Rename', onSelect: () => start(c) },
                  { key: 'delete', label: 'Delete chat', danger: true, onSelect: () => onDelete(c.id) },
                ];
                return (
                  <li key={c.id} className={clsx('flex items-center gap-[2px] rounded-ds-control', active ? 'bg-ds-primary-soft' : 'hover:bg-ds-surface-hover')}>
                    {renaming === c.id ? (
                      <div className="min-w-0 flex-1 p-[2px]">
                        <TextInput
                          aria-label="Chat name"
                          value={draft}
                          maxLength={80}
                          autoFocus
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); finish(c, true); }
                            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(c, false); }
                          }}
                          onBlur={() => finish(c, true)}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        onClick={() => onSelect(c.id)}
                        className="flex min-h-ds-control min-w-0 flex-1 flex-col items-start overflow-hidden rounded-ds-control px-[10px] py-[6px] text-left focus-visible:outline-none focus-visible:shadow-ds-ring"
                      >
                        <span className={clsx('w-full truncate text-ds-body', active ? 'font-[600] text-ds-primary-text' : 'font-medium text-ds-fg')}>{c.title}</span>
                        <span className="text-ds-label text-ds-fg-muted">{messageCount(c)}</span>
                      </button>
                    )}
                    {renaming !== c.id && <Menu iconOnly size="sm" label={`Actions for ${c.title}`} items={items} />}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
