'use client';

/**
 * Assets chosen from the asset library (asset_refs, and org_pick of systems): the chosen ones as a list with a Remove on each, and an Add button that opens
 * the library's search (the scoping screens' AssetPicker) under them. The value is the list of asset ids; the names come from `refs.assets`, and a pick tells
 * the page its name (`onRefs`) so it shows before the next read. An asset that no longer exists reads "Removed asset", never its id.
 */
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, StatusPill } from '@/components/ui/ds';
import { AssetPicker } from '../../scoping/AssetPicker';
import type { FieldInputProps } from '@/lib/frameworkOnboarding';
import { toggleId } from '../fieldModel';

const ROW = 'flex items-center gap-[8px] rounded-ds-control border border-ds-border bg-ds-surface py-[2px] pl-[10px] pr-[2px]';
const REMOVE = 'grid h-[28px] w-[28px] shrink-0 place-items-center rounded-ds-control text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:w-[44px]';
const word = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '');

export default function AssetsInput({ id, label, value, onChange, refs, onRefs, readOnly = false }: Pick<FieldInputProps, 'id' | 'value' | 'onChange' | 'refs' | 'onRefs' | 'readOnly'> & { id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const ids = (Array.isArray(value) ? value : []).map(Number).filter((n) => Number.isFinite(n));
  const panel = `${id}-picker`;

  return (
    <div className="space-y-[8px]">
      {ids.length > 0 && (
        <ul aria-label={label} className="space-y-[4px]">
          {ids.map((n) => {
            const known = refs.assets?.[String(n)];
            const name = known?.name ?? 'Removed asset';
            return (
              <li key={n} className={ROW}>
                <span className="min-w-0 flex-1 break-words text-ds-body text-ds-fg">{name}</span>
                {known?.asset_type && <StatusPill tone="neutral" size="sm" label={word(known.asset_type)} />}
                {!readOnly && (
                  <button type="button" aria-label={`Remove ${name}`} title="Remove" className={REMOVE} onClick={() => onChange(toggleId(ids, n, false))}>
                    <X aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {ids.length === 0 && readOnly && <span className="block text-ds-body text-ds-fg-muted">None chosen</span>}
      {!readOnly && (
        <>
          <Button id={`${id}-add`} size="sm" leftIcon={<Plus aria-hidden />} aria-expanded={open} aria-controls={open ? panel : undefined} onClick={() => setOpen((o) => !o)}>
            {open ? 'Done' : 'Add asset'}
          </Button>
          {open && (
            <div id={panel} className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[10px]">
              <AssetPicker
                autoFocus
                label="Search assets"
                exclude={ids}
                onPick={(a) => {
                  onRefs?.({ assets: { [String(a.id)]: { name: a.name, asset_type: a.asset_type, criticality: a.criticality } } });
                  onChange(toggleId(ids, a.id, true));
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
