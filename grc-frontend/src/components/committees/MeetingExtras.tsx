'use client';

// The three smaller sections of the meeting workspace: Minutes (draft them, or upload a document whose text becomes the draft), Actions (the actions this meeting made, and a
// new one) and Papers (the documents attached to the meeting: agenda packets, decks, spreadsheets). Lifted from the old meeting page: the same requests, query keys and words;
// every write is a useReportedMutation (the confirmation comes after the server answered; a failure stays with the server's words and a Retry where repeating helps), every
// question a useConfirm, every drawer asks before it throws typing away. An inactive committee takes no new action (the server answers 400): it says so instead.
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare, Download, FileText, Paperclip, Plus, Save, Trash2, Upload } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import {
  Button, ClampedText, EmptyState, ErrorState, FormField, IconButton, PersonChip, Select, SkeletonLines, StatusPill, Textarea, TextInput,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useConfirm } from '@/components/ui/ds/useConfirm';
import { useNotify } from '@/components/ui/ds/useNotify';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { formatCount, formatDate, statusLabel, truncate } from '@/lib/format';
import { ACTION_TYPES, cutNotice, dueDay, formChanged, listOf } from '@/lib/committees';
import { useTenantUsers } from './people';
import { ActionStatusPills, DrawerFooter, FormProblem, PickerField } from './ui';
import { Section } from './MeetingSection';
import { formatFileSize, type Meeting, type MeetingAction, type MeetingAttachment } from './meetingTypes';

// ── minutes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function MinutesSection({ meeting, canCreate }: { meeting: Meeting; canCreate: boolean }) {
  const meetingId = meeting.id;
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const upload = useRef<HTMLInputElement | null>(null);
  const hasMinutes = Boolean(meeting.has_minutes || meeting.minutes);
  const save = useReportedMutation({
    mutationFn: (data: { content: string }) => committeeApi.createMinutes(meetingId, data),
    success: 'Minutes saved',
    failure: "Couldn't save the minutes",
    invalidate: [['meeting', meetingId], ['committee-meetings']],
    onSuccess: () => setEditing(false),
  });
  // a PDF / DOCX / TXT: the server extracts the text and saves it as the minutes (it replaces existing minutes, dropping a prior approval back to draft)
  const send = useReportedMutation({
    mutationFn: (file: File) => committeeApi.uploadMinutesDoc(meetingId, file),
    success: (r) => ((r as { data?: { replaced_existing?: boolean } }).data?.replaced_existing
      ? { title: 'Minutes replaced from the document', message: 'The previous content was overwritten and dropped back to draft.' }
      : { title: 'Minutes uploaded', message: 'The document was extracted into draft minutes. Edit them to refine.' }),
    failure: "Couldn't upload the minutes",
    fallback: 'Try a text-based PDF, DOCX or TXT.',
    retryable: false,
    invalidate: [['meeting', meetingId], ['committee-meetings']],
    onSuccess: () => setEditing(false),
  });
  const m = meeting.minutes;
  const tools = canCreate && !editing ? (
    <>
      <input
        ref={upload}
        type="file"
        accept=".pdf,.doc,.docx,.txt,.md,.rtf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,application/rtf"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => { const file = e.target.files?.[0]; if (file) send.mutate(file); if (e.target) e.target.value = ''; }}
      />
      <Button size="sm" leftIcon={<Upload aria-hidden />} loading={send.isPending} onClick={() => upload.current?.click()}
        title={hasMinutes ? 'Upload a document to replace the current minutes (drops back to draft)' : 'Upload a PDF, DOCX or TXT: its text becomes the draft minutes'}>
        {send.isPending ? 'Uploading…' : hasMinutes ? 'Upload to replace' : 'Upload minutes'}
      </Button>
      {hasMinutes
        ? <Button size="sm" leftIcon={<Save aria-hidden />} onClick={() => { setContent(m?.content ?? ''); setEditing(true); }}>Edit minutes</Button>
        : <Button size="sm" leftIcon={<Plus aria-hidden />} onClick={() => { setContent(''); setEditing(true); }}>Draft minutes</Button>}
    </>
  ) : undefined;
  return (
    <Section id="minutes" title="Minutes" count={hasMinutes ? 'drafted' : undefined} tools={tools}>
      {editing ? (
        <div className="space-y-[12px]">
          <FormField label="Minutes">
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} placeholder="Record the meeting minutes here…" />
          </FormField>
          <div className="flex justify-end gap-[8px]">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" leftIcon={<Save aria-hidden />} loading={save.isPending} disabled={!content.trim()} onClick={() => save.mutate({ content })}>{save.isPending ? 'Saving…' : 'Save draft'}</Button>
          </div>
        </div>
      ) : hasMinutes && m?.content ? (
        <div className="space-y-[8px]">
          <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px] text-ds-label font-normal text-ds-fg-muted">
            {m.status && <StatusPill size="sm" tone={m.status === 'approved' ? 'success' : 'neutral'} label={statusLabel(m.status)} />}
            {m.drafter_name && <span>Drafted by {m.drafter_name}</span>}
            {m.drafted_at && <span>· {formatDate(m.drafted_at)}</span>}
          </div>
          <div className="rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[16px] py-[12px]"><ClampedText text={m.content} lines={12} /></div>
        </div>
      ) : hasMinutes ? (
        <EmptyState kind="firstUse" bare icon={FileText} title="Minutes recorded" description="Minutes have been saved for this meeting." />
      ) : (
        <EmptyState kind="firstUse" bare icon={FileText} title="No minutes yet" action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => { setContent(''); setEditing(true); }}>Draft minutes</Button> : undefined} />
      )}
    </Section>
  );
}

// ── actions ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const NEW_ACTION = { title: '', description: '', action_type: 'follow_up', due_date: '', assigned_to: '' };

export function ActionsSection({ meeting, canCreate, takesActions }: { meeting: Meeting; canCreate: boolean; takesActions: boolean }) {
  const meetingId = meeting.id;
  const { items: userItems } = useTenantUsers();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(NEW_ACTION);
  // the committee's first 100 actions (the API's cap), cut down to this meeting's: the meeting's own count (`action_count`) is what the heading says
  const actionsQ = useQuery<MeetingAction[]>({
    queryKey: ['meeting-actions', meetingId],
    queryFn: async () => {
      const res = await committeeApi.getActions({ committee_id: meeting.committee_id });
      return listOf<MeetingAction>(res.data).items.filter((a) => a.meeting_id === meetingId);
    },
  });
  const actions = actionsQ.data ?? [];
  const count = meeting.action_count ?? actions.length;
  const cut = cutNotice({ shown: actions.length, total: count, noun: 'actions' });
  const create = useReportedMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.createAction(meetingId, data),
    success: (_r, v) => ({ title: 'Action created', message: truncate(String(v.title), 80).text }),
    failure: "Couldn't create the action",
    retryable: false,
    invalidate: [['meeting-actions', meetingId], ['meeting', meetingId], ['committee-lane-actions'], ['committee-overview']],
    onSuccess: () => { setOpen(false); setForm(NEW_ACTION); },
  });
  const close = () => { create.reset(); setOpen(false); };
  const tools = canCreate ? (takesActions
    ? <Button size="sm" leftIcon={<Plus aria-hidden />} onClick={() => setOpen(true)}>Add action</Button>
    : <span className="text-ds-label font-normal text-ds-fg-muted">Committee inactive</span>) : undefined;
  return (
    <Section id="actions" title="Actions" count={formatCount(count)} tools={tools}>
      {actionsQ.isError && !actionsQ.data ? (
        <ErrorState compact title="Couldn't load the actions" message={errorMessage(actionsQ.error)} onRetry={() => { void actionsQ.refetch(); }} />
      ) : actionsQ.isLoading ? (
        <SkeletonLines lines={3} label="Loading the actions" />
      ) : actions.length === 0 ? (
        <EmptyState
          kind="firstUse"
          bare
          icon={CheckSquare}
          title={count > 0 ? 'None of its actions could be loaded here' : 'No actions from this meeting'}
          description={count > 0 ? `The meeting has ${formatCount(count)}; they are among the committee's other actions.` : undefined}
          action={canCreate && takesActions && count === 0 ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setOpen(true)}>Create the first action</Button> : undefined}
        />
      ) : (
        <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border">
          {actions.map((a) => (
            <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-[10px] gap-y-[2px] px-[12px] py-[8px]">
              <span title={a.title} className="line-clamp-2 break-words text-ds-body font-[500] text-ds-fg">{a.title}</span>
              <ActionStatusPills size="sm" action={a} />
              <span className="col-span-2 flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ds-label font-normal text-ds-fg-muted">
                <PersonChip name={a.assignee_name} size={20} className="text-ds-label" />
                {a.due_date && <><span aria-hidden>·</span><span className={a.is_overdue ? 'font-[600] text-ds-danger' : undefined}>Due {dueDay(a.due_date)}</span></>}
                {a.action_number && <><span aria-hidden>·</span><span className="font-mono">{a.action_number}</span></>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {cut && <p className="mt-[8px] text-ds-label font-normal text-ds-fg-muted">{cut}</p>}

      <RightSlidePanel
        isOpen={open}
        onClose={close}
        title="Create action"
        dirty={formChanged(NEW_ACTION, form)}
        footer={<DrawerFooter onCancel={close} form="create-action-form" pending={create.isPending} label="Create action" pendingLabel="Creating…" disabled={!form.title.trim() || !form.due_date} />}
      >
        <form
          id="create-action-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({
              title: form.title,
              description: form.description || undefined,
              action_type: form.action_type,
              due_date: form.due_date || undefined,
              assigned_to: form.assigned_to ? parseInt(form.assigned_to, 10) : null,
            });
          }}
          className="flex flex-col gap-[16px]"
        >
          {create.isError && <FormProblem message={errorMessage(create.error, 'The action could not be created.')} />}
          <FormField label="Title" required>
            <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Action title" maxLength={500} required />
          </FormField>
          <FormField label="Description" optional>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          </FormField>
          <FormField label="Action type">
            <Select value={form.action_type} onChange={(e) => setForm({ ...form, action_type: e.target.value })}>
              {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </FormField>
          <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
            <FormField label="Due date" required>
              <TextInput type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} required />
            </FormField>
            <PickerField label="Assign to" optional>
              <MultiSelectDropdown
                title="Assign To"
                items={userItems}
                selectedValues={form.assigned_to ? [form.assigned_to] : []}
                onApply={(values) => setForm({ ...form, assigned_to: values[0] || '' })}
                multiSelect={false}
                autoApply
                triggerVariant="input"
                forceSearch
                size="sm"
                triggerClassName="w-full"
                placeholder="Unassigned"
              />
            </PickerField>
          </div>
        </form>
      </RightSlidePanel>
    </Section>
  );
}

// ── papers ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function PapersSection({ meeting, canCreate }: { meeting: Meeting; canCreate: boolean }) {
  const meetingId = meeting.id;
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const papersQ = useQuery<MeetingAttachment[]>({
    queryKey: ['meeting-attachments', meetingId],
    queryFn: async () => { const res = await committeeApi.getMeetingAttachments(meetingId); return Array.isArray(res.data) ? res.data : []; },
  });
  const papers = papersQ.data ?? [];
  const send = useReportedMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');
      const body = new FormData();
      body.append('file', file);
      if (note.trim()) body.append('description', note.trim());
      return committeeApi.uploadMeetingAttachment(meetingId, body);
    },
    success: () => ({ title: 'Document uploaded', message: truncate(file?.name ?? '', 80).text || undefined }),
    failure: "Couldn't upload the document",
    invalidate: [['meeting-attachments', meetingId], ['meeting', meetingId], ['committee-meetings']],
    onSuccess: () => { setOpen(false); setFile(null); setNote(''); },
  });
  const remove = useReportedMutation({
    mutationFn: (att: MeetingAttachment) => committeeApi.deleteMeetingAttachment(att.id),
    success: 'Document removed',
    failure: "Couldn't remove the document",
    invalidate: [['meeting-attachments', meetingId], ['meeting', meetingId], ['committee-meetings']],
  });
  const download = async (att: MeetingAttachment) => {
    try {
      const res = await committeeApi.downloadMeetingAttachment(att.id);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = att.file_name || 'attachment';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      notify.error(err, { title: "Couldn't download the document", retry: () => { void download(att); } });
    }
  };
  const askRemove = async (att: MeetingAttachment) => {
    if (await confirm({ title: 'Remove this document?', message: `“${truncate(att.file_name, 120).text}” is removed from the meeting. This cannot be undone.`, confirmLabel: 'Remove document', tone: 'danger' })) remove.mutate(att);
  };
  const close = () => { send.reset(); setOpen(false); setFile(null); setNote(''); };
  return (
    <Section id="papers" title="Papers" count={papersQ.data ? formatCount(papers.length) : undefined} tools={canCreate ? <Button size="sm" leftIcon={<Upload aria-hidden />} onClick={() => setOpen(true)}>Upload document</Button> : undefined}>
      {papersQ.isError && !papersQ.data ? (
        <ErrorState compact title="Couldn't load the documents" message={errorMessage(papersQ.error)} onRetry={() => { void papersQ.refetch(); }} />
      ) : papersQ.isLoading ? (
        <SkeletonLines lines={2} label="Loading the documents" />
      ) : papers.length === 0 ? (
        <EmptyState kind="firstUse" bare icon={Paperclip} title="No papers attached yet" description="Agenda packets, briefing decks, spreadsheets or supporting material."
          action={canCreate ? <Button variant="primary" leftIcon={<Upload aria-hidden />} onClick={() => setOpen(true)}>Upload the first document</Button> : undefined} />
      ) : (
        <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border">
          {papers.map((att) => (
            <li key={att.id} className="flex items-start gap-[12px] px-[12px] py-[8px]">
              <FileText aria-hidden className="mt-[2px] h-[18px] w-[18px] shrink-0 text-ds-primary-text" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="break-all text-ds-body font-medium text-ds-fg">{att.file_name}</p>
                <p className="mt-[2px] text-ds-label font-normal text-ds-fg-muted">
                  {att.file_type ? `${att.file_type.toUpperCase()} · ` : ''}{formatFileSize(att.file_size)}{att.uploaded_by_name ? ` · Uploaded by ${att.uploaded_by_name}` : ''}{att.uploaded_at ? ` · ${formatDate(att.uploaded_at)}` : ''}
                </p>
                {att.description && <p className="mt-[4px] text-ds-body text-ds-fg-body">{att.description}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-[4px]">
                <IconButton label={`Download ${att.file_name}`} onClick={() => { void download(att); }}><Download aria-hidden /></IconButton>
                {canCreate && <IconButton label={`Remove ${att.file_name}`} disabled={remove.isPending} onClick={() => { void askRemove(att); }}><Trash2 aria-hidden /></IconButton>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <RightSlidePanel
        isOpen={open}
        onClose={close}
        title="Upload document"
        dirty={file !== null || note !== ''}
        footer={(
          <div className="flex justify-end gap-[8px]">
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" leftIcon={<Upload aria-hidden />} loading={send.isPending} disabled={!file} onClick={() => send.mutate()}>{send.isPending ? 'Uploading…' : 'Upload'}</Button>
          </div>
        )}
      >
        <div className="flex flex-col gap-[16px]">
          {send.isError && <FormProblem message={errorMessage(send.error, 'The document could not be uploaded.')} />}
          <p className="text-ds-body text-ds-fg-body">Attach agenda packets, briefing decks, supporting spreadsheets or any meeting documents (PDF, DOCX, XLSX, PPTX, images and more).</p>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-ds-card border-2 border-dashed border-ds-border-strong bg-ds-surface-subtle px-[24px] py-[32px] text-center focus-within:shadow-ds-ring hover:bg-ds-primary-soft">
            <Upload aria-hidden className="mb-[8px] h-[28px] w-[28px] text-ds-fg-muted" strokeWidth={1.5} />
            {file ? (
              <>
                <span className="break-all text-ds-body font-medium text-ds-fg">{file.name}</span>
                <span className="mt-[4px] text-ds-label font-normal text-ds-fg-muted">{formatFileSize(file.size)} · choose a different file</span>
              </>
            ) : (
              <>
                <span className="text-ds-body font-medium text-ds-fg">Choose a file</span>
                <span className="mt-[4px] text-ds-label font-normal text-ds-fg-muted">PDF, DOCX, XLSX, PPTX, images and more</span>
              </>
            )}
            <input type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <FormField label="Description" optional>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="A short note about what this document contains…" />
          </FormField>
        </div>
      </RightSlidePanel>
      {confirmDialog}
    </Section>
  );
}

