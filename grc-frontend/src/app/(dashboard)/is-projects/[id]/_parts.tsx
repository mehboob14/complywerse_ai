'use client';

// What the tabs of a project share: the handlers the page gives them, the state of a tab that loads its own list, a row's "Actions" menu, the AI button, the box
// that changes a percent only when the person has finished typing it, and the card and chip looks. Only the --ds tokens and arbitrary values (kit rules).
import { useEffect, useState, type ReactNode } from 'react';
import { Pencil, Sparkles, Trash2 } from 'lucide-react';
import { Button, ErrorState, Menu, Select, Skeleton, TextInput, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { truncate } from '@/lib/format';
import type { RecordKind } from '../_model';

export type AiKey = 'generate-plan' | 'assess-risks' | 'draft-status-report' | 'suggest-team' | 'estimate-budget';
export type EditableKind = 'budget' | 'compliance' | 'lesson' | 'dependency';

/** What a tab can ask the page to do. The page owns every request (and its report); a tab only says what the person asked for. */
export interface Handlers {
  add: (kind: RecordKind) => void;
  edit: (kind: EditableKind, item: object) => void;
  /** asks first, then deletes: `label` names the record in the question */
  remove: (kind: RecordKind, id: number, label: string) => void;
  ai: (key: AiKey) => void;
  /** the AI action that is running, if any */
  aiBusy: string | null;
  /** inline changes: they resolve when the server has answered (and reject when it refused), so a box can wait for it */
  change: { milestone: (id: number, data: Record<string, unknown>) => Promise<unknown>; task: (id: number, data: Record<string, unknown>) => Promise<unknown>; risk: (id: number, data: Record<string, unknown>) => Promise<unknown> };
  download: (id: number, fileName?: string) => void;
}

export const CARD = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
export const CHIP = 'inline-flex max-w-full items-center rounded-full border border-ds-border bg-ds-surface-subtle px-[8px] py-[1px] text-ds-label text-ds-fg-body';
export const MUTED = 'text-ds-label text-ds-fg-muted';

/** The "Actions for <record>" menu of a row or card: its own items first, then Edit (when the record has an edit form), then Delete. */
export function RowMenu({ label, onEdit, onDelete, extra = [], deleteLabel = 'Delete' }: { label: string; onEdit?: () => void; onDelete: () => void; extra?: MenuItem[]; deleteLabel?: string }) {
  const items: MenuItem[] = [
    ...extra,
    ...(onEdit ? [{ key: 'edit', label: 'Edit', icon: Pencil, onSelect: onEdit }] : []),
    { key: 'delete', label: deleteLabel, icon: Trash2, danger: true, onSelect: onDelete },
  ];
  return <Menu label={`Actions for ${truncate(label, 60).text}`} iconOnly items={items} />;
}

/** A button that asks the AI for something; it shows its own spinner while it runs and the others wait. */
export function AiButton({ h, ai, children, fullWidth }: { h: Handlers; ai: AiKey; children: ReactNode; fullWidth?: boolean }) {
  return (
    <Button leftIcon={<Sparkles aria-hidden />} fullWidth={fullWidth} loading={h.aiBusy === ai} disabled={!!h.aiBusy && h.aiBusy !== ai} onClick={() => h.ai(ai)}>{children}</Button>
  );
}

/** A tab that loads its own list: a skeleton while it loads, the server's words and Retry when it failed (the old tabs read a failure as "none yet"), else its content. */
export function LoadState({ q, noun, children }: { q: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown; data: unknown }; noun: string; children: ReactNode }) {
  if (q.isLoading) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-[8px]">
        <span className="sr-only">{`Loading the ${noun}`}</span>
        <Skeleton className="h-[40px] w-full" /><Skeleton className="h-[40px] w-full" /><Skeleton className="h-[40px] w-full" />
      </div>
    );
  }
  if (q.isError && q.data === undefined) {
    return <ErrorState compact title={`Couldn't load the ${noun}`} message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
  }
  return <>{children}</>;
}

/** A whole percent that is changed in place (a milestone's completion, a task's progress). Typing changes nothing on the server; leaving the box or pressing Enter
 *  saves it once (the old boxes saved on every keystroke and the slider on every tick). Until the server answers the box shows what was typed; a refusal puts the
 *  stored value back (the page says why). An empty or out-of-range box is put back too. */
export function PercentBox({ value, label, onCommit, className }: { value: number; label?: string; onCommit: (n: number) => Promise<unknown>; className?: string }) {
  const stored = String(Math.round(Number.isFinite(value) ? value : 0));
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => { setDraft(null); }, [stored]);                 // the server's number arrived: it is the truth again
  const commit = () => {
    if (draft === null) return;
    const n = Number.parseInt(draft, 10);
    if (!Number.isFinite(n) || n < 0 || n > 100 || String(n) === stored) { setDraft(null); return; }
    onCommit(n).catch(() => setDraft(null));
  };
  return (
    <TextInput
      type="number"
      inputMode="numeric"
      min={0}
      max={100}
      unit="%"
      aria-label={label}
      className={className ?? 'w-[104px]'}
      value={draft ?? stored}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
    />
  );
}

/** A value changed in place: it shows what was picked until the server's own value arrives (or the change is refused and the stored one is put back). */
function usePending<T>(stored: T): [T, (next: T, save: () => Promise<unknown>) => void] {
  const [draft, setDraft] = useState<{ v: T } | null>(null);
  useEffect(() => { setDraft(null); }, [stored]);
  return [draft ? draft.v : stored, (next, save) => { setDraft({ v: next }); save().catch(() => setDraft(null)); }];
}

/** A select that saves when a choice is made (a task's status, a risk's status). A stored word the list does not offer ("Not Started") is listed too, so the box
 *  never shows a choice that was not made. */
export function InlineSelect({ value, options, label, onSave, className }: { value: string; options: readonly string[]; label: string; onSave: (value: string) => Promise<unknown>; className?: string }) {
  const [shown, pick] = usePending(value);
  const list = options.indexOf(value) >= 0 ? options : [value, ...options];
  return (
    <Select aria-label={label} className={className} value={shown} onChange={(e) => { const next = e.target.value; pick(next, () => onSave(next)); }}>
      {list.map((o) => <option key={o} value={o}>{o}</option>)}
    </Select>
  );
}

/** A label and its value on one line (key details, budget). */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-[12px]">
      <dt className="shrink-0 text-ds-body text-ds-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
