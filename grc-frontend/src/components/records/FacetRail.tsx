'use client';

// The facet rail of a record explorer: one group for each dimension (the kit's Disclosure: its name, how many are chosen in it, a chevron), each with its options, the number
// of records the option would show beside it (live: records/facetEngine.ts), a zero kept and dimmed so a group with nothing says so, a search box in a long group and "Show N more"
// for a long one. The same body is the phone's filter sheet. It draws what it is given and asks the page to change the choice; it knows no module.
// The body of ONE group (FacetGroupBody: search, options, "Show N more", "Clear ...") is shared: the rail wraps it in a Disclosure, the top filter bar (TopFilterBar) in a panel. With
// `nested` an indented list (the departments) is a tree: a parent has a button that opens and shuts what is under it, and a chosen option opens the branches above it.
import { useEffect, useId, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import { Button, Checkbox, Disclosure, IconButton, TextInput } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { ancestorValues, optionTree, pathAbove, shownOptions, type OptionNode } from './explorerModel';

export interface FacetOptionView {
  value: string;
  label: string;
  /** the records choosing it would show */
  count: number;
  checked: boolean;
  /** levels of indentation (a tree such as the departments) */
  indent?: number;
  /** the whole name when the label is cut */
  title?: string;
}

export interface FacetGroupView {
  key: string;
  label: string;
  /** in the order to draw them */
  options: FacetOptionView[];
  /** how many are chosen in the group */
  chosen: number;
  /** a search box above the options of a long group */
  searchable?: boolean;
  /** options shown before "Show N more" */
  limit?: number;
  defaultOpen?: boolean;
}

export interface FacetRailProps {
  groups: FacetGroupView[];
  onToggle: (group: string, value: string) => void;
  onClear: (group: string) => void;
  /** makes the ids of the controls unique when the rail is drawn twice (the page's rail and the phone's sheet) */
  idPrefix: string;
  /** an indented group is a tree that opens and shuts (the top filter bar's sheet); off, it is the flat, indented list the side rail has always drawn */
  nested?: boolean;
}

interface BodyProps {
  group: FacetGroupView;
  onToggle: FacetRailProps['onToggle'];
  onClear: FacetRailProps['onClear'];
  nested?: boolean;
}

const SEARCH_FROM = 7;

/** One option: its box, its name, the number it would show. `indent` is the flat list's indentation (px); `path` the whole name under it, for a hit that is out of its tree. */
function OptionRow({ group, o, indent, path, beside, onToggle }: { group: string; o: FacetOptionView; indent?: number; path?: string; beside?: boolean; onToggle: BodyProps['onToggle'] }) {
  return (
    <label
      title={o.title}
      className={clsx(
        'flex min-h-ds-control cursor-pointer items-center gap-[8px] rounded-ds-control px-[8px] text-ds-body hover:bg-ds-surface-hover',
        beside && 'min-w-0 flex-1',                                                    // in a tree's row, beside the button that opens the branch
        o.checked ? 'bg-ds-primary-soft font-[600] text-ds-primary-text' : o.count === 0 ? 'text-ds-fg-muted' : 'text-ds-fg-body',
      )}
      style={indent ? { paddingLeft: 8 + indent * 14 } : undefined}
    >
      <Checkbox aria-label={`${o.label}, ${formatCount(o.count)}`} checked={o.checked} onChange={() => onToggle(group, o.value)} />
      <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
        {o.label}
        {path && <span className={clsx('block text-ds-label font-normal', o.checked ? 'text-ds-primary-text' : 'text-ds-fg-muted')}>{path}</span>}
      </span>
      <span aria-hidden className={clsx('shrink-0 text-ds-label tabular-nums', o.checked ? 'text-ds-primary-text' : 'text-ds-fg-muted')}>{formatCount(o.count)}</span>
    </label>
  );
}

/** The branches of a tree: every option under `parent` (-1: the top ones), a parent with a button that says whether it is open and what it controls. */
function Branches({ nodes, parent, group, title, open, onOpen, onToggle, uid }: {
  nodes: OptionNode<FacetOptionView>[];
  parent: number;
  group: string;
  /** names the list of the top options (the group's name) */
  title: string;
  open: ReadonlySet<string>;
  onOpen: (value: string, on: boolean) => void;
  onToggle: BodyProps['onToggle'];
  uid: string;
}) {
  const here = parent < 0 ? nodes.map((n, i) => (n.parent < 0 ? i : -1)).filter((i) => i >= 0) : nodes[parent].children;
  return (
    <ul className={clsx('m-0 list-none p-0', parent >= 0 && 'pl-[16px]')} {...(parent >= 0 ? { id: `${uid}-${parent}`, 'aria-label': `Under ${nodes[parent].option.label}` } : { 'aria-label': title })}>
      {here.map((i) => {
        const n = nodes[i];
        const o = n.option;
        const shown = open.has(o.value);
        return (
          <li key={o.value}>
            <div className="flex min-w-0 items-center">
              {n.children.length > 0 ? (
                <IconButton
                  label={`${shown ? 'Collapse' : 'Expand'} ${o.label}`}
                  aria-expanded={shown}
                  aria-controls={shown ? `${uid}-${i}` : undefined}
                  onClick={() => onOpen(o.value, !shown)}
                  className="shrink-0"
                >
                  <ChevronRight aria-hidden className={clsx('transition-transform', shown && 'rotate-90')} />
                </IconButton>
              ) : (
                <span aria-hidden className="w-[var(--ds-control-h)] shrink-0" />
              )}
              <OptionRow group={group} o={o} beside onToggle={onToggle} />
            </div>
            {n.children.length > 0 && shown && <Branches nodes={nodes} parent={i} group={group} title={title} open={open} onOpen={onOpen} onToggle={onToggle} uid={uid} />}
          </li>
        );
      })}
    </ul>
  );
}

/** The body of one group, in the rail's Disclosure or the top bar's panel: the search of a long group, the options (a tree when `nested` and the group is indented), "Show N more", "Clear ...". */
export function FacetGroupBody({ group, onToggle, onClear, nested = false }: BodyProps) {
  const uid = useId();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const q = query.trim().toLowerCase();
  const found = q ? group.options.filter((o) => o.label.toLowerCase().includes(q) || (o.title ?? '').toLowerCase().includes(q)) : group.options;
  const asTree = nested && group.options.some((o) => (o.indent ?? 0) > 0);
  const { shown, hidden } = shownOptions(found, asTree ? undefined : group.limit, expanded, q.length > 0, group.options.filter((o) => o.checked).map((o) => o.value));
  const search = group.searchable && group.options.length >= SEARCH_FROM ? (
    <TextInput
      type="search"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder={`Find ${group.label.toLowerCase()}`}
      aria-label={`Find ${group.label.toLowerCase()}`}
      autoComplete="off"
    />
  ) : undefined;

  // the tree: what is open is the person's choice, and a chosen option opens the branches above it (when the choice changes, e.g. from a chip or the address, as much as at the start)
  const nodes = useMemo(() => (asTree ? optionTree(group.options) : []), [asTree, group.options]);
  const chosenValues = group.options.filter((o) => o.checked).map((o) => o.value);
  const chosenKey = chosenValues.join('\u0001');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => (asTree ? ancestorValues(nodes, chosenValues) : new Set<string>()));
  useEffect(() => {
    if (!asTree) return;
    const need = ancestorValues(nodes, chosenValues);
    setOpen((was) => (Array.from(need).every((v) => was.has(v)) ? was : new Set([...Array.from(was), ...Array.from(need)])));
  }, [asTree, chosenKey]);                                                                              // eslint-disable-line react-hooks/exhaustive-deps
  const setBranch = (value: string, on: boolean) => setOpen((was) => { const next = new Set(was); if (on) next.add(value); else next.delete(value); return next; });

  return (
    <>
      {search && <div className="px-[8px] pb-[4px] pt-[2px]">{search}</div>}
      {asTree && !q ? (
        <Branches nodes={nodes} parent={-1} group={group.key} title={group.label} open={open} onOpen={setBranch} onToggle={onToggle} uid={uid} />
      ) : (
        <ul className="m-0 list-none p-0" aria-label={group.label}>
          {shown.map((o) => (
            <li key={o.value}>
              {/* a tree's hits are out of their tree: no indent, the whole name under theirs */}
              <OptionRow group={group.key} o={o} indent={asTree ? undefined : o.indent} path={asTree ? pathAbove(o.title, o.label) || undefined : undefined} onToggle={onToggle} />
            </li>
          ))}
          {shown.length === 0 && <li className="px-[8px] py-[6px] text-ds-label text-ds-fg-muted">Nothing matches</li>}
        </ul>
      )}
      {(hidden > 0 || (expanded && group.limit != null && !asTree && group.options.length > group.limit)) && !q && (
        <div className="px-[8px] pb-[4px]">
          <Button variant="link" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer' : `Show ${hidden} more`}</Button>
        </div>
      )}
      {group.chosen > 0 && (
        <div className="px-[8px] pb-[4px]">
          <Button variant="link" size="sm" onClick={() => onClear(group.key)}>{`Clear ${group.label.toLowerCase()}`}</Button>
        </div>
      )}
    </>
  );
}

function Group({ group, onToggle, onClear, nested }: BodyProps) {
  return (
    <Disclosure label={group.label} count={group.chosen} defaultOpen={group.defaultOpen} region={false} level={3}>
      <FacetGroupBody group={group} onToggle={onToggle} onClear={onClear} nested={nested} />
    </Disclosure>
  );
}

export function FacetRail({ groups, onToggle, onClear, idPrefix, nested }: FacetRailProps) {
  return (
    <div data-facet-rail={idPrefix} className="min-w-0">
      {groups.map((g) => <Group key={`${idPrefix}-${g.key}`} group={g} onToggle={onToggle} onClear={onClear} nested={nested} />)}
    </div>
  );
}
