'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { committeeApi, apiClient, frameworkUploadApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Users,
  Calendar,
  FileText,
  CheckSquare,
  Plus,
  UserPlus,
  UserMinus,
  X,
  Clock,
  AlertCircle,
  ArrowLeft,
  Eye,
  Edit2,
  Building2,
  Upload,
  Download,
  Paperclip,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Star,
  Copy,
  Save,
  GitCompare,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';

interface Committee {
  id: number;
  name: string;
  description?: string;
  committee_type: string;
  chair_id?: number;
  chair_name?: string;
  secretary_id?: number;
  secretary_name?: string;
  meeting_frequency?: string;
  member_count: number;
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
  // Populated by the upload-new endpoint or any path that parses
  // structured sections. Frontend prefers this when present so an
  // uploaded charter renders the same way an AI-drafted one does.
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
}

interface Action {
  id: number;
  title: string;
  description?: string;
  action_type: string;
  status: 'open' | 'in_progress' | 'completed' | 'overdue';
  due_date: string;
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

const COMMITTEE_TYPE_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  board: { label: 'Board', bg: 'bg-purple-500/20', text: 'text-purple-400' },
  risk_committee: { label: 'Risk Committee', bg: 'bg-rose-500/20', text: 'text-rose-400' },
  audit_committee: { label: 'Audit Committee', bg: 'bg-blue-500/20', text: 'text-blue-400' },
  compliance_committee: { label: 'Compliance Committee', bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  it_steering: { label: 'IT Steering', bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  custom: { label: 'Custom', bg: 'bg-slate-500/20', text: 'text-slate-400' },
};

const MEETING_TYPE_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  regular: { label: 'Regular', bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  special: { label: 'Special', bg: 'bg-amber-500/20', text: 'text-amber-400' },
  emergency: { label: 'Emergency', bg: 'bg-rose-500/20', text: 'text-rose-400' },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  scheduled: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  in_progress: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  completed: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  cancelled: { bg: 'bg-slate-500/20', text: 'text-slate-400' },
  open: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  overdue: { bg: 'bg-rose-500/20', text: 'text-rose-400' },
  draft: { bg: 'bg-slate-500/20', text: 'text-slate-400' },
  active: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  superseded: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
};

const TABS = [
  { id: 'overview', label: 'Overview', icon: Building2 },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'charters', label: 'Charters', icon: FileText },
  { id: 'meetings', label: 'Meetings', icon: Calendar },
  { id: 'actions', label: 'Actions', icon: CheckSquare },
];

function getStatusIcon(s: string) {
  if (s === 'covered') return <CheckCircle className="h-4 w-4 text-emerald-400" />;
  if (s === 'partial') return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  if (s === 'missing') return <XCircle className="h-4 w-4 text-red-400" />;
  if (s === 'exceeds') return <Star className="h-4 w-4 text-blue-400" />;
  return null;
}

function getStatusColor(s: string) {
  if (s === 'covered') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
  if (s === 'partial') return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
  if (s === 'missing') return 'text-red-400 bg-red-500/10 border-red-500/30';
  if (s === 'exceeds') return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
  return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
}

function getScoreColor(score: number) {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}

function getScoreRingColor(score: number) {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#eab308';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

export default function CommitteeDetailPage() {
  const params = useParams();
  const committeeId = parseInt(params.id as string);
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:committees:create');
  const canDelete = hasPermission('governance:committees:delete');
  const [activeTab, setActiveTab] = useState('overview');
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [isScheduleMeetingModalOpen, setIsScheduleMeetingModalOpen] = useState(false);
  const [isCreateActionModalOpen, setIsCreateActionModalOpen] = useState(false);
  const [newMember, setNewMember] = useState({ user_id: '', role: 'member' });
  const [newMeeting, setNewMeeting] = useState({
    title: '',
    meeting_type: 'regular',
    scheduled_date: '',
    start_time: '',
    end_time: '',
    location: '',
  });
  const [newAction, setNewAction] = useState({
    meeting_id: '',
    title: '',
    description: '',
    action_type: 'follow_up',
    due_date: '',
    assigned_to_id: '',
  });
  const [actionUploadFile, setActionUploadFile] = useState<File | null>(null);
  const queryClient = useQueryClient();

  // Edit-committee state. Holds the editable copy of name/description/etc.
  // until the user saves; close the panel and we discard the draft.
  const [isEditCommitteeOpen, setIsEditCommitteeOpen] = useState(false);
  const [editCommitteeDraft, setEditCommitteeDraft] = useState({
    name: '', description: '', committee_type: 'custom',
    chair_id: '' as number | '' | string,
    secretary_id: '' as number | '' | string,
    meeting_frequency: 'monthly',
  });

  const [aiCharterResult, setAiCharterResult] = useState<AICharterResult | null>(null);
  const [showAiCharterPanel, setShowAiCharterPanel] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [comparisonResult, setComparisonResult] = useState<AIComparisonResult | null>(null);
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [editingCharterId, setEditingCharterId] = useState<number | null>(null);
  const [editCharterTitle, setEditCharterTitle] = useState('');
  const [editCharterContent, setEditCharterContent] = useState('');
  const [editCharterStatus, setEditCharterStatus] = useState('draft');
  const [selectedFrameworkIds, setSelectedFrameworkIds] = useState<number[]>([]);
  const [showFrameworkSelectionModal, setShowFrameworkSelectionModal] = useState(false);

  const { data: committee, isLoading: committeeLoading, error: committeeError } = useQuery({
    queryKey: ['committee', committeeId],
    queryFn: async () => {
      const response = await committeeApi.getCommittee(committeeId);
      return response.data as Committee;
    },
  });

  const { data: members } = useQuery({
    queryKey: ['committee-members', committeeId],
    queryFn: async () => {
      const response = await committeeApi.getMembers(committeeId);
      return response.data as Member[];
    },
    enabled: !!committee && (activeTab === 'members' || activeTab === 'overview' || isAddMemberModalOpen),
    placeholderData: keepPreviousData,
  });

  const { data: charters } = useQuery({
    queryKey: ['committee-charters', committeeId],
    queryFn: async () => {
      const response = await committeeApi.getCharters(committeeId);
      return response.data as Charter[];
    },
    enabled: !!committee,
    placeholderData: keepPreviousData,
  });

  const { data: meetings } = useQuery({
    queryKey: ['committee-meetings', committeeId],
    queryFn: async () => {
      const response = await committeeApi.getMeetings(committeeId);
      const payload = response.data as unknown;
      if (Array.isArray(payload)) return payload as Meeting[];
      const data = payload as { items?: Meeting[] };
      return data.items || [];
    },
    enabled: !!committee && (activeTab === 'meetings' || activeTab === 'actions' || activeTab === 'overview' || isScheduleMeetingModalOpen || isCreateActionModalOpen),
    placeholderData: keepPreviousData,
  });

  const { data: actions } = useQuery({
    queryKey: ['committee-actions', committeeId],
    queryFn: async () => {
      const response = await committeeApi.getActions({ committee_id: committeeId });
      const payload = response.data as unknown;
      const items = Array.isArray(payload)
        ? (payload as any[])
        : ((payload as { items?: any[] })?.items || []);
      return items.map((item) => ({
        ...item,
        assigned_to_name: item.assigned_to_name || item.assignee_name || '',
      })) as Action[];
    },
    enabled: !!committee && (activeTab === 'actions' || activeTab === 'overview' || isCreateActionModalOpen),
    placeholderData: keepPreviousData,
  });

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
      const response = await frameworkUploadApi.getFrameworks({ limit: 1000 });
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

  const addMemberMutation = useMutation({
    mutationFn: (data: { user_id: number; role: string }) => committeeApi.addMember(committeeId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee-members', committeeId] });
      // Adding a chair/secretary now also updates committee.chair_id /
      // secretary_id on the backend, so refresh the committee header too.
      queryClient.invalidateQueries({ queryKey: ['committee', committeeId] });
      setIsAddMemberModalOpen(false);
      setNewMember({ user_id: '', role: 'member' });
    },
  });

  const updateCommitteeMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.updateCommittee(committeeId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee', committeeId] });
      setIsEditCommitteeOpen(false);
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: number) => committeeApi.removeMember(committeeId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee-members', committeeId] });
      // Backend clears committee.chair_id/secretary_id when a chair/secretary
      // member is removed — refresh the committee header to drop the name.
      queryClient.invalidateQueries({ queryKey: ['committee', committeeId] });
    },
  });

  const createMeetingMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.createMeeting(committeeId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee-meetings', committeeId] });
      setIsScheduleMeetingModalOpen(false);
      setNewMeeting({ title: '', meeting_type: 'regular', scheduled_date: '', start_time: '', end_time: '', location: '' });
    },
  });

  const createActionMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.createManualAction(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee-actions', committeeId] });
      setIsCreateActionModalOpen(false);
      setNewAction({
        meeting_id: '',
        title: '',
        description: '',
        action_type: 'follow_up',
        due_date: '',
        assigned_to_id: '',
      });
      setActionUploadFile(null);
    },
  });

  const aiRewordActionMutation = useMutation({
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
    onSuccess: (result) => {
      setNewAction((prev) => ({ ...prev, description: result.text || prev.description }));
    },
  });

  const aiSummarizeActionMutation = useMutation({
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
    onSuccess: (result) => {
      setNewAction((prev) => ({ ...prev, description: result.text || prev.description }));
    },
  });

  const uploadCharterFileMutation = useMutation({
    mutationFn: ({ charterId, file }: { charterId: number; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      return committeeApi.uploadCharterFile(committeeId, charterId, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee-charters', committeeId] });
    },
  });

  // "Upload Charter" — create a brand-new charter directly from a PDF /
  // DOCX / TXT file. Single round-trip: backend extracts the text, saves
  // the file, returns the new charter row. Placed BEFORE "AI Generate
  // Charter" because importing an existing charter is the more common
  // path for customers who already have one.
  const uploadNewCharterMutation = useMutation({
    mutationFn: (file: File) =>
      committeeApi.uploadNewCharter(committeeId, file, { status: 'draft' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee-charters', committeeId] });
      setAiError(null);
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.detail || error?.message || 'Failed to upload charter';
      setAiError(msg);
    },
  });

  // Hidden file input bound to the Upload button.
  const uploadCharterInputRef = useRef<HTMLInputElement | null>(null);
  const onPickUploadCharterFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadNewCharterMutation.mutate(file);
    // Reset so picking the same file twice still fires onChange.
    if (e.target) e.target.value = '';
  };

  const aiGenerateMutation = useMutation({
    mutationFn: () => committeeApi.aiGenerateCharter(committeeId, selectedFrameworkIds.length > 0 ? selectedFrameworkIds : undefined),
    onSuccess: (response) => {
      setAiCharterResult(response.data as AICharterResult);
      setShowAiCharterPanel(true);
      setAiError(null);
      setExpandedSections(new Set([0]));
      setShowFrameworkSelectionModal(false);
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.detail || error?.message || 'Failed to generate charter';
      setAiError(msg);
    },
  });

  const aiCompareMutation = useMutation({
    mutationFn: (data: { charter_id?: number; charter_text?: string }) =>
      committeeApi.aiCompareCharter(committeeId, data),
    onSuccess: (response) => {
      setComparisonResult(response.data as AIComparisonResult);
      setShowComparisonModal(true);
      setAiError(null);
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.detail || error?.message || 'Failed to compare charter';
      setAiError(msg);
    },
  });

  const saveCharterMutation = useMutation({
    mutationFn: (data: any) => committeeApi.createCharter(committeeId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee-charters', committeeId] });
      setShowAiCharterPanel(false);
    },
  });

  const updateCharterMutation = useMutation({
    mutationFn: ({ charterId, data }: { charterId: number; data: any }) =>
      committeeApi.updateCharter(charterId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee-charters', committeeId] });
      setEditingCharterId(null);
    },
  });

  const deleteCharterMutation = useMutation({
    mutationFn: (charterId: number) => committeeApi.deleteCharter(committeeId, charterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee-charters', committeeId] });
    },
  });

  const handleFileUpload = (charterId: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadCharterFileMutation.mutate({ charterId, file });
    }
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
      console.error('Download failed:', error);
    }
  };

  // For AI-drafted (or any text-only) charters that have no uploaded file yet,
  // build a downloadable Word document straight from the stored content.
  // Reuses the existing markdown-to-docx helper from the compliance module so
  // every download path in the app produces the same formatting (headings,
  // tables, bullet lists). Users get a `.docx` they can open in Word /
  // LibreOffice / Google Docs without any conversion step.
  const handleDownloadCharterContent = async (charter: Charter) => {
    // Lazy import — the docx generator pulls in ~150KB of code we don't want
    // on the initial bundle for users who never download a charter.
    const { downloadAsDocx } = await import('@/components/compliance/downloadUtils');
    const safeName = (charter.title || 'charter').replace(/[^a-z0-9_\- ]/gi, '_').trim() || 'charter';
    const versionTag = charter.version ? `_v${charter.version}` : '';
    const filename = `${safeName}${versionTag}`;  // .docx appended by downloadAsDocx
    const header = [
      `# ${charter.title || 'Committee Charter'}`,
      charter.version ? `**Version:** ${charter.version}` : '',
      charter.status ? `**Status:** ${charter.status}` : '',
      charter.effective_date ? `**Effective Date:** ${new Date(charter.effective_date).toLocaleDateString()}` : '',
      charter.approver_name ? `**Approved By:** ${charter.approver_name}` : '',
      '',
      '---',
      '',
    ].filter(Boolean).join('\n');
    const body = charter.content || '_No content provided._';
    await downloadAsDocx(filename, `${header}\n${body}\n`);
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

  const handleCopyCharter = () => {
    if (!aiCharterResult?.charter) return;
    const fullContent = aiCharterResult.charter.sections
      .map(s => `## ${s.title}\n\n${s.content}\n\nFramework References: ${s.framework_references.join(', ')}`)
      .join('\n\n---\n\n');
    navigator.clipboard.writeText(fullContent);
  };

  if (committeeLoading) {
    return (
      <div className="space-y-8">
        <div className="skeleton h-8 w-64 mb-4" />
        <div className="skeleton h-5 w-96" />
      </div>
    );
  }

  if (committeeError || !committee) {
    return (
      <div className="space-y-8">
        <Link href="/governance/committees" className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to Committees
        </Link>
        <div className="card p-12 text-center">
          <AlertCircle className="h-12 w-12 text-rose-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Committee Not Found</h2>
          <p className="text-slate-600 mb-6">The committee you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
          <Link href="/governance/committees" className="btn-primary inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Link>
        </div>
      </div>
    );
  }

  const typeStyle = COMMITTEE_TYPE_LABELS[committee.committee_type] || COMMITTEE_TYPE_LABELS.custom;
  const activeCharter = charters?.find(c => c.status === 'active');
  const normalizedTenantUsers = Array.from(
    new Map(
      ((tenantUsers || []) as TenantUser[])
        .map((tenantUser) => {
          const userId = tenantUser.user?.id || tenantUser.id || tenantUser.user_id;
          const userName = tenantUser.user?.display_name || tenantUser.user?.username || tenantUser.display_name || tenantUser.username || tenantUser.user?.email || tenantUser.email || 'User';
          if (!userId) return null;
          return { id: userId, name: userName };
        })
        .filter((user): user is { id: number; name: string } => !!user)
        .map((user) => [user.id, user])
    ).values()
  );
  const memberUserIds = new Set((members || []).map((member) => member.user_id));
  const availableUsers = normalizedTenantUsers.filter((user) => {
    return !memberUserIds.has(user.id);
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <Link href="/governance/committees" className="mb-3 flex items-center gap-2 text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Back to Committees
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary-500/20">
              <Users className="h-7 w-7 text-primary-400" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-lg sm:text-xl font-semibold text-slate-900">{committee.name}</h1>
                <span className={`rounded-full px-2.5 py-0.5 text-xs ${typeStyle.bg} ${typeStyle.text}`}>
                  {typeStyle.label}
                </span>
              </div>
              {committee.description && (
                <p className="text-black mt-1">{committee.description}</p>
              )}
            </div>
          </div>
          {canCreate && (
            <button
              type="button"
              onClick={() => {
                setEditCommitteeDraft({
                  name: committee.name,
                  description: committee.description ?? '',
                  committee_type: committee.committee_type,
                  chair_id: committee.chair_id ?? '',
                  secretary_id: committee.secretary_id ?? '',
                  meeting_frequency: committee.meeting_frequency ?? 'monthly',
                });
                setIsEditCommitteeOpen(true);
              }}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              title="Edit committee details"
            >
              <Edit2 className="h-4 w-4" />
              Edit Committee
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="card p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold text-black mb-4">Committee Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-black">Chair</p>
                <p className="text-black font-medium">{committee.chair_name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-black">Secretary</p>
                <p className="text-black font-medium">{committee.secretary_name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-black">Members</p>
                <p className="text-black font-medium">{committee.member_count}</p>
              </div>
              <div>
                <p className="text-sm text-black">Meeting Frequency</p>
                <p className="text-black font-medium capitalize">{committee.meeting_frequency || '-'}</p>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            {activeCharter && (
              <div className="card p-4 border-emerald-500/30">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-emerald-400 font-medium uppercase tracking-wider mb-2">
                      Active Charter
                    </p>
                    <p className="text-black font-medium">{activeCharter.title}</p>
                    <div className="flex items-center gap-4 mt-2 text-sm text-black">
                      <span>v{activeCharter.version}</span>
                      <span>{new Date(activeCharter.effective_date).toLocaleDateString()}</span>
                    </div>
                  </div>
                  {activeCharter.file_name ? (
                    <button
                      type="button"
                      onClick={() => handleDownloadFile(activeCharter.id, activeCharter.file_name!)}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/30"
                      title={`Download ${activeCharter.file_name}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </button>
                  ) : activeCharter.content ? (
                    <button
                      type="button"
                      onClick={() => handleDownloadCharterContent(activeCharter)}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/30"
                      title="Download AI-drafted charter as Markdown"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download Draft
                    </button>
                  ) : null}
                </div>
                {activeCharter.file_name && (
                  <p className="text-xs text-slate-500 mt-3 truncate">{activeCharter.file_name}</p>
                )}
              </div>
            )}
            <div className="card p-4">
              <p className="text-xs text-black font-medium uppercase tracking-wider mb-2">Quick Stats</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-black">Total Charters</span>
                  <span className="text-black font-medium">{charters?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black">Meetings</span>
                  <span className="text-black font-medium">{meetings?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black">Open Actions</span>
                  <span className="text-black font-medium">{actions?.filter(a => a.status === 'open' || a.status === 'in_progress').length || 0}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'members' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {canCreate && (
            <button onClick={() => setIsAddMemberModalOpen(true)} className="btn-primary flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Add Member
            </button>
            )}
          </div>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-sm font-medium text-black">Name</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-black">Email</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-black">Role</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-black">Joined</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-black">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(members || []).map((member) => (
                  <tr key={member.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4 text-black">{member.user_name}</td>
                    <td className="py-3 px-4 text-black">{member.user_email}</td>
                    <td className="py-3 px-4">
                      <span className="capitalize text-black">{member.role}</span>
                    </td>
                    <td className="py-3 px-4 text-black">{new Date(member.joined_at).toLocaleDateString()}</td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => removeMemberMutation.mutate(member.user_id)}
                        className="text-rose-400 hover:text-rose-300"
                        title="Remove member"
                        style={{ display: canDelete ? undefined : 'none' }}
                      >
                        <UserMinus className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'charters' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-black">Committee Charters</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Already have a charter document? <strong>Upload</strong> it. Need a draft from
                scratch? <strong>AI Generate</strong> creates one from your frameworks.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Hidden file input — the Upload button below triggers it. */}
              <input
                ref={uploadCharterInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain,text/markdown"
                onChange={onPickUploadCharterFile}
                className="hidden"
              />
              {/* Upload Charter — comes BEFORE AI Generate so customers
                  who already have a document see the import path first. */}
              <button
                onClick={() => uploadCharterInputRef.current?.click()}
                disabled={uploadNewCharterMutation.isPending}
                className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-all"
              >
                {uploadNewCharterMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {uploadNewCharterMutation.isPending ? 'Uploading…' : 'Upload Charter'}
              </button>
              <button
                onClick={() => {
                  setAiError(null);
                  setSelectedFrameworkIds([]);
                  setShowFrameworkSelectionModal(true);
                }}
                disabled={aiGenerateMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-all"
              >
                {aiGenerateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {aiGenerateMutation.isPending ? 'Analyzing Frameworks...' : 'AI Generate Charter'}
              </button>
            </div>
          </div>

          {aiError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">AI Error</p>
                <p className="text-xs text-red-300 mt-1">{aiError}</p>
              </div>
              <button onClick={() => setAiError(null)} className="ml-auto text-red-400 hover:text-red-300">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {showAiCharterPanel && aiCharterResult && (
            <div className="rounded-xl border border-purple-500/30 bg-white p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-purple-500/20 p-2">
                    <Sparkles className="h-5 w-5 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-black">{aiCharterResult.charter.charter_title}</h3>
                    <p className="text-xs text-black mt-0.5">
                      Generated from {aiCharterResult.frameworks_analyzed.length} frameworks, {aiCharterResult.controls_analyzed} controls analyzed
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyCharter}
                    className="flex items-center gap-1.5 rounded-lg bg-slate-200 px-3 py-1.5 text-xs text-black hover:bg-slate-100 transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                  <button
                    onClick={handleSaveAICharter}
                    disabled={saveCharterMutation.isPending}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    {saveCharterMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Save as Draft
                  </button>
                  <button
                    onClick={() => setShowAiCharterPanel(false)}
                    className="text-slate-600 hover:text-slate-900"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-4">
                {aiCharterResult.frameworks_analyzed.map((fw, i) => (
                  <span key={i} className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-[10px] font-medium text-indigo-700">
                    {fw}
                  </span>
                ))}
              </div>

              {aiCharterResult.charter.summary && (
                <p className="text-sm text-black mb-4 italic border-l-2 border-purple-500/50 pl-3">
                  {aiCharterResult.charter.summary}
                </p>
              )}

              <div className="space-y-2">
                {aiCharterResult.charter.sections.map((section, idx) => (
                  <div key={idx} className="rounded-lg border border-slate-300 bg-white overflow-hidden">
                    <button
                      onClick={() => toggleSection(idx)}
                      className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex items-center justify-center h-6 w-6 rounded-full bg-purple-100 text-purple-600 text-xs font-bold">
                          {idx + 1}
                        </span>
                        <span className="text-sm font-medium text-black">{section.title}</span>
                      </div>
                      {expandedSections.has(idx) ? (
                        <ChevronDown className="h-4 w-4 text-black" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-black" />
                      )}
                    </button>
                    {expandedSections.has(idx) && (
                      <div className="px-4 pb-4 border-t border-slate-200">
                        <div className="mt-3 text-sm text-black whitespace-pre-line leading-relaxed">
                          {section.content}
                        </div>
                        {section.framework_references.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-200">
                            <p className="text-[10px] text-black uppercase tracking-wider mb-1.5">Framework References</p>
                            <div className="flex flex-wrap gap-1.5">
                              {section.framework_references.map((ref, ri) => (
                                <span key={ri} className="rounded bg-slate-200 px-2 py-0.5 text-[10px] text-black">
                                  {ref}
                                </span>
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
            <div key={charter.id} className={`card p-6 ${charter.status === 'active' ? 'border-emerald-500/30' : ''}`}>
              {editingCharterId === charter.id ? (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-black">Title</label>
                    <input
                      type="text"
                      value={editCharterTitle}
                      onChange={(e) => setEditCharterTitle(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-black">Content</label>
                    <textarea
                      value={editCharterContent}
                      onChange={(e) => setEditCharterContent(e.target.value)}
                      rows={6}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-black">Status</label>
                    <MultiSelectDropdown
                      title="Status"
                      items={[
                        { value: 'draft', label: 'Draft' },
                        { value: 'active', label: 'Active' },
                        { value: 'expired', label: 'Expired' },
                      ]}
                      selectedValues={[editCharterStatus]}
                      onApply={(values) => setEditCharterStatus(values[0] || 'draft')}
                      multiSelect={false}
                      triggerVariant="input"
                    />
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setEditingCharterId(null)}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-black hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => updateCharterMutation.mutate({
                        charterId: charter.id,
                        data: { title: editCharterTitle, content: editCharterContent, status: editCharterStatus },
                      })}
                      disabled={updateCharterMutation.isPending || !editCharterTitle.trim()}
                      className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      {updateCharterMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Save Changes
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-medium text-black">{charter.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[charter.status]?.bg} ${STATUS_COLORS[charter.status]?.text}`}>
                          {charter.status}
                        </span>
                      </div>
                      <p className="text-black text-sm mt-1">Version {charter.version}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setAiError(null);
                          aiCompareMutation.mutate({ charter_id: charter.id });
                        }}
                        disabled={aiCompareMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-purple-500 text-purple-600 rounded-lg hover:bg-purple-50 transition-all text-sm disabled:opacity-50"
                      >
                        {aiCompareMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <GitCompare className="h-3.5 w-3.5" />
                        )}
                        Compare with AI
                      </button>
                      {charter.file_name ? (
                        <button
                          onClick={() => handleDownloadFile(charter.id, charter.file_name!)}
                          className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors text-sm"
                          title={`Download ${charter.file_name}`}
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </button>
                      ) : charter.content ? (
                        <button
                          onClick={() => handleDownloadCharterContent(charter)}
                          className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors text-sm"
                          title="Download draft as Markdown"
                        >
                          <Download className="h-4 w-4" />
                          Download Draft
                        </button>
                      ) : null}
                      <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors cursor-pointer text-sm">
                        <Upload className="h-4 w-4" />
                        {uploadCharterFileMutation.isPending ? 'Uploading...' : 'Upload File'}
                        <input
                          type="file"
                          className="hidden"
                          accept=".pdf,.doc,.docx,.txt"
                          onChange={(e) => handleFileUpload(charter.id, e)}
                          disabled={uploadCharterFileMutation.isPending}
                        />
                      </label>
                      <button
                        onClick={() => {
                          setEditingCharterId(charter.id);
                          setEditCharterTitle(charter.title);
                          setEditCharterContent(charter.content || '');
                          setEditCharterStatus(charter.status);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors text-sm"
                        title="Edit charter"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this charter? This action cannot be undone.')) {
                            deleteCharterMutation.mutate(charter.id);
                          }
                        }}
                        disabled={deleteCharterMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors text-sm disabled:opacity-50"
                        title="Delete charter"
                      >
                        {deleteCharterMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  {/* Charter body — when the row has structured sections
                      (uploaded + parsed, or AI-saved) render them as
                      collapsible cards like the AI panel. Otherwise fall
                      back to a clamped preview of the plain content. */}
                  {charter.sections && charter.sections.length > 0 ? (
                    <CharterSectionsView sections={charter.sections} />
                  ) : (
                    charter.content && (
                      <p className="text-black mt-4 line-clamp-2">{charter.content}</p>
                    )
                  )}

                  {charter.file_name && (
                    <div className="flex items-center gap-3 mt-4 p-3 bg-slate-100 rounded-lg">
                      <Paperclip className="h-4 w-4 text-primary-400" />
                      <div className="flex-1">
                        <p className="text-sm text-black">{charter.file_name}</p>
                        <p className="text-xs text-black">
                          {charter.file_type?.toUpperCase()} {charter.file_size ? `• ${formatFileSize(charter.file_size)}` : ''}
                        </p>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-6 mt-4 text-sm text-slate-500">
                    <span>Effective: {new Date(charter.effective_date).toLocaleDateString()}</span>
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

          {(!charters || charters.length === 0) && !showAiCharterPanel && (
            <div className="card p-12 text-center">
              <FileText className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-black mb-2">No Charters Yet</h3>
              <p className="text-black mb-4">Generate a charter using AI based on your uploaded frameworks, or create one manually.</p>
              <button
                onClick={() => {
                  setAiError(null);
                  aiGenerateMutation.mutate();
                }}
                disabled={aiGenerateMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                <Sparkles className="h-4 w-4" />
                Generate with AI
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'meetings' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {canCreate && (
            <button onClick={() => setIsScheduleMeetingModalOpen(true)} className="btn-primary flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Schedule Meeting
            </button>
            )}
          </div>
          {(meetings || []).map((meeting) => (
            <Link key={meeting.id} href={`/governance/committees/meetings/${meeting.id}`} className="card p-6 block hover:border-primary-500/50 transition-all">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-medium text-black">{meeting.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${MEETING_TYPE_LABELS[meeting.meeting_type]?.bg} ${MEETING_TYPE_LABELS[meeting.meeting_type]?.text}`}>
                      {MEETING_TYPE_LABELS[meeting.meeting_type]?.label}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[meeting.status]?.bg} ${STATUS_COLORS[meeting.status]?.text}`}>
                      {meeting.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <Eye className="h-5 w-5 text-black" />
              </div>
              <div className="flex items-center gap-6 mt-3 text-sm text-black">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  {new Date(meeting.scheduled_date).toLocaleDateString()}
                </span>
                {meeting.start_time && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    {meeting.start_time} - {meeting.end_time}
                  </span>
                )}
                {meeting.location && <span>{meeting.location}</span>}
                <span className="flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  {meeting.attendee_count} attendees
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {activeTab === 'actions' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {canCreate && (
            <button onClick={() => setIsCreateActionModalOpen(true)} className="btn-primary flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Action Item
            </button>
            )}
          </div>

          {(!actions || actions.length === 0) && (
            <div className="card p-10 text-center">
              <CheckSquare className="h-12 w-12 text-slate-500 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-black mb-1">No Action Items Yet</h3>
              <p className="text-slate-600 mb-4">Create manual action items and use AI to reword or summarize action text.</p>
              {canCreate && (
              <button onClick={() => setIsCreateActionModalOpen(true)} className="btn-primary inline-flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Create First Action Item
              </button>
              )}
            </div>
          )}

          {(actions || []).map((action) => (
            <div key={action.id} className="card p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-medium text-black">{action.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[action.status]?.bg} ${STATUS_COLORS[action.status]?.text}`}>
                      {action.status.replace('_', ' ')}
                    </span>
                  </div>
                  {action.description && <p className="text-black text-sm mt-1">{action.description}</p>}
                </div>
              </div>
              <div className="flex items-center gap-6 mt-3 text-sm text-black">
                <span>Due: {new Date(action.due_date).toLocaleDateString()}</span>
                <span>Assigned to: {action.assigned_to_name || 'Pending Assignment'}</span>
                <span className="capitalize">{action.action_type.replace('_', ' ')}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <RightSlidePanel
        isOpen={isCreateActionModalOpen}
        onClose={() => setIsCreateActionModalOpen(false)}
        title="Create Action Item"
        footer={
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setIsCreateActionModalOpen(false)} className="btn-secondary">Cancel</button>
            <button
              type="submit"
              form="committee-create-action-form"
              disabled={createActionMutation.isPending || !newAction.title.trim()}
              className="btn-primary"
            >
              {createActionMutation.isPending ? 'Creating...' : 'Create Action'}
            </button>
          </div>
        }
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
            if (newAction.meeting_id) payload.meeting_id = parseInt(newAction.meeting_id, 10);
            if (newAction.description.trim()) payload.description = newAction.description.trim();
            if (newAction.due_date) payload.due_date = newAction.due_date;
            if (newAction.assigned_to_id) payload.assigned_to = parseInt(newAction.assigned_to_id, 10);
            createActionMutation.mutate(payload);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-black mb-1">Meeting (Optional)</label>
            <MultiSelectDropdown
              title="Meeting"
              items={(meetings || []).map((meeting) => ({ value: String(meeting.id), label: meeting.title }))}
              selectedValues={newAction.meeting_id ? [newAction.meeting_id] : []}
              onApply={(values) => setNewAction({ ...newAction, meeting_id: values[0] || '' })}
              multiSelect={false}
              triggerVariant="input"
              placeholder="No linked meeting"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-black mb-1">Title *</label>
            <input
              type="text"
              value={newAction.title}
              onChange={(e) => setNewAction({ ...newAction, title: e.target.value })}
              className="input w-full"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-black mb-1">Action Type</label>
              <MultiSelectDropdown
                title="Action Type"
                items={[
                  { value: 'follow_up',         label: 'Follow Up'         },
                  { value: 'policy_approval',   label: 'Policy Approval'   },
                  { value: 'risk_review',       label: 'Risk Review'       },
                  { value: 'audit_response',    label: 'Audit Response'    },
                  { value: 'corrective_action', label: 'Corrective Action' },
                  { value: 'preventive_action', label: 'Preventive Action' },
                  { value: 'investigation',     label: 'Investigation'     },
                  { value: 'escalation',        label: 'Escalation'        },
                  { value: 'decision_record',   label: 'Decision Record'   },
                  { value: 'recommendation',    label: 'Recommendation'    },
                  { value: 'training',          label: 'Training'          },
                  { value: 'monitoring',        label: 'Monitoring'        },
                  { value: 'vendor_review',     label: 'Vendor Review'     },
                  { value: 'incident_review',   label: 'Incident Review'   },
                  { value: 'compliance_review', label: 'Compliance Review' },
                  { value: 'communication',     label: 'Communication'     },
                  { value: 'documentation',     label: 'Documentation'     },
                  { value: 'other',             label: 'Other'             },
                ]}
                selectedValues={[newAction.action_type]}
                onApply={(values) => setNewAction({ ...newAction, action_type: values[0] || 'follow_up' })}
                multiSelect={false}
                triggerVariant="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-black mb-1">Due Date</label>
              <input
                type="date"
                value={newAction.due_date}
                onChange={(e) => setNewAction({ ...newAction, due_date: e.target.value })}
                className="input w-full"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-black mb-1">Assign To</label>
            <MultiSelectDropdown
              title="Assign To"
              items={normalizedTenantUsers.map((u) => ({ value: String(u.id), label: u.name }))}
              selectedValues={newAction.assigned_to_id ? [newAction.assigned_to_id] : []}
              onApply={(values) => setNewAction({ ...newAction, assigned_to_id: values[0] || '' })}
              multiSelect={false}
              triggerVariant="input"
              forceSearch
              placeholder="Leave Unassigned (Pending)"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-black mb-1">Description</label>
            <textarea
              value={newAction.description}
              onChange={(e) => setNewAction({ ...newAction, description: e.target.value })}
              className="input w-full h-28"
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
            <p className="text-sm font-medium text-black">AI Assistant</p>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Upload reference file (optional)</label>
              <input
                type="file"
                accept=".txt,.md,.csv,.json,.pdf,.doc,.docx"
                onChange={(e) => setActionUploadFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-black"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => aiRewordActionMutation.mutate()}
                disabled={aiRewordActionMutation.isPending || (!newAction.description.trim() && !actionUploadFile)}
                className="inline-flex items-center gap-2 rounded-lg border border-purple-300 bg-white px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-50"
              >
                {aiRewordActionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                AI Reword
              </button>
              <button
                type="button"
                onClick={() => aiSummarizeActionMutation.mutate()}
                disabled={aiSummarizeActionMutation.isPending || (!newAction.description.trim() && !actionUploadFile)}
                className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                {aiSummarizeActionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Generate Summary
              </button>
            </div>
          </div>
        </form>
      </RightSlidePanel>

      {/* AI Comparison Modal */}
      {showComparisonModal && comparisonResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-slate-200">
            <div className="sticky top-0 bg-white border-b border-slate-200 p-6 z-10">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-gradient-to-br from-purple-500/20 to-indigo-500/20 p-2.5">
                    <ShieldCheck className="h-6 w-6 text-purple-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-black">Charter Compliance Analysis</h2>
                    <p className="text-sm text-black mt-0.5">
                      {comparisonResult.frameworks_analyzed.length} frameworks, {comparisonResult.controls_analyzed} controls analyzed
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowComparisonModal(false)} className="text-black hover:text-black">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Overall Score */}
              <div className="flex items-center gap-8 p-6 rounded-xl border border-slate-200 bg-slate-50">
                <div className="relative h-28 w-28 shrink-0">
                  <svg className="h-28 w-28 -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#334155" strokeWidth="10" />
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
                    <span className="text-[10px] text-slate-500 uppercase">Score</span>
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-black mb-2">Overall Assessment</h3>
                  <p className="text-sm text-black leading-relaxed">{comparisonResult.comparison.overall_assessment}</p>
                </div>
              </div>

              {/* Section by Section Comparison */}
              <div>
                <h3 className="text-base font-semibold text-black mb-3">Section-by-Section Analysis</h3>
                <div className="space-y-2">
                  {comparisonResult.comparison.sections.map((section, idx) => (
                    <div key={idx} className={`rounded-lg border p-4 ${getStatusColor(section.status)}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(section.status)}
                          <span className="text-sm font-medium text-black">{section.title}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-sm font-bold ${getScoreColor(section.score)}`}>{section.score}%</span>
                          <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-200 text-black">
                            {section.status}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-black mb-2">{section.existing_content_summary}</p>
                      {section.recommendation && (
                        <div className="mt-2 p-2 rounded bg-slate-100 border border-slate-300">
                          <p className="text-[10px] text-purple-600 font-medium uppercase tracking-wider mb-1">Recommendation</p>
                          <p className="text-xs text-black">{section.recommendation}</p>
                        </div>
                      )}
                      {section.framework_requirements.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {section.framework_requirements.map((ref, ri) => (
                            <span key={ri} className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] text-black">
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
                  <h3 className="text-base font-semibold text-black mb-3 flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-400" />
                    Identified Gaps ({comparisonResult.comparison.gaps.length})
                  </h3>
                  <div className="space-y-2">
                    {comparisonResult.comparison.gaps.map((gap, idx) => (
                      <div key={idx} className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 flex items-start gap-3">
                        <span className={`shrink-0 mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                          gap.severity === 'high' ? 'bg-red-500/20 text-red-400' :
                          gap.severity === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-slate-500/20 text-slate-400'
                        }`}>
                          {gap.severity}
                        </span>
                        <div className="flex-1">
                          <p className="text-sm text-black">{gap.description}</p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {gap.frameworks.map((fw, fi) => (
                              <span key={fi} className="text-[9px] text-black">{fw}</span>
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
                    <h3 className="text-base font-semibold text-black mb-3 flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                      Strengths
                    </h3>
                    <div className="space-y-1.5">
                      {comparisonResult.comparison.strengths.map((s, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm text-black">
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          {s}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {comparisonResult.comparison.recommendations.length > 0 && (
                  <div>
                    <h3 className="text-base font-semibold text-black mb-3 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-purple-400" />
                      Recommendations
                    </h3>
                    <div className="space-y-1.5">
                      {comparisonResult.comparison.recommendations.map((r, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm text-black">
                          <span className="text-purple-400 shrink-0">•</span>
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
                  <h3 className="text-base font-semibold text-white mb-3">Framework Coverage</h3>
                  <div className="grid gap-3 md:grid-cols-3">
                    {comparisonResult.comparison.framework_coverage.addressed?.length > 0 && (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                        <p className="text-[10px] text-emerald-400 font-medium uppercase tracking-wider mb-2">Addressed</p>
                        {comparisonResult.comparison.framework_coverage.addressed.map((fw, i) => (
                          <p key={i} className="text-xs text-slate-300 flex items-center gap-1.5 mb-1">
                            <CheckCircle className="h-3 w-3 text-emerald-400" />
                            {fw}
                          </p>
                        ))}
                      </div>
                    )}
                    {comparisonResult.comparison.framework_coverage.partially_addressed?.length > 0 && (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                        <p className="text-[10px] text-amber-400 font-medium uppercase tracking-wider mb-2">Partially Addressed</p>
                        {comparisonResult.comparison.framework_coverage.partially_addressed.map((fw, i) => (
                          <p key={i} className="text-xs text-slate-300 flex items-center gap-1.5 mb-1">
                            <AlertTriangle className="h-3 w-3 text-amber-400" />
                            {fw}
                          </p>
                        ))}
                      </div>
                    )}
                    {comparisonResult.comparison.framework_coverage.not_addressed?.length > 0 && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                        <p className="text-[10px] text-red-400 font-medium uppercase tracking-wider mb-2">Not Addressed</p>
                        {comparisonResult.comparison.framework_coverage.not_addressed.map((fw, i) => (
                          <p key={i} className="text-xs text-black flex items-center gap-1.5 mb-1">
                            <XCircle className="h-3 w-3 text-red-400" />
                            {fw}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Member Panel */}
      <RightSlidePanel
        isOpen={isAddMemberModalOpen}
        onClose={() => setIsAddMemberModalOpen(false)}
        title="Add Member"
        footer={
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setIsAddMemberModalOpen(false)} className="btn-secondary">Cancel</button>
            <button
              type="submit"
              form="add-member-form"
              disabled={addMemberMutation.isPending || !newMember.user_id}
              className="btn-primary"
            >
              {addMemberMutation.isPending ? 'Adding...' : 'Add Member'}
            </button>
          </div>
        }
      >
        <form
          id="add-member-form"
          onSubmit={(e) => { e.preventDefault(); addMemberMutation.mutate({ user_id: parseInt(newMember.user_id, 10), role: newMember.role }); }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-black mb-1">User *</label>
            <MultiSelectDropdown
              title="User"
              items={availableUsers.map((u) => ({ value: String(u.id), label: u.name }))}
              selectedValues={newMember.user_id ? [newMember.user_id] : []}
              onApply={(values) => setNewMember({ ...newMember, user_id: values[0] || '' })}
              multiSelect={false}
              triggerVariant="input"
              forceSearch
              placeholder="Select user"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Role</label>
            <MultiSelectDropdown
              title="Role"
              items={[
                { value: 'member', label: 'Member' },
                { value: 'chair', label: 'Chair' },
                { value: 'secretary', label: 'Secretary' },
              ]}
              selectedValues={[newMember.role]}
              onApply={(values) => setNewMember({ ...newMember, role: values[0] || 'member' })}
              multiSelect={false}
              triggerVariant="input"
            />
          </div>
        </form>
      </RightSlidePanel>

      {/* Schedule Meeting Panel */}
      <RightSlidePanel
        isOpen={isScheduleMeetingModalOpen}
        onClose={() => setIsScheduleMeetingModalOpen(false)}
        title="Schedule Meeting"
        footer={
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setIsScheduleMeetingModalOpen(false)} className="btn-secondary">Cancel</button>
            <button
              type="submit"
              form="schedule-meeting-form"
              disabled={createMeetingMutation.isPending}
              className="btn-primary"
            >
              {createMeetingMutation.isPending ? 'Scheduling...' : 'Schedule Meeting'}
            </button>
          </div>
        }
      >
        <form
          id="schedule-meeting-form"
          onSubmit={(e) => { e.preventDefault(); createMeetingMutation.mutate(newMeeting); }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-black mb-1">Meeting Title *</label>
            <input type="text" value={newMeeting.title} onChange={(e) => setNewMeeting({ ...newMeeting, title: e.target.value })} className="input w-full" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Meeting Type</label>
            <MultiSelectDropdown
              title="Meeting Type"
              items={[
                { value: 'regular', label: 'Regular' },
                { value: 'special', label: 'Special' },
                { value: 'emergency', label: 'Emergency' },
              ]}
              selectedValues={[newMeeting.meeting_type]}
              onApply={(values) => setNewMeeting({ ...newMeeting, meeting_type: values[0] || 'regular' })}
              multiSelect={false}
              triggerVariant="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Date *</label>
            <input type="date" value={newMeeting.scheduled_date} onChange={(e) => setNewMeeting({ ...newMeeting, scheduled_date: e.target.value })} className="input w-full" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-black mb-1">Start Time</label>
              <input type="time" value={newMeeting.start_time} onChange={(e) => setNewMeeting({ ...newMeeting, start_time: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-black mb-1">End Time</label>
              <input type="time" value={newMeeting.end_time} onChange={(e) => setNewMeeting({ ...newMeeting, end_time: e.target.value })} className="input w-full" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Location</label>
            <input type="text" value={newMeeting.location} onChange={(e) => setNewMeeting({ ...newMeeting, location: e.target.value })} className="input w-full" placeholder="e.g., Boardroom A, Virtual" />
          </div>
        </form>
      </RightSlidePanel>

      {/* Framework Selection Panel */}
      <RightSlidePanel
        isOpen={showFrameworkSelectionModal}
        onClose={() => setShowFrameworkSelectionModal(false)}
        title="Select Frameworks for Charter"
        footer={
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowFrameworkSelectionModal(false)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-black hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={() => aiGenerateMutation.mutate()}
              disabled={aiGenerateMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {aiGenerateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Generate Charter
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-black">Select one or more frameworks to generate the charter based on those frameworks only. If you don&apos;t select any, all available frameworks will be used.</p>

          {!availableFrameworks || availableFrameworks.length === 0 ? (
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-sm text-black">No frameworks available. Please upload or parse frameworks first.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto border border-slate-200 rounded-lg p-4">
              {availableFrameworks.map((fw: any) => (
                <label key={fw.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedFrameworkIds.includes(fw.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFrameworkIds([...selectedFrameworkIds, fw.id]);
                      } else {
                        setSelectedFrameworkIds(selectedFrameworkIds.filter(id => id !== fw.id));
                      }
                    }}
                    className="rounded border-slate-300"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-black">{fw.name}</p>
                    <p className="text-xs text-black">{fw.classification || 'N/A'}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      </RightSlidePanel>

      {/* Edit Committee Panel */}
      <RightSlidePanel
        isOpen={isEditCommitteeOpen}
        onClose={() => setIsEditCommitteeOpen(false)}
        title="Edit Committee"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsEditCommitteeOpen(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-committee-form"
              disabled={!editCommitteeDraft.name.trim() || updateCommitteeMutation.isPending}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {updateCommitteeMutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        }
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
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={editCommitteeDraft.name}
              onChange={(e) => setEditCommitteeDraft({ ...editCommitteeDraft, name: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-black focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              value={editCommitteeDraft.description}
              onChange={(e) => setEditCommitteeDraft({ ...editCommitteeDraft, description: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-black focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Committee Type</label>
            <MultiSelectDropdown
              title="Committee Type"
              items={[
                { value: 'board',                label: 'Board'                },
                { value: 'risk_committee',       label: 'Risk Committee'       },
                { value: 'audit_committee',      label: 'Audit Committee'      },
                { value: 'compliance_committee', label: 'Compliance Committee' },
                { value: 'it_steering',          label: 'IT Steering'          },
                { value: 'custom',               label: 'Custom'               },
              ]}
              selectedValues={[editCommitteeDraft.committee_type]}
              onApply={(values) => setEditCommitteeDraft({ ...editCommitteeDraft, committee_type: values[0] || 'custom' })}
              multiSelect={false}
              triggerVariant="input"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Chair</label>
              <MultiSelectDropdown
                title="Chair"
                items={normalizedTenantUsers.map((u) => ({ value: String(u.id), label: u.name }))}
                selectedValues={editCommitteeDraft.chair_id ? [String(editCommitteeDraft.chair_id)] : []}
                onApply={(values) => setEditCommitteeDraft({ ...editCommitteeDraft, chair_id: values[0] || '' })}
                multiSelect={false}
                triggerVariant="input"
                forceSearch
                placeholder="Select chair"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Secretary</label>
              <MultiSelectDropdown
                title="Secretary"
                items={normalizedTenantUsers.map((u) => ({ value: String(u.id), label: u.name }))}
                selectedValues={editCommitteeDraft.secretary_id ? [String(editCommitteeDraft.secretary_id)] : []}
                onApply={(values) => setEditCommitteeDraft({ ...editCommitteeDraft, secretary_id: values[0] || '' })}
                multiSelect={false}
                triggerVariant="input"
                forceSearch
                placeholder="Select secretary"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Meeting Frequency</label>
            <MultiSelectDropdown
              title="Meeting Frequency"
              items={[
                { value: 'weekly',    label: 'Weekly'    },
                { value: 'bi-weekly', label: 'Bi-Weekly' },
                { value: 'monthly',   label: 'Monthly'   },
                { value: 'quarterly', label: 'Quarterly' },
                { value: 'annually',  label: 'Annually'  },
                { value: 'ad_hoc',    label: 'Ad-hoc'    },
              ]}
              selectedValues={[editCommitteeDraft.meeting_frequency]}
              onApply={(values) => setEditCommitteeDraft({ ...editCommitteeDraft, meeting_frequency: values[0] || 'monthly' })}
              multiSelect={false}
              triggerVariant="input"
            />
          </div>
        </form>
      </RightSlidePanel>
    </div>
  );
}

// ── CharterSectionsView ──────────────────────────────────────────────────────
// Renders the structured sections (from upload-parse or AI-generate) as
// expandable cards — same visual language as the AI panel above, so an
// uploaded charter and an AI-drafted one look identical to the reader.

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
    <div className="mt-4 space-y-2">
      {sections.map((s, i) => {
        const isOpen = expanded.has(i);
        return (
          <div key={i} className="rounded-lg border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => toggle(i)}
              className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50"
            >
              <span className="text-sm font-medium text-slate-800 truncate text-left">
                {i + 1}. {s.title}
              </span>
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-400" />
              )}
            </button>
            {isOpen && (
              <div className="px-3 pb-3 border-t border-slate-100 pt-2">
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {s.content}
                </p>
                {s.framework_references && s.framework_references.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.framework_references.map((ref) => (
                      <span
                        key={ref}
                        className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
                      >
                        {ref}
                      </span>
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
