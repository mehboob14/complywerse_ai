'use client';

// Governance > Committees > a committee: its members, charters, meetings, actions and settings (the tab is in the address: ?tab=members).
// The data flow is what it has always been: the same requests, the same query keys and invalidations, the AI charter draft and comparison unchanged. What moved to
// the design-system kit (components/ui/ds): the page head, the tabs, the lists as tables (cards below 768px), the pills, the drawers (they ask "Discard changes?"),
// the AI comparison (a real dialog now, not a hand-made overlay), and feedback: every write is a useReportedMutation (a confirmation only after the server
// answered; a failure stays with the server's words and, where repeating helps, Retry), every question a useConfirm. Counts are the server's (`member_count`,
// `meeting_count`, `pending_actions_count`, a list's `total`), never the length of a list cut at 50 or 100.
// Not changed: the delete is still the server's hard delete (asked in a dialog that names what goes with it; the plan to replace it with Deactivate is
// G4_committee_deactivation_plan.md); a removed Chair or Secretary is cleared by the server and the question says so; the Settings tab still edits Task
// Management's SLA for every module; "Schedule meeting" still sends what it sent (the server stores the date; start and end time are asked and not kept).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle, Calendar, CheckCircle, CheckSquare, ChevronDown, ChevronRight, Copy, Download, Edit2, Eye, FileText, GitCompare, Paperclip, Plus, Save, Search,
  ShieldCheck, Sparkles, Star, Trash2, Upload, UserMinus, UserPlus, Users, XCircle,
} from 'lucide-react';
import { committeeApi, apiClient } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/ui';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { useModuleSettings } from '@/components/settings/CustomFields';
import { PRIORITIES, PrioritySlaEditor, priorityChoices, slaDays } from '@/components/settings/PrioritySla';
import {
  Button, Checkbox, EmptyState, ErrorState, FormField, IconButton, Pager, PersonChip, PersonStack, RegisterTable, Select, Skeleton, SkeletonLines, StatusPill, Tabs, TabPanel,
  Textarea, TextInput, useTabParam, type RegisterColumn,
} from '@/components/ui/ds';
import { errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { useConfirm } from '@/components/ui/ds/useConfirm';
import { useNotify } from '@/components/ui/ds/useNotify';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { EMPTY, NOT_SET, formatCount, formatDate, statusLabel, truncate } from '@/lib/format';
import { pageRange } from '@/lib/pagerModel';
import { actionStatus, meetingStatus, statusPill } from '@/lib/status';
import {
  ACTION_TYPES, COMMITTEE_TABS, DEFAULT_COMMITTEE_TAB, actionTypeLabel, committeeTypeLabel, cutNotice, deleteCommitteePlan, dueDay, formChanged, isOverdueAction, listOf,
  meetingDay, meetingWhen, removeMemberPlan, type CommitteeTab, type SlaLike,
} from '@/lib/committees';
import {
  ActionStatusPills, ClampedText, CommitteeActivity, DrawerFooter, FileInput, FormProblem, PickerField, PriorityTag, SlaTag,
} from '../_ui';

interface Committee {
  id: number;
  name: string;
  description?: string;
  committee_type: string;
  chair_id?: number | null;
  chair_name?: string | null;
  secretary_id?: number | null;
  secretary_name?: string | null;
  meeting_frequency?: string;
  is_active?: boolean;
  member_count: number;
  meeting_count?: number;
  pending_actions_count?: number;
  members?: Member[];
  created_at: string;
  updated_at: string;
}

interface Member {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  role: string;
  joined_at: string;
}

interface Charter {
  id: number;
  title: string;
  content: string;
  version: string;
  status: 'draft' | 'active' | 'superseded';
  effective_date: string;
  approved_by?: number;
  approver_name?: string | null;
  approved_at?: string;
  created_by?: number;
  creator_name?: string | null;
  file_path?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  // Populated by the upload-new endpoint or any path that parses structured sections. The page prefers this when present so an uploaded charter renders the same
  // way an AI-drafted one does.
  sections?: CharterSection[] | null;
}

interface Meeting {
  id: number;
  title: string;
  meeting_type: 'regular' | 'special' | 'emergency';
  scheduled_date: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  attendee_count: number;
  agenda_item_count?: number;
  action_count?: number;
}

interface Action {
  id: number;
  title: string;
  description?: string;
  action_type: string;
  status: 'open' | 'in_progress' | 'completed' | 'overdue';
  is_overdue?: boolean;
  priority?: string;
  sla?: SlaLike | null;
  due_date: string | null;
  assigned_to_name?: string;
  meeting_id?: number;
}

interface TenantUser {
  id?: number;
  user_id?: number;
  display_name?: string;
  username?: string;
  email?: string;
  user?: {
    id?: number;
    display_name?: string;
    username?: string;
    email?: string;
  };
}

interface CharterSection {
  title: string;
  content: string;
  framework_references: string[];
}

interface AICharterResult {
  committee_id: number;
  committee_name: string;
  committee_type: string;
  frameworks_analyzed: string[];
  controls_analyzed: number;
  charter: {
    charter_title: string;
    sections: CharterSection[];
    summary: string;
  };
}

interface ComparisonSection {
  title: string;
  status: 'covered' | 'partial' | 'missing' | 'exceeds';
  score: number;
  existing_content_summary: string;
  recommendation: string;
  framework_requirements: string[];
}

interface ComparisonGap {
  description: string;
  severity: 'high' | 'medium' | 'low';
  frameworks: string[];
}

interface AIComparisonResult {
  committee_id: number;
  committee_name: string;
  charter_id?: number;
  frameworks_analyzed: string[];
  controls_analyzed: number;
  comparison: {
    overall_score: number;
    overall_assessment: string;
    sections: ComparisonSection[];
    gaps: ComparisonGap[];
    strengths: string[];
    recommendations: string[];
    framework_coverage: {
      addressed: string[];
      partially_addressed: string[];
      not_addressed: string[];
    };
  };
}

const MEETING_TYPE_LABELS: Record<string, string> = { regular: 'Regular', special: 'Special', emergency: 'Emergency' };
const CHARTER_TONE: Record<string, 'success' | 'neutral' | 'danger'> = { active: 'success', draft: 'neutral', expired: 'danger', superseded: 'neutral' };
const TAB_ITEMS = [
  { key: 'members', label: 'Members' },
  { key: 'charters', label: 'Charters' },
  { key: 'meetings', label: 'Meetings' },
  { key: 'actions', label: 'Actions' },
  { key: 'settings', label: 'Settings' },
];
const COMMITTEE_TYPE_OPTIONS = ['board', 'risk_committee', 'audit_committee', 'compliance_committee', 'it_steering', 'custom'].map((value) => ({ value, label: committeeTypeLabel(value, 'long') }));
const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'bi-weekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'ad_hoc', label: 'Ad hoc' },
];
const MEMBER_ROLES = [
  { value: 'member', label: 'Member' },
  { value: 'chair', label: 'Chair' },
  { value: 'secretary', label: 'Secretary' },
];
const NEW_MEETING = { title: '', meeting_type: 'regular', scheduled_date: '', start_time: '', end_time: '', location: '' };
const NEW_ACTION = { meeting_id: '', title: '', description: '', action_type: 'follow_up', priority: 'medium', due_date: '', assigned_to_id: '' };
const NEW_MEMBER = { user_id: '', role: 'member' };
const MEMBER_PAGE = 25;
const SUB_HEAD = 'text-ds-label text-ds-fg-muted';
const short = (name: string): string => truncate(name, 60).text;

function getStatusIcon(s: string) {
  if (s === 'covered') return <CheckCircle className="h-4 w-4 text-emerald-600" />;
  if (s === 'partial') return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  if (s === 'missing') return <XCircle className="h-4 w-4 text-rose-600" />;
  if (s === 'exceeds') return <Star className="h-4 w-4 text-blue-600" />;
  return null;
}

function getStatusColor(s: string) {
  if (s === 'covered') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (s === 'partial') return 'text-amber-700 bg-amber-50 border-amber-200';
  if (s === 'missing') return 'text-rose-700 bg-rose-50 border-rose-200';
  if (s === 'exceeds') return 'text-blue-700 bg-blue-50 border-blue-200';
  return 'text-slate-600 bg-slate-50 border-slate-200';
}

function getScoreColor(score: number) {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-amber-600';
  if (score >= 40) return 'text-orange-600';
  return 'text-rose-600';
}

function getScoreRingColor(score: number) {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#eab308';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

export default function CommitteeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const committeeId = parseInt(params.id as string);
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:committees:create');
  const canDelete = hasPermission('governance:committees:delete');
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useTabParam('tab', COMMITTEE_TABS, { fallback: DEFAULT_COMMITTEE_TAB });
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [isScheduleMeetingModalOpen, setIsScheduleMeetingModalOpen] = useState(false);
  const [isCreateActionModalOpen, setIsCreateActionModalOpen] = useState(false);
  // Master-detail: which meeting's inline detail shows in the Meetings tab.
  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(null);
  const [newMember, setNewMember] = useState(NEW_MEMBER);
  const [newMeeting, setNewMeeting] = useState(NEW_MEETING);
  const [newAction, setNewAction] = useState(NEW_ACTION);
  const [actionUploadFile, setActionUploadFile] = useState<File | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberPage, setMemberPage] = useState(1);
  const queryClient = useQueryClient();

  // Edit-committee state: the editable copy of name, description and the rest until it is saved; closing the panel discards it. `editInitial` is what it opened with
  // (so the drawer knows whether anything was typed).
  const [isEditCommitteeOpen, setIsEditCommitteeOpen] = useState(false);
  const blankEdit = { name: '', description: '', committee_type: 'custom', chair_id: '' as string, secretary_id: '' as string, meeting_frequency: 'monthly' };
  const [editCommitteeDraft, setEditCommitteeDraft] = useState(blankEdit);
  const [editInitial, setEditInitial] = useState(blankEdit);

  const [aiCharterResult, setAiCharterResult] = useState<AICharterResult | null>(null);
  const [showAiCharterPanel, setShowAiCharterPanel] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [comparisonResult, setComparisonResult] = useState<AIComparisonResult | null>(null);
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const [editingCharterId, setEditingCharterId] = useState<number | null>(null);
  const [editCharterTitle, setEditCharterTitle] = useState('');
  const [editCharterContent, setEditCharterContent] = useState('');
  const [editCharterStatus, setEditCharterStatus] = useState('draft');
  const [selectedFrameworkIds, setSelectedFrameworkIds] = useState<number[]>([]);
  const [showFrameworkSelectionModal, setShowFrameworkSelectionModal] = useState(false);

  const committeeQ = useQuery({
    queryKey: ['committee', committeeId],
    queryFn: async () => {
      const response = await committeeApi.getCommittee(committeeId);
      return response.data as Committee;
    },
  });
  const committee = committeeQ.data;

  const membersQ = useQuery({
    queryKey: ['committee-members', committeeId],
    queryFn: async () => {
      const response = await committeeApi.getMembers(committeeId);
      return response.data as Member[];
    },
    enabled: !!committee && (tab === 'members' || isAddMemberModalOpen),
    placeholderData: keepPreviousData,
  });
  const members = membersQ.data;

  const chartersQ = useQuery({
    queryKey: ['committee-charters', committeeId],
    queryFn: async () => {
      const response = await committeeApi.getCharters(committeeId);
      return response.data as Charter[];
    },
    enabled: !!committee,
    placeholderData: keepPreviousData,
  });
  const charters = chartersQ.data;

  // the meetings the API sends (50 at most, newest first) and how many there are: the count says so when the list is cut
  const meetingsQ = useQuery({
    queryKey: ['committee-meetings', committeeId],
    queryFn: async () => listOf<Meeting>((await committeeApi.getMeetings(committeeId)).data),
    enabled: !!committee,
    placeholderData: keepPreviousData,
  });
  const meetings = meetingsQ.data?.items;
  const meetingsTotal = meetingsQ.data?.total ?? 0;

  // Task Management's SLA table: the days each priority allows (a person without access to it just gets no hints).
  const { data: taskSettings, isLoading: taskSettingsLoading, failureCount: taskSettingsFailures } = useModuleSettings('tasks');

  // the actions the API sends (100 at most) and how many there are
  const actionsQ = useQuery({
    queryKey: ['committee-actions', committeeId],
    queryFn: async () => {
      const { items, total } = listOf<Record<string, any>>((await committeeApi.getActions({ committee_id: committeeId })).data);
      return { total, items: items.map((item) => ({ ...item, assigned_to_name: item.assigned_to_name || item.assignee_name || '' })) as Action[] };
    },
    enabled: !!committee,
    placeholderData: keepPreviousData,
  });
  const actions = actionsQ.data?.items;
  const actionsTotal = actionsQ.data?.total ?? 0;

  // Selected meeting's agenda + detail (minutes) for the master-detail panel.
  const { data: selectedMeetingAgenda = [] } = useQuery({
    queryKey: ['committee-meeting-agenda', selectedMeetingId],
    enabled: !!selectedMeetingId,
    queryFn: async () => {
      const res = await committeeApi.getAgenda(selectedMeetingId as number);
      return (Array.isArray(res.data) ? res.data : []) as any[];
    },
  });
  const { data: selectedMeetingDetail } = useQuery({
    queryKey: ['committee-meeting-detail', selectedMeetingId],
    enabled: !!selectedMeetingId,
    queryFn: async () => (await committeeApi.getMeeting(selectedMeetingId as number)).data as any,
  });

  // Default the Meetings tab to the first meeting; reset if the selected one vanishes.
  useEffect(() => {
    if (tab === 'meetings' && meetings && meetings.length > 0) {
      setSelectedMeetingId((cur) => (cur && meetings.some((m) => m.id === cur) ? cur : meetings[0].id));
    }
  }, [tab, meetings]);

  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => apiClient.get('/auth/me').then((r) => r.data),
  });

  const tenantId = currentUser?.user?.primary_tenant_id || currentUser?.primary_tenant_id;

  const { data: tenantUsers } = useQuery({
    queryKey: ['tenant-users-for-committee-actions', tenantId],
    queryFn: async () => {
      const response = await apiClient.get(`/tenants/${tenantId}/users`);
      const payload = response.data as unknown;
      if (Array.isArray(payload)) return payload as TenantUser[];
      const data = payload as { users?: TenantUser[]; items?: TenantUser[] };
      return data.users || data.items || [];
    },
    enabled: !!tenantId,
  });

  const { data: availableFrameworks } = useQuery({
    queryKey: ['available-frameworks-for-charter'],
    queryFn: async () => {
      const response = await apiClient.get('/framework-upload/upload', { params: { limit: 1000 } });
      const payload = response.data as unknown;
      const validStatuses = new Set(['published', 'parsed', 'classified', 'completed']);
      const dedupeByName = (frameworks: any[]) => {
        const seen = new Set<string>();
        return frameworks.filter((framework) => {
          const normalizedName = String(framework?.name || '').trim().toLowerCase();
          if (!normalizedName || seen.has(normalizedName)) {
            return false;
          }
          seen.add(normalizedName);
          return true;
        });
      };
      if (Array.isArray(payload)) {
        return dedupeByName(payload as any[])
          .filter((framework) => validStatuses.has((framework?.upload_status || '').toLowerCase()))
          .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
      }
      const data = payload as { items?: any[] };
      return dedupeByName(data.items || [])
        .filter((framework) => validStatuses.has((framework?.upload_status || '').toLowerCase()))
        .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    },
  });

  const normalizedTenantUsers = useMemo(() => Array.from(
    new Map(
      ((tenantUsers || []) as TenantUser[])
        .map((tenantUser) => {
          const userId = tenantUser.user?.id || tenantUser.id || tenantUser.user_id;
          const userName = tenantUser.user?.display_name || tenantUser.user?.username || tenantUser.display_name || tenantUser.username || tenantUser.user?.email || tenantUser.email || 'User';
          if (!userId) return null;
          return { id: userId, name: userName };
        })
        .filter((user): user is { id: number; name: string } => !!user)
        .map((user) => [user.id, user] as [number, { id: number; name: string }])
    ).values()
  ), [tenantUsers]);
  const nameOfUser = (id: number): string => normalizedTenantUsers.find((u) => u.id === id)?.name || `User ${id}`;

  // ── writes: each one says what happened only after the server has answered (a failure stays, with the server's words) ──
  const addMemberMutation = useReportedMutation({
    mutationFn: (data: { user_id: number; role: string }) => committeeApi.addMember(committeeId, data),
    success: (_r, v) => `${nameOfUser(v.user_id)} added as ${statusLabel(v.role).toLowerCase()}`,
    failure: "Couldn't add the member",
    invalidate: [['committee-members', committeeId], ['committee', committeeId]],          // a chair or secretary is also written onto the committee itself
    onSuccess: () => { setIsAddMemberModalOpen(false); setNewMember(NEW_MEMBER); },
  });

  const updateCommitteeMutation = useReportedMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.updateCommittee(committeeId, data),
    success: 'Committee saved',
    failure: "Couldn't save the committee",
    invalidate: [['committee', committeeId]],
    onSuccess: () => setIsEditCommitteeOpen(false),
  });

  const deleteCommitteeMutation = useReportedMutation({
    mutationFn: () => committeeApi.deleteCommittee(committeeId),
    success: () => `Deleted ${short(committee?.name ?? 'the committee')}`,
    failure: "Couldn't delete the committee",
    invalidate: [['committee-overview'], ['committees']],
    onSuccess: () => router.push('/governance/committees'),
  });

  const removeMemberMutation = useReportedMutation({
    mutationFn: (m: Member) => committeeApi.removeMember(committeeId, m.user_id),
    success: (_r, m) => `Removed ${m.user_name || nameOfUser(m.user_id)}`,
    failure: "Couldn't remove the member",
    invalidate: [['committee-members', committeeId], ['committee', committeeId]],          // the server clears a removed chair or secretary from the committee
  });

  const createMeetingMutation = useReportedMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.createMeeting(committeeId, data),
    success: (_r, v) => `Meeting ${short(String(v.title))} scheduled`,
    failure: "Couldn't schedule the meeting",
    retryable: false,                                              // a create is not safe to repeat blindly: the drawer stays open to try again
    invalidate: [['committee-meetings', committeeId]],
    onSuccess: () => { setIsScheduleMeetingModalOpen(false); setNewMeeting(NEW_MEETING); },
  });

  const createActionMutation = useReportedMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.createManualAction(data),
    success: (_r, v) => `Action ${short(String(v.title))} created`,
    failure: "Couldn't create the action",
    retryable: false,
    invalidate: [['committee-actions', committeeId]],
    onSuccess: () => { setIsCreateActionModalOpen(false); setNewAction(NEW_ACTION); setActionUploadFile(null); },
  });

  // Re-prioritising an action re-dates it (unless the date was chosen) and updates its twin in Task Management.
  const updateActionMutation = useReportedMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown>; title: string }) => committeeApi.updateAction(id, data),
    success: (_r, v) => ({ title: 'Priority changed', message: `${short(v.title)}: ${statusLabel(String(v.data.priority))}` }),
    failure: "Couldn't change the priority",
    invalidate: [['committee-actions', committeeId]],
  });

  const aiRewordActionMutation = useReportedMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (newAction.description.trim()) {
        formData.append('text', newAction.description.trim());
      }
      if (actionUploadFile) {
        formData.append('file', actionUploadFile);
      }
      formData.append('tone', 'professional');
      const response = await committeeApi.aiRewordActionText(formData);
      return response.data as { text: string };
    },
    success: 'Description reworded',
    failure: "Couldn't reword the description",
    onSuccess: (result) => setNewAction((prev) => ({ ...prev, description: result.text || prev.description })),
  });

  const aiSummarizeActionMutation = useReportedMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (newAction.description.trim()) {
        formData.append('text', newAction.description.trim());
      }
      if (actionUploadFile) {
        formData.append('file', actionUploadFile);
      }
      const response = await committeeApi.aiSummarizeActionText(formData);
      return response.data as { text: string };
    },
    success: 'Summary added to the description',
    failure: "Couldn't summarise the description",
    onSuccess: (result) => setNewAction((prev) => ({ ...prev, description: result.text || prev.description })),
  });

  const uploadCharterFileMutation = useReportedMutation({
    mutationFn: ({ charterId, file }: { charterId: number; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      return committeeApi.uploadCharterFile(committeeId, charterId, formData);
    },
    success: (_r, v) => ({ title: 'File attached to the charter', message: truncate(v.file.name, 80).text }),
    failure: "Couldn't attach the file",
    invalidate: [['committee-charters', committeeId]],
  });

  // "Upload Charter": a new charter made straight from a PDF / DOCX / TXT file. One round trip: the server extracts the text, saves the file and returns the row.
  // It comes before "AI Generate Charter" because importing an existing charter is the more common path.
  const uploadNewCharterMutation = useReportedMutation({
    mutationFn: (file: File) => committeeApi.uploadNewCharter(committeeId, file, { status: 'draft' }),
    success: (_r, file) => ({ title: 'Charter uploaded as a draft', message: truncate(file.name, 80).text }),
    failure: "Couldn't upload the charter",
    retryable: false,
    invalidate: [['committee-charters', committeeId]],
  });

  // Hidden file input bound to the Upload button.
  const uploadCharterInputRef = useRef<HTMLInputElement | null>(null);
  const onPickUploadCharterFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadNewCharterMutation.mutate(file);
    // Reset so picking the same file twice still fires onChange.
    if (e.target) e.target.value = '';
  };

  const aiGenerateMutation = useReportedMutation({
    mutationFn: () => committeeApi.aiGenerateCharter(committeeId, selectedFrameworkIds.length > 0 ? selectedFrameworkIds : undefined),
    success: 'Charter draft ready',
    failure: "Couldn't generate the charter",
    onSuccess: (response) => {
      setAiCharterResult(response.data as AICharterResult);
      setShowAiCharterPanel(true);
      setExpandedSections(new Set([0]));
      setShowFrameworkSelectionModal(false);
    },
  });

  const aiCompareMutation = useReportedMutation({
    mutationFn: (data: { charter_id?: number; charter_text?: string }) => committeeApi.aiCompareCharter(committeeId, data),
    success: 'Comparison ready',
    failure: "Couldn't compare the charter",
    onSuccess: (response) => {
      setComparisonResult(response.data as AIComparisonResult);
      setShowComparisonModal(true);
    },
  });

  const saveCharterMutation = useReportedMutation({
    mutationFn: (data: any) => committeeApi.createCharter(committeeId, data),
    success: 'Charter saved as a draft',
    failure: "Couldn't save the charter",
    retryable: false,
    invalidate: [['committee-charters', committeeId]],
    onSuccess: () => setShowAiCharterPanel(false),
  });

  const updateCharterMutation = useReportedMutation({
    mutationFn: ({ charterId, data }: { charterId: number; data: any }) => committeeApi.updateCharter(charterId, data),
    success: 'Charter saved',
    failure: "Couldn't save the charter",
    invalidate: [['committee-charters', committeeId]],
    onSuccess: () => setEditingCharterId(null),
  });

  const deleteCharterMutation = useReportedMutation({
    mutationFn: (charter: Charter) => committeeApi.deleteCharter(committeeId, charter.id),
    success: (_r, charter) => `Charter ${short(charter.title)} deleted`,
    failure: "Couldn't delete the charter",
    invalidate: [['committee-charters', committeeId]],
  });

  const handleFileUpload = (charterId: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadCharterFileMutation.mutate({ charterId, file });
    }
    if (event.target) event.target.value = '';
  };

  const handleDownloadFile = async (charterId: number, fileName: string) => {
    try {
      const response = await committeeApi.downloadCharterFile(charterId);
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || 'charter_file';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      notify.error(error, { title: "Couldn't download the charter", retry: () => { void handleDownloadFile(charterId, fileName); } });
    }
  };

  // For AI-drafted (or any text-only) charters that have no uploaded file yet, build a downloadable Word document straight from the stored content. Reuses the
  // markdown-to-docx helper from the compliance module so every download path in the app produces the same formatting (headings, tables, bullet lists).
  const handleDownloadCharterContent = async (charter: Charter) => {
    try {
      // Lazy import: the docx generator pulls in ~150KB of code that users who never download a charter should not load.
      const { downloadAsDocx } = await import('@/components/compliance/downloadUtils');
      const safeName = (charter.title || 'charter').replace(/[^a-z0-9_\- ]/gi, '_').trim() || 'charter';
      const versionTag = charter.version ? `_v${charter.version}` : '';
      const filename = `${safeName}${versionTag}`;  // .docx appended by downloadAsDocx
      const header = [
        `# ${charter.title || 'Committee Charter'}`,
        charter.version ? `**Version:** ${charter.version}` : '',
        charter.status ? `**Status:** ${charter.status}` : '',
        charter.effective_date ? `**Effective Date:** ${dueDay(charter.effective_date)}` : '',
        charter.approver_name ? `**Approved By:** ${charter.approver_name}` : '',
        '',
        '---',
        '',
      ].filter(Boolean).join('\n');
      const body = charter.content || '_No content provided._';
      await downloadAsDocx(filename, `${header}\n${body}\n`);
    } catch (error) {
      notify.error(error, { title: "Couldn't download the charter", retry: () => { void handleDownloadCharterContent(charter); } });
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const toggleSection = (idx: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleSaveAICharter = () => {
    if (!aiCharterResult?.charter) return;
    const fullContent = aiCharterResult.charter.sections
      .map(s => `## ${s.title}\n\n${s.content}\n\nFramework References: ${s.framework_references.join(', ')}`)
      .join('\n\n---\n\n');
    saveCharterMutation.mutate({
      title: aiCharterResult.charter.charter_title,
      content: fullContent,
      version: '1.0-AI',
      status: 'draft',
      effective_date: new Date().toISOString().split('T')[0],
    });
  };

  const handleCopyCharter = async () => {
    if (!aiCharterResult?.charter) return;
    const fullContent = aiCharterResult.charter.sections
      .map(s => `## ${s.title}\n\n${s.content}\n\nFramework References: ${s.framework_references.join(', ')}`)
      .join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(fullContent);
      notify.success('Charter copied');
    } catch (error) {
      notify.error(error, { title: "Couldn't copy the charter", fallback: 'Your browser did not allow copying.' });
    }
  };

  // ── questions asked before a change that cannot be taken back ──
  const askRemoveMember = async (member: Member) => {
    if (!committee) return;
    const plan = removeMemberPlan(member, committee);
    if (await confirm({ title: plan.title, message: plan.message, confirmLabel: plan.confirmLabel, tone: 'danger' })) removeMemberMutation.mutate(member);
  };
  const askDeleteCommittee = async () => {
    if (!committee) return;
    const plan = deleteCommitteePlan(short(committee.name));
    if (await confirm({ title: plan.title, message: plan.message, confirmLabel: plan.confirmLabel, tone: 'danger' })) deleteCommitteeMutation.mutate();
  };
  const askDeleteCharter = async (charter: Charter) => {
    if (await confirm({
      title: `Delete ${short(charter.title)}?`,
      message: 'The charter and the file attached to it are removed from the committee. This cannot be undone.',
      confirmLabel: 'Delete charter',
      tone: 'danger',
    })) deleteCharterMutation.mutate(charter);
  };

  if (committeeQ.isLoading) {
    return (
      <div className="space-y-[16px]" aria-busy="true">
        <Skeleton className="h-[32px] w-[280px]" />
        <Skeleton className="h-[16px] w-[420px]" />
        <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]"><SkeletonLines lines={5} label="Loading the committee" /></div>
      </div>
    );
  }

  if (committeeQ.isError || !committee) {
    const notFound = statusOf(committeeQ.error) === 404;
    return (
      <div className="space-y-[16px]">
        <Button href="/governance/committees" leftIcon={<ChevronRight aria-hidden className="rotate-180" />}>Back to committees</Button>
        <ErrorState
          title={notFound ? 'Committee not found' : "Couldn't load this committee"}
          message={notFound ? "It doesn't exist or you don't have access to it." : errorMessage(committeeQ.error)}
          onRetry={notFound ? undefined : () => { void committeeQ.refetch(); }}
        />
      </div>
    );
  }

  const activeCharter = charters?.find(c => c.status === 'active');
  const selectedMeeting = (meetings || []).find((m) => m.id === selectedMeetingId) || null;
  const meetingActions = (actions || []).filter((a) => a.meeting_id === selectedMeetingId);
  const memberUserIds = new Set((members || []).map((member) => member.user_id));
  const availableUsers = normalizedTenantUsers.filter((user) => {
    return !memberUserIds.has(user.id);
  });
  const committeeMembers = committee.members ?? [];

  const openEditCommittee = () => {
    const draft = {
      name: committee.name,
      description: committee.description ?? '',
      committee_type: committee.committee_type,
      chair_id: committee.chair_id ? String(committee.chair_id) : '',
      secretary_id: committee.secretary_id ? String(committee.secretary_id) : '',
      meeting_frequency: committee.meeting_frequency ?? 'monthly',
    };
    setEditInitial(draft);
    setEditCommitteeDraft(draft);
    setIsEditCommitteeOpen(true);
  };

  // ── Members: search, a page at a time, the lot in one place ──
  const memberRows = (members || []).filter((m) => {
    const q = memberSearch.trim().toLowerCase();
    return !q || m.user_name.toLowerCase().includes(q) || m.user_email.toLowerCase().includes(q) || m.role.toLowerCase().includes(q);
  });
  const memberRange = pageRange(memberPage, MEMBER_PAGE, memberRows.length);
  const memberPageRows = memberRows.slice(memberRange.from === 0 ? 0 : memberRange.from - 1, memberRange.to);
  const memberColumns: RegisterColumn<Member>[] = [
    {
      key: 'name', header: 'Name', isRowHeader: true,
      cell: (m) => (
        <>
          <PersonChip name={m.user_name} />
          <span className="block break-all text-ds-label font-normal text-ds-fg-muted">{m.user_email}</span>
        </>
      ),
    },
    {
      key: 'role', header: 'Role', width: 'w-[120px]', card: 'meta',
      cell: (m) => <StatusPill size="sm" tone={m.role === 'chair' || m.role === 'secretary' ? 'progress' : 'neutral'} label={statusLabel(m.role)} />,
    },
    { key: 'joined', header: 'Joined', priority: 2, width: 'w-[120px]', card: 'meta', cell: (m) => formatDate(m.joined_at) },
    ...(canDelete ? [{
      key: 'actions', header: 'Actions', align: 'right' as const, width: 'w-[56px]',
      cell: (m: Member) => <IconButton label={`Remove ${m.user_name}`} disabled={removeMemberMutation.isPending} onClick={() => { void askRemoveMember(m); }}><UserMinus aria-hidden /></IconButton>,
    }] : []),
  ];

  // ── Actions: a table (cards below 768px); the priority is changed in place by anyone who can edit ──
  const actionColumns: RegisterColumn<Action>[] = [
    {
      key: 'action', header: 'Action', isRowHeader: true,
      cell: (a) => (
        <>
          <span className="line-clamp-2 break-words font-[600] text-ds-fg" title={a.title}>{a.title}</span>
          <span className="block text-ds-label font-normal text-ds-fg-muted">{actionTypeLabel(a.action_type)}</span>
          {a.description && <span className="mt-[2px] line-clamp-2 break-words text-ds-label font-normal text-ds-fg-body" title={a.description}>{a.description}</span>}
        </>
      ),
    },
    {
      key: 'priority', header: 'Priority', width: 'w-[156px]', card: 'meta',
      cell: (a) => (
        <span className="flex flex-col items-start gap-[4px]">
          {canCreate ? (
            <Select
              value={a.priority || 'medium'}
              onChange={(e) => updateActionMutation.mutate({ id: a.id, data: { priority: e.target.value }, title: a.title })}
              disabled={updateActionMutation.isPending}
              aria-label={`Priority of ${a.title}`}
              className="w-[132px]"
            >
              {[...PRIORITIES, ...(PRIORITIES.some((p) => p.value === a.priority) || !a.priority ? [] : [{ value: a.priority, label: statusLabel(a.priority) }])].map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          ) : <PriorityTag size="sm" value={a.priority} />}
          <SlaTag size="sm" sla={a.sla} />
        </span>
      ),
    },
    {
      key: 'due', header: 'Due', priority: 2, width: 'w-[120px]', card: 'meta',
      cell: (a) => (a.due_date ? <span className={isOverdueAction(a) ? 'whitespace-nowrap text-ds-danger' : 'whitespace-nowrap'}>{dueDay(a.due_date)}</span> : <span className="text-ds-fg-muted">{NOT_SET}</span>),
    },
    { key: 'assigned', header: 'Assigned to', priority: 2, width: 'w-[168px]', card: 'meta', cell: (a) => <PersonChip name={a.assigned_to_name} /> },
    { key: 'status', header: 'Status', width: 'w-[148px]', card: 'meta', cell: (a) => <ActionStatusPills size="sm" action={a} /> },
  ];

  const countLine = [
    `${formatCount(committee.member_count)} ${committee.member_count === 1 ? 'member' : 'members'}`,
    `${formatCount(committee.meeting_count ?? meetingsTotal)} ${(committee.meeting_count ?? meetingsTotal) === 1 ? 'meeting' : 'meetings'}`,
    `${formatCount(committee.pending_actions_count ?? 0)} open ${(committee.pending_actions_count ?? 0) === 1 ? 'action' : 'actions'}`,
    `${formatCount(charters?.length ?? 0)} ${(charters?.length ?? 0) === 1 ? 'charter' : 'charters'}${activeCharter ? ' (1 active)' : ''}`,
  ].join(' · ');
  const frequency = FREQUENCY_OPTIONS.find((f) => f.value === committee.meeting_frequency)?.label ?? statusLabel(committee.meeting_frequency, NOT_SET);

  return (
    <div className="space-y-[16px]">
      <div>
        <PageHeader
          variant="page"
          title={committee.name}
          back={{ href: '/governance/committees', label: 'Back to committees' }}
          chips={(
            <>
              <StatusPill tone="neutral" label={committeeTypeLabel(committee.committee_type, 'long')} />
              <CommitteeActivity active={committee.is_active !== false} />
            </>
          )}
          actions={(
            <>
              {canCreate && <Button leftIcon={<Edit2 aria-hidden />} onClick={openEditCommittee}>Edit committee</Button>}
              {canDelete && <Button variant="dangerOutline" leftIcon={<Trash2 aria-hidden />} loading={deleteCommitteeMutation.isPending} onClick={() => { void askDeleteCommittee(); }}>Delete</Button>}
            </>
          )}
        />
        {committee.description && (
          <p className="mt-[8px] max-w-3xl text-ds-body text-ds-fg-body"><ClampedText text={committee.description} max={280} buttonLabel="the description" /></p>
        )}
      </div>

      {/* a line of facts: the counts are the server's */}
      <dl className="flex flex-wrap items-center gap-x-[20px] gap-y-[8px] text-ds-body text-ds-fg-body">
        <div className="flex items-center gap-[8px]">
          <dt className="sr-only">Counts</dt>
          <dd className="flex flex-wrap items-center gap-[8px]">
            {countLine}
            {committeeMembers.length > 0 && <PersonStack people={committeeMembers.map((m) => m.user_name)} label="Members" />}
          </dd>
        </div>
        <div className="flex items-center gap-[6px]"><dt className="text-ds-fg-muted">Chair</dt><dd><PersonChip name={committee.chair_name} /></dd></div>
        <div className="flex items-center gap-[6px]"><dt className="text-ds-fg-muted">Secretary</dt><dd><PersonChip name={committee.secretary_name} /></dd></div>
        <div className="flex items-center gap-[6px]"><dt className="text-ds-fg-muted">Frequency</dt><dd>{frequency}</dd></div>
      </dl>

      <Tabs tabs={TAB_ITEMS} value={tab} onChange={(key) => setTab(key as CommitteeTab)} ariaLabel="Committee sections">
        {/* ── Members ── */}
        <TabPanel tabKey="members" lazy className="pt-[16px]">
          <div className="space-y-[12px]">
            <div className="flex flex-wrap items-center justify-between gap-[12px]">
              <TextInput
                type="search"
                value={memberSearch}
                onChange={(e) => { setMemberSearch(e.target.value); setMemberPage(1); }}
                placeholder="Search members"
                aria-label="Search members"
                leftAdornment={<Search aria-hidden />}
                className="w-[260px] max-w-full"
              />
              {canCreate && <Button variant="primary" leftIcon={<UserPlus aria-hidden />} onClick={() => setIsAddMemberModalOpen(true)}>Add member</Button>}
            </div>
            <RegisterTable<Member>
              caption="Committee members"
              columns={memberColumns}
              rows={memberPageRows}
              getRowId={(m) => m.id}
              loading={membersQ.isLoading}
              error={membersQ.isError && !membersQ.data ? { message: `Couldn't load the members. ${errorMessage(membersQ.error)}`, onRetry: () => { void membersQ.refetch(); } } : null}
              cardTitle={(m) => <PersonChip name={m.user_name} />}
              empty={(members || []).length === 0 ? (
                <EmptyState kind="firstUse" bare icon={Users} title="No members yet" action={canCreate ? <Button variant="primary" leftIcon={<UserPlus aria-hidden />} onClick={() => setIsAddMemberModalOpen(true)}>Add the first member</Button> : undefined} />
              ) : (
                <EmptyState kind="noMatches" bare title="No member matches" onClearFilters={() => { setMemberSearch(''); setMemberPage(1); }} />
              )}
              footer={membersQ.data && memberRows.length > 0 ? <Pager page={memberRange.page} pageSize={MEMBER_PAGE} total={memberRows.length} onPage={setMemberPage} noun="members" /> : undefined}
            />
          </div>
        </TabPanel>

        {/* ── Charters ── */}
        <TabPanel tabKey="charters" lazy className="pt-[16px]">
          <div className="space-y-[12px]">
            <div className="flex flex-wrap items-center justify-between gap-[12px]">
              <p className="text-ds-body text-ds-fg-muted">Upload an existing charter, or draft one with AI from your frameworks.</p>
              <div className="flex flex-wrap items-center gap-[8px]">
                {/* Hidden file input: the Upload button below triggers it. */}
                <input
                  ref={uploadCharterInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain,text/markdown"
                  onChange={onPickUploadCharterFile}
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <Button leftIcon={<Upload aria-hidden />} loading={uploadNewCharterMutation.isPending} onClick={() => uploadCharterInputRef.current?.click()}>Upload charter</Button>
                <Button
                  variant="primary"
                  leftIcon={<Sparkles aria-hidden />}
                  loading={aiGenerateMutation.isPending}
                  onClick={() => { setSelectedFrameworkIds([]); setShowFrameworkSelectionModal(true); }}
                >
                  {aiGenerateMutation.isPending ? 'Analysing frameworks…' : 'AI generate charter'}
                </Button>
              </div>
            </div>

            {chartersQ.isError && !charters && (
              <ErrorState title="Couldn't load the charters" message={errorMessage(chartersQ.error)} onRetry={() => { void chartersQ.refetch(); }} />
            )}

            {showAiCharterPanel && aiCharterResult && (
              <div className="rounded-ds-card border border-ds-primary bg-ds-surface p-[16px]">
                <div className="mb-[12px] flex flex-wrap items-start justify-between gap-[12px]">
                  <div className="flex min-w-0 items-center gap-[12px]">
                    <span aria-hidden className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-ds-card bg-ds-primary-soft text-ds-primary-text"><Sparkles className="h-[16px] w-[16px]" /></span>
                    <div className="min-w-0">
                      <p className="break-words text-ds-section text-ds-fg">{aiCharterResult.charter.charter_title}</p>
                      <p className="text-ds-label font-normal text-ds-fg-muted">
                        Generated from {aiCharterResult.frameworks_analyzed.length} frameworks, {aiCharterResult.controls_analyzed} controls analysed
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-[8px]">
                    <Button size="sm" leftIcon={<Copy aria-hidden />} onClick={() => { void handleCopyCharter(); }}>Copy</Button>
                    <Button size="sm" variant="primary" leftIcon={<Save aria-hidden />} loading={saveCharterMutation.isPending} onClick={handleSaveAICharter}>Save as draft</Button>
                    <Button size="sm" onClick={() => setShowAiCharterPanel(false)}>Close</Button>
                  </div>
                </div>

                <div className="mb-[12px] flex flex-wrap gap-[6px]">
                  {aiCharterResult.frameworks_analyzed.map((fw, i) => (
                    <StatusPill key={i} size="sm" tone="neutral" label={fw} />
                  ))}
                </div>

                {aiCharterResult.charter.summary && (
                  <p className="mb-[12px] border-l-2 border-ds-primary pl-[12px] text-ds-body italic text-ds-fg-body">{aiCharterResult.charter.summary}</p>
                )}

                <div className="space-y-[8px]">
                  {aiCharterResult.charter.sections.map((section, idx) => (
                    <div key={idx} className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
                      <button
                        type="button"
                        aria-expanded={expandedSections.has(idx)}
                        onClick={() => toggleSection(idx)}
                        className="flex w-full items-center justify-between gap-[8px] p-[12px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]"
                      >
                        <span className="flex min-w-0 items-center gap-[8px]">
                          <span aria-hidden className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full bg-ds-primary-soft text-ds-label text-ds-primary-text">{idx + 1}</span>
                          <span className="min-w-0 break-words text-ds-body font-medium text-ds-fg">{section.title}</span>
                        </span>
                        {expandedSections.has(idx) ? <ChevronDown aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" /> : <ChevronRight aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />}
                      </button>
                      {expandedSections.has(idx) && (
                        <div className="border-t border-ds-border px-[12px] pb-[12px]">
                          <div className="mt-[12px] whitespace-pre-line text-ds-body leading-relaxed text-ds-fg-body">{section.content}</div>
                          {section.framework_references.length > 0 && (
                            <div className="mt-[12px] border-t border-ds-border pt-[12px]">
                              <p className={SUB_HEAD}>Framework references</p>
                              <div className="mt-[6px] flex flex-wrap gap-[6px]">
                                {section.framework_references.map((ref, ri) => (
                                  <StatusPill key={ri} size="sm" tone="neutral" label={ref} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(charters || []).map((charter) => (
              <div key={charter.id} className={`rounded-ds-card border bg-ds-surface p-[16px] ${charter.status === 'active' ? 'border-ds-success' : 'border-ds-border'}`}>
                {editingCharterId === charter.id ? (
                  <div className="flex flex-col gap-[16px]">
                    <FormField label="Title" required>
                      <TextInput value={editCharterTitle} onChange={(e) => setEditCharterTitle(e.target.value)} maxLength={500} />
                    </FormField>
                    <FormField label="Content">
                      <Textarea value={editCharterContent} onChange={(e) => setEditCharterContent(e.target.value)} rows={6} />
                    </FormField>
                    <FormField label="Status">
                      <Select value={editCharterStatus} onChange={(e) => setEditCharterStatus(e.target.value)} className="sm:max-w-[220px]">
                        <option value="draft">Draft</option>
                        <option value="active">Active</option>
                        <option value="expired">Expired</option>
                      </Select>
                    </FormField>
                    <div className="flex justify-end gap-[8px]">
                      <Button onClick={() => setEditingCharterId(null)}>Cancel</Button>
                      <Button
                        variant="primary"
                        loading={updateCharterMutation.isPending}
                        disabled={!editCharterTitle.trim()}
                        onClick={() => updateCharterMutation.mutate({ charterId: charter.id, data: { title: editCharterTitle, content: editCharterContent, status: editCharterStatus } })}
                      >
                        Save changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-[12px]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-[8px]">
                          <p className="break-words text-ds-section text-ds-fg">{charter.title}</p>
                          <StatusPill tone={CHARTER_TONE[charter.status] ?? 'neutral'} label={statusLabel(charter.status)} />
                        </div>
                        <p className="mt-[2px] text-ds-body text-ds-fg-muted">Version {charter.version}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-[8px]">
                        <Button leftIcon={<GitCompare aria-hidden />} loading={aiCompareMutation.isPending} onClick={() => aiCompareMutation.mutate({ charter_id: charter.id })}>Compare with AI</Button>
                        {charter.file_name ? (
                          <Button leftIcon={<Download aria-hidden />} onClick={() => { void handleDownloadFile(charter.id, charter.file_name!); }} title={`Download ${charter.file_name}`}>Download</Button>
                        ) : charter.content ? (
                          <Button leftIcon={<Download aria-hidden />} onClick={() => { void handleDownloadCharterContent(charter); }} title="Download the draft as a Word document">Download draft</Button>
                        ) : null}
                        <label className="relative inline-flex h-ds-control cursor-pointer items-center gap-[6px] rounded-ds-control border border-ds-border-strong bg-ds-surface px-[12px] text-ds-body font-medium text-ds-fg-body focus-within:shadow-ds-ring hover:bg-ds-surface-hover">
                          <Upload aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
                          {uploadCharterFileMutation.isPending ? 'Uploading…' : 'Upload file'}
                          <input
                            type="file"
                            className="sr-only"
                            accept=".pdf,.doc,.docx,.txt"
                            onChange={(e) => handleFileUpload(charter.id, e)}
                            disabled={uploadCharterFileMutation.isPending}
                          />
                        </label>
                        <IconButton
                          label={`Edit ${short(charter.title)}`}
                          onClick={() => {
                            setEditingCharterId(charter.id);
                            setEditCharterTitle(charter.title);
                            setEditCharterContent(charter.content || '');
                            setEditCharterStatus(charter.status);
                          }}
                        >
                          <Edit2 aria-hidden />
                        </IconButton>
                        <IconButton label={`Delete ${short(charter.title)}`} disabled={deleteCharterMutation.isPending} onClick={() => { void askDeleteCharter(charter); }}><Trash2 aria-hidden /></IconButton>
                      </div>
                    </div>
                    {/* Charter body: structured sections (uploaded and parsed, or AI-saved) as collapsible cards like the AI panel, else a preview of the plain content. */}
                    {charter.sections && charter.sections.length > 0 ? (
                      <CharterSectionsView sections={charter.sections} />
                    ) : (
                      charter.content && <p className="mt-[12px] text-ds-body text-ds-fg-body"><ClampedText text={charter.content} max={400} buttonLabel="the charter" /></p>
                    )}

                    {charter.file_name && (
                      <div className="mt-[12px] flex items-center gap-[12px] rounded-ds-card bg-ds-surface-subtle p-[12px]">
                        <Paperclip aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-primary-text" />
                        <div className="min-w-0 flex-1">
                          <p className="break-all text-ds-body text-ds-fg">{charter.file_name}</p>
                          <p className="text-ds-label font-normal text-ds-fg-muted">
                            {(charter.file_type || '').toUpperCase()} {charter.file_size ? `· ${formatFileSize(charter.file_size)}` : ''}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="mt-[12px] flex flex-wrap items-center gap-x-[24px] gap-y-[4px] text-ds-body text-ds-fg-muted">
                      <span>Effective: {dueDay(charter.effective_date)}</span>
                      {(charter.approver_name || charter.approved_by) && (
                        <span>Approved by: {charter.approver_name || `User #${charter.approved_by}`}</span>
                      )}
                      {charter.creator_name && !charter.approver_name && (
                        <span>Created by: {charter.creator_name}</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}

            {chartersQ.data && charters?.length === 0 && !showAiCharterPanel && (
              <EmptyState
                kind="firstUse"
                icon={FileText}
                title="No charters yet"
                description="Generate a charter with AI from your frameworks, or upload the one you have."
                action={<Button variant="primary" leftIcon={<Sparkles aria-hidden />} loading={aiGenerateMutation.isPending} onClick={() => { setSelectedFrameworkIds([]); setShowFrameworkSelectionModal(true); }}>Generate with AI</Button>}
              />
            )}
          </div>
        </TabPanel>

        {/* ── Meetings ── */}
        <TabPanel tabKey="meetings" lazy className="pt-[16px]">
          <div className="space-y-[12px]">
            <div className="flex justify-end">
              {canCreate && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setIsScheduleMeetingModalOpen(true)}>Schedule meeting</Button>}
            </div>

            {meetingsQ.isError && !meetingsQ.data ? (
              <ErrorState title="Couldn't load the meetings" message={errorMessage(meetingsQ.error)} onRetry={() => { void meetingsQ.refetch(); }} />
            ) : meetingsQ.isLoading ? (
              <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]"><SkeletonLines lines={4} label="Loading meetings" /></div>
            ) : (!meetings || meetings.length === 0) ? (
              <EmptyState
                kind="firstUse"
                icon={Calendar}
                title="No meetings yet"
                description="Schedule the committee's first meeting to plan its agenda and track actions."
                action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setIsScheduleMeetingModalOpen(true)}>Schedule meeting</Button> : undefined}
              />
            ) : (
              <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-3">
                {/* Left: meeting list: select to view (no page hop) */}
                <div className="min-w-0 lg:col-span-1">
                  <div className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
                    <p className="border-b border-ds-border px-[16px] py-[10px] text-ds-label text-ds-fg-muted">
                      {meetingsTotal > meetings.length ? `Meetings: ${formatCount(meetings.length)} of ${formatCount(meetingsTotal)}` : `Meetings: ${formatCount(meetingsTotal)}`}
                    </p>
                    <ul className="max-h-[70vh] divide-y divide-ds-border overflow-y-auto">
                      {meetings.map((m) => {
                        const sel = m.id === selectedMeetingId;
                        return (
                          <li key={m.id}>
                            <button
                              type="button"
                              aria-pressed={sel}
                              onClick={() => setSelectedMeetingId(m.id)}
                              className={`block w-full px-[16px] py-[12px] text-left focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] ${sel ? 'bg-ds-primary-soft' : 'hover:bg-ds-surface-hover'}`}
                            >
                              <span className="flex items-start justify-between gap-[8px]">
                                <span className={`line-clamp-2 min-w-0 break-words text-ds-body font-medium ${sel ? 'text-ds-primary-text' : 'text-ds-fg'}`} title={m.title}>{m.title}</span>
                                <StatusPill size="sm" {...statusPill(meetingStatus, m.status)} />
                              </span>
                              <span className="mt-[4px] flex items-center gap-[6px] text-ds-label font-normal text-ds-fg-muted"><Calendar aria-hidden className="h-[14px] w-[14px]" />{meetingDay(m.scheduled_date)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {meetingsTotal > meetings.length && (
                      <p className="border-t border-ds-border px-[16px] py-[10px] text-ds-label font-normal text-ds-fg-muted">
                        {cutNotice({ shown: meetings.length, total: meetingsTotal, noun: 'meetings' })} Older meetings are not listed here.
                      </p>
                    )}
                  </div>
                </div>

                {/* Right: the selected meeting, inline and pinned (no drill-down) */}
                <div className="min-w-0 lg:col-span-2">
                  <div className="lg:sticky lg:top-4">
                    {selectedMeeting ? (
                      <div className="rounded-ds-card border border-ds-border bg-ds-surface">
                        <div className="flex flex-wrap items-start justify-between gap-[12px] border-b border-ds-border px-[20px] py-[16px]">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-[8px]">
                              <p className="break-words text-ds-section text-ds-fg">{selectedMeeting.title}</p>
                              <StatusPill size="sm" tone="neutral" label={MEETING_TYPE_LABELS[selectedMeeting.meeting_type] ?? statusLabel(selectedMeeting.meeting_type)} />
                              <StatusPill size="sm" {...statusPill(meetingStatus, selectedMeeting.status)} />
                            </div>
                            <p className="mt-[4px] flex flex-wrap items-center gap-x-[12px] gap-y-[2px] text-ds-label font-normal text-ds-fg-muted">
                              <span className="inline-flex items-center gap-[4px]"><Calendar aria-hidden className="h-[14px] w-[14px]" />{meetingWhen(selectedMeeting.scheduled_date)}</span>
                              {selectedMeeting.location && <span className="break-words">{selectedMeeting.location}</span>}
                            </p>
                          </div>
                          <Button href={`/governance/committees/meetings/${selectedMeeting.id}`} leftIcon={<Eye aria-hidden />}>Open full</Button>
                        </div>

                        {/* Agenda */}
                        <div className="border-b border-ds-border px-[20px] py-[16px]">
                          <p className={SUB_HEAD}>Agenda ({formatCount(selectedMeeting.agenda_item_count ?? selectedMeetingAgenda.length)})</p>
                          {selectedMeetingAgenda.length === 0 ? (
                            <p className="mt-[8px] text-ds-body text-ds-fg-muted">No agenda items yet.</p>
                          ) : (
                            <ul className="mt-[8px] space-y-[8px]">
                              {[...selectedMeetingAgenda].sort((a, b) => (a.item_number || 0) - (b.item_number || 0)).map((it) => (
                                <li key={it.id} className="flex items-start gap-[8px] text-ds-body">
                                  <span aria-hidden className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full bg-ds-surface-hover text-ds-label text-ds-fg-body">{it.item_number}</span>
                                  <span className="min-w-0 flex-1">
                                    <span className="text-ds-fg"><ClampedText text={String(it.title)} max={140} buttonLabel={`agenda item ${it.item_number}`} /></span>
                                    {it.item_type && <span className="ml-[8px] text-ds-label font-normal text-ds-fg-muted">{statusLabel(it.item_type)}</span>}
                                  </span>
                                  {it.status && <StatusPill size="sm" tone="neutral" label={statusLabel(it.status)} />}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="border-b border-ds-border px-[20px] py-[16px]">
                          <p className={SUB_HEAD}>Actions ({formatCount(selectedMeeting.action_count ?? meetingActions.length)})</p>
                          {meetingActions.length === 0 ? (
                            <p className="mt-[8px] text-ds-body text-ds-fg-muted">{(selectedMeeting.action_count ?? 0) > 0 ? 'Its actions are among the committee\'s other actions: open the Actions tab.' : 'No actions from this meeting.'}</p>
                          ) : (
                            <ul className="mt-[8px] space-y-[10px]">
                              {meetingActions.map((a) => (
                                <li key={a.id} className="flex items-start justify-between gap-[8px]">
                                  <span className="min-w-0">
                                    <span className="line-clamp-2 break-words text-ds-body text-ds-fg" title={a.title}>{a.title}</span>
                                    <span className="mt-[2px] flex flex-wrap items-center gap-x-[8px] text-ds-label font-normal text-ds-fg-muted">
                                      <PersonChip name={a.assigned_to_name} size={20} />
                                      {a.due_date && <span>Due {dueDay(a.due_date)}</span>}
                                    </span>
                                  </span>
                                  <ActionStatusPills size="sm" action={a} />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {/* Minutes */}
                        <div className="px-[20px] py-[16px]">
                          <p className={SUB_HEAD}>Minutes</p>
                          {selectedMeetingDetail?.minutes?.content ? (
                            <p className="mt-[8px] whitespace-pre-wrap text-ds-body text-ds-fg-body"><ClampedText text={selectedMeetingDetail.minutes.content} max={400} buttonLabel="the minutes" /></p>
                          ) : (
                            <p className="mt-[8px] text-ds-body text-ds-fg-muted">No minutes recorded yet.</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-ds-card border border-dashed border-ds-border-strong bg-ds-surface p-[40px] text-center text-ds-body text-ds-fg-muted">Select a meeting to see its agenda, actions and minutes.</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabPanel>

        {/* ── Actions ── */}
        <TabPanel tabKey="actions" lazy className="pt-[16px]">
          <div className="space-y-[12px]">
            <div className="flex flex-wrap items-center justify-between gap-[12px]">
              <p className="text-ds-body text-ds-fg-muted">
                {actionsQ.data ? `${formatCount(actionsTotal)} ${actionsTotal === 1 ? 'action' : 'actions'}` : ''}
              </p>
              {canCreate && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setIsCreateActionModalOpen(true)}>Add action item</Button>}
            </div>
            {actions && actionsTotal > actions.length && (
              <p className="rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px] text-ds-body text-ds-fg-body">
                {cutNotice({ shown: actions.length, total: actionsTotal, noun: 'actions' })} Earliest due first.{' '}
                <Link href="/governance/committees/actions" className="text-ds-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">Open all actions to filter and page through them</Link>
              </p>
            )}
            <RegisterTable<Action>
              caption="Committee actions"
              columns={actionColumns}
              rows={actions || []}
              getRowId={(a) => a.id}
              loading={actionsQ.isLoading}
              error={actionsQ.isError && !actionsQ.data ? { message: `Couldn't load the actions. ${errorMessage(actionsQ.error)}`, onRetry: () => { void actionsQ.refetch(); } } : null}
              cardTitle={(a) => <span className="break-words font-[600] text-ds-fg">{a.title}</span>}
              empty={(
                <EmptyState
                  kind="firstUse"
                  bare
                  icon={CheckSquare}
                  title="No action items yet"
                  description="Create action items by hand, and use AI to reword or summarise their text."
                  action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setIsCreateActionModalOpen(true)}>Create the first action item</Button> : undefined}
                />
              )}
            />
          </div>
        </TabPanel>

        {/* ── Settings ── */}
        <TabPanel tabKey="settings" lazy className="pt-[16px]">
          <div className="space-y-[12px]">
            {taskSettings ? (
              <PrioritySlaEditor
                moduleKey="tasks"
                title="SLA by priority"
                note="Days an action item has to be done, by its priority, for every committee. This is Task Management's own SLA table, so a change here applies there too."
              />
            ) : taskSettingsLoading && taskSettingsFailures === 0 ? (
              <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]"><SkeletonLines lines={4} label="Loading the SLA settings" /></div>
            ) : (
              // The first refusal is enough to say so; the retries that follow would keep a spinner up for seconds.
              <p className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px] text-ds-body text-ds-fg-muted">
                The SLA for action items is part of Task Management&apos;s settings. It could not be loaded, and your account may not have access to those settings.
              </p>
            )}
          </div>
        </TabPanel>
      </Tabs>

      {/* ── Create action item ── */}
      <RightSlidePanel
        isOpen={isCreateActionModalOpen}
        onClose={() => { createActionMutation.reset(); setIsCreateActionModalOpen(false); }}
        title="Create action item"
        dirty={formChanged(NEW_ACTION, newAction) || actionUploadFile !== null}
        footer={<DrawerFooter onCancel={() => { createActionMutation.reset(); setIsCreateActionModalOpen(false); }} form="committee-create-action-form" pending={createActionMutation.isPending} label="Create action" pendingLabel="Creating…" disabled={!newAction.title.trim()} />}
      >
        <form
          id="committee-create-action-form"
          onSubmit={(e) => {
            e.preventDefault();
            const payload: Record<string, unknown> = {
              committee_id: committeeId,
              title: newAction.title.trim(),
              action_type: newAction.action_type,
            };
            payload.priority = newAction.priority;
            if (newAction.meeting_id) payload.meeting_id = parseInt(newAction.meeting_id, 10);
            if (newAction.description.trim()) payload.description = newAction.description.trim();
            if (newAction.due_date) payload.due_date = newAction.due_date;
            if (newAction.assigned_to_id) payload.assigned_to = parseInt(newAction.assigned_to_id, 10);
            createActionMutation.mutate(payload);
          }}
          className="flex flex-col gap-[16px]"
        >
          {createActionMutation.isError && <FormProblem message={errorMessage(createActionMutation.error, 'The action could not be created.')} />}
          <FormField label="Meeting" optional>
            <Select value={newAction.meeting_id} placeholder="No linked meeting" onChange={(e) => setNewAction({ ...newAction, meeting_id: e.target.value })}>
              {(meetings || []).map((meeting) => <option key={meeting.id} value={String(meeting.id)}>{meeting.title}</option>)}
            </Select>
          </FormField>

          <FormField label="Title" required>
            <TextInput value={newAction.title} onChange={(e) => setNewAction({ ...newAction, title: e.target.value })} maxLength={500} required />
          </FormField>

          <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2">
            <FormField label="Action type">
              <Select value={newAction.action_type} onChange={(e) => setNewAction({ ...newAction, action_type: e.target.value })}>
                {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Priority">
              <Select value={newAction.priority} onChange={(e) => setNewAction({ ...newAction, priority: e.target.value })}>
                {priorityChoices(taskSettings).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2">
            <FormField
              label="Due date"
              optional
              hint={!newAction.due_date && slaDays(taskSettings, newAction.priority) != null
                ? `Left blank, it is due ${slaDays(taskSettings, newAction.priority)} days from today (the ${newAction.priority} SLA).`
                : undefined}
            >
              <TextInput type="date" value={newAction.due_date} onChange={(e) => setNewAction({ ...newAction, due_date: e.target.value })} />
            </FormField>
            <PickerField label="Assign to" optional>
              <MultiSelectDropdown
                title="Assign To"
                items={normalizedTenantUsers.map((u) => ({ value: String(u.id), label: u.name }))}
                selectedValues={newAction.assigned_to_id ? [newAction.assigned_to_id] : []}
                onApply={(values) => setNewAction({ ...newAction, assigned_to_id: values[0] || '' })}
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
            <Textarea value={newAction.description} onChange={(e) => setNewAction({ ...newAction, description: e.target.value })} rows={5} />
          </FormField>

          <fieldset className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
            <legend className="px-[4px] text-ds-label text-ds-fg">AI assistant</legend>
            <div className="flex flex-col gap-[12px]">
              <FormField label="Reference file" optional>
                <FileInput accept=".txt,.md,.csv,.json,.pdf,.doc,.docx" onPick={setActionUploadFile} />
              </FormField>
              <div className="flex flex-wrap gap-[8px]">
                <Button leftIcon={<Sparkles aria-hidden />} loading={aiRewordActionMutation.isPending} disabled={aiSummarizeActionMutation.isPending || (!newAction.description.trim() && !actionUploadFile)} onClick={() => aiRewordActionMutation.mutate()}>AI reword</Button>
                <Button leftIcon={<Upload aria-hidden />} loading={aiSummarizeActionMutation.isPending} disabled={aiRewordActionMutation.isPending || (!newAction.description.trim() && !actionUploadFile)} onClick={() => aiSummarizeActionMutation.mutate()}>Generate summary</Button>
              </div>
            </div>
          </fieldset>
        </form>
      </RightSlidePanel>

      {/* ── AI charter comparison: a dialog (it was a hand-made overlay with no keyboard handling) ── */}
      <AnimatedModal
        isOpen={showComparisonModal && comparisonResult !== null}
        onClose={() => setShowComparisonModal(false)}
        size="xl"
        title="Charter compliance analysis"
        subtitle={comparisonResult ? `${comparisonResult.frameworks_analyzed.length} frameworks, ${comparisonResult.controls_analyzed} controls analysed` : undefined}
      >
        {comparisonResult && (
          <div className="space-y-6 p-6">
            {/* Overall Score */}
            <div className="flex flex-wrap items-center gap-8 rounded-xl border border-slate-200 bg-slate-50 p-6">
              <div className="relative h-28 w-28 shrink-0">
                <svg className="h-28 w-28 -rotate-90" viewBox="0 0 120 120" role="img" aria-label={`Overall score ${comparisonResult.comparison.overall_score} out of 100`}>
                  <circle cx="60" cy="60" r="50" fill="none" stroke="#e2e8f0" strokeWidth="10" />
                  <circle
                    cx="60" cy="60" r="50" fill="none"
                    stroke={getScoreRingColor(comparisonResult.comparison.overall_score)}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${(comparisonResult.comparison.overall_score / 100) * 314} 314`}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-3xl font-bold ${getScoreColor(comparisonResult.comparison.overall_score)}`}>
                    {comparisonResult.comparison.overall_score}
                  </span>
                  <span className="text-[12px] uppercase text-slate-500">Score</span>
                </div>
              </div>
              <div className="min-w-0 flex-1 basis-[16rem]">
                <h3 className="mb-2 text-lg font-semibold text-black">Overall assessment</h3>
                <p className="text-sm leading-relaxed text-black">{comparisonResult.comparison.overall_assessment}</p>
              </div>
            </div>

            {/* Section by Section Comparison */}
            <div>
              <h3 className="mb-3 text-base font-semibold text-black">Section-by-section analysis</h3>
              <div className="space-y-2">
                {comparisonResult.comparison.sections.map((section, idx) => (
                  <div key={idx} className={`rounded-lg border p-4 ${getStatusColor(section.status)}`}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(section.status)}
                        <span className="text-sm font-medium text-black">{section.title}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-bold ${getScoreColor(section.score)}`}>{section.score}%</span>
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[12px] font-medium uppercase tracking-wider text-black">
                          {section.status}
                        </span>
                      </div>
                    </div>
                    <p className="mb-2 text-xs text-black">{section.existing_content_summary}</p>
                    {section.recommendation && (
                      <div className="mt-2 rounded border border-slate-300 bg-slate-100 p-2">
                        <p className="mb-1 text-[12px] font-medium uppercase tracking-wider text-primary-600">Recommendation</p>
                        <p className="text-xs text-black">{section.recommendation}</p>
                      </div>
                    )}
                    {section.framework_requirements.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {section.framework_requirements.map((ref, ri) => (
                          <span key={ri} className="rounded bg-slate-200 px-1.5 py-0.5 text-[12px] text-black">
                            {ref}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Gaps */}
            {comparisonResult.comparison.gaps.length > 0 && (
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-black">
                  <XCircle className="h-4 w-4 text-rose-600" />
                  Identified gaps ({comparisonResult.comparison.gaps.length})
                </h3>
                <div className="space-y-2">
                  {comparisonResult.comparison.gaps.map((gap, idx) => (
                    <div key={idx} className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[12px] font-medium uppercase ${
                        gap.severity === 'high' ? 'bg-rose-100 text-rose-600' :
                        gap.severity === 'medium' ? 'bg-amber-100 text-amber-600' :
                        'bg-slate-100 text-slate-400'
                      }`}>
                        {gap.severity}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm text-black">{gap.description}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {gap.frameworks.map((fw, fi) => (
                            <span key={fi} className="text-[12px] text-black">{fw}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Strengths */}
              {comparisonResult.comparison.strengths.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-black">
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                    Strengths
                  </h3>
                  <div className="space-y-1.5">
                    {comparisonResult.comparison.strengths.map((s, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm text-black">
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        {s}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {comparisonResult.comparison.recommendations.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-black">
                    <Sparkles className="h-4 w-4 text-primary-600" />
                    Recommendations
                  </h3>
                  <div className="space-y-1.5">
                    {comparisonResult.comparison.recommendations.map((r, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm text-black">
                        <span className="shrink-0 text-primary-600">•</span>
                        {r}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Framework Coverage */}
            {comparisonResult.comparison.framework_coverage && (
              <div>
                <h3 className="mb-3 text-base font-semibold text-slate-900">Framework coverage</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  {comparisonResult.comparison.framework_coverage.addressed?.length > 0 && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <p className="mb-2 text-[12px] font-medium uppercase tracking-wider text-emerald-600">Addressed</p>
                      {comparisonResult.comparison.framework_coverage.addressed.map((fw, i) => (
                        <p key={i} className="mb-1 flex items-center gap-1.5 text-xs text-slate-700">
                          <CheckCircle className="h-3 w-3 text-emerald-600" />
                          {fw}
                        </p>
                      ))}
                    </div>
                  )}
                  {comparisonResult.comparison.framework_coverage.partially_addressed?.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="mb-2 text-[12px] font-medium uppercase tracking-wider text-amber-600">Partially addressed</p>
                      {comparisonResult.comparison.framework_coverage.partially_addressed.map((fw, i) => (
                        <p key={i} className="mb-1 flex items-center gap-1.5 text-xs text-slate-700">
                          <AlertTriangle className="h-3 w-3 text-amber-600" />
                          {fw}
                        </p>
                      ))}
                    </div>
                  )}
                  {comparisonResult.comparison.framework_coverage.not_addressed?.length > 0 && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                      <p className="mb-2 text-[12px] font-medium uppercase tracking-wider text-rose-600">Not addressed</p>
                      {comparisonResult.comparison.framework_coverage.not_addressed.map((fw, i) => (
                        <p key={i} className="mb-1 flex items-center gap-1.5 text-xs text-black">
                          <XCircle className="h-3 w-3 text-rose-600" />
                          {fw}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </AnimatedModal>

      {/* ── Add member ── */}
      <RightSlidePanel
        isOpen={isAddMemberModalOpen}
        onClose={() => { addMemberMutation.reset(); setIsAddMemberModalOpen(false); }}
        title="Add member"
        dirty={formChanged(NEW_MEMBER, newMember)}
        footer={<DrawerFooter onCancel={() => { addMemberMutation.reset(); setIsAddMemberModalOpen(false); }} form="add-member-form" pending={addMemberMutation.isPending} label="Add member" pendingLabel="Adding…" disabled={!newMember.user_id} />}
      >
        <form
          id="add-member-form"
          onSubmit={(e) => { e.preventDefault(); addMemberMutation.mutate({ user_id: parseInt(newMember.user_id, 10), role: newMember.role }); }}
          className="flex flex-col gap-[16px]"
        >
          {addMemberMutation.isError && <FormProblem message={errorMessage(addMemberMutation.error, 'The member could not be added.')} />}
          <PickerField label="User" required>
            <MultiSelectDropdown
              title="User"
              items={availableUsers.map((u) => ({ value: String(u.id), label: u.name }))}
              selectedValues={newMember.user_id ? [newMember.user_id] : []}
              onApply={(values) => setNewMember({ ...newMember, user_id: values[0] || '' })}
              multiSelect={false}
              autoApply
              triggerVariant="input"
              forceSearch
              size="sm"
              triggerClassName="w-full"
              placeholder="Select user"
            />
          </PickerField>
          <FormField label="Role">
            <Select value={newMember.role} onChange={(e) => setNewMember({ ...newMember, role: e.target.value })}>
              {MEMBER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </FormField>
        </form>
      </RightSlidePanel>

      {/* ── Schedule meeting ── */}
      <RightSlidePanel
        isOpen={isScheduleMeetingModalOpen}
        onClose={() => { createMeetingMutation.reset(); setIsScheduleMeetingModalOpen(false); }}
        title="Schedule meeting"
        dirty={formChanged(NEW_MEETING, newMeeting)}
        footer={<DrawerFooter onCancel={() => { createMeetingMutation.reset(); setIsScheduleMeetingModalOpen(false); }} form="schedule-meeting-form" pending={createMeetingMutation.isPending} label="Schedule meeting" pendingLabel="Scheduling…" />}
      >
        <form
          id="schedule-meeting-form"
          onSubmit={(e) => { e.preventDefault(); createMeetingMutation.mutate(newMeeting); }}
          className="flex flex-col gap-[16px]"
        >
          {createMeetingMutation.isError && <FormProblem message={errorMessage(createMeetingMutation.error, 'The meeting could not be scheduled.')} />}
          <FormField label="Meeting title" required>
            <TextInput value={newMeeting.title} onChange={(e) => setNewMeeting({ ...newMeeting, title: e.target.value })} maxLength={500} required />
          </FormField>
          <FormField label="Meeting type">
            <Select value={newMeeting.meeting_type} onChange={(e) => setNewMeeting({ ...newMeeting, meeting_type: e.target.value })}>
              {Object.keys(MEETING_TYPE_LABELS).map((value) => <option key={value} value={value}>{MEETING_TYPE_LABELS[value]}</option>)}
            </Select>
          </FormField>
          <FormField label="Date" required>
            <TextInput type="date" value={newMeeting.scheduled_date} onChange={(e) => setNewMeeting({ ...newMeeting, scheduled_date: e.target.value })} required />
          </FormField>
          <div className="grid grid-cols-2 gap-[16px]">
            <FormField label="Start time" optional>
              <TextInput type="time" value={newMeeting.start_time} onChange={(e) => setNewMeeting({ ...newMeeting, start_time: e.target.value })} />
            </FormField>
            <FormField label="End time" optional>
              <TextInput type="time" value={newMeeting.end_time} onChange={(e) => setNewMeeting({ ...newMeeting, end_time: e.target.value })} />
            </FormField>
          </div>
          <p className="rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px] text-ds-label font-normal text-ds-fg-body">
            Only the date is saved. The start and end time are not kept yet: to give a meeting a time, schedule it from the Committees page (New meeting).
          </p>
          <FormField label="Location" optional>
            <TextInput value={newMeeting.location} onChange={(e) => setNewMeeting({ ...newMeeting, location: e.target.value })} placeholder="e.g. Boardroom A, virtual" maxLength={500} />
          </FormField>
        </form>
      </RightSlidePanel>

      {/* ── Frameworks for an AI charter ── */}
      <RightSlidePanel
        isOpen={showFrameworkSelectionModal}
        onClose={() => setShowFrameworkSelectionModal(false)}
        title="Select frameworks for the charter"
        dirty={selectedFrameworkIds.length > 0}
        footer={(
          <div className="flex justify-end gap-[8px]">
            <Button onClick={() => setShowFrameworkSelectionModal(false)}>Cancel</Button>
            <Button variant="primary" loading={aiGenerateMutation.isPending} onClick={() => aiGenerateMutation.mutate()}>Generate charter</Button>
          </div>
        )}
      >
        <div className="space-y-[12px]">
          <p className="text-ds-body text-ds-fg-body">Select one or more frameworks to generate the charter from those frameworks only. If you select none, all available frameworks are used.</p>

          {!availableFrameworks || availableFrameworks.length === 0 ? (
            <p className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[16px] text-ds-body text-ds-fg-body">No frameworks are available yet.</p>
          ) : (
            <ul className="max-h-[60vh] space-y-[4px] overflow-y-auto rounded-ds-card border border-ds-border p-[8px]">
              {availableFrameworks.map((fw: any) => (
                <li key={fw.id}>
                  <Checkbox
                    label={<span><span className="block font-medium text-ds-fg">{fw.name}</span><span className="block text-ds-label font-normal text-ds-fg-muted">{fw.classification || EMPTY}</span></span>}
                    checked={selectedFrameworkIds.includes(fw.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFrameworkIds([...selectedFrameworkIds, fw.id]);
                      } else {
                        setSelectedFrameworkIds(selectedFrameworkIds.filter(id => id !== fw.id));
                      }
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </RightSlidePanel>

      {/* ── Edit committee ── */}
      <RightSlidePanel
        isOpen={isEditCommitteeOpen}
        onClose={() => { updateCommitteeMutation.reset(); setIsEditCommitteeOpen(false); }}
        title="Edit committee"
        dirty={formChanged(editInitial, editCommitteeDraft)}
        footer={<DrawerFooter onCancel={() => { updateCommitteeMutation.reset(); setIsEditCommitteeOpen(false); }} form="edit-committee-form" pending={updateCommitteeMutation.isPending} label="Save changes" pendingLabel="Saving…" disabled={!editCommitteeDraft.name.trim()} />}
      >
        <form
          id="edit-committee-form"
          onSubmit={(e) => {
            e.preventDefault();
            updateCommitteeMutation.mutate({
              name: editCommitteeDraft.name,
              description: editCommitteeDraft.description || null,
              committee_type: editCommitteeDraft.committee_type,
              chair_id: editCommitteeDraft.chair_id ? Number(editCommitteeDraft.chair_id) : null,
              secretary_id: editCommitteeDraft.secretary_id ? Number(editCommitteeDraft.secretary_id) : null,
              meeting_frequency: editCommitteeDraft.meeting_frequency,
            });
          }}
          className="flex flex-col gap-[16px]"
        >
          {updateCommitteeMutation.isError && <FormProblem message={errorMessage(updateCommitteeMutation.error, 'The committee could not be saved.')} />}
          <FormField label="Name" required>
            <TextInput value={editCommitteeDraft.name} onChange={(e) => setEditCommitteeDraft({ ...editCommitteeDraft, name: e.target.value })} maxLength={255} required />
          </FormField>

          <FormField label="Description" optional>
            <Textarea value={editCommitteeDraft.description} onChange={(e) => setEditCommitteeDraft({ ...editCommitteeDraft, description: e.target.value })} rows={3} />
          </FormField>

          <FormField label="Committee type">
            <Select value={editCommitteeDraft.committee_type} onChange={(e) => setEditCommitteeDraft({ ...editCommitteeDraft, committee_type: e.target.value })}>
              {COMMITTEE_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </FormField>

          <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
            <PickerField label="Chair" optional>
              <MultiSelectDropdown
                title="Chair"
                items={normalizedTenantUsers.map((u) => ({ value: String(u.id), label: u.name }))}
                selectedValues={editCommitteeDraft.chair_id ? [String(editCommitteeDraft.chair_id)] : []}
                onApply={(values) => setEditCommitteeDraft({ ...editCommitteeDraft, chair_id: values[0] || '' })}
                multiSelect={false}
                autoApply
                triggerVariant="input"
                forceSearch
                size="sm"
                triggerClassName="w-full"
                placeholder="Select chair"
              />
            </PickerField>
            <PickerField label="Secretary" optional>
              <MultiSelectDropdown
                title="Secretary"
                items={normalizedTenantUsers.map((u) => ({ value: String(u.id), label: u.name }))}
                selectedValues={editCommitteeDraft.secretary_id ? [String(editCommitteeDraft.secretary_id)] : []}
                onApply={(values) => setEditCommitteeDraft({ ...editCommitteeDraft, secretary_id: values[0] || '' })}
                multiSelect={false}
                autoApply
                triggerVariant="input"
                forceSearch
                size="sm"
                triggerClassName="w-full"
                placeholder="Select secretary"
              />
            </PickerField>
          </div>

          <FormField label="Meeting frequency">
            <Select value={editCommitteeDraft.meeting_frequency} onChange={(e) => setEditCommitteeDraft({ ...editCommitteeDraft, meeting_frequency: e.target.value })}>
              {FREQUENCY_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </FormField>
        </form>
      </RightSlidePanel>
      {confirmDialog}
    </div>
  );
}

// ── CharterSectionsView ──────────────────────────────────────────────────────
// Renders the structured sections (from upload-parse or AI-generate) as expandable cards: the same look as the AI panel above, so an uploaded charter and an
// AI-drafted one look identical to the reader.

function CharterSectionsView({ sections }: { sections: CharterSection[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));
  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };
  return (
    <div className="mt-[12px] space-y-[8px]">
      {sections.map((s, i) => {
        const isOpen = expanded.has(i);
        return (
          <div key={i} className="rounded-ds-card border border-ds-border bg-ds-surface">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(i)}
              className="flex w-full items-center justify-between gap-[8px] px-[12px] py-[8px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]"
            >
              <span className="min-w-0 break-words text-ds-body font-medium text-ds-fg">
                {i + 1}. {s.title}
              </span>
              {isOpen ? <ChevronDown aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" /> : <ChevronRight aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />}
            </button>
            {isOpen && (
              <div className="border-t border-ds-border px-[12px] pb-[12px] pt-[8px]">
                <p className="whitespace-pre-wrap text-ds-body leading-relaxed text-ds-fg-body">{s.content}</p>
                {s.framework_references && s.framework_references.length > 0 && (
                  <div className="mt-[8px] flex flex-wrap gap-[6px]">
                    {s.framework_references.map((ref) => (
                      <StatusPill key={ref} size="sm" tone="progress" label={ref} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
