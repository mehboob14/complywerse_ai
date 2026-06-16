'use client';

import { useState } from 'react';
import { useRouter } from '@/lib/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Plus,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Calendar,
  CheckCircle,
  XCircle,
  Send,
  X,
  Filter,
  ClipboardList,
  Target,
  Clock,
  Users,
  AlertTriangle,
  Pencil,
  Trash2,
  Globe,
  ArrowRight,
  PlayCircle,
  Loader2,
} from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-500/20 text-slate-600',
  pending_review: 'bg-blue-500/20 text-blue-400',
  under_review: 'bg-blue-500/20 text-blue-400',
  approved: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
  in_progress: 'bg-amber-500/20 text-amber-400',
  completed: 'bg-green-500/20 text-green-400',
  active: 'bg-emerald-500/20 text-emerald-400',
};

const APPROVAL_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  submitted: 'bg-blue-500/20 text-blue-400',
  pending_review: 'bg-blue-500/20 text-blue-400',
  approved: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
  not_submitted: 'bg-slate-500/20 text-slate-600',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400',
  high: 'bg-orange-500/20 text-orange-400',
  medium: 'bg-amber-500/20 text-amber-400',
  low: 'bg-emerald-500/20 text-emerald-400',
};

const ITEM_STATUS_COLORS: Record<string, string> = {
  planned: 'bg-slate-500/20 text-slate-600',
  in_progress: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-emerald-500/20 text-emerald-400',
  deferred: 'bg-amber-500/20 text-amber-400',
  cancelled: 'bg-red-500/20 text-red-400',
};

export default function AuditPlansPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('audit:audit_management:create');
  const canEdit = hasPermission('audit:audit_management:edit');
  const canDelete = hasPermission('audit:audit_management:delete');
  const router = useRouter();
  const [expandedPlan, setExpandedPlan] = useState<number | null>(null);
  const [filterYear, setFilterYear] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showUniverseModal, setShowUniverseModal] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState<number | null>(null);
  const [universeForm, setUniverseForm] = useState({ fiscal_year: new Date().getFullYear().toString(), name: '', total_budget_days: '', min_risk_score: '0' });

  const [newPlan, setNewPlan] = useState({
    name: '',
    fiscal_year: new Date().getFullYear().toString(),
    description: '',
    total_budget_days: '',
  });

  const [aiForm, setAiForm] = useState({
    fiscal_year: new Date().getFullYear().toString(),
    team_size: '',
    total_budget_days: '',
    focus_areas: '',
  });

  const [newItem, setNewItem] = useState({
    name: '',
    quarter: 'Q1',
    risk_score: '',
    priority: 'medium',
    budget_days: '',
    assigned_auditor: '',
    status: 'planned',
  });

  const [showEditPlanModal, setShowEditPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const [editPlanForm, setEditPlanForm] = useState({
    name: '',
    description: '',
    fiscal_year: new Date().getFullYear().toString(),
    total_budget_days: '',
  });

  const [regChanges, setRegChanges] = useState<any[]>([]);
  const [loadingRegChanges, setLoadingRegChanges] = useState(false);
  const [assessingImpactId, setAssessingImpactId] = useState<number|null>(null);
  const [impactResult, setImpactResult] = useState<any>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);

  const [editingItem, setEditingItem] = useState<{ planId: number; item: any } | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    quarter: 'Q1',
    risk_score: '',
    priority: 'medium',
    budget_days: '',
    assigned_auditor: '',
    status: 'planned',
  });

  const params: Record<string, string> = {};
  if (filterYear) params.fiscal_year = filterYear;
  if (filterStatus) params.status = filterStatus;

  const { data: plans, refetch, isLoading } = useQuery({
    queryKey: ['audit-plans', filterYear, filterStatus],
    queryFn: () => auditApi.plans.getAll(Object.keys(params).length ? params : undefined).then(r => r.data?.plans || r.data || []),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.plans.create(data).then(r => r.data),
    onSuccess: () => { refetch(); setShowCreateModal(false); setNewPlan({ name: '', fiscal_year: new Date().getFullYear().toString(), description: '', total_budget_days: '' }); },
  });

  const aiMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.ai.generateAuditPlan(data).then(r => r.data),
    onSuccess: () => { refetch(); setShowAIModal(false); setAiForm({ fiscal_year: new Date().getFullYear().toString(), team_size: '', total_budget_days: '', focus_areas: '' }); },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => auditApi.plans.approve(id, data).then(r => r.data),
    onSuccess: () => refetch(),
  });

  const addItemMutation = useMutation({
    mutationFn: ({ planId, data }: { planId: number; data: Record<string, unknown> }) => auditApi.plans.addItem(planId, data).then(r => r.data),
    onSuccess: () => { refetch(); setShowAddItemModal(null); setNewItem({ name: '', quarter: 'Q1', risk_score: '', priority: 'medium', budget_days: '', assigned_auditor: '', status: 'planned' }); },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ planId, itemId, data }: { planId: number; itemId: number; data: Record<string, unknown> }) => auditApi.plans.updateItem(planId, itemId, data).then(r => r.data),
    onSuccess: () => { refetch(); setEditingItem(null); },
  });

  const deleteItemMutation = useMutation({
    mutationFn: ({ planId, itemId }: { planId: number; itemId: number }) => auditApi.plans.deleteItem(planId, itemId).then(r => r.data),
    onSuccess: () => { refetch(); setEditingItem(null); },
  });

  const universeMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.plans.generateFromUniverse(data).then(r => r.data),
    onSuccess: () => { refetch(); setShowUniverseModal(false); setUniverseForm({ fiscal_year: new Date().getFullYear().toString(), name: '', total_budget_days: '', min_risk_score: '0' }); },
  });

  const updatePlanMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => auditApi.plans.update(id, data).then(r => r.data),
    onSuccess: () => { refetch(); setShowEditPlanModal(false); },
  });

  const deletePlanMutation = useMutation({
    mutationFn: (id: number) => auditApi.plans.delete(id).then(r => r.data),
    onSuccess: () => refetch(),
  });

  const { data: regChangesData } = useQuery({
    queryKey: ['audit-reg-changes'],
    queryFn: () => auditApi.tools.getRegulatoryChanges().then(r => r.data?.changes || []),
  });

  const handleAssessImpact = async (changeId: number) => {
    setAssessingImpactId(changeId);
    setLoadingImpact(true);
    setImpactResult(null);
    try {
      const res = await auditApi.ai.regulatoryImpact({ regulatory_change_id: changeId });
      setImpactResult(res.data);
    } catch (err) { console.error('Impact assessment failed:', err); }
    finally { setLoadingImpact(false); }
  };

  const openEditPlan = (plan: any) => {
    setEditingPlan(plan);
    setEditPlanForm({
      name: plan.name || '',
      description: plan.description || '',
      fiscal_year: String(plan.fiscal_year || new Date().getFullYear()),
      total_budget_days: String(plan.total_budget_days ?? plan.budget_days ?? ''),
    });
    setShowEditPlanModal(true);
  };

  const createEngagementMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.engagements.createFromPlanItem(data).then(r => r.data),
    onSuccess: () => refetch(),
  });

  const bulkEngagementMutation = useMutation({
    mutationFn: (planId: number) => auditApi.engagements.createFromPlan(planId).then(r => r.data),
    onSuccess: () => refetch(),
  });

  const openEditItem = (planId: number, item: any) => {
    setEditingItem({ planId, item });
    setEditForm({
      name: item.name || item.title || '',
      quarter: item.quarter || item.planned_quarter || 'Q1',
      risk_score: String(item.risk_score ?? item.risk_rating ?? ''),
      priority: item.priority || 'medium',
      budget_days: String(item.budget_days ?? item.estimated_days ?? ''),
      assigned_auditor: item.assigned_auditor || item.auditor_name || '',
      status: item.status || 'planned',
    });
  };

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => (currentYear - 2 + i).toString());

  const filteredPlans = plans || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Plans</h1>
          <p className="text-slate-600 mt-1">Manage annual audit plans and resource allocation</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowUniverseModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors"
          >
            <Globe className="h-4 w-4" />
            From Universe
          </button>
          {canCreate && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create Plan
          </button>
          )}
          <button
            onClick={() => setShowAIModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            AI Generate Plan
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-slate-200">
        <Filter className="h-4 w-4 text-slate-600" />
        <select
          value={filterYear}
          onChange={(e) => setFilterYear(e.target.value)}
          className="bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Years</option>
          {yearOptions.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="pending_review">Pending Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>
        {(filterYear || filterStatus) && (
          <button
            onClick={() => { setFilterYear(''); setFilterStatus(''); }}
            className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
          >
            Clear Filters
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-6 animate-pulse">
              <div className="h-6 w-48 bg-slate-100 rounded mb-3" />
              <div className="h-4 w-96 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : filteredPlans.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <ClipboardList className="h-12 w-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">No Audit Plans Found</h3>
          <p className="text-slate-600">Create a new plan or use AI to generate one based on your risk profile.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPlans.map((plan: any) => {
            const isExpanded = expandedPlan === plan.id;
            const items = plan.items || plan.plan_items || [];
            return (
              <div key={plan.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div
                  className="p-5 cursor-pointer hover:bg-slate-750 transition-colors"
                  onClick={() => setExpandedPlan(isExpanded ? null : plan.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="mt-1">
                        {isExpanded ? (
                          <ChevronDown className="h-5 w-5 text-slate-600" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-slate-600" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-semibold text-slate-900 cursor-pointer hover:text-blue-600" onClick={(e) => { e.stopPropagation(); router.push(`/audit/plans/${plan.id}`); }}>{plan.name}</h3>
                          {plan.ai_generated && (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400">
                              AI Generated
                            </span>
                          )}
                          {canEdit && (
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditPlan(plan); }}
                            className="p-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                            title="Edit plan"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          )}
                          {canDelete && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm('Are you sure you want to delete this audit plan and all its items?')) {
                                deletePlanMutation.mutate(plan.id);
                              }
                            }}
                            disabled={deletePlanMutation.isPending}
                            className="p-1 text-slate-600 hover:text-red-400 hover:bg-slate-100 rounded transition-colors"
                            title="Delete plan"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          )}
                        </div>
                        {plan.description && (
                          <p className="text-sm text-slate-600 mt-1 line-clamp-2">{plan.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {(plan.status === 'draft' || plan.approval_status === 'not_submitted') && (
                        <button
                          onClick={(e) => { e.stopPropagation(); approveMutation.mutate({ id: plan.id, data: { action: 'submit' } }); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
                        >
                          <Send className="h-3.5 w-3.5" />
                          Submit for Review
                        </button>
                      )}
                      {(plan.status === 'pending_review' || plan.status === 'under_review' || plan.approval_status === 'submitted' || plan.approval_status === 'pending_review') && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); approveMutation.mutate({ id: plan.id, data: { action: 'approve' } }); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg transition-colors"
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                            Approve
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); approveMutation.mutate({ id: plan.id, data: { action: 'reject' } }); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg transition-colors"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Reject
                          </button>
                        </>
                      )}
                      {(plan.status === 'approved' || plan.approval_status === 'approved') && items.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); bulkEngagementMutation.mutate(plan.id); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg transition-colors"
                          disabled={bulkEngagementMutation.isPending}
                        >
                          <PlayCircle className="h-3.5 w-3.5" />
                          {bulkEngagementMutation.isPending ? 'Creating...' : 'Create All Engagements'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-6 mt-4 ml-8">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-slate-500" />
                      <span className="text-sm text-slate-700">FY {plan.fiscal_year}</span>
                    </div>
                    <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[plan.status] || STATUS_COLORS.draft}`}>
                      {(plan.status || 'draft').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    </span>
                    {plan.approval_status && (
                      <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${APPROVAL_COLORS[plan.approval_status] || APPROVAL_COLORS.pending}`}>
                        {plan.approval_status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-slate-500" />
                      <span className="text-sm text-slate-700">{plan.total_budget_days || plan.budget_days || 0} Budget Days</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-slate-500" />
                      <span className="text-sm text-slate-700">{items.length} Items</span>
                    </div>
                    {(plan.risk_alignment_score !== undefined && plan.risk_alignment_score !== null) && (
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-slate-500" />
                        <span className="text-sm text-slate-700">Risk Alignment: {typeof plan.risk_alignment_score === 'number' ? plan.risk_alignment_score.toFixed(1) : plan.risk_alignment_score}%</span>
                      </div>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-200 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-semibold text-slate-900">Plan Items</h4>
                      <button
                        onClick={() => setShowAddItemModal(plan.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-900 text-sm rounded-lg transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Item
                      </button>
                    </div>
                    {items.length === 0 ? (
                      <div className="text-center py-8">
                        <AlertTriangle className="h-8 w-8 text-slate-500 mx-auto mb-2" />
                        <p className="text-sm text-slate-600">No items in this plan yet.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200">
                              <th className="text-left py-3 px-4 text-slate-600 font-medium">Name</th>
                              <th className="text-left py-3 px-4 text-slate-600 font-medium">Entity</th>
                              <th className="text-left py-3 px-4 text-slate-600 font-medium">Quarter</th>
                              <th className="text-left py-3 px-4 text-slate-600 font-medium">Risk Score</th>
                              <th className="text-left py-3 px-4 text-slate-600 font-medium">Priority</th>
                              <th className="text-left py-3 px-4 text-slate-600 font-medium">Budget Days</th>
                              <th className="text-left py-3 px-4 text-slate-600 font-medium">Assigned Auditor</th>
                              <th className="text-left py-3 px-4 text-slate-600 font-medium">Status</th>
                              <th className="text-left py-3 px-4 text-slate-600 font-medium">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item: any, idx: number) => (
                              <tr
                                key={item.id || idx}
                                className="border-b border-slate-200/30 hover:bg-slate-100 transition-colors cursor-pointer group"
                                onClick={() => openEditItem(plan.id, item)}
                              >
                                <td className="py-3 px-4 text-slate-900 font-medium">
                                  <div className="flex items-center gap-2">
                                    {item.name || item.title}
                                    <Pencil className="h-3.5 w-3.5 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-slate-600 text-xs">{item.entity_name || '-'}</td>
                                <td className="py-3 px-4 text-slate-700">{item.quarter || item.planned_quarter || '-'}</td>
                                <td className="py-3 px-4 text-slate-700">{item.risk_score ?? item.risk_rating ?? '-'}</td>
                                <td className="py-3 px-4">
                                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.medium}`}>
                                    {(item.priority || 'medium').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-slate-700">{item.budget_days ?? item.estimated_days ?? '-'}</td>
                                <td className="py-3 px-4 text-slate-700">{item.assigned_auditor || item.auditor_name || '-'}</td>
                                <td className="py-3 px-4">
                                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${ITEM_STATUS_COLORS[item.status] || ITEM_STATUS_COLORS.planned}`}>
                                    {(item.status || 'planned').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      createEngagementMutation.mutate({
                                        plan_item_id: item.id,
                                        planned_start: new Date().toISOString(),
                                        planned_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                                      });
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 text-xs rounded transition-colors"
                                    disabled={createEngagementMutation.isPending}
                                  >
                                    <ArrowRight className="h-3 w-3" />
                                    Engagement
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Create Audit Plan</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Plan Name</label>
                <input
                  type="text"
                  value={newPlan.name}
                  onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })}
                  className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Annual Audit Plan 2026"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Fiscal Year</label>
                  <select
                    value={newPlan.fiscal_year}
                    onChange={(e) => setNewPlan({ ...newPlan, fiscal_year: e.target.value })}
                    className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm"
                  >
                    {yearOptions.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Total Budget Days</label>
                  <input
                    type="number"
                    value={newPlan.total_budget_days}
                    onChange={(e) => setNewPlan({ ...newPlan, total_budget_days: e.target.value })}
                    className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., 250"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={newPlan.description}
                  onChange={(e) => setNewPlan({ ...newPlan, description: e.target.value })}
                  className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 h-24 resize-none"
                  placeholder="Plan description..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-slate-200">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm text-slate-700 hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  createMutation.mutate({
                    name: newPlan.name,
                    fiscal_year: parseInt(newPlan.fiscal_year),
                    description: newPlan.description,
                    total_budget_days: newPlan.total_budget_days ? parseInt(newPlan.total_budget_days) : undefined,
                  });
                }}
                disabled={!newPlan.name || createMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
              >
                {createMutation.isPending ? 'Creating...' : 'Create Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAIModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-400" />
                <h2 className="text-lg font-semibold text-slate-900">AI Generate Audit Plan</h2>
              </div>
              <button onClick={() => setShowAIModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3">
                <p className="text-sm text-purple-300">AI will generate a comprehensive audit plan based on your organization&apos;s risk profile, resource capacity, and focus areas.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Fiscal Year</label>
                  <select
                    value={aiForm.fiscal_year}
                    onChange={(e) => setAiForm({ ...aiForm, fiscal_year: e.target.value })}
                    className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm"
                  >
                    {yearOptions.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Team Size</label>
                  <input
                    type="number"
                    value={aiForm.team_size}
                    onChange={(e) => setAiForm({ ...aiForm, team_size: e.target.value })}
                    className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="e.g., 5"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Total Budget Days</label>
                <input
                  type="number"
                  value={aiForm.total_budget_days}
                  onChange={(e) => setAiForm({ ...aiForm, total_budget_days: e.target.value })}
                  className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="e.g., 250"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Focus Areas</label>
                <textarea
                  value={aiForm.focus_areas}
                  onChange={(e) => setAiForm({ ...aiForm, focus_areas: e.target.value })}
                  className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 h-32 resize-none"
                  placeholder="Enter focus areas, one per line...&#10;e.g.,&#10;Cybersecurity&#10;Financial Controls&#10;Regulatory Compliance&#10;IT General Controls"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-slate-200">
              <button
                onClick={() => setShowAIModal(false)}
                className="px-4 py-2 text-sm text-slate-700 hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  aiMutation.mutate({
                    fiscal_year: aiForm.fiscal_year,
                    team_size: aiForm.team_size ? parseInt(aiForm.team_size) : undefined,
                    total_budget_days: aiForm.total_budget_days ? parseInt(aiForm.total_budget_days) : undefined,
                    focus_areas: aiForm.focus_areas ? aiForm.focus_areas.split('\n').filter(Boolean) : [],
                  });
                }}
                disabled={aiMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
              >
                <Sparkles className="h-4 w-4" />
                {aiMutation.isPending ? 'Generating...' : 'Generate Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Edit Plan Item</h2>
              <button onClick={() => setEditingItem(null)} className="text-slate-600 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Item Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quarter</label>
                  <select
                    value={editForm.quarter}
                    onChange={(e) => setEditForm({ ...editForm, quarter: e.target.value })}
                    className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="Q1">Q1</option>
                    <option value="Q2">Q2</option>
                    <option value="Q3">Q3</option>
                    <option value="Q4">Q4</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Risk Score</label>
                  <input
                    type="number"
                    value={editForm.risk_score}
                    onChange={(e) => setEditForm({ ...editForm, risk_score: e.target.value })}
                    className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="1-25"
                    min="1"
                    max="25"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
                  <select
                    value={editForm.priority}
                    onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                    className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Budget Days</label>
                  <input
                    type="number"
                    value={editForm.budget_days}
                    onChange={(e) => setEditForm({ ...editForm, budget_days: e.target.value })}
                    className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., 15"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Assigned Auditor</label>
                <input
                  type="text"
                  value={editForm.assigned_auditor}
                  onChange={(e) => setEditForm({ ...editForm, assigned_auditor: e.target.value })}
                  className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Auditor name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="planned">Planned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="deferred">Deferred</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between p-5 border-t border-slate-200">
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to delete this plan item?')) {
                    deleteItemMutation.mutate({ planId: editingItem.planId, itemId: editingItem.item.id });
                  }
                }}
                disabled={deleteItemMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg text-sm transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                {deleteItemMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 text-sm text-slate-700 hover:text-slate-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    updateItemMutation.mutate({
                      planId: editingItem.planId,
                      itemId: editingItem.item.id,
                      data: {
                        name: editForm.name,
                        quarter: editForm.quarter,
                        risk_score: editForm.risk_score ? parseFloat(editForm.risk_score) : undefined,
                        priority: editForm.priority,
                        budget_days: editForm.budget_days ? parseInt(editForm.budget_days) : undefined,
                        assigned_auditor: editForm.assigned_auditor || undefined,
                        status: editForm.status,
                      },
                    });
                  }}
                  disabled={!editForm.name || updateItemMutation.isPending}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
                >
                  {updateItemMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddItemModal !== null && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Add Plan Item</h2>
              <button onClick={() => setShowAddItemModal(null)} className="text-slate-600 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Item Name</label>
                <input
                  type="text"
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., IT General Controls Audit"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quarter</label>
                  <select
                    value={newItem.quarter}
                    onChange={(e) => setNewItem({ ...newItem, quarter: e.target.value })}
                    className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="Q1">Q1</option>
                    <option value="Q2">Q2</option>
                    <option value="Q3">Q3</option>
                    <option value="Q4">Q4</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Risk Score</label>
                  <input
                    type="number"
                    value={newItem.risk_score}
                    onChange={(e) => setNewItem({ ...newItem, risk_score: e.target.value })}
                    className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="1-25"
                    min="1"
                    max="25"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
                  <select
                    value={newItem.priority}
                    onChange={(e) => setNewItem({ ...newItem, priority: e.target.value })}
                    className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Budget Days</label>
                  <input
                    type="number"
                    value={newItem.budget_days}
                    onChange={(e) => setNewItem({ ...newItem, budget_days: e.target.value })}
                    className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., 15"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Assigned Auditor</label>
                <input
                  type="text"
                  value={newItem.assigned_auditor}
                  onChange={(e) => setNewItem({ ...newItem, assigned_auditor: e.target.value })}
                  className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Auditor name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={newItem.status}
                  onChange={(e) => setNewItem({ ...newItem, status: e.target.value })}
                  className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="planned">Planned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="deferred">Deferred</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-slate-200">
              <button
                onClick={() => setShowAddItemModal(null)}
                className="px-4 py-2 text-sm text-slate-700 hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  addItemMutation.mutate({
                    planId: showAddItemModal,
                    data: {
                      name: newItem.name,
                      quarter: newItem.quarter,
                      risk_score: newItem.risk_score ? parseFloat(newItem.risk_score) : undefined,
                      priority: newItem.priority,
                      budget_days: newItem.budget_days ? parseInt(newItem.budget_days) : undefined,
                      assigned_auditor: newItem.assigned_auditor || undefined,
                      status: newItem.status,
                    },
                  });
                }}
                disabled={!newItem.name || addItemMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
              >
                {addItemMutation.isPending ? 'Adding...' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditPlanModal && editingPlan && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Edit Audit Plan</h2>
              <button onClick={() => setShowEditPlanModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Plan Name</label>
                <input
                  type="text"
                  value={editPlanForm.name}
                  onChange={(e) => setEditPlanForm({ ...editPlanForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  placeholder="e.g., Annual Audit Plan 2026"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Fiscal Year</label>
                  <select
                    value={editPlanForm.fiscal_year}
                    onChange={(e) => setEditPlanForm({ ...editPlanForm, fiscal_year: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  >
                    {yearOptions.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Total Budget Days</label>
                  <input
                    type="number"
                    value={editPlanForm.total_budget_days}
                    onChange={(e) => setEditPlanForm({ ...editPlanForm, total_budget_days: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    placeholder="e.g., 250"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={editPlanForm.description}
                  onChange={(e) => setEditPlanForm({ ...editPlanForm, description: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-100 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500 h-24 resize-none"
                  placeholder="Plan description..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-slate-200">
              <button
                onClick={() => setShowEditPlanModal(false)}
                className="px-4 py-2 text-sm text-slate-700 hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  updatePlanMutation.mutate({
                    id: editingPlan.id,
                    data: {
                      name: editPlanForm.name,
                      fiscal_year: parseInt(editPlanForm.fiscal_year),
                      description: editPlanForm.description,
                      total_budget_days: editPlanForm.total_budget_days ? parseInt(editPlanForm.total_budget_days) : undefined,
                    },
                  });
                }}
                disabled={!editPlanForm.name || updatePlanMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
              >
                {updatePlanMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUniverseModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowUniverseModal(false)}>
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Generate Plan from Audit Universe</h3>
              <button onClick={() => setShowUniverseModal(false)} className="text-slate-600 hover:text-slate-900"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-600">This will create an audit plan with items for each high-risk entity in your Audit Universe, prioritized by risk score.</p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Plan Name</label>
                <input type="text" value={universeForm.name} onChange={(e) => setUniverseForm({ ...universeForm, name: e.target.value })} className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="e.g., Risk-Based Audit Plan 2026" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Fiscal Year</label>
                  <select value={universeForm.fiscal_year} onChange={(e) => setUniverseForm({ ...universeForm, fiscal_year: e.target.value })} className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm">
                    {Array.from({ length: 5 }, (_, i) => (new Date().getFullYear() - 2 + i).toString()).map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Total Budget Days</label>
                  <input type="number" value={universeForm.total_budget_days} onChange={(e) => setUniverseForm({ ...universeForm, total_budget_days: e.target.value })} className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="e.g., 200" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Minimum Risk Score (entities below this are excluded)</label>
                <input type="number" value={universeForm.min_risk_score} onChange={(e) => setUniverseForm({ ...universeForm, min_risk_score: e.target.value })} className="w-full bg-slate-100 border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="0" min="0" max="100" />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-slate-200">
              <button onClick={() => setShowUniverseModal(false)} className="px-4 py-2 text-sm text-slate-700 hover:text-slate-900 transition-colors">Cancel</button>
              <button
                onClick={() => {
                  universeMutation.mutate({
                    fiscal_year: universeForm.fiscal_year,
                    name: universeForm.name || undefined,
                    total_budget_days: universeForm.total_budget_days ? parseInt(universeForm.total_budget_days) : undefined,
                    min_risk_score: universeForm.min_risk_score ? parseFloat(universeForm.min_risk_score) : 0,
                  });
                }}
                disabled={universeMutation.isPending}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
              >
                {universeMutation.isPending ? 'Generating...' : 'Generate Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-lg mt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Globe className="h-5 w-5 text-blue-400" />Regulatory Change Impact</h2>
            <p className="text-sm text-slate-600">Assess how regulatory changes affect your audit plans</p>
          </div>
        </div>
        {(!regChangesData || (Array.isArray(regChangesData) && regChangesData.length === 0)) ? (
          <div className="text-center py-8"><Globe className="h-8 w-8 text-slate-600 mx-auto mb-2" /><p className="text-sm text-slate-500">No regulatory changes tracked. Add changes in Governance module.</p></div>
        ) : (
          <div className="space-y-3">
            {(Array.isArray(regChangesData) ? regChangesData : []).slice(0, 5).map((rc: any) => (
              <div key={rc.id} className="flex items-center justify-between bg-white/50 rounded-lg p-3 border border-slate-200/30">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-slate-900 truncate">{rc.title}</h4>
                  <div className="flex items-center gap-3 mt-0.5">
                    {rc.priority && <span className={"px-2 py-0.5 rounded text-xs " + (rc.priority === 'critical' || rc.priority === 'high' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400')}>{rc.priority}</span>}
                    {rc.effective_date && <span className="text-xs text-slate-500">Effective: {new Date(rc.effective_date).toLocaleDateString()}</span>}
                    {rc.status && <span className="text-xs text-slate-500 capitalize">{rc.status}</span>}
                  </div>
                </div>
                <button
                  onClick={() => handleAssessImpact(rc.id)}
                  disabled={loadingImpact && assessingImpactId === rc.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 text-slate-900 text-xs rounded-lg transition-all ml-3"
                >
                  {loadingImpact && assessingImpactId === rc.id ? <><Loader2 className="w-3 h-3 animate-spin" />Assessing...</> : <><Sparkles className="w-3 h-3" />Assess Impact</>}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {assessingImpactId && impactResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Sparkles className="h-5 w-5 text-purple-400" />Regulatory Impact Assessment</h2>
              <button onClick={() => { setAssessingImpactId(null); setImpactResult(null); }} className="text-slate-600 hover:text-slate-900"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-5">
              <div className="bg-white/50 border border-purple-500/20 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-purple-300 mb-1">Overall Impact Summary</h3>
                <p className="text-sm text-slate-700">{impactResult.overall_impact_summary}</p>
              </div>
              {impactResult.affected_entities && impactResult.affected_entities.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">Affected Audit Universe Entities</h3>
                  <div className="space-y-2">
                    {impactResult.affected_entities.map((ae: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between bg-white/50 rounded-lg p-3 border border-slate-200/30">
                        <div><p className="text-sm text-slate-900">{ae.entity_name}</p><p className="text-xs text-slate-600">{ae.reasoning}</p></div>
                        <span className={"px-2 py-0.5 rounded text-xs " + (ae.impact_level === 'high' ? 'bg-red-500/20 text-red-400' : ae.impact_level === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400')}>{ae.impact_level}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {impactResult.affected_plan_items && impactResult.affected_plan_items.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">Affected Plan Items</h3>
                  <div className="space-y-2">
                    {impactResult.affected_plan_items.map((ap: any, idx: number) => (
                      <div key={idx} className="bg-white/50 rounded-lg p-3 border border-slate-200/30">
                        <p className="text-sm text-slate-900">{ap.plan_item_name}</p>
                        <p className="text-xs text-slate-600">{ap.impact}</p>
                        <span className={"text-xs px-2 py-0.5 rounded mt-1 inline-block " + (ap.suggested_action === 'expand_scope' ? 'bg-amber-500/20 text-amber-400' : ap.suggested_action === 'increase_priority' ? 'bg-red-500/20 text-red-400' : 'bg-slate-500/20 text-slate-600')}>{(ap.suggested_action || '').replace('_', ' ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {impactResult.suggested_new_audits && impactResult.suggested_new_audits.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">Suggested New Audits</h3>
                  <div className="space-y-2">
                    {impactResult.suggested_new_audits.map((sa: any, idx: number) => (
                      <div key={idx} className="bg-white/50 rounded-lg p-3 border border-emerald-500/20">
                        <div className="flex items-center justify-between"><p className="text-sm text-slate-900">{sa.name}</p><span className="text-xs text-slate-500">{sa.suggested_quarter}</span></div>
                        <p className="text-xs text-slate-600">{sa.rationale}</p>
                        <span className={"text-xs px-2 py-0.5 rounded mt-1 inline-block " + (sa.priority === 'critical' ? 'bg-red-500/20 text-red-400' : sa.priority === 'high' ? 'bg-orange-500/20 text-orange-400' : 'bg-amber-500/20 text-amber-400')}>{sa.priority}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
