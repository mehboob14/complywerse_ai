'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { committeeApi, governanceApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  FileText,
  CheckSquare,
  Plus,
  X,
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
} from 'lucide-react';
import Link from 'next/link';

interface Meeting {
  id: number;
  committee_id: number;
  committee_name: string;
  title: string;
  meeting_type: 'regular' | 'special' | 'emergency';
  scheduled_date: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  attendee_count: number;
  quorum_required: number;
  created_at: string;
}

interface AgendaItem {
  id: number;
  meeting_id: number;
  sequence: number;
  title: string;
  description?: string;
  presenter?: string;
  duration_minutes?: number;
  item_type: string;
  status: 'pending' | 'discussed' | 'deferred';
  source_type?: 'document' | 'exception' | 'regulatory_change' | 'manual';
  linked_document_id?: number;
  linked_document_title?: string;
  linked_risk_id?: number;
  linked_risk_title?: string;
  linked_exception_id?: number;
  linked_exception_title?: string;
  linked_regulatory_change_id?: number;
  linked_regulatory_change_title?: string;
}

interface SuggestedAgendaItem {
  id: number;
  title: string;
  description?: string;
  type: 'document' | 'exception' | 'regulatory_change';
  source_id: number;
  source_title: string;
  priority?: string;
  due_date?: string;
}

interface Minutes {
  id: number;
  meeting_id: number;
  content: string;
  status: 'draft' | 'approved';
  approved_by?: string;
  approved_at?: string;
}

interface Action {
  id: number;
  title: string;
  description?: string;
  action_type: string;
  status: 'open' | 'in_progress' | 'completed' | 'overdue';
  due_date: string;
  assigned_to_name?: string;
}

const MEETING_TYPE_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  regular: { label: 'Regular', bg: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)' },
  special: { label: 'Special', bg: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)' },
  emergency: { label: 'Emergency', bg: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)' },
};

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  scheduled: { bg: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' },
  in_progress: { bg: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)' },
  completed: { bg: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)' },
  cancelled: { bg: 'var(--color-subtle)', color: 'var(--color-muted)' },
  open: { bg: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)' },
  overdue: { bg: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)' },
  pending: { bg: 'var(--color-subtle)', color: 'var(--color-muted)' },
  discussed: { bg: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)' },
  deferred: { bg: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)' },
  draft: { bg: 'var(--color-subtle)', color: 'var(--color-muted)' },
  approved: { bg: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)' },
};

const SOURCE_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; bg: string; color: string }> = {
  document: { label: 'Document', icon: FileCheck, bg: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' },
  exception: { label: 'Exception', icon: Shield, bg: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)' },
  regulatory_change: { label: 'Regulatory Change', icon: Scale, bg: 'rgba(28, 43, 58, 0.06)', color: 'var(--color-base)' },
  manual: { label: 'Manual', icon: FileText, bg: 'var(--color-subtle)', color: 'var(--color-muted)' },
};

const ACTION_TYPES = [
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'policy_approval', label: 'Policy Approval' },
  { value: 'risk_review', label: 'Risk Review' },
  { value: 'audit_response', label: 'Audit Response' },
];

export default function MeetingDetailPage() {
  const params = useParams();
  const meetingId = parseInt(params.id as string);
  const { toast } = useToast();
  const [isAddAgendaModalOpen, setIsAddAgendaModalOpen] = useState(false);
  const [isAddActionModalOpen, setIsAddActionModalOpen] = useState(false);
  const [isAutoPopulateModalOpen, setIsAutoPopulateModalOpen] = useState(false);
  const [isEditMinutesOpen, setIsEditMinutesOpen] = useState(false);
  const [minutesContent, setMinutesContent] = useState('');
  const [autoPopulateOptions, setAutoPopulateOptions] = useState({
    include_documents: true,
    include_exceptions: true,
    include_regulatory_changes: true,
  });
  const [newAgendaItem, setNewAgendaItem] = useState({
    title: '',
    description: '',
    presenter: '',
    duration_minutes: 15,
    item_type: 'discussion',
  });
  const [newAction, setNewAction] = useState({
    title: '',
    description: '',
    action_type: 'follow_up',
    due_date: '',
    assigned_to_id: '',
  });
  const queryClient = useQueryClient();

  const { data: meeting, isLoading: meetingLoading } = useQuery({
    queryKey: ['meeting', meetingId],
    queryFn: async () => {
      try {
        const response = await committeeApi.getMeeting(meetingId);
        return response.data as Meeting;
      } catch {
        return {
          id: meetingId,
          committee_id: 2,
          committee_name: 'Risk Management Committee',
          title: 'Q1 2025 Risk Review',
          meeting_type: 'regular',
          scheduled_date: '2025-02-15',
          start_time: '10:00',
          end_time: '12:00',
          location: 'Boardroom A',
          status: 'scheduled',
          attendee_count: 7,
          quorum_required: 4,
          created_at: '2025-01-15',
        } as Meeting;
      }
    },
  });

  const { data: agenda, refetch: refetchAgenda } = useQuery({
    queryKey: ['meeting-agenda', meetingId],
    queryFn: async () => {
      try {
        const response = await committeeApi.getAgenda(meetingId);
        return response.data as AgendaItem[];
      } catch {
        return [
          { id: 1, meeting_id: meetingId, sequence: 1, title: 'Call to Order', description: 'Chair opens the meeting', presenter: 'Chair', duration_minutes: 5, item_type: 'procedural', status: 'pending', source_type: 'manual' },
          { id: 2, meeting_id: meetingId, sequence: 2, title: 'Approval of Previous Minutes', description: 'Review and approve minutes from last meeting', presenter: 'Secretary', duration_minutes: 10, item_type: 'approval', status: 'pending', source_type: 'manual' },
          { id: 3, meeting_id: meetingId, sequence: 3, title: 'Enterprise Risk Register Review', description: 'Review top 10 risks and mitigation progress', presenter: 'CRO', duration_minutes: 30, item_type: 'discussion', status: 'pending', source_type: 'manual' },
          { id: 4, meeting_id: meetingId, sequence: 4, title: 'Cyber Risk Update', description: 'Update on cybersecurity posture', presenter: 'CISO', duration_minutes: 20, item_type: 'discussion', status: 'pending', source_type: 'manual' },
          { id: 5, meeting_id: meetingId, sequence: 5, title: 'New Business', description: 'Any new items for discussion', presenter: 'All', duration_minutes: 15, item_type: 'discussion', status: 'pending', source_type: 'manual' },
          { id: 6, meeting_id: meetingId, sequence: 6, title: 'Adjournment', description: 'Close of meeting', presenter: 'Chair', duration_minutes: 5, item_type: 'procedural', status: 'pending', source_type: 'manual' },
        ] as AgendaItem[];
      }
    },
  });

  const { data: suggestedItems, isLoading: suggestedLoading } = useQuery({
    queryKey: ['suggested-agenda-items', meetingId],
    queryFn: async () => {
      try {
        const response = await committeeApi.getSuggestedAgendaItems(meetingId);
        return response.data as SuggestedAgendaItem[];
      } catch {
        return [
          { id: 1, title: 'Information Security Policy Review', description: 'Annual review due', type: 'document', source_id: 1, source_title: 'Information Security Policy', priority: 'high', due_date: '2025-02-28' },
          { id: 2, title: 'Critical Vulnerability Exception', description: 'Exception request for CVE-2024-1234', type: 'exception', source_id: 5, source_title: 'Patching Exception Request', priority: 'critical' },
          { id: 3, title: 'GDPR Amendment Impact', description: 'New data residency requirements', type: 'regulatory_change', source_id: 3, source_title: 'EU GDPR Amendment 2025', priority: 'medium' },
        ] as SuggestedAgendaItem[];
      }
    },
  });

  const { data: minutes } = useQuery({
    queryKey: ['meeting-minutes', meetingId],
    queryFn: async () => {
      try {
        const response = await committeeApi.getMeeting(meetingId);
        return (response.data as any).minutes as Minutes | null;
      } catch {
        return null;
      }
    },
  });

  const { data: actions } = useQuery({
    queryKey: ['meeting-actions', meetingId],
    queryFn: async () => {
      try {
        const response = await committeeApi.getActions({ committee_id: meeting?.committee_id });
        return (response.data as Action[]).filter((a: any) => a.meeting_id === meetingId);
      } catch {
        return [
          { id: 1, title: 'Update Risk Register for Q1', description: 'Review and update the enterprise risk register', action_type: 'risk_review', status: 'open', due_date: '2025-02-28', assigned_to_name: 'David Lee' },
          { id: 2, title: 'Prepare Cyber Risk Report', description: 'Detailed report on current cyber threats', action_type: 'follow_up', status: 'open', due_date: '2025-03-01', assigned_to_name: 'CISO' },
        ] as Action[];
      }
    },
    enabled: !!meeting,
  });

  const addAgendaMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.addAgendaItem(meetingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting-agenda', meetingId] });
      setIsAddAgendaModalOpen(false);
      setNewAgendaItem({ title: '', description: '', presenter: '', duration_minutes: 15, item_type: 'discussion' });
      toast({ title: 'Agenda item added', type: 'success' });
    },
  });

  const createActionMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.createAction(meetingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting-actions', meetingId] });
      setIsAddActionModalOpen(false);
      setNewAction({ title: '', description: '', action_type: 'follow_up', due_date: '', assigned_to_id: '' });
      toast({ title: 'Action created', type: 'success' });
    },
  });

  const createMinutesMutation = useMutation({
    mutationFn: (data: { content: string }) => committeeApi.createMinutes(meetingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting-minutes', meetingId] });
      setIsEditMinutesOpen(false);
      toast({ title: 'Minutes saved', type: 'success' });
    },
  });

  const autoPopulateMutation = useMutation({
    mutationFn: async (options: { include_documents: boolean; include_exceptions: boolean; include_regulatory_changes: boolean }) => {
      const response = await committeeApi.autoPopulateAgenda(meetingId, options);
      return response.data as { items_added: number; items: any[] };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['meeting-agenda', meetingId] });
      queryClient.invalidateQueries({ queryKey: ['suggested-agenda-items', meetingId] });
      setIsAutoPopulateModalOpen(false);
      toast({
        title: 'Agenda Populated',
        message: `${data.items_added || 0} item${(data.items_added || 0) !== 1 ? 's' : ''} added to the agenda`,
        type: 'success',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        message: 'Failed to auto-populate agenda',
        type: 'error',
      });
    },
  });

  const getLinkedItemInfo = (item: AgendaItem) => {
    const links = [];
    if (item.linked_document_title) {
      links.push({ type: 'Document', title: item.linked_document_title, icon: FileCheck });
    }
    if (item.linked_risk_title) {
      links.push({ type: 'Risk', title: item.linked_risk_title, icon: AlertCircle });
    }
    if (item.linked_exception_title) {
      links.push({ type: 'Exception', title: item.linked_exception_title, icon: Shield });
    }
    if (item.linked_regulatory_change_title) {
      links.push({ type: 'Regulatory Change', title: item.linked_regulatory_change_title, icon: Scale });
    }
    return links;
  };

  if (meetingLoading) {
    return (
      <div className="space-y-8">
        <div className="skeleton h-8 w-64 mb-4" />
        <div className="skeleton h-5 w-96" />
      </div>
    );
  }

  const meetingTypeStyle = MEETING_TYPE_STYLES[meeting?.meeting_type || 'regular'];
  const statusStyle = STATUS_STYLES[meeting?.status || 'scheduled'];

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/governance/committees/${meeting?.committee_id}`} className="flex items-center gap-2 mb-4" style={{ color: 'var(--color-muted)' }}>
          <ArrowLeft className="h-4 w-4" />
          Back to {meeting?.committee_name}
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Calendar className="h-7 w-7" style={{ color: 'var(--color-base)' }} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{meeting?.title}</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: meetingTypeStyle?.bg, color: meetingTypeStyle?.color }}>
                  {meetingTypeStyle?.label}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: statusStyle?.bg, color: statusStyle?.color }}>
                  {meeting?.status.replace('_', ' ')}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 mt-4 text-sm" style={{ color: 'var(--color-muted)' }}>
          <span className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4" />
            {new Date(meeting?.scheduled_date || '').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
          {meeting?.start_time && (
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {meeting.start_time} - {meeting.end_time}
            </span>
          )}
          {meeting?.location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />
              {meeting.location}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            {meeting?.attendee_count} attendees (Quorum: {meeting?.quorum_required})
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Lightbulb className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
                Suggested Agenda Items
              </h3>
              <button
                onClick={() => setIsAutoPopulateModalOpen(true)}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                <Sparkles className="h-4 w-4" />
                Auto-Populate Agenda
              </button>
            </div>

            {suggestedLoading ? (
              <div className="space-y-3">
                <div className="skeleton h-16 w-full" />
                <div className="skeleton h-16 w-full" />
              </div>
            ) : (suggestedItems || []).length > 0 ? (
              <div className="space-y-3">
                {(suggestedItems || []).map((item) => {
                  const typeConfig = SOURCE_TYPE_CONFIG[item.type] || SOURCE_TYPE_CONFIG.manual;
                  const TypeIcon = typeConfig.icon;
                  return (
                    <div key={`${item.type}-${item.id}`} className="p-4 rounded-lg transition-colors" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: typeConfig.bg }}>
                            <TypeIcon className="h-4 w-4" style={{ color: typeConfig.color }} />
                          </div>
                          <div>
                            <h4 className="font-medium" style={{ color: 'var(--color-text)' }}>{item.title}</h4>
                            {item.description && <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{item.description}</p>}
                            <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                              <span className="px-2 py-0.5 rounded-full" style={{ backgroundColor: typeConfig.bg, color: typeConfig.color }}>
                                {typeConfig.label}
                              </span>
                              <span>Source: {item.source_title}</span>
                              {item.priority && (
                                <span className="capitalize" style={{ color: item.priority === 'critical' ? 'var(--color-danger)' : item.priority === 'high' ? 'var(--color-warning)' : 'var(--color-muted)' }}>
                                  {item.priority} priority
                                </span>
                              )}
                              {item.due_date && <span>Due: {new Date(item.due_date).toLocaleDateString()}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <Lightbulb className="h-10 w-10 mx-auto mb-3" style={{ color: 'var(--color-muted)' }} />
                <p style={{ color: 'var(--color-muted)' }}>No suggested items at this time</p>
                <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>Items will appear when there are pending documents, exceptions, or regulatory changes</p>
              </div>
            )}
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <ListOrdered className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
                Agenda
              </h3>
              <button
                onClick={() => setIsAddAgendaModalOpen(true)}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                <Plus className="h-4 w-4" />
                Add Item
              </button>
            </div>

            <div className="space-y-3">
              {(agenda || []).sort((a, b) => a.sequence - b.sequence).map((item) => {
                const sourceConfig = SOURCE_TYPE_CONFIG[item.source_type || 'manual'] || SOURCE_TYPE_CONFIG.manual;
                const linkedItems = getLinkedItemInfo(item);
                return (
                  <div key={item.id} className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' }}>
                          {item.sequence}
                        </div>
                        <div className="flex-1">
                          <h4 className="font-medium" style={{ color: 'var(--color-text)' }}>{item.title}</h4>
                          {item.description && <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{item.description}</p>}
                          <div className="flex flex-wrap items-center gap-4 mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                            {item.presenter && <span>Presenter: {item.presenter}</span>}
                            {item.duration_minutes && <span>{item.duration_minutes} min</span>}
                            <span className="capitalize">{item.item_type}</span>
                            {item.source_type && item.source_type !== 'manual' && (
                              <span className="px-2 py-0.5 rounded-full" style={{ backgroundColor: sourceConfig.bg, color: sourceConfig.color }}>
                                {sourceConfig.label}
                              </span>
                            )}
                          </div>
                          {linkedItems.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                              <LinkIcon className="h-3 w-3" style={{ color: 'var(--color-muted)' }} />
                              {linkedItems.map((link, idx) => {
                                const Icon = link.icon;
                                return (
                                  <span key={idx} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded" style={{ color: 'var(--color-muted)', backgroundColor: 'var(--color-subtle)' }}>
                                    <Icon className="h-3 w-3" />
                                    <span style={{ color: 'var(--color-muted)' }}>{link.type}:</span> {link.title}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: STATUS_STYLES[item.status]?.bg, color: STATUS_STYLES[item.status]?.color }}>
                        {item.status}
                      </span>
                    </div>
                  </div>
                );
              })}

              {(agenda || []).length === 0 && (
                <div className="text-center py-8">
                  <ListOrdered className="h-10 w-10 mx-auto mb-3" style={{ color: 'var(--color-muted)' }} />
                  <p style={{ color: 'var(--color-muted)' }}>No agenda items yet</p>
                  <button onClick={() => setIsAddAgendaModalOpen(true)} className="text-primary-400 hover:text-primary-300 text-sm mt-2">
                    Add first item
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <FileText className="h-5 w-5" style={{ color: 'var(--color-success)' }} />
                Minutes
              </h3>
              {!minutes && (
                <button onClick={() => setIsEditMinutesOpen(true)} className="btn-primary flex items-center gap-2 text-sm">
                  <Plus className="h-4 w-4" />
                  Draft Minutes
                </button>
              )}
            </div>

            {minutes ? (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: STATUS_STYLES[minutes.status]?.bg, color: STATUS_STYLES[minutes.status]?.color }}>
                    {minutes.status}
                  </span>
                  {minutes.approved_by && (
                    <span className="text-sm" style={{ color: 'var(--color-muted)' }}>Approved by {minutes.approved_by}</span>
                  )}
                </div>
                <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                  <p className="whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{minutes.content}</p>
                </div>
              </div>
            ) : isEditMinutesOpen ? (
              <div className="space-y-4">
                <textarea
                  value={minutesContent}
                  onChange={(e) => setMinutesContent(e.target.value)}
                  className="input w-full h-48"
                  placeholder="Enter meeting minutes..."
                />
                <div className="flex justify-end gap-3">
                  <button onClick={() => setIsEditMinutesOpen(false)} className="btn-secondary">Cancel</button>
                  <button
                    onClick={() => createMinutesMutation.mutate({ content: minutesContent })}
                    disabled={createMinutesMutation.isPending}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Save className="h-4 w-4" />
                    {createMinutesMutation.isPending ? 'Saving...' : 'Save Draft'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <FileText className="h-10 w-10 mx-auto mb-3" style={{ color: 'var(--color-muted)' }} />
                <p style={{ color: 'var(--color-muted)' }}>No minutes recorded yet</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <CheckSquare className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
                Actions
              </h3>
              <button onClick={() => setIsAddActionModalOpen(true)} className="text-primary-400 hover:text-primary-300 text-sm">
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              {(actions || []).map((action) => (
                <div key={action.id} className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-start justify-between">
                    <h4 className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{action.title}</h4>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: STATUS_STYLES[action.status]?.bg, color: STATUS_STYLES[action.status]?.color }}>
                      {action.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
                    <div>Due: {new Date(action.due_date).toLocaleDateString()}</div>
                    {action.assigned_to_name && <div>Assigned: {action.assigned_to_name}</div>}
                  </div>
                </div>
              ))}

              {(actions || []).length === 0 && (
                <div className="text-center py-6">
                  <CheckSquare className="h-8 w-8 mx-auto mb-2" style={{ color: 'var(--color-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No actions from this meeting</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {isAutoPopulateModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-xl p-6 w-full max-w-lg mx-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Sparkles className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
                Auto-Populate Agenda
              </h2>
              <button onClick={() => setIsAutoPopulateModalOpen(false)} style={{ color: 'var(--color-muted)' }}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mb-6" style={{ color: 'var(--color-muted)' }}>
              Select which types of items to include in the agenda. The system will automatically add relevant pending items.
            </p>

            <div className="space-y-4 mb-6">
              <label className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                <input
                  type="checkbox"
                  checked={autoPopulateOptions.include_documents}
                  onChange={(e) => setAutoPopulateOptions({ ...autoPopulateOptions, include_documents: e.target.checked })}
                  className="w-4 h-4 rounded text-primary-500 focus:ring-primary-500"
                  style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                />
                <FileCheck className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
                <div>
                  <span className="font-medium" style={{ color: 'var(--color-text)' }}>Documents</span>
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Pending document approvals and reviews</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                <input
                  type="checkbox"
                  checked={autoPopulateOptions.include_exceptions}
                  onChange={(e) => setAutoPopulateOptions({ ...autoPopulateOptions, include_exceptions: e.target.checked })}
                  className="w-4 h-4 rounded text-primary-500 focus:ring-primary-500"
                  style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                />
                <Shield className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
                <div>
                  <span className="font-medium" style={{ color: 'var(--color-text)' }}>Exceptions</span>
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Risk and control exceptions requiring approval</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                <input
                  type="checkbox"
                  checked={autoPopulateOptions.include_regulatory_changes}
                  onChange={(e) => setAutoPopulateOptions({ ...autoPopulateOptions, include_regulatory_changes: e.target.checked })}
                  className="w-4 h-4 rounded text-primary-500 focus:ring-primary-500"
                  style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                />
                <Scale className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
                <div>
                  <span className="font-medium" style={{ color: 'var(--color-text)' }}>Regulatory Changes</span>
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Pending regulatory updates and impact assessments</p>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setIsAutoPopulateModalOpen(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => autoPopulateMutation.mutate(autoPopulateOptions)}
                disabled={autoPopulateMutation.isPending || (!autoPopulateOptions.include_documents && !autoPopulateOptions.include_exceptions && !autoPopulateOptions.include_regulatory_changes)}
                className="btn-primary flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {autoPopulateMutation.isPending ? 'Populating...' : 'Populate Agenda'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isAddAgendaModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-xl p-6 w-full max-w-lg mx-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Add Agenda Item</h2>
              <button onClick={() => setIsAddAgendaModalOpen(false)} style={{ color: 'var(--color-muted)' }}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); addAgendaMutation.mutate(newAgendaItem); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Title *</label>
                <input type="text" value={newAgendaItem.title} onChange={(e) => setNewAgendaItem({ ...newAgendaItem, title: e.target.value })} className="input w-full" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Description</label>
                <textarea value={newAgendaItem.description} onChange={(e) => setNewAgendaItem({ ...newAgendaItem, description: e.target.value })} className="input w-full" rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Presenter</label>
                  <input type="text" value={newAgendaItem.presenter} onChange={(e) => setNewAgendaItem({ ...newAgendaItem, presenter: e.target.value })} className="input w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Duration (min)</label>
                  <input type="number" value={newAgendaItem.duration_minutes} onChange={(e) => setNewAgendaItem({ ...newAgendaItem, duration_minutes: parseInt(e.target.value) })} className="input w-full" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Item Type</label>
                <select value={newAgendaItem.item_type} onChange={(e) => setNewAgendaItem({ ...newAgendaItem, item_type: e.target.value })} className="input w-full">
                  <option value="procedural">Procedural</option>
                  <option value="approval">Approval</option>
                  <option value="discussion">Discussion</option>
                  <option value="information">Information</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setIsAddAgendaModalOpen(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={addAgendaMutation.isPending} className="btn-primary">
                  {addAgendaMutation.isPending ? 'Adding...' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAddActionModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-xl p-6 w-full max-w-lg mx-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Create Action</h2>
              <button onClick={() => setIsAddActionModalOpen(false)} style={{ color: 'var(--color-muted)' }}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); createActionMutation.mutate({ ...newAction, assigned_to_id: newAction.assigned_to_id ? parseInt(newAction.assigned_to_id) : null }); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Title *</label>
                <input type="text" value={newAction.title} onChange={(e) => setNewAction({ ...newAction, title: e.target.value })} className="input w-full" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Description</label>
                <textarea value={newAction.description} onChange={(e) => setNewAction({ ...newAction, description: e.target.value })} className="input w-full" rows={2} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Action Type</label>
                <select value={newAction.action_type} onChange={(e) => setNewAction({ ...newAction, action_type: e.target.value })} className="input w-full">
                  {ACTION_TYPES.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Due Date *</label>
                  <input type="date" value={newAction.due_date} onChange={(e) => setNewAction({ ...newAction, due_date: e.target.value })} className="input w-full" required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Assigned To (User ID)</label>
                  <input type="number" value={newAction.assigned_to_id} onChange={(e) => setNewAction({ ...newAction, assigned_to_id: e.target.value })} className="input w-full" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setIsAddActionModalOpen(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createActionMutation.isPending} className="btn-primary">
                  {createActionMutation.isPending ? 'Creating...' : 'Create Action'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
