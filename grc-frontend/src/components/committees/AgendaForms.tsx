'use client';

// The forms of the agenda: add an item (inline, at the end of the agenda, so the agenda stays in view while typing), edit an item, record what the committee decided about
// one (the outcome and the decision text), and fill the agenda from what is pending (approvals, exceptions, regulatory changes). Every write is a useReportedMutation; a
// failed save keeps what was typed, says what the server said in the form and offers to try again; every form that holds typing asks "Discard changes?" before it throws it away.
import { useEffect, useRef, useState } from 'react';
import { FileCheck, Plus, Scale, Shield, Sparkles } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { Button, Checkbox, DiscardBar, FormField, Select, Textarea, TextInput } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { formatCount, statusLabel, truncate } from '@/lib/format';
import { formChanged } from '@/lib/committees';
import { DECISION_MAX, DEFAULT_OUTCOME, OUTCOMES, outcomeBody, outcomeWord, type Outcome } from '@/lib/meetingRun';
import { DrawerFooter, FormProblem } from './ui';
import type { AgendaItem } from './meetingTypes';

export const ITEM_TYPES = [
  { value: 'procedural', label: 'Procedural' },
  { value: 'approval', label: 'Approval' },
  { value: 'discussion', label: 'Discussion' },
  { value: 'information', label: 'Information' },
  { value: 'decision', label: 'Decision' },
];
const NEW_AGENDA = { title: '', description: '', duration_minutes: 15, item_type: 'discussion' };

// ── add an item, in place ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The inline form at the end of the agenda. Focus lands in the title; Enter adds; Cancel with typed text asks first; a failure keeps everything and offers Retry. */
export function AgendaComposer({ meetingId, onClose }: { meetingId: number; onClose: () => void }) {
  const [form, setForm] = useState(NEW_AGENDA);
  const [asking, setAsking] = useState(false);
  const [missing, setMissing] = useState(false);
  const title = useRef<HTMLInputElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const add = useReportedMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.addAgendaItem(meetingId, data),
    success: (_r, v) => ({ title: 'Agenda item added', message: truncate(String(v.title), 80).text }),
    failure: "Couldn't add the agenda item",
    retryable: false,                          // a create is not safe to repeat blindly: the form stays, with the server's words and a Retry of its own
    toast: 'success',
    invalidate: [['meeting-agenda', meetingId], ['meeting', meetingId], ['committee-meetings']],
    onSuccess: () => onClose(),
  });
  const dirty = formChanged(NEW_AGENDA, form);
  const cancel = () => { if (dirty) setAsking(true); else onClose(); };
  const submit = () => {
    if (!form.title.trim()) { setMissing(true); title.current?.focus(); return; }
    setMissing(false);
    add.mutate({ title: form.title.trim(), description: form.description.trim() || undefined, duration_minutes: form.duration_minutes, item_type: form.item_type });
  };
  return (
    <form
      aria-label="New agenda item"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="mt-[8px] space-y-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]"
    >
      <h3 className="!text-ds-section !text-ds-fg">New agenda item</h3>
      {asking && <DiscardBar onKeep={() => setAsking(false)} onDiscard={onClose} />}
      {add.isError && <FormProblem message={errorMessage(add.error, 'The agenda item could not be added.')} />}
      <FormField label="Title" required error={missing ? 'Enter a title for the agenda item.' : undefined}>
        <TextInput ref={title} value={form.title} onChange={(e) => { setForm({ ...form, title: e.target.value }); if (missing) setMissing(false); }} placeholder="Agenda item title" maxLength={500} />
      </FormField>
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
        <FormField label="Type">
          <Select value={form.item_type} onChange={(e) => setForm({ ...form, item_type: e.target.value })}>
            {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Duration">
          <TextInput type="number" min={1} unit="min" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: parseInt(e.target.value, 10) || 15 })} />
        </FormField>
      </div>
      <FormField label="Description" optional>
        <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="Optional description" />
      </FormField>
      <div className="flex justify-end gap-[8px]">
        <Button onClick={cancel} disabled={add.isPending}>Cancel</Button>
        <Button type="submit" variant="primary" leftIcon={<Plus aria-hidden />} loading={add.isPending}>{add.isError ? 'Retry' : 'Add item'}</Button>
      </div>
    </form>
  );
}

// ── edit an item ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function EditAgendaPanel({ meetingId, item, onClose }: { meetingId: number; item: AgendaItem | null; onClose: () => void }) {
  const initial = { title: item?.title ?? '', description: item?.description ?? '', time_allocated_minutes: item?.time_allocated_minutes ?? 15, item_type: item?.item_type ?? 'discussion' };
  const [draft, setDraft] = useState(initial);
  useEffect(() => { if (item) setDraft({ title: item.title, description: item.description ?? '', time_allocated_minutes: item.time_allocated_minutes ?? 15, item_type: item.item_type ?? 'discussion' }); }, [item?.id]);          // eslint-disable-line react-hooks/exhaustive-deps
  const update = useReportedMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.updateAgendaItem(item?.id as number, data),
    success: 'Agenda item updated',
    failure: "Couldn't update the agenda item",
    invalidate: [['meeting-agenda', meetingId], ['meeting', meetingId]],
    onSuccess: () => onClose(),
  });
  const close = () => { update.reset(); onClose(); };
  return (
    <RightSlidePanel
      isOpen={item !== null}
      onClose={close}
      title="Edit agenda item"
      dirty={formChanged(initial, draft)}
      footer={<DrawerFooter onCancel={close} form="edit-agenda-form" pending={update.isPending} label="Save changes" pendingLabel="Saving…" disabled={!draft.title.trim()} />}
    >
      <form
        id="edit-agenda-form"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ title: draft.title, description: draft.description || null, time_allocated_minutes: draft.time_allocated_minutes, item_type: draft.item_type });
        }}
        className="flex flex-col gap-[16px]"
      >
        {update.isError && <FormProblem message={errorMessage(update.error, 'The agenda item could not be saved.')} />}
        <FormField label="Title" required>
          <TextInput value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={500} required />
        </FormField>
        <FormField label="Description" optional>
          <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={3} />
        </FormField>
        <div className="grid grid-cols-2 gap-[16px]">
          <FormField label="Type">
            <Select value={draft.item_type} onChange={(e) => setDraft({ ...draft, item_type: e.target.value })}>
              {ITEM_TYPES.concat(ITEM_TYPES.some((t) => t.value === draft.item_type) ? [] : [{ value: draft.item_type, label: statusLabel(draft.item_type) }]).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Duration">
            <TextInput type="number" min={1} unit="min" value={draft.time_allocated_minutes} onChange={(e) => setDraft({ ...draft, time_allocated_minutes: parseInt(e.target.value, 10) || 15 })} />
          </FormField>
        </div>
      </form>
    </RightSlidePanel>
  );
}

// ── what the committee decided ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Record (or correct) the outcome of an item: one of Approved, Rejected, Deferred, Noted, and what was decided. The server sets the item's own status from it
 *  (Deferred, otherwise discussed) and answers 409 when the meeting has not started or was cancelled: said here in its words, with what was typed kept. */
export function OutcomePanel({ meetingId, item, onClose }: { meetingId: number; item: AgendaItem | null; onClose: () => void }) {
  const initial = { outcome: (outcomeWord(item?.outcome) ?? DEFAULT_OUTCOME) as Outcome, decision: item?.decision_made ?? '' };
  const [draft, setDraft] = useState(initial);
  useEffect(() => { if (item) setDraft({ outcome: outcomeWord(item.outcome) ?? DEFAULT_OUTCOME, decision: item.decision_made ?? '' }); }, [item?.id]);          // eslint-disable-line react-hooks/exhaustive-deps
  const record = useReportedMutation({
    mutationFn: (body: ReturnType<typeof outcomeBody>) => committeeApi.recordAgendaOutcome(item?.id as number, body),
    success: (_r, v) => ({ title: 'Outcome recorded', message: `${v.outcome}: ${truncate(item?.title ?? '', 70).text}` }),
    failure: "Couldn't record the outcome",
    toast: 'success',
    invalidate: [['meeting-agenda', meetingId], ['meeting', meetingId], ['committee-decisions']],
    onSuccess: () => onClose(),
  });
  const close = () => { record.reset(); onClose(); };
  const tooLong = draft.decision.length > DECISION_MAX;
  return (
    <RightSlidePanel
      isOpen={item !== null}
      onClose={close}
      title={item?.outcome ? 'Correct the outcome' : 'Record the outcome'}
      dirty={formChanged(initial, draft)}
      footer={<DrawerFooter onCancel={close} form="record-outcome-form" pending={record.isPending} label="Save outcome" pendingLabel="Saving…" disabled={tooLong} />}
    >
      <form
        id="record-outcome-form"
        onSubmit={(e) => { e.preventDefault(); if (!tooLong) record.mutate(outcomeBody(draft.outcome, draft.decision)); }}
        className="flex flex-col gap-[16px]"
      >
        {record.isError && <FormProblem message={errorMessage(record.error, 'The outcome could not be saved.')} />}
        {item && <p className="break-words text-ds-body text-ds-fg-body"><span className="font-[600] text-ds-fg">Item {item.item_number}.</span> {truncate(item.title, 160).text}</p>}
        <FormField label="Outcome" required>
          <Select value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value as Outcome })}>
            {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </FormField>
        <FormField label="Decision made" optional hint="One or two sentences: what was decided, who does what by when." error={tooLong ? `Keep it under ${formatCount(DECISION_MAX)} characters.` : undefined}>
          <Textarea value={draft.decision} onChange={(e) => setDraft({ ...draft, decision: e.target.value })} rows={5} />
        </FormField>
      </form>
    </RightSlidePanel>
  );
}

// ── fill the agenda from what is pending ─────────────────────────────────────────────────────────────────────────────────────────────────────
const SOURCES = [
  { key: 'include_documents' as const, label: 'Pending document approvals', desc: 'Documents awaiting committee approval', Icon: FileCheck },
  { key: 'include_exceptions' as const, label: 'Risk exceptions', desc: 'Exceptions pending review', Icon: Shield },
  { key: 'include_regulatory_changes' as const, label: 'Regulatory changes', desc: 'Updates under assessment', Icon: Scale },
];

export function AutoPopulatePanel({ meetingId, open, onClose }: { meetingId: number; open: boolean; onClose: () => void }) {
  const [options, setOptions] = useState({ include_documents: true, include_exceptions: true, include_regulatory_changes: true });
  const fill = useReportedMutation({
    mutationFn: (opts: typeof options) => committeeApi.autoPopulateAgenda(meetingId, opts),
    success: (res) => {
      const data = (res as { data?: { items_added?: number; total_created?: number } }).data;
      const added = data?.items_added ?? data?.total_created ?? 0;
      return `${added} item${added !== 1 ? 's' : ''} added to the agenda`;
    },
    failure: "Couldn't fill the agenda",
    retryable: false,
    invalidate: [['meeting-agenda', meetingId], ['meeting-suggested', meetingId], ['meeting', meetingId], ['committee-meetings']],
    onSuccess: () => onClose(),
  });
  const close = () => { fill.reset(); onClose(); };
  return (
    <RightSlidePanel
      isOpen={open}
      onClose={close}
      title="Auto-populate the agenda"
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" leftIcon={<Sparkles aria-hidden />} loading={fill.isPending} disabled={!options.include_documents && !options.include_exceptions && !options.include_regulatory_changes} onClick={() => fill.mutate(options)}>
            {fill.isPending ? 'Populating…' : 'Populate agenda'}
          </Button>
        </div>
      )}
    >
      <div className="space-y-[12px]">
        {fill.isError && <FormProblem message={errorMessage(fill.error, 'The agenda could not be filled.')} />}
        <p className="text-ds-body text-ds-fg-body">Add the relevant pending items to the agenda. Choose which kinds to include.</p>
        {SOURCES.map(({ key, label, desc, Icon }) => (
          <div key={key} className="rounded-ds-card border border-ds-border px-[12px]">
            <Checkbox
              checked={options[key]}
              onChange={(e) => setOptions({ ...options, [key]: e.target.checked })}
              label={(
                <span className="flex items-start gap-[12px]">
                  <Icon aria-hidden className="mt-[2px] h-[18px] w-[18px] shrink-0 text-ds-primary-text" />
                  <span><span className="block font-medium text-ds-fg">{label}</span><span className="block text-ds-label font-normal text-ds-fg-muted">{desc}</span></span>
                </span>
              )}
            />
          </div>
        ))}
      </div>
    </RightSlidePanel>
  );
}
