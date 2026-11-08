'use client';

// The permission matrix as a grid of real checkboxes (G12 pattern 3): the modules down the left with how many of each a role holds, and, for the module on screen, one
// row per area with View, Create, Edit and Delete as columns and every other action in "Other". A tick at the head of a column or at the start of a row takes the
// whole column or row; nothing here touches a name it does not show (the names a role holds outside the catalogue are kept by rolesModel.setNames). Below 1024px the
// module list is a select, below 768px each area is a block of labelled boxes. All of it is reachable by keyboard: Tab through the boxes, Space to tick.
// Rules and words: lib/people/rolesModel.ts.
import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Checkbox, EmptyState, Select } from '@/components/ui/ds';
import {
  GRID_ACTIONS, actionLabel, columnNames, filterMatrix, namesOfModule, namesOfSub, otherActions, permName, setNames, tally,
  type CatalogueModule, type CatalogueSub, type MatrixFilter,
} from '@/lib/people/rolesModel';

const CELL = 'border-b border-ds-border px-[8px] align-middle !text-ds-body [&&]:!py-[0px]';
const HEAD = 'whitespace-nowrap border-b border-ds-border !bg-ds-surface-subtle px-[8px] align-middle !text-ds-label font-normal !text-ds-fg-muted [&&]:!py-[0px]';

export interface PermissionGridProps {
  matrix: readonly CatalogueModule[];
  held: readonly string[];
  readOnly: boolean;
  filter: MatrixFilter;
  onChange: (next: string[]) => void;
}

/** A big tick area (the box is 16px; the label around it is the target) for a box with no words beside it. */
function Tick({ name, on, some = false, disabled, onToggle }: { name: string; on: boolean; some?: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <label className={clsx('grid h-ds-control min-w-[44px] place-items-center', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
      <Checkbox aria-label={name} checked={on} indeterminate={some && !on} disabled={disabled} onChange={onToggle} />
    </label>
  );
}

export function PermissionGrid({ matrix, held, readOnly, filter, onChange }: PermissionGridProps) {
  const heldSet = useMemo(() => new Set(held), [held]);
  const shown = useMemo(() => filterMatrix(matrix, filter, heldSet), [matrix, filter, heldSet]);
  const [picked, setPicked] = useState<string>(matrix[0]?.module ?? '');
  // the module on screen: the one picked, else the first that still has rows (a search can empty the one picked)
  const current = shown.find((m) => m.module === picked) ?? shown[0] ?? null;
  useEffect(() => { if (current && current.module !== picked) setPicked(current.module); }, [current, picked]);
  const whole = (module: string) => matrix.find((m) => m.module === module) as CatalogueModule;

  if (!current) {
    return <EmptyState bare kind="noMatches" title="No permission matches" description="Try other words, or untick Granted only." />;
  }

  const flip = (names: readonly string[], on: boolean) => onChange(setNames(held as string[], names, on));
  const toggleOne = (name: string) => flip([name], !heldSet.has(name));
  const toggleGroup = (names: readonly string[]) => flip(names, tally(names, heldSet).state !== 'all');
  const moduleTally = (m: CatalogueModule) => tally(namesOfModule(whole(m.module)), heldSet);

  const rail = (
    <nav aria-label="Modules" className="hidden lg:block">
      <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
        {shown.map((m) => {
          const t = moduleTally(m);
          const on = m.module === current.module;
          return (
            <li key={m.module}>
              <button
                type="button" aria-current={on ? 'true' : undefined} onClick={() => setPicked(m.module)}
                className={clsx('flex min-h-ds-control w-full items-center justify-between gap-[8px] rounded-ds-control px-[8px] text-left text-ds-body focus-visible:outline-none focus-visible:shadow-ds-ring',
                  on ? 'bg-ds-primary-soft font-[600] text-ds-primary-text' : 'text-ds-fg hover:bg-ds-surface-hover')}
              >
                <span className="min-w-0 truncate">{m.display_name}</span>
                <span className={clsx('shrink-0 tabular-nums text-ds-label', t.granted > 0 ? 'font-[600]' : 'text-ds-fg-muted')}>{t.granted}/{t.total}<span className="sr-only"> granted</span></span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  const select = (
    <Select aria-label="Module" className="lg:hidden" value={current.module} onChange={(e) => setPicked(e.target.value)}>
      {shown.map((m) => { const t = moduleTally(m); return <option key={m.module} value={m.module}>{m.display_name} ({t.granted} of {t.total})</option>; })}
    </Select>
  );

  const rowTitle = (s: CatalogueSub) => s.display_name;
  const t = moduleTally(current);

  return (
    <div className="grid gap-[12px] lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-[16px]">
      <div className="min-w-0">{rail}{select}</div>
      <div className="min-w-0">
        <div className="mb-[8px] flex flex-wrap items-center justify-between gap-[8px]">
          <p className="text-ds-body font-[600] text-ds-fg">{current.display_name}<span className="ml-[8px] font-normal text-ds-fg-muted">{t.granted} of {t.total} granted</span></p>
          <Checkbox
            label={`All of ${current.display_name}`} disabled={readOnly} checked={t.state === 'all'} indeterminate={t.state === 'some'}
            onChange={() => flip(namesOfModule(whole(current.module)), t.state !== 'all')}
          />
        </div>

        {/* from 768px: the grid */}
        <div className="hidden overflow-x-auto rounded-ds-card border border-ds-border bg-ds-surface md:block">
          <table className="w-full !border-separate border-spacing-0 text-left">
            <caption className="sr-only">Permissions of {current.display_name}: one row per area, one column per action</caption>
            <thead>
              <tr>
                <th scope="col" className={clsx(HEAD, 'min-w-[160px]')}>Area</th>
                <th scope="col" className={clsx(HEAD, 'text-center')}>All</th>
                {GRID_ACTIONS.map((action) => {
                  const names = columnNames(current, action);
                  const ct = tally(names, heldSet);
                  return (
                    <th key={action} scope="col" className={clsx(HEAD, 'text-center')}>
                      <span className="flex items-center justify-center">
                        <span className="mr-[2px]">{actionLabel(action)}</span>
                        {names.length > 0 && <Tick name={`${actionLabel(action)} for every area of ${current.display_name}`} on={ct.state === 'all'} some={ct.state === 'some'} disabled={readOnly} onToggle={() => toggleGroup(names)} />}
                      </span>
                    </th>
                  );
                })}
                <th scope="col" className={clsx(HEAD, 'min-w-[160px]')}>Other</th>
              </tr>
            </thead>
            <tbody>
              {current.submodules.map((s) => {
                const names = namesOfSub(current.module, s);
                const rt = tally(names, heldSet);
                return (
                  <tr key={s.name}>
                    <th scope="row" className={clsx(CELL, 'py-[6px] text-left !text-ds-body font-normal !text-ds-fg')}>{rowTitle(s)}</th>
                    <td className={clsx(CELL, 'text-center')}>
                      <Tick name={`Every permission of ${s.display_name}`} on={rt.state === 'all'} some={rt.state === 'some'} disabled={readOnly} onToggle={() => toggleGroup(names)} />
                    </td>
                    {GRID_ACTIONS.map((action) => {
                      const name = permName(current.module, s.name, action);
                      return (
                        <td key={action} className={clsx(CELL, 'text-center')}>
                          {s.actions.indexOf(action) >= 0
                            ? <Tick name={`${actionLabel(action)} ${s.display_name}`} on={heldSet.has(name)} disabled={readOnly} onToggle={() => toggleOne(name)} />
                            : <span aria-hidden className="text-ds-body text-ds-fg-muted">—</span>}
                        </td>
                      );
                    })}
                    <td className={clsx(CELL, 'py-[4px]')}>
                      <div className="flex flex-wrap gap-x-[12px]">
                        {otherActions(s).map((action) => {
                          const name = permName(current.module, s.name, action);
                          return <Checkbox key={action} label={actionLabel(action)} aria-label={`${actionLabel(action)} ${s.display_name}`} checked={heldSet.has(name)} disabled={readOnly} onChange={() => toggleOne(name)} />;
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* below 768px: a block per area */}
        <ul className="m-0 flex list-none flex-col gap-[8px] p-0 md:hidden">
          {current.submodules.map((s) => {
            const names = namesOfSub(current.module, s);
            const rt = tally(names, heldSet);
            return (
              <li key={s.name} className="rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[4px]">
                <p className="pt-[8px] text-ds-body font-[600] text-ds-fg">{s.display_name}</p>
                <Checkbox label="Every permission here" disabled={readOnly} checked={rt.state === 'all'} indeterminate={rt.state === 'some'} onChange={() => toggleGroup(names)} />
                <div className="flex flex-col pb-[4px]">
                  {s.actions.map((action) => {
                    const name = permName(current.module, s.name, action);
                    return <Checkbox key={action} label={actionLabel(action)} aria-label={`${actionLabel(action)} ${s.display_name}`} checked={heldSet.has(name)} disabled={readOnly} onChange={() => toggleOne(name)} />;
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
