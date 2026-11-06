'use client';

// The facet rail of a record explorer: one group for each dimension (the kit's Disclosure: its name, how many are chosen in it, a chevron), each with its options, the number
// of records the option would show beside it (live: records/facetEngine.ts), a zero kept and dimmed so a group with nothing says so, a search box in a long group and "Show N more"
// for a long one. The same body is the phone's filter sheet. It draws what it is given and asks the page to change the choice; it knows no module.
import { useState } from 'react';
import { clsx } from 'clsx';
import { Button, Checkbox, Disclosure, TextInput } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { shownOptions } from './explorerModel';

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
}

const SEARCH_FROM = 7;

function Group({ group, onToggle, onClear }: { group: FacetGroupView; onToggle: FacetRailProps['onToggle']; onClear: FacetRailProps['onClear'] }) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const q = query.trim().toLowerCase();
  const found = q ? group.options.filter((o) => o.label.toLowerCase().includes(q) || (o.title ?? '').toLowerCase().includes(q)) : group.options;
  const { shown, hidden } = shownOptions(found, group.limit, expanded, q.length > 0, group.options.filter((o) => o.checked).map((o) => o.value));
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
  return (
    <Disclosure label={group.label} count={group.chosen} defaultOpen={group.defaultOpen} search={search} region={false} level={3}>
      <ul className="m-0 list-none p-0" aria-label={group.label}>
        {shown.map((o) => (
          <li key={o.value}>
            <label
              title={o.title}
              className={clsx(
                'flex min-h-ds-control cursor-pointer items-center gap-[8px] rounded-ds-control px-[8px] text-ds-body hover:bg-ds-surface-hover',
                o.checked ? 'bg-ds-primary-soft font-[600] text-ds-primary-text' : o.count === 0 ? 'text-ds-fg-muted' : 'text-ds-fg-body',
              )}
              style={o.indent ? { paddingLeft: 8 + o.indent * 14 } : undefined}
            >
              <Checkbox aria-label={`${o.label}, ${formatCount(o.count)}`} checked={o.checked} onChange={() => onToggle(group.key, o.value)} />
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{o.label}</span>
              <span aria-hidden className={clsx('shrink-0 text-ds-label tabular-nums', o.checked ? 'text-ds-primary-text' : 'text-ds-fg-muted')}>{formatCount(o.count)}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="px-[8px] py-[6px] text-ds-label text-ds-fg-muted">Nothing matches</li>}
      </ul>
      {(hidden > 0 || (expanded && group.limit != null && group.options.length > group.limit)) && !q && (
        <div className="px-[8px] pb-[4px]">
          <Button variant="link" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer' : `Show ${hidden} more`}</Button>
        </div>
      )}
      {group.chosen > 0 && (
        <div className="px-[8px] pb-[4px]">
          <Button variant="link" size="sm" onClick={() => onClear(group.key)}>{`Clear ${group.label.toLowerCase()}`}</Button>
        </div>
      )}
    </Disclosure>
  );
}

export function FacetRail({ groups, onToggle, onClear, idPrefix }: FacetRailProps) {
  return (
    <div data-facet-rail={idPrefix} className="min-w-0">
      {groups.map((g) => <Group key={`${idPrefix}-${g.key}`} group={g} onToggle={onToggle} onClear={onClear} />)}
    </div>
  );
}
