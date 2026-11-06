'use client';

// "Add manual action": an oversight action made by hand, for any active committee (and, if wanted, one of its meetings), with a priority (its SLA follows it), a due date,
// an owner and a description the AI can reword or summarise from a reference file. Lifted from the Oversight Actions page, with the owner field the old committee page's form had
// (that form lived on the committee's Actions tab, which a committee no longer has). Open to every signed-in user, as it always was: the server asks for no more. The committee
// can be preset (the page is filtered to one). An inactive committee is not offered (the server refuses it with a 400).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Upload } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { priorityChoices, slaDays } from '@/components/settings/PrioritySla';
import type { ModuleSettings } from '@/components/settings/CustomFields';
import { Button, FormField, Select, Textarea, TextInput } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { truncate } from '@/lib/format';
import { ACTION_TYPES, activeCommittees, formChanged, listOf } from '@/lib/committees';
import { useTenantUsers } from './people';
import { DrawerFooter, FileInput, FormProblem, PickerField } from './ui';

interface CommitteeOption { id: number; name: string; is_active?: boolean }

const NEW_ACTION = { committee_id: '', meeting_id: '', title: '', description: '', action_type: 'follow_up', priority: 'medium', due_date: '', assigned_to: '' };

export function ManualActionPanel({ open, onClose, committees, presetCommitteeId, taskSettings, onSaved }: {
  open: boolean;
  onClose: () => void;
  /** every committee (the active ones are offered) */
  committees: readonly CommitteeOption[];
  presetCommitteeId: number | null;
  /** Task Management's SLA table: the days each priority allows (a person without access just gets no hints) */
  taskSettings: ModuleSettings | undefined;
  onSaved: () => void;
}) {
  const blank = { ...NEW_ACTION, committee_id: presetCommitteeId ? String(presetCommitteeId) : '' };
  const [form, setForm] = useState(blank);
  const [aiFile, setAiFile] = useState<File | null>(null);
  const { items: userItems } = useTenantUsers();
  const set = (patch: Partial<typeof NEW_ACTION>) => setForm((f) => ({ ...f, ...patch }));

  const meetingsQ = useQuery({
    queryKey: ['committee-meetings-for-actions', form.committee_id],
    enabled: open && !!form.committee_id,
    queryFn: async () => listOf<{ id: number; title: string }>((await committeeApi.getMeetings(parseInt(form.committee_id, 10))).data).items.map((m) => ({ id: m.id, title: m.title })),
  });
  const meetings = meetingsQ.data ?? [];

  const create = useReportedMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.createManualAction(data),
    success: (_r, data) => ({ title: 'Action created', message: truncate(String(data.title), 80).text }),
    failure: "Couldn't create the action",
    retryable: false,                                              // a create is not safe to repeat blindly: the drawer stays open to try again
    invalidate: [['all-actions'], ['committee-overview'], ['committee-lane-actions'], ['action-counts']],
    onSuccess: () => { onSaved(); onClose(); setForm(blank); setAiFile(null); },
  });
  const reword = useReportedMutation({
    mutationFn: async () => {
      const data = new FormData();
      if (form.description.trim()) data.append('text', form.description.trim());
      if (aiFile) data.append('file', aiFile);
      data.append('tone', 'professional');
      return (await committeeApi.aiRewordActionText(data)).data as { text: string };
    },
    success: 'Description reworded',
    failure: "Couldn't reword the description",
    onSuccess: (result) => setForm((prev) => ({ ...prev, description: result.text || prev.description })),
  });
  const summarise = useReportedMutation({
    mutationFn: async () => {
      const data = new FormData();
      if (form.description.trim()) data.append('text', form.description.trim());
      if (aiFile) data.append('file', aiFile);
      return (await committeeApi.aiSummarizeActionText(data)).data as { text: string };
    },
    success: 'Summary added to the description',
    failure: "Couldn't summarise the description",
    onSuccess: (result) => setForm((prev) => ({ ...prev, description: result.text || prev.description })),
  });

  const close = () => { create.reset(); onClose(); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.committee_id || !form.title.trim()) return;
    const payload: Record<string, unknown> = {
      committee_id: parseInt(form.committee_id, 10),
      title: form.title.trim(),
      action_type: form.action_type,
      priority: form.priority,
    };
    if (form.meeting_id) payload.meeting_id = parseInt(form.meeting_id, 10);
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.due_date) payload.due_date = form.due_date;
    if (form.assigned_to) payload.assigned_to = parseInt(form.assigned_to, 10);
    create.mutate(payload);
  };

  return (
    <RightSlidePanel
      isOpen={open}
      onClose={close}
      title="Add manual action"
      dirty={formChanged(blank, form) || aiFile !== null}
      footer={<DrawerFooter onCancel={close} form="create-action-form" pending={create.isPending} label="Create action" pendingLabel="Creating…" disabled={!form.committee_id || !form.title.trim()} />}
    >
      <form id="create-action-form" onSubmit={submit} className="flex flex-col gap-[16px]">
        {create.isError && <FormProblem message={errorMessage(create.error, 'The action could not be created.')} />}
        <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2">
          <FormField label="Committee" required>
            <Select value={form.committee_id} placeholder="Select committee" required onChange={(e) => set({ committee_id: e.target.value, meeting_id: '' })}>
              {activeCommittees(committees).map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Meeting" optional>
            <Select
              value={form.meeting_id}
              disabled={!form.committee_id}
              placeholder={!form.committee_id ? 'Select a committee first' : meetingsQ.isLoading ? 'Loading meetings…' : 'No linked meeting'}
              onChange={(e) => set({ meeting_id: e.target.value })}
            >
              {meetings.map((m) => <option key={m.id} value={String(m.id)}>{m.title}</option>)}
            </Select>
          </FormField>
        </div>
        <FormField label="Title" required>
          <TextInput value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Action item title" maxLength={500} required />
        </FormField>
        <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2">
          <FormField label="Action type">
            <Select value={form.action_type} onChange={(e) => set({ action_type: e.target.value })}>
              {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Priority">
            <Select value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
              {priorityChoices(taskSettings).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </FormField>
        </div>
        <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2">
          <FormField
            label="Due date"
            optional
            hint={!form.due_date && slaDays(taskSettings, form.priority) != null ? `Left blank, it is due ${slaDays(taskSettings, form.priority)} days from today (the ${form.priority} SLA).` : undefined}
          >
            <TextInput type="date" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} />
          </FormField>
          <PickerField label="Assign to" optional>
            <MultiSelectDropdown
              title="Assign To"
              items={userItems}
              selectedValues={form.assigned_to ? [form.assigned_to] : []}
              onApply={(values) => set({ assigned_to: values[0] || '' })}
              multiSelect={false}
              autoApply
              triggerVariant="input"
              forceSearch
              size="sm"
              triggerClassName="w-full"
              placeholder="Leave unassigned"
            />
          </PickerField>
        </div>
        <FormField label="Description" optional>
          <Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={5} placeholder="Describe the action item" />
        </FormField>
        <fieldset className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
          <legend className="px-[4px] text-ds-label text-ds-fg">AI assistant</legend>
          <div className="flex flex-col gap-[12px]">
            <FormField label="Reference file" optional>
              <FileInput accept=".txt,.md,.csv,.json,.pdf,.doc,.docx" onPick={setAiFile} />
            </FormField>
            <div className="flex flex-wrap gap-[8px]">
              <Button leftIcon={<Sparkles aria-hidden />} loading={reword.isPending} disabled={summarise.isPending || (!form.description.trim() && !aiFile)} onClick={() => reword.mutate()}>AI reword</Button>
              <Button leftIcon={<Upload aria-hidden />} loading={summarise.isPending} disabled={reword.isPending || (!form.description.trim() && !aiFile)} onClick={() => summarise.mutate()}>Generate summary</Button>
            </div>
          </div>
        </fieldset>
      </form>
    </RightSlidePanel>
  );
}
