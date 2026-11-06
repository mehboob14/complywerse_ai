// What the Work and context panel shows and when it is open, as pure decisions (`node --test src/components/shell/panelModel.test.ts`).
// The panel's module list is the person's menu (navAccess.visibleNav, lit by navActive) with two expansions the menu cannot say: the Documents area's tabs and the Third-Party
// Vendor Risk rail (the module's own eight entries, which its layout used to draw itself). Nothing here decides rights: every row is on the menu the person already has.
import type { LucideIcon } from 'lucide-react';
import { isGroup, type NavEntry, type NavGroup, type NavItem } from '../layout/navAccess.ts';
import { tabName, tabText, type TabEntry } from '../../lib/navRegistry.ts';
import { RAIL, entryOf, tabActive, type RailEntry } from '../../app/(dashboard)/vendor-risk/_lib/railModel.ts';
import { moduleOf, railOf } from './railModel.ts';
import type { PanelPlacement } from '../layout/shellMode.ts';

/** The docked panel is open unless the person shut it (remembered per browser); the overlay and the sheet are open only while the person asked. */
export function panelOpen(placement: PanelPlacement, dockedShut: boolean, asked: boolean): boolean {
  return placement === 'dock' ? !dockedShut : asked;
}

// The pages that draw the person's queue themselves (the Overview's worklist, the Needs my action page): beside them the panel would list the same rows a second time.
const OWN_WORKLIST = ['/governance', '/needs-my-action'];

/** Whether the panel's queue section starts shut on this page (its count and its links stay on show; the person can open it). Open everywhere else. */
export function queueStartsShut(pathname: string): boolean {
  return OWN_WORKLIST.includes(pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/');
}

/** The first-run label on the panel's button: below 1440 (from there the panel is open beside the page and needs no pointing at), until the person has used it once. */
export function hintShows(dismissed: boolean, placement: PanelPlacement): boolean {
  return !dismissed && placement !== 'dock';
}

/** Whether the person has now used what the label points at: the palette is open, or the panel was opened by them (a docked panel is open by itself, which is no use). */
export function hintUsed(c: { paletteOpen: boolean; panelShown: boolean; placement: PanelPlacement }): boolean {
  return c.paletteOpen || (c.panelShown && c.placement !== 'dock');
}

export interface PanelRow {
  kind: 'row';
  key: string;
  label: string;
  /** the accessible name and tooltip when the text alone would not do (a tab's short label) */
  name?: string;
  href: string;
  icon?: LucideIcon;
  /** 0 a page of the module, 1 a tab or a page under it */
  depth: 0 | 1;
  /** the one row of its level that is the page the person is on */
  current: boolean;
  /** the number that waits there, as shown ("4", "99+"), and what it means for a screen reader */
  count?: string;
  countLabel?: string;
}
export interface PanelHeading { kind: 'heading'; key: string; label: string }
export type PanelItem = PanelRow | PanelHeading;

export interface ModuleSection {
  /** "In Governance", or "Modules" when the page belongs to no module */
  title: string;
  /** the section is named for a screen reader as the module it lists */
  navLabel: string;
  items: PanelItem[];
}

export interface PanelContext {
  nav: readonly NavEntry[];
  litHref: string | undefined;
  pathname: string;
  /** the Documents strip this person has (tabsFor('documents', their context)) and the tab the page lights (activeTab) */
  docTabs: readonly TabEntry[];
  docTabPath: string | undefined;
  /** what waits at the vendor rail's entries, by the count key the rail names ("intake_pending"): already formatted */
  vendorCounts?: Readonly<Record<string, { text: string; label: string } | undefined>>;
}

const DOCUMENTS = '/governance/documents';
const VENDOR = '/vendor-risk';

const row = (key: string, label: string, href: string, current: boolean, extra: Partial<PanelRow> = {}): PanelRow => ({ kind: 'row', key, label, href, depth: 0, current, ...extra });

function documentsRows(c: PanelContext, leaf: NavItem): PanelRow[] {
  const inArea = c.docTabs.length > 0 && !!c.docTabPath;
  const own = row(leaf.href, leaf.name, leaf.href, c.litHref === leaf.href && !inArea, { icon: leaf.icon });
  // the first tab is the Documents page itself: its key must differ from the row above it
  const tabs = c.docTabs.map((t) => row(`tab:${t.path}`, tabText(t), t.path, t.path === c.docTabPath, { depth: 1, name: tabName(t) }));
  return [own].concat(tabs);
}

function vendorRows(c: PanelContext): PanelRow[] {
  const here = entryOf(c.pathname);
  const out: PanelRow[] = [];
  RAIL.forEach((entry: RailEntry) => {
    const count = entry.count ? c.vendorCounts?.[entry.count] : undefined;
    const open = !!entry.tabs && here?.key === entry.key;
    const lit = here?.key === entry.key && !open;
    out.push(row(`${VENDOR}:${entry.key}`, entry.name, entry.href, lit, { count: count?.text || undefined, countLabel: count?.text ? count.label : undefined }));
    if (open) entry.tabs!.forEach((t) => out.push(row(`${VENDOR}:${entry.key}:${t.href}`, t.name, t.href, tabActive(c.pathname, t.href), { depth: 1 })));
  });
  return out;
}

function groupRows(c: PanelContext, group: NavGroup): PanelItem[] {
  const out: PanelItem[] = [];
  group.items.forEach((entry) => {
    if (isGroup(entry)) {
      out.push({ kind: 'heading', key: `h:${entry.name}`, label: entry.name });
      out.push(...groupRows(c, entry));
    } else if (entry.href === DOCUMENTS) {
      out.push(...documentsRows(c, entry));
    } else {
      out.push(row(entry.href, entry.name, entry.href, c.litHref === entry.href, { icon: entry.icon }));
    }
  });
  return out;
}

/** The panel's module list for the page the person is on. */
export function moduleSection(c: PanelContext): ModuleSection {
  const module = moduleOf(c.nav, c.litHref);
  if (module && isGroup(module)) return { title: `In ${module.name}`, navLabel: module.name, items: groupRows(c, module) };
  if (module && module.href === VENDOR) return { title: `In ${module.name}`, navLabel: module.name, items: vendorRows(c) };
  // a page that stands alone, or one with no menu entry: the way to every module the person has
  const rail = railOf(c.nav, c.litHref);
  const all = (rail.queue ? [rail.queue] : []).concat(rail.modules);
  return { title: 'Modules', navLabel: 'All modules', items: all.map((m) => row(m.href, m.name, m.href, m.current === 'page', { icon: m.icon })) };
}
