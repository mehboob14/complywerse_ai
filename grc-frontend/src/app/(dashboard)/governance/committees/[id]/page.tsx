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
        <Link href="/governance/committees" className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to Committees
        </Link>
        <div className="card p-12 text-center">
          <AlertCircle className="h-12 w-12 text-rose-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Committee Not Found</h2>
          <p className="text-slate-400 mb-6">The committee you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
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

  return (
    <div className="space-y-8">
      <div>
        <Link href="/governance/committees" className="flex items-center gap-2 text-slate-400 hover:text-white mb-4">
          <ArrowLeft className="h-4 w-4" />
          Back to Committees
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary-500/20">
              <Users className="h-7 w-7 text-primary-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-white">{committee?.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className={`text-xs px-2 py-0.5 rounded-full ${typeStyle.bg} ${typeStyle.text}`}>
                  {typeStyle.label}
                </span>
                <span className="text-slate-400">{committee?.member_count} members</span>
                {committee?.meeting_frequency && (
                  <span className="text-slate-400 capitalize">• {committee.meeting_frequency.replace('_', ' ')} meetings</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-800 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-primary-600 text-white'
                : 'text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-6">
            <h3 className="text-lg font-medium text-white mb-4">Committee Details</h3>
            <div className="space-y-3">
              <div>
                <span className="text-slate-500 text-sm">Description</span>
                <p className="text-slate-300">{committee?.description || 'No description provided'}</p>
              </div>
              {committee?.chair_name && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Chair</span>
                  <span className="text-slate-300">{committee.chair_name}</span>
                </div>
              )}
              {committee?.secretary_name && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Secretary</span>
                  <span className="text-slate-300">{committee.secretary_name}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Created</span>
                <span className="text-slate-300">{new Date(committee?.created_at || '').toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {activeCharter && (
            <div className="card p-6">
              <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary-400" />
                Active Charter
              </h3>
              <div className="space-y-3">
                <p className="text-slate-300 font-medium">{activeCharter.title}</p>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Version</span>
                  <span className="text-slate-300">{activeCharter.version}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Effective Date</span>
                  <span className="text-slate-300">{new Date(activeCharter.effective_date).toLocaleDateString()}</span>
                </div>
                {activeCharter.approved_by && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Approved By</span>
                    <span className="text-slate-300">{activeCharter.approved_by}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-white flex items-center gap-2">
                <Calendar className="h-5 w-5 text-cyan-400" />
                Upcoming Meetings
              </h3>
              <button onClick={() => setIsScheduleMeetingModalOpen(true)} className="text-primary-400 hover:text-primary-300 text-sm">
                Schedule New
              </button>
            </div>
            <div className="space-y-3">
              {(meetings || []).filter(m => m.status === 'scheduled').slice(0, 3).map((meeting) => (
                <Link key={meeting.id} href={`/governance/committees/meetings/${meeting.id}`} className="block p-3 rounded-lg bg-slate-800/50 hover:bg-slate-700/50">
                  <div className="flex items-center justify-between">
                    <span className="text-white font-medium">{meeting.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${MEETING_TYPE_LABELS[meeting.meeting_type]?.bg} ${MEETING_TYPE_LABELS[meeting.meeting_type]?.text}`}>
                      {MEETING_TYPE_LABELS[meeting.meeting_type]?.label}
                    </span>
                  </div>
                  <div className="text-sm text-slate-400 mt-1">
                    {new Date(meeting.scheduled_date).toLocaleDateString()} {meeting.start_time && `at ${meeting.start_time}`}
                  </div>
                </Link>
              ))}
              {(meetings || []).filter(m => m.status === 'scheduled').length === 0 && (
                <p className="text-slate-500 text-sm">No upcoming meetings</p>
              )}
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-white flex items-center gap-2">
                <CheckSquare className="h-5 w-5 text-amber-400" />
                Open Actions
              </h3>
              <Link href="/governance/committees/actions" className="text-primary-400 hover:text-primary-300 text-sm">
                View All
              </Link>
            </div>
            <div className="space-y-3">
              {(actions || []).filter(a => a.status !== 'completed').slice(0, 3).map((action) => (
                <div key={action.id} className="p-3 rounded-lg bg-slate-800/50">
                  <div className="flex items-center justify-between">
                    <span className="text-white font-medium">{action.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[action.status]?.bg} ${STATUS_COLORS[action.status]?.text}`}>
                      {action.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-sm text-slate-400 mt-1">
                    Due: {new Date(action.due_date).toLocaleDateString()}
                    {action.assigned_to_name && ` • ${action.assigned_to_name}`}
                  </div>
                </div>
              ))}
              {(actions || []).filter(a => a.status !== 'completed').length === 0 && (
                <p className="text-slate-500 text-sm">No open actions</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'members' && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-white">Committee Members</h3>
            <button onClick={() => setIsAddMemberModalOpen(true)} className="btn-primary flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Add Member
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Name</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Email</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Role</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Joined</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(members || []).map((member) => (
                  <tr key={member.id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                    <td className="py-3 px-4 text-white">{member.user_name}</td>
                    <td className="py-3 px-4 text-slate-400">{member.user_email}</td>
                    <td className="py-3 px-4">
                      <span className="capitalize text-slate-300">{member.role}</span>
                    </td>
                    <td className="py-3 px-4 text-slate-400">{new Date(member.joined_at).toLocaleDateString()}</td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => removeMemberMutation.mutate(member.user_id)}
                        className="text-rose-400 hover:text-rose-300"
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
          {(charters || []).map((charter) => (
            <div key={charter.id} className={`card p-6 ${charter.status === 'active' ? 'border-emerald-500/30' : ''}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-medium text-white">{charter.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[charter.status]?.bg} ${STATUS_COLORS[charter.status]?.text}`}>
                      {charter.status}
                    </span>
                  </div>
                  <p className="text-slate-400 text-sm mt-1">Version {charter.version}</p>
                </div>
                <div className="flex items-center gap-2">
                  {charter.file_name ? (
                    <button
                      onClick={() => handleDownloadFile(charter.id, charter.file_name!)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors text-sm"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </button>
                  ) : null}
                  <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors cursor-pointer text-sm">
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
                </div>
              </div>
              <p className="text-slate-400 mt-4 line-clamp-2">{charter.content}</p>
              
              {charter.file_name && (
                <div className="flex items-center gap-3 mt-4 p-3 bg-slate-800/50 rounded-lg">
                  <Paperclip className="h-4 w-4 text-primary-400" />
                  <div className="flex-1">
                    <p className="text-sm text-white">{charter.file_name}</p>
                    <p className="text-xs text-slate-500">
                      {charter.file_type?.toUpperCase()} {charter.file_size ? `• ${formatFileSize(charter.file_size)}` : ''}
                    </p>
                  </div>
                </div>
              )}
              
              <div className="flex items-center gap-6 mt-4 text-sm text-slate-500">
                <span>Effective: {new Date(charter.effective_date).toLocaleDateString()}</span>
                {charter.approved_by && <span>Approved by: {charter.approved_by}</span>}
              </div>
            </div>
          ))}
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
                    <h3 className="text-lg font-medium text-white">{meeting.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${MEETING_TYPE_LABELS[meeting.meeting_type]?.bg} ${MEETING_TYPE_LABELS[meeting.meeting_type]?.text}`}>
                      {MEETING_TYPE_LABELS[meeting.meeting_type]?.label}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[meeting.status]?.bg} ${STATUS_COLORS[meeting.status]?.text}`}>
                      {meeting.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <Eye className="h-5 w-5 text-slate-400" />
              </div>
              <div className="flex items-center gap-6 mt-3 text-sm text-slate-400">
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
                    <h3 className="text-lg font-medium text-white">{action.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[action.status]?.bg} ${STATUS_COLORS[action.status]?.text}`}>
                      {action.status.replace('_', ' ')}
                    </span>
                  </div>
                  {action.description && <p className="text-slate-400 text-sm mt-1">{action.description}</p>}
                </div>
              </div>
              <div className="flex items-center gap-6 mt-3 text-sm text-slate-400">
                <span>Due: {new Date(action.due_date).toLocaleDateString()}</span>
                {action.assigned_to_name && <span>Assigned to: {action.assigned_to_name}</span>}
                <span className="capitalize">{action.action_type.replace('_', ' ')}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAddMemberModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md mx-4 border border-slate-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white">Add Member</h2>
              <button onClick={() => setIsAddMemberModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); addMemberMutation.mutate({ user_id: parseInt(newMember.user_id), role: newMember.role }); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">User ID *</label>
                <input
                  type="number"
                  value={newMember.user_id}
                  onChange={(e) => setNewMember({ ...newMember, user_id: e.target.value })}
                  className="input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Role</label>
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
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-lg mx-4 border border-slate-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white">Schedule Meeting</h2>
              <button onClick={() => setIsScheduleMeetingModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); createMeetingMutation.mutate(newMeeting); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Meeting Title *</label>
                <input type="text" value={newMeeting.title} onChange={(e) => setNewMeeting({ ...newMeeting, title: e.target.value })} className="input w-full" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Meeting Type</label>
                <select value={newMeeting.meeting_type} onChange={(e) => setNewMeeting({ ...newMeeting, meeting_type: e.target.value })} className="input w-full">
                  <option value="regular">Regular</option>
                  <option value="special">Special</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Date *</label>
                <input type="date" value={newMeeting.scheduled_date} onChange={(e) => setNewMeeting({ ...newMeeting, scheduled_date: e.target.value })} className="input w-full" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Start Time</label>
                  <input type="time" value={newMeeting.start_time} onChange={(e) => setNewMeeting({ ...newMeeting, start_time: e.target.value })} className="input w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">End Time</label>
                  <input type="time" value={newMeeting.end_time} onChange={(e) => setNewMeeting({ ...newMeeting, end_time: e.target.value })} className="input w-full" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Location</label>
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
