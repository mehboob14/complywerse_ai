'use client';

// The right-hand side of the Directory: the unit you are in (its name, level and facts) and what is in it, the units directly under it, as Icons (tiles) or Details (a table: name,
// level, owner, people, documents, units, and the defaults it defines where those are known). A unit is opened as a popup with a double-click or Enter; a single click only
// marks it, so a double-click is never taken from under the pointer by the contents changing. To go INTO a unit there is the "N units" button on its tile or row, the tree on the
// left, and the path above. On a phone (and in a window narrower than 768px) the contents are a drill-down list of cards: a tap goes into a unit that has units under it and opens
// the popup of one that has none, and the table is not drawn. The tile's "⋯" and a right-click open the same menu. Nothing here changes data.
import { useEffect, useLayoutEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { clsx } from 'clsx';
import { Button, EmptyState, Fact, FactList, Menu, StatusPill, TableFrame, Table, THead, TBody, Tr, Th, Td, RowHeaderCell, type MenuItem } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { MAX_DEPTH } from '@/lib/departments';
import { ACTION_ICON } from './unitMenu';
import { ORGANISATION, badgesOf, countText, libraryHref, summaryOf, type ActionState, type DirectoryNode, type DirectoryTree } from './directoryModel';
import type { ViewId } from './Toolbar';

// measured before the browser paints (a phone never sees the table for a frame); on the server there is nothing to measure
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Whether the window is narrower than 768px: the contents are then a drill-down (the same breakpoint as the kit's tables turning into cards). */
export function useCompact(): boolean {
  const [compact, setCompact] = useState(false);
  useBeforePaint(() => {
    const q = window.matchMedia('(max-width: 767px)');
    const on = () => setCompact(q.matches);
    on();
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return compact;
}

interface Props {
  tree: DirectoryTree;
  current: number | null;
  view: ViewId;
  compact: boolean;
  onGo: (id: number) => void;
  onOpen: (id: number) => void;
  onContext: (e: MouseEvent, id: number) => void;
  menuFor: (id: number) => MenuItem[];
  /** the "New <level>" action of the unit you are in, for the empty state (hidden or absent: no button) */
  newAction?: ActionState;
  onNew: () => void;
}

const CHIP = 'inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] text-ds-label font-normal text-ds-fg-body';

export function Contents({ tree, current, view, compact, onGo, onOpen, onContext, menuFor, newAction, onNew }: Props) {
  const here = current === null ? null : tree.node(current) ?? null;
  const kids = tree.childrenOf(current);
  const sum = summaryOf(tree, current);
  const showDefaults = tree.nodes.some((n) => n.defaults);
  const NewIcon = ACTION_ICON.new;

  return (
    <section aria-labelledby="directory-here" className="flex min-w-0 flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-[6px]">
        <h2 id="directory-here" className="min-w-0 break-words !text-ds-section !text-ds-fg">{here ? here.name : ORGANISATION}</h2>
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

      {kids.length === 0 ? (
        <EmptyState
          kind="firstUse"
          bare
          icon={Folder}
          title={here ? `Nothing under ${here.name}` : 'No departments yet'}
          info={here && here.level >= MAX_DEPTH ? `Units go ${MAX_DEPTH} levels deep, so nothing can be added under a ${here.level_label}.` : undefined}
          action={newAction && !newAction.hidden ? (
            <Button variant="primary" leftIcon={<NewIcon aria-hidden />} disabled={newAction.disabled} title={newAction.reason} onClick={onNew}>{newAction.label}</Button>
          ) : undefined}
        />
      ) : (
        <>
          {view === 'icons' || compact ? (
            <ul aria-label={`Units in ${here ? here.name : ORGANISATION}`} className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[12px] p-0">
              {kids.map((n) => <Tile key={n.id} node={n} tree={tree} compact={compact} onGo={onGo} onOpen={onOpen} onContext={onContext} menu={menuFor(n.id)} />)}
            </ul>
          ) : (
            <TableFrame aria-label={`Units in ${here ? here.name : ORGANISATION}`}>
              <Table caption={`Units in ${here ? here.name : ORGANISATION}`}>
                <THead>
                  <tr>
                    <Th>Name</Th>
                    <Th priority={3}>Level</Th>
                    <Th priority={2}>Owner</Th>
                    <Th priority={3} align="right">People</Th>
                    <Th priority={2} align="right">Documents</Th>
                    <Th priority={2} align="right">Units</Th>
                    {showDefaults && <Th priority={3}>Defaults</Th>}
                    <Th align="right"><span className="sr-only">Actions</span></Th>
                  </tr>
                </THead>
                <TBody>
                  {kids.map((n) => <DetailRow key={n.id} node={n} tree={tree} showDefaults={showDefaults} onGo={onGo} onOpen={onOpen} onContext={onContext} menu={menuFor(n.id)} />)}
                </TBody>
              </Table>
            </TableFrame>
          )}
          <p className="flex items-center gap-[4px] text-ds-label font-normal text-ds-fg-muted">
            {countText(kids.length, 'unit')}
            <InfoTip text="Double-click a unit, or press Enter on it, to open its details. Use “N units” to go into it, or right-click for its menu." label="About opening a unit" />
          </p>
        </>
      )}
    </section>
  );
}

function Tile({ node, tree, compact, onGo, onOpen, onContext, menu }: { node: DirectoryNode; tree: DirectoryTree; compact: boolean; onGo: (id: number) => void; onOpen: (id: number) => void; onContext: (e: MouseEvent, id: number) => void; menu: MenuItem[] }) {
  const kids = tree.childrenOf(node.id).length;
  const badges = badgesOf(node);
  // a phone has no double-click: a tap goes in where there is something in it, else opens the unit
  const press = () => { if (compact) { if (kids > 0) onGo(node.id); else onOpen(node.id); } };
  const key = (e: KeyboardEvent) => { if (!compact && e.key === 'Enter') { e.preventDefault(); onOpen(node.id); } };
  return (
    <li className="relative" onContextMenu={(e) => { e.preventDefault(); onContext(e, node.id); }}>
      <div className="flex h-full flex-col rounded-ds-card border border-ds-border bg-ds-surface focus-within:border-ds-primary hover:bg-ds-surface-hover">
        <button type="button" onClick={press} onDoubleClick={() => { if (!compact) onOpen(node.id); }} onKeyDown={key}
          className="flex min-w-0 flex-1 flex-col items-start gap-[4px] rounded-ds-card p-[12px] pr-[44px] text-left focus:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring">
          <span className="flex max-w-full items-center gap-[8px]">
            <Folder aria-hidden className="h-[20px] w-[20px] shrink-0 text-ds-primary-text" strokeWidth={1.75} />
            <span className={clsx('min-w-0 break-words text-ds-body font-[600]', node.is_active ? 'text-ds-fg' : 'text-ds-fg-muted')}>{node.name}</span>
          </span>
          <span className="text-ds-label font-normal text-ds-fg-muted">{node.level_label} · {node.head ? node.head.name : 'No owner'}</span>
          <span className="text-ds-label font-normal tabular-nums text-ds-fg-muted">{countText(node.counts.documents, 'document')} · {countText(node.counts.members, 'person', 'people')}{compact && kids > 0 ? ` · ${countText(kids, 'unit')}` : ''}</span>
          {(!node.is_active || badges.length > 0) && (
            <span className="mt-[2px] flex flex-wrap gap-[4px]">
              {!node.is_active && <StatusPill size="sm" tone="neutral" label="Inactive" />}
              {badges.map((b) => <span key={b} className={CHIP}>{b}</span>)}
            </span>
          )}
        </button>
        {!compact && kids > 0 && (
          <div className="border-t border-ds-border px-[8px] py-[4px]">
            <Button size="sm" variant="ghost" rightIcon={<ChevronRight aria-hidden />} aria-label={`Open ${node.name}: ${countText(kids, 'unit')}`} onClick={() => onGo(node.id)}>{countText(kids, 'unit')}</Button>
          </div>
        )}
      </div>
      <div className="absolute right-[4px] top-[4px]"><Menu label={`Actions for ${node.name}`} iconOnly items={menu} /></div>
    </li>
  );
}

function DetailRow({ node, tree, showDefaults, onGo, onOpen, onContext, menu }: { node: DirectoryNode; tree: DirectoryTree; showDefaults: boolean; onGo: (id: number) => void; onOpen: (id: number) => void; onContext: (e: MouseEvent, id: number) => void; menu: MenuItem[] }) {
  const kids = tree.childrenOf(node.id).length;
  const total = tree.documentsTotal(node.id);
  const badges = badgesOf(node);
  return (
    <Tr onDoubleClick={() => onOpen(node.id)} onContextMenu={(e) => { e.preventDefault(); onContext(e, node.id); }} className="focus-within:!bg-ds-primary-soft">
      <RowHeaderCell>
        <button type="button" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onOpen(node.id); } }}
          className="flex max-w-full items-center gap-[8px] rounded-ds-control text-left focus-visible:outline-none focus-visible:shadow-ds-ring">
          <Folder aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-primary-text" strokeWidth={1.75} />
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
      <Td priority={2} align="right">
        {kids > 0
          ? <Button size="sm" variant="ghost" rightIcon={<FolderOpen aria-hidden />} aria-label={`Open ${node.name}: ${countText(kids, 'unit')}`} onClick={() => onGo(node.id)}>{kids}</Button>
          : <span className="tabular-nums text-ds-fg-muted">0</span>}
      </Td>
      {showDefaults && <Td priority={3}>{badges.length ? <span className="flex flex-wrap gap-[4px]">{badges.map((b) => <span key={b} className={CHIP}>{b}</span>)}</span> : <span className="text-ds-fg-muted">None</span>}</Td>}
      <Td align="right"><Menu label={`Actions for ${node.name}`} iconOnly size="sm" items={menu} /></Td>
    </Tr>
  );
}
