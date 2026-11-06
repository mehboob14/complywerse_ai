'use client';

// The drawers that make a committee or a meeting (lifted from the old Committees page, unchanged in behaviour): a new committee, and a new meeting with its first agenda items.
// Every write is a useReportedMutation (a confirmation only after the server answered; a failure stays in the drawer with the server's words), and every drawer asks
// before it throws typing away (`dirty`).
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { Button, FormField, IconButton, Select, Textarea, TextInput } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { truncate } from '@/lib/format';
import { committeeTypeLabel, formChanged } from '@/lib/committees';
import { DrawerFooter, FormProblem, PickerField } from './ui';

const COMMITTEE_TYPE_ITEMS = ['board', 'risk_committee', 'audit_committee', 'compliance_committee', 'it_steering', 'custom'].map((value) => ({ value, label: committeeTypeLabel(value, 'long') }));
const MEETING_TYPE_ITEMS = [
  { value: 'regular', label: 'Regular' },
  { value: 'special', label: 'Special' },
  { value: 'emergency', label: 'Emergency' },
];
const AGENDA_TYPE_ITEMS = [
  { value: 'discussion', label: 'Discussion' },
  { value: 'approval', label: 'Approval' },
  { value: 'information', label: 'Information' },
  { value: 'action_review', label: 'Action review' },
];
const FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'ad_hoc', label: 'Ad hoc' },
];
const short = (name: string): string => truncate(name, 60).text;

const NEW_COMMITTEE = { name: '', description: '', committee_type: 'custom', chair_id: '', secretary_id: '', meeting_frequency: 'quarterly' };

export function CreateCommitteePanel({ open, onClose, userItems, onSaved }: {
  open: boolean; onClose: () => void;
  userItems: { value: string; label: string; subLabel?: string }[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState(NEW_COMMITTEE);
  const create = useReportedMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.createCommittee(data),
    success: (_r, data) => `Committee ${short(String(data.name))} created`,
    failure: "Couldn't create the committee",
    retryable: false,                                                   // a create is not safe to repeat blindly: the drawer stays open to try again
    onSuccess: () => { onSaved(); onClose(); setForm(NEW_COMMITTEE); },
  });
  const close = () => { create.reset(); onClose(); };
  const set = (patch: Partial<typeof NEW_COMMITTEE>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <RightSlidePanel
      isOpen={open}
      onClose={close}
      title="New committee"
      dirty={formChanged(NEW_COMMITTEE, form)}
      footer={<DrawerFooter onCancel={close} form="create-committee-form" pending={create.isPending} label="Create committee" pendingLabel="Creating…" disabled={!form.name.trim()} />}
    >
      <form
        id="create-committee-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ ...form, chair_id: form.chair_id ? parseInt(form.chair_id, 10) : null, secretary_id: form.secretary_id ? parseInt(form.secretary_id, 10) : null });
        }}
        className="flex flex-col gap-[16px]"
      >
        {create.isError && <FormProblem message={errorMessage(create.error, 'The committee could not be created.')} />}
        <FormField label="Committee name" required>
          <TextInput value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={255} required />
        </FormField>
        <FormField label="Description" optional>
          <Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={2} />
        </FormField>
        <FormField label="Type">
          <Select value={form.committee_type} onChange={(e) => set({ committee_type: e.target.value })}>
            {COMMITTEE_TYPE_ITEMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </FormField>
        <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
          <PickerField label="Chair" optional>
            <MultiSelectDropdown title="Chair" items={userItems} selectedValues={form.chair_id ? [form.chair_id] : []}
              onApply={(v) => set({ chair_id: v[0] || '' })} multiSelect={false} autoApply triggerVariant="input" forceSearch placeholder="Select" size="sm" triggerClassName="w-full" />
          </PickerField>
          <PickerField label="Secretary" optional>
            <MultiSelectDropdown title="Secretary" items={userItems} selectedValues={form.secretary_id ? [form.secretary_id] : []}
              onApply={(v) => set({ secretary_id: v[0] || '' })} multiSelect={false} autoApply triggerVariant="input" forceSearch placeholder="Select" size="sm" triggerClassName="w-full" />
          </PickerField>
        </div>
        <FormField label="Meeting frequency">
          <Select value={form.meeting_frequency} onChange={(e) => set({ meeting_frequency: e.target.value })}>
            {FREQUENCY_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
        </FormField>
      </form>
    </RightSlidePanel>
  );
}

interface AgendaDraft { title: string; item_type: string }
const NEW_MEETING = { committee_id: '', title: '', meeting_type: 'regular', scheduled_date: '', location: '', virtual_link: '', quorum_required: '' };

export function CreateMeetingPanel({ open, onClose, committeeItems, defaultCommitteeId, onSaved }: {
  open: boolean; onClose: () => void;
  committeeItems: { value: string; label: string }[];
  defaultCommitteeId: number | null;
  onSaved: () => void;
}) {
  const blank = { ...NEW_MEETING, committee_id: defaultCommitteeId ? String(defaultCommitteeId) : '' };
  const [form, setForm] = useState(blank);
  const [agenda, setAgenda] = useState<AgendaDraft[]>([]);
  const [agendaDraft, setAgendaDraft] = useState<AgendaDraft>({ title: '', item_type: 'discussion' });
  // the meeting once created, so a retry after an agenda item failed never makes a SECOND meeting (cleared on open and on reset)
  const [createdMeetingId, setCreatedMeetingId] = useState<number | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  // the committee that was selected when the drawer opens is the one pre-chosen (the first useState ran at mount, when nothing was selected yet)
  useEffect(() => {
    if (open) {
      setForm((f) => ({ ...f, committee_id: defaultCommitteeId ? String(defaultCommitteeId) : f.committee_id }));
      setCreatedMeetingId(null);
      setWarn(null);
    }
  }, [open, defaultCommitteeId]);

  const reset = () => {
    setForm({ ...NEW_MEETING, committee_id: defaultCommitteeId ? String(defaultCommitteeId) : '' });
    setAgenda([]);
    setAgendaDraft({ title: '', item_type: 'discussion' });
    setCreatedMeetingId(null);
    setWarn(null);
  };
  const addAgendaItem = () => {
    const title = agendaDraft.title.trim();
    if (!title) return;
    setAgenda([...agenda, { ...agendaDraft, title }]);
    setAgendaDraft({ title: '', item_type: agendaDraft.item_type });
  };

  const create = useReportedMutation({
    mutationFn: async () => {
      setWarn(null);
      const committeeId = parseInt(form.committee_id, 10);
      let meetingId = createdMeetingId;
      if (meetingId == null) {
        const payload: Record<string, unknown> = { title: form.title.trim(), meeting_type: form.meeting_type, scheduled_date: new Date(form.scheduled_date).toISOString() };
        if (form.location.trim()) payload.location = form.location.trim();
        if (form.virtual_link.trim()) payload.virtual_link = form.virtual_link.trim();
        if (form.quorum_required) payload.quorum_required = parseInt(form.quorum_required, 10);
        const res = await committeeApi.createMeeting(committeeId, payload);
        meetingId = (res.data as { id?: number })?.id ?? null;
        setCreatedMeetingId(meetingId);
      }
      // the inline agenda items are best effort: a failed one is collected, not thrown, so one bad row cannot undo the meeting
      const failed: AgendaDraft[] = [];
      if (meetingId != null) {
        for (let i = 0; i < agenda.length; i++) {
          try {
            await committeeApi.addAgendaItem(meetingId, { title: agenda[i].title, item_type: agenda[i].item_type, item_number: i + 1 });
          } catch {
            failed.push(agenda[i]);
          }
        }
      }
      return { failed, title: form.title.trim() };
    },
    success: ({ failed, title }) => (failed.length
      ? { title: `Meeting ${short(title)} scheduled`, message: `${failed.length} agenda ${failed.length === 1 ? 'item' : 'items'} could not be added. They are still in the form: add them again.` }
      : `Meeting ${short(title)} scheduled`),
    failure: "Couldn't schedule the meeting",
    retryable: false,
    onSuccess: ({ failed }) => {
      onSaved();
      if (failed.length) {
        // the meeting is saved, some agenda items are not: the drawer stays open with only those, so they can be added again without a second meeting
        setAgenda(failed);
        setWarn(`Meeting saved. ${failed.length} agenda ${failed.length === 1 ? 'item' : 'items'} couldn't be added: you can add them again.`);
      } else {
        onClose();
        reset();
      }
    },
    onError: () => setCreatedMeetingId(null),                              // the meeting itself failed (nothing was saved): safe to try as it is
  });
  const close = () => { create.reset(); onClose(); };
  const set = (patch: Partial<typeof NEW_MEETING>) => setForm((f) => ({ ...f, ...patch }));
  const canSubmit = Boolean(form.committee_id && form.title.trim() && form.scheduled_date);

  return (
    <RightSlidePanel
      isOpen={open}
      onClose={close}
      title="New meeting"
      dirty={formChanged(blank, form) || agenda.length > 0 || Boolean(agendaDraft.title.trim())}
      footer={<DrawerFooter onCancel={close} form="create-meeting-form" pending={create.isPending} label="Schedule meeting" pendingLabel="Scheduling…" disabled={!canSubmit} />}
    >
      <form id="create-meeting-form" onSubmit={(e) => { e.preventDefault(); if (canSubmit) create.mutate(); }} className="flex flex-col gap-[16px]">
        {create.isError && <FormProblem message={errorMessage(create.error, 'The meeting could not be scheduled.')} />}
        {warn && <p role="status" className="rounded-ds-control border border-ds-border bg-ds-warning-soft px-[12px] py-[8px] text-ds-body text-ds-fg">{warn}</p>}
        <FormField label="Committee" required>
          <Select value={form.committee_id} onChange={(e) => set({ committee_id: e.target.value })} placeholder="Select committee" required>
            {committeeItems.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Meeting title" required>
          <TextInput value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Q1 Risk Review" maxLength={500} required />
        </FormField>
        <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
          <FormField label="Date & time" required>
            <TextInput type="datetime-local" value={form.scheduled_date} onChange={(e) => set({ scheduled_date: e.target.value })} required />
          </FormField>
          <FormField label="Type">
            <Select value={form.meeting_type} onChange={(e) => set({ meeting_type: e.target.value })}>
              {MEETING_TYPE_ITEMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </FormField>
        </div>
        <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
          <FormField label="Location" optional>
            <TextInput value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="Boardroom / online" maxLength={500} />
          </FormField>
          <FormField label="Quorum required" optional>
            <TextInput type="number" min={0} value={form.quorum_required} onChange={(e) => set({ quorum_required: e.target.value })} placeholder="e.g. 5" />
          </FormField>
        </div>
        <FormField label="Virtual link" optional>
          <TextInput value={form.virtual_link} onChange={(e) => set({ virtual_link: e.target.value })} placeholder="https://…" maxLength={1000} />
        </FormField>

        <fieldset className="min-w-0">
          <legend className="text-ds-label text-ds-fg">Agenda items <span className="font-normal text-ds-fg-muted">(optional)</span></legend>
          {agenda.length > 0 && (
            <ul className="mt-[8px] space-y-[6px]">
              {agenda.map((a, idx) => (
                <li key={idx} className="flex items-center justify-between gap-[8px] rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[10px] py-[6px]">
                  <span className="min-w-0 break-words text-ds-body text-ds-fg-body">
                    <span className="mr-[6px] text-ds-label text-ds-fg-muted">{idx + 1}.</span>{a.title}
                    <span className="ml-[8px] text-ds-label font-normal text-ds-fg-muted">{AGENDA_TYPE_ITEMS.find((t) => t.value === a.item_type)?.label}</span>
                  </span>
                  <IconButton label={`Remove agenda item ${idx + 1}`} onClick={() => setAgenda(agenda.filter((_, i) => i !== idx))}><Trash2 aria-hidden /></IconButton>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
            <TextInput
              value={agendaDraft.title}
              onChange={(e) => setAgendaDraft({ ...agendaDraft, title: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && agendaDraft.title.trim()) { e.preventDefault(); addAgendaItem(); } }}
              placeholder="Add an agenda item, then Enter"
              aria-label="Agenda item title"
              maxLength={500}
              className="min-w-[160px] flex-1"
            />
            <Select aria-label="Agenda item type" value={agendaDraft.item_type} onChange={(e) => setAgendaDraft({ ...agendaDraft, item_type: e.target.value })} className="w-[140px]">
              {AGENDA_TYPE_ITEMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
            <IconButton label="Add agenda item" variant="secondary" onClick={addAgendaItem} disabled={!agendaDraft.title.trim()}><Plus aria-hidden /></IconButton>
          </div>
        </fieldset>
      </form>
    </RightSlidePanel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit committee (drawer): the name, the description, the type, the chair and secretary and how often it meets
// ─────────────────────────────────────────────────────────────────────────────
const FREQUENCY_EDIT_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'bi-weekly', label: 'Bi-weekly' },
  ...FREQUENCY_OPTIONS,
];

export interface EditableCommittee {
  id: number;
  name: string;
  description?: string | null;
  committee_type: string;
  chair_id?: number | null;
  secretary_id?: number | null;
  meeting_frequency?: string | null;
}

const editDraftOf = (c: EditableCommittee) => ({
  name: c.name,
  description: c.description ?? '',
  committee_type: c.committee_type,
  chair_id: c.chair_id ? String(c.chair_id) : '',
  secretary_id: c.secretary_id ? String(c.secretary_id) : '',
  meeting_frequency: c.meeting_frequency ?? 'monthly',
});

export function EditCommitteePanel({ open, onClose, committee, userItems }: {
  open: boolean; onClose: () => void;
  committee: EditableCommittee;
  userItems: { value: string; label: string; subLabel?: string }[];
}) {
  const initial = editDraftOf(committee);
  const [draft, setDraft] = useState(initial);
  // the draft starts from the committee as it is when the drawer opens; closing it discards what was typed
  useEffect(() => { if (open) setDraft(editDraftOf(committee)); }, [open]);          // eslint-disable-line react-hooks/exhaustive-deps
  const update = useReportedMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.updateCommittee(committee.id, data),
    success: 'Committee saved',
    failure: "Couldn't save the committee",
    invalidate: [['committee', committee.id], ['committee-overview']],
    onSuccess: () => onClose(),
  });
  const close = () => { update.reset(); onClose(); };
  return (
    <RightSlidePanel
      isOpen={open}
      onClose={close}
      title="Edit committee"
      dirty={formChanged(initial, draft)}
      footer={<DrawerFooter onCancel={close} form="edit-committee-form" pending={update.isPending} label="Save changes" pendingLabel="Saving…" disabled={!draft.name.trim()} />}
    >
      <form
        id="edit-committee-form"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({
            name: draft.name,
            description: draft.description || null,
            committee_type: draft.committee_type,
            chair_id: draft.chair_id ? Number(draft.chair_id) : null,
            secretary_id: draft.secretary_id ? Number(draft.secretary_id) : null,
            meeting_frequency: draft.meeting_frequency,
          });
        }}
        className="flex flex-col gap-[16px]"
      >
        {update.isError && <FormProblem message={errorMessage(update.error, 'The committee could not be saved.')} />}
        <FormField label="Name" required>
          <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={255} required />
        </FormField>
        <FormField label="Description" optional>
          <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={3} />
        </FormField>
        <FormField label="Committee type">
          <Select value={draft.committee_type} onChange={(e) => setDraft({ ...draft, committee_type: e.target.value })}>
            {COMMITTEE_TYPE_ITEMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </FormField>
        <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
          <PickerField label="Chair" optional>
            <MultiSelectDropdown title="Chair" items={userItems} selectedValues={draft.chair_id ? [draft.chair_id] : []}
              onApply={(v) => setDraft({ ...draft, chair_id: v[0] || '' })} multiSelect={false} autoApply triggerVariant="input" forceSearch placeholder="Select chair" size="sm" triggerClassName="w-full" />
          </PickerField>
          <PickerField label="Secretary" optional>
            <MultiSelectDropdown title="Secretary" items={userItems} selectedValues={draft.secretary_id ? [draft.secretary_id] : []}
              onApply={(v) => setDraft({ ...draft, secretary_id: v[0] || '' })} multiSelect={false} autoApply triggerVariant="input" forceSearch placeholder="Select secretary" size="sm" triggerClassName="w-full" />
          </PickerField>
        </div>
        <FormField label="Meeting frequency">
          <Select value={draft.meeting_frequency} onChange={(e) => setDraft({ ...draft, meeting_frequency: e.target.value })}>
            {FREQUENCY_EDIT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
        </FormField>
      </form>
    </RightSlidePanel>
  );
}
