'use client';

// Stage 11 — Reassessment & Offboarding. The supplier's reassessment can be scheduled, and the supplier can be offboarded: the
// whole relationship, or one engagement alone. An exit is an amber card with its own checklist; each tick is saved as it is made,
// and "Complete exit" is open only when every step is done. Offboarding the whole relationship stops the supplier's portal links
// and expires its unanswered questionnaires, and completing it archives the supplier; one engagement's exit leaves the supplier
// active and ends only that engagement. Data-destruction attestations attach via the reused EvidencePanel.
//
// `exitOnly` draws just the exit cards (nothing when no exit is open), for the strip a page puts above its tabs while an exit is
// under way. `StartOffboardingDialog` is the dialog behind "Start offboarding", for any page that offers it.

import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, Loader2, LogOut, Plus } from 'lucide-react';
import { vendorRiskApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { BTN, BTN_DANGER, BTN_PRIMARY, Dialog, StatusPill } from '../../../_ui';
import { engagementsApi, engagementsKey, useEngagements, type Engagement } from '../../../_lib/engagementsApi';
import { offboardingApi, useOffboarding, type ExitItem } from '../../../_lib/offboardingApi';
import { WHOLE, exitLine, hintFor, openExits, progress, type ExitView } from '../../../_lib/offboardingModel';
import EvidencePanel from './EvidencePanel';

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const labelCls = 'mb-1 block text-xs font-medium text-gray-700';
const FIELD = 'block w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 py-2 text-sm leading-5 text-[#1f2933] placeholder:text-[#64707e] focus:border-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/30';
const DANGER_FILL = 'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#b42318] px-3 text-sm font-medium text-[#fff] hover:bg-[#912018] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

function errMsg(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: string | { message?: string } } } })?.response?.data?.detail;
  return (typeof detail === 'string' ? detail : detail?.message) || fallback;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Everything an exit changes: the checklist, the supplier or engagement it touches, the lifecycle and the register. */
function useRefresh(vendorId: number) {
  const qc = useQueryClient();
  return () => {
    ['tpra-offboarding', 'vendor', 'tpra-lifecycle', 'vendors', 'tpra-engagements'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    qc.invalidateQueries({ queryKey: engagementsKey(vendorId) });
  };
}

export default function OffboardingPanel({ vendorId, assessmentId, engagement = null, exitOnly = false }: {
  vendorId: number;
  /** The assessment the attestation evidence attaches to; without it (and with `exitOnly`) there is no evidence section. */
  assessmentId?: number;
  /** The engagement picked on the page: its own exit is shown and started here (General or null: the supplier's). */
  engagement?: Engagement | null;
  /** Draw only the exit cards, none while no exit is under way. */
  exitOnly?: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  // Completing the whole exit archives the supplier: what the server checks (vendors:delete, or its erm:risks:edit fallback).
  const canArchive = hasPermission('vendor_risk:vendors:delete') || hasPermission('erm:risks:edit');

  const [cadence, setCadence] = useState<number | ''>('');
  const [nextDate, setNextDate] = useState('');
  const [starting, setStarting] = useState(false);

  const { data: offboarding } = useOffboarding(vendorId);
  const scoped = engagement && engagement.id && !engagement.is_general ? { engagementId: engagement.id } : undefined;
  const exits = openExits(offboarding, scoped);
  const archived = !!offboarding?.archived_at;
  // Something can be started when no exit of the whole relationship is under way (and, on an engagement, it has none yet).
  const canStart = canEdit && !!offboarding && !archived && !offboarding.started && !(scoped && exits.length > 0);

  const scheduleMut = useMutation({
    mutationFn: async () => {
      if (engagement?.id) {
        await engagementsApi.update(engagement.id, {
          ...(cadence === '' ? {} : { reassessment_cadence_days: Number(cadence) }),
          ...(nextDate ? { next_reassessment_date: nextDate } : {}),
        });
        return;
      }
      await vendorRiskApi.scheduleReassessment(vendorId, {
        cadence_days: cadence === '' ? undefined : Number(cadence),
        next_date: nextDate || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
      qc.invalidateQueries({ queryKey: engagementsKey(vendorId) });
      toast({ type: 'success', title: 'Reassessment scheduled' });
    },
    onError: (e) => toast({ type: 'error', title: 'Could not schedule', message: errMsg(e, 'Try again.') }),
  });

  const cards = exits.map((x) => (
    <ExitCard key={x.engagementId ?? 'whole'} vendorId={vendorId} exit={x} canEdit={canEdit} canArchive={canArchive} />
  ));
  if (exitOnly) return cards.length ? <div className="space-y-3">{cards}</div> : null;

  return (
    <div className="space-y-4">
      {/* Schedule the next reassessment */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <CalendarClock className="h-4 w-4 text-primary-600" /> Schedule reassessment
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Cadence (days)</label>
            <input type="number" className={inputCls} value={cadence} disabled={!canEdit}
              onChange={(e) => setCadence(e.target.value ? Number(e.target.value) : '')}
              placeholder={engagement ? String(engagement.reassessment_cadence_days ?? '') : 'Tier default'} />
          </div>
          <div>
            <label className={labelCls}>Next review date</label>
            <input type="date" className={inputCls} value={nextDate} disabled={!canEdit}
              onChange={(e) => setNextDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            {canEdit && (
              <button onClick={() => scheduleMut.mutate()}
                disabled={scheduleMut.isPending || (!!engagement && cadence === '' && !nextDate)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {scheduleMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />} Schedule
              </button>
            )}
          </div>
        </div>
      </div>

      {/* The exit: started here, worked on as a card */}
      {(canStart || archived || cards.length > 0) && (
        <section aria-label="Offboarding" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[#1f2933]">
              <LogOut aria-hidden className="h-4 w-4 text-[#0f766e]" /> Offboarding
              {archived && <StatusPill tone="neutral">Archived</StatusPill>}
            </p>
            {canStart && (
              <button type="button" onClick={() => setStarting(true)} className={BTN_DANGER}>Start offboarding</button>
            )}
          </div>
          {cards}
        </section>
      )}
      <StartOffboardingDialog vendorId={vendorId} open={starting} onClose={() => setStarting(false)} engagementId={scoped?.engagementId ?? null} />

      {/* Data-return / destruction attestations */}
      {assessmentId ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Data-return / destruction attestation</p>
          <EvidencePanel assessmentId={assessmentId} title="Offboarding evidence" />
        </div>
      ) : null}
    </div>
  );
}

// ── the exit card ────────────────────────────────────────────────────────────

function ExitCard({ vendorId, exit, canEdit, canArchive }: { vendorId: number; exit: ExitView; canEdit: boolean; canArchive: boolean }) {
  const { toast } = useToast();
  const refresh = useRefresh(vendorId);
  const whole = exit.scope === 'relationship';
  const [notes, setNotes] = useState(exit.notes ?? '');
  const [newItem, setNewItem] = useState('');
  const [confirming, setConfirming] = useState(false);
  const noteId = useId();
  useEffect(() => { setNotes(exit.notes ?? ''); }, [exit.notes]);

  const { done, total, all } = progress(exit.items);
  const mayComplete = whole ? canArchive : canEdit;

  const save = useMutation({
    mutationFn: (body: { items?: ExitItem[]; notes?: string }) => {
      const sent = { ...body, items: body.items?.map((i) => ({ item: i.item, done: i.done })) };
      return whole ? offboardingApi.update(vendorId, sent) : offboardingApi.updateEngagement(exit.engagementId as number, sent);
    },
    onSuccess: refresh,
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errMsg(e, 'Try again.') }),
  });
  const complete = useMutation({
    mutationFn: () => (whole ? offboardingApi.complete(vendorId) : offboardingApi.completeEngagement(exit.engagementId as number)),
    onSuccess: () => {
      refresh();
      setConfirming(false);
      toast({ type: 'success', title: whole ? 'Exit complete. The supplier is archived.' : `Exit complete. ${exit.name} has ended.` });
    },
    onError: (e) => toast({ type: 'error', title: 'Not completed', message: errMsg(e, 'Try again.') }),
  });

  const toggle = (idx: number) => save.mutate({ items: exit.items.map((it, i) => (i === idx ? { ...it, done: !it.done } : it)) });
  const addItem = () => {
    const t = newItem.trim();
    if (!t) return;
    setNewItem('');
    save.mutate({ items: [...exit.items, { item: t, done: false }] });
  };

  return (
    <section aria-label={`Offboarding: ${exit.name}`} className="rounded-xl border border-[#f0d2a9] bg-[#fff] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[14px] font-semibold leading-5 text-[#1f2933]">
            <span aria-hidden className="grid h-6 w-6 place-items-center rounded-md bg-[#fbf1e4] text-[#9a5007]"><LogOut className="h-3.5 w-3.5" strokeWidth={2} /></span>
            Offboarding · {exit.name}
          </p>
          {exit.reason && <p className="mt-1 text-[13px] leading-5 text-[#26323d]">{exit.reason}</p>}
          <p className="mt-0.5 text-[12px] leading-4 text-[#64707e]">{exitLine(exit)}{exit.startedBy ? ` · by ${exit.startedBy}` : ''}</p>
        </div>
        {mayComplete && (
          <button type="button" onClick={() => setConfirming(true)} disabled={!all || complete.isPending}
            title={all ? undefined : 'Tick every step first'} className={BTN_PRIMARY}>
            <Check aria-hidden className="h-4 w-4" strokeWidth={2.25} /> Complete exit
          </button>
        )}
      </div>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {exit.items.map((it, i) => (
          <li key={`${i}-${it.item}`}>
            <label className="flex items-start gap-2.5 rounded-lg border border-[#d5dbe1] bg-[#fff] px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#0f766e]">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#0f766e]" checked={it.done}
                disabled={!canEdit || save.isPending} onChange={() => toggle(i)} />
              <span className="min-w-0">
                <span className={`block text-[13px] font-medium leading-5 ${it.done ? 'text-[#64707e] line-through' : 'text-[#1f2933]'}`}>{it.item}</span>
                {hintFor(it.item) && <span className="block text-[12px] leading-4 text-[#64707e]">{hintFor(it.item)}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-2 flex items-center gap-2">
          <input value={newItem} onChange={(e) => setNewItem(e.target.value)} aria-label="Add an offboarding step"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
            placeholder="Add an offboarding step…" maxLength={255} className={`${FIELD} h-9 flex-1 py-0`} />
          <button type="button" onClick={addItem} disabled={!newItem.trim() || save.isPending} className={BTN}>
            <Plus aria-hidden className="h-4 w-4" /> Add
          </button>
        </div>
      )}

      <div className="mt-3">
        <label htmlFor={noteId} className="mb-1 block text-[13px] font-medium leading-5 text-[#26323d]">Notes <span className="text-[12px] font-normal text-[#64707e]">(optional)</span></label>
        <textarea id={noteId} rows={2} maxLength={8000} value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)}
          onBlur={() => { if (notes.trim() !== (exit.notes ?? '')) save.mutate({ notes: notes.trim() }); }}
          placeholder="Where the destruction certificate is filed, who confirmed access removal." className={FIELD} />
      </div>

      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Complete exit"
        description={whole ? 'The supplier is archived. Restore brings it back.' : `${exit.name} ends. The supplier stays active.`}
        footer={(
          <>
            <button type="button" onClick={() => setConfirming(false)} className={BTN}>Cancel</button>
            <button type="button" onClick={() => complete.mutate()} disabled={complete.isPending} className={BTN_PRIMARY}>
              {complete.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />} Complete exit
            </button>
          </>
        )}>
        <p className="text-[13px] leading-5 text-[#26323d]">{done} of {total} {total === 1 ? 'step' : 'steps'} done.</p>
      </Dialog>
    </section>
  );
}

// ── starting an exit ─────────────────────────────────────────────────────────

/** "Start offboarding": what is ending (the whole relationship, or one engagement when the supplier has several) and why. */
export function StartOffboardingDialog({ vendorId, open, onClose, engagementId = null, onStarted }: {
  vendorId: number;
  open: boolean;
  onClose: () => void;
  /** An engagement to preselect (for instance the one picked on the page); null starts on the whole relationship. */
  engagementId?: number | null;
  onStarted?: () => void;
}) {
  const { toast } = useToast();
  const refresh = useRefresh(vendorId);
  const form = useId();
  const [scope, setScope] = useState('whole');
  const [reason, setReason] = useState('');
  const { data: engagements } = useEngagements(vendorId);
  const { data: offboarding } = useOffboarding(vendorId, open);

  // The engagements that can still be offboarded alone: in use, not General, no exit under way.
  const under = new Set((offboarding?.engagements ?? []).filter((e) => !e.ended && !e.completed_at).map((e) => e.id));
  const choices = (engagements?.items ?? []).filter((e) => !e.is_general && e.id !== null && e.status !== 'ended' && !under.has(e.id as number));
  useEffect(() => {
    if (!open) return;
    setReason('');
    setScope(engagementId ? String(engagementId) : 'whole');
  }, [open, engagementId]);

  const chosen = choices.find((e) => String(e.id) === scope) ?? null;
  const ready = reason.trim().length >= 3;
  const run = useMutation({
    mutationFn: async () => {
      if (chosen) {
        await offboardingApi.startEngagement(chosen.id as number, reason.trim());
        return null;
      }
      return (await offboardingApi.start(vendorId, reason.trim())).data;
    },
    onSuccess: (closed) => {
      refresh();
      onClose();
      onStarted?.();
      toast({ type: 'success', title: 'Offboarding started',
        message: closed ? `${plural(closed.links_revoked, 'portal link')} stopped · ${plural(closed.questionnaires_expired.length, 'questionnaire')} expired`
          : `${chosen?.name ?? 'The engagement'} keeps its history; the supplier stays active.` });
    },
    onError: (e) => toast({ type: 'error', title: 'Not started', message: errMsg(e, 'Try again.') }),
  });

  return (
    <Dialog open={open} onClose={onClose} title="Start offboarding" description="Nothing is deleted. A checklist opens and the supplier keeps its history."
      footer={(
        <>
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="submit" form={form} disabled={!ready || run.isPending} className={DANGER_FILL}>
            {run.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />} Start offboarding
          </button>
        </>
      )}>
      <form id={form} className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (ready && !run.isPending) run.mutate(); }}>
        {choices.length > 0 && (
          <div>
            <label htmlFor={`${form}-scope`} className="mb-1 block text-[13px] font-medium leading-5 text-[#26323d]">What is ending</label>
            <select id={`${form}-scope`} value={scope} onChange={(e) => setScope(e.target.value)} className={`${FIELD} h-10 py-0`}>
              <option value="whole">{WHOLE}</option>
              {choices.map((e) => <option key={e.id} value={String(e.id)}>Just {e.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor={`${form}-why`} className="mb-1 block text-[13px] font-medium leading-5 text-[#26323d]">Why</label>
          <textarea id={`${form}-why`} data-autofocus rows={3} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Replaced by the Contoso agreement from 1 April." className={FIELD} />
        </div>
        {!chosen && (
          <p className="rounded-lg bg-[#fbf1e4] px-3 py-2 text-[12px] leading-4 text-[#9a5007]">
            The supplier is marked offboarded, its portal links stop working and its unanswered questionnaires expire.
          </p>
        )}
      </form>
    </Dialog>
  );
}
