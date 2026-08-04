'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { attestationApi, governanceApi, adminApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { SearchInput, MultiSelectDropdown, RightSlidePanel } from '@/components/ui';
import {
  ClipboardCheck,
  Plus,
  Eye,
  Play,
  XCircle,
  Trash2,
  Calendar,
  Users,
  CheckCircle,
  Clock,
  FileCheck,
  FileText,
} from 'lucide-react';
import Link from 'next/link';

interface Campaign {
  id: number;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'closed';
  campaign_type: string;
  start_date: string;
  due_date: string;
  total_requests: number;
  completed_requests: number;
  completion_rate: number;
  created_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-700', icon: FileCheck },
  active: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: Play },
  closed: { bg: 'bg-slate-100', text: 'text-slate-600', icon: CheckCircle },
};

const ATTESTATION_TYPES = [
  { value: 'sox_302', label: 'SOX 302 Certification' },
  { value: 'sox_404', label: 'SOX 404 Certification' },
  { value: 'policy_signoff', label: 'Policy Sign-Off' },
  { value: 'bcp_awareness', label: 'BCP Awareness' },
  { value: 'training_acknowledgment', label: 'Training Acknowledgment' },
  { value: 'annual_certification', label: 'Annual Certification' },
];

export default function AttestationCampaignsPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:attestations:create');
  const canDelete = hasPermission('governance:attestations:delete');
  const searchParams = useSearchParams();
  const showNewModal = searchParams.get('action') === 'new';

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(showNewModal);
  const queryClient = useQueryClient();

  // Create form state
  const [formLinkedDocId, setFormLinkedDocId] = useState<number | null>(null);
  const [formTargetType, setFormTargetType] = useState<string>('all_users');
  const [formTargetRoleIds, setFormTargetRoleIds] = useState<number[]>([]);
  const [formTargetUserIds, setFormTargetUserIds] = useState<number[]>([]);
  const [formAttestationText, setFormAttestationText] = useState<string>('');

  const closeModal = () => {
    setIsModalOpen(false);
    setFormLinkedDocId(null);
    setFormTargetType('all_users');
    setFormTargetRoleIds([]);
    setFormTargetUserIds([]);
    setFormAttestationText('');
  };

  const { data: campaigns, isLoading, isError } = useQuery({
    queryKey: ['attestation-campaigns', statusFilter],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await attestationApi.getCampaigns({ status: statusFilter || undefined });
      return response.data as Campaign[];
    },
  });

  // Fetch governance documents for linking (all non-retired/archived)
  const { data: documents } = useQuery({
    queryKey: ['governance-documents-for-attestation'],
    queryFn: async () => {
      try {
        const response = await governanceApi.getDocuments({ limit: 200 });
        const raw = response.data as { items?: unknown[] } | unknown[];
        const items = Array.isArray(raw) ? raw : ((raw as { items?: unknown[] }).items ?? []);
        // Filter out retired/archived on the client side
        const docs = (items as Array<{ id: number; title: string; document_type: string; status?: string }>)
          .filter(d => d.status !== 'retired' && d.status !== 'archived');
        return docs;
      } catch {
        return [] as Array<{ id: number; title: string; document_type: string }>;
      }
    },
    enabled: isModalOpen,
  });

  // Prefetch roles and users as soon as the modal opens so they're ready instantly
  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: async () => {
      try {
        const response = await adminApi.getRoles();
        return (response.data || []) as Array<{ id: number; name: string }>;
      } catch {
        return [] as Array<{ id: number; name: string }>;
      }
    },
    enabled: isModalOpen,
  });

  const { data: allUsers, isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users-list'],
    queryFn: async () => {
      try {
        const response = await adminApi.getUsers();
        return (response.data || []) as Array<{ id: number; display_name: string; email: string }>;
      } catch {
        return [] as Array<{ id: number; display_name: string; email: string }>;
      }
    },
    enabled: isModalOpen,
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => attestationApi.createCampaign(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaigns'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => attestationApi.deleteCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaigns'] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => attestationApi.activateCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaigns'] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: (id: number) => attestationApi.closeCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaigns'] });
    },
  });

  const allCampaigns = campaigns || [];
  const filteredCampaigns = allCampaigns.filter(campaign => {
    const matchesSearch = campaign.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (campaign.description?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  // KPI strip — derived from already-fetched campaigns
  const totalCampaigns = allCampaigns.length;
  const activeCampaigns = allCampaigns.filter(c => c.status === 'active').length;
  const draftCampaigns = allCampaigns.filter(c => c.status === 'draft').length;
  const pendingRequestsTotal = allCampaigns.reduce(
    (sum, c) => sum + Math.max((c.total_requests || 0) - (c.completed_requests || 0), 0),
    0,
  );

  const handleDocumentSelect = (docId: number) => {
    setFormLinkedDocId(docId);
    if (docId) {
      const doc = (documents || []).find(d => d.id === docId);
      if (doc && !formAttestationText) {
        setFormAttestationText(
          `I acknowledge that I have read, understood, and agree to comply with the ${doc.title}.`
        );
      }
    } else {
      setFormLinkedDocId(null);
    }
  };

  const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const payload: Record<string, unknown> = {
      name: formData.get('name') as string,
      description: (formData.get('description') as string) || undefined,
      campaign_type: formData.get('attestation_type') as string,
      attestation_text: formAttestationText || undefined,
      start_date: new Date(formData.get('start_date') as string).toISOString(),
      due_date: new Date(formData.get('end_date') as string).toISOString(),
      requires_evidence: formData.get('requires_evidence') === 'on',
      target_type: formTargetType,
      linked_document_id: formLinkedDocId || undefined,
    };

    if (formTargetType === 'by_role' && formTargetRoleIds.length > 0) {
      payload.target_role_ids = formTargetRoleIds;
    } else if (formTargetType === 'custom' && formTargetUserIds.length > 0) {
      payload.target_user_ids = formTargetUserIds;
    }

    createMutation.mutate(payload);
  };

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="page-header">
          <div className="skeleton h-8 w-48 mb-2" />
          <div className="skeleton h-5 w-80" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card p-6">
              <div className="skeleton h-6 w-3/4 mb-2" />
              <div className="skeleton h-4 w-full mb-4" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Attestation Campaigns</h1>
          <p className="mt-1 text-slate-600">Manage attestation and certification campaigns</p>
        </div>
      </div>

      {/* KPI / status strip */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="card p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-primary-50">
              <ClipboardCheck className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{totalCampaigns}</p>
              <p className="text-xs text-slate-500">Total Campaigns</p>
            </div>
          </div>
        </div>
        <div className="card p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-emerald-50">
              <Play className="h-4 w-4 text-emerald-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{activeCampaigns}</p>
              <p className="text-xs text-slate-500">Active</p>
            </div>
          </div>
        </div>
        <div className="card p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-100">
              <FileCheck className="h-4 w-4 text-slate-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{draftCampaigns}</p>
              <p className="text-xs text-slate-500">Draft</p>
            </div>
          </div>
        </div>
        <div className="card p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-amber-50">
              <Clock className="h-4 w-4 text-amber-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{pendingRequestsTotal}</p>
              <p className="text-xs text-slate-500">Pending Requests</p>
            </div>
          </div>
        </div>
      </div>

      {isError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 flex items-center gap-2 text-sm text-rose-700">
          <XCircle className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
          Unable to load campaigns. Please retry.
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <MultiSelectDropdown
          title="Status"
          items={[
            { value: 'draft', label: 'Draft' },
            { value: 'active', label: 'Active' },
            { value: 'closed', label: 'Closed' },
          ]}
          selectedValues={statusFilter ? [statusFilter] : []}
          onApply={(vals) => setStatusFilter(vals[0] || '')}
          multiSelect={false}
        />
        <div className="flex-1">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search campaigns..."
            size="md"
          />
        </div>
        {canCreate && (
        <button
          onClick={() => setIsModalOpen(true)}
          className="btn-primary flex items-center gap-2 whitespace-nowrap"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          New Campaign
        </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredCampaigns.map((campaign) => {
          const statusStyle = STATUS_COLORS[campaign.status] || STATUS_COLORS.draft;
          const StatusIcon = statusStyle.icon;
          const pendingRequests = campaign.total_requests - campaign.completed_requests;

          return (
            <div key={campaign.id} className="card p-4 hover:border-primary-500/50 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500/20 flex-shrink-0">
                    <ClipboardCheck className="h-4 w-4 text-primary-400" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-black font-medium text-sm truncate">{campaign.name}</h3>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${statusStyle.bg} ${statusStyle.text}`}>
                      <StatusIcon className="h-3 w-3" />
                      {campaign.status}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-gray-500 text-xs mb-3 line-clamp-2">
                {campaign.description || `${campaign.campaign_type?.replace(/_/g, ' ') ?? ''} attestation`}
              </p>

              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(campaign.due_date).toLocaleDateString()}
                  </span>
                  <span className="text-gray-500 flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {campaign.completed_requests}/{campaign.total_requests}
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-500">Progress</span>
                    <span className="text-black font-medium">{campaign.completion_rate}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${campaign.completion_rate === 100 ? 'bg-emerald-500' : 'bg-primary-500'}`}
                      style={{ width: `${campaign.completion_rate}%` }}
                    />
                  </div>
                </div>

                {pendingRequests > 0 && campaign.status === 'active' && (
                  <div className="flex items-center gap-1 text-amber-600 text-xs">
                    <Clock className="h-3.5 w-3.5" />
                    {pendingRequests} pending
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-4 border-t border-gray-200">
                <Link
                  href={`/governance/attestations/campaigns/${campaign.id}`}
                  className="flex-1 btn-secondary text-center text-sm py-1.5 flex items-center justify-center gap-1"
                >
                  <Eye className="h-4 w-4" />
                  View
                </Link>

                {campaign.status === 'draft' && (
                  <button
                    onClick={() => {
                      if (confirm('Activate this campaign? This will send attestation requests to all target users.')) {
                        activateMutation.mutate(campaign.id);
                      }
                    }}
                    className="p-1.5 text-gray-600 hover:text-emerald-700 hover:bg-emerald-100 rounded"
                    title="Activate Campaign"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                )}

                {campaign.status === 'active' && (
                  <button
                    onClick={() => {
                      if (confirm('Close this campaign?')) {
                        closeMutation.mutate(campaign.id);
                      }
                    }}
                    className="p-1.5 text-gray-600 hover:text-blue-700 hover:bg-blue-100 rounded"
                    title="Close Campaign"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                )}

                {campaign.status === 'draft' && canDelete && (
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this campaign?')) {
                        deleteMutation.mutate(campaign.id);
                      }
                    }}
                    className="p-1.5 text-gray-600 hover:text-rose-700 hover:bg-rose-100 rounded"
                    title="Delete Campaign"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filteredCampaigns.length === 0 && (
        <div className="card p-12 text-center">
          <ClipboardCheck className="h-12 w-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-black mb-2">No Campaigns Found</h3>
          <p className="text-gray-600 mb-4">
            {searchTerm || statusFilter
              ? 'No campaigns match your filters'
              : 'Create your first attestation campaign to get started'}
          </p>
          {canCreate && (
          <button onClick={() => setIsModalOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4 mr-2" />
            Create Campaign
          </button>
          )}
        </div>
      )}

      <RightSlidePanel
        isOpen={isModalOpen}
        onClose={closeModal}
        title="Create New Campaign"
        width="w-full max-w-lg"
      >
        <form onSubmit={handleCreateSubmit}>
          <div className="space-y-5">

            {/* Basic Info */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name <span className="text-rose-500">*</span></label>
              <input
                type="text"
                name="name"
                className="input w-full"
                required
                placeholder="e.g., Q1 2026 Policy Attestation"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                name="description"
                className="input w-full"
                rows={2}
                placeholder="Brief description of this campaign"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Attestation Type <span className="text-rose-500">*</span></label>
              <select name="attestation_type" className="input w-full" required>
                <option value="">Select type</option>
                {ATTESTATION_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            {/* Linked Governance Document */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <span className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-primary-500" />
                  Link Governance Document
                  <span className="text-xs text-gray-400 font-normal">(optional)</span>
                </span>
              </label>
              <select
                className="input w-full"
                value={formLinkedDocId ?? ''}
                onChange={(e) => handleDocumentSelect(e.target.value ? Number(e.target.value) : 0)}
              >
                <option value="">— Select a policy/procedure document —</option>
                {(documents || []).map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    [{doc.document_type}] {doc.title}
                  </option>
                ))}
              </select>
              {(documents || []).length === 0 && !isModalOpen && null}
              {isModalOpen && (documents || []).length === 0 && (
                <p className="text-xs text-gray-400 mt-1">No documents available yet.</p>
              )}
              {formLinkedDocId && (
                <p className="text-xs text-primary-600 mt-1">
                  Attestation text has been auto-filled from the document. You can edit it below.
                </p>
              )}
            </div>

            {/* Attestation Text */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Attestation Text
                {!formLinkedDocId && <span className="text-rose-500"> *</span>}
              </label>
              <textarea
                className="input w-full"
                rows={4}
                required={!formLinkedDocId}
                value={formAttestationText}
                onChange={(e) => setFormAttestationText(e.target.value)}
                placeholder={
                  formLinkedDocId
                    ? 'Auto-generated from selected document. Edit if needed...'
                    : 'Enter the statement that users must acknowledge...'
                }
              />
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date <span className="text-rose-500">*</span></label>
                <input
                  type="date"
                  name="start_date"
                  className="input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Due Date <span className="text-rose-500">*</span></label>
                <input
                  type="date"
                  name="end_date"
                  className="input w-full"
                  required
                />
              </div>
            </div>

            {/* Target Audience */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-primary-500" />
                  Target Audience <span className="text-rose-500">*</span>
                </span>
              </label>
              <div className="space-y-2 p-3 bg-slate-50 rounded-lg border border-gray-200">
                {[
                  { value: 'all_users', label: 'All Users', desc: 'Every active user in the system' },
                  { value: 'by_role', label: 'By Role', desc: 'Users with specific roles' },
                  { value: 'custom', label: 'Custom', desc: 'Specific individuals' },
                ].map((opt) => (
                  <label key={opt.value} className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="target_type_radio"
                      value={opt.value}
                      checked={formTargetType === opt.value}
                      onChange={() => {
                        setFormTargetType(opt.value);
                        setFormTargetRoleIds([]);
                        setFormTargetUserIds([]);
                      }}
                      className="mt-0.5 text-primary-500 focus:ring-primary-500"
                    />
                    <div>
                      <p className="text-sm text-black font-medium">{opt.label}</p>
                      <p className="text-xs text-gray-500">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>

              {/* By Role — multi-select */}
              {formTargetType === 'by_role' && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Select Roles <span className="text-rose-500">*</span></label>
                  <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1 bg-white">
                    {rolesLoading ? (
                      <p className="text-xs text-gray-400 p-2">Loading roles...</p>
                    ) : (roles || []).length === 0 ? (
                      <p className="text-xs text-gray-400 p-2">No roles found.</p>
                    ) : (
                      (roles || []).map((role) => (
                        <label key={role.id} className="flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formTargetRoleIds.includes(role.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormTargetRoleIds([...formTargetRoleIds, role.id]);
                              } else {
                                setFormTargetRoleIds(formTargetRoleIds.filter(id => id !== role.id));
                              }
                            }}
                            className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                          />
                          <span className="text-sm text-black">{role.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                  {formTargetRoleIds.length > 0 && (
                    <p className="text-xs text-primary-600 mt-1">{formTargetRoleIds.length} role(s) selected</p>
                  )}
                </div>
              )}

              {/* Custom — user multi-select */}
              {formTargetType === 'custom' && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Select Users <span className="text-rose-500">*</span></label>
                  <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1 bg-white">
                    {usersLoading ? (
                      <p className="text-xs text-gray-400 p-2">Loading users...</p>
                    ) : (allUsers || []).length === 0 ? (
                      <p className="text-xs text-gray-400 p-2">No users found.</p>
                    ) : (
                      (allUsers || []).map((user) => (
                        <label key={user.id} className="flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formTargetUserIds.includes(user.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormTargetUserIds([...formTargetUserIds, user.id]);
                              } else {
                                setFormTargetUserIds(formTargetUserIds.filter(id => id !== user.id));
                              }
                            }}
                            className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                          />
                          <div>
                            <p className="text-sm text-black">{user.display_name}</p>
                            <p className="text-xs text-gray-400">{user.email}</p>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                  {formTargetUserIds.length > 0 && (
                    <p className="text-xs text-primary-600 mt-1">{formTargetUserIds.length} user(s) selected</p>
                  )}
                </div>
              )}
            </div>

            {/* Options */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                name="requires_evidence"
                id="requires_evidence"
                className="rounded border-gray-300 bg-white text-primary-500 focus:ring-primary-500"
              />
              <label htmlFor="requires_evidence" className="text-sm text-gray-700">
                Require evidence upload from users
              </label>
            </div>

          </div>

          {createMutation.isError && (
            <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
              Failed to create campaign. Please try again.
            </div>
          )}

          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={closeModal} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Campaign'}
            </button>
          </div>
        </form>
      </RightSlidePanel>
    </div>
  );
}
