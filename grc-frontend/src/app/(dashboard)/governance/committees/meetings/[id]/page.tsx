'use client';

// Governance > Committees > a meeting: its agenda (with a vote on each item), minutes, attached documents, actions and details.
// The data flow is what it has always been (the same requests, query keys and invalidations; one votes request per agenda item stays as it is). On the
// design-system kit (components/ui/ds): the page head, the summary tiles (one column on a phone), the pills, drawers that ask "Discard changes?", every write a
// useReportedMutation (a confirmation only after the server answered; a failure stays with the server's words and, where repeating helps, Retry), every
// question a useConfirm. Edit and remove are buttons you can see (they were icons that appeared only under the mouse, so a keyboard or a phone never met them).
// What is NOT here, on purpose: a meeting cannot be started, completed, rescheduled or cancelled, and attendance and the approval of minutes cannot be
// recorded. That is the meeting life cycle, separate work (committeeApi.updateMeeting and updateMinutes have no callers); the page says "Not recorded" for what
// it would fill and invents no transition. Quorum present is therefore always "Not recorded".
import { useRef, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import {
  Calendar, CheckSquare, ChevronRight, Download, FileCheck, FileText, Lightbulb, Link as LinkIcon, ListOrdered, MapPin, Paperclip, Pencil, Plus, Save, Scale, Shield, Sparkles,
  Trash2, Upload, Users,
} from 'lucide-react';
import { committeeApi, apiClient } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import {
  Button, Checkbox, ErrorState, FormField, IconButton, PersonChip, Select, Skeleton, SkeletonLines, StatusPill, Textarea, TextInput, type StatusPillProps,
} from '@/components/ui/ds';
import { errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { useConfirm } from '@/components/ui/ds/useConfirm';
import { useNotify } from '@/components/ui/ds/useNotify';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { formatCount, formatDate, moreCount, statusLabel, truncate } from '@/lib/format';
import { meetingStatus, statusPill } from '@/lib/status';
import { ACTION_TYPES, cutNotice, dueDay, formChanged, listOf, meetingWhen } from '@/lib/committees';
import { ActionStatusPills, ClampedText, DrawerFooter, FormProblem, NotRecorded, PickerField, StatTile } from '../../_ui';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Meeting {
  id: number;
  committee_id: number;
  committee_name?: string;
  title: string;
  meeting_type: string;
  scheduled_date: string;
  location?: string;
  virtual_link?: string;
  status: string;
  quorum_required?: number;
  quorum_present?: number;
  agenda_item_count?: number;
  action_count?: number;
  has_minutes?: boolean;
  minutes?: {
    id?: number;
    content?: string;
    status?: string;
    drafter_name?: string;
    drafted_at?: string;
  } | null;
}

interface AgendaItem {
  id: number;
  meeting_id: number;
  item_number: number;
  title: string;
  description?: string;
  presenter_name?: string;
  time_allocated_minutes?: number;
  item_type: string;
  status: string;
  source_type?: string;
  linked_document_id?: number;
  linked_document_title?: string;
  linked_risk_id?: number;
  linked_risk_title?: string;
  linked_regulatory_change_id?: number;
  linked_regulatory_change_title?: string;
  outcome?: string;
  decision_made?: string;
}

interface SuggestedItem {
  source_type: string;
  source_id: number;
  title: string;
  description?: string;
  item_type: string;
  linked_document_id?: number;
  linked_risk_id?: number;
  linked_regulatory_change_id?: number;
  effective_date?: string;
}

interface Action {
  id: number;
  title: string;
  description?: string;
  action_type: string;
  action_number?: string;
  meeting_id?: number;
  status: string;
  due_date?: string;
  assignee_name?: string;
  is_overdue?: boolean;
}

interface TenantUser {
  id?: number;
  user_id?: number;
  display_name?: string;
  username?: string;
  email?: string;
  user?: { id?: number; display_name?: string; username?: string; email?: string };
}

interface MeetingAttachment {
  id: number;
  meeting_id: number;
  file_name: string;
  file_type?: string | null;
  file_size?: number | null;
  description?: string | null;
  uploaded_by_name?: string | null;
  uploaded_at?: string | null;
}

function formatFileSize(bytes?: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const AGENDA_TONE: Record<string, StatusPillProps['tone']> = { pending: 'neutral', discussed: 'success', deferred: 'warning' };
const SOURCE_LABEL: Record<string, string> = { document: 'Document', exception: 'Exception', regulatory_change: 'Regulatory change', manual: 'Manual' };

const ITEM_TYPES = [
  { value: 'procedural', label: 'Procedural' },
  { value: 'approval', label: 'Approval' },
  { value: 'discussion', label: 'Discussion' },
  { value: 'information', label: 'Information' },
  { value: 'decision', label: 'Decision' },
];

const NEW_AGENDA = { title: '', description: '', duration_minutes: 15, item_type: 'discussion' };
const NEW_ACTION = { title: '', description: '', action_type: 'follow_up', due_date: '', assigned_to: '' };
const NO_ATTENDANCE = 'Nobody has recorded how many attended: these screens cannot mark a meeting held or enter attendance yet.';
const NO_STATUS_CHANGE = 'A meeting cannot be started, completed or cancelled from these screens yet, so its status stays as it was scheduled.';
const SUB_HEAD = 'text-ds-label text-ds-fg-muted';
const CARD = 'rounded-ds-card border border-ds-border bg-ds-surface';

/** The related records of an agenda item: the first two, and "+N" for the rest (a press shows them). */
function LinkChips({ links }: { links: { type: string; title: string; icon: React.ElementType }[] }) {
  const [open, setOpen] = useState(false);
  const { shown, rest, more } = moreCount(links, 2);
  const list = open ? shown.concat(rest) : shown;
  return (
    <div className="mt-[8px] flex flex-wrap items-center gap-[6px]">
      {list.map((link, i) => {
        const Icon = link.icon;
        return (
          <span key={i} className="inline-flex max-w-full items-center gap-[4px] rounded-ds-control bg-ds-surface-hover px-[8px] py-[2px] text-ds-label font-normal text-ds-fg-body">
            <Icon aria-hidden className="h-[14px] w-[14px] shrink-0" />
            <span className="break-words [overflow-wrap:anywhere]">{link.type}: {link.title}</span>
          </span>
        );
      })}
      {more > 0 && (
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Show fewer related records' : `Show ${more} more related ${more === 1 ? 'record' : 'records'}`}
          onClick={() => setOpen(!open)}
          className="inline-flex h-[24px] min-w-[24px] items-center justify-center rounded-full border border-ds-border-strong bg-ds-surface-hover px-[6px] text-ds-label text-ds-fg-body hover:bg-ds-border focus-visible:outline-none focus-visible:shadow-ds-ring"
        >
          {open ? 'Less' : `+${more}`}
        </button>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MeetingDetailPage() {
  const params = useParams();
  const meetingId = parseInt(params.id as string);
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:committees:create');
  const [isAddAgendaOpen,    setIsAddAgendaOpen]    = useState(false);
  const [isAddActionOpen,    setIsAddActionOpen]    = useState(false);
  const [isAutoPopulateOpen, setIsAutoPopulateOpen] = useState(false);
  const [isEditMinutesOpen,  setIsEditMinutesOpen]  = useState(false);
  const [minutesContent,     setMinutesContent]     = useState('');

  const [autoPopulateOptions, setAutoPopulateOptions] = useState({
    include_documents: true,
    include_exceptions: true,
    include_regulatory_changes: true,
  });

  const [newAgendaItem, setNewAgendaItem] = useState(NEW_AGENDA);
  const [newAction, setNewAction] = useState(NEW_ACTION);

  // Edit-agenda-item state: the full draft, so the same drawer used for adding can be used for editing (a PUT).
  const [editingAgendaId, setEditingAgendaId] = useState<number | null>(null);
  const [editAgendaDraft, setEditAgendaDraft] = useState({ title: '', description: '', time_allocated_minutes: 15, item_type: 'discussion' });
  const [editAgendaInitial, setEditAgendaInitial] = useState(editAgendaDraft);

  // Meeting attachments: the file about to be uploaded and its optional description.
  const [attachmentDescription, setAttachmentDescription] = useState('');
  const [pendingAttachment, setPendingAttachment]         = useState<File | null>(null);
  const [isUploadAttachmentOpen, setIsUploadAttachmentOpen] = useState(false);

  // ─── Queries ──────────────────────────────────────────────────────────────

  const { data: meeting, isLoading: meetingLoading, error: meetingError, refetch: refetchMeeting } = useQuery({
    queryKey: ['meeting', meetingId],
    queryFn: async () => {
      const res = await committeeApi.getMeeting(meetingId);
      return res.data as Meeting;
    },
  });

  const agendaQ = useQuery<AgendaItem[]>({
    queryKey: ['meeting-agenda', meetingId],
    queryFn: async () => {
      const res = await committeeApi.getAgenda(meetingId);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!meeting,
  });
  const agenda = agendaQ.data ?? [];

  const suggestedQ = useQuery<SuggestedItem[]>({
    queryKey: ['meeting-suggested', meetingId],
    queryFn: async () => {
      const res = await committeeApi.getSuggestedAgendaItems(meetingId);
      const data = res.data as any;
      // Backend returns { suggested_items: [...], total_count, ... }
      return Array.isArray(data) ? data : (data?.suggested_items ?? []);
    },
    enabled: !!meeting,
  });
  const suggestedItems = suggestedQ.data ?? [];

  // the committee's first 100 actions (the API's cap), cut down to this meeting's: the meeting's own count (`action_count`) is what the tile says
  const actionsQ = useQuery<Action[]>({
    queryKey: ['meeting-actions', meetingId],
    queryFn: async () => {
      if (!meeting?.committee_id) return [];
      const res = await committeeApi.getActions({ committee_id: meeting.committee_id });
      const { items } = listOf<Action>(res.data);
      return items.filter((a) => a.meeting_id === meetingId);
    },
    enabled: !!meeting,
  });
  const actions = actionsQ.data ?? [];

  const attachmentsQ = useQuery<MeetingAttachment[]>({
    queryKey: ['meeting-attachments', meetingId],
    queryFn: async () => {
      const res = await committeeApi.getMeetingAttachments(meetingId);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!meeting,
  });
  const attachments = attachmentsQ.data ?? [];

  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => apiClient.get('/auth/me').then((r) => r.data),
  });

  const tenantId = currentUser?.user?.primary_tenant_id || currentUser?.primary_tenant_id;

  const { data: tenantUsers = [] } = useQuery<TenantUser[]>({
    queryKey: ['tenant-users', tenantId],
    queryFn: async () => {
      const res = await apiClient.get(`/tenants/${tenantId}/users`);
      const d = res.data as any;
      return Array.isArray(d) ? d : (d?.users ?? d?.items ?? []);
    },
    enabled: !!tenantId,
  });

  const normalizedUsers = Array.from(
    new Map(
      tenantUsers
        .map((u) => {
          const id = u.user?.id || u.id || u.user_id;
          const name = u.user?.display_name || u.display_name || u.user?.email || u.email || 'User';
          if (!id) return null;
          return { id, name };
        })
        .filter((u): u is { id: number; name: string } => !!u)
        .map((u) => [u.id, u] as [number, { id: number; name: string }])
    ).values()
  );

  // ─── Writes: each one says what happened only after the server has answered ───

  const addAgendaMutation = useReportedMutation({
    mutationFn: (data: any) => committeeApi.addAgendaItem(meetingId, data),
    success: 'Agenda item added',
    failure: "Couldn't add the agenda item",
    retryable: false,                                              // a create is not safe to repeat blindly: the drawer stays open to try again
    invalidate: [['meeting-agenda', meetingId]],
    onSuccess: () => { setIsAddAgendaOpen(false); setNewAgendaItem(NEW_AGENDA); },
  });

  // Upload + AI-parse: a PDF/DOCX agenda is parsed into items and appended after the highest existing item number.
  const uploadAgendaInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAgendaMutation = useReportedMutation({
    mutationFn: (file: File) => committeeApi.uploadAgendaForParse(meetingId, file),
    success: (r: any) => {
      const count = r?.data?.inserted ?? 0;
      return { title: `Imported ${count} agenda item${count === 1 ? '' : 's'}`, message: 'Edit any item to refine the parsed details.' };
    },
    failure: "Couldn't parse the agenda",
    fallback: 'Try a more structured document or add the items by hand.',
    retryable: false,
    invalidate: [['meeting-agenda', meetingId]],
  });
  const onPickAgendaUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadAgendaMutation.mutate(file);
    if (e.target) e.target.value = '';
  };

  const updateAgendaMutation = useReportedMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => committeeApi.updateAgendaItem(id, data),
    success: 'Agenda item updated',
    failure: "Couldn't update the agenda item",
    invalidate: [['meeting-agenda', meetingId]],
    onSuccess: () => setEditingAgendaId(null),
  });

  const deleteAgendaMutation = useReportedMutation({
    mutationFn: (item: AgendaItem) => committeeApi.deleteAgendaItem(item.id),
    success: 'Agenda item removed',
    failure: "Couldn't remove the agenda item",
    invalidate: [['meeting-agenda', meetingId]],
  });

  const uploadAttachmentMutation = useReportedMutation({
    mutationFn: async () => {
      if (!pendingAttachment) throw new Error('No file selected');
      const formData = new FormData();
      formData.append('file', pendingAttachment);
      if (attachmentDescription.trim()) {
        formData.append('description', attachmentDescription.trim());
      }
      return committeeApi.uploadMeetingAttachment(meetingId, formData);
    },
    success: () => ({ title: 'Document uploaded', message: truncate(pendingAttachment?.name ?? '', 80).text || undefined }),
    failure: "Couldn't upload the document",
    invalidate: [['meeting-attachments', meetingId]],
    onSuccess: () => { setIsUploadAttachmentOpen(false); setPendingAttachment(null); setAttachmentDescription(''); },
  });

  const deleteAttachmentMutation = useReportedMutation({
    mutationFn: (att: MeetingAttachment) => committeeApi.deleteMeetingAttachment(att.id),
    success: 'Document removed',
    failure: "Couldn't remove the document",
    invalidate: [['meeting-attachments', meetingId]],
  });

  const handleDownloadAttachment = async (attachmentId: number, fileName: string) => {
    try {
      const res = await committeeApi.downloadMeetingAttachment(attachmentId);
      const blob = new Blob([res.data]);
      const url  = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || 'attachment';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      notify.error(err, { title: "Couldn't download the document", retry: () => { void handleDownloadAttachment(attachmentId, fileName); } });
    }
  };

  const createActionMutation = useReportedMutation({
    mutationFn: (data: any) => committeeApi.createAction(meetingId, data),
    success: (_r, v) => ({ title: 'Action created', message: truncate(String(v.title), 80).text }),
    failure: "Couldn't create the action",
    retryable: false,
    invalidate: [['meeting-actions', meetingId]],
    onSuccess: () => { setIsAddActionOpen(false); setNewAction(NEW_ACTION); },
  });

  const saveMinutesMutation = useReportedMutation({
    mutationFn: (data: any) => committeeApi.createMinutes(meetingId, data),
    success: 'Minutes saved',
    failure: "Couldn't save the minutes",
    invalidate: [['meeting', meetingId]],
    onSuccess: () => setIsEditMinutesOpen(false),
  });

  // Upload a PDF / DOCX / TXT minutes document: the server extracts the text and saves it as the minutes. It replaces existing minutes (dropping a prior
  // approval back to draft) if a record is already there.
  const uploadMinutesInputRef = useRef<HTMLInputElement | null>(null);
  const uploadMinutesMutation = useReportedMutation({
    mutationFn: (file: File) => committeeApi.uploadMinutesDoc(meetingId, file),
    success: (r: any) => (r?.data?.replaced_existing
      ? { title: 'Minutes replaced from the document', message: 'The previous content was overwritten and dropped back to draft.' }
      : { title: 'Minutes uploaded', message: 'The document was extracted into draft minutes. Edit them to refine.' }),
    failure: "Couldn't upload the minutes",
    fallback: 'Try a text-based PDF, DOCX or TXT.',
    retryable: false,
    invalidate: [['meeting', meetingId]],
    onSuccess: () => setIsEditMinutesOpen(false),
  });
  const onPickMinutesUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMinutesMutation.mutate(file);
    if (e.target) e.target.value = '';
  };

  const autoPopulateMutation = useReportedMutation({
    mutationFn: (opts: typeof autoPopulateOptions) => committeeApi.autoPopulateAgenda(meetingId, opts),
    success: (res: any) => {
      const added = res.data?.items_added ?? res.data?.total_created ?? 0;
      return `${added} item${added !== 1 ? 's' : ''} added to the agenda`;
    },
    failure: "Couldn't fill the agenda",
    retryable: false,
    invalidate: [['meeting-agenda', meetingId], ['meeting-suggested', meetingId]],
    onSuccess: () => setIsAutoPopulateOpen(false),
  });

  const userPickerItems = useMemo(
    () => normalizedUsers.map((u) => ({ value: String(u.id), label: u.name, subLabel: u.name.includes('@') ? u.name : undefined })),
    [normalizedUsers],
  );

  // ─── Questions asked before a change that cannot be taken back ───

  const askRemoveAgendaItem = async (item: AgendaItem) => {
    if (await confirm({
      title: `Remove agenda item ${item.item_number}?`,
      message: `“${truncate(item.title, 120).text}” is removed from the agenda. This cannot be undone. If votes have been cast on it, the server will not remove it.`,
      confirmLabel: 'Remove item',
      tone: 'danger',
    })) deleteAgendaMutation.mutate(item);
  };
  const askRemoveAttachment = async (att: MeetingAttachment) => {
    if (await confirm({
      title: 'Remove this document?',
      message: `“${truncate(att.file_name, 120).text}” is removed from the meeting. This cannot be undone.`,
      confirmLabel: 'Remove document',
      tone: 'danger',
    })) deleteAttachmentMutation.mutate(att);
  };

  // ─── Loading / Error States ───────────────────────────────────────────────

  if (meetingLoading) {
    return (
      <div className="space-y-[16px]" aria-busy="true">
        <Skeleton className="h-[32px] w-[280px]" />
        <Skeleton className="h-[16px] w-[420px]" />
        <div className={`${CARD} p-[16px]`}><SkeletonLines lines={5} label="Loading the meeting" /></div>
      </div>
    );
  }

  if (meetingError || !meeting) {
    const notFound = statusOf(meetingError) === 404;
    return (
      <div className="space-y-[16px]">
        <Button href="/governance/committees" leftIcon={<ChevronRight aria-hidden className="rotate-180" />}>Back to committees</Button>
        <ErrorState
          title={notFound ? 'Meeting not found' : "Couldn't load this meeting"}
          message={notFound ? "It doesn't exist or you don't have access to it." : errorMessage(meetingError)}
          onRetry={notFound ? undefined : () => { void refetchMeeting(); }}
        />
      </div>
    );
  }

  const sortedAgenda = [...agenda].sort((a, b) => a.item_number - b.item_number);
  const agendaCount = meeting.agenda_item_count ?? sortedAgenda.length;
  const actionCount = meeting.action_count ?? actions.length;
  const actionsCut = cutNotice({ shown: actions.length, total: actionCount, noun: 'actions' });
  const hasMinutes = Boolean(meeting.has_minutes || meeting.minutes);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-[16px]">

      {/* ── Header ── */}
      <div>
        <PageHeader
          variant="page"
          title={meeting.title}
          back={{ href: `/governance/committees/${meeting.committee_id}`, label: `Back to ${truncate(meeting.committee_name || 'the committee', 60).text}` }}
          chips={(
            <>
              <StatusPill tone="neutral" label={statusLabel(meeting.meeting_type)} />
              <StatusPill {...statusPill(meetingStatus, meeting.status)} />
              <InfoTip text={NO_STATUS_CHANGE} label="About the meeting status" />
            </>
          )}
        />
        <dl className="mt-[12px] flex flex-wrap items-center gap-x-[20px] gap-y-[8px] text-ds-body text-ds-fg-body">
          <div className="flex items-center gap-[6px]"><dt className="sr-only">When</dt><dd className="inline-flex items-center gap-[6px]"><Calendar aria-hidden className="h-[16px] w-[16px] text-ds-fg-muted" />{meetingWhen(meeting.scheduled_date)}</dd></div>
          {meeting.location && (
            <div className="flex items-center gap-[6px]"><dt className="sr-only">Location</dt><dd className="inline-flex items-center gap-[6px] break-words"><MapPin aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />{meeting.location}</dd></div>
          )}
          {meeting.quorum_required != null && (
            <div className="flex items-center gap-[6px]">
              <dt className="inline-flex items-center gap-[6px] text-ds-fg-muted"><Users aria-hidden className="h-[16px] w-[16px]" />Quorum</dt>
              <dd className="flex flex-wrap items-center gap-x-[8px]">
                {meeting.quorum_required} required
                <span className="text-ds-fg-muted">· present:</span>
                {meeting.quorum_present != null ? meeting.quorum_present : <NotRecorded why={NO_ATTENDANCE} subject="Quorum present" />}
              </dd>
            </div>
          )}
          {meeting.virtual_link && (
            <div className="flex items-center gap-[6px]">
              <dt className="sr-only">Virtual link</dt>
              <dd>
                <a href={meeting.virtual_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-[6px] rounded-ds-control text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
                  <LinkIcon aria-hidden className="h-[16px] w-[16px]" />Virtual link
                </a>
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* ── Summary tiles: one column on a phone ── */}
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
        <StatTile label="Agenda items" icon={ListOrdered} value={formatCount(agendaCount)} />
        <StatTile label="Actions" icon={CheckSquare} value={formatCount(actionCount)} />
        <StatTile label="Suggested items" icon={Lightbulb} value={suggestedQ.isError ? '—' : formatCount(suggestedItems.length)} note={suggestedQ.isError ? "Couldn't load them" : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-3">
        {/* ── Main Column ── */}
        <div className="min-w-0 space-y-[16px] lg:col-span-2">

          {/* Agenda */}
          <section aria-labelledby="agenda-h" className={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-[12px] border-b border-ds-border px-[16px] py-[12px]">
              <h2 id="agenda-h" className="inline-flex items-center gap-[8px] !text-ds-section !text-ds-fg">
                <ListOrdered aria-hidden className="h-[20px] w-[20px] text-ds-fg-muted" strokeWidth={1.75} />
                Agenda
              </h2>
              {canCreate && (
                <div className="flex flex-wrap items-center gap-[8px]">
                  {/* Hidden file input: the "Upload and AI parse" button triggers it. */}
                  <input ref={uploadAgendaInputRef} type="file" accept=".pdf,.doc,.docx,.txt,.md" onChange={onPickAgendaUploadFile} className="hidden" aria-hidden="true" tabIndex={-1} />
                  {suggestedItems.length > 0 && (
                    <Button leftIcon={<Sparkles aria-hidden />} onClick={() => setIsAutoPopulateOpen(true)} title="Add pending approvals, exceptions and regulatory changes to the agenda">
                      Auto-populate ({suggestedItems.length})
                    </Button>
                  )}
                  <Button leftIcon={<Upload aria-hidden />} loading={uploadAgendaMutation.isPending} onClick={() => uploadAgendaInputRef.current?.click()} title="Upload a PDF or DOCX agenda: it is parsed into items by rules and AI">
                    {uploadAgendaMutation.isPending ? 'Parsing…' : 'Upload and AI parse'}
                  </Button>
                  <Button leftIcon={<Plus aria-hidden />} onClick={() => setIsAddAgendaOpen(true)}>Add item</Button>
                </div>
              )}
            </div>

            <div className="divide-y divide-ds-border">
              {agendaQ.isError && !agendaQ.data ? (
                <ErrorState compact title="Couldn't load the agenda" message={errorMessage(agendaQ.error)} onRetry={() => { void agendaQ.refetch(); }} />
              ) : agendaQ.isLoading ? (
                <div className="p-[16px]"><SkeletonLines lines={4} label="Loading the agenda" /></div>
              ) : sortedAgenda.length === 0 ? (
                <div className="flex flex-col items-center px-[16px] py-[32px] text-center">
                  <ListOrdered aria-hidden className="mb-[8px] h-[32px] w-[32px] text-ds-fg-muted" strokeWidth={1.5} />
                  <p className="text-ds-body font-medium text-ds-fg">No agenda items yet</p>
                  {canCreate && <div className="mt-[8px]"><Button variant="link" onClick={() => setIsAddAgendaOpen(true)}>Add the first item</Button></div>}
                </div>
              ) : sortedAgenda.map((item) => {
                const links = [
                  item.linked_document_title          && { type: 'Document',          title: item.linked_document_title,          icon: FileCheck },
                  item.linked_risk_title              && { type: 'Risk exception',    title: item.linked_risk_title,              icon: Shield    },
                  item.linked_regulatory_change_title && { type: 'Regulatory change', title: item.linked_regulatory_change_title, icon: Scale     },
                ].filter(Boolean) as { type: string; title: string; icon: React.ElementType }[];

                return (
                  <div key={item.id} className="px-[16px] py-[16px]">
                    <div className="flex items-start gap-[12px]">
                      <span aria-hidden className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-full bg-ds-surface-hover text-ds-label tabular-nums text-ds-fg-body">{item.item_number}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[8px]">
                          <h3 className="min-w-0 flex-1 basis-[14rem] break-words !text-ds-body !font-[600] !text-ds-fg"><ClampedText text={item.title} max={160} buttonLabel={`agenda item ${item.item_number}`} /></h3>
                          <div className="flex flex-wrap items-center gap-[6px]">
                            {item.source_type && item.source_type !== 'manual' && <span className="text-ds-label font-normal text-ds-fg-muted">{SOURCE_LABEL[item.source_type] ?? statusLabel(item.source_type)}</span>}
                            <StatusPill size="sm" tone={AGENDA_TONE[item.status] ?? 'neutral'} label={statusLabel(item.status || 'pending')} />
                            {canCreate && (
                              <>
                                <IconButton
                                  label={`Edit agenda item ${item.item_number}`}
                                  onClick={() => {
                                    const draft = {
                                      title: item.title,
                                      description: item.description ?? '',
                                      time_allocated_minutes: item.time_allocated_minutes ?? 15,
                                      item_type: item.item_type ?? 'discussion',
                                    };
                                    setEditAgendaInitial(draft);
                                    setEditAgendaDraft(draft);
                                    setEditingAgendaId(item.id);
                                  }}
                                >
                                  <Pencil aria-hidden />
                                </IconButton>
                                <IconButton label={`Remove agenda item ${item.item_number}`} disabled={deleteAgendaMutation.isPending} onClick={() => { void askRemoveAgendaItem(item); }}><Trash2 aria-hidden /></IconButton>
                              </>
                            )}
                          </div>
                        </div>
                        {item.description && (
                          <p className="mt-[4px] text-ds-body text-ds-fg-body"><ClampedText text={item.description} max={240} buttonLabel={`the description of agenda item ${item.item_number}`} /></p>
                        )}
                        <div className="mt-[6px] flex flex-wrap items-center gap-x-[16px] gap-y-[2px] text-ds-label font-normal text-ds-fg-muted">
                          {item.presenter_name         && <span>Presenter: {item.presenter_name}</span>}
                          {item.time_allocated_minutes && <span>{item.time_allocated_minutes} min</span>}
                          <span>{statusLabel(item.item_type)}</span>
                        </div>
                        {links.length > 0 && <LinkChips links={links} />}
                        {item.decision_made && (
                          <div className="mt-[8px] rounded-ds-control border border-ds-border bg-ds-success-soft px-[12px] py-[6px] text-ds-body text-ds-fg">
                            <span className="font-medium">Decision:</span> {item.decision_made}
                          </div>
                        )}
                        {/* Voting panel: committee members cast an agree / partial / disagree / abstain vote with an optional comment. The tally and each
                            vote are visible to everyone in the tenant. */}
                        <AgendaVotePanel itemId={item.id} itemNumber={item.item_number} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Minutes */}
          <section aria-labelledby="minutes-h" className={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-[12px] border-b border-ds-border px-[16px] py-[12px]">
              <h2 id="minutes-h" className="inline-flex items-center gap-[8px] !text-ds-section !text-ds-fg">
                <FileText aria-hidden className="h-[20px] w-[20px] text-ds-fg-muted" strokeWidth={1.75} />
                Meeting minutes
              </h2>
              {!isEditMinutesOpen && canCreate && (
                <div className="flex flex-wrap items-center gap-[8px]">
                  {/* Hidden file input: the Upload button below triggers it. Accepts PDF, Word, plain text, markdown and RTF; the server extracts the text and
                      stores it as the draft minutes. */}
                  <input
                    ref={uploadMinutesInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.txt,.md,.rtf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,application/rtf"
                    className="hidden"
                    aria-hidden="true"
                    tabIndex={-1}
                    onChange={onPickMinutesUploadFile}
                  />
                  <Button
                    leftIcon={<Upload aria-hidden />}
                    loading={uploadMinutesMutation.isPending}
                    onClick={() => uploadMinutesInputRef.current?.click()}
                    title={hasMinutes ? 'Upload a document to replace the current minutes (drops back to draft)' : 'Upload a PDF, DOCX or TXT: its text becomes the draft minutes'}
                  >
                    {uploadMinutesMutation.isPending ? 'Uploading…' : hasMinutes ? 'Upload to replace' : 'Upload minutes'}
                  </Button>
                  {hasMinutes ? (
                    <Button leftIcon={<Save aria-hidden />} onClick={() => { setMinutesContent(meeting.minutes?.content ?? ''); setIsEditMinutesOpen(true); }}>Edit minutes</Button>
                  ) : (
                    <Button leftIcon={<Plus aria-hidden />} onClick={() => setIsEditMinutesOpen(true)}>Draft minutes</Button>
                  )}
                </div>
              )}
            </div>

            <div className="p-[16px]">
              {isEditMinutesOpen ? (
                <div className="space-y-[12px]">
                  <FormField label="Minutes">
                    <Textarea value={minutesContent} onChange={(e) => setMinutesContent(e.target.value)} rows={8} placeholder="Record the meeting minutes here…" />
                  </FormField>
                  <div className="flex justify-end gap-[8px]">
                    <Button onClick={() => setIsEditMinutesOpen(false)}>Cancel</Button>
                    <Button variant="primary" leftIcon={<Save aria-hidden />} loading={saveMinutesMutation.isPending} disabled={!minutesContent.trim()} onClick={() => saveMinutesMutation.mutate({ content: minutesContent })}>
                      {saveMinutesMutation.isPending ? 'Saving…' : 'Save draft'}
                    </Button>
                  </div>
                </div>
              ) : hasMinutes && meeting.minutes?.content ? (
                <div className="space-y-[8px]">
                  <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px] text-ds-label font-normal text-ds-fg-muted">
                    {meeting.minutes.drafter_name && <span>Drafted by {meeting.minutes.drafter_name}</span>}
                    {meeting.minutes.drafted_at && <span>· {formatDate(meeting.minutes.drafted_at)}</span>}
                    {meeting.minutes.status && <StatusPill size="sm" tone={meeting.minutes.status === 'approved' ? 'success' : 'neutral'} label={statusLabel(meeting.minutes.status)} />}
                  </div>
                  <div className="whitespace-pre-wrap rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[16px] py-[12px] text-ds-body text-ds-fg">
                    <ClampedText text={meeting.minutes.content} max={1200} buttonLabel="the minutes" />
                  </div>
                </div>
              ) : hasMinutes ? (
                <div className="py-[16px] text-center">
                  <FileText aria-hidden className="mx-auto mb-[8px] h-[32px] w-[32px] text-ds-success" strokeWidth={1.5} />
                  <p className="text-ds-body font-medium text-ds-fg">Minutes recorded</p>
                  <p className="mt-[4px] text-ds-body text-ds-fg-muted">Minutes have been saved for this meeting.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center py-[24px] text-center">
                  <FileText aria-hidden className="mb-[8px] h-[32px] w-[32px] text-ds-fg-muted" strokeWidth={1.5} />
                  <p className="text-ds-body font-medium text-ds-fg">No minutes yet</p>
                  {canCreate && <div className="mt-[8px]"><Button variant="link" onClick={() => setIsEditMinutesOpen(true)}>Draft minutes</Button></div>}
                </div>
              )}
            </div>
          </section>

          {/* Documents / Attachments */}
          <section aria-labelledby="documents-h" className={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-[12px] border-b border-ds-border px-[16px] py-[12px]">
              <h2 id="documents-h" className="inline-flex items-center gap-[8px] !text-ds-section !text-ds-fg">
                <Paperclip aria-hidden className="h-[20px] w-[20px] text-ds-fg-muted" strokeWidth={1.75} />
                Documents
                <span className="text-ds-body font-normal text-ds-fg-muted">{attachmentsQ.data ? `(${attachments.length})` : ''}</span>
              </h2>
              {canCreate && <Button leftIcon={<Upload aria-hidden />} onClick={() => setIsUploadAttachmentOpen(true)}>Upload</Button>}
            </div>

            <div className="divide-y divide-ds-border">
              {attachmentsQ.isError && !attachmentsQ.data ? (
                <ErrorState compact title="Couldn't load the documents" message={errorMessage(attachmentsQ.error)} onRetry={() => { void attachmentsQ.refetch(); }} />
              ) : attachmentsQ.isLoading ? (
                <div className="p-[16px]"><SkeletonLines lines={2} label="Loading the documents" /></div>
              ) : attachments.length === 0 ? (
                <div className="flex flex-col items-center px-[16px] py-[32px] text-center">
                  <Paperclip aria-hidden className="mb-[8px] h-[32px] w-[32px] text-ds-fg-muted" strokeWidth={1.5} />
                  <p className="text-ds-body font-medium text-ds-fg">No documents attached yet</p>
                  <p className="mt-[4px] text-ds-label font-normal text-ds-fg-muted">Agenda packets, briefing decks, spreadsheets or supporting material.</p>
                  {canCreate && <div className="mt-[8px]"><Button variant="link" onClick={() => setIsUploadAttachmentOpen(true)}>Upload the first document</Button></div>}
                </div>
              ) : attachments.map((att) => (
                <div key={att.id} className="flex items-start gap-[12px] px-[16px] py-[12px]">
                  <span aria-hidden className="grid h-[36px] w-[36px] shrink-0 place-items-center rounded-ds-card bg-ds-primary-soft text-ds-primary-text"><FileText className="h-[18px] w-[18px]" strokeWidth={1.75} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-ds-body font-medium text-ds-fg">{att.file_name}</p>
                    <p className="mt-[2px] text-ds-label font-normal text-ds-fg-muted">
                      {att.file_type ? `${att.file_type.toUpperCase()} · ` : ''}
                      {formatFileSize(att.file_size ?? undefined)}
                      {att.uploaded_by_name ? ` · Uploaded by ${att.uploaded_by_name}` : ''}
                      {att.uploaded_at ? ` · ${formatDate(att.uploaded_at)}` : ''}
                    </p>
                    {att.description && <p className="mt-[4px] text-ds-body text-ds-fg-body">{att.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-[4px]">
                    <IconButton label={`Download ${att.file_name}`} onClick={() => { void handleDownloadAttachment(att.id, att.file_name); }}><Download aria-hidden /></IconButton>
                    {canCreate && <IconButton label={`Remove ${att.file_name}`} disabled={deleteAttachmentMutation.isPending} onClick={() => { void askRemoveAttachment(att); }}><Trash2 aria-hidden /></IconButton>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ── Sidebar ── */}
        <div className="min-w-0 space-y-[16px]">

          {/* Actions */}
          <section aria-labelledby="actions-h" className={CARD}>
            <div className="flex items-center justify-between gap-[8px] border-b border-ds-border px-[16px] py-[12px]">
              <h2 id="actions-h" className="inline-flex items-center gap-[8px] !text-ds-section !text-ds-fg">
                <CheckSquare aria-hidden className="h-[20px] w-[20px] text-ds-fg-muted" strokeWidth={1.75} />
                Actions
              </h2>
              {canCreate && <IconButton label="Create action" variant="secondary" onClick={() => setIsAddActionOpen(true)}><Plus aria-hidden /></IconButton>}
            </div>

            <div className="divide-y divide-ds-border">
              {actionsQ.isError && !actionsQ.data ? (
                <ErrorState compact title="Couldn't load the actions" message={errorMessage(actionsQ.error)} onRetry={() => { void actionsQ.refetch(); }} />
              ) : actionsQ.isLoading ? (
                <div className="p-[16px]"><SkeletonLines lines={3} label="Loading the actions" /></div>
              ) : actions.length === 0 ? (
                <div className="flex flex-col items-center px-[16px] py-[24px] text-center">
                  <CheckSquare aria-hidden className="mb-[8px] h-[28px] w-[28px] text-ds-fg-muted" strokeWidth={1.5} />
                  <p className="text-ds-body font-medium text-ds-fg">{actionCount > 0 ? 'None of its actions could be loaded here' : 'No actions yet'}</p>
                  {actionCount > 0 && <p className="mt-[4px] text-ds-label font-normal text-ds-fg-muted">The meeting has {formatCount(actionCount)}; they are among the committee&apos;s other actions.</p>}
                  {canCreate && actionCount === 0 && <div className="mt-[8px]"><Button variant="link" onClick={() => setIsAddActionOpen(true)}>Create the first action</Button></div>}
                </div>
              ) : actions.map((action) => (
                <div key={action.id} className="px-[16px] py-[12px]">
                  <div className="flex items-start justify-between gap-[8px]">
                    <p className="min-w-0 break-words text-ds-body font-medium text-ds-fg">{action.title}</p>
                    <ActionStatusPills size="sm" action={action} />
                  </div>
                  <div className="mt-[6px] flex flex-col items-start gap-[2px] text-ds-label font-normal text-ds-fg-muted">
                    {action.due_date && <span>Due {dueDay(action.due_date)}</span>}
                    <PersonChip name={action.assignee_name} size={20} />
                    {action.action_number && <span className="font-mono">{action.action_number}</span>}
                  </div>
                </div>
              ))}
            </div>
            {actionsCut && <p className="border-t border-ds-border px-[16px] py-[10px] text-ds-label font-normal text-ds-fg-muted">{actionsCut}</p>}
          </section>

          {/* Meeting Info */}
          <section aria-labelledby="details-h" className={`${CARD} p-[16px]`}>
            <h2 id="details-h" className="!text-ds-section !text-ds-fg">Meeting details</h2>
            <dl className="mt-[12px] space-y-[8px] text-ds-body">
              <div className="flex justify-between gap-[12px]"><dt className="text-ds-fg-muted">Type</dt><dd className="text-ds-fg">{statusLabel(meeting.meeting_type)}</dd></div>
              <div className="flex justify-between gap-[12px]"><dt className="text-ds-fg-muted">Status</dt><dd><StatusPill size="sm" {...statusPill(meetingStatus, meeting.status)} /></dd></div>
              <div className="flex justify-between gap-[12px]"><dt className="text-ds-fg-muted">Date</dt><dd className="text-ds-fg">{meetingWhen(meeting.scheduled_date)}</dd></div>
              {meeting.quorum_required != null && (
                <div className="flex justify-between gap-[12px]"><dt className="text-ds-fg-muted">Quorum</dt><dd className="text-ds-fg">{meeting.quorum_required}</dd></div>
              )}
              {meeting.location && (
                <div className="flex justify-between gap-[12px]"><dt className="shrink-0 text-ds-fg-muted">Location</dt><dd className="min-w-0 break-words text-right text-ds-fg">{meeting.location}</dd></div>
              )}
            </dl>
          </section>
        </div>
      </div>

      {/* ── Panels ── */}

      {/* Auto-Populate Panel */}
      <RightSlidePanel
        isOpen={isAutoPopulateOpen}
        onClose={() => { autoPopulateMutation.reset(); setIsAutoPopulateOpen(false); }}
        title="Auto-populate the agenda"
        footer={(
          <div className="flex justify-end gap-[8px]">
            <Button onClick={() => { autoPopulateMutation.reset(); setIsAutoPopulateOpen(false); }}>Cancel</Button>
            <Button
              variant="primary"
              leftIcon={<Sparkles aria-hidden />}
              loading={autoPopulateMutation.isPending}
              disabled={!autoPopulateOptions.include_documents && !autoPopulateOptions.include_exceptions && !autoPopulateOptions.include_regulatory_changes}
              onClick={() => autoPopulateMutation.mutate(autoPopulateOptions)}
            >
              {autoPopulateMutation.isPending ? 'Populating…' : 'Populate agenda'}
            </Button>
          </div>
        )}
      >
        <div className="space-y-[12px]">
          {autoPopulateMutation.isError && <FormProblem message={errorMessage(autoPopulateMutation.error, 'The agenda could not be filled.')} />}
          <p className="text-ds-body text-ds-fg-body">Add the relevant pending items to the agenda. Choose which kinds to include.</p>
          {([
            { key: 'include_documents'          as const, label: 'Pending document approvals', desc: 'Documents awaiting committee approval', Icon: FileCheck },
            { key: 'include_exceptions'         as const, label: 'Risk exceptions',             desc: 'Exceptions pending review',             Icon: Shield    },
            { key: 'include_regulatory_changes' as const, label: 'Regulatory changes',          desc: 'Updates under assessment',              Icon: Scale     },
          ] as const).map(({ key, label, desc, Icon }) => (
            <div key={key} className="rounded-ds-card border border-ds-border px-[12px]">
              <Checkbox
                checked={autoPopulateOptions[key]}
                onChange={(e) => setAutoPopulateOptions({ ...autoPopulateOptions, [key]: e.target.checked })}
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

      {/* Add Agenda Item Panel */}
      <RightSlidePanel
        isOpen={isAddAgendaOpen}
        onClose={() => { addAgendaMutation.reset(); setIsAddAgendaOpen(false); }}
        title="Add agenda item"
        dirty={formChanged(NEW_AGENDA, newAgendaItem)}
        footer={<DrawerFooter onCancel={() => { addAgendaMutation.reset(); setIsAddAgendaOpen(false); }} form="add-agenda-form" pending={addAgendaMutation.isPending} label="Add item" pendingLabel="Adding…" disabled={!newAgendaItem.title.trim()} />}
      >
        <form
          id="add-agenda-form"
          onSubmit={(e) => {
            e.preventDefault();
            addAgendaMutation.mutate({
              title: newAgendaItem.title,
              description: newAgendaItem.description || undefined,
              duration_minutes: newAgendaItem.duration_minutes,
              item_type: newAgendaItem.item_type,
            });
          }}
          className="flex flex-col gap-[16px]"
        >
          {addAgendaMutation.isError && <FormProblem message={errorMessage(addAgendaMutation.error, 'The agenda item could not be added.')} />}
          <FormField label="Title" required>
            <TextInput value={newAgendaItem.title} onChange={(e) => setNewAgendaItem({ ...newAgendaItem, title: e.target.value })} placeholder="Agenda item title" maxLength={500} required />
          </FormField>
          <FormField label="Description" optional>
            <Textarea value={newAgendaItem.description} onChange={(e) => setNewAgendaItem({ ...newAgendaItem, description: e.target.value })} rows={3} placeholder="Optional description" />
          </FormField>
          <div className="grid grid-cols-2 gap-[16px]">
            <FormField label="Type">
              <Select value={newAgendaItem.item_type} onChange={(e) => setNewAgendaItem({ ...newAgendaItem, item_type: e.target.value })}>
                {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Duration">
              <TextInput type="number" min={1} unit="min" value={newAgendaItem.duration_minutes} onChange={(e) => setNewAgendaItem({ ...newAgendaItem, duration_minutes: parseInt(e.target.value) || 15 })} />
            </FormField>
          </div>
        </form>
      </RightSlidePanel>

      {/* Create Action Panel */}
      <RightSlidePanel
        isOpen={isAddActionOpen}
        onClose={() => { createActionMutation.reset(); setIsAddActionOpen(false); }}
        title="Create action"
        dirty={formChanged(NEW_ACTION, newAction)}
        footer={<DrawerFooter onCancel={() => { createActionMutation.reset(); setIsAddActionOpen(false); }} form="create-action-form" pending={createActionMutation.isPending} label="Create action" pendingLabel="Creating…" disabled={!newAction.title.trim() || !newAction.due_date} />}
      >
        <form
          id="create-action-form"
          onSubmit={(e) => {
            e.preventDefault();
            createActionMutation.mutate({
              title: newAction.title,
              description: newAction.description || undefined,
              action_type: newAction.action_type,
              due_date: newAction.due_date || undefined,
              assigned_to: newAction.assigned_to ? parseInt(newAction.assigned_to as string) : null,
            });
          }}
          className="flex flex-col gap-[16px]"
        >
          {createActionMutation.isError && <FormProblem message={errorMessage(createActionMutation.error, 'The action could not be created.')} />}
          <FormField label="Title" required>
            <TextInput value={newAction.title} onChange={(e) => setNewAction({ ...newAction, title: e.target.value })} placeholder="Action title" maxLength={500} required />
          </FormField>
          <FormField label="Description" optional>
            <Textarea value={newAction.description} onChange={(e) => setNewAction({ ...newAction, description: e.target.value })} rows={2} />
          </FormField>
          <FormField label="Action type">
            <Select value={newAction.action_type} onChange={(e) => setNewAction({ ...newAction, action_type: e.target.value })}>
              {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </FormField>
          <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
            <FormField label="Due date" required>
              <TextInput type="date" value={newAction.due_date} onChange={(e) => setNewAction({ ...newAction, due_date: e.target.value })} required />
            </FormField>
            <PickerField label="Assign to" optional>
              <MultiSelectDropdown
                title="Assign To"
                items={userPickerItems}
                selectedValues={newAction.assigned_to ? [newAction.assigned_to] : []}
                onApply={(values) => setNewAction({ ...newAction, assigned_to: values[0] || '' })}
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

      {/* Edit Agenda Item Panel */}
      <RightSlidePanel
        isOpen={editingAgendaId !== null}
        onClose={() => { updateAgendaMutation.reset(); setEditingAgendaId(null); }}
        title="Edit agenda item"
        dirty={formChanged(editAgendaInitial, editAgendaDraft)}
        footer={<DrawerFooter onCancel={() => { updateAgendaMutation.reset(); setEditingAgendaId(null); }} form="edit-agenda-form" pending={updateAgendaMutation.isPending} label="Save changes" pendingLabel="Saving…" disabled={!editAgendaDraft.title.trim()} />}
      >
        <form
          id="edit-agenda-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (editingAgendaId === null) return;
            updateAgendaMutation.mutate({
              id: editingAgendaId,
              data: {
                title: editAgendaDraft.title,
                description: editAgendaDraft.description || null,
                time_allocated_minutes: editAgendaDraft.time_allocated_minutes,
                item_type: editAgendaDraft.item_type,
              },
            });
          }}
          className="flex flex-col gap-[16px]"
        >
          {updateAgendaMutation.isError && <FormProblem message={errorMessage(updateAgendaMutation.error, 'The agenda item could not be saved.')} />}
          <FormField label="Title" required>
            <TextInput value={editAgendaDraft.title} onChange={(e) => setEditAgendaDraft({ ...editAgendaDraft, title: e.target.value })} maxLength={500} required />
          </FormField>
          <FormField label="Description" optional>
            <Textarea value={editAgendaDraft.description} onChange={(e) => setEditAgendaDraft({ ...editAgendaDraft, description: e.target.value })} rows={3} />
          </FormField>
          <div className="grid grid-cols-2 gap-[16px]">
            <FormField label="Type">
              <Select value={editAgendaDraft.item_type} onChange={(e) => setEditAgendaDraft({ ...editAgendaDraft, item_type: e.target.value })}>
                {ITEM_TYPES.concat(ITEM_TYPES.some((t) => t.value === editAgendaDraft.item_type) ? [] : [{ value: editAgendaDraft.item_type, label: statusLabel(editAgendaDraft.item_type) }]).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Duration">
              <TextInput type="number" min={1} unit="min" value={editAgendaDraft.time_allocated_minutes} onChange={(e) => setEditAgendaDraft({ ...editAgendaDraft, time_allocated_minutes: parseInt(e.target.value) || 15 })} />
            </FormField>
          </div>
        </form>
      </RightSlidePanel>

      {/* Upload Document Panel */}
      <RightSlidePanel
        isOpen={isUploadAttachmentOpen}
        onClose={() => { uploadAttachmentMutation.reset(); setIsUploadAttachmentOpen(false); setPendingAttachment(null); setAttachmentDescription(''); }}
        title="Upload document"
        dirty={pendingAttachment !== null || attachmentDescription !== ''}
        footer={(
          <div className="flex justify-end gap-[8px]">
            <Button onClick={() => { uploadAttachmentMutation.reset(); setIsUploadAttachmentOpen(false); setPendingAttachment(null); setAttachmentDescription(''); }}>Cancel</Button>
            <Button variant="primary" leftIcon={<Upload aria-hidden />} loading={uploadAttachmentMutation.isPending} disabled={!pendingAttachment} onClick={() => uploadAttachmentMutation.mutate()}>
              {uploadAttachmentMutation.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        )}
      >
        <div className="flex flex-col gap-[16px]">
          {uploadAttachmentMutation.isError && <FormProblem message={errorMessage(uploadAttachmentMutation.error, 'The document could not be uploaded.')} />}
          <p className="text-ds-body text-ds-fg-body">Attach agenda packets, briefing decks, supporting spreadsheets or any meeting documents (PDF, DOCX, XLSX, PPTX, images and more).</p>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-ds-card border-2 border-dashed border-ds-border-strong bg-ds-surface-subtle px-[24px] py-[32px] text-center focus-within:shadow-ds-ring hover:bg-ds-primary-soft">
            <Upload aria-hidden className="mb-[8px] h-[28px] w-[28px] text-ds-fg-muted" strokeWidth={1.5} />
            {pendingAttachment ? (
              <>
                <span className="break-all text-ds-body font-medium text-ds-fg">{pendingAttachment.name}</span>
                <span className="mt-[4px] text-ds-label font-normal text-ds-fg-muted">{formatFileSize(pendingAttachment.size)} · choose a different file</span>
              </>
            ) : (
              <>
                <span className="text-ds-body font-medium text-ds-fg">Choose a file</span>
                <span className="mt-[4px] text-ds-label font-normal text-ds-fg-muted">PDF, DOCX, XLSX, PPTX, images and more</span>
              </>
            )}
            <input type="file" className="sr-only" onChange={(e) => setPendingAttachment(e.target.files?.[0] || null)} />
          </label>

          <FormField label="Description" optional>
            <Textarea value={attachmentDescription} onChange={(e) => setAttachmentDescription(e.target.value)} rows={3} placeholder="A short note about what this document contains…" />
          </FormField>
        </div>
      </RightSlidePanel>
      {confirmDialog}
    </div>
  );
}

// ── AgendaVotePanel ─────────────────────────────────────────────────────────
// Per-agenda-item voting. Compact by default (the tally and your own vote); it opens to the cast-or-change controls and the full list of votes with comments.
// A vote already cast is changed only through "Change your vote", so nobody flips one by accident. One request per item, as before.

type VoteValue = 'agreed' | 'disagreed' | 'partial' | 'abstain';

const VOTE_TONE: Record<VoteValue, { label: string; tone: StatusPillProps['tone'] }> = {
  agreed:    { label: 'Agreed',    tone: 'success' },
  partial:   { label: 'Partial',   tone: 'warning' },
  disagreed: { label: 'Disagreed', tone: 'danger' },
  abstain:   { label: 'Abstain',   tone: 'neutral' },
};

function AgendaVotePanel({ itemId, itemNumber }: { itemId: number; itemNumber: number }) {
  const [expanded, setExpanded] = useState(false);
  const [draftVote, setDraftVote] = useState<VoteValue | null>(null);
  const [draftComment, setDraftComment] = useState('');

  const { data } = useQuery({
    queryKey: ['agenda-votes', itemId],
    queryFn: () => committeeApi.listAgendaVotes(itemId).then((r) => r.data),
    staleTime: 30 * 1000,
  });

  const voteMutation = useReportedMutation({
    mutationFn: ({ vote, comment }: { vote: VoteValue; comment?: string }) => committeeApi.voteAgendaItem(itemId, vote, comment),
    success: (_r, v) => ({ title: 'Vote recorded', message: `Agenda item ${itemNumber}: ${VOTE_TONE[v.vote].label}` }),
    failure: "Couldn't record the vote",
    invalidate: [['agenda-votes', itemId]],
    onSuccess: () => { setDraftVote(null); setDraftComment(''); },
  });

  const tally = data?.tally || { agreed: 0, disagreed: 0, partial: 0, abstain: 0 };
  const total = data?.total ?? 0;
  const myVote = (data?.my_vote?.vote as VoteValue | undefined) || null;
  const myComment = data?.my_vote?.comment || '';

  const orderedVotes: VoteValue[] = ['agreed', 'partial', 'disagreed', 'abstain'];

  return (
    <div className="mt-[8px] rounded-ds-control border border-ds-border bg-ds-surface-subtle">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-[8px] rounded-ds-control px-[12px] py-[6px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]"
      >
        <span className="flex flex-wrap items-center gap-[6px]">
          <span className="text-ds-label text-ds-fg-muted">Votes {total > 0 ? `(${total})` : ''}</span>
          {orderedVotes.map((v) => {
            const n = (tally as Record<string, number>)[v] || 0;
            if (n === 0) return null;
            return <StatusPill key={v} size="sm" tone={VOTE_TONE[v].tone} label={`${VOTE_TONE[v].label}: ${n}`} />;
          })}
          {myVote && <span className="text-ds-label font-normal text-ds-fg-muted">· your vote: <span className="font-medium text-ds-fg">{VOTE_TONE[myVote].label}</span></span>}
        </span>
        <ChevronRight aria-hidden className={`h-[16px] w-[16px] shrink-0 text-ds-fg-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t border-ds-border px-[12px] pb-[12px] pt-[8px]">
          {/* Cast / change vote */}
          <div>
            <p className={SUB_HEAD}>{myVote ? 'Change your vote' : 'Cast a vote'}</p>
            <div className="mt-[6px] flex flex-wrap gap-[6px]">
              {orderedVotes.map((v) => {
                const isMine = myVote === v;
                const isDraft = draftVote === v;
                const on = isDraft || (!draftVote && isMine);
                return (
                  <Button key={v} size="sm" variant={on ? 'primary' : 'secondary'} aria-pressed={on} disabled={voteMutation.isPending} onClick={() => setDraftVote(v)}>
                    {VOTE_TONE[v].label}
                  </Button>
                );
              })}
            </div>
            {draftVote && (
              <div className="mt-[8px] space-y-[8px]">
                <FormField label="Comment" optional>
                  <Textarea
                    value={draftComment}
                    onChange={(e) => setDraftComment(e.target.value)}
                    rows={2}
                    placeholder={myComment ? `Current comment: ${myComment}. Type to update…` : 'Optional comment'}
                  />
                </FormField>
                <div className="flex justify-end gap-[8px]">
                  <Button size="sm" onClick={() => { setDraftVote(null); setDraftComment(''); }}>Cancel</Button>
                  <Button size="sm" variant="primary" loading={voteMutation.isPending} onClick={() => voteMutation.mutate({ vote: draftVote, comment: draftComment.trim() || undefined })}>Submit vote</Button>
                </div>
              </div>
            )}
          </div>

          {/* Vote history */}
          {data?.votes && data.votes.length > 0 && (
            <div className="mt-[12px]">
              <p className={SUB_HEAD}>Who voted what</p>
              <ul className="mt-[6px] space-y-[6px]">
                {data.votes.map((v) => {
                  const s = VOTE_TONE[(v.vote as VoteValue)] || VOTE_TONE.abstain;
                  return (
                    <li key={v.id} className="flex items-start justify-between gap-[8px] text-ds-body">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-ds-fg">{v.user_name || `User #${v.user_id}`}</span>
                        {v.comment && <p className="mt-[2px] break-words text-ds-label font-normal text-ds-fg-body">{v.comment}</p>}
                      </div>
                      <StatusPill size="sm" tone={s.tone} label={s.label} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
