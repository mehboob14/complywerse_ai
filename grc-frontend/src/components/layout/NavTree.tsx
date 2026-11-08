'use client';

// The menu in its two shapes, drawn from the same entries (navAccess.ts) and the one lit entry (navActive.ts):
//  - the full tree: labels, groups that open and close (disclosure buttons: aria-expanded, aria-controls), in the 240px sidebar and in the drawer
//  - the rail: icons only; a group is a button that opens a flyout menu of its entries (arrow keys, Escape, outside press), the same for
//    Administration. Nothing here is revealed by hover, so the keyboard, the mouse and a finger all get the whole menu.
// The look is the sidebar's own (legacy-styled on purpose); what is new is behaviour and accessibility.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3, Building2, CalendarClock, ChevronDown, ChevronRight, GitPullRequest, KeyRound, Lock, Network, PlugZap, ScrollText, Settings, ShieldCheck,
  SlidersHorizontal, Sparkles, Users, type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject,
} from 'react';
import { isGroup, type NavEntry, type NavGroup, type NavItem } from './navAccess';
import { groupHasActive } from './navActive';
import { menuTarget } from './menuKeys';
import { adminActiveHref, groupedSections } from '@/lib/adminSections';

const navIconProps = { size: 18, strokeWidth: 1.75 };
// A keyboard focus ring drawn inside the row: the menu scrolls and its groups clip what is outside them. #115e59 is the brand teal one step
// darker, because the lit row is mint and #0f766e on it is only 2.9:1; this is 4:1 on it and 7.5:1 on white.
export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#115e59]';
const noop = () => {};

interface GroupProps {
  group: NavGroup;
  activeHref: string | undefined;
  /** the page's sidebar: groups slide open and shut. The drawer's groups are simply there or not (its Tab trap counts what is in the page). */
  animated: boolean;
  /** a finger: rows are at least the touch height */
  touch: boolean;
  /** a link was followed (the drawer closes) */
  onNavigate: () => void;
}

/** A group's rows. Closed and animated: invisible (not reachable by Tab or a screen reader); closed and not animated: not rendered. */
function Panel({ id, open, animated, children }: { id: string; open: boolean; animated: boolean; children: ReactNode }) {
  if (!animated) return open ? <div id={id}>{children}</div> : null;
  return (
    <div id={id} className={clsx('grid transition-[grid-template-rows,visibility] duration-300 ease-out', open ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]')}>
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

// A nested collapsible (Assessments -> Cyber Security -> templates). Indented one level under its parent group.
function NavSubGroup({ group, activeHref, animated, touch, onNavigate }: GroupProps) {
  const hasActive = groupHasActive(group, activeHref);
  const [open, setOpen] = useState(hasActive);
  const panelId = useId();
  const Icon = group.icon;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className={clsx(
          'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors', FOCUS, touch && 'min-h-ds-control',
          hasActive ? 'font-medium text-[var(--color-text)]' : 'font-normal text-[var(--sidebar-text-subitem)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
        )}
      >
        {Icon && <Icon size={16} strokeWidth={1.75} className={clsx('flex-shrink-0', hasActive ? 'text-[var(--color-base)]' : 'text-[var(--sidebar-icon)]')} />}
        <span className="flex-1 text-left leading-tight break-words">{group.name}</span>
        <ChevronDown size={13} className={clsx('flex-shrink-0 text-[var(--sidebar-icon)] transition-transform duration-200', !open && '-rotate-90')} />
      </button>
      <Panel id={panelId} open={open} animated={animated}>
        <div className="ml-3 mt-0.5 space-y-px border-l border-[var(--sidebar-hover-bg)] pl-2.5">
          {group.items.map((item) => {
            if (isGroup(item)) {
              return <NavSubGroup key={item.name} group={item} activeHref={activeHref} animated={animated} touch={touch} onNavigate={onNavigate} />;
            }
            const childActive = activeHref === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={childActive ? 'page' : undefined}
                className={clsx(
                  'group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors', FOCUS, touch && 'min-h-ds-control',
                  childActive ? 'bg-[var(--sidebar-active-bg)] font-medium text-[var(--color-text)]' : 'font-normal text-[var(--sidebar-text-subitem)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
                )}
              >
                <item.icon size={15} strokeWidth={1.75} className={clsx('flex-shrink-0', childActive ? 'text-[var(--color-text)]' : 'text-[var(--sidebar-icon)]')} />
                <span className="leading-tight break-words">{item.name}</span>
              </Link>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

/** An entry that is a page by itself (Performance Overview, Task Management, Third-Party Vendor Risk); `collapsed`: its icon alone. */
export function NavItemLink({ item, active, collapsed = false, touch = false, onNavigate = noop }: {
  item: NavItem; active: boolean; collapsed?: boolean; touch?: boolean; onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors duration-150', FOCUS, touch && 'min-h-ds-control',
        active
          ? 'bg-[var(--sidebar-active-bg)] font-semibold text-[var(--color-text)]'
          : 'font-normal text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]',
        collapsed && 'justify-center px-2'
      )}
      title={collapsed ? item.name : undefined}
      aria-label={collapsed ? item.name : undefined}
    >
      <item.icon
        {...navIconProps}
        className={clsx(
          'flex-shrink-0 transition-colors duration-150',
          active ? 'text-[var(--color-text)]' : 'text-[var(--sidebar-icon)] group-hover:text-[var(--color-text)]'
        )}
      />
      {!collapsed && <span className="leading-tight break-words">{item.name}</span>}
    </Link>
  );
}

export function NavGroupSection({ group, activeHref, animated, touch, onNavigate }: GroupProps) {
  const hasActiveChild = groupHasActive(group, activeHref);
  // Closed by default: only the group holding the lit page opens (so a deep link still shows its context), or one marked defaultOpen.
  const [isOpen, setIsOpen] = useState(group.defaultOpen === true || hasActiveChild);
  const panelId = useId();
  const GroupIcon = group.icon;
  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className={clsx(
          'group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors duration-150', FOCUS, touch && 'min-h-ds-control',
          hasActiveChild
            ? 'font-semibold text-[var(--color-text)]'
            : 'font-normal text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
        )}
      >
        {GroupIcon && (
          <GroupIcon
            {...navIconProps}
            className={clsx('flex-shrink-0 transition-colors duration-150',
              hasActiveChild ? 'text-[var(--color-base)]' : 'text-[var(--sidebar-icon)] group-hover:text-[var(--color-text)]')}
          />
        )}
        <span className="flex-1 text-left leading-tight break-words">{group.name}</span>
        <ChevronDown
          size={15}
          className={clsx('flex-shrink-0 text-[var(--sidebar-icon)] transition-transform duration-200', !isOpen && '-rotate-90')}
        />
      </button>

      {/* Animated open/close: the grid-rows 0fr -> 1fr trick expands the height without measuring, and the rows fade and slide in (staggered). */}
      <Panel id={panelId} open={isOpen} animated={animated}>
        <div className="mt-0.5 ml-[1.6rem] space-y-px border-l border-[var(--sidebar-hover-bg)] pl-2.5">
          {group.items.map((item, idx) => {
            if (isGroup(item)) {
              return <NavSubGroup key={item.name} group={item} activeHref={activeHref} animated={animated} touch={touch} onNavigate={onNavigate} />;
            }
            const childActive = activeHref === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={childActive ? 'page' : undefined}
                style={animated ? { transitionDelay: isOpen ? `${Math.min(idx, 6) * 30 + 60}ms` : '0ms' } : undefined}
                className={clsx(
                  'group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px]', FOCUS, touch && 'min-h-ds-control',
                  animated ? 'transition-all duration-200 ease-out' : 'transition-colors',
                  animated && (isOpen ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0'),
                  childActive
                    ? 'bg-[var(--sidebar-active-bg)] font-medium text-[var(--color-text)]'
                    : 'font-normal text-[var(--sidebar-text-subitem)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
                )}
              >
                <item.icon
                  size={16}
                  strokeWidth={1.75}
                  className={clsx('flex-shrink-0',
                    childActive ? 'text-[var(--color-text)]' : 'text-[var(--sidebar-icon)] group-hover:text-[var(--color-text)]')}
                />
                <span className="leading-tight break-words">{item.name}</span>
              </Link>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

/** The labelled menu: every entry, groups open and close. */
export function FullTree({ entries, activeHref, animated, touch = false, onNavigate = noop }: {
  entries: NavEntry[]; activeHref: string | undefined; animated: boolean; touch?: boolean; onNavigate?: () => void;
}) {
  return (
    <>
      {entries.map((item) => (isGroup(item)
        ? <NavGroupSection key={item.name} group={item} activeHref={activeHref} animated={animated} touch={touch} onNavigate={onNavigate} />
        : <NavItemLink key={item.name} item={item} active={activeHref === item.href} touch={touch} onNavigate={onNavigate} />))}
    </>
  );
}

// ---- flyout menus (the rail's groups, Administration) ----

interface Flyout {
  open: boolean;
  panelId: string;
  rootRef: RefObject<HTMLDivElement>;
  triggerRef: RefObject<HTMLButtonElement>;
  panelRef: RefObject<HTMLDivElement>;
  /** where a fixed flyout sits (beside its button, inside the window); undefined for one placed by classes */
  style: CSSProperties | undefined;
  close: () => void;
  toggle: () => void;
  onTriggerKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onPanelKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  onBlur: (e: FocusEvent<HTMLDivElement>) => void;
}

const menuItems = (panel: HTMLElement | null) => Array.from(panel?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

/**
 * The menu-button pattern. The button opens the flyout (click, Enter, Space, or ArrowDown / ArrowUp for the first / last entry) and focus
 * moves to an entry; arrows, Home and End move between entries; Escape closes it and gives focus back to the button; a press outside,
 * Tab out, a scroll or resize of the page, and following a link close it. `fixed`: the flyout is placed beside the button from its
 * position (the rail's groups sit in a scrolling list that would clip a flyout placed inside it); otherwise the caller's classes place it.
 */
function useFlyout(fixed: boolean): Flyout {
  const pathname = usePathname();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const start = useRef<'first' | 'last'>('first');
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => { setOpen(false); }, [pathname]);

  useLayoutEffect(() => {
    if (!open || !fixed || !triggerRef.current || !panelRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const room = window.innerHeight - panelRef.current.offsetHeight - 8;
    setPos({ left: Math.round(r.right + 8), top: Math.max(8, Math.min(Math.round(r.top), room)) });
  }, [open, fixed]);

  useEffect(() => {
    if (!open) return undefined;
    const items = menuItems(panelRef.current);
    (start.current === 'last' ? items[items.length - 1] : items[0])?.focus({ preventScroll: true });
    const press = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const inside = !!rootRef.current?.contains(document.activeElement);
      setOpen(false);
      if (inside) triggerRef.current?.focus();
    };
    const away = (e: Event) => { if (!panelRef.current?.contains(e.target as Node)) setOpen(false); };    // the page scrolled or was resized under it
    document.addEventListener('pointerdown', press);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('keydown', key);
      document.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [open]);

  return {
    open,
    panelId,
    rootRef,
    triggerRef,
    panelRef,
    style: fixed && pos ? { left: pos.left, top: pos.top } : undefined,
    close: () => setOpen(false),
    toggle: () => { start.current = 'first'; setOpen((o) => !o); },
    onTriggerKeyDown: (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      start.current = e.key === 'ArrowUp' ? 'last' : 'first';
      if (!open) { setOpen(true); return; }
      const items = menuItems(panelRef.current);
      (start.current === 'last' ? items[items.length - 1] : items[0])?.focus();
    },
    onPanelKeyDown: (e) => {
      const items = menuItems(panelRef.current);
      const to = menuTarget(e.key, items.indexOf(document.activeElement as HTMLElement), items.length);
      if (to === null) return;
      e.preventDefault();
      items[to].focus();
    },
    onBlur: (e) => { if (open && !rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false); },
  };
}

/** One entry of a flyout. Entries take focus by arrow keys (tabIndex -1: Tab leaves the menu, as a menu does). */
function MenuLink({ item, active, className, iconClass, size, onPick }: {
  item: { name: string; href: string; icon: LucideIcon }; active: boolean; className: string; iconClass: string; size: number; onPick: () => void;
}) {
  return (
    <Link href={item.href} role="menuitem" tabIndex={-1} onClick={onPick} aria-current={active ? 'page' : undefined} className={clsx(className, FOCUS)}>
      <item.icon size={size} strokeWidth={1.75} className={iconClass} />
      <span className="truncate">{item.name}</span>
    </Link>
  );
}

function RailFlyoutItems({ entries, activeHref, onPick }: { entries: NavEntry[]; activeHref: string | undefined; onPick: () => void }) {
  return (
    <>
      {entries.map((entry) => {
        if (isGroup(entry)) {
          // a sub-group keeps its name, or three entries called Overview would be indistinguishable
          return (
            <div key={entry.name} role="group" aria-label={entry.name}>
              <div aria-hidden className="px-2.5 pb-0.5 pt-2 text-[12px] font-semibold text-[var(--sidebar-text-section)]">{entry.name}</div>
              <RailFlyoutItems entries={entry.items} activeHref={activeHref} onPick={onPick} />
            </div>
          );
        }
        const active = activeHref === entry.href;
        return (
          <MenuLink
            key={entry.href}
            item={entry}
            active={active}
            onPick={onPick}
            size={16}
            iconClass={clsx('flex-shrink-0', active ? 'text-[var(--color-text)]' : 'text-[var(--sidebar-icon)]')}
            className={clsx(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
              active
                ? 'bg-[var(--sidebar-active-bg)] font-semibold text-[var(--color-text)]'
                : 'font-normal text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
            )}
          />
        );
      })}
    </>
  );
}

function RailGroup({ group, activeHref }: { group: NavGroup; activeHref: string | undefined }) {
  const hasActiveChild = groupHasActive(group, activeHref);
  const fly = useFlyout(true);
  const GroupIcon = group.icon;
  return (
    <div ref={fly.rootRef} onBlur={fly.onBlur} className="relative">
      <button
        ref={fly.triggerRef}
        type="button"
        onClick={fly.toggle}
        onKeyDown={fly.onTriggerKeyDown}
        aria-label={group.name}
        aria-haspopup="menu"
        aria-expanded={fly.open}
        aria-controls={fly.open ? fly.panelId : undefined}
        className={clsx(
          'flex items-center justify-center w-full rounded-lg p-2 transition-colors duration-150', FOCUS,
          hasActiveChild
            ? 'bg-[var(--sidebar-active-bg)] text-[var(--color-text)]'
            : 'text-[var(--sidebar-icon)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
        )}
        title={group.name}
      >
        {GroupIcon
          ? <GroupIcon {...navIconProps} />
          : <span className="text-[12px] font-semibold">{group.name.charAt(0)}</span>}
      </button>
      {fly.open && (
        <div
          ref={fly.panelRef}
          id={fly.panelId}
          role="menu"
          aria-label={group.name}
          tabIndex={-1}
          onKeyDown={fly.onPanelKeyDown}
          style={fly.style}
          className="fixed z-50 max-h-[calc(100vh-16px)] min-w-[210px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-elevated focus:outline-none"
        >
          <div aria-hidden className="px-2.5 py-1.5 text-[12px] font-semibold text-[var(--color-text)]">{group.name}</div>
          <RailFlyoutItems entries={group.items} activeHref={activeHref} onPick={fly.close} />
        </div>
      )}
    </div>
  );
}

/** The icon-only menu: pages that stand alone are links, a group is a button that opens its flyout. */
export function RailTree({ entries, activeHref }: { entries: NavEntry[]; activeHref: string | undefined }) {
  return (
    <>
      {entries.map((item) => (isGroup(item)
        ? <RailGroup key={item.name} group={item} activeHref={activeHref} />
        : <NavItemLink key={item.name} item={item} active={activeHref === item.href} collapsed />))}
    </>
  );
}

// ---- Administration ----
// A button pinned at the bottom of the sidebar that opens a menu of the Administration sections, grouped as in lib/adminSections.ts (the one list: the section
// list beside every Administration page and the navigation registry read it too). Each entry is the section's own page (/admin/<section>); the section on
// screen is lit. Shown to administrators only (the old nav entry was adminOnly, and administrators bypass module and permission checks). In the drawer it is a
// group like the others, with a sub-group per section group (a flyout to the right of a drawer would run off a phone).

/** One icon per section (ids of lib/adminSections.ts); the registry itself stays free of React. */
const ADMIN_ICONS: Record<string, LucideIcon> = {
  organization: Building2, departments: Network, users: Users, roles: ShieldCheck, 'password-policy': Lock, sso: KeyRound, connections: PlugZap,
  'ai-governance': Sparkles, 'ai-usage': BarChart3, workflow: GitPullRequest, scheduler: CalendarClock, 'audit-logs': ScrollText, 'module-settings': SlidersHorizontal,
};
const GROUP_ICONS: Record<string, LucideIcon> = {
  organisation: Building2, people: Users, connections: PlugZap, ai: Sparkles, automation: GitPullRequest, audit: ScrollText, settings: SlidersHorizontal,
};

/** The same sections as a menu group, for the drawer (and, entry by entry, for the flyout): a sub-group per group of sections. */
export const ADMIN_GROUP: NavGroup = {
  name: 'Administration',
  icon: Settings,
  items: groupedSections().map(({ group, sections }): NavGroup => ({
    name: group.label,
    icon: GROUP_ICONS[group.id],
    items: sections.map((section): NavItem => ({ name: section.label, href: section.url, icon: ADMIN_ICONS[section.id] ?? Settings })),
  })),
};

export function AdminMenu({ collapsed }: { collapsed: boolean }) {
  const fly = useFlyout(false);
  const pathname = usePathname();
  const activeHref = adminActiveHref(pathname);       // the section on screen, if the page is one
  const lit = fly.open || activeHref !== undefined;
  return (
    <div ref={fly.rootRef} onBlur={fly.onBlur} className="border-t border-[var(--sidebar-hover-bg)] px-2.5 py-2 relative">
      <button
        ref={fly.triggerRef}
        type="button"
        onClick={fly.toggle}
        onKeyDown={fly.onTriggerKeyDown}
        className={clsx(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors duration-150', FOCUS,
          lit
            ? 'bg-[var(--sidebar-hover-bg)] font-medium text-[var(--color-text)]'
            : 'font-normal text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]',
          collapsed && 'justify-center px-2'
        )}
        title={collapsed ? 'Administration' : undefined}
        aria-label={collapsed ? 'Administration' : undefined}
        aria-expanded={fly.open}
        aria-haspopup="menu"
        aria-controls={fly.open ? fly.panelId : undefined}
      >
        <Settings {...navIconProps} className={clsx('flex-shrink-0', lit ? 'text-[var(--color-base)]' : 'text-[var(--sidebar-icon)]')} />
        {!collapsed && <span className="truncate flex-1 text-left">Administration</span>}
        {!collapsed && (
          <ChevronRight
            size={14}
            className={clsx('transition-transform duration-200', fly.open && 'rotate-90')}
          />
        )}
      </button>

      {fly.open && (
        <div
          ref={fly.panelRef}
          id={fly.panelId}
          role="menu"
          aria-label="Administration"
          tabIndex={-1}
          onKeyDown={fly.onPanelKeyDown}
          className={clsx(
            'absolute z-50 rounded-xl border border-slate-200 bg-white p-1.5 shadow-elevated focus:outline-none',
            'min-w-[232px] max-h-[80vh] overflow-y-auto',
            // Anchor: appear to the right of the sidebar, bottom-aligned with the trigger so the menu grows upward.
            'left-full bottom-2 ml-2',
          )}
        >
          <div aria-hidden className="px-2.5 py-1.5 text-[12px] font-semibold text-[var(--color-text)]">Administration</div>
          <RailFlyoutItems entries={ADMIN_GROUP.items} activeHref={activeHref} onPick={fly.close} />
        </div>
      )}
    </div>
  );
}
