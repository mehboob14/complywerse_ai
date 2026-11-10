'use client';

// Interactive per-stage task checklist — the "steps I can do" surface rendered on
// every lifecycle stage. Seeds from the stage's canonical activities the first
// time, then persists the whole array via PUT .../stages/{key}/checklist. Analysts
// can check items off, add their own, jot a note, and delete. Progress is shown
// inline so a stage stops being static text and becomes trackable work.

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Square, Plus, Trash2, Loader2, ListChecks, MessageSquarePlus } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import type { ChecklistItem } from './types';

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function StageChecklist({
  assessmentId, stageKey, activities, initial,
}: {
  assessmentId: number;
  stageKey: string;
  activities: string[];
  initial?: ChecklistItem[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');

  // Seed from the stage's activities the first time (nothing saved yet).
  const seeded = useMemo<ChecklistItem[]>(() => {
    if (initial && initial.length) return initial;
    return activities.map((a) => ({ text: a, done: false }));
  }, [initial, activities]);

  const [items, setItems] = useState<ChecklistItem[]>(seeded);
  const [newText, setNewText] = useState('');
  const [noteOpen, setNoteOpen] = useState<number | null>(null);

  const save = useMutation({
    mutationFn: (next: ChecklistItem[]) => tpraApi.saveChecklist(assessmentId, stageKey, next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] }),
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errMsg(e, 'Try again.') }),
  });

  // Optimistic local update + persist the full array.
  const commit = (next: ChecklistItem[]) => { setItems(next); save.mutate(next); };

  const toggle = (i: number) => commit(items.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)));
  const remove = (i: number) => commit(items.filter((_, idx) => idx !== i));
  const setNote = (i: number, note: string) => setItems(items.map((it, idx) => (idx === i ? { ...it, note } : it)));
  const add = () => {
    const t = newText.trim();
    if (!t) return;
    setNewText('');
    commit([...items, { text: t, done: false }]);
  };

  const doneCount = items.filter((it) => it.done).length;
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;

  return (
    <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[12px] font-[600] text-ds-fg">
          <ListChecks className="h-4 w-4 text-ds-primary-text" /> Stage checklist
          <span className="font-normal text-ds-fg-muted">{doneCount}/{items.length} done</span>
        </p>
        {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-ds-fg-muted" />}
      </div>

      {/* progress bar */}
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-ds-surface-hover">
        <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-ds-success' : 'bg-ds-primary'}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="space-y-1">
        {items.map((it, i) => (
          <div key={i} className="rounded-ds-card border border-ds-border bg-ds-surface-subtle px-2.5 py-1.5">
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => canEdit && toggle(i)}
                disabled={!canEdit}
                aria-label={it.done ? 'Mark not done' : 'Mark done'}
                className={`mt-0.5 flex-shrink-0 ${canEdit ? 'hover:opacity-80' : 'cursor-default'}`}
              >
                {it.done
                  ? <CheckSquare className="h-4 w-4 text-ds-success" />
                  : <Square className="h-4 w-4 text-ds-fg-muted" />}
              </button>
              <span className={`flex-1 text-[12px] ${it.done ? 'text-ds-fg-muted line-through' : 'text-ds-fg-body'}`}>{it.text}</span>
              {canEdit && (
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button type="button" onClick={() => setNoteOpen(noteOpen === i ? null : i)}
                    aria-label="Add note" className="text-ds-surface hover:text-ds-primary-text">
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => remove(i)} aria-label="Remove item" className="text-ds-surface hover:text-ds-danger">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            {(noteOpen === i || it.note) && (
              <div className="mt-1 pl-6">
                {canEdit ? (
                  <input
                    value={it.note || ''}
                    onChange={(e) => setNote(i, e.target.value)}
                    onBlur={() => commit(items)}
                    placeholder="Add a note…"
                    className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1 text-[12px] text-ds-fg-body focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-primary"
                  />
                ) : it.note ? (
                  <p className="text-[12px] text-ds-fg-muted">{it.note}</p>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder="Add a task…"
            className="flex-1 rounded-ds-card border border-ds-border-strong bg-ds-surface px-2.5 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary focus-visible:border-ds-primary"
          />
          <button type="button" onClick={add} disabled={!newText.trim()}
            className="inline-flex items-center gap-1 rounded-ds-card bg-ds-primary px-2.5 py-1.5 text-[12px] font-medium text-ds-on-primary hover:bg-ds-primary-hover disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      )}
    </div>
  );
}
