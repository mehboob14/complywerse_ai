'use client';

// The top bar's trail: where the person is, built from the navigation registry (crumbsModel): the module, the pages the page hangs under, the page. Each level that the person can
// open is a link, one they cannot is named and not linked; the module, a committee and a meeting carry a chevron that lists their siblings (CrumbMenu). A page that draws its own
// heading does not repeat its name here. On a phone the bar is one block: the way up (the nearest level that is a page) over the page itself, the whole block one 44px link.
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { useFlyout } from '@/components/layout/NavTree';
import { crumbsFor, foldTrail, phoneBlock, type Crumb } from './crumbsModel';
import { useCrumbRecords } from './useShellRecords';
import { useShellAccess } from './ShellProvider';
import { useShellRoute } from './useShellRoute';
import CrumbMenu from './CrumbMenu';

const LINK = 'block min-w-0 truncate rounded-ds-control px-[6px] py-[2px] text-ds-body text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring';
const PLAIN = 'block min-w-0 truncate px-[6px] py-[2px] text-ds-body text-ds-fg-muted';
const NOW = 'block min-w-0 truncate px-[6px] py-[2px] text-ds-body font-[600] text-ds-fg';

/** The levels a long trail folds into one "…" menu. */
function Folded({ levels }: { levels: Crumb[] }) {
  const fly = useFlyout(false);
  return (
    <span ref={fly.rootRef} onBlur={fly.onBlur} className="relative inline-flex shrink-0">
      <button
        ref={fly.triggerRef}
        type="button"
        onClick={fly.toggle}
        onKeyDown={fly.onTriggerKeyDown}
        aria-label={`Show ${levels.length} more ${levels.length === 1 ? 'level' : 'levels'}`}
        aria-haspopup="menu"
        aria-expanded={fly.open}
        aria-controls={fly.open ? fly.panelId : undefined}
        className="inline-flex h-[28px] items-center rounded-ds-control px-[6px] text-ds-body text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring [@media(pointer:coarse)]:h-[44px]"
      >…</button>
      {fly.open && (
        <div ref={fly.panelRef} id={fly.panelId} role="menu" aria-label="More levels" tabIndex={-1} onKeyDown={fly.onPanelKeyDown}
          className="absolute left-0 top-full z-50 mt-[4px] w-max min-w-[220px] max-w-[min(420px,90vw)] rounded-ds-card border border-ds-border bg-ds-surface py-[4px] shadow-ds-pop focus-visible:outline-none">
          {levels.map((level) => (level.href
            ? <Link key={level.label} href={level.href} role="menuitem" tabIndex={-1} onClick={fly.close} className="flex min-h-ds-control items-center px-[12px] py-[6px] text-ds-body text-ds-fg-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]">{level.label}</Link>
            : <span key={level.label} className="flex min-h-ds-control items-center px-[12px] py-[6px] text-ds-body text-ds-fg-muted">{level.label}</span>))}
        </div>
      )}
    </span>
  );
}

export default function Breadcrumbs() {
  const { pathname, from, litHref } = useShellRoute();
  const { nav, access, loaded } = useShellAccess();
  const records = useCrumbRecords(pathname);
  const trail = loaded ? crumbsFor({ pathname, from, nav, access, records }) : { crumbs: [], hideCurrent: false };
  if (trail.crumbs.length === 0) return <nav aria-label="Breadcrumb" className="min-w-0 flex-1" />;

  const shown = foldTrail(trail.hideCurrent ? trail.crumbs.slice(0, -1) : trail.crumbs);
  const committeeId = records.committee?.id ?? null;
  const menuFor = (c: Crumb) => c.menu && (
    <CrumbMenu
      kind={c.menu}
      label={c.label}
      litHref={litHref}
      committeeId={c.menu === 'meeting' ? records.meeting?.committeeId ?? committeeId : undefined}
      openId={c.menu === 'committee' ? committeeId : c.menu === 'meeting' ? records.meeting?.id ?? null : undefined}
    />
  );

  const { up, here } = phoneBlock(trail);
  return (
    <>
      {/* a phone: the way up over the page you are on; the whole block is the link */}
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1 md:hidden">
        {here && (up?.href ? (
          <Link href={up.href} aria-label={`Up to ${up.label}. Now on ${here.label}`} className="flex min-h-[44px] min-w-0 flex-col justify-center rounded-ds-control px-[6px] focus-visible:outline-none focus-visible:shadow-ds-ring">
            <span className="flex min-w-0 items-center gap-[2px] text-[12px] leading-[16px] text-ds-fg-muted"><ChevronLeft size={12} aria-hidden /><span className="truncate">{up.label}</span></span>
            <span title={here.label} className="truncate text-[14px] font-[600] leading-[20px] text-ds-fg">{here.label}</span>
          </Link>
        ) : (
          <span aria-current="page" title={here.label} className="block truncate px-[6px] text-[15px] font-[600] leading-[22px] text-ds-fg">{here.label}</span>
        ))}
      </nav>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 md:block">
        <ol className="flex min-w-0 items-center gap-[2px]">
          {shown.map((item, i) => {
            const key = 'crumb' in item ? `${i}:${item.crumb.label}` : `${i}:folded`;
            return (
              <li key={key} className={clsx('flex min-w-0 items-center gap-[2px]', i === shown.length - 1 ? 'flex-1' : 'max-w-[32%] shrink')}>
                {i > 0 && <ChevronRight size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-ds-border-strong" />}
                {'folded' in item ? <Folded levels={item.folded} /> : (
                  <>
                    {item.crumb.current
                      ? <span aria-current="page" title={item.crumb.label} className={NOW}>{item.crumb.label}</span>
                      : item.crumb.href ? <Link href={item.crumb.href} title={item.crumb.label} className={LINK}>{item.crumb.label}</Link> : <span title={item.crumb.label} className={PLAIN}>{item.crumb.label}</span>}
                    {menuFor(item.crumb)}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
