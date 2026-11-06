'use client';

// The command palette (Ctrl/Cmd K, or the command bar in the top bar): one box that finds pages, records and actions, and shows what is waiting for the person.
//  - nothing typed: Needs my action (the first items and the acknowledgements), Pinned, Recent and a few actions
//  - typed: the pending items that match, pages (the registry's search, limited to what the person is offered), records (documents, committees, meetings, through the lists the app
//    already has; each source fails alone with a Retry) and the actions, "Ask Comply Agent" last
// A modal dialog: focus moves into the box, Tab stays inside, Escape closes it (one Escape closes one layer) and focus goes back to what opened it, the page behind does not
// scroll. A combobox over a listbox: the arrows move the highlighted option (aria-activedescendant), Enter opens it. Full screen below 768 px.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Calendar, Check, CircleHelp, Clock, ClipboardCheck, FilePlus, FileText, Inbox, Loader2, Pin, Search, Sparkles, Users, X, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { focusIsElsewhere, overlayTakesEscape } from '@/components/ui/dialogFocus';
import { useDialogFocus } from '@/components/ui/useDialogFocus';
import { lockBodyScroll } from '@/components/ui/scrollLock';
import { useNotify } from '@/components/ui/ds';
import { useGuide } from '@/components/guide';
import { KIND_META } from '@/lib/inbox/buildInbox';
import { dueLine } from '@/lib/inbox/inboxView';
import { areaName, routeFor, searchRoutes } from '@/lib/navRegistry';
import { studioApi } from '@/lib/studio/api';
import { holds } from '@/components/layout/navAccess';
import { highlightParts, moveOption, paletteView, type ActionDef, type ActionId, type PageHit, type PaletteIcon, type PaletteOption, type PendingHit } from './paletteModel';
import { mayAskComplyAgent, offeredEntry, visibleLeafHrefs } from './shellAccess';
import { useRecordSearch } from './useShellRecords';
import { useNotifications } from './useNotifications';
import { usePinnedRecent } from './PinnedRecentProvider';
import { useShell, useShellAccess, useShellQueue } from './ShellProvider';

const ICONS: Record<PaletteIcon, LucideIcon> = {
  page: FileText, file: FileText, users: Users, calendar: Calendar, pin: Pin, clock: Clock, plus: FilePlus, sparkles: Sparkles, check: Check, help: CircleHelp, inbox: Inbox, queue: ClipboardCheck,
};

const OPTION = 'flex min-h-[40px] w-full cursor-pointer items-center gap-[10px] px-[14px] py-[4px] max-md:min-h-[48px]';
const GROUP = 'flex items-center justify-between px-[14px] pb-[2px] pt-[8px] text-ds-label font-[600] text-ds-fg-muted';

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) => (part.hit ? <mark key={i} className="bg-transparent font-[700] text-ds-primary-text underline">{part.text}</mark> : <span key={i}>{part.text}</span>))}
    </>
  );
}

function PaletteDialog() {
  const ui = useShell();
  const router = useRouter();
  const { access, nav } = useShellAccess();
  const queue = useShellQueue();
  const guide = useGuide();
  const notify = useNotify();
  const pins = usePinnedRecent();
  const notifications = useNotifications(access.signedIn);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const studio = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 5 * 60_000, retry: false });

  useDialogFocus(true, dialog);
  useEffect(() => lockBodyScroll(), []);

  const leaves = useMemo(() => visibleLeafHrefs(nav), [nav]);
  const may = useMemo(() => {
    const doc = routeFor('/governance/documents/1');
    const committee = routeFor('/governance/committees/1');
    return { documents: !!doc && offeredEntry(doc, access, leaves), committees: !!committee && offeredEntry(committee, access, leaves) };
  }, [access, leaves]);
  const search = useRecordSearch(query, true, may);

  // pages: the registry's search, kept to what this person is offered
  const pages = useMemo<PageHit[]>(() => searchRoutes(query, { limit: 8, allow: (entry) => offeredEntry(entry, access, leaves) }).map((entry) => ({
    path: entry.path,
    label: entry.title ?? entry.label,
    sub: [areaName(entry.area) || entry.groups[0]?.label || '', ...entry.groups.slice(1).map((g) => g.label)].filter(Boolean).join(' · '),
  })), [query, access, leaves]);

  // what waits for the person: decisions first, then acknowledgements
  const pending = useMemo<PendingHit[]>(() => queue.inbox.bySection.decision.concat(queue.inbox.bySection.acknowledgement).map((item) => ({
    key: item.key, title: item.title, sub: `${KIND_META[item.kind].label} · ${dueLine(item).text}`, href: item.href,
  })), [queue.inbox]);

  // actions, each only for the person who may do it
  const canCreate = access.isAdmin || holds(access.permissions, 'governance:policies:create');
  const canGovern = access.isAdmin || holds(access.permissions, 'governance:policies:*');
  const studioOff = studio.data?.enabled === false;
  const actions = useMemo<ActionDef[]>(() => {
    const list: ActionDef[] = [];
    if (canCreate && !studioOff) list.push({ id: 'new-document', label: 'New document', sub: 'Governance · Library', icon: 'plus' });
    if (canGovern && !studioOff) list.push({ id: 'ai-draft', label: 'AI Draft', sub: 'Governance · Comply AI Studio', icon: 'sparkles' });
    if (pins.current) list.push({ id: 'pin-page', label: pins.currentPinned ? 'Unpin this page' : 'Pin this page', sub: 'Shortcut', icon: 'pin' });
    if (notifications.unread > 0) list.push({ id: 'mark-read', label: 'Mark all notifications read', sub: 'Notifications', icon: 'check' });
    list.push({ id: 'guide', label: guide.enabled ? 'Turn off guide markers' : 'Turn on guide markers', sub: 'Help', icon: 'help' });
    if (mayAskComplyAgent(access, leaves)) list.push({ id: 'ask', label: 'Ask Comply Agent', sub: 'AI assistant', icon: 'sparkles' });
    return list;
  }, [canCreate, canGovern, studioOff, pins.current, pins.currentPinned, notifications.unread, guide.enabled, access, leaves]);

  const view = paletteView({
    query, pages, records: search.sources, pending, acknowledgements: queue.inbox.counts.acknowledgement,
    pins: pins.pins, recent: pins.recent, actions,
  });
  const count = view.options.length;
  useEffect(() => { setActive(0); }, [query]);
  const at = Math.min(active, Math.max(0, count - 1));

  const { closePalette } = ui;
  const close = closePalette;

  const run = (id: ActionId) => {
    const q = query.trim();
    if (id === 'new-document') router.push('/governance/documents/studio?new=1');
    else if (id === 'ai-draft') router.push('/governance/documents/studio');
    else if (id === 'ask') router.push(q ? `/complychat?q=${encodeURIComponent(q)}` : '/complychat');
    else if (id === 'mark-read') void notifications.markAllRead();
    else if (id === 'guide') guide.toggle();
    else if (id === 'pin-page') { const label = pins.current?.label; const was = pins.currentPinned; if (pins.toggleCurrent() && label) notify.success(was ? `Unpinned: ${label}` : `Pinned: ${label}`); }
  };
  const pick = (option: PaletteOption | undefined) => {
    if (!option) return;
    close();
    if (option.href) router.push(option.href);
    else if (option.action) run(option.action);
  };

  // Escape closes this layer only: not when a layer drawn over it holds the key, not when something already took it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = dialog.current;
      const elsewhere = el ? focusIsElsewhere(el, document.activeElement, document.body) : false;
      if (!overlayTakesEscape({ key: e.key, defaultPrevented: e.defaultPrevented, focusElsewhere: elsewhere })) return;
      e.preventDefault();
      closePalette();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closePalette]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const to = moveOption(count, at, e.key);
    if (to !== null) { e.preventDefault(); setActive(to); document.getElementById(`po-${to}`)?.scrollIntoView({ block: 'nearest' }); return; }
    if (e.key === 'Enter') { e.preventDefault(); pick(view.options[at]); }
  };

  const total = view.documentsTotal;
  const listedDocuments = view.groups.find((g) => g.name === 'Records')?.options.filter((o) => o.icon === 'file').length ?? 0;
  const empty = count === 0 && !view.searching;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-[16px] pb-[16px] pt-[64px] max-md:p-0">
      <div aria-hidden className="absolute inset-0 bg-ds-scrim" onClick={close} />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        className="relative z-[1] flex max-h-[min(560px,100%)] w-[640px] max-w-full flex-col overflow-hidden rounded-[12px] bg-ds-surface shadow-ds-pop focus-visible:outline-none max-md:h-full max-md:max-h-full max-md:rounded-none"
      >
        <div className="flex h-12 shrink-0 items-center gap-[10px] border-b border-ds-border px-[14px] text-ds-fg-muted">
          <Search size={18} strokeWidth={1.75} aria-hidden />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={count > 0 ? `po-${at}` : undefined}
            aria-label="Search pages, records and actions"
            placeholder="Search pages, records and actions…"
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ds-fg placeholder:text-ds-fg-muted focus-visible:outline-none"
          />
          {view.searching && <Loader2 size={16} aria-hidden className="shrink-0 animate-spin" />}
          <button type="button" onClick={close} aria-label="Close" className="inline-flex h-ds-control w-ds-control shrink-0 items-center justify-center rounded-ds-control hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring">
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        {view.notices.map((n) => (
          <div key={n.source} role="status" className="flex shrink-0 items-center justify-between gap-[8px] border-b border-ds-border bg-ds-warning-soft px-[14px] py-[6px] text-ds-label text-ds-fg-body">
            <span>{n.text} Pages and actions still work.</span>
            <button type="button" onClick={() => search.retry(n.source)} className="rounded-ds-control px-[6px] py-[2px] font-[600] text-ds-primary-text underline focus-visible:outline-none focus-visible:shadow-ds-ring [@media(pointer:coarse)]:min-h-[44px]">Retry</button>
          </div>
        ))}

        <div id="palette-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[6px] pt-[2px]">
          {view.groups.map((group) => (
            <div key={group.name} role="group" aria-label={group.name}>
              <div role="presentation" className={GROUP}><span>{group.name}</span>{group.note && <span className="font-normal">{group.note}</span>}</div>
              {group.options.map((option) => {
                const Icon = ICONS[option.icon];
                const on = option.id === `po-${at}`;
                const index = Number(option.id.slice(3));
                return (
                  <div
                    key={option.id}
                    id={option.id}
                    role="option"
                    aria-selected={on}
                    title={option.sub ? `${option.label} · ${option.sub}` : option.label}
                    onMouseMove={() => { if (index !== at) setActive(index); }}
                    onClick={() => pick(option)}
                    className={clsx(OPTION, on ? 'bg-ds-primary-soft shadow-[inset_3px_0_0_var(--ds-primary)]' : 'hover:bg-ds-surface-hover')}
                  >
                    <Icon size={16} strokeWidth={1.75} aria-hidden className={clsx('shrink-0', on ? 'text-ds-primary' : 'text-ds-fg-muted')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ds-body font-[500] text-ds-fg"><Marked text={option.label} query={query.trim()} /></span>
                      {option.sub && <span className="block truncate text-ds-label text-ds-fg-muted">{option.sub}</span>}
                    </span>
                    {on && <span aria-hidden className="inline-flex h-[20px] shrink-0 items-center rounded-[4px] border border-ds-border-strong bg-ds-surface px-[6px] text-ds-label text-ds-fg-muted">↵</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {total > listedDocuments && (
            <div
              id="po-all"
              role="option"
              aria-selected={false}
              onClick={() => { close(); router.push(`/governance/documents?q=${encodeURIComponent(query.trim())}`); }}
              className={clsx(OPTION, 'hover:bg-ds-surface-hover')}
            >
              <span className="min-w-0 flex-1 truncate text-ds-body font-[600] text-ds-primary-text">See all {total.toLocaleString('en-US')} matching documents in the library</span>
            </div>
          )}
          {empty && (
            <p role="status" className="px-[14px] py-[20px] text-ds-body text-ds-fg-muted">
              {query.trim() ? `No page, record or action matches “${query.trim()}”.` : 'Type to find a page, a record or an action.'}
            </p>
          )}
        </div>
        <div role="status" className="sr-only">{view.searching ? 'Searching' : `${count} ${count === 1 ? 'result' : 'results'}`}</div>

        <div className="flex shrink-0 flex-wrap gap-x-[14px] gap-y-[4px] border-t border-ds-border bg-ds-surface-subtle px-[14px] py-[8px] text-ds-label text-ds-fg-muted max-md:hidden">
          <span><kbd className="font-sans">↑</kbd> <kbd className="font-sans">↓</kbd> move</span>
          <span><kbd className="font-sans">↵</kbd> open</span>
          <span><kbd className="font-sans">Esc</kbd> close</span>
          <span>Pages, records, actions, your pending items</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function CommandPalette() {
  const ui = useShell();
  // mounted only while open: every opening starts from a clean box and asks nothing while it is shut
  return ui.paletteOpen ? <PaletteDialog /> : null;
}
