'use client';

import React, { useState } from 'react';
import { useParams } from 'wouter'
import { useRouter } from '@/lib/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Plus,
  X,
  Edit2,
  Trash2,
  Target,
  Shield,
  AlertTriangle,
  FileText,
  Loader2,
  BarChart3,
  ChevronRight,
  Send,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';

const QUARTER_COLORS: Record<string, string> = {
  Q1: 'bg-blue-100 text-blue-700 border-blue-200',
  Q2: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Q3: 'bg-amber-100 text-amber-700 border-amber-200',
  Q4: 'bg-purple-100 text-purple-700 border-purple-200',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  active: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-slate-200 text-slate-600',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-600',
  high: 'text-orange-600',
  medium: 'text-amber-600',
  low: 'text-emerald-600',
};

const ITEM_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  deferred: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-100 text-red-700',
};

const TABS = [
  { key: 'items', label: 'Plan Items', icon: FileText },
  { key: 'calendar', label: 'Calendar View', icon: Calendar },
  { key: 'budget', label: 'Budget & Risk', icon: BarChart3 },
];

export default function AuditPlanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('audit:audit_management:create');
  const canEdit = hasPermission('audit:audit_management:edit');
  const canDelete = hasPermission('audit:audit_management:delete');
  const planId = Number(params.id);
  const [activeTab, setActiveTab] = useState('items');
  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [approvalNotes, setApprovalNotes] = useState('');

  const [newItem, setNewItem] = useState({
    name: '', auditable_entity_id: '', risk_score: '', quarter: 'Q1',
    scheduled_start: '', scheduled_end: '', budget_days: '', priority: 'medium', notes: '',
  });

  const { data: plan, isLoading } = useQuery({
    queryKey: ['audit-plan', planId],
    queryFn: () => auditApi.plans.getById(planId).then(r => r.data),
    enabled: !!planId,
  });

  const { data: calendarData } = useQuery({
    queryKey: ['plan-calendar', planId],
    queryFn: () => auditApi.plans.getCalendar(planId).then(r => r.data),
    enabled: !!planId && activeTab === 'calendar',
  });

  const { data: entities } = useQuery({
    queryKey: ['entities-list'],
    queryFn: () => auditApi.universe.getAll().then(r => r.data?.entities || r.data || []),
  });

  const addItemMutation = useMutation({
    mutationFn: (data: any) => auditApi.plans.addItem(planId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-plan', planId] });
      setShowAddItem(false);
      setNewItem({ name: '', auditable_entity_id: '', risk_score: '', quarter: 'Q1', scheduled_start: '', scheduled_end: '', budget_days: '', priority: 'medium', notes: '' });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: any }) => auditApi.plans.updateItem(planId, itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-plan', planId] });
      setEditingItem(null);
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => auditApi.plans.deleteItem(planId, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['audit-plan', planId] }),
  });

  const approvalMutation = useMutation({
    mutationFn: (data: { action: string; notes?: string }) => auditApi.plans.approve(planId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-plan', planId] });
      setApprovalNotes('');
    },
  });

  const handleAddItem = () => {
    const data: any = {
      name: newItem.name,
      quarter: newItem.quarter,
      priority: newItem.priority,
    };
    if (newItem.auditable_entity_id) data.auditable_entity_id = parseInt(newItem.auditable_entity_id);
    if (newItem.risk_score) data.risk_score = parseFloat(newItem.risk_score);
    if (newItem.scheduled_start) data.scheduled_start = newItem.scheduled_start;
    if (newItem.scheduled_end) data.scheduled_end = newItem.scheduled_end;
    if (newItem.budget_days) data.budget_days = parseFloat(newItem.budget_days);
    if (newItem.notes) data.notes = newItem.notes;
    addItemMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="p-6">
        <button onClick={() => router.push('/audit/plans')} className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Plans
        </button>
        <p className="text-slate-600">Plan not found.</p>
      </div>
    );
  }

  const items = plan.items || [];
  const totalBudget = plan.total_budget_days || 0;
  const allocatedDays = items.reduce((s: number, i: any) => s + (i.budget_days || 0), 0);
  const quarterSummary = ['Q1', 'Q2', 'Q3', 'Q4'].map(q => ({
    quarter: q,
    count: items.filter((i: any) => i.quarter === q).length,
    days: items.filter((i: any) => i.quarter === q).reduce((s: number, i: any) => s + (i.budget_days || 0), 0),
  }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/audit/plans')} className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{plan.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-slate-600">FY {plan.fiscal_year}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[plan.approval_status] || STATUS_COLORS[plan.status] || 'bg-slate-100 text-slate-600'}`}>
                {(plan.approval_status || plan.status || '').replace(/_/g, ' ')}
              </span>
              {plan.ai_generated && <span className="px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-700">AI Generated</span>}
              {plan.risk_alignment_score != null && (
                <span className="text-xs text-slate-500 flex items-center gap-1"><Target className="w-3 h-3" /> Risk Alignment: {(plan.risk_alignment_score * 100).toFixed(0)}%</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {plan.approval_status === 'pending' && (
            <button onClick={() => approvalMutation.mutate({ action: 'submit', notes: approvalNotes })} className="flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">
              <Send className="w-4 h-4" /> Submit for Approval
            </button>
          )}
          {plan.approval_status === 'submitted' && (
            <>
              <button onClick={() => approvalMutation.mutate({ action: 'approve', notes: approvalNotes })} className="flex items-center gap-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm">
                <ThumbsUp className="w-4 h-4" /> Approve
              </button>
              <button onClick={() => approvalMutation.mutate({ action: 'reject', notes: approvalNotes })} className="flex items-center gap-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm">
                <ThumbsDown className="w-4 h-4" /> Reject
              </button>
            </>
          )}
        </div>
      </div>

      {plan.description && <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg">{plan.description}</p>}

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">Total Items</p>
          <p className="text-2xl font-bold text-slate-900">{items.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">Budget Days</p>
          <p className="text-2xl font-bold text-slate-900">{totalBudget}</p>
          <p className="text-xs text-slate-500">Allocated: {allocatedDays}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">Completed</p>
          <p className="text-2xl font-bold text-emerald-600">{items.filter((i: any) => i.status === 'completed').length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">Budget Utilization</p>
          <div className="flex items-end gap-1">
            <p className="text-2xl font-bold text-slate-900">{totalBudget ? ((allocatedDays / totalBudget) * 100).toFixed(0) : 0}%</p>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full mt-2">
            <div className={`h-full rounded-full ${allocatedDays > totalBudget ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${Math.min((allocatedDays / (totalBudget || 1)) * 100, 100)}%` }} />
          </div>
        </div>
      </div>

      <div className="flex gap-1 bg-white p-1 rounded-lg border border-slate-200 w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:text-slate-900'}`}>
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'items' && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">Plan Items ({items.length})</h2>
            {canCreate && (
            <button onClick={() => setShowAddItem(true)} className="flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">
              <Plus className="w-4 h-4" /> Add Item
            </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="p-8 text-center">
              <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">No items in this plan yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">Name</th>
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">Entity</th>
                    <th className="text-center px-4 py-3 text-slate-600 font-medium">Quarter</th>
                    <th className="text-center px-4 py-3 text-slate-600 font-medium">Risk</th>
                    <th className="text-center px-4 py-3 text-slate-600 font-medium">Priority</th>
                    <th className="text-center px-4 py-3 text-slate-600 font-medium">Days</th>
                    <th className="text-center px-4 py-3 text-slate-600 font-medium">Status</th>
                    <th className="text-right px-4 py-3 text-slate-600 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item: any) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{item.name}</td>
                      <td className="px-4 py-3 text-slate-600">{item.entity_name || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${QUARTER_COLORS[item.quarter] || 'bg-slate-100 text-slate-600'}`}>{item.quarter}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-600">{item.risk_score?.toFixed(0) || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-medium capitalize ${PRIORITY_COLORS[item.priority] || 'text-slate-600'}`}>{item.priority}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-600">{item.budget_days || 0}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ITEM_STATUS_COLORS[item.status] || 'bg-slate-100 text-slate-600'}`}>
                          {(item.status || 'scheduled').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canEdit && <button onClick={() => setEditingItem(item)} className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-blue-600"><Edit2 className="w-4 h-4" /></button>}
                          {canDelete && <button onClick={() => { if (confirm('Delete this item?')) deleteItemMutation.mutate(item.id); }} className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'calendar' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Quarterly Calendar</h2>
          <div className="grid grid-cols-4 gap-4">
            {['Q1', 'Q2', 'Q3', 'Q4'].map(q => {
              const qItems = items.filter((i: any) => i.quarter === q);
              return (
                <div key={q} className={`rounded-xl border-2 p-4 ${QUARTER_COLORS[q]?.replace('text-', 'border-').split(' ')[0] || 'border-slate-200'}`}>
                  <h3 className={`text-lg font-bold mb-3 ${QUARTER_COLORS[q]?.split(' ')[1] || 'text-slate-700'}`}>{q}</h3>
                  <p className="text-xs text-slate-500 mb-3">{qItems.length} audits · {qItems.reduce((s: number, i: any) => s + (i.budget_days || 0), 0)} days</p>
                  <div className="space-y-2">
                    {qItems.map((item: any) => (
                      <div key={item.id} className="bg-white rounded-lg p-3 shadow-sm border border-slate-100">
                        <p className="text-sm font-medium text-slate-900">{item.name}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-slate-500">{item.entity_name || 'Unassigned'}</span>
                          <span className={`text-xs font-medium capitalize ${PRIORITY_COLORS[item.priority] || ''}`}>{item.priority}</span>
                        </div>
                        {item.scheduled_start && (
                          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> {new Date(item.scheduled_start).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    ))}
                    {qItems.length === 0 && <p className="text-xs text-slate-400 italic">No audits scheduled</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'budget' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Budget Allocation</h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-medium text-slate-700 mb-3">By Quarter</h3>
                <div className="space-y-3">
                  {quarterSummary.map(q => (
                    <div key={q.quarter}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium text-slate-700">{q.quarter}</span>
                        <span className="text-slate-500">{q.days} days ({q.count} audits)</span>
                      </div>
                      <div className="w-full h-3 bg-slate-100 rounded-full">
                        <div className={`h-full rounded-full ${QUARTER_COLORS[q.quarter]?.split(' ')[0] || 'bg-blue-200'}`} style={{ width: `${totalBudget ? (q.days / totalBudget) * 100 : 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-slate-700 mb-3">By Priority</h3>
                <div className="space-y-3">
                  {['critical', 'high', 'medium', 'low'].map(p => {
                    const pItems = items.filter((i: any) => i.priority === p);
                    const pDays = pItems.reduce((s: number, i: any) => s + (i.budget_days || 0), 0);
                    return (
                      <div key={p}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className={`font-medium capitalize ${PRIORITY_COLORS[p]}`}>{p}</span>
                          <span className="text-slate-500">{pDays} days ({pItems.length})</span>
                        </div>
                        <div className="w-full h-3 bg-slate-100 rounded-full">
                          <div className={`h-full rounded-full ${p === 'critical' ? 'bg-red-400' : p === 'high' ? 'bg-orange-400' : p === 'medium' ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${totalBudget ? (pDays / totalBudget) * 100 : 0}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Risk Alignment</h2>
            <div className="space-y-2">
              {items.sort((a: any, b: any) => (b.risk_score || 0) - (a.risk_score || 0)).map((item: any) => (
                <div key={item.id} className="flex items-center gap-3">
                  <div className="w-48 text-sm text-slate-700 truncate">{item.name}</div>
                  <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${(item.risk_score || 0) >= 80 ? 'bg-red-400' : (item.risk_score || 0) >= 60 ? 'bg-orange-400' : (item.risk_score || 0) >= 40 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                      style={{ width: `${item.risk_score || 0}%` }} />
                  </div>
                  <span className="text-xs text-slate-500 w-12 text-right">{item.risk_score?.toFixed(0) || 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showAddItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Add Plan Item</h2>
              <button onClick={() => setShowAddItem(false)} className="text-slate-500 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
                <input value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50" placeholder="Audit name" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Entity</label>
                  <select value={newItem.auditable_entity_id} onChange={e => setNewItem({ ...newItem, auditable_entity_id: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                    <option value="">Select entity</option>
                    {(Array.isArray(entities) ? entities : []).map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quarter</label>
                  <select value={newItem.quarter} onChange={e => setNewItem({ ...newItem, quarter: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                    <option value="Q1">Q1</option><option value="Q2">Q2</option><option value="Q3">Q3</option><option value="Q4">Q4</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Risk Score</label>
                  <input type="number" value={newItem.risk_score} onChange={e => setNewItem({ ...newItem, risk_score: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50" placeholder="0-100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Budget Days</label>
                  <input type="number" value={newItem.budget_days} onChange={e => setNewItem({ ...newItem, budget_days: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50" placeholder="Days" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
                  <select value={newItem.priority} onChange={e => setNewItem({ ...newItem, priority: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                    <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                  <input type="date" value={newItem.scheduled_start} onChange={e => setNewItem({ ...newItem, scheduled_start: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                  <input type="date" value={newItem.scheduled_end} onChange={e => setNewItem({ ...newItem, scheduled_end: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea value={newItem.notes} onChange={e => setNewItem({ ...newItem, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none" placeholder="Additional notes..." />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-slate-200">
              <button onClick={() => setShowAddItem(false)} className="px-4 py-2 text-slate-600 hover:text-slate-900 text-sm">Cancel</button>
              <button onClick={handleAddItem} disabled={!newItem.name || addItemMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm">
                {addItemMutation.isPending ? 'Adding...' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Edit Plan Item</h2>
              <button onClick={() => setEditingItem(null)} className="text-slate-500 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input value={editingItem.name || ''} onChange={e => setEditingItem({ ...editingItem, name: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quarter</label>
                  <select value={editingItem.quarter || 'Q1'} onChange={e => setEditingItem({ ...editingItem, quarter: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                    <option value="Q1">Q1</option><option value="Q2">Q2</option><option value="Q3">Q3</option><option value="Q4">Q4</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
                  <select value={editingItem.priority || 'medium'} onChange={e => setEditingItem({ ...editingItem, priority: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                    <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                  <select value={editingItem.status || 'scheduled'} onChange={e => setEditingItem({ ...editingItem, status: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                    <option value="scheduled">Scheduled</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="deferred">Deferred</option><option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Budget Days</label>
                  <input type="number" value={editingItem.budget_days || ''} onChange={e => setEditingItem({ ...editingItem, budget_days: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Risk Score</label>
                  <input type="number" value={editingItem.risk_score || ''} onChange={e => setEditingItem({ ...editingItem, risk_score: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-slate-200">
              <button onClick={() => setEditingItem(null)} className="px-4 py-2 text-slate-600 hover:text-slate-900 text-sm">Cancel</button>
              <button onClick={() => updateItemMutation.mutate({ itemId: editingItem.id, data: { name: editingItem.name, quarter: editingItem.quarter, priority: editingItem.priority, status: editingItem.status, budget_days: editingItem.budget_days, risk_score: editingItem.risk_score } })}
                disabled={updateItemMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm">
                {updateItemMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
