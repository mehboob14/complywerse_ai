'use client';

export const dynamic = 'force-dynamic';

// Governance > Documents > Directory: the organisation as folders, Windows-Explorer style. The tree of departments, sub-departments and units on the left; above the contents an
// address bar (the path of the unit you are in) and a toolbar (New <next level>, Edit details, Move to…, Deactivate, Refresh, Icons | Details); on the right the unit's facts and the
// units directly under it. A double-click (or Enter) on a unit, in the tree or in the contents, opens its popup: Details (change the name, place, owner and description in place),
// People (add, change and remove people, choose which roles give membership), and the tabs registered in directoryTabs.ts when their module exists. Right-click opens a unit's menu.
// A unit is never deleted (documents and assignments point at it): it is deactivated, after a question, and can be activated again. Everybody who can sign in reads the tree; what a
// person may change is decided per unit (the Directory API's can_manage, or until it exists their global right to edit the organisation) and the server asks for the same.
// Where you are (?unit=), the view (?view=) and the open popup and tab (?open= &tab=) are in the address, so a link, a reload and Back land in the same place. Under 768px the tree
// is not drawn: the address bar and the list are a drill-down. Every part has a loading, a failed (with Retry), an empty and a "no access" state.
//   directoryModel.ts  the rules (tested)   directoryData.ts  the data   directoryTabs.ts  the tab registry   unitMenu.ts  the actions as menu items
//   UnitTree  AddressBar  Toolbar  Contents  UnitPopup  UnitDialogs  ContextMenu  the parts   UnitForm  DetailsTab  PeopleTab  useToggleActive  the unit's own fields and questions
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, EmptyState, ErrorState, NoAccessState, ReadOnlyNote, SkeletonLines, useAddressState } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { oneOf, text } from '@/lib/addressState';
import { MAX_DEPTH } from '@/lib/departments';
import { routeFor } from '@/lib/navRegistry';
import { AddressBar } from './AddressBar';
import { ContextMenu } from './ContextMenu';
import { Contents, useCompact } from './Contents';
import { MoveDialog, NewUnitDialog } from './UnitDialogs';
import { UnitPopup } from './UnitPopup';
import { UnitTree } from './UnitTree';
import { Toolbar, type ViewId } from './Toolbar';
import { useDirectory } from './directoryData';
import { ENABLED_ORG_TABS, ENABLED_TABS } from './directoryTabs';
import { menuItems } from './unitMenu';
import { useToggleActive } from './useToggleActive';
import {
  ORG_PARAM, TAB_IDS, countText, isOrgAddress, openPathTo, organisationNode, selectionAfterClose, treeRows, unitActions, unitFromAddress, viewOnly, type ActionKey, type TabId,
} from './directoryModel';

const VIEW_IDS = ['icons', 'details'] as const;
const ADDRESS = {
  unit: text(),
  view: oneOf<ViewId>(VIEW_IDS, 'icons'),
  open: text(),
  tab: oneOf<TabId>(TAB_IDS, 'details'),
};
const TITLE = routeFor('/governance/documents/directory')?.label ?? 'Directory';
const INFO = `The organisation as folders: pick a unit in the tree to see what is in it. Double-click a unit, or press Enter on it, to open its details and people; right-click for its menu. Units go ${MAX_DEPTH} levels deep. A unit is never deleted: deactivate it, and the documents already in it keep it.`;
const VIEW_ONLY = 'Only an administrator, or someone whose role lets them edit the organisation, can add or change departments. Where you manage a unit, its buttons are there.';

interface Menu { x: number; y: number; id: number | null; from: HTMLElement | null }

export default function DirectoryPage() {
  const data = useDirectory();
  const { tree, directory, canTop, levels, canOrgDefaults } = data;
  const [address, setAddress] = useAddressState(ADDRESS);
  const compact = useCompact();
  const toggle = useToggleActive();
  const [creating, setCreating] = useState<{ start: number | null } | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  const current = tree ? unitFromAddress(address.unit, tree) : null;
  const popup = tree ? unitFromAddress(address.open, tree) : null;
  const ctx = useMemo(() => ({ canTop, levels, tabs: ENABLED_TABS as readonly string[] }), [canTop, levels]);
  const rows = useMemo(() => (tree ? treeRows(tree, expanded) : []), [tree, expanded]);
  const actions = useMemo(() => (tree ? unitActions(tree, current, ctx) : []), [tree, current, ctx]);

  // the unit you are in is always on screen in the tree: the units above it are opened, and when the page opens on a unit (a link) the unit itself, so what is under it shows
  const arrived = useRef(false);
  useEffect(() => {
    if (!tree) return;
    const first = !arrived.current;
    arrived.current = true;
    setExpanded((prev) => {
      const next = openPathTo(tree, prev, current);
      return first && current !== null && !next.has(current) && tree.childrenOf(current).length > 0 ? new Set(next).add(current) : next;
    });
  }, [tree, current]);

  const go = (id: number | null, push = true) => setAddress({ unit: id === null ? '' : String(id) }, { push });
  const openPopup = (id: number, tab: TabId = 'details') => setAddress({ open: String(id), tab });
  const closePopup = () => setAddress({ open: '', tab: 'details' });
  // the Organisation popup (?open=org): the defaults every unit inherits; offered to a person who may write them, once a tab for it exists
  const orgButton = canOrgDefaults && ENABLED_ORG_TABS.length > 0;
  const orgNode = useMemo(() => organisationNode(canOrgDefaults), [canOrgDefaults]);
  const openOrganisation = () => setAddress({ open: ORG_PARAM, tab: ENABLED_ORG_TABS[0] });
  const toggleOpen = (id: number) => {
    if (!tree) return;
    const wasOpen = expanded.has(id);
    setExpanded((prev) => { const next = new Set(prev); if (wasOpen) next.delete(id); else next.add(id); return next; });
    if (wasOpen) { const next = selectionAfterClose(tree, current, id); if (next !== current) go(next, false); }
  };

  // a click on a unit, or going into it from the contents, goes to it and shows what is under it (it is opened if it was shut; shutting it is the arrow's); a key moves the selection and leaves the rest as it is
  const goInto = (id: number | null, push = true) => {
    go(id, push);
    if (id !== null && tree && tree.childrenOf(id).length > 0) setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };
  const selectInTree = (id: number | null, by: 'click' | 'key') => (by === 'click' ? goInto(id) : go(id, false));

  const run = (key: ActionKey, id: number | null) => {
    if (!tree) return;
    if (key === 'new') { setCreating({ start: id }); return; }
    if (id === null) return;
    if (key === 'edit') openPopup(id, 'details');
    else if (key === 'move') setMoving(id);
    else if (key === 'toggle') { const n = tree.node(id); if (n) void toggle.toggle(n); }
    else openPopup(id, key);
  };
  const menuFor = (id: number | null) => (tree
    ? menuItems(unitActions(tree, id, ctx), (k) => run(k, id), id !== null && id !== current && tree.childrenOf(id).length > 0 ? { label: 'Go into', onSelect: () => goInto(id) } : undefined)
    : []);
  const contextAt = (e: MouseEvent, id: number | null) => {
    const el = e.currentTarget as HTMLElement;
    setMenu({ x: e.clientX, y: e.clientY, id, from: el.matches('[tabindex]') ? el : el.querySelector<HTMLElement>('button') });
  };

  const nodes = directory?.nodes ?? [];
  const off = nodes.filter((n) => !n.is_active).length;
  const meta = nodes.length > 0 ? `${countText(nodes.length, 'unit')}${off ? ` · ${off} inactive` : ''}` : undefined;
  const readOnly = !!directory && !data.loading && viewOnly(nodes, canTop);

  let body: ReactNode;
  if (data.loading) {
    body = (
      <div className="grid grid-cols-1 gap-[16px] md:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
        <div className="hidden rounded-ds-card border border-ds-border bg-ds-surface p-[16px] md:block"><SkeletonLines lines={8} label="Loading the organisation" /></div>
        <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]"><SkeletonLines lines={6} label="Loading the units" /></div>
      </div>
    );
  } else if (!tree || !directory) {
    const refused = statusOf(data.error) === 403;
    body = refused
      ? <NoAccessState title="No access" reason={errorMessage(data.error)} action={<Button href="/governance/documents">Back to library</Button>} />
      : <ErrorState title="Couldn't load the directory" message={errorMessage(data.error)} onRetry={canRetry(data.error) ? data.refetch : undefined} />;
  } else if (nodes.length === 0) {
    const first = unitActions(tree, null, ctx).find((a) => a.key === 'new');
    body = (
      <EmptyState
        kind="firstUse"
        icon={Building2}
        title="No departments yet"
        action={first && !first.hidden ? <Button variant="primary" onClick={() => setCreating({ start: null })}>{first.label}</Button> : undefined}
        info={first && !first.hidden ? undefined : 'An administrator adds the first department.'}
      />
    );
  } else {
    body = (
      <>
        {data.error != null && <ErrorState compact title="Unavailable" message="What is shown may be out of date." onRetry={canRetry(data.error) ? data.refetch : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />}
        <Toolbar actions={actions} busy={toggle.busy} onRun={(k) => run(k, current)} view={address.view} onView={(v) => setAddress({ view: v })} onRefresh={data.refetch} refreshing={data.fetching} onOrganisation={orgButton ? openOrganisation : undefined} />
        <AddressBar tree={tree} current={current} onGo={(id) => go(id)} />
        <div className="grid grid-cols-1 gap-[16px] md:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
          <div className="hidden min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[8px] md:block">
            <UnitTree tree={tree} rows={rows} selected={current} onSelect={selectInTree} onToggle={toggleOpen} onOpen={(id) => openPopup(id)} onContext={contextAt} />
          </div>
          <div className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
            <Contents
              tree={tree}
              current={current}
              view={address.view}
              compact={compact}
              onGo={(id) => goInto(id)}
              onOpen={(id) => openPopup(id)}
              onContext={(e, id) => contextAt(e, id)}
              menuFor={menuFor}
              newAction={actions.find((a) => a.key === 'new')}
              onNew={() => run('new', current)}
            />
          </div>
        </div>
      </>
    );
  }

  const popupNode = tree && popup !== null ? tree.node(popup) : undefined;
  const movingNode = tree && moving !== null ? tree.node(moving) : undefined;
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={TITLE}
        info={INFO}
        meta={meta}
        actions={readOnly ? <ReadOnlyNote>View only<InfoTip text={VIEW_ONLY} label="Why the directory is view only" /></ReadOnlyNote> : undefined}
      />
      {body}
      {tree && popupNode && (
        <UnitPopup
          key={popupNode.id}
          node={popupNode}
          tree={tree}
          levels={levels}
          canTop={canTop}
          tab={address.tab}
          onTab={(tab) => setAddress({ tab })}
          onClose={closePopup}
          onOpenUnit={(id, tab) => openPopup(id, tab)}
        />
      )}
      {tree && orgButton && isOrgAddress(address.open) && (
        <UnitPopup key="organisation" node={orgNode} tree={tree} levels={levels} canTop={canTop} organisation tab={address.tab} onTab={(tab) => setAddress({ tab })} onClose={closePopup} onOpenUnit={(id, tab) => openPopup(id, tab)} />
      )}
      {tree && creating && (
        <NewUnitDialog
          start={creating.start}
          tree={tree}
          levels={levels}
          canTop={canTop}
          onClose={() => setCreating(null)}
          onCreated={(created) => { setCreating(null); go(created.id, false); }}
        />
      )}
      {tree && movingNode && <MoveDialog node={movingNode} tree={tree} levels={levels} canTop={canTop} onClose={() => setMoving(null)} onMoved={() => setMoving(null)} />}
      {menu && tree && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.id === null ? 'Organisation' : `Menu for ${tree.node(menu.id)?.name ?? 'unit'}`}
          items={menuFor(menu.id)}
          onClose={(refocus) => { const from = menu.from; setMenu(null); if (refocus) window.setTimeout(() => from?.focus(), 0); }}
        />
      )}
      {toggle.dialog}
    </div>
  );
}
