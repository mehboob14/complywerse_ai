'use client';

// The right-hand side of the Directory, as Explorer's window: the folder you are in (its name and facts), then what is in it, the folders directly under it FIRST and the documents
// filed in it AFTER them, as Icons ("medium icons": the icon, its name under it) or Details (a table of folders, then a table of files). A single click only selects (a light tint; the
// "⋯" of the selected one is there); a double-click, or Enter, OPENS it: a folder is gone into (the address pushes, so the browser's Back comes back), a file opens the document's page.
// Arrow keys move the selection (a grid in Icons: Up and Down go a row; a list in Details), Home and End go to the ends, a letter to the next name that starts with it; the keys that
// act on the selection (F2, Delete, Alt+Enter) and the way back (Backspace, Alt+arrows) are the page's (explorerKeys.ts). A right-click opens the item's menu. On a phone, or with a
// touch screen, a tap opens (there is no double-click), and the "⋯" is on every item. A long list of files shows the first FILE_PAGE with "Show more". The files are the library's own
// list narrowed to this folder (directoryFiles.ts); a list that did not load says so and Retry asks again, and is never drawn as an empty folder. Nothing here changes data.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { Button, ErrorState, Fact, FactList, Menu, SkeletonLines, StatusPill, TableFrame, Table, THead, TBody, Tr, Th, Td, RowHeaderCell, type MenuItem } from '@/components/ui/ds';
import type { SortState } from '@/components/ui/ds/tableModel';
import { InfoTip } from '@/components/ui/InfoTip';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { documentStatus, statusPill } from '@/lib/status';
import { MAX_DEPTH } from '@/lib/departments';
import { ACTION_ICON } from './unitMenu';
import { EmptyFolder } from './EmptyFolder';
import { FileIcon, FolderIcon } from './folderIcon';
import { ORGANISATION, badgesOf, countText, libraryHref, summaryOf, type ActionState, type DirectoryNode, type DirectoryTree } from './directoryModel';
import { FILE_PAGE, capFiles, docKey, fileTip, itemKeys, itemOf, keyOf, reviewText, sortFiles, sortFolders, unitKey, type DirFile, type Item, type ItemKey } from './directoryFiles';
import { moveSelection, typeAhead } from './explorerKeys';
import type { ViewId } from './Toolbar';

// measured before the browser paints (a phone never sees the table for a frame); on the server there is nothing to measure
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function useMedia(query: string): boolean {
  const [on, setOn] = useState(false);
  useBeforePaint(() => {
    const q = window.matchMedia(query);
    const set = () => setOn(q.matches);
    set();
    q.addEventListener('change', set);
    return () => q.removeEventListener('change', set);
  }, [query]);
  return on;
}

/** Whether the window is narrower than 768px: the contents are then the Icons list (the same breakpoint as the kit's tables turning into cards). */
export const useCompact = (): boolean => useMedia('(max-width: 767px)');
/** Whether the main pointer is a finger: there is no double-click, so a tap opens. */
const useCoarse = (): boolean => useMedia('(pointer: coarse)');

/** What the Contents are told about the files of this folder. */
export interface FilesView {
  /** the documents filed directly in this folder, unsorted */
  rows: readonly DirFile[];
  loading: boolean;
  failed: boolean;
  error: unknown;
  /** the person may read no documents: none are shown, and that is not an error */
  refused: boolean;
  /** the list the page holds is not every document */
  partial: boolean;
  onRetry: () => void;
}

interface Props {
  tree: DirectoryTree;
  current: number | null;
  view: ViewId;
  compact: boolean;
  files: FilesView;
  selected: ItemKey | null;
  onSelect: (key: ItemKey | null) => void;
  /** a double-click, Enter, or a tap on a phone */
  onOpen: (item: Item) => void;
  onContext: (e: MouseEvent, item: Item) => void;
  menuFor: (item: Item) => MenuItem[];
  /** the "New <level>" action of the folder you are in, for the empty state (hidden or absent: no button) */
  newAction?: ActionState;
  onNew: () => void;
  /** the pane, so the page can put the keyboard in it after going to another folder */
  paneRef: RefObject<HTMLElement>;
}

const CHIP = 'inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] text-ds-label font-normal text-ds-fg-body';
const NO_MENU: MenuItem[] = [];
const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

/** How many items sit in one row of the grid: the ones that share the first one's top. */
function columnsOf(box: HTMLElement | null): number {
  const els = box?.querySelectorAll<HTMLElement>('[data-item]');
  if (!els || els.length === 0) return 1;
  const top = Math.round(els[0].getBoundingClientRect().top);
  let n = 0;
  for (const el of Array.from(els)) { if (Math.round(el.getBoundingClientRect().top) !== top) break; n += 1; }
  return Math.max(1, n);
}

export function Contents({ tree, current, view, compact, files, selected, onSelect, onOpen, onContext, menuFor, newAction, onNew, paneRef }: Props) {
  const coarse = useCoarse();
  const tap = compact || coarse;
  const here = current === null ? null : tree.node(current) ?? null;
  const where = here ? here.name : ORGANISATION;
  const sum = summaryOf(tree, current);
  const showDefaults = tree.nodes.some((n) => n.defaults);
  const NewIcon = ACTION_ICON.new;
  const box = useRef<HTMLDivElement>(null);

  const [folderSort, setFolderSort] = useState<SortState>(null);
  const [fileSort, setFileSort] = useState<SortState>(null);
  const [shownFor, setShownFor] = useState<{ folder: number | null; n: number }>({ folder: current, n: FILE_PAGE });
  const limit = shownFor.folder === current ? shownFor.n : FILE_PAGE;

  const kids = sortFolders(tree.childrenOf(current), tree, folderSort);
  const sorted = sortFiles(files.rows, fileSort);
  const { shown, more } = capFiles(sorted, limit);
  const keys = itemKeys(kids, shown);
  const active = selected !== null && keys.includes(selected) ? selected : null;
  const tabStop = active ?? keys[0] ?? null;
  const grid = view === 'icons' || compact;
  const nothing = kids.length === 0 && files.rows.length === 0;
  const waiting = files.loading && kids.length === 0;

  // keys that move the selection: only when the focus is on an item itself (a key on its "⋯" is that button's), before the item's own handlers
  const names = [...kids.map((n) => n.name), ...shown.map((f) => f.title)];
  const onKeyDownCapture = (e: KeyboardEvent<HTMLElement>) => {
    const el = e.target as HTMLElement;
    if (!el.matches('[data-item]') || e.altKey || e.ctrlKey || e.metaKey) return;
    const at = keys.indexOf(el.dataset.item as ItemKey);
    let to: number | null = null;
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      const item = itemOf(el.dataset.item);
      if (item) onOpen(item);
      return;
    }
    if (NAV_KEYS.includes(e.key)) { e.preventDefault(); to = moveSelection(keys.length, at, e.key, grid ? columnsOf(box.current) : 1); }
    else { to = typeAhead(names, at, e.key); if (to !== null) e.preventDefault(); }
    if (to === null) return;
    e.stopPropagation();
    onSelect(keys[to]);
    const next = box.current?.querySelector<HTMLElement>(`[data-item="${keys[to]}"]`);
    next?.focus();
    next?.scrollIntoView({ block: 'nearest' });
  };

  const pick = (key: ItemKey) => onSelect(key);
  const menuIf = (selectedOne: boolean, item: Item): MenuItem[] => (selectedOne || tap ? menuFor(item) : NO_MENU);     // only the selected one (every one on a phone) draws its "⋯"
  const context = (e: MouseEvent, item: Item) => { onSelect(keyOf(item)); onContext(e, item); };
  const moreButton = more > 0 && (
    <div className="flex items-center gap-[8px]">
      <Button size="sm" onClick={() => setShownFor({ folder: current, n: limit + FILE_PAGE })}>Show more</Button>
      <span className="text-ds-label font-normal text-ds-fg-muted">{more} more {more === 1 ? 'file' : 'files'}</span>
    </div>
  );

  let body: ReactNode;
  if (waiting) body = <SkeletonLines lines={3} label="Loading the folder" />;
  else if (files.failed && kids.length === 0) body = <ErrorState compact title="Couldn't load the files" message={errorMessage(files.error)} onRetry={canRetry(files.error) ? files.onRetry : undefined} />;
  else if (nothing && !files.failed) {
    body = (
      <EmptyFolder
        title="This folder is empty"
        info={here && here.level >= MAX_DEPTH ? `Units go ${MAX_DEPTH} levels deep, so nothing can be added under a ${here.level_label}. Documents are filed here from the library.` : 'Add a unit with the New button, or file documents here from the library.'}
        action={newAction && !newAction.hidden ? (
          <Button variant="primary" leftIcon={<NewIcon aria-hidden />} disabled={newAction.disabled} title={newAction.reason} onClick={onNew}>{newAction.label}</Button>
        ) : undefined}
      />
    );
  } else if (grid) {
    body = (
      <>
        <ul aria-label={`Folders and files in ${where}`} className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-[4px] p-0">
          {kids.map((n) => (
            <FolderTile key={n.id} node={n} tree={tree} on={active === unitKey(n.id)} tabStop={tabStop === unitKey(n.id)} tap={tap} onSelect={pick} onOpen={onOpen} onContext={context} menu={menuIf(active === unitKey(n.id), { kind: 'unit', id: n.id })} />
          ))}
          {shown.map((f) => (
            <FileTile key={f.id} file={f} on={active === docKey(f.id)} tabStop={tabStop === docKey(f.id)} tap={tap} onSelect={pick} onOpen={onOpen} onContext={context} menu={menuIf(active === docKey(f.id), { kind: 'doc', id: f.id })} />
          ))}
        </ul>
        {moreButton}
      </>
    );
  } else {
    body = (
      <>
        {kids.length > 0 && (
          <TableFrame aria-label={`Folders in ${where}`}>
            <Table caption={`Folders in ${where}`}>
              <THead>
                <tr>
                  <Th sortKey="name" sort={folderSort} onSortChange={setFolderSort}>Name</Th>
                  <Th priority={3} sortKey="level" sort={folderSort} onSortChange={setFolderSort}>Level</Th>
                  <Th priority={2} sortKey="owner" sort={folderSort} onSortChange={setFolderSort}>Owner</Th>
                  <Th priority={3} align="right" sortKey="people" sort={folderSort} onSortChange={setFolderSort}>People</Th>
                  <Th priority={2} align="right" sortKey="documents" sort={folderSort} onSortChange={setFolderSort}>Documents</Th>
                  <Th priority={2} align="right" sortKey="units" sort={folderSort} onSortChange={setFolderSort}>Units</Th>
                  {showDefaults && <Th priority={3}>Defaults</Th>}
                  <Th align="right"><span className="sr-only">Actions</span></Th>
                </tr>
              </THead>
              <TBody>
                {kids.map((n) => (
                  <FolderRow key={n.id} node={n} tree={tree} showDefaults={showDefaults} on={active === unitKey(n.id)} tabStop={tabStop === unitKey(n.id)} tap={tap} onSelect={pick} onOpen={onOpen} onContext={context} menu={menuIf(active === unitKey(n.id), { kind: 'unit', id: n.id })} />
                ))}
              </TBody>
            </Table>
          </TableFrame>
        )}
        {shown.length > 0 && (
          <TableFrame aria-label={`Files in ${where}`}>
            <Table caption={`Files in ${where}`}>
              <THead>
                <tr>
                  <Th sortKey="name" sort={fileSort} onSortChange={setFileSort}>Name</Th>
                  <Th priority={2} sortKey="status" sort={fileSort} onSortChange={setFileSort}>Status</Th>
                  <Th priority={3} sortKey="type" sort={fileSort} onSortChange={setFileSort}>Type</Th>
                  <Th priority={3} sortKey="version" sort={fileSort} onSortChange={setFileSort}>Version</Th>
                  <Th priority={2} sortKey="owner" sort={fileSort} onSortChange={setFileSort}>Owner</Th>
                  <Th priority={3} sortKey="review" sort={fileSort} onSortChange={setFileSort}>Next review</Th>
                  <Th align="right"><span className="sr-only">Actions</span></Th>
                </tr>
              </THead>
              <TBody>
                {shown.map((f) => (
                  <FileRow key={f.id} file={f} on={active === docKey(f.id)} tabStop={tabStop === docKey(f.id)} tap={tap} onSelect={pick} onOpen={onOpen} onContext={context} menu={menuIf(active === docKey(f.id), { kind: 'doc', id: f.id })} />
                ))}
              </TBody>
            </Table>
          </TableFrame>
        )}
        {moreButton}
      </>
    );
  }

  const fileCount = files.rows.length;
  const filesText = files.loading || files.failed || files.refused ? null : fileCount > shown.length ? `${shown.length} of ${fileCount} files` : countText(fileCount, 'file');
  const info = `Double-click a folder, or select it and press Enter, to open it; Backspace goes back. A folder's document count includes the folders under it. The files are the documents filed directly in this folder; open one to read it, or right-click for more.${files.partial ? ' The list holds the first 10,000 documents, so a folder may show fewer.' : ''}`;

  return (
    <section ref={paneRef} tabIndex={-1} aria-labelledby="directory-here" className="flex min-w-0 flex-col gap-[12px] focus-visible:outline-none">
      <div className="flex flex-wrap items-center gap-[8px]">
        <FolderIcon size={28} open inactive={!!here && !here.is_active} />
        <h2 id="directory-here" className="min-w-0 break-words !text-ds-section !text-ds-fg">{where}</h2>
        {here && <span className={CHIP}>{here.level_label}</span>}
        {here && !here.is_active && <StatusPill size="sm" tone="neutral" label="Inactive" />}
      </div>
      <FactList variant="boxed" min={130}>
        {here ? (
          <>
            <Fact label="Owner" empty="No owner">{sum.owner}</Fact>
            <Fact label="Documents"><Link href={libraryHref(current)} className="text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{sum.documents}{sum.documentsTotal > sum.documents ? <span className="font-normal text-ds-fg-muted"> · {sum.documentsTotal} with units below</span> : null}</Link></Fact>
            <Fact label="People">{sum.people}</Fact>
            <Fact label="Units">{sum.units}</Fact>
          </>
        ) : (
          <>
            <Fact label="Top level">{sum.units}</Fact>
            <Fact label="All units">{sum.unitsBelow}</Fact>
            <Fact label="Documents"><Link href={libraryHref(null)} className="text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{sum.documentsTotal}</Link></Fact>
          </>
        )}
      </FactList>

      <div ref={box} onKeyDownCapture={onKeyDownCapture} className="flex min-w-0 flex-col gap-[12px]">{body}</div>

      {files.failed && kids.length > 0 && (
        <ErrorState compact title="Couldn't load the files" message={errorMessage(files.error)} onRetry={canRetry(files.error) ? files.onRetry : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
      )}
      {!waiting && (
        <p className="flex flex-wrap items-center gap-[4px] text-ds-label font-normal text-ds-fg-muted">
          {countText(kids.length, 'folder')}{filesText ? ` · ${filesText}` : ''}{files.refused ? ' · Documents are not shown to you' : ''}
          <InfoTip text={info} label="About folders and files" />
        </p>
      )}
    </section>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface TileProps {
  itemKey: ItemKey;
  item: Item;
  icon: ReactNode;
  name: string;
  sub?: string;
  /** a word the picture says in colour or a mark, for a screen reader (and the tooltip carries it for the rest) */
  say?: string;
  pill?: ReactNode;
  tip: string;
  dim?: boolean;
  menuLabel: string;
  on: boolean;
  tabStop: boolean;
  tap: boolean;
  menu: MenuItem[];
  onSelect: (key: ItemKey) => void;
  onOpen: (item: Item) => void;
  onContext: (e: MouseEvent, item: Item) => void;
}

/** One folder or file as Explorer's medium icon: the picture, its name under it (two lines, then an ellipsis), a light tint when selected, a ring when the keyboard is on it. */
function Tile({ itemKey, item, icon, name, sub, say, pill, tip, dim, menuLabel, on, tabStop, tap, menu, onSelect, onOpen, onContext }: TileProps) {
  return (
    <li className="relative min-w-0" onContextMenu={(e) => { e.preventDefault(); onContext(e, item); }}>
      <button
        type="button"
        data-item={itemKey}
        tabIndex={tabStop ? 0 : -1}
        aria-current={on ? 'true' : undefined}
        title={tip}
        onClick={() => (tap ? onOpen(item) : onSelect(itemKey))}
        onDoubleClick={() => { if (!tap) onOpen(item); }}
        className={clsx(
          'flex w-full flex-col items-center gap-[4px] rounded-ds-card border p-[8px] text-center focus-visible:outline-none focus-visible:shadow-ds-ring',
          on ? 'border-ds-primary bg-ds-primary-soft' : 'border-transparent hover:bg-ds-surface-hover',
        )}
      >
        {icon}
        <span className={clsx('line-clamp-2 w-full text-ds-body [overflow-wrap:anywhere]', dim ? 'text-ds-fg-muted' : 'text-ds-fg')}>{name}</span>
        {sub && <span className="w-full truncate text-ds-label font-normal text-ds-fg-muted">{sub}</span>}
        {pill}
        {say && <span className="sr-only">{say}</span>}
      </button>
      {(on || tap) && <div className="absolute right-[2px] top-[2px]"><Menu label={menuLabel} iconOnly size="sm" items={menu} /></div>}
    </li>
  );
}

type Handlers = Pick<TileProps, 'on' | 'tabStop' | 'menu' | 'onSelect' | 'onOpen' | 'onContext'>;

function FolderTile({ node, tree, tap, ...rest }: { node: DirectoryNode; tree: DirectoryTree; tap: boolean } & Handlers) {
  const badges = badgesOf(node);
  const total = tree.documentsTotal(node.id);
  const tip = [
    node.name,
    `${node.level_label} · ${node.head ? node.head.name : 'No owner'}`,
    `${countText(total, 'document')}${total > node.counts.documents ? ` (${node.counts.documents} in it, the rest in the folders under it)` : ''} · ${countText(node.counts.members, 'person', 'people')}`,
    ...(node.is_active ? [] : ['Inactive']),
    ...(badges.length ? [`Has its own: ${badges.join(', ')}`] : []),
  ].join('\n');
  return (
    <Tile
      {...rest}
      tap={tap}
      itemKey={unitKey(node.id)}
      item={{ kind: 'unit', id: node.id }}
      icon={<FolderIcon size={48} inactive={!node.is_active} badge={badges.length > 0} title={!node.is_active ? 'Inactive' : badges.length ? `Has its own: ${badges.join(', ')}` : undefined} />}
      name={node.name}
      sub={countText(total, 'document')}
      pill={!node.is_active ? <StatusPill size="sm" tone="neutral" label="Inactive" /> : undefined}
      say={badges.length ? `Has its own ${badges.join(', ')}` : undefined}
      dim={!node.is_active}
      tip={tip}
      menuLabel={`Actions for ${node.name}`}
    />
  );
}

function FileTile({ file, tap, ...rest }: { file: DirFile; tap: boolean } & Handlers) {
  return (
    <Tile
      {...rest}
      tap={tap}
      itemKey={docKey(file.id)}
      item={{ kind: 'doc', id: file.id }}
      icon={<FileIcon size={48} type={file.type} status={file.status} title={file.statusLabel} />}
      name={file.title}
      sub={file.typeLabel}
      say={file.statusLabel}
      tip={fileTip(file)}
      menuLabel={`Actions for ${file.title}`}
    />
  );
}

// ── Details ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface RowProps { on: boolean; tabStop: boolean; tap: boolean; menu: MenuItem[]; onSelect: (key: ItemKey) => void; onOpen: (item: Item) => void; onContext: (e: MouseEvent, item: Item) => void }

/** A click on a row (not on its "⋯", which may sit in a menu drawn outside it) selects it, or with a finger opens it; the name is the row's tab stop, so a long list is one stop, not a hundred. */
const rowClick = (item: Item, tap: boolean, select: (key: ItemKey) => void, open: (item: Item) => void) => (e: MouseEvent<HTMLElement>) => {
  const target = e.target as Element;
  if (!e.currentTarget.contains(target) || target.closest('[data-menu]')) return;
  if (tap) open(item); else select(keyOf(item));
};
const rowDouble = (item: Item, tap: boolean, open: (item: Item) => void) => (e: MouseEvent<HTMLElement>) => {
  const target = e.target as Element;
  if (tap || !e.currentTarget.contains(target) || target.closest('[data-menu]')) return;
  open(item);
};

const NAME_BUTTON = 'flex max-w-full items-center gap-[8px] rounded-ds-control text-left focus-visible:outline-none focus-visible:shadow-ds-ring';

function FolderRow({ node, tree, showDefaults, on, tabStop, tap, menu, onSelect, onOpen, onContext }: RowProps & { node: DirectoryNode; tree: DirectoryTree; showDefaults: boolean }) {
  const kids = tree.childrenOf(node.id).length;
  const total = tree.documentsTotal(node.id);
  const badges = badgesOf(node);
  const item: Item = { kind: 'unit', id: node.id };
  const key = unitKey(node.id);
  return (
    <Tr selected={on} onClickCapture={rowClick(item, tap, onSelect, onOpen)} onDoubleClick={rowDouble(item, tap, onOpen)} onContextMenu={(e) => { e.preventDefault(); onContext(e, item); }} className={clsx(!on && 'hover:!bg-ds-surface-hover')}>
      <RowHeaderCell>
        <button type="button" data-item={key} tabIndex={tabStop ? 0 : -1} className={NAME_BUTTON}>
          <FolderIcon size={20} inactive={!node.is_active} />
          <span className={clsx('min-w-0 font-[600]', node.is_active ? 'text-ds-fg' : 'text-ds-fg-muted')}>{node.name}</span>
          {!node.is_active && <StatusPill size="sm" tone="neutral" label="Inactive" />}
        </button>
      </RowHeaderCell>
      <Td priority={3}>{node.level_label}</Td>
      <Td priority={2}>{node.head ? node.head.name : <span className="text-ds-fg-muted">No owner</span>}</Td>
      <Td priority={3} align="right"><span className="tabular-nums">{node.counts.members}</span></Td>
      <Td priority={2} align="right">
        <span className="tabular-nums" title={total > node.counts.documents ? `${countText(node.counts.documents, 'document')} in it, ${total} with the units below` : undefined}>
          <span className="sr-only">{countText(node.counts.documents, 'document')}{total > node.counts.documents ? `, ${total} with the units below` : ''}</span>
          <span aria-hidden>{node.counts.documents}{total > node.counts.documents ? <span className="text-ds-fg-muted"> / {total}</span> : null}</span>
        </span>
      </Td>
      <Td priority={2} align="right"><span className="tabular-nums">{kids}</span></Td>
      {showDefaults && <Td priority={3}>{badges.length ? <span className="flex flex-wrap gap-[4px]">{badges.map((b) => <span key={b} className={CHIP}>{b}</span>)}</span> : <span className="text-ds-fg-muted">None</span>}</Td>}
      <Td align="right"><span data-menu className="inline-flex">{(on || tap) && <Menu label={`Actions for ${node.name}`} iconOnly size="sm" items={menu} />}</span></Td>
    </Tr>
  );
}

function FileRow({ file, on, tabStop, tap, menu, onSelect, onOpen, onContext }: RowProps & { file: DirFile }) {
  const item: Item = { kind: 'doc', id: file.id };
  const key = docKey(file.id);
  return (
    <Tr selected={on} onClickCapture={rowClick(item, tap, onSelect, onOpen)} onDoubleClick={rowDouble(item, tap, onOpen)} onContextMenu={(e) => { e.preventDefault(); onContext(e, item); }} className={clsx(!on && 'hover:!bg-ds-surface-hover')}>
      <RowHeaderCell>
        <button type="button" data-item={key} tabIndex={tabStop ? 0 : -1} title={fileTip(file)} className={NAME_BUTTON}>
          <FileIcon size={20} type={file.type} />
          <span className="min-w-0 font-[600] text-ds-fg">{file.title}</span>
        </button>
      </RowHeaderCell>
      <Td priority={2}><StatusPill size="sm" {...statusPill(documentStatus, file.status)} /></Td>
      <Td priority={3}>{file.typeLabel}</Td>
      <Td priority={3}><span className="tabular-nums">{file.version}</span></Td>
      <Td priority={2}>{file.owner ?? <span className="text-ds-fg-muted">No owner</span>}</Td>
      <Td priority={3}><span className="tabular-nums">{reviewText(file)}</span></Td>
      <Td align="right"><span data-menu className="inline-flex">{(on || tap) && <Menu label={`Actions for ${file.title}`} iconOnly size="sm" items={menu} />}</span></Td>
    </Tr>
  );
}
