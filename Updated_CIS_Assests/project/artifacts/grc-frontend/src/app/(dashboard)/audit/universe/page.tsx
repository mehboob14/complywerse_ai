'use client';

import React, { useState } from 'react';
import { useRouter } from '@/lib/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { auditApi, apiClient } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Plus,
  Search,
  Filter,
  Globe,
  AlertTriangle,
  Calendar,
  Clock,
  User,
  Edit2,
  Trash2,
  X,
  ShieldAlert,
  BarChart3,
  AlertCircle,
  RefreshCw,
  Link2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Phone,
  Mail,
  Building2,
  Eye,
} from 'lucide-react';

const ENTITY_TYPES = ['Business Unit', 'Process', 'IT System', 'Department', 'Project', 'Third Party', 'Regulatory'];
const RISK_RATINGS = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['active', 'inactive', 'pending_review', 'archived'];
const AUDIT_CYCLES = ['annual', 'semi-annual', 'quarterly', 'biennial', 'ad-hoc'];
const INDUSTRIES = ['Banking', 'Healthcare', 'Insurance', 'Technology', 'Energy', 'Government', 'Manufacturing', 'Retail', 'Telecom', 'Other'];

function getRiskBadgeClasses(rating: string) {
  switch (rating?.toLowerCase()) {
    case 'critical': return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 'high': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
    case 'medium': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    case 'low': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    default: return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
  }
}

function getStatusBadgeClasses(status: string) {
  switch (status) {
    case 'active': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    case 'inactive': return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
    case 'pending_review': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    case 'archived': return 'bg-slate-200/10 text-slate-500 border-slate-300/20';
    default: return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
  }
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatStatus(status: string) {
  return status?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '—';
}

const defaultForm = {
  name: '',
  entity_type: 'Business Unit',
  description: '',
  risk_score: 0,
  risk_rating: 'medium',
  audit_cycle: 'annual',
  owner_id: '' as string | number,
  status: 'active',
  last_audited: '',
  next_audit_due: '',
  industry: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  contact_designation: '',
};

export default function AuditUniversePage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterRisk, setFilterRisk] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('audit:audit_management:create');
  const canEdit = hasPermission('audit:audit_management:edit');
  const canDelete = hasPermission('audit:audit_management:delete');
  const [showModal, setShowModal] = useState(false);
  const [editingEntity, setEditingEntity] = useState<any>(null);
  const [form, setForm] = useState(defaultForm);
  const [expandedEntity, setExpandedEntity] = useState<number | null>(null);
  const [syncResult, setSyncResult] = useState<any>(null);

  const { data: entities, isLoading, refetch } = useQuery({
    queryKey: ['audit-entities'],
    queryFn: () => auditApi.universe.getAll().then(r => r.data?.entities || r.data || []),
  });

  const { data: gaps } = useQuery({
    queryKey: ['coverage-gaps'],
    queryFn: () => auditApi.universe.getCoverageGaps().then(r => r.data),
  });

  const { data: riskEnrichment } = useQuery({
    queryKey: ['risk-enrichment'],
    queryFn: () => auditApi.universe.getRiskEnrichment().then(r => r.data),
  });

  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => apiClient.get('/auth/me').then(r => r.data),
  });

  const tenantId = currentUser?.user?.primary_tenant_id || currentUser?.primary_tenant_id;

  const { data: tenantUsers } = useQuery({
    queryKey: ['tenant-users', tenantId],
    queryFn: () => apiClient.get(`/tenants/${tenantId}/users`).then(r => r.data),
    enabled: !!tenantId,
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.universe.create(data),
    onSuccess: () => { refetch(); closeModal(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => auditApi.universe.update(id, data),
    onSuccess: () => { refetch(); closeModal(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => auditApi.universe.delete(id),
    onSuccess: () => { refetch(); },
  });

  const syncMutation = useMutation({
    mutationFn: () => auditApi.universe.syncFromRisks().then(r => r.data),
    onSuccess: (data) => { refetch(); setSyncResult(data); setTimeout(() => setSyncResult(null), 8000); },
  });

  const refreshMutation = useMutation({
    mutationFn: () => auditApi.universe.refreshRiskScores().then(r => r.data),
    onSuccess: () => { refetch(); },
  });

  const aiDescriptionMutation = useMutation({
    mutationFn: (data: { entity_name: string; entity_type: string; industry?: string }) =>
      auditApi.universe.generateDescription(data).then(r => r.data),
    onSuccess: (data: any) => {
      setForm(prev => ({ ...prev, description: data.description || '' }));
    },
  });

  const { data: entityDetail } = useQuery({
    queryKey: ['audit-entity-detail', expandedEntity],
    queryFn: () => expandedEntity ? auditApi.universe.getById(expandedEntity).then(r => r.data) : null,
    enabled: !!expandedEntity,
  });

  function closeModal() {
    setShowModal(false);
    setEditingEntity(null);
    setForm(defaultForm);
  }

  function openAddModal() {
    setEditingEntity(null);
    setForm(defaultForm);
    setShowModal(true);
  }

  function openEditModal(entity: any) {
    setEditingEntity(entity);
    setForm({
      name: entity.name || '',
      entity_type: entity.entity_type || 'Business Unit',
      description: entity.description || '',
      risk_score: entity.risk_score || 0,
      risk_rating: entity.risk_rating || 'medium',
      audit_cycle: entity.audit_cycle || 'annual',
      owner_id: entity.owner_id || '',
      status: entity.status || 'active',
      last_audited: entity.last_audited?.split('T')[0] || '',
      next_audit_due: entity.next_audit_due?.split('T')[0] || '',
      industry: entity.industry || '',
      contact_name: entity.contact_name || '',
      contact_email: entity.contact_email || '',
      contact_phone: entity.contact_phone || '',
      contact_designation: entity.contact_designation || '',
    });
    setShowModal(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = { ...form, risk_score: Number(form.risk_score) };
    if (payload.owner_id) payload.owner_id = Number(payload.owner_id);
    else delete payload.owner_id;
    if (!payload.last_audited) delete payload.last_audited;
    if (!payload.next_audit_due) delete payload.next_audit_due;
    if (!payload.industry) payload.industry = null;
    if (!payload.contact_name) payload.contact_name = null;
    if (!payload.contact_email) payload.contact_email = null;
    if (!payload.contact_phone) payload.contact_phone = null;
    if (!payload.contact_designation) payload.contact_designation = null;

    if (editingEntity) {
      updateMutation.mutate({ id: editingEntity.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function handleDelete(id: number) {
    if (confirm('Are you sure you want to delete this entity?')) {
      deleteMutation.mutate(id);
    }
  }

  const filtered = (entities || []).filter((e: any) => {
    if (searchTerm && !e.name?.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterType && e.entity_type !== filterType) return false;
    if (filterRisk && e.risk_rating !== filterRisk) return false;
    if (filterStatus && e.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Universe</h1>
          <p className="text-slate-600 mt-1">Manage auditable entities and coverage analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.location.href = '/audit/plans?generate=universe'}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors"
          >
            <BarChart3 className="h-4 w-4" />
            Generate Audit Plan
          </button>
          {canCreate && (
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Entity
          </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
          <input
            type="text"
            placeholder="Search entities..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 text-slate-900 rounded-lg text-sm placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">All Types</option>
          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={filterRisk}
          onChange={e => setFilterRisk(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">All Ratings</option>
          {RISK_RATINGS.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{formatStatus(s)}</option>)}
        </select>
        {(filterType || filterRisk || filterStatus || searchTerm) && (
          <button
            onClick={() => { setFilterType(''); setFilterRisk(''); setFilterStatus(''); setSearchTerm(''); }}
            className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
          >
            Clear Filters
          </button>
        )}
      </div>

      {riskEnrichment && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-900">Risk Register Summary</h3>
              <span className="text-xs text-slate-600 ml-2">Data from Risk Management module</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
                {refreshMutation.isPending ? 'Refreshing...' : 'Refresh Scores'}
              </button>
              <button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
              >
                <Link2 className="h-3.5 w-3.5" />
                {syncMutation.isPending ? 'Syncing...' : 'Sync from Risk Register'}
              </button>
            </div>
          </div>
          {syncResult && (
            <div className="mb-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-sm text-emerald-400">{syncResult.message}</p>
              <p className="text-xs text-emerald-500 mt-1">Created: {syncResult.created} | Updated: {syncResult.updated}</p>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {(riskEnrichment.risk_summary || []).map((cat: any) => (
              <div key={cat.category} className="bg-slate-100 rounded-lg p-3">
                <p className="text-xs text-slate-600 capitalize">{cat.category}</p>
                <p className="text-lg font-bold text-slate-900">{cat.count}</p>
                <p className="text-xs text-slate-500">Avg Score: {cat.avg_score}</p>
              </div>
            ))}
            {(riskEnrichment.risk_summary || []).length === 0 && (
              <p className="text-sm text-slate-600 col-span-full">No active risks found in Risk Register</p>
            )}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
            <span>Total open risks: {riskEnrichment.total_risks || 0}</span>
            <span>|</span>
            <span className="flex items-center gap-1">
              <Link2 className="h-3 w-3" />
              {riskEnrichment.linked_entities || 0} of {riskEnrichment.total_entities || 0} entities linked to {riskEnrichment.total_linked_risks || 0} risks
            </span>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left px-4 py-3 text-slate-600 font-medium">Name</th>
                <th className="text-left px-4 py-3 text-slate-600 font-medium">Type</th>
                <th className="text-left px-4 py-3 text-slate-600 font-medium">Industry</th>
                <th className="text-left px-4 py-3 text-slate-600 font-medium">Risk Score</th>
                <th className="text-left px-4 py-3 text-slate-600 font-medium">Risk Rating</th>
                <th className="text-left px-4 py-3 text-slate-600 font-medium">Next Due</th>
                <th className="text-left px-4 py-3 text-slate-600 font-medium">Owner</th>
                <th className="text-left px-4 py-3 text-slate-600 font-medium">Linked Risks</th>
                <th className="text-left px-4 py-3 text-slate-600 font-medium">Status</th>
                <th className="text-right px-4 py-3 text-slate-600 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-200/30">
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-100 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center">
                    <Globe className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-600 font-medium">No entities found</p>
                    <p className="text-slate-500 text-xs mt-1">Add entities to build your audit universe</p>
                  </td>
                </tr>
              ) : (
                filtered.map((entity: any) => {
                  const isExpanded = expandedEntity === entity.id;
                  const riskCount = entity.linked_risk_count || (entity.linked_risk_ids || []).length || 0;
                  return (
                  <React.Fragment key={entity.id}>
                  <tr className="border-b border-slate-200/30 hover:bg-slate-100/20 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setExpandedEntity(isExpanded ? null : entity.id)}
                        className="text-slate-900 font-medium hover:text-blue-600 transition-colors text-left flex items-center gap-1"
                      >
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {entity.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{entity.entity_type}</td>
                    <td className="px-4 py-3">
                      {entity.industry ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-600 border border-indigo-200">
                          <Building2 className="h-3 w-3" />
                          {entity.industry}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{entity.risk_score ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${getRiskBadgeClasses(entity.risk_rating)}`}>
                        {entity.risk_rating ? entity.risk_rating.charAt(0).toUpperCase() + entity.risk_rating.slice(1) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatDate(entity.next_audit_due)}</td>
                    <td className="px-4 py-3 text-slate-700">{entity.owner_name || entity.owner || '—'}</td>
                    <td className="px-4 py-3">
                      {riskCount > 0 ? (
                        <button
                          onClick={() => setExpandedEntity(isExpanded ? null : entity.id)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                        >
                          <Link2 className="h-3 w-3" />
                          {riskCount}
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </button>
                      ) : (
                        <span className="text-slate-500 text-xs">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusBadgeClasses(entity.status)}`}>
                        {formatStatus(entity.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => router.push(`/audit/universe/${entity.id}`)}
                          className="p-1.5 text-slate-600 hover:text-emerald-400 rounded-lg hover:bg-slate-100 transition-colors"
                          title="View details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {canEdit && (
                        <button
                          onClick={() => openEditModal(entity)}
                          className="p-1.5 text-slate-600 hover:text-blue-400 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        )}
                        {canDelete && (
                        <button
                          onClick={() => handleDelete(entity.id)}
                          className="p-1.5 text-slate-600 hover:text-red-400 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-slate-200/30 bg-slate-50">
                      <td colSpan={10} className="px-6 py-4">
                        <div className="space-y-4">
                          {entity.description && (
                            <div>
                              <p className="text-xs font-semibold text-slate-600 mb-1">Description</p>
                              <p className="text-sm text-slate-700">{entity.description}</p>
                            </div>
                          )}
                          {(entity.contact_name || entity.contact_email || entity.contact_phone) && (
                            <div>
                              <p className="text-xs font-semibold text-slate-600 mb-2">Point of Contact</p>
                              <div className="flex flex-wrap items-center gap-4 text-sm">
                                {entity.contact_name && (
                                  <span className="flex items-center gap-1.5 text-slate-700">
                                    <User className="h-3.5 w-3.5 text-slate-400" />
                                    {entity.contact_name}
                                    {entity.contact_designation && (
                                      <span className="text-xs text-slate-500">({entity.contact_designation})</span>
                                    )}
                                  </span>
                                )}
                                {entity.contact_email && (
                                  <a href={`mailto:${entity.contact_email}`} className="flex items-center gap-1.5 text-blue-600 hover:underline">
                                    <Mail className="h-3.5 w-3.5" />
                                    {entity.contact_email}
                                  </a>
                                )}
                                {entity.contact_phone && (
                                  <span className="flex items-center gap-1.5 text-slate-700">
                                    <Phone className="h-3.5 w-3.5 text-slate-400" />
                                    {entity.contact_phone}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                          {entityDetail?.linked_risks && (
                            <div>
                              <p className="text-xs font-semibold text-slate-600 mb-2">Linked Risk Register Entries</p>
                              <div className="space-y-1">
                                {entityDetail.linked_risks.map((risk: any) => (
                                  <div key={risk.id} className="flex items-center justify-between bg-slate-100 rounded-lg px-3 py-2">
                                    <div className="flex items-center gap-3">
                                      <span className="text-sm text-slate-900">{risk.title}</span>
                                      <span className="text-xs text-slate-600 capitalize">{risk.category}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getRiskBadgeClasses(risk.risk_rating)}`}>
                                        {risk.risk_rating?.charAt(0).toUpperCase() + risk.risk_rating?.slice(1)}
                                      </span>
                                      <span className="text-xs text-slate-600">Residual: {risk.residual_score ?? '—'}</span>
                                      <span className={`text-xs ${risk.status === 'open' ? 'text-amber-400' : 'text-slate-500'}`}>{risk.status}</span>
                                    </div>
                                  </div>
                                ))}
                                {entityDetail.linked_risks.length === 0 && (
                                  <p className="text-xs text-slate-500">No linked risks found</p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!isLoading && filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-200 text-sm text-slate-600">
            Showing {filtered.length} of {(entities || []).length} entities
          </div>
        )}
      </div>

      {gaps && (
        <div>
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-blue-400" />
            Coverage Gap Analysis
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/10">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{gaps.never_audited ?? 0}</p>
                  <p className="text-sm text-slate-600">Never Audited</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <Clock className="h-5 w-5 text-orange-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{gaps.overdue ?? 0}</p>
                  <p className="text-sm text-slate-600">Overdue Audits</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <ShieldAlert className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{gaps.high_risk_unaudited ?? 0}</p>
                  <p className="text-sm text-slate-600">High Risk Unaudited</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Calendar className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{gaps.due_within_90_days ?? gaps.upcoming ?? 0}</p>
                  <p className="text-sm text-slate-600">Due Within 90 Days</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">
                {editingEntity ? 'Edit Entity' : 'Add Entity'}
              </h3>
              <button onClick={closeModal} className="p-1.5 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Entity name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Entity Type</label>
                  <select
                    value={form.entity_type}
                    onChange={e => setForm({ ...form, entity_type: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  >
                    {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Industry</label>
                  <select
                    value={form.industry}
                    onChange={e => setForm({ ...form, industry: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Select industry...</option>
                    {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-slate-700">Description</label>
                  <button
                    type="button"
                    disabled={!form.name || aiDescriptionMutation.isPending}
                    onClick={() => aiDescriptionMutation.mutate({
                      entity_name: form.name,
                      entity_type: form.entity_type,
                      industry: form.industry || undefined,
                    })}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Sparkles className={`h-3.5 w-3.5 ${aiDescriptionMutation.isPending ? 'animate-spin' : ''}`} />
                    {aiDescriptionMutation.isPending ? 'Generating...' : 'Generate with AI'}
                  </button>
                </div>
                <textarea
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500 resize-none"
                  placeholder="Brief description or use AI to generate..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Risk Rating</label>
                  <select
                    value={form.risk_rating}
                    onChange={e => setForm({ ...form, risk_rating: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  >
                    {RISK_RATINGS.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Risk Score</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={form.risk_score}
                    onChange={e => setForm({ ...form, risk_score: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Audit Cycle</label>
                  <select
                    value={form.audit_cycle}
                    onChange={e => setForm({ ...form, audit_cycle: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  >
                    {AUDIT_CYCLES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={e => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{formatStatus(s)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Owner</label>
                <select
                  value={form.owner_id}
                  onChange={e => setForm({ ...form, owner_id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select owner...</option>
                  {(tenantUsers || []).map((tu: any) => (
                    <option key={tu.user?.id || tu.user_id} value={tu.user?.id || tu.user_id}>
                      {tu.user?.display_name || tu.user?.username || tu.user?.email || `User ${tu.user_id}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Last Audited</label>
                  <input
                    type="date"
                    value={form.last_audited}
                    onChange={e => setForm({ ...form, last_audited: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Next Audit Due</label>
                  <input
                    type="date"
                    value={form.next_audit_due}
                    onChange={e => setForm({ ...form, next_audit_due: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <p className="text-sm font-medium text-slate-700 mb-3">Point of Contact</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Contact Name</label>
                    <input
                      type="text"
                      value={form.contact_name}
                      onChange={e => setForm({ ...form, contact_name: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      placeholder="Full name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Designation / Title</label>
                    <input
                      type="text"
                      value={form.contact_designation}
                      onChange={e => setForm({ ...form, contact_designation: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      placeholder="e.g. VP of Operations"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Email</label>
                    <input
                      type="email"
                      value={form.contact_email}
                      onChange={e => setForm({ ...form, contact_email: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      placeholder="contact@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={form.contact_phone}
                      onChange={e => setForm({ ...form, contact_phone: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      placeholder="+1 (555) 000-0000"
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-4 py-2 text-sm text-slate-900 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {createMutation.isPending || updateMutation.isPending ? 'Saving...' : editingEntity ? 'Update Entity' : 'Add Entity'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}