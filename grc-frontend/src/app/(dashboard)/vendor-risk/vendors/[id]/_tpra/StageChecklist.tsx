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
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <ListChecks className="h-4 w-4 text-primary-600" /> Stage checklist
          <span className="font-normal text-gray-400">{doneCount}/{items.length} done</span>
        </p>
        {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
      </div>

      {/* progress bar */}
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-primary-500'}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="space-y-1">
        {items.map((it, i) => (
          <div key={i} className="rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5">
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => canEdit && toggle(i)}
                disabled={!canEdit}
                aria-label={it.done ? 'Mark not done' : 'Mark done'}
                className={`mt-0.5 flex-shrink-0 ${canEdit ? 'hover:opacity-80' : 'cursor-default'}`}
              >
                {it.done
                  ? <CheckSquare className="h-4 w-4 text-emerald-600" />
                  : <Square className="h-4 w-4 text-gray-400" />}
              </button>
              <span className={`flex-1 text-xs ${it.done ? 'text-gray-400 line-through' : 'text-slate-700'}`}>{it.text}</span>
              {canEdit && (
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button type="button" onClick={() => setNoteOpen(noteOpen === i ? null : i)}
                    aria-label="Add note" className="text-gray-300 hover:text-primary-600">
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => remove(i)} aria-label="Remove item" className="text-gray-300 hover:text-red-500">
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
                    className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-slate-600 focus:outline-none focus:ring-1 focus:ring-primary-400"
                  />
                ) : it.note ? (
                  <p className="text-[11px] text-gray-500">{it.note}</p>
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
            className="flex-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          <button type="button" onClick={add} disabled={!newText.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      )}
    </div>
  );
}
