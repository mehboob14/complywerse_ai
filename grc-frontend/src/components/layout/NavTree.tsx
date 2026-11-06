'use client';

// The full menu tree of the off-canvas drawer (below 1024), drawn from the person's entries (navAccess.ts) and the one lit entry (navActive.ts): labels, groups that
// open and close in place (disclosure buttons: aria-expanded, aria-controls). Also the menu-button pattern the rail's Administration button uses (useFlyout).
// The rail itself is components/shell/ModuleIconRail.tsx; its group flyouts are gone (the Work and context panel lists a module's pages).
// Nothing here is revealed by hover, so the keyboard, the mouse and a finger all get the whole menu. The look is the drawer's own (legacy-styled on purpose).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity, BarChart3, Bot, CalendarClock, ChevronDown, GitPullRequest, Globe, Layers, Radar, ScrollText, Settings, Shield,
  ShieldCheck, Sparkles, Users, type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject,
} from 'react';
import { isGroup, type NavEntry, type NavGroup, type NavItem } from './navAccess';
import { groupHasActive } from './navActive';
import { menuTarget } from './menuKeys';

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

/** A count beside an entry (the queue's): the text drawn, what it means for a screen reader, and whether something is overdue. */
export interface EntryBadge { text: string; label: string; urgent: boolean }

/** An entry that is a page by itself (Performance Overview, Task Management, Third-Party Vendor Risk); `collapsed`: its icon alone. */
export function NavItemLink({ item, active, collapsed = false, touch = false, onNavigate = noop, badge }: {
  item: NavItem; active: boolean; collapsed?: boolean; touch?: boolean; onNavigate?: () => void; badge?: EntryBadge;
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
      aria-label={badge ? badge.label : collapsed ? item.name : undefined}
    >
      <item.icon
        {...navIconProps}
        className={clsx(
          'flex-shrink-0 transition-colors duration-150',
          active ? 'text-[var(--color-text)]' : 'text-[var(--sidebar-icon)] group-hover:text-[var(--color-text)]'
        )}
      />
      {!collapsed && <span className="leading-tight break-words">{item.name}</span>}
      {badge && badge.text && (
        <span aria-hidden className={clsx('ml-auto flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-[6px] text-[12px] font-[600] leading-none text-[#ffffff]', badge.urgent ? 'bg-[#b42318]' : 'bg-[#9a5007]')}>{badge.text}</span>
      )}
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
export function FullTree({ entries, activeHref, animated, touch = false, onNavigate = noop, badges }: {
  entries: NavEntry[]; activeHref: string | undefined; animated: boolean; touch?: boolean; onNavigate?: () => void; badges?: Record<string, EntryBadge | undefined>;
}) {
  return (
    <>
      {entries.map((item) => (isGroup(item)
        ? <NavGroupSection key={item.name} group={item} activeHref={activeHref} animated={animated} touch={touch} onNavigate={onNavigate} />
        : <NavItemLink key={item.name} item={item} active={activeHref === item.href} touch={touch} onNavigate={onNavigate} badge={badges?.[item.href]} />))}
    </>
  );
}

// ---- flyout menus (the rail's groups, Administration) ----

export interface Flyout {
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
export function useFlyout(fixed: boolean): Flyout {
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
export function MenuLink({ item, active, className, iconClass, size, onPick }: {
  item: { name: string; href: string; icon: LucideIcon }; active: boolean; className: string; iconClass: string; size: number; onPick: () => void;
}) {
  return (
    <Link href={item.href} role="menuitem" tabIndex={-1} onClick={onPick} aria-current={active ? 'page' : undefined} className={clsx(className, FOCUS)}>
      <item.icon size={size} strokeWidth={1.75} className={iconClass} />
      <span className="truncate">{item.name}</span>
    </Link>
  );
}

// ---- Administration ----
// The sections of the Administration menu: a button at the foot of the rail opens them (components/shell/ModuleIconRail.tsx), and in the drawer they are a group like the
// others (a flyout to the right of a drawer would run off a phone). Each deep-links to /admin with a ?tab=<id> (admin/page.tsx reads it on mount), so the admin tab bar lands on
// the right tab. Shown to administrators only (the old nav entry was adminOnly, and administrators bypass module and permission checks).

// Most items deep-link into the admin tab bar via `/admin?tab=<id>`. Items that live at their own standalone route set `href` to override that.
const ADMIN_ITEMS: Array<{ id: string; label: string; icon: LucideIcon; href?: string }> = [
  { id: 'company',          label: 'Company',            icon: Settings },
  { id: 'users',            label: 'User Management',    icon: Users },
  { id: 'ai-usage',         label: 'Token usage',        icon: BarChart3, href: '/admin/ai-usage' },
  { id: 'ai-governance',    label: 'AI Governance',      icon: Sparkles, href: '/admin/ai-governance' },
  { id: 'roles',            label: 'Role Management',    icon: ShieldCheck },
  { id: 'departments',      label: 'Departments',        icon: Users },
  { id: 'password-policy',  label: 'Password Policy',    icon: Shield },
  { id: 'integrations',     label: 'Integrations',       icon: Bot },
  { id: 'cloud-connectors', label: 'Cloud Connectors',   icon: Globe },
  { id: 'connectors',       label: 'Connectors',         icon: Layers },
  { id: 'evidence-collectors', label: 'Connections', icon: Radar },
  { id: 'identity',         label: 'Identity Providers', icon: Shield },
  { id: 'workflow',         label: 'Workflow Engine',    icon: GitPullRequest },
  { id: 'usage',            label: 'Usage Monitoring',   icon: Activity, href: '/admin/usage' },
  { id: 'audit',            label: 'Audit Logs',         icon: ScrollText },
  { id: 'scheduler',        label: 'Scheduler',          icon: CalendarClock, href: '/admin/scheduler' },
];

export const adminEntries: NavItem[] = ADMIN_ITEMS.map(({ id, label, icon, href }) => ({ name: label, href: href ?? `/admin?tab=${id}`, icon }));

/** The same sections as a menu group, for the drawer. */
export const ADMIN_GROUP: NavGroup = { name: 'Administration', icon: Settings, items: adminEntries };
