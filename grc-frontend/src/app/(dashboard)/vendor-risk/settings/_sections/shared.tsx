'use client';

// What the sections of Settings share: the page's state handed down (the draft, what it is compared with, the defaults, who may change it) and the button that puts a part back to its defaults.
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/ds';
import type { Directory } from '../_ui';
import type { ConfigResp, Draft, DraftKey } from '../settingsModel';

export interface SettingsCtx {
  data: ConfigResp;
  draft: Draft;
  saved: Draft;
  defaults: Draft;
  canEdit: boolean;
  directory?: Directory;
  set: <K extends DraftKey>(key: K, value: Draft[K]) => void;
  setMany: (patch: Partial<Draft>) => void;
  /** every key whose value is not what is saved */
  dirty: readonly DraftKey[];
}

/** "Use the defaults" for the part that owns `keys`: only offered to a person who may change it, and only while the part is not already at them. */
export function DefaultsButton({ ctx, keys }: { ctx: SettingsCtx; keys: readonly DraftKey[] }) {
  if (!ctx.canEdit || !keys.length) return null;
  const same = keys.every((k) => JSON.stringify(ctx.draft[k]) === JSON.stringify(ctx.defaults[k]));
  if (same) return null;
  return (
    <Button size="sm" variant="ghost" leftIcon={<RotateCcw aria-hidden />} onClick={() => ctx.setMany(Object.fromEntries(keys.map((k) => [k, JSON.parse(JSON.stringify(ctx.defaults[k]))])) as Partial<Draft>)}>
      Use the defaults
    </Button>
  );
}

/** A small pill that says a part holds changes that are not saved. */
export function UnsavedPill() {
  return <span className="rounded-full bg-ds-warning-soft px-[8px] text-ds-label font-[600] text-ds-warning">Unsaved</span>;
}

/** Said under a setting nobody may change here: in words, never the name of a permission. */
export const NEEDS_RIGHT = 'Changing this needs permission to configure Vendor Risk.';
