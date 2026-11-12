'use client';

export const dynamic = 'force-dynamic';

// Governance > Documents > Directory: the organisation as folders, behaving like Windows Explorer. The tree of departments, sub-departments and units on the left; above the contents an
// address bar (Back, Forward, Up, and the path of the folder you are in) and a toolbar (New <next level>, Properties, Edit details, Move to…, Deactivate, Access, Approvals, Refresh,
// Icons | Details); on the right the folder's facts, its folders and then the documents filed in it (as files).
// A DOUBLE-CLICK (or Enter) on a folder, in the tree or in the contents, goes INTO it: the address pushes (?unit=), so the browser's Back comes back, and so do Back, Forward and Up here.
// A double-click on a file opens the document's page. A single click only selects. PROPERTIES (the unit's popup: Details, People, Access, Approvals, Exceptions) opens from the toolbar,
// the menus, Alt+Enter and a link (?open=<unit>&tab=<tab>). Keys: Backspace and Alt+Left back, Alt+Right forward, Alt+Up up, Enter open, Alt+Enter Properties, F2 Edit details, Delete
// Deactivate (it asks first), arrows, Home, End and a letter in the contents (explorerKeys.ts). A unit is never deleted (documents and assignments point at it): it is deactivated, after a
// question, and can be activated again. Everybody who can sign in reads the tree; what a person may change is decided per unit (the Directory API's can_manage, or until it exists their
// global right to edit the organisation) and the server asks for the same. Under 768px the tree is not drawn: the address bar and the list are a drill-down (a tap opens). Every part has a
// loading, a failed (with Retry), an empty and a "no access" state.
//   directoryModel.ts  the rules (tested)   directoryFiles.ts  the files and their order   navTrail.ts  Back/Forward   explorerKeys.ts  the keys   directoryData.ts, directoryFilesData.ts  the data
//   directoryTabs.ts  the tab registry   unitMenu.ts  the actions as menu items   folderIcon.tsx  the yellow folders and the file page   useDirectoryNav.ts  moving between folders
//   UnitTree  AddressBar  Toolbar  Contents  UnitPopup  UnitDialogs  ContextMenu  the parts   UnitForm  DetailsTab  PeopleTab  useToggleActive  the unit's own fields and questions
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, NoAccessState, ReadOnlyNote, SkeletonLines, useAddressState, useNotify } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { oneOf, text } from '@/lib/addressState';
import { MAX_DEPTH } from '@/lib/departments';
import { routeFor } from '@/lib/navRegistry';
import { AddressBar } from './AddressBar';
import { ContextMenu } from './ContextMenu';
import { Contents, useCompact, type FilesView } from './Contents';
import { EmptyFolder } from './EmptyFolder';
import { MoveDialog, NewUnitDialog } from './UnitDialogs';
import { UnitPopup } from './UnitPopup';
import { UnitTree } from './UnitTree';
import { Toolbar, type ViewId } from './Toolbar';
import { useDirectory } from './directoryData';
import { useDirectoryFiles } from './directoryFilesData';
import { ENABLED_ORG_TABS, ENABLED_TABS } from './directoryTabs';
import { fileMenuItems, menuItems } from './unitMenu';
import { useDirectoryNav } from './useDirectoryNav';
import { useToggleActive } from './useToggleActive';
import { explorerShortcut, type ExplorerAction } from './explorerKeys';
import { docHref, filesIn, folderKey, itemOf, libraryFileHref, unitKey, type DirFile, type Item, type ItemKey } from './directoryFiles';
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
const INFO = `The organisation as folders, and the documents filed in each. Double-click a folder, or select it and press Enter, to open it; Backspace goes back. Select one and press Alt+Enter, or use Properties, for its details, people, access and approvals; right-click for its menu. Units go ${MAX_DEPTH} levels deep. A unit is never deleted: deactivate it, and the documents already in it keep it.`;
const VIEW_ONLY = 'Only an administrator, or someone whose role lets them edit the organisation, can add or change departments. Where you manage a unit, its buttons are there.';

/** What a right-click or the menu key was on: a folder (null: the organisation, in the tree) or a file. */
type Target = { kind: 'unit'; id: number | null } | { kind: 'doc'; id: number };
interface Menu { x: number; y: number; target: Target; from: HTMLElement | null }

export default function DirectoryPage() {
  const data = useDirectory();
  const filesData = useDirectoryFiles();
  const { tree, directory, canTop, levels, canOrgDefaults } = data;
  const [address, setAddress] = useAddressState(ADDRESS);
  const compact = useCompact();
  const toggle = useToggleActive();
  const notify = useNotify();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  const [creating, setCreating] = useState<{ start: number | null } | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [chosen, setChosen] = useState<Readonly<Record<string, ItemKey | null>>>({});       // what is selected in each folder visited, so Back finds it as it was
  const root = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  const focusPane = useRef(false);                                                           // the keyboard goes into the contents once the folder has changed
  const wantPane = () => { focusPane.current = true; window.setTimeout(() => { focusPane.current = false; }, 1500); };       // (not for ever: a move that never comes must not steal the focus later)

  const current = tree ? unitFromAddress(address.unit, tree) : null;
  const popup = tree ? unitFromAddress(address.open, tree) : null;
  const ctx = useMemo(() => ({ canTop, levels, tabs: ENABLED_TABS as readonly string[] }), [canTop, levels]);
  const rows = useMemo(() => (tree ? treeRows(tree, expanded) : []), [tree, expanded]);

  const setUnit = useCallback((to: number | null, push: boolean) => setAddress({ unit: to === null ? '' : String(to) }, { push }), [setAddress]);
  const nav = useDirectoryNav(tree, current, setUnit);

  // what is selected here: a folder or a file of the folder you are in (an item that is gone is no selection)
  const selected = chosen[folderKey(current)] ?? null;
  const select = useCallback((key: ItemKey | null) => setChosen((m) => ({ ...m, [folderKey(current)]: key })), [current]);
  const selectedItem = itemOf(selected);
  const selectedUnit = tree && selectedItem?.kind === 'unit' && tree.parentOf(selectedItem.id) === current ? selectedItem.id : null;

  // the toolbar acts on the folder selected, else the one you are in; "New" is always in the one you are in
  const target = selectedUnit ?? current;
  const actions = useMemo(() => {
    if (!tree) return [];
    const own = unitActions(tree, target, ctx);
    if (target === current) return own;
    const fresh = unitActions(tree, current, ctx).find((a) => a.key === 'new');
    return own.map((a) => (a.key === 'new' && fresh ? fresh : a));
  }, [tree, target, current, ctx]);

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

  // after a move to another folder that the keyboard or a double-click made, the keyboard is in the contents: on the selected item, else the first
  useEffect(() => {
    if (!focusPane.current || !tree) return;
    focusPane.current = false;
    const el = pane.current;
    const item = el?.querySelector<HTMLElement>('[data-item][tabindex="0"]') ?? el;
    item?.focus({ preventScroll: true });
    item?.scrollIntoView({ block: 'nearest' });                                          // the folder you came up from is in view
  }, [current, tree]);

  const openPopup = (id: number, tab: TabId = 'details') => setAddress({ open: String(id), tab });
  const closePopup = () => { setAddress({ open: '', tab: 'details' }); setRenaming(null); };
  // the Organisation popup (?open=org): the defaults every unit inherits; offered to a person who may write them, once a tab for it exists
  const orgButton = canOrgDefaults && ENABLED_ORG_TABS.length > 0;
  const orgNode = useMemo(() => organisationNode(canOrgDefaults), [canOrgDefaults]);
  const openOrganisation = () => setAddress({ open: ORG_PARAM, tab: ENABLED_ORG_TABS[0] });
  const toggleOpen = (id: number) => {
    if (!tree) return;
    const wasOpen = expanded.has(id);
    setExpanded((prev) => { const next = new Set(prev); if (wasOpen) next.delete(id); else next.add(id); return next; });
    if (wasOpen) { const next = selectionAfterClose(tree, current, id); if (next !== current) nav.navigate(next, 'replace'); }
  };

  // going to a folder: its units are shown opened in the tree (shutting it is the arrow's); a key in the tree moves the selection and leaves the rest as it is
  const goInto = (id: number | null) => {
    nav.navigate(id);
    if (id !== null && tree && tree.childrenOf(id).length > 0) setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };
  const selectInTree = (id: number | null, by: 'click' | 'key') => (by === 'click' ? goInto(id) : nav.navigate(id, 'replace'));
  const openFolder = (id: number) => { wantPane(); goInto(id); };       // a double-click or Enter in the contents
  const up = () => {
    if (!tree || current === null) return;
    const parent = tree.parentOf(current);
    setChosen((m) => ({ ...m, [folderKey(parent)]: unitKey(current) }));                // Explorer: the folder you came from is selected in the one above
    wantPane();
    goInto(parent);
  };
  const back = () => { wantPane(); nav.back(); };
  const forward = () => { wantPane(); nav.forward(); };

  // a file: its own page (where the library opens a document), with this folder as the way back
  const here = search ? `${pathname}?${search}` : pathname;
  const fileById = (id: number): DirFile | undefined => filesData.files.find((f) => f.id === id);
  const openFile = (f: DirFile) => router.push(docHref(f.id, here));
  const copyLink = async (f: DirFile) => {
    try { await navigator.clipboard.writeText(new URL(docHref(f.id), window.location.origin).href); notify.success('Link copied'); } catch { notify.error('Couldn’t copy the link'); }
  };
  const openItem = (item: Item) => {
    if (item.kind === 'unit') { openFolder(item.id); return; }
    const f = fileById(item.id);
    if (f) openFile(f);
  };

  const run = (key: ActionKey, id: number | null) => {
    if (!tree) return;
    if (key === 'new') { setCreating({ start: id }); return; }
    if (id === null) return;
    if (key === 'properties') openPopup(id, 'details');
    else if (key === 'edit') { setRenaming(id); openPopup(id, 'details'); }
    else if (key === 'move') setMoving(id);
    else if (key === 'toggle') { const n = tree.node(id); if (n) void toggle.toggle(n); }
    else openPopup(id, key);
  };
  const menuForUnit = (id: number | null) => (tree
    ? menuItems(unitActions(tree, id, ctx), (k) => run(k, id), id !== null && id !== current ? { label: 'Open', onSelect: () => openFolder(id) } : undefined)
    : []);
  const menuForFile = (id: number) => {
    const f = fileById(id);
    return f ? fileMenuItems({ open: () => openFile(f), library: () => router.push(libraryFileHref(f)), copy: () => { void copyLink(f); } }) : [];
  };
  const menuFor = (t: Target) => (t.kind === 'unit' ? menuForUnit(t.id) : menuForFile(t.id));
  // the focus goes back to what was right-clicked AT ONCE, not later: a dialog the chosen item opens then finds the focus where it left it, and keeps it (a late refocus took it out of the dialog)
  const closeMenu = (refocus: boolean) => { const from = menu?.from; setMenu(null); if (refocus) from?.focus(); };
  const contextAt = (e: MouseEvent, t: Target) => {
    const el = e.currentTarget as HTMLElement;
    setMenu({ x: e.clientX, y: e.clientY, target: t, from: el.matches('[tabindex]') ? el : el.querySelector<HTMLElement>('button') });
  };

  // the keys that act on the selection, and the way back: on the page, not in a field and not under a dialog or a menu
  const keyed = useRef<(a: ExplorerAction, from: HTMLElement | null) => boolean>(() => false);
  keyed.current = (a, from) => {
    if (!tree) return false;
    if (a === 'back') { back(); return true; }
    if (a === 'forward') { forward(); return true; }
    if (a === 'up') { up(); return true; }
    if (a === 'open') {
      if (selectedItem) { openItem(selectedItem); return true; }
      return false;
    }
    // Properties, Edit details and Deactivate: the folder in the tree the focus is on, else the one selected (Properties alone also takes the one you are in)
    const row = from?.closest<HTMLElement>('[data-unit]')?.dataset.unit;
    if (row === 'org') return false;                                                       // the Organisation has its own button (Organisation defaults)
    if (a === 'properties' && selectedItem?.kind === 'doc' && row === undefined) { const f = fileById(selectedItem.id); if (f) router.push(libraryFileHref(f)); return !!f; }
    const id = row !== undefined ? Number(row) : selectedUnit ?? (a === 'properties' ? current : null);
    if (id === null) return false;
    const wanted: ActionKey = a === 'properties' ? 'properties' : a === 'rename' ? 'edit' : 'toggle';
    const act = unitActions(tree, id, ctx).find((x) => x.key === wanted);
    if (!act || act.hidden || act.disabled || (wanted === 'toggle' && act.label !== 'Deactivate')) return false;
    run(wanted, id);
    return true;
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = explorerShortcut(e);
      if (!action) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;                 // a popup or a menu has the keyboard
      if (t && t !== document.body && !root.current?.contains(t)) return;                    // the sidebar, the header: not ours
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]')) return;
      if (action === 'open' && t !== document.body && t !== pane.current) return;            // Enter on a button or a row is that control's own
      if (keyed.current(action, t)) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const nodes = directory?.nodes ?? [];
  const off = nodes.filter((n) => !n.is_active).length;
  const meta = nodes.length > 0 ? `${countText(nodes.length, 'unit')}${off ? ` · ${off} inactive` : ''}` : undefined;
  const readOnly = !!directory && !data.loading && viewOnly(nodes, canTop);

  const { files: allFiles, loading: filesLoading, failed: filesFailed, error: filesError, refused: filesRefused, partial: filesPartial, refetch: refetchFiles } = filesData;
  const files = useMemo<FilesView>(() => ({
    rows: filesIn(allFiles, current), loading: filesLoading, failed: filesFailed, error: filesError, refused: filesRefused, partial: filesPartial, onRetry: refetchFiles,
  }), [allFiles, current, filesLoading, filesFailed, filesError, filesRefused, filesPartial, refetchFiles]);

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
      <div className="rounded-ds-card border border-dashed border-ds-border-strong bg-ds-surface">
        <EmptyFolder
          title="No departments yet"
          action={first && !first.hidden ? <Button variant="primary" onClick={() => setCreating({ start: null })}>{first.label}</Button> : undefined}
          info={first && !first.hidden ? undefined : 'An administrator adds the first department.'}
        />
      </div>
    );
  } else {
    body = (
      <>
        {data.error != null && <ErrorState compact title="Unavailable" message="What is shown may be out of date." onRetry={canRetry(data.error) ? data.refetch : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />}
        <Toolbar actions={actions} busy={toggle.busy} onRun={(k) => run(k, k === 'new' ? current : target)} view={address.view} onView={(v) => setAddress({ view: v })} onRefresh={() => { data.refetch(); refetchFiles(); }} refreshing={data.fetching} onOrganisation={orgButton ? openOrganisation : undefined} />
        <AddressBar tree={tree} current={current} onGo={(id) => goInto(id)} canBack={nav.canBack} canForward={nav.canForward} onBack={back} onForward={forward} onUp={up} />
        <div className="grid grid-cols-1 gap-[16px] md:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
          <div className="hidden min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[8px] md:block">
            <UnitTree tree={tree} rows={rows} selected={current} onSelect={selectInTree} onToggle={toggleOpen} onOpen={(id) => goInto(id)} onContext={(e, id) => contextAt(e, { kind: 'unit', id })} />
          </div>
          <div className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
            <Contents
              tree={tree}
              current={current}
              view={address.view}
              compact={compact}
              files={files}
              selected={selected}
              onSelect={select}
              onOpen={openItem}
              onContext={(e, item) => contextAt(e, item)}
              menuFor={menuFor}
              newAction={actions.find((a) => a.key === 'new')}
              onNew={() => run('new', current)}
              paneRef={pane}
            />
          </div>
        </div>
      </>
    );
  }

  const popupNode = tree && popup !== null ? tree.node(popup) : undefined;
  const movingNode = tree && moving !== null ? tree.node(moving) : undefined;
  return (
    <div ref={root} className="flex flex-col gap-[16px]">
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
          focusName={renaming === popupNode.id}
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
          onCreated={(created) => { setCreating(null); nav.navigate(created.id, 'replace'); }}
        />
      )}
      {tree && movingNode && <MoveDialog node={movingNode} tree={tree} levels={levels} canTop={canTop} onClose={() => setMoving(null)} onMoved={() => setMoving(null)} />}
      {menu && tree && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.target.kind === 'doc' ? `Menu for ${fileById(menu.target.id)?.title ?? 'file'}` : menu.target.id === null ? 'Organisation' : `Menu for ${tree.node(menu.target.id)?.name ?? 'unit'}`}
          items={menuFor(menu.target)}
          onClose={closeMenu}
        />
      )}
      {toggle.dialog}
    </div>
  );
}
