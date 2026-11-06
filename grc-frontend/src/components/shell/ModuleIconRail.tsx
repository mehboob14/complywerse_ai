'use client';

// The shell's icon rail (from 1024; below that the menu is the drawer): a fixed column with the brand mark, Needs my action first with its count, the person's modules
// each as an icon over a short name, and Administration at the foot for administrators. It lists the menu the person has (navAccess.visibleNav, drawn by railModel) and lights
// the module that holds the page (navActive); the pages of a module are in the Work and context panel, so the rail has no tree and no flyouts, and nothing is revealed by hover.
// The column's width is fixed (shellMode.RAIL_WIDTH): nothing the data holds (a count of 99+, a long tenant name) can move it.
import Link from 'next/link';
import { Settings } from 'lucide-react';
import { clsx } from 'clsx';
import { RAIL_WIDTH } from '@/components/layout/shellMode';
import { MenuLink, adminEntries, useFlyout } from '@/components/layout/NavTree';
import { litFor, railOf, type RailItem } from './railModel';
import { useShellAccess, useShellQueue } from './ShellProvider';

// an inset ring: the rail's list scrolls and would clip one drawn outside the item
const FOCUS = 'focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const ITEM = 'relative flex min-h-[48px] w-full flex-col items-center justify-center gap-[2px] rounded-ds-control px-[2px] py-[5px]';
const IDLE = 'text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg';
const LIT = 'bg-ds-primary-soft text-ds-primary-text before:absolute before:bottom-[8px] before:left-[-2px] before:top-[8px] before:w-[3px] before:rounded-r-[2px] before:bg-ds-primary before:content-[""]';
// the name under the icon: 12px is the floor; a name that is longer than the column is cut and its whole text is the tooltip and the accessible name
const LABEL = 'block w-full truncate text-center text-[12px] font-[500] leading-[16px]';

function RailLink({ item, urgent, count, countLabel }: { item: RailItem; urgent?: boolean; count?: string; countLabel?: string }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={item.name}
      aria-label={countLabel ?? item.ariaName}
      aria-current={item.current === 'page' ? 'page' : item.current}
      className={clsx(ITEM, FOCUS, item.current ? LIT : IDLE)}
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden />
      <span aria-hidden className={LABEL}>{item.label}</span>
      {count && (
        <span aria-hidden className={clsx('absolute right-[2px] top-[1px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[4px] text-[12px] font-[600] leading-none text-ds-on-primary', urgent ? 'bg-ds-danger' : 'bg-ds-warning')}>{count}</span>
      )}
    </Link>
  );
}

/** Administration, for administrators only: the foot of the rail. A menu button (arrows, Escape, outside press) that opens the sections to the right of the rail. */
function AdminButton() {
  const fly = useFlyout(false);
  return (
    <div ref={fly.rootRef} onBlur={fly.onBlur} className="relative shrink-0 border-t border-ds-border px-[2px] py-[6px]">
      <button
        ref={fly.triggerRef}
        type="button"
        onClick={fly.toggle}
        onKeyDown={fly.onTriggerKeyDown}
        title="Administration"
        aria-label="Administration"
        aria-haspopup="menu"
        aria-expanded={fly.open}
        aria-controls={fly.open ? fly.panelId : undefined}
        className={clsx(ITEM, FOCUS, fly.open ? 'bg-ds-surface-hover text-ds-fg' : IDLE)}
      >
        <Settings size={20} strokeWidth={1.75} aria-hidden />
        <span aria-hidden className={LABEL}>Admin</span>
      </button>
      {fly.open && (
        <div
          ref={fly.panelRef}
          id={fly.panelId}
          role="menu"
          aria-label="Administration"
          tabIndex={-1}
          onKeyDown={fly.onPanelKeyDown}
          className="absolute bottom-[6px] left-full z-50 ml-[8px] max-h-[70vh] min-w-[220px] overflow-y-auto rounded-ds-card border border-ds-border bg-ds-surface py-[6px] shadow-ds-pop focus-visible:outline-none"
        >
          <div aria-hidden className="mb-[4px] border-b border-ds-border px-[12px] pb-[6px] pt-[2px] text-[12px] font-[600] leading-[16px] text-ds-fg-muted">Administration</div>
          {adminEntries.map((entry) => (
            <MenuLink
              key={entry.href}
              item={entry}
              active={false}
              onPick={fly.close}
              size={16}
              iconClass="text-ds-fg-muted"
              className="flex min-h-ds-control items-center gap-[10px] px-[12px] py-[6px] text-ds-body text-ds-fg-body hover:bg-ds-surface-hover hover:text-ds-fg"
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ModuleIconRail({ pathname, from }: { pathname: string; from?: string | null }) {
  const { me, nav, access, loaded } = useShellAccess();
  const queue = useShellQueue();
  const rail = railOf(nav, litFor(nav, pathname, from));
  const tenant: string = me?.user?.primary_tenant_name || '';

  return (
    <nav aria-label="Modules" className="hidden shrink-0 flex-col border-r border-ds-border bg-ds-surface lg:flex" style={{ width: RAIL_WIDTH }}>
      <div className="flex h-12 shrink-0 items-center justify-center border-b border-ds-border">
        <span role="img" title={tenant || 'Compliverse AI'} aria-label={tenant ? `Compliverse AI, ${tenant}` : 'Compliverse AI'} className="flex h-[32px] w-[32px] items-center justify-center rounded-ds-card bg-ds-primary text-[15px] font-[700] text-ds-on-primary">C</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[2px] py-[6px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loaded && rail.queue && (
          <>
            <RailLink item={rail.queue} urgent={queue.urgent} count={queue.text} countLabel={queue.label} />
            {rail.modules.length > 0 && <hr aria-hidden className="mx-auto my-[4px] w-[60%] border-0 border-t border-ds-border" />}
          </>
        )}
        {loaded && rail.modules.map((item) => <RailLink key={item.key} item={item} />)}
      </div>
      {loaded && access.isAdmin && <AdminButton />}
    </nav>
  );
}
