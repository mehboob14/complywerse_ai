'use client';

// The standalone page's documents: a search, a type filter and the list. The list is a real listbox: ONE Tab stop (the open document, else the one last
// focused, else the first), ArrowUp/ArrowDown, PageUp/PageDown, Home and End move between the documents, Enter or Space opens one (a click does too). It used to
// be a hundred buttons, each a Tab stop, in a box four rows high. What is open is `aria-selected`, and it is told by its tint AND its place in the detail
// beside it. The type of a document is a word ("Policy · LIB-008"), not only the colour and shape of an icon.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { BookOpen, ClipboardList, FileCheck, FileText, Layers, Lightbulb, Shield, type LucideIcon } from 'lucide-react';
import { EmptyState, ErrorState, Select, SkeletonLines, StatusPill } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { documentStatus, statusPill } from '@/lib/status';
import type { DocumentItem } from './_types';
import { DOCUMENT_TYPES, optionAfter, typeLabel } from './mappingsModel';
import { SearchBox } from './_ui';

const TYPE_ICON: Record<string, LucideIcon> = { policy: BookOpen, standard: FileCheck, procedure: ClipboardList, guideline: Lightbulb, charter: Shield, framework: Layers };
export const LIST_ID = 'mappings-document-list';

function Option({ doc, selected, tabStop, onFocus, onOpen }: { doc: DocumentItem; selected: boolean; tabStop: boolean; onFocus: () => void; onOpen: () => void }) {
  const Icon = TYPE_ICON[doc.doc_type] ?? FileText;
  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      data-doc-id={doc.id}
      onFocus={onFocus}
      onClick={onOpen}
      className={`flex cursor-pointer items-start gap-[12px] rounded-ds-control border px-[12px] py-[8px] focus-visible:outline-none focus-visible:shadow-ds-ring ${
        selected ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border bg-ds-surface hover:bg-ds-surface-hover'
      }`}
    >
      <span aria-hidden className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-ds-control bg-ds-surface-hover text-ds-fg-muted">
        <Icon strokeWidth={1.75} className="h-[16px] w-[16px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={doc.title}>{doc.title}</span>
        <span className="mt-[2px] block break-words text-ds-label text-ds-fg-muted">{typeLabel(doc.doc_type)}{doc.document_code ? ` · ${doc.document_code}` : ''}</span>
      </span>
      <StatusPill size="sm" className="shrink-0" {...statusPill(documentStatus, doc.status)} />
    </li>
  );
}

export function DocumentList({ items, selectedId, onSelect, busy }: { items: DocumentItem[]; selectedId: number | null; onSelect: (id: number) => void; busy?: boolean }) {
  const box = useRef<HTMLUListElement>(null);
  const [stop, setStop] = useState<number | null>(null);                  // the option the Tab key lands on: the last one that had focus
  const has = (id: number | null) => id !== null && items.some((d) => d.id === id);
  const tabStopId = has(stop) ? stop : has(selectedId) ? selectedId : items[0]?.id ?? null;

  // the open document into view when it is chosen from outside the list (a link with ?doc=, Back) or the list arrives after it
  const present = has(selectedId);
  useEffect(() => {
    if (selectedId !== null && present) box.current?.querySelector(`[data-doc-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, present]);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const options = Array.from(box.current?.querySelectorAll<HTMLElement>('[role=option]') ?? []);
    const at = options.indexOf(document.activeElement as HTMLElement);
    if ((e.key === 'Enter' || e.key === ' ') && at >= 0) {
      e.preventDefault();
      onSelect(items[at].id);
      return;
    }
    const to = optionAfter(options.length, at, e.key);
    if (to === null || to < 0) return;
    e.preventDefault();
    options[to].focus();
  };

  return (
    <ul
      id={LIST_ID}
      ref={box}
      role="listbox"
      aria-label="Documents"
      aria-busy={busy || undefined}
      onKeyDown={onKeyDown}
      className={`-m-[4px] flex max-h-[min(60vh,560px)] flex-col gap-[6px] overflow-y-auto overscroll-contain p-[4px]${busy ? ' opacity-60' : ''}`}
    >
      {items.map((doc) => (
        <Option key={doc.id} doc={doc} selected={doc.id === selectedId} tabStop={doc.id === tabStopId} onFocus={() => setStop(doc.id)} onOpen={() => onSelect(doc.id)} />
      ))}
    </ul>
  );
}

export interface DocumentsPaneProps {
  search: string;
  onSearch: (value: string) => void;
  type: string;
  onType: (value: string) => void;
  status: 'loading' | 'error' | 'ready';
  error?: unknown;
  onRetry?: () => void;
  items: DocumentItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** the new answer for a changed search or type is on its way: the old rows stay, dimmed */
  busy?: boolean;
}

/** The filters and the list, with a state for every moment: loading, failed (with Retry: never "no documents"), nothing yet, nothing matches. */
export function DocumentsPane({ search, onSearch, type, onType, status, error, onRetry, items, selectedId, onSelect, busy }: DocumentsPaneProps) {
  const filtered = search.trim() !== '' || type !== '';
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-col gap-[8px] sm:flex-row">
        <SearchBox value={search} onChange={onSearch} label="Search documents" placeholder="Search documents" className="min-w-0 flex-1" />
        <Select aria-label="Document type" placeholder="All types" value={type} onChange={(e) => onType(e.target.value)} className="sm:w-[160px]">
          {DOCUMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
      </div>
      {status === 'loading' ? (
        <SkeletonLines lines={6} label="Loading the documents" />
      ) : status === 'error' ? (
        <ErrorState compact title="Couldn't load the documents" message={errorMessage(error)} onRetry={onRetry} />
      ) : items.length === 0 ? (
        filtered
          ? <EmptyState bare kind="noMatches" title="No documents match" onClearFilters={() => { onSearch(''); onType(''); }} />
          : <EmptyState bare kind="firstUse" icon={FileText} title="No documents" />
      ) : (
        <DocumentList items={items} selectedId={selectedId} onSelect={onSelect} busy={busy} />
      )}
    </div>
  );
}
