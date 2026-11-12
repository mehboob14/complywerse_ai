'use client';

// Everything a folder can do in the library's Folders layout, in one hook so DocumentsWorkspace only wires it: which folder row is selected, going INTO a folder (the Department filter, pushed to
// the address, with Back, Forward and Up over the folders visited), the folder bar and its toolbar, the right-click menu and the row's "…", the keys of a folder row, and the dialogs the actions
// open: New (a unit under the selected folder, or a department at the top), Move to…, Deactivate (after a question) and PROPERTIES (the unit's popup: Details, People, Access, Approvals,
// Exceptions; its address is `?props=<unit>|org&tab=<tab>`, since `?open=` is the library's own details drawer). What a person may do with a unit is directoryModel.unitActions (a hidden action is
// not offered, a disabled one says why) and the server asks for the same; the units are read once from the Directory API (directoryData.ts), only while the Folders layout, or a Properties popup,
// is on screen. Keys on a folder row: Up, Down, Home, End, a letter (move), Right and Left (open and close), Enter (open it), Alt+Enter (Properties), F2 (Edit details), Delete (Deactivate, after a
// question), Backspace and Alt+Left (Back), Alt+Right (Forward), Alt+Up (Up); the last three also work anywhere on the page that is not a field.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type MutableRefObject, type ReactNode } from 'react';
import type { Department } from '@/lib/api';
import { useNotify } from '@/components/ui/ds';
import type { FolderUi } from '../FolderRows';
import { folderParent, folderPath, type FolderDepartment, type FolderNode } from '../libraryFolders';
import { ContextMenu } from './ContextMenu';
import { FolderBar } from './FolderBar';
import { MoveDialog, NewUnitDialog } from './UnitDialogs';
import { UnitPopup } from './UnitPopup';
import { useDirectory } from './directoryData';
import { ENABLED_ORG_TABS, ENABLED_TABS } from './directoryTabs';
import {
  badgesOf, isOrgAddress, libraryHref, organisationNode, unitActions, unitFromAddress, type ActionKey, type TabId,
} from './directoryModel';
import { departmentFilter, idOfKey, keyOfUnit, toolbarTarget } from './folderBarModel';
import { explorerShortcut, type ExplorerAction } from './explorerKeys';
import { folderKey, type FolderLine } from './folderKeys';
import { menuItems } from './unitMenu';
import { useDirectoryNav } from './useDirectoryNav';
import { useToggleActive } from './useToggleActive';

export interface FoldersInput {
  /** the Folders layout is showing */
  on: boolean;
  /** the library's list of units (every one, the switched-off too) */
  departments: readonly FolderDepartment[];
  /** the unit the library is opened into (libraryFolders.openFolderOf); null: the whole organisation */
  openFolder: number | null;
  /** write the Department filter: a step the browser's Back undoes (push), or a change of the same step */
  setDepartments: (departments: string[], push: boolean) => void;
  /** the Properties popup's place in the address */
  props: string;
  tab: TabId;
  setProps: (patch: { props?: string; tab?: TabId }) => void;
  /** open or close a folder row */
  flip: (key: string) => void;
  /** open these folders (a folder was gone into, or a new one was made inside them) */
  reveal: (keys: string[]) => void;
}

export interface FoldersApi {
  /** the folder bar, null outside the Folders layout */
  bar: ReactNode;
  /** what a folder row does (stable: it is made again only when the selection, the open folder or the units change) */
  ui: FolderUi;
  /** the folder rows as drawn (libraryItems.folderItems): the page writes them here, the keys and the toolbar read them */
  lines: MutableRefObject<readonly FolderLine[]>;
  /** the popup, the dialogs and the menu: drawn once, beside the page */
  overlays: ReactNode;
  /** adds a department at the top (the empty state's button); null where the person may not */
  newDepartment: (() => void) | null;
  /** how many units are switched off (for "Show inactive") */
  inactive: number;
}

interface Menu { x: number; y: number; key: string; from: HTMLElement | null }

export function useFolders(i: FoldersInput): FoldersApi {
  const popupWanted = i.props !== '';
  const dir = useDirectory(i.on || popupWanted);
  const { tree, canTop, levels, canOrgDefaults } = dir;
  const toggle = useToggleActive();
  const notify = useNotify();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ start: number | null } | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const lines = useRef<readonly FolderLine[]>([]);
  const focusKey = useRef<string | null>(null);                                  // the folder whose row takes the keyboard once it is drawn
  const wantFocus = (key: string) => { focusKey.current = key; window.setTimeout(() => { if (focusKey.current === key) focusKey.current = null; }, 1500); };
  useEffect(() => {
    const key = focusKey.current;
    if (!key) return;
    const main = document.querySelector<HTMLElement>(`[data-folder-main="${key}"]`);
    if (!main) return;                                                           // not drawn yet (a unit just made, still being read): asked again with the next draw, for a moment
    focusKey.current = null;
    main.focus({ preventScroll: true });
    main.scrollIntoView({ block: 'nearest' });
  });

  const nav = useDirectoryNav(i.on, i.openFolder, (to, push) => i.setDepartments(departmentFilter(to), push));
  const ctx = useMemo(() => ({ canTop, levels, tabs: ENABLED_TABS as readonly string[] }), [canTop, levels]);

  // the toolbar acts on the folder selected (when it is drawn), else the one you are in
  const drawn = (id: number) => lines.current.length === 0 || lines.current.some((l) => l.key === keyOfUnit(id));
  const target = toolbarTarget(selected, i.openFolder, (id) => !!tree?.node(id) && drawn(id));
  const actions = useMemo(() => (tree ? unitActions(tree, target, ctx) : []), [tree, target, ctx]);

  // ── going from folder to folder ──
  const ancestors = (id: number): string[] => folderPath(i.departments, id).slice(0, -1).map((n) => keyOfUnit(n.id));
  const goInto = (id: number | null) => {
    nav.navigate(id);
    if (id !== null) { i.reveal([keyOfUnit(id)]); setSelected(keyOfUnit(id)); wantFocus(keyOfUnit(id)); }
  };
  const up = () => {
    if (i.openFolder === null) return;
    const came = keyOfUnit(i.openFolder);
    setSelected(came);                                                            // Explorer: the folder you came from is selected in the one above
    i.reveal(ancestors(i.openFolder));
    wantFocus(came);
    nav.navigate(folderParent(i.departments, i.openFolder));
  };
  const back = () => nav.back();
  const forward = () => nav.forward();

  // ── the Properties popup, in the address ──
  const openPopup = (id: number, tab: TabId = 'details') => i.setProps({ props: String(id), tab });
  const closePopup = () => { i.setProps({ props: '', tab: 'details' }); setRenaming(null); };
  const popup = tree ? unitFromAddress(i.props, tree) : null;
  const popupNode = tree && popup !== null ? tree.node(popup) : undefined;
  const orgButton = canOrgDefaults && ENABLED_ORG_TABS.length > 0;
  const orgNode = useMemo(() => organisationNode(canOrgDefaults), [canOrgDefaults]);
  const openOrganisation = () => i.setProps({ props: 'org', tab: ENABLED_ORG_TABS[0] });
  const movingNode = tree && moving !== null ? tree.node(moving) : undefined;

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

  // ── menus ──
  const copyLink = async (id: number) => {
    try { await navigator.clipboard.writeText(new URL(libraryHref(id), window.location.origin).href); notify.success('Link copied'); } catch { notify.error('Couldn’t copy the link'); }
  };
  const menuFor = (key: string) => {
    const id = idOfKey(key);
    if (!tree || id === null) return [];
    return menuItems(unitActions(tree, id, ctx), (k) => run(k, id), { go: id !== i.openFolder ? { label: 'Open', onSelect: () => goInto(id) } : undefined, copy: () => { void copyLink(id); } });
  };
  // the focus goes back to what was right-clicked AT ONCE, not later: a dialog the chosen item opens then finds the focus where it left it, and keeps it
  const closeMenu = (refocus: boolean) => { const from = menu?.from; setMenu(null); if (refocus) from?.focus(); };

  // ── a folder row's keys ──
  const act = (a: ExplorerAction, node: FolderNode): boolean => {
    if (a === 'back') { back(); return true; }
    if (a === 'forward') { forward(); return true; }
    if (a === 'up') { up(); return true; }
    if (a === 'open') { if (node.id !== null) goInto(node.id); else i.flip(node.key); return true; }
    if (!tree || node.id === null) return false;
    const wanted: ActionKey = a === 'properties' ? 'properties' : a === 'rename' ? 'edit' : 'toggle';
    const found = unitActions(tree, node.id, ctx).find((x) => x.key === wanted);
    if (!found || found.hidden || found.disabled || (wanted === 'toggle' && found.label !== 'Deactivate')) return false;
    run(wanted, node.id);
    return true;
  };
  const onRowKey = (e: KeyboardEvent<HTMLElement>, node: FolderNode) => {
    if (e.ctrlKey || e.metaKey) return;
    const shortcut = explorerShortcut(e.nativeEvent);
    if (shortcut) { if (act(shortcut, node)) e.preventDefault(); return; }
    if (e.altKey || e.shiftKey) return;
    const k = folderKey(lines.current, node.key, e.key);
    if (!k) return;
    e.preventDefault();
    if ('focus' in k) { setSelected(k.focus); wantFocus(k.focus); }
    else if ('expand' in k) i.flip(k.expand);
    else if ('collapse' in k) i.flip(k.collapse);
    else act('open', node);
  };

  // Back, Forward and Up from anywhere on the page that is not a field, a menu or a dialog
  const keyed = useRef<(a: ExplorerAction) => void>(() => undefined);
  keyed.current = (a) => { if (a === 'back') back(); else if (a === 'forward') forward(); else if (a === 'up') up(); };
  useEffect(() => {
    if (!i.on) return undefined;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const a = explorerShortcut(e);
      if (a !== 'back' && a !== 'forward' && a !== 'up') return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && t !== document.body && !t.closest('#main-content')) return;               // the sidebar, the top bar: not ours
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]')) return;
      e.preventDefault();
      keyed.current(a);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [i.on]);

  // the row's handlers always read the latest state (they are made once and call through this), so the rows are drawn again only when what they show changes
  const latest = useRef({ onRowKey, goInto, flip: i.flip, tree, select: setSelected, openMenu: setMenu });
  latest.current = { onRowKey, goInto, flip: i.flip, tree, select: setSelected, openMenu: setMenu };
  const ui = useMemo<FolderUi>(() => ({
    selected,
    current: i.openFolder,
    defaults: (n) => { const unit = n.id !== null ? tree?.node(n.id) : undefined; return unit ? badgesOf(unit) : []; },
    hasMenu: (n) => n.id !== null && !!tree?.node(n.id),
    onSelect: (n) => latest.current.select(n.key),
    onOpen: (n) => { if (n.id !== null) latest.current.goInto(n.id); else latest.current.flip(n.key); },
    onContext: (e: MouseEvent<HTMLElement>, n) => {
      if (n.id === null || !latest.current.tree) return;                              // "No department" is no unit: the browser's own menu
      e.preventDefault();
      latest.current.select(n.key);
      latest.current.openMenu({ x: e.clientX, y: e.clientY, key: n.key, from: e.currentTarget });
    },
    onMenu: (anchor, n) => {
      const r = anchor.getBoundingClientRect();
      latest.current.select(n.key);
      latest.current.openMenu({ x: r.left, y: r.bottom + 2, key: n.key, from: anchor });
    },
    onKey: (e, n) => latest.current.onRowKey(e, n),
  }), [selected, i.openFolder, tree]);

  const bar = i.on ? (
    <FolderBar
      path={folderPath(i.departments, i.openFolder)}
      canBack={nav.canBack}
      canForward={nav.canForward}
      canUp={i.openFolder !== null}
      onBack={back}
      onForward={forward}
      onUp={up}
      onGo={goInto}
      actions={actions}
      targetName={target === null ? '' : tree?.node(target)?.name ?? ''}
      busy={toggle.busy}
      onRun={(k) => run(k, target)}
      onOrganisation={orgButton ? openOrganisation : undefined}
    />
  ) : null;

  const overlays = (
    <>
      {tree && popupNode && (
        <UnitPopup
          key={popupNode.id}
          node={popupNode}
          tree={tree}
          levels={levels}
          canTop={canTop}
          tab={i.tab}
          onTab={(tab) => i.setProps({ tab })}
          onClose={closePopup}
          onOpenUnit={(id, tab) => openPopup(id, tab)}
          focusName={renaming === popupNode.id}
        />
      )}
      {tree && orgButton && isOrgAddress(i.props) && (
        <UnitPopup key="organisation" node={orgNode} tree={tree} levels={levels} canTop={canTop} organisation tab={i.tab} onTab={(tab) => i.setProps({ tab })} onClose={closePopup} onOpenUnit={(id, tab) => openPopup(id, tab)} />
      )}
      {tree && creating && (
        <NewUnitDialog
          start={creating.start}
          tree={tree}
          levels={levels}
          canTop={canTop}
          onClose={() => setCreating(null)}
          onCreated={(created: Department) => {
            setCreating(null);
            if (created.parent_department_id != null) i.reveal([keyOfUnit(created.parent_department_id), ...ancestors(created.parent_department_id)]);
            setSelected(keyOfUnit(created.id));
            wantFocus(keyOfUnit(created.id));
          }}
        />
      )}
      {tree && movingNode && <MoveDialog node={movingNode} tree={tree} levels={levels} canTop={canTop} onClose={() => setMoving(null)} onMoved={() => setMoving(null)} />}
      {menu && tree && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={`Menu for ${tree.node(idOfKey(menu.key) ?? -1)?.name ?? 'folder'}`}
          items={menuFor(menu.key)}
          onClose={closeMenu}
        />
      )}
      {toggle.dialog}
    </>
  );

  return {
    bar,
    ui,
    lines,
    overlays,
    newDepartment: tree && canTop ? () => setCreating({ start: null }) : null,
    inactive: i.departments.filter((d) => d.is_active === false).length,
  };
}
