'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { attestationApi, adminApi, governanceApi } from '@/lib/api';
import { MultiSelectDropdown, RightSlidePanel } from '@/components/ui';
import {
  ClipboardCheck,
  ArrowLeft,
  Play,
  XCircle,
  Download,
  Send,
  Calendar,
  CheckCircle,
  Clock,
  AlertCircle,
  BarChart3,
  Users,
  FileCheck,
  Mail,
  AlertTriangle,
  User,
  FileText,
  ExternalLink,
  Pencil,
  Plus,
  Trash2,
  Shield,
} from 'lucide-react';
import Link from 'next/link';

interface AttestationRequest {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  attestation_type: string;
  status: 'pending' | 'completed' | 'overdue' | 'escalated';
  completed_at?: string;
  due_date?: string;
  user_comments?: string;
  evidence_id?: number;
  is_overdue?: boolean;
  days_until_due?: number;
}

interface EscalationChainItem {
  id: number;
  tier: number;
  tier_name?: string;
  approver_id?: number;
  approver_name?: string;
  role_id?: number;
  role_name?: string;
  escalation_delay_days: number;
  notify_on_escalation: boolean;
}

interface Campaign {
  id: number;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'closed';
  campaign_type: string;
  attestation_text?: string;
  start_date?: string;
  due_date: string;
  total_requests: number;
  completed_requests: number;
  completion_rate: number;
  requires_evidence: boolean;
  linked_document_id?: number;
  linked_document_title?: string;
  escalation_enabled?: boolean;
  reminder_days_before?: number;
  escalation_days_after?: number;
  escalation_chains?: EscalationChainItem[];
  created_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700' },
  active: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  closed: { bg: 'bg-blue-100', text: 'text-blue-700' },
};

const REQUEST_STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  pending: { bg: 'bg-amber-50', text: 'text-amber-700', icon: Clock },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircle },
  overdue: { bg: 'bg-rose-50', text: 'text-rose-700', icon: AlertCircle },
  escalated: { bg: 'bg-purple-50', text: 'text-purple-700', icon: AlertTriangle },
};

export default function CampaignDetailPage() {
  const params = useParams();
  const campaignId = Number(params.id);
  const queryClient = useQueryClient();

  const [selectedRequests, setSelectedRequests] = useState<number[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Edit panel state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAttestationText, setEditAttestationText] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editRequiresEvidence, setEditRequiresEvidence] = useState(false);
  const [editEscalationEnabled, setEditEscalationEnabled] = useState(false);
  const [editReminderDays, setEditReminderDays] = useState(7);
  const [editEscalationDays, setEditEscalationDays] = useState(3);

  // Add escalation chain form state
  const [isAddingChain, setIsAddingChain] = useState(false);
  const [chainTargetType, setChainTargetType] = useState<'user' | 'role'>('role');
  const [chainTargetId, setChainTargetId] = useState<number | ''>('');
  const [chainDelayDays, setChainDelayDays] = useState(3);

  const openEdit = (c: Campaign) => {
    setEditName(c.name);
    setEditDescription(c.description || '');
    setEditAttestationText(c.attestation_text || '');
    setEditDueDate(c.due_date ? c.due_date.split('T')[0] : '');
    setEditRequiresEvidence(c.requires_evidence);
    setEditEscalationEnabled(c.escalation_enabled || false);
    setEditReminderDays(c.reminder_days_before ?? 7);
    setEditEscalationDays(c.escalation_days_after ?? 3);
    setIsEditOpen(true);
  };

  const { data: campaign, isLoading, error } = useQuery({
    queryKey: ['attestation-campaign', campaignId],
    queryFn: async () => {
      const response = await attestationApi.getCampaign(campaignId);
      return response.data as Campaign;
    },
  });

  const { data: requestsData } = useQuery({
    queryKey: ['attestation-campaign-requests', campaignId],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      try {
        const response = await attestationApi.getCampaignRequests(campaignId);
        return response.data as AttestationRequest[];
      } catch {
        return [] as AttestationRequest[];
      }
    },
    enabled: !!campaign,
  });

  // For escalation chain add form
  const { data: roles } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: async () => {
      const response = await adminApi.getRoles();
      return (response.data || []) as Array<{ id: number; name: string }>;
    },
    enabled: isAddingChain && chainTargetType === 'role',
  });

  const { data: allUsers } = useQuery({
    queryKey: ['admin-users-list'],
    queryFn: async () => {
      const response = await adminApi.getUsers();
      return (response.data || []) as Array<{ id: number; display_name: string; email: string }>;
    },
    enabled: isAddingChain && chainTargetType === 'user',
  });

  // For edit panel — linked document dropdown
  const { data: documents } = useQuery({
    queryKey: ['governance-documents-published'],
    queryFn: async () => {
      try {
        const response = await governanceApi.getDocuments({ status: 'published' });
        const raw = response.data as { items?: unknown[] } | unknown[];
        const items = Array.isArray(raw) ? raw : ((raw as { items?: unknown[] }).items ?? []);
        return items as Array<{ id: number; title: string }>;
      } catch {
        return [] as Array<{ id: number; title: string }>;
      }
    },
    enabled: isEditOpen,
  });

  const requests = requestsData ?? [];

  const activateMutation = useMutation({
    mutationFn: () => attestationApi.activateCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaign', campaignId] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => attestationApi.closeCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaign', campaignId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => attestationApi.updateCampaign(campaignId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaign', campaignId] });
      setIsEditOpen(false);
    },
  });

  const addChainMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => attestationApi.addEscalationChain(campaignId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaign', campaignId] });
      setIsAddingChain(false);
      setChainTargetId('');
      setChainDelayDays(3);
    },
  });

  const deleteChainMutation = useMutation({
    mutationFn: (chainId: number) => attestationApi.deleteEscalationChain(chainId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaign', campaignId] });
    },
  });

  const sendReminderMutation = useMutation({
    mutationFn: (requestId: number) => attestationApi.sendReminder(requestId),
    onSuccess: () => {
      alert('Reminder sent successfully');
    },
  });

  const escalateMutation = useMutation({
    mutationFn: (requestId: number) => attestationApi.escalateRequest(requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaign', campaignId] });
      alert('Request escalated');
    },
  });

  const handleSelectAll = (checked: boolean) => {
    setSelectedRequests(checked ? filteredRequests.map(r => r.id) : []);
  };

  const handleSelectRequest = (id: number, checked: boolean) => {
    setSelectedRequests(prev => checked ? [...prev, id] : prev.filter(rid => rid !== id));
  };

  const handleBulkReminder = () => {
    if (confirm(`Send reminders to ${selectedRequests.length} users?`)) {
      selectedRequests.forEach(id => sendReminderMutation.mutate(id));
      setSelectedRequests([]);
    }
  };

  const handleDownloadReport = async () => {
    try {
      const response = await attestationApi.exportCampaignReport(campaignId);
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attestation_campaign_${campaignId}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      alert('Failed to download report.');
    }
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      name: editName,
      description: editDescription || undefined,
      attestation_text: editAttestationText || undefined,
      due_date: editDueDate ? new Date(editDueDate).toISOString() : undefined,
      requires_evidence: editRequiresEvidence,
      escalation_enabled: editEscalationEnabled,
      reminder_days_before: editReminderDays,
      escalation_days_after: editEscalationDays,
    });
  };

  const handleAddChain = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chainTargetId) return;
    const nextTier = (campaign?.escalation_chains?.length ?? 0) + 1;
    addChainMutation.mutate({
      tier: nextTier,
      tier_name: `Tier ${nextTier}`,
      approver_id: chainTargetType === 'user' ? Number(chainTargetId) : undefined,
      role_id: chainTargetType === 'role' ? Number(chainTargetId) : undefined,
      escalation_delay_days: chainDelayDays,
      notify_on_escalation: true,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="skeleton h-8 w-64 mb-2" />
        <div className="skeleton h-5 w-96" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="card p-4">
              <div className="skeleton h-6 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="space-y-8">
        <Link href="/governance/attestations/campaigns" className="inline-flex items-center gap-2 text-gray-600 hover:text-black transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to Campaigns
        </Link>
        <div className="card p-12 text-center">
          <AlertCircle className="h-12 w-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-black mb-2">Campaign Not Found</h2>
          <p className="text-gray-500 mb-6">The campaign you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
          <Link href="/governance/attestations/campaigns" className="btn-primary inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Link>
        </div>
      </div>
    );
  }

  const statusStyle = STATUS_COLORS[campaign.status] || STATUS_COLORS.draft;
  const filteredRequests = requests.filter(r => !statusFilter || r.status === statusFilter);
  const pendingRequests = requests.filter(a => a.status === 'pending' || a.status === 'overdue');
  const chains = campaign.escalation_chains || [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/governance/attestations/campaigns" className="text-gray-500 hover:text-black">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-lg sm:text-xl font-semibold text-black">{campaign.name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                {campaign.status}
              </span>
            </div>
            <p className="text-gray-500 mt-1">{campaign.description || `${campaign.campaign_type?.replace(/_/g, ' ') ?? ''} attestation`}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Edit button — available for draft and active */}
            {campaign.status !== 'closed' && (
              <button
                onClick={() => openEdit(campaign)}
                className="btn-secondary flex items-center gap-2"
                title="Edit campaign"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </button>
            )}
            {campaign.status !== 'draft' && (
              <button
                onClick={handleDownloadReport}
                className="btn-secondary flex items-center gap-2"
                title="Download audit report"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            )}
            {campaign.status === 'draft' && (
              <button
                onClick={() => {
                  if (confirm('Activate this campaign? This will send attestation requests to all target users.')) {
                    activateMutation.mutate();
                  }
                }}
                className="btn-primary flex items-center gap-2"
                disabled={activateMutation.isPending}
              >
                <Play className="h-4 w-4" />
                Activate
              </button>
            )}
            {campaign.status === 'active' && (
              <button
                onClick={() => {
                  if (confirm('Close this campaign?')) {
                    closeMutation.mutate();
                  }
                }}
                className="btn-secondary flex items-center gap-2"
                disabled={closeMutation.isPending}
              >
                <XCircle className="h-4 w-4" />
                Close
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 mt-6">
          <div className="card p-4">
            <p className="text-gray-500 text-sm">Type</p>
            <p className="text-black font-medium capitalize">{campaign.campaign_type?.replace(/_/g, ' ') ?? '-'}</p>
          </div>
          <div className="card p-4">
            <p className="text-gray-500 text-sm">Due Date</p>
            <p className="text-black font-medium text-sm">
              {campaign.due_date ? new Date(campaign.due_date).toLocaleDateString() : '-'}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-gray-500 text-sm">Total Requests</p>
            <p className="text-black font-medium">{campaign.total_requests}</p>
          </div>
          <div className="card p-4">
            <p className="text-gray-500 text-sm">Completed</p>
            <p className="text-emerald-600 font-medium">{campaign.completed_requests}</p>
          </div>
          <div className="card p-4">
            <p className="text-gray-500 text-sm">Progress</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full"
                  style={{ width: `${campaign.completion_rate}%` }}
                />
              </div>
              <span className="text-black font-medium text-sm">{campaign.completion_rate.toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Attestation Statement */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-black flex items-center gap-2">
            <FileCheck className="h-5 w-5 text-primary-400" />
            Attestation Statement
          </h3>
        </div>
        {campaign.linked_document_id && (
          <div className="flex items-center justify-between p-3 mb-3 bg-primary-50 rounded-lg border border-primary-200">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary-500" />
              <span className="text-sm text-gray-700">{campaign.linked_document_title}</span>
            </div>
            <Link
              href={`/governance/documents/${campaign.linked_document_id}`}
              target="_blank"
              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              View Document
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )}
        <div className="bg-slate-50 rounded-lg p-4 border border-gray-200">
          <p className="text-gray-700">{campaign.attestation_text || 'No attestation text specified.'}</p>
        </div>
        {campaign.requires_evidence && (
          <p className="text-sm text-amber-600 mt-2 flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" />
            Evidence upload is required for this attestation
          </p>
        )}
      </div>

      {/* Escalation Chain Setup */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium text-black flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary-400" />
              Escalation Setup
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Define who gets notified when attestations are overdue
            </p>
          </div>
          {campaign.status !== 'closed' && !isAddingChain && (
            <button
              onClick={() => setIsAddingChain(true)}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Tier
            </button>
          )}
        </div>

        {/* Existing chains */}
        {chains.length > 0 ? (
          <div className="space-y-2 mb-4">
            {chains.map((chain) => (
              <div key={chain.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-gray-200">
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-500/10 text-xs font-bold text-primary-600">
                    {chain.tier}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-black">
                      {chain.tier_name || `Tier ${chain.tier}`}
                      {' → '}
                      <span className="font-normal text-gray-600">
                        {chain.approver_name || chain.role_name || 'Unknown'}
                      </span>
                    </p>
                    <p className="text-xs text-gray-400">
                      Escalate after {chain.escalation_delay_days} day{chain.escalation_delay_days !== 1 ? 's' : ''} overdue
                    </p>
                  </div>
                </div>
                {campaign.status !== 'closed' && (
                  <button
                    onClick={() => {
                      if (confirm('Remove this escalation tier?')) {
                        deleteChainMutation.mutate(chain.id);
                      }
                    }}
                    className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          !isAddingChain && (
            <p className="text-sm text-gray-400 mb-4">No escalation tiers configured. Add a tier to define who gets notified when attestations are overdue.</p>
          )
        )}

        {/* Add tier inline form */}
        {isAddingChain && (
          <form onSubmit={handleAddChain} className="p-4 bg-slate-50 rounded-lg border border-gray-200 space-y-3">
            <p className="text-sm font-medium text-black">Tier {chains.length + 1}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Escalate To</label>
                <select
                  className="input w-full text-sm"
                  value={chainTargetType}
                  onChange={(e) => { setChainTargetType(e.target.value as 'user' | 'role'); setChainTargetId(''); }}
                >
                  <option value="role">By Role</option>
                  <option value="user">Specific User</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Delay (days after due)</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  className="input w-full text-sm"
                  value={chainDelayDays}
                  onChange={(e) => setChainDelayDays(Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {chainTargetType === 'role' ? 'Role' : 'User'} <span className="text-rose-500">*</span>
              </label>
              <select
                className="input w-full text-sm"
                value={chainTargetId}
                onChange={(e) => setChainTargetId(e.target.value ? Number(e.target.value) : '')}
                required
              >
                <option value="">Select {chainTargetType === 'role' ? 'a role' : 'a user'}...</option>
                {chainTargetType === 'role'
                  ? (roles || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)
                  : (allUsers || []).map(u => <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>)
                }
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setIsAddingChain(false)} className="btn-secondary text-sm">
                Cancel
              </button>
              <button type="submit" className="btn-primary text-sm" disabled={addChainMutation.isPending || !chainTargetId}>
                {addChainMutation.isPending ? 'Adding...' : 'Add Tier'}
              </button>
            </div>
          </form>
        )}

        {/* Notification timing summary */}
        {(campaign.escalation_enabled || campaign.reminder_days_before) && (
          <div className="mt-3 flex items-center gap-4 text-xs text-gray-500 pt-3 border-t border-gray-200">
            {campaign.reminder_days_before && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Reminder: {campaign.reminder_days_before} days before due
              </span>
            )}
            {campaign.escalation_enabled && campaign.escalation_days_after && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                Auto-escalate: {campaign.escalation_days_after} days after due
              </span>
            )}
          </div>
        )}
      </div>

      {/* Attestation Requests Table */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-black flex items-center gap-2">
            <Users className="h-5 w-5 text-primary-400" />
            Attestation Requests ({filteredRequests.length})
          </h3>
          <div className="flex items-center gap-3">
            <MultiSelectDropdown
              title="Status"
              items={[
                { value: 'pending', label: 'Pending' },
                { value: 'completed', label: 'Completed' },
                { value: 'overdue', label: 'Overdue' },
                { value: 'escalated', label: 'Escalated' },
              ]}
              selectedValues={statusFilter ? [statusFilter] : []}
              onApply={(vals) => setStatusFilter(vals[0] || '')}
              multiSelect={false}
            />
            {selectedRequests.length > 0 && (
              <button
                onClick={handleBulkReminder}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                <Mail className="h-4 w-4" />
                Send Reminder ({selectedRequests.length})
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4">
                  <input
                    type="checkbox"
                    checked={selectedRequests.length === filteredRequests.length && filteredRequests.length > 0}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                  />
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">User</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Type</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Completed</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Evidence</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-400 text-sm">
                    {campaign.status === 'draft' ? 'Activate the campaign to generate attestation requests.' : 'No requests match the current filter.'}
                  </td>
                </tr>
              ) : (
                filteredRequests.map((request) => {
                  const rstyle = REQUEST_STATUS_COLORS[request.status] || REQUEST_STATUS_COLORS.pending;
                  const StatusIcon = rstyle.icon;

                  return (
                    <tr key={request.id} className="border-b border-gray-100 hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={selectedRequests.includes(request.id)}
                          onChange={(e) => handleSelectRequest(request.id, e.target.checked)}
                          className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-gray-400" />
                          <div>
                            <p className="text-black font-medium">{request.user_name}</p>
                            <p className="text-xs text-gray-500">{request.user_email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-600 text-sm capitalize">
                        {request.attestation_type?.replace(/_/g, ' ') ?? '-'}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 ${rstyle.bg} ${rstyle.text}`}>
                          <StatusIcon className="h-3 w-3" />
                          {request.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-500">
                        {request.completed_at ? new Date(request.completed_at).toLocaleDateString() : '-'}
                      </td>
                      <td className="py-3 px-4">
                        {request.evidence_id ? (
                          <span className="text-emerald-600 text-sm">Yes</span>
                        ) : (
                          <span className="text-gray-400 text-sm">No</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          {(request.status === 'pending' || request.status === 'overdue') && (
                            <>
                              <button
                                onClick={() => sendReminderMutation.mutate(request.id)}
                                className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded"
                                title="Send Reminder"
                              >
                                <Send className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm('Escalate this request to management?')) {
                                    escalateMutation.mutate(request.id);
                                  }
                                }}
                                className="p-1.5 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded"
                                title="Escalate"
                              >
                                <AlertTriangle className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="text-lg font-medium text-black mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary-400" />
            Status Summary
          </h3>
          <div className="space-y-3">
            {Object.entries(REQUEST_STATUS_COLORS).map(([st, style]) => {
              const count = requests.filter(a => a.status === st).length;
              const StatusIcon = style.icon;
              return (
                <div key={st} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusIcon className={`h-4 w-4 ${style.text}`} />
                    <span className="text-gray-700 capitalize">{st}</span>
                  </div>
                  <span className={`font-medium ${style.text}`}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-6">
          <h3 className="text-lg font-medium text-black mb-4 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Pending Actions
          </h3>
          {pendingRequests.length > 0 ? (
            <div className="space-y-3">
              {pendingRequests.slice(0, 5).map((request) => (
                <div key={request.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-gray-200">
                  <div className="flex items-center gap-3">
                    <User className="h-4 w-4 text-gray-400" />
                    <div>
                      <p className="text-black text-sm">{request.user_name}</p>
                      <p className="text-xs text-gray-500">{request.user_email}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${REQUEST_STATUS_COLORS[request.status]?.bg} ${REQUEST_STATUS_COLORS[request.status]?.text}`}>
                    {request.status}
                  </span>
                </div>
              ))}
              {pendingRequests.length > 5 && (
                <p className="text-sm text-gray-500 text-center">+ {pendingRequests.length - 5} more</p>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">All attestations completed</p>
          )}
        </div>
      </div>

      {/* Edit Campaign Panel */}
      <RightSlidePanel
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title="Edit Campaign"
        width="w-full max-w-lg"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name <span className="text-rose-500">*</span></label>
            <input
              type="text"
              className="input w-full"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              className="input w-full"
              rows={2}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Attestation Text</label>
            <textarea
              className="input w-full"
              rows={3}
              value={editAttestationText}
              onChange={(e) => setEditAttestationText(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
            <input
              type="date"
              className="input w-full"
              value={editDueDate}
              onChange={(e) => setEditDueDate(e.target.value)}
            />
          </div>

          {/* Notification & Escalation settings */}
          <div className="p-3 bg-slate-50 rounded-lg border border-gray-200 space-y-3">
            <p className="text-sm font-medium text-gray-700">Notification & Escalation</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reminder (days before due)</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  className="input w-full text-sm"
                  value={editReminderDays}
                  onChange={(e) => setEditReminderDays(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Auto-escalate (days after due)</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  className="input w-full text-sm"
                  value={editEscalationDays}
                  onChange={(e) => setEditEscalationDays(Number(e.target.value))}
                />
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editEscalationEnabled}
                onChange={(e) => setEditEscalationEnabled(e.target.checked)}
                className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Enable automatic escalation</span>
            </label>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={editRequiresEvidence}
              onChange={(e) => setEditRequiresEvidence(e.target.checked)}
              className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Require evidence upload</span>
          </label>

          {updateMutation.isError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
              Failed to update campaign. Please try again.
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setIsEditOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </RightSlidePanel>
    </div>
  );
}
