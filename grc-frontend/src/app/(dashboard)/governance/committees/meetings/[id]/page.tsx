'use client';

import { useRef, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { committeeApi, apiClient } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/ui/ToastProvider';
import {
  Calendar,
  MapPin,
  Users,
  FileText,
  CheckSquare,
  Plus,
  ArrowLeft,
  Save,
  ListOrdered,
  Sparkles,
  AlertCircle,
  FileCheck,
  Shield,
  Scale,
  Lightbulb,
  Link as LinkIcon,
  Pencil,
  Trash2,
  Upload,
  Download,
  Paperclip,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';

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

const MEETING_TYPE_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  regular:   { label: 'Regular',   bg: 'bg-emerald-50', text: 'text-emerald-700' },
  special:   { label: 'Special',   bg: 'bg-amber-50',   text: 'text-amber-700'   },
  emergency: { label: 'Emergency', bg: 'bg-rose-50',     text: 'text-rose-700'     },
};

const MEETING_STATUS_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  scheduled:   { label: 'Scheduled',   bg: 'bg-blue-50',   text: 'text-blue-700'   },
  in_progress: { label: 'In Progress', bg: 'bg-amber-50',  text: 'text-amber-700'  },
  completed:   { label: 'Completed',   bg: 'bg-emerald-50',text: 'text-emerald-700'},
  cancelled:   { label: 'Cancelled',   bg: 'bg-gray-100',   text: 'text-gray-600'   },
};

const AGENDA_STATUS_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  pending:   { label: 'Pending',   bg: 'bg-gray-100',   text: 'text-gray-600'   },
  discussed: { label: 'Discussed', bg: 'bg-emerald-50',text: 'text-emerald-700'},
  deferred:  { label: 'Deferred',  bg: 'bg-amber-50',  text: 'text-amber-700'  },
};

const ACTION_STATUS_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  open:        { label: 'Open',        bg: 'bg-amber-50',  text: 'text-amber-700'  },
  in_progress: { label: 'In Progress', bg: 'bg-blue-50',   text: 'text-blue-700'   },
  completed:   { label: 'Completed',   bg: 'bg-emerald-50',text: 'text-emerald-700'},
  overdue:     { label: 'Overdue',     bg: 'bg-rose-50',    text: 'text-rose-700'    },
};

const SOURCE_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; bg: string; text: string; border: string }> = {
  document:          { label: 'Document',           icon: FileCheck, bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200'   },
  exception:         { label: 'Exception',          icon: Shield,    bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200'  },
  regulatory_change: { label: 'Regulatory Change',  icon: Scale,     bg: 'bg-primary-50', text: 'text-slate-600', border: 'border-slate-200' },
  manual:            { label: 'Manual',             icon: FileText,  bg: 'bg-gray-50',   text: 'text-gray-600',   border: 'border-gray-200'   },
};

const ACTION_TYPES = [
  { value: 'follow_up',          label: 'Follow Up'           },
  { value: 'policy_approval',    label: 'Policy Approval'     },
  { value: 'risk_review',        label: 'Risk Review'         },
  { value: 'audit_response',     label: 'Audit Response'      },
  { value: 'corrective_action',  label: 'Corrective Action'   },
  { value: 'preventive_action',  label: 'Preventive Action'   },
  { value: 'investigation',      label: 'Investigation'       },
  { value: 'escalation',         label: 'Escalation'          },
  { value: 'decision_record',    label: 'Decision Record'     },
  { value: 'recommendation',     label: 'Recommendation'      },
  { value: 'training',           label: 'Training'            },
  { value: 'monitoring',         label: 'Monitoring'          },
  { value: 'vendor_review',      label: 'Vendor Review'       },
  { value: 'incident_review',    label: 'Incident Review'     },
  { value: 'compliance_review',  label: 'Compliance Review'   },
  { value: 'communication',      label: 'Communication'       },
  { value: 'documentation',      label: 'Documentation'       },
  { value: 'other',              label: 'Other'               },
];

const ITEM_TYPES = [
  { value: 'procedural', label: 'Procedural' },
  { value: 'approval',   label: 'Approval'   },
  { value: 'discussion', label: 'Discussion' },
  { value: 'information',label: 'Information'},
  { value: 'decision',   label: 'Decision'   },
];

function formatDate(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return d; }
}

function Badge({ label, bg, text }: { label: string; bg: string; text: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${bg} ${text}`}>
      {label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MeetingDetailPage() {
  const params = useParams();
  const meetingId = parseInt(params.id as string);
  const { toast } = useToast();
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

  const [newAgendaItem, setNewAgendaItem] = useState({
    title: '', description: '', duration_minutes: 15, item_type: 'discussion',
  });

  const [newAction, setNewAction] = useState({
    title: '', description: '', action_type: 'follow_up', due_date: '', assigned_to: '',
  });

  // Edit-agenda-item state. Holds the full draft so we can populate the same
  // RightSlidePanel used for adding (no separate component) and submit a PUT.
  const [editingAgendaId, setEditingAgendaId] = useState<number | null>(null);
  const [editAgendaDraft, setEditAgendaDraft] = useState({
    title: '', description: '', time_allocated_minutes: 15, item_type: 'discussion',
  });

  // Meeting attachments — file upload state and the optional description for the
  // file the user is about to upload.
  const [attachmentDescription, setAttachmentDescription] = useState('');
  const [pendingAttachment, setPendingAttachment]         = useState<File | null>(null);
  const [isUploadAttachmentOpen, setIsUploadAttachmentOpen] = useState(false);

  // ─── Queries ──────────────────────────────────────────────────────────────

  const { data: meeting, isLoading: meetingLoading, error: meetingError } = useQuery({
    queryKey: ['meeting', meetingId],
    queryFn: async () => {
      const res = await committeeApi.getMeeting(meetingId);
      return res.data as Meeting;
    },
  });

  const { data: agenda = [] } = useQuery<AgendaItem[]>({
    queryKey: ['meeting-agenda', meetingId],
    queryFn: async () => {
      const res = await committeeApi.getAgenda(meetingId);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!meeting,
  });

  const { data: suggestedItems = [], isLoading: suggestionsLoading } = useQuery<SuggestedItem[]>({
    queryKey: ['meeting-suggested', meetingId],
    queryFn: async () => {
      const res = await committeeApi.getSuggestedAgendaItems(meetingId);
      const data = res.data as any;
      // Backend returns { suggested_items: [...], total_count, ... }
      return Array.isArray(data) ? data : (data?.suggested_items ?? []);
    },
    enabled: !!meeting,
  });

  const { data: actions = [] } = useQuery<Action[]>({
    queryKey: ['meeting-actions', meetingId],
    queryFn: async () => {
      if (!meeting?.committee_id) return [];
      const res = await committeeApi.getActions({ committee_id: meeting.committee_id });
      const data = res.data as any;
      const items: Action[] = Array.isArray(data) ? data : (data?.items ?? []);
      return items.filter((a) => a.meeting_id === meetingId);
    },
    enabled: !!meeting,
  });

  const { data: attachments = [] } = useQuery<MeetingAttachment[]>({
    queryKey: ['meeting-attachments', meetingId],
    queryFn: async () => {
      const res = await committeeApi.getMeetingAttachments(meetingId);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!meeting,
  });

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
        .map((u) => [u.id, u])
    ).values()
  );

  // ─── Mutations ────────────────────────────────────────────────────────────

  const addAgendaMutation = useMutation({
    mutationFn: (data: any) => committeeApi.addAgendaItem(meetingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting-agenda', meetingId] });
      setIsAddAgendaOpen(false);
      setNewAgendaItem({ title: '', description: '', duration_minutes: 15, item_type: 'discussion' });
      toast({ title: 'Agenda item added', type: 'success' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed to add agenda item', message: err?.response?.data?.detail || 'Please try again', type: 'error' });
    },
  });

  // Upload + AI-parse: takes a PDF/DOCX agenda, parses it into items,
  // appends them after the highest existing item_number.
  const uploadAgendaInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAgendaMutation = useMutation({
    mutationFn: (file: File) => committeeApi.uploadAgendaForParse(meetingId, file),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ['meeting-agenda', meetingId] });
      const count = r?.data?.inserted ?? 0;
      toast({
        title: `Imported ${count} agenda item${count === 1 ? '' : 's'}`,
        message: 'Edit any item to refine the parsed details.',
        type: 'success',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Could not parse agenda',
        message: err?.response?.data?.detail || 'Try a more structured document or add items manually.',
        type: 'error',
      });
    },
  });
  const onPickAgendaUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadAgendaMutation.mutate(file);
    if (e.target) e.target.value = '';
  };

  const updateAgendaMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => committeeApi.updateAgendaItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting-agenda', meetingId] });
      setEditingAgendaId(null);
      toast({ title: 'Agenda item updated', type: 'success' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed to update agenda item', message: err?.response?.data?.detail || 'Please try again', type: 'error' });
    },
  });

  const deleteAgendaMutation = useMutation({
    mutationFn: (id: number) => committeeApi.deleteAgendaItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting-agenda', meetingId] });
      toast({ title: 'Agenda item removed', type: 'success' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed to remove agenda item', message: err?.response?.data?.detail || 'Please try again', type: 'error' });
    },
  });

  const uploadAttachmentMutation = useMutation({
    mutationFn: async () => {
      if (!pendingAttachment) throw new Error('No file selected');
      const formData = new FormData();
      formData.append('file', pendingAttachment);
      if (attachmentDescription.trim()) {
        formData.append('description', attachmentDescription.trim());
      }
      return committeeApi.uploadMeetingAttachment(meetingId, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting-attachments', meetingId] });
      setIsUploadAttachmentOpen(false);
      setPendingAttachment(null);
      setAttachmentDescription('');
      toast({ title: 'Attachment uploaded', type: 'success' });
    },
    onError: (err: any) => {
      toast({ title: 'Upload failed', message: err?.response?.data?.detail || err?.message || 'Please try again', type: 'error' });
    },
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (id: number) => committeeApi.deleteMeetingAttachment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting-attachments', meetingId] });
      toast({ title: 'Attachment removed', type: 'success' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed to remove attachment', message: err?.response?.data?.detail || 'Please try again', type: 'error' });
    },
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
    } catch (err: any) {
      toast({ title: 'Download failed', message: err?.message || 'Please try again', type: 'error' });
    }
  };

  const createActionMutation = useMutation({
    mutationFn: (data: any) => committeeApi.createAction(meetingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting-actions', meetingId] });
      setIsAddActionOpen(false);
      setNewAction({ title: '', description: '', action_type: 'follow_up', due_date: '', assigned_to: '' });
      toast({ title: 'Action created', type: 'success' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed to create action', message: err?.response?.data?.detail || 'Please try again', type: 'error' });
    },
  });

  const saveMinutesMutation = useMutation({
    mutationFn: (data: any) => committeeApi.createMinutes(meetingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting', meetingId] });
      setIsEditMinutesOpen(false);
      toast({ title: 'Minutes saved', type: 'success' });
    },    onError: (err: any) => {
      toast({ title: 'Failed to save minutes', message: err?.response?.data?.detail || 'Please try again', type: 'error' });
    },
  });

  // Upload a PDF / DOCX / TXT minutes document — server extracts text
  // and saves it as the minutes content. Replaces existing minutes
  // (dropping prior approval back to draft) if a record is already
  // present for this meeting.
  const uploadMinutesInputRef = useRef<HTMLInputElement | null>(null);
  const uploadMinutesMutation = useMutation({
    mutationFn: (file: File) => committeeApi.uploadMinutesDoc(meetingId, file),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ['meeting', meetingId] });
      setIsEditMinutesOpen(false);
      const replaced = r?.data?.replaced_existing;
      toast({
        title: replaced ? 'Minutes replaced from document' : 'Minutes uploaded',
        message: replaced
          ? 'Previous content was overwritten and dropped back to draft.'
          : 'Document extracted into draft minutes. Edit to refine.',
        type: 'success',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Could not upload minutes',
        message: err?.response?.data?.detail || 'Try a text-based PDF, DOCX, or TXT.',
        type: 'error',
      });
    },
  });
  const onPickMinutesUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMinutesMutation.mutate(file);
    if (e.target) e.target.value = '';
  };

  const autoPopulateMutation = useMutation({
    mutationFn: (opts: typeof autoPopulateOptions) => committeeApi.autoPopulateAgenda(meetingId, opts),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['meeting-agenda', meetingId] });
      queryClient.invalidateQueries({ queryKey: ['meeting-suggested', meetingId] });
      setIsAutoPopulateOpen(false);
      const added = res.data?.items_added ?? res.data?.total_created ?? 0;
      toast({ title: `${added} item${added !== 1 ? 's' : ''} added to agenda`, type: 'success' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed to auto-populate agenda', message: err?.response?.data?.detail || 'Please try again', type: 'error' });
    },
  });

  const userPickerItems = useMemo(
    () =>
      normalizedUsers.map((u) => ({
        value: String(u.id),
        label: u.name,
        subLabel: u.name.includes('@') ? u.name : undefined,
      })),
    [normalizedUsers],
  );

  // ─── Loading / Error States ───────────────────────────────────────────────

  if (meetingLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
        <div className="h-5 w-96 animate-pulse rounded bg-gray-200" />
        <div className="h-48 animate-pulse rounded bg-gray-100" />
      </div>
    );
  }

  if (meetingError || !meeting) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertCircle className="h-10 w-10 text-rose-500 mb-3" />
        <p className="text-gray-700 font-medium">Meeting not found</p>
        <Link href="/governance/committees" className="mt-4 text-primary-600 hover:underline text-sm">
          Back to committees
        </Link>
      </div>
    );
  }

  const meetingTypeStyle  = MEETING_TYPE_STYLES[meeting.meeting_type]  ?? MEETING_TYPE_STYLES.regular;
  const meetingStatusStyle = MEETING_STATUS_STYLES[meeting.status]     ?? MEETING_STATUS_STYLES.scheduled;
  const sortedAgenda = [...agenda].sort((a, b) => a.item_number - b.item_number);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 sm:space-y-6">

      {/* ── Header ── */}
      <div>
        <Link
          href={`/governance/committees/${meeting.committee_id}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {meeting.committee_name || 'Committee'}
        </Link>

        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-50 border border-primary-100">
            <Calendar className="h-6 w-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-black">{meeting.title}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge {...meetingTypeStyle} />
              <Badge {...meetingStatusStyle} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-5 mt-4 text-sm text-gray-600">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4 text-gray-400" />
            {new Date(meeting.scheduled_date).toLocaleDateString('en-US', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            })}
          </span>
          {meeting.location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-gray-400" />
              {meeting.location}
            </span>
          )}
          {meeting.quorum_required != null && (
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-gray-400" />
              Quorum: {meeting.quorum_required}
              {meeting.quorum_present != null && ` / ${meeting.quorum_present} present`}
            </span>
          )}
          {meeting.virtual_link && (
            <a href={meeting.virtual_link} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-primary-600 hover:underline">
              <LinkIcon className="h-4 w-4" />
              Virtual Link
            </a>
          )}
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Agenda Items',    value: sortedAgenda.length,    icon: ListOrdered, color: 'text-primary-600',   bg: 'bg-blue-50'   },
          { label: 'Actions',         value: actions.length,          icon: CheckSquare, color: 'text-amber-600',  bg: 'bg-amber-50'  },
          { label: 'Suggested Items', value: suggestedItems.length,   icon: Lightbulb,   color: 'text-primary-600', bg: 'bg-primary-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-4 flex items-center gap-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div>
              <p className="text-2xl font-semibold text-black">{value}</p>
              <p className="text-sm text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Main Column ── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Agenda */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="font-medium text-black flex items-center gap-2">
                <ListOrdered className="h-5 w-5 text-slate-400" />
                Agenda
              </h3>
              {canCreate && (
                <div className="flex items-center gap-2">
                  {/* Hidden file input — Upload & AI parse button triggers it. */}
                  <input
                    ref={uploadAgendaInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.txt,.md"
                    onChange={onPickAgendaUploadFile}
                    className="hidden"
                  />
                  {suggestedItems.length > 0 && (
                    <button
                      onClick={() => setIsAutoPopulateOpen(true)}
                      className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      title="Add pending approvals, exceptions and regulatory changes to the agenda"
                    >
                      <Sparkles className="h-4 w-4 text-primary-600" />
                      Auto-populate ({suggestedItems.length})
                    </button>
                  )}
                  <button
                    onClick={() => uploadAgendaInputRef.current?.click()}
                    disabled={uploadAgendaMutation.isPending}
                    className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    title="Upload a PDF / DOCX agenda — we'll parse it into items via heuristic + AI"
                  >
                    {uploadAgendaMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    {uploadAgendaMutation.isPending ? 'Parsing…' : 'Upload & AI parse'}
                  </button>
                  <button
                    onClick={() => setIsAddAgendaOpen(true)}
                    className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-gray-50"
                  >
                    <Plus className="h-4 w-4" />
                    Add Item
                  </button>
                </div>
              )}
            </div>

            <div className="divide-y divide-gray-100">
              {sortedAgenda.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <ListOrdered className="h-9 w-9 text-gray-300 mb-2" />
                  <p className="text-gray-600 font-medium">No agenda items yet</p>
                  <button
                    onClick={() => setIsAddAgendaOpen(true)}
                    className="mt-2 text-sm text-primary-600 hover:underline"
                  >
                    Add the first item
                  </button>
                </div>
              ) : sortedAgenda.map((item) => {
                const statusStyle  = AGENDA_STATUS_STYLES[item.status] ?? AGENDA_STATUS_STYLES.pending;
                const sourceConfig = SOURCE_TYPE_CONFIG[item.source_type ?? 'manual'];
                const links = [
                  item.linked_document_title         && { type: 'Document',           title: item.linked_document_title,          icon: FileCheck },
                  item.linked_risk_title             && { type: 'Risk Exception',      title: item.linked_risk_title,              icon: Shield    },
                  item.linked_regulatory_change_title && { type: 'Regulatory Change', title: item.linked_regulatory_change_title, icon: Scale     },
                ].filter(Boolean) as { type: string; title: string; icon: React.ElementType }[];

                return (
                  <div key={item.id} className="px-6 py-4 hover:bg-gray-50 transition-colors group">
                    <div className="flex items-start gap-4">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600">
                        {item.item_number}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <h4 className="text-sm font-medium text-black">{item.title}</h4>
                          <div className="flex items-center gap-2 shrink-0">
                            {item.source_type && item.source_type !== 'manual' && (
                              <span className={`text-xs font-medium ${sourceConfig?.text}`}>{sourceConfig?.label}</span>
                            )}
                            <Badge {...statusStyle} />
                            {canCreate && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingAgendaId(item.id);
                                    setEditAgendaDraft({
                                      title: item.title,
                                      description: item.description ?? '',
                                      time_allocated_minutes: item.time_allocated_minutes ?? 15,
                                      item_type: item.item_type ?? 'discussion',
                                    });
                                  }}
                                  className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                                  title="Edit agenda item"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (confirm(`Remove agenda item "${item.title}"? This cannot be undone.`)) {
                                      deleteAgendaMutation.mutate(item.id);
                                    }
                                  }}
                                  disabled={deleteAgendaMutation.isPending}
                                  className="rounded p-1 text-gray-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                                  title="Remove agenda item"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        {item.description && (
                          <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-4 mt-1.5 text-xs text-gray-500">
                          {item.presenter_name         && <span>Presenter: {item.presenter_name}</span>}
                          {item.time_allocated_minutes && <span>{item.time_allocated_minutes} min</span>}
                          <span className="capitalize">{item.item_type.replace('_', ' ')}</span>
                        </div>
                        {links.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {links.map((link, i) => {
                              const Icon = link.icon;
                              return (
                                <span key={i} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                                  <Icon className="h-3 w-3" />
                                  {link.type}: {link.title}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {item.decision_made && (
                          <div className="mt-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs text-emerald-800">
                            <span className="font-medium">Decision:</span> {item.decision_made}
                          </div>
                        )}
                        {/* Voting panel — committee members cast an
                            agree / partial / disagree / abstain vote with
                            an optional comment. Tally + per-vote details
                            visible to everyone in the tenant. */}
                        <AgendaVotePanel itemId={item.id} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="font-medium text-black flex items-center gap-2">
                <FileText className="h-5 w-5 text-slate-400" />
                Meeting Minutes
              </h3>
              {!isEditMinutesOpen && (
                <div className="flex items-center gap-2">
                  {/* Hidden file input — clicked programmatically by the
                      Upload button below. Accepts PDF, Word, plain text,
                      markdown, and RTF; the server extracts the text and
                      stores it as the draft minutes content. */}
                  <input
                    ref={uploadMinutesInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.txt,.md,.rtf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,application/rtf"
                    className="hidden"
                    onChange={onPickMinutesUploadFile}
                  />
                  <button
                    type="button"
                    onClick={() => uploadMinutesInputRef.current?.click()}
                    disabled={uploadMinutesMutation.isPending}
                    title={
                      meeting.has_minutes || meeting.minutes
                        ? 'Upload a document to replace the current minutes (drops back to draft)'
                        : 'Upload a PDF / DOCX / TXT — we extract the text into draft minutes'
                    }
                    className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Upload className="h-4 w-4" />
                    {uploadMinutesMutation.isPending
                      ? 'Uploading…'
                      : (meeting.has_minutes || meeting.minutes)
                        ? 'Upload to Replace'
                        : 'Upload Minutes'}
                  </button>
                  {(meeting.has_minutes || meeting.minutes) ? (
                    <button
                      onClick={() => {
                        setMinutesContent(meeting.minutes?.content ?? '');
                        setIsEditMinutesOpen(true);
                      }}
                      className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-gray-50"
                    >
                      <Save className="h-4 w-4" />
                      Edit Minutes
                    </button>
                  ) : (
                    <button
                      onClick={() => setIsEditMinutesOpen(true)}
                      className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-gray-50"
                    >
                      <Plus className="h-4 w-4" />
                      Draft Minutes
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="p-6">
              {isEditMinutesOpen ? (
                <div className="space-y-4">
                  <textarea
                    value={minutesContent}
                    onChange={(e) => setMinutesContent(e.target.value)}
                    rows={8}
                    placeholder="Record meeting minutes here…"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
                  />
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setIsEditMinutesOpen(false)}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-black hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => saveMinutesMutation.mutate({ content: minutesContent })}
                      disabled={!minutesContent.trim() || saveMinutesMutation.isPending}
                      className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      {saveMinutesMutation.isPending ? 'Saving…' : 'Save Draft'}
                    </button>
                  </div>
                </div>
              ) : (meeting.has_minutes || meeting.minutes) && meeting.minutes?.content ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {meeting.minutes.drafter_name && <span>Drafted by {meeting.minutes.drafter_name}</span>}
                    {meeting.minutes.drafted_at && <span>· {formatDate(meeting.minutes.drafted_at)}</span>}
                    {meeting.minutes.status && (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
                        meeting.minutes.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {meeting.minutes.status === 'draft' ? 'Draft' : meeting.minutes.status === 'approved' ? 'Approved' : meeting.minutes.status}
                      </span>
                    )}
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-black whitespace-pre-wrap">
                    {meeting.minutes.content}
                  </div>
                </div>
              ) : (meeting.has_minutes || meeting.minutes) ? (
                <div className="text-center py-6">
                  <FileText className="h-9 w-9 text-emerald-400 mx-auto mb-2" />
                  <p className="text-gray-700 font-medium">Minutes recorded</p>
                  <p className="text-sm text-gray-500 mt-1">Minutes have been saved for this meeting</p>
                </div>
              ) : (
                <div className="flex flex-col items-center py-8 text-center">
                  <FileText className="h-9 w-9 text-gray-300 mb-2" />
                  <p className="text-gray-600 font-medium">No minutes yet</p>
                  <button
                    onClick={() => setIsEditMinutesOpen(true)}
                    className="mt-2 text-sm text-primary-600 hover:underline"
                  >
                    Draft minutes
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Documents / Attachments */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="font-medium text-black flex items-center gap-2">
                <Paperclip className="h-5 w-5 text-slate-400" />
                Documents
                <span className="text-xs font-normal text-gray-500">({attachments.length})</span>
              </h3>
              {canCreate && (
                <button
                  onClick={() => setIsUploadAttachmentOpen(true)}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-gray-50"
                >
                  <Upload className="h-4 w-4" />
                  Upload
                </button>
              )}
            </div>

            <div className="divide-y divide-gray-100">
              {attachments.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <Paperclip className="h-9 w-9 text-gray-300 mb-2" />
                  <p className="text-gray-600 font-medium">No documents attached yet</p>
                  <p className="text-xs text-gray-500 mt-1">Upload agenda packets, briefing decks, spreadsheets, or supporting material</p>
                  {canCreate && (
                    <button
                      onClick={() => setIsUploadAttachmentOpen(true)}
                      className="mt-2 text-sm text-primary-600 hover:underline"
                    >
                      Upload the first document
                    </button>
                  )}
                </div>
              ) : attachments.map((att) => (
                <div key={att.id} className="px-6 py-4 hover:bg-gray-50 transition-colors group">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                      <FileText className="h-5 w-5 text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-black truncate">{att.file_name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {att.file_type ? `${att.file_type.toUpperCase()} · ` : ''}
                            {formatFileSize(att.file_size ?? undefined)}
                            {att.uploaded_by_name ? ` · Uploaded by ${att.uploaded_by_name}` : ''}
                            {att.uploaded_at ? ` · ${formatDate(att.uploaded_at)}` : ''}
                          </p>
                          {att.description && (
                            <p className="text-xs text-gray-600 mt-1">{att.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleDownloadAttachment(att.id, att.file_name)}
                            className="rounded p-1.5 text-gray-500 hover:bg-blue-50 hover:text-primary-600"
                            title="Download"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          {canCreate && (
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Remove "${att.file_name}" from this meeting?`)) {
                                  deleteAttachmentMutation.mutate(att.id);
                                }
                              }}
                              disabled={deleteAttachmentMutation.isPending}
                              className="rounded p-1.5 text-gray-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                              title="Remove"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="space-y-6">

          {/* Actions */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="font-medium text-black flex items-center gap-2">
                <CheckSquare className="h-5 w-5 text-slate-400" />
                Actions
              </h3>
              {canCreate && (
              <button
                onClick={() => setIsAddActionOpen(true)}
                className="rounded-lg border border-gray-300 p-1.5 hover:bg-gray-50"
                title="Create action"
              >
                <Plus className="h-4 w-4 text-gray-600" />
              </button>
              )}
            </div>

            <div className="divide-y divide-gray-100">
              {actions.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center px-4">
                  <CheckSquare className="h-8 w-8 text-gray-300 mb-2" />
                  <p className="text-gray-600 text-sm font-medium">No actions yet</p>
                  <button
                    onClick={() => setIsAddActionOpen(true)}
                    className="mt-2 text-xs text-primary-600 hover:underline"
                  >
                    Create first action
                  </button>
                </div>
              ) : actions.map((action) => {
                const statusStyle = action.is_overdue
                  ? ACTION_STATUS_STYLES.overdue
                  : ACTION_STATUS_STYLES[action.status] ?? ACTION_STATUS_STYLES.open;
                return (
                  <div key={action.id} className="px-5 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-black leading-snug">{action.title}</p>
                      <Badge {...statusStyle} />
                    </div>
                    <div className="mt-1.5 space-y-0.5 text-xs text-gray-500">
                      {action.due_date   && <p>Due: {formatDate(action.due_date)}</p>}
                      <p>{action.assignee_name || 'Unassigned'}</p>
                      {action.action_number && <p className="font-mono text-gray-400">{action.action_number}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Meeting Info */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
            <h3 className="font-medium text-black text-sm">Meeting Details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Type</dt>
                <dd className="text-black capitalize">{meeting.meeting_type.replace('_', ' ')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Status</dt>
                <dd><Badge {...meetingStatusStyle} /></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Date</dt>
                <dd className="text-black">{formatDate(meeting.scheduled_date)}</dd>
              </div>
              {meeting.quorum_required != null && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Quorum</dt>
                  <dd className="text-black">{meeting.quorum_required}</dd>
                </div>
              )}
              {meeting.location && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Location</dt>
                  <dd className="text-black truncate max-w-[140px]" title={meeting.location}>{meeting.location}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>

      {/* ── Panels ── */}

      {/* Auto-Populate Panel */}
      <RightSlidePanel
        isOpen={isAutoPopulateOpen}
        onClose={() => setIsAutoPopulateOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-slate-400" />
            Auto-Populate Agenda
          </span>
        }
        footer={
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setIsAutoPopulateOpen(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-black hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => autoPopulateMutation.mutate(autoPopulateOptions)}
              disabled={
                autoPopulateMutation.isPending ||
                (!autoPopulateOptions.include_documents && !autoPopulateOptions.include_exceptions && !autoPopulateOptions.include_regulatory_changes)
              }
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {autoPopulateMutation.isPending ? 'Populating…' : 'Populate Agenda'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Automatically add relevant pending items to the agenda. Select which types to include:
          </p>

          {([
            { key: 'include_documents'          as const, label: 'Pending Document Approvals', desc: 'Documents awaiting committee approval', Icon: FileCheck, color: 'text-primary-600',   bg: 'bg-blue-50'   },
            { key: 'include_exceptions'         as const, label: 'Risk Exceptions',             desc: 'Exceptions pending review',             Icon: Shield,    color: 'text-amber-600',  bg: 'bg-amber-50'  },
            { key: 'include_regulatory_changes' as const, label: 'Regulatory Changes',          desc: 'Updates under assessment',              Icon: Scale,     color: 'text-primary-600', bg: 'bg-primary-50' },
          ] as const).map(({ key, label, desc, Icon, color, bg }) => (
            <label key={key}
              className="flex items-center gap-4 cursor-pointer rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors">
              <input
                type="checkbox"
                checked={autoPopulateOptions[key]}
                onChange={(e) => setAutoPopulateOptions({ ...autoPopulateOptions, [key]: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <div>
                <p className="text-sm font-medium text-black">{label}</p>
                <p className="text-xs text-gray-500">{desc}</p>
              </div>
            </label>
          ))}
        </div>
      </RightSlidePanel>

      {/* Add Agenda Item Panel */}
      <RightSlidePanel
        isOpen={isAddAgendaOpen}
        onClose={() => setIsAddAgendaOpen(false)}
        title="Add Agenda Item"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsAddAgendaOpen(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-black hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="add-agenda-form"
              disabled={!newAgendaItem.title.trim() || addAgendaMutation.isPending}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {addAgendaMutation.isPending ? 'Adding…' : 'Add Item'}
            </button>
          </div>
        }
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
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-black mb-1">Title <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={newAgendaItem.title}
              onChange={(e) => setNewAgendaItem({ ...newAgendaItem, title: e.target.value })}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Agenda item title"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Description</label>
            <textarea
              value={newAgendaItem.description}
              onChange={(e) => setNewAgendaItem({ ...newAgendaItem, description: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
              placeholder="Optional description"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-black mb-1">Type</label>
              <MultiSelectDropdown
                title="Type"
                items={ITEM_TYPES}
                selectedValues={[newAgendaItem.item_type]}
                onApply={(values) => setNewAgendaItem({ ...newAgendaItem, item_type: values[0] || 'discussion' })}
                multiSelect={false}
                triggerVariant="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-black mb-1">Duration (min)</label>
              <input
                type="number"
                min={1}
                value={newAgendaItem.duration_minutes}
                onChange={(e) => setNewAgendaItem({ ...newAgendaItem, duration_minutes: parseInt(e.target.value) || 15 })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>
        </form>
      </RightSlidePanel>

      {/* Create Action Panel */}
      <RightSlidePanel
        isOpen={isAddActionOpen}
        onClose={() => setIsAddActionOpen(false)}
        title="Create Action"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsAddActionOpen(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-black hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-action-form"
              disabled={!newAction.title.trim() || !newAction.due_date || createActionMutation.isPending}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {createActionMutation.isPending ? 'Creating…' : 'Create Action'}
            </button>
          </div>
        }
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
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-black mb-1">Title <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={newAction.title}
              onChange={(e) => setNewAction({ ...newAction, title: e.target.value })}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Action title"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Description</label>
            <textarea
              value={newAction.description}
              onChange={(e) => setNewAction({ ...newAction, description: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Action Type</label>
            <MultiSelectDropdown
              title="Action Type"
              items={ACTION_TYPES}
              selectedValues={[newAction.action_type]}
              onApply={(values) => setNewAction({ ...newAction, action_type: values[0] || 'follow_up' })}
              multiSelect={false}
              triggerVariant="input"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-black mb-1">Due Date <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={newAction.due_date}
                onChange={(e) => setNewAction({ ...newAction, due_date: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-black mb-1">Assign To</label>
              <MultiSelectDropdown
                title="Assign To"
                items={userPickerItems}
                selectedValues={newAction.assigned_to ? [newAction.assigned_to] : []}
                onApply={(values) => setNewAction({ ...newAction, assigned_to: values[0] || '' })}
                multiSelect={false}
                triggerVariant="input"
                forceSearch
                placeholder="Unassigned"
              />
            </div>
          </div>
        </form>
      </RightSlidePanel>

      {/* Edit Agenda Item Panel */}
      <RightSlidePanel
        isOpen={editingAgendaId !== null}
        onClose={() => setEditingAgendaId(null)}
        title="Edit Agenda Item"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditingAgendaId(null)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-black hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-agenda-form"
              disabled={!editAgendaDraft.title.trim() || updateAgendaMutation.isPending}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {updateAgendaMutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        }
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
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-black mb-1">Title <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={editAgendaDraft.title}
              onChange={(e) => setEditAgendaDraft({ ...editAgendaDraft, title: e.target.value })}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Description</label>
            <textarea
              value={editAgendaDraft.description}
              onChange={(e) => setEditAgendaDraft({ ...editAgendaDraft, description: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-black mb-1">Type</label>
              <MultiSelectDropdown
                title="Type"
                items={ITEM_TYPES}
                selectedValues={[editAgendaDraft.item_type]}
                onApply={(values) => setEditAgendaDraft({ ...editAgendaDraft, item_type: values[0] || 'discussion' })}
                multiSelect={false}
                triggerVariant="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-black mb-1">Duration (min)</label>
              <input
                type="number"
                min={1}
                value={editAgendaDraft.time_allocated_minutes}
                onChange={(e) => setEditAgendaDraft({ ...editAgendaDraft, time_allocated_minutes: parseInt(e.target.value) || 15 })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>
        </form>
      </RightSlidePanel>

      {/* Upload Document Panel */}
      <RightSlidePanel
        isOpen={isUploadAttachmentOpen}
        onClose={() => {
          setIsUploadAttachmentOpen(false);
          setPendingAttachment(null);
          setAttachmentDescription('');
        }}
        title={
          <span className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-slate-400" />
            Upload Document
          </span>
        }
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setIsUploadAttachmentOpen(false);
                setPendingAttachment(null);
                setAttachmentDescription('');
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-black hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => uploadAttachmentMutation.mutate()}
              disabled={!pendingAttachment || uploadAttachmentMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {uploadAttachmentMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Upload
                </>
              )}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Attach agenda packets, briefing decks, supporting spreadsheets, or any meeting documents (PDF, DOCX, XLSX, PPTX, images, etc.).
          </p>

          <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-8 cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors">
            <Upload className="h-8 w-8 text-gray-400 mb-2" />
            {pendingAttachment ? (
              <>
                <p className="text-sm font-medium text-black">{pendingAttachment.name}</p>
                <p className="text-xs text-gray-500 mt-1">{formatFileSize(pendingAttachment.size)} · click to choose a different file</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-black">Click to choose a file</p>
                <p className="text-xs text-gray-500 mt-1">PDF, DOCX, XLSX, PPTX, images and more</p>
              </>
            )}
            <input
              type="file"
              className="hidden"
              onChange={(e) => setPendingAttachment(e.target.files?.[0] || null)}
            />
          </label>

          <div>
            <label className="block text-sm font-medium text-black mb-1">Description <span className="text-xs font-normal text-gray-500">(optional)</span></label>
            <textarea
              value={attachmentDescription}
              onChange={(e) => setAttachmentDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
              placeholder="Short note about what this document contains…"
            />
          </div>
        </div>
      </RightSlidePanel>
    </div>
  );
}

// ── AgendaVotePanel ─────────────────────────────────────────────────────────
// Per-agenda-item voting surface. Compact by default (just the tally chips
// + the user's own vote indicator); expands to show the cast/change UI +
// the full vote list with comments. Re-clicking a vote you've already
// cast toggles it off only via "Change vote" → no accidental flips.

type VoteValue = 'agreed' | 'disagreed' | 'partial' | 'abstain';

const VOTE_STYLES: Record<VoteValue, { label: string; bg: string; text: string; border: string }> = {
  agreed:    { label: 'Agreed',    bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  partial:   { label: 'Partial',   bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  disagreed: { label: 'Disagreed', bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200' },
  abstain:   { label: 'Abstain',   bg: 'bg-slate-50',   text: 'text-slate-600',   border: 'border-slate-200' },
};

function AgendaVotePanel({ itemId }: { itemId: number }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [draftVote, setDraftVote] = useState<VoteValue | null>(null);
  const [draftComment, setDraftComment] = useState('');

  const { data } = useQuery({
    queryKey: ['agenda-votes', itemId],
    queryFn: () => committeeApi.listAgendaVotes(itemId).then((r) => r.data),
    staleTime: 30 * 1000,
  });

  const voteMutation = useMutation({
    mutationFn: ({ vote, comment }: { vote: VoteValue; comment?: string }) =>
      committeeApi.voteAgendaItem(itemId, vote, comment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agenda-votes', itemId] });
      setDraftVote(null);
      setDraftComment('');
    },
  });

  const tally = data?.tally || { agreed: 0, disagreed: 0, partial: 0, abstain: 0 };
  const total = data?.total ?? 0;
  const myVote = (data?.my_vote?.vote as VoteValue | undefined) || null;
  const myComment = data?.my_vote?.comment || '';

  const orderedVotes: VoteValue[] = ['agreed', 'partial', 'disagreed', 'abstain'];

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-slate-100 rounded-t-md"
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Votes {total > 0 ? `(${total})` : ''}
          </span>
          {orderedVotes.map((v) => {
            const n = (tally as Record<string, number>)[v] || 0;
            if (n === 0) return null;
            const s = VOTE_STYLES[v];
            return (
              <span key={v} className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${s.bg} ${s.text} ${s.border}`}>
                {s.label}: {n}
              </span>
            );
          })}
          {myVote && (
            <span className="text-[10px] text-slate-500 ml-1">
              · your vote: <span className={`font-semibold ${VOTE_STYLES[myVote].text}`}>{VOTE_STYLES[myVote].label}</span>
            </span>
          )}
        </div>
        <ChevronRight className={`h-3.5 w-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="px-3 pb-2 pt-1 border-t border-slate-200">
          {/* Cast / change vote */}
          <div className="mt-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
              {myVote ? 'Change your vote' : 'Cast a vote'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {orderedVotes.map((v) => {
                const s = VOTE_STYLES[v];
                const isMine = myVote === v;
                const isDraft = draftVote === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setDraftVote(v)}
                    disabled={voteMutation.isPending}
                    className={`text-xs px-2.5 py-1 rounded-md border transition-colors disabled:opacity-50 ${
                      isDraft || (!draftVote && isMine)
                        ? `${s.bg} ${s.text} ${s.border} font-semibold`
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            {draftVote && (
              <div className="mt-2 space-y-2">
                <textarea
                  value={draftComment}
                  onChange={(e) => setDraftComment(e.target.value)}
                  rows={2}
                  placeholder={myComment ? `Current comment: ${myComment}. Type to update…` : 'Optional comment'}
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                />
                <div className="flex gap-1.5 justify-end">
                  <button
                    type="button"
                    onClick={() => { setDraftVote(null); setDraftComment(''); }}
                    className="text-xs rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={voteMutation.isPending}
                    onClick={() => voteMutation.mutate({
                      vote: draftVote,
                      comment: draftComment.trim() || undefined,
                    })}
                    className="text-xs rounded-md bg-blue-600 px-2.5 py-1 text-white hover:bg-blue-700 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {voteMutation.isPending && <Loader2 size={11} className="animate-spin" />}
                    Submit vote
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Vote history */}
          {data?.votes && data.votes.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                Who voted what
              </p>
              <ul className="space-y-1">
                {data.votes.map((v) => {
                  const s = VOTE_STYLES[(v.vote as VoteValue)] || VOTE_STYLES.abstain;
                  return (
                    <li key={v.id} className="flex items-start justify-between gap-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <span className="text-slate-700 font-medium">{v.user_name || `User #${v.user_id}`}</span>
                        {v.comment && (
                          <p className="text-slate-600 text-xs mt-0.5 break-words">{v.comment}</p>
                        )}
                      </div>
                      <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${s.bg} ${s.text} ${s.border}`}>
                        {s.label}
                      </span>
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
