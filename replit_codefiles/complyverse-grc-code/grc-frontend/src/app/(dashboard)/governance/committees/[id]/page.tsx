'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { committeeApi } from '@/lib/api';
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
  Edit,
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
  Pencil,
} from 'lucide-react';
import Link from 'next/link';

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
  approved_by?: string;
  approved_at?: string;
  file_path?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
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

const COMMITTEE_TYPE_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  board: { label: 'Board', bg: 'rgba(28, 43, 58, 0.06)', color: 'var(--color-base)' },
  risk_committee: { label: 'Risk Committee', bg: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)' },
  audit_committee: { label: 'Audit Committee', bg: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' },
  compliance_committee: { label: 'Compliance Committee', bg: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)' },
  it_steering: { label: 'IT Steering', bg: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' },
  custom: { label: 'Custom', bg: 'var(--color-subtle)', color: 'var(--color-muted)' },
};

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
  draft: { bg: 'var(--color-subtle)', color: 'var(--color-muted)' },
  active: { bg: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)' },
  superseded: { bg: 'var(--color-subtle)', color: 'var(--color-muted)' },
};

const TABS = [
  { id: 'overview', label: 'Overview', icon: Building2 },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'charters', label: 'Charters', icon: FileText },
  { id: 'meetings', label: 'Meetings', icon: Calendar },
  { id: 'actions', label: 'Actions', icon: CheckSquare },
];

function getStatusIcon(s: string) {
  if (s === 'covered') return <CheckCircle className="h-4 w-4" style={{ color: 'var(--color-success)' }} />;
  if (s === 'partial') return <AlertTriangle className="h-4 w-4" style={{ color: 'var(--color-warning)' }} />;
  if (s === 'missing') return <XCircle className="h-4 w-4" style={{ color: 'var(--color-danger)' }} />;
  if (s === 'exceeds') return <Star className="h-4 w-4" style={{ color: 'var(--color-base)' }} />;
  return null;
}

function getStatusColor(s: string): React.CSSProperties {
  if (s === 'covered') return { color: 'var(--color-success)', backgroundColor: 'rgba(45, 106, 79, 0.05)', border: '1px solid rgba(45, 106, 79, 0.3)' };
  if (s === 'partial') return { color: 'var(--color-warning)', backgroundColor: 'rgba(146, 87, 14, 0.05)', border: '1px solid rgba(146, 87, 14, 0.3)' };
  if (s === 'missing') return { color: 'var(--color-danger)', backgroundColor: 'rgba(155, 28, 28, 0.05)', border: '1px solid rgba(155, 28, 28, 0.3)' };
  if (s === 'exceeds') return { color: 'var(--color-base)', backgroundColor: 'rgba(28, 43, 58, 0.05)', border: '1px solid rgba(28, 43, 58, 0.3)' };
  return { color: 'var(--color-muted)', backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' };
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'var(--color-success)';
  if (score >= 60) return 'var(--color-warning)';
  if (score >= 40) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function getScoreRingColor(score: number) {
  if (score >= 80) return '#2D6A4F';
  if (score >= 60) return '#92570E';
  if (score >= 40) return '#92570E';
  return '#9B1C1C';
}

export default function CommitteeDetailPage() {
  const params = useParams();
  const committeeId = parseInt(params.id as string);
  const [activeTab, setActiveTab] = useState('overview');
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [isScheduleMeetingModalOpen, setIsScheduleMeetingModalOpen] = useState(false);
  const [newMember, setNewMember] = useState({ user_id: '', role: 'member' });
  const [newMeeting, setNewMeeting] = useState({
    title: '',
    meeting_type: 'regular',
    scheduled_date: '',
    start_time: '',
    end_time: '',
    location: '',
  });
  const queryClient = useQueryClient();

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
    enabled: !!committee,
  });

  const { data: charters } = useQuery({
    queryKey: ['committee-charters', committeeId],
    queryFn: async () => {
      const response = await committeeApi.getCharters(committeeId);
      return response.data as Charter[];
    },
    enabled: !!committee,
  });

  const { data: meetings } = useQuery({
    queryKey: ['committee-meetings', committeeId],
    queryFn: async () => {
      const response = await committeeApi.getMeetings(committeeId);
      const data = response.data as { items: Meeting[]; total: number };
      return data.items || [];
    },
    enabled: !!committee,
  });

  const { data: actions } = useQuery({
    queryKey: ['committee-actions', committeeId],
    queryFn: async () => {
      const response = await committeeApi.getActions({ committee_id: committeeId });
      const data = response.data as { items: Action[]; total: number };
      return data.items || [];
    },
    enabled: !!committee,
  });

  const addMemberMutation = useMutation({
    mutationFn: (data: { user_id: number; role: string }) => committeeApi.addMember(committeeId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee-members', committeeId] });
      setIsAddMemberModalOpen(false);
      setNewMember({ user_id: '', role: 'member' });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: number) => committeeApi.removeMember(committeeId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee-members', committeeId] });
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

  const aiGenerateMutation = useMutation({
    mutationFn: () => committeeApi.aiGenerateCharter(committeeId),
    onSuccess: (response) => {
      setAiCharterResult(response.data as AICharterResult);
      setShowAiCharterPanel(true);
      setAiError(null);
      setExpandedSections(new Set([0]));
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
        <Link href="/governance/committees" className="inline-flex items-center gap-2 transition-colors" style={{ color: 'var(--color-muted)' }}>
          <ArrowLeft className="h-4 w-4" />
          Back to Committees
        </Link>
        <div className="card p-12 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4" style={{ color: 'var(--color-danger)' }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Committee Not Found</h2>
          <p className="mb-6" style={{ color: 'var(--color-muted)' }}>The committee you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
          <Link href="/governance/committees" className="btn-primary inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Link>
        </div>
      </div>
    );
  }

  const typeStyle = COMMITTEE_TYPE_STYLES[committee.committee_type] || COMMITTEE_TYPE_STYLES.custom;
  const activeCharter = charters?.find(c => c.status === 'active');

  return (
    <div className="space-y-8">
      <div>
        <Link href="/governance/committees" className="flex items-center gap-2 mb-4" style={{ color: 'var(--color-muted)' }}>
          <ArrowLeft className="h-4 w-4" />
          Back to Committees
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Users className="h-7 w-7" style={{ color: 'var(--color-base)' }} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{committee.name}</h1>
                <span className="text-xs px-2.5 py-0.5 rounded-full" style={{ backgroundColor: typeStyle.bg, color: typeStyle.color }}>
                  {typeStyle.label}
                </span>
              </div>
              {committee.description && (
                <p className="mt-1" style={{ color: 'var(--color-muted)' }}>{committee.description}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap"
            style={activeTab === tab.id
              ? { borderColor: 'var(--color-base)', color: 'var(--color-text)' }
              : { borderColor: 'transparent', color: 'var(--color-muted)' }
            }
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="card p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Committee Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Chair</p>
                <p style={{ color: 'var(--color-text)' }}>{committee.chair_name || '-'}</p>
              </div>
              <div>
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Secretary</p>
                <p style={{ color: 'var(--color-text)' }}>{committee.secretary_name || '-'}</p>
              </div>
              <div>
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Members</p>
                <p style={{ color: 'var(--color-text)' }}>{committee.member_count}</p>
              </div>
              <div>
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Meeting Frequency</p>
                <p className="capitalize" style={{ color: 'var(--color-text)' }}>{committee.meeting_frequency || '-'}</p>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            {activeCharter && (
              <div className="card p-4" style={{ borderColor: 'rgba(45, 106, 79, 0.3)' }}>
                <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--color-success)' }}>
                  Active Charter
                </p>
                <p className="font-medium" style={{ color: 'var(--color-text)' }}>{activeCharter.title}</p>
                <div className="flex items-center gap-4 mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>
                  <span>v{activeCharter.version}</span>
                  <span>{new Date(activeCharter.effective_date).toLocaleDateString()}</span>
                </div>
              </div>
            )}
            <div className="card p-4">
              <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Quick Stats</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--color-muted)' }}>Total Charters</span>
                  <span style={{ color: 'var(--color-text)' }}>{charters?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--color-muted)' }}>Meetings</span>
                  <span style={{ color: 'var(--color-text)' }}>{meetings?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--color-muted)' }}>Open Actions</span>
                  <span style={{ color: 'var(--color-text)' }}>{actions?.filter(a => a.status === 'open' || a.status === 'in_progress').length || 0}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'members' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setIsAddMemberModalOpen(true)} className="btn-primary flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Add Member
            </button>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left py-3 px-4 text-sm font-medium" style={{ color: 'var(--color-muted)' }}>Name</th>
                  <th className="text-left py-3 px-4 text-sm font-medium" style={{ color: 'var(--color-muted)' }}>Email</th>
                  <th className="text-left py-3 px-4 text-sm font-medium" style={{ color: 'var(--color-muted)' }}>Role</th>
                  <th className="text-left py-3 px-4 text-sm font-medium" style={{ color: 'var(--color-muted)' }}>Joined</th>
                  <th className="text-left py-3 px-4 text-sm font-medium" style={{ color: 'var(--color-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(members || []).map((member) => (
                  <tr key={member.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="py-3 px-4" style={{ color: 'var(--color-text)' }}>{member.user_name}</td>
                    <td className="py-3 px-4" style={{ color: 'var(--color-muted)' }}>{member.user_email}</td>
                    <td className="py-3 px-4">
                      <span className="capitalize" style={{ color: 'var(--color-text)' }}>{member.role}</span>
                    </td>
                    <td className="py-3 px-4" style={{ color: 'var(--color-muted)' }}>{new Date(member.joined_at).toLocaleDateString()}</td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => removeMemberMutation.mutate(member.user_id)}
                        style={{ color: 'var(--color-danger)' }}
                        title="Remove member"
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
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Committee Charters</h2>
            <button
              onClick={() => {
                setAiError(null);
                aiGenerateMutation.mutate();
              }}
              disabled={aiGenerateMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 transition-all"
            >
              {aiGenerateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {aiGenerateMutation.isPending ? 'Analyzing Frameworks...' : 'AI Generate Charter'}
            </button>
          </div>

          {aiError && (
            <div className="rounded-lg p-4 flex items-start gap-3" style={{ border: '1px solid rgba(155, 28, 28, 0.3)', backgroundColor: 'rgba(155, 28, 28, 0.05)' }}>
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: 'var(--color-danger)' }} />
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--color-danger)' }}>AI Error</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-danger)' }}>{aiError}</p>
              </div>
              <button onClick={() => setAiError(null)} className="ml-auto" style={{ color: 'var(--color-danger)' }}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {showAiCharterPanel && aiCharterResult && (
            <div className="rounded-xl p-6" style={{ border: '1px solid rgba(28, 43, 58, 0.2)', backgroundColor: 'var(--color-subtle)' }}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
                    <Sparkles className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{aiCharterResult.charter.charter_title}</h3>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      Generated from {aiCharterResult.frameworks_analyzed.length} frameworks, {aiCharterResult.controls_analyzed} controls analyzed
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyCharter}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors"
                    style={{ backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                  <button
                    onClick={handleSaveAICharter}
                    disabled={saveCharterMutation.isPending}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-white disabled:opacity-50 transition-colors"
                    style={{ backgroundColor: 'var(--color-success)' }}
                  >
                    {saveCharterMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Save as Draft
                  </button>
                  <button
                    onClick={() => setShowAiCharterPanel(false)}
                    style={{ color: 'var(--color-muted)' }}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-4">
                {aiCharterResult.frameworks_analyzed.map((fw, i) => (
                  <span key={i} className="rounded-full px-2.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' }}>
                    {fw}
                  </span>
                ))}
              </div>

              {aiCharterResult.charter.summary && (
                <p className="text-sm mb-4 italic pl-3" style={{ color: 'var(--color-text)', borderLeft: '2px solid var(--color-base)' }}>
                  {aiCharterResult.charter.summary}
                </p>
              )}

              <div className="space-y-2">
                {aiCharterResult.charter.sections.map((section, idx) => (
                  <div key={idx} className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                    <button
                      onClick={() => toggleSection(idx)}
                      className="w-full flex items-center justify-between p-4 text-left transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' }}>
                          {idx + 1}
                        </span>
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{section.title}</span>
                      </div>
                      {expandedSections.has(idx) ? (
                        <ChevronDown className="h-4 w-4" style={{ color: 'var(--color-muted)' }} />
                      ) : (
                        <ChevronRight className="h-4 w-4" style={{ color: 'var(--color-muted)' }} />
                      )}
                    </button>
                    {expandedSections.has(idx) && (
                      <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--color-border)' }}>
                        <div className="mt-3 text-sm whitespace-pre-line leading-relaxed" style={{ color: 'var(--color-text)' }}>
                          {section.content}
                        </div>
                        {section.framework_references.length > 0 && (
                          <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                            <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Framework References</p>
                            <div className="flex flex-wrap gap-1.5">
                              {section.framework_references.map((ref, ri) => (
                                <span key={ri} className="rounded px-2 py-0.5 text-[10px]" style={{ backgroundColor: 'var(--color-subtle)', color: 'var(--color-muted)' }}>
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
            <div key={charter.id} className="card p-6" style={charter.status === 'active' ? { borderColor: 'rgba(45, 106, 79, 0.3)' } : undefined}>
              {editingCharterId === charter.id ? (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>Title</label>
                    <input
                      type="text"
                      value={editCharterTitle}
                      onChange={(e) => setEditCharterTitle(e.target.value)}
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>Content</label>
                    <textarea
                      value={editCharterContent}
                      onChange={(e) => setEditCharterContent(e.target.value)}
                      rows={6}
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>Status</label>
                    <select
                      value={editCharterStatus}
                      onChange={(e) => setEditCharterStatus(e.target.value)}
                      className="input w-full"
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="expired">Expired</option>
                    </select>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setEditingCharterId(null)}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => updateCharterMutation.mutate({
                        charterId: charter.id,
                        data: { title: editCharterTitle, content: editCharterContent, status: editCharterStatus },
                      })}
                      disabled={updateCharterMutation.isPending || !editCharterTitle.trim()}
                      className="btn-primary flex items-center gap-2"
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
                        <h3 className="text-lg font-medium" style={{ color: 'var(--color-text)' }}>{charter.title}</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: STATUS_STYLES[charter.status]?.bg, color: STATUS_STYLES[charter.status]?.color }}>
                          {charter.status}
                        </span>
                      </div>
                      <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>Version {charter.version}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setAiError(null);
                          aiCompareMutation.mutate({ charter_id: charter.id });
                        }}
                        disabled={aiCompareMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all text-sm disabled:opacity-50"
                        style={{ backgroundColor: 'rgba(28, 43, 58, 0.06)', border: '1px solid rgba(28, 43, 58, 0.2)', color: 'var(--color-base)' }}
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
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm"
                          style={{ backgroundColor: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)' }}
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </button>
                      ) : null}
                      <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors cursor-pointer text-sm" style={{ backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
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
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-sm"
                        style={{ backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                        title="Edit charter"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this charter? This action cannot be undone.')) {
                            deleteCharterMutation.mutate(charter.id);
                          }
                        }}
                        disabled={deleteCharterMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-sm disabled:opacity-50"
                        style={{ backgroundColor: 'rgba(155, 28, 28, 0.05)', color: 'var(--color-danger)' }}
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
                  <p className="mt-4 line-clamp-2" style={{ color: 'var(--color-muted)' }}>{charter.content}</p>
                  
                  {charter.file_name && (
                    <div className="flex items-center gap-3 mt-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-subtle)' }}>
                      <Paperclip className="h-4 w-4" style={{ color: 'var(--color-base)' }} />
                      <div className="flex-1">
                        <p className="text-sm" style={{ color: 'var(--color-text)' }}>{charter.file_name}</p>
                        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          {charter.file_type?.toUpperCase()} {charter.file_size ? `• ${formatFileSize(charter.file_size)}` : ''}
                        </p>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-6 mt-4 text-sm" style={{ color: 'var(--color-muted)' }}>
                    <span>Effective: {new Date(charter.effective_date).toLocaleDateString()}</span>
                    {charter.approved_by && <span>Approved by: {charter.approved_by}</span>}
                  </div>
                </>
              )}
            </div>
          ))}

          {(!charters || charters.length === 0) && !showAiCharterPanel && (
            <div className="card p-12 text-center">
              <FileText className="h-12 w-12 mx-auto mb-4" style={{ color: 'var(--color-muted)' }} />
              <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--color-text)' }}>No Charters Yet</h3>
              <p className="mb-4" style={{ color: 'var(--color-muted)' }}>Generate a charter using AI based on your uploaded frameworks, or create one manually.</p>
              <button
                onClick={() => {
                  setAiError(null);
                  aiGenerateMutation.mutate();
                }}
                disabled={aiGenerateMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:from-purple-700 hover:to-indigo-700"
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
            <button onClick={() => setIsScheduleMeetingModalOpen(true)} className="btn-primary flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Schedule Meeting
            </button>
          </div>
          {(meetings || []).map((meeting) => (
            <Link key={meeting.id} href={`/governance/committees/meetings/${meeting.id}`} className="card p-6 block hover:border-primary-500/50 transition-all">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-medium" style={{ color: 'var(--color-text)' }}>{meeting.title}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: MEETING_TYPE_STYLES[meeting.meeting_type]?.bg, color: MEETING_TYPE_STYLES[meeting.meeting_type]?.color }}>
                      {MEETING_TYPE_STYLES[meeting.meeting_type]?.label}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: STATUS_STYLES[meeting.status]?.bg, color: STATUS_STYLES[meeting.status]?.color }}>
                      {meeting.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <Eye className="h-5 w-5" style={{ color: 'var(--color-muted)' }} />
              </div>
              <div className="flex items-center gap-6 mt-3 text-sm" style={{ color: 'var(--color-muted)' }}>
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
          {(actions || []).map((action) => (
            <div key={action.id} className="card p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-medium" style={{ color: 'var(--color-text)' }}>{action.title}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: STATUS_STYLES[action.status]?.bg, color: STATUS_STYLES[action.status]?.color }}>
                      {action.status.replace('_', ' ')}
                    </span>
                  </div>
                  {action.description && <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{action.description}</p>}
                </div>
              </div>
              <div className="flex items-center gap-6 mt-3 text-sm" style={{ color: 'var(--color-muted)' }}>
                <span>Due: {new Date(action.due_date).toLocaleDateString()}</span>
                {action.assigned_to_name && <span>Assigned to: {action.assigned_to_name}</span>}
                <span className="capitalize">{action.action_type.replace('_', ' ')}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showComparisonModal && comparisonResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="sticky top-0 p-6 z-10" style={{ backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg p-2.5" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
                    <ShieldCheck className="h-6 w-6" style={{ color: 'var(--color-base)' }} />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Charter Compliance Analysis</h2>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      {comparisonResult.frameworks_analyzed.length} frameworks, {comparisonResult.controls_analyzed} controls analyzed
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowComparisonModal(false)} style={{ color: 'var(--color-muted)' }}>
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="flex items-center gap-8 p-6 rounded-xl" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)' }}>
                <div className="relative h-28 w-28 shrink-0">
                  <svg className="h-28 w-28 -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="var(--color-border)" strokeWidth="10" />
                    <circle
                      cx="60" cy="60" r="50" fill="none"
                      stroke={getScoreRingColor(comparisonResult.comparison.overall_score)}
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={`${(comparisonResult.comparison.overall_score / 100) * 314} 314`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold" style={{ color: getScoreColor(comparisonResult.comparison.overall_score) }}>
                      {comparisonResult.comparison.overall_score}
                    </span>
                    <span className="text-[10px] uppercase" style={{ color: 'var(--color-muted)' }}>Score</span>
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Overall Assessment</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{comparisonResult.comparison.overall_assessment}</p>
                </div>
              </div>

              <div>
                <h3 className="text-base font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Section-by-Section Analysis</h3>
                <div className="space-y-2">
                  {comparisonResult.comparison.sections.map((section, idx) => (
                    <div key={idx} className="rounded-lg p-4" style={getStatusColor(section.status)}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(section.status)}
                          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{section.title}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold" style={{ color: getScoreColor(section.score) }}>{section.score}%</span>
                          <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}>
                            {section.status}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>{section.existing_content_summary}</p>
                      {section.recommendation && (
                        <div className="mt-2 p-2 rounded" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                          <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--color-base)' }}>Recommendation</p>
                          <p className="text-xs" style={{ color: 'var(--color-text)' }}>{section.recommendation}</p>
                        </div>
                      )}
                      {section.framework_requirements.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {section.framework_requirements.map((ref, ri) => (
                            <span key={ri} className="rounded px-1.5 py-0.5 text-[9px]" style={{ backgroundColor: 'var(--color-subtle)', color: 'var(--color-muted)' }}>
                              {ref}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {comparisonResult.comparison.gaps.length > 0 && (
                <div>
                  <h3 className="text-base font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                    <XCircle className="h-4 w-4" style={{ color: 'var(--color-danger)' }} />
                    Identified Gaps ({comparisonResult.comparison.gaps.length})
                  </h3>
                  <div className="space-y-2">
                    {comparisonResult.comparison.gaps.map((gap, idx) => (
                      <div key={idx} className="rounded-lg p-3 flex items-start gap-3" style={{ border: '1px solid rgba(155, 28, 28, 0.2)', backgroundColor: 'rgba(155, 28, 28, 0.03)' }}>
                        <span className="shrink-0 mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase" style={{
                          backgroundColor: gap.severity === 'high' ? 'rgba(155, 28, 28, 0.1)' : gap.severity === 'medium' ? 'rgba(146, 87, 14, 0.1)' : 'var(--color-subtle)',
                          color: gap.severity === 'high' ? 'var(--color-danger)' : gap.severity === 'medium' ? 'var(--color-warning)' : 'var(--color-muted)',
                        }}>
                          {gap.severity}
                        </span>
                        <div className="flex-1">
                          <p className="text-sm" style={{ color: 'var(--color-text)' }}>{gap.description}</p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {gap.frameworks.map((fw, fi) => (
                              <span key={fi} className="text-[9px]" style={{ color: 'var(--color-muted)' }}>{fw}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-2">
                {comparisonResult.comparison.strengths.length > 0 && (
                  <div>
                    <h3 className="text-base font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                      <CheckCircle className="h-4 w-4" style={{ color: 'var(--color-success)' }} />
                      Strengths
                    </h3>
                    <div className="space-y-1.5">
                      {comparisonResult.comparison.strengths.map((s, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                          <CheckCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: 'var(--color-success)' }} />
                          {s}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {comparisonResult.comparison.recommendations.length > 0 && (
                  <div>
                    <h3 className="text-base font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                      <Sparkles className="h-4 w-4" style={{ color: 'var(--color-base)' }} />
                      Recommendations
                    </h3>
                    <div className="space-y-1.5">
                      {comparisonResult.comparison.recommendations.map((r, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                          <span style={{ color: 'var(--color-base)' }} className="shrink-0">•</span>
                          {r}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {comparisonResult.comparison.framework_coverage && (
                <div>
                  <h3 className="text-base font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Framework Coverage</h3>
                  <div className="grid gap-3 md:grid-cols-3">
                    {comparisonResult.comparison.framework_coverage.addressed?.length > 0 && (
                      <div className="rounded-lg p-3" style={{ border: '1px solid rgba(45, 106, 79, 0.2)', backgroundColor: 'rgba(45, 106, 79, 0.03)' }}>
                        <p className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--color-success)' }}>Addressed</p>
                        {comparisonResult.comparison.framework_coverage.addressed.map((fw, i) => (
                          <p key={i} className="text-xs flex items-center gap-1.5 mb-1" style={{ color: 'var(--color-text)' }}>
                            <CheckCircle className="h-3 w-3" style={{ color: 'var(--color-success)' }} />
                            {fw}
                          </p>
                        ))}
                      </div>
                    )}
                    {comparisonResult.comparison.framework_coverage.partially_addressed?.length > 0 && (
                      <div className="rounded-lg p-3" style={{ border: '1px solid rgba(146, 87, 14, 0.2)', backgroundColor: 'rgba(146, 87, 14, 0.03)' }}>
                        <p className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--color-warning)' }}>Partially Addressed</p>
                        {comparisonResult.comparison.framework_coverage.partially_addressed.map((fw, i) => (
                          <p key={i} className="text-xs flex items-center gap-1.5 mb-1" style={{ color: 'var(--color-text)' }}>
                            <AlertTriangle className="h-3 w-3" style={{ color: 'var(--color-warning)' }} />
                            {fw}
                          </p>
                        ))}
                      </div>
                    )}
                    {comparisonResult.comparison.framework_coverage.not_addressed?.length > 0 && (
                      <div className="rounded-lg p-3" style={{ border: '1px solid rgba(155, 28, 28, 0.2)', backgroundColor: 'rgba(155, 28, 28, 0.03)' }}>
                        <p className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--color-danger)' }}>Not Addressed</p>
                        {comparisonResult.comparison.framework_coverage.not_addressed.map((fw, i) => (
                          <p key={i} className="text-xs flex items-center gap-1.5 mb-1" style={{ color: 'var(--color-text)' }}>
                            <XCircle className="h-3 w-3" style={{ color: 'var(--color-danger)' }} />
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

      {isAddMemberModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-xl p-6 w-full max-w-md mx-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Add Member</h2>
              <button onClick={() => setIsAddMemberModalOpen(false)} style={{ color: 'var(--color-muted)' }}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); addMemberMutation.mutate({ user_id: parseInt(newMember.user_id), role: newMember.role }); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>User ID *</label>
                <input
                  type="number"
                  value={newMember.user_id}
                  onChange={(e) => setNewMember({ ...newMember, user_id: e.target.value })}
                  className="input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Role</label>
                <select value={newMember.role} onChange={(e) => setNewMember({ ...newMember, role: e.target.value })} className="input w-full">
                  <option value="member">Member</option>
                  <option value="chair">Chair</option>
                  <option value="secretary">Secretary</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setIsAddMemberModalOpen(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={addMemberMutation.isPending} className="btn-primary">
                  {addMemberMutation.isPending ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isScheduleMeetingModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-xl p-6 w-full max-w-lg mx-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Schedule Meeting</h2>
              <button onClick={() => setIsScheduleMeetingModalOpen(false)} style={{ color: 'var(--color-muted)' }}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); createMeetingMutation.mutate(newMeeting); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Meeting Title *</label>
                <input type="text" value={newMeeting.title} onChange={(e) => setNewMeeting({ ...newMeeting, title: e.target.value })} className="input w-full" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Meeting Type</label>
                <select value={newMeeting.meeting_type} onChange={(e) => setNewMeeting({ ...newMeeting, meeting_type: e.target.value })} className="input w-full">
                  <option value="regular">Regular</option>
                  <option value="special">Special</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Date *</label>
                <input type="date" value={newMeeting.scheduled_date} onChange={(e) => setNewMeeting({ ...newMeeting, scheduled_date: e.target.value })} className="input w-full" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Start Time</label>
                  <input type="time" value={newMeeting.start_time} onChange={(e) => setNewMeeting({ ...newMeeting, start_time: e.target.value })} className="input w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>End Time</label>
                  <input type="time" value={newMeeting.end_time} onChange={(e) => setNewMeeting({ ...newMeeting, end_time: e.target.value })} className="input w-full" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Location</label>
                <input type="text" value={newMeeting.location} onChange={(e) => setNewMeeting({ ...newMeeting, location: e.target.value })} className="input w-full" placeholder="e.g., Boardroom A, Virtual" />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setIsScheduleMeetingModalOpen(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createMeetingMutation.isPending} className="btn-primary">
                  {createMeetingMutation.isPending ? 'Scheduling...' : 'Schedule Meeting'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
