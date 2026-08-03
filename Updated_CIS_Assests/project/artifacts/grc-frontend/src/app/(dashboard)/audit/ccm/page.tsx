'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Plus,
  X,
  Search,
  Shield,
  AlertTriangle,
  Activity,
  Eye,
  Edit2,
  Trash2,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Clock,
  DollarSign,
  FileText,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  TrendingUp,
} from 'lucide-react';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

const STATUS_COLORS: Record<string, string> = {
  flagged: 'bg-red-500/20 text-red-400 border-red-500/30',
  escalated: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  accepted: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  closed: 'bg-slate-500/20 text-slate-600 border-slate-500/30',
  finding_created: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const RULE_TYPE_LABELS: Record<string, string> = {
  threshold: 'Threshold',
  pattern: 'Pattern',
  statistical: 'Statistical',
  ml_anomaly: 'ML Anomaly',
};

const OPERATOR_LABELS: Record<string, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  neq: '≠',
};

interface CCMRule {
  id: number;
  rule_code: string;
  name: string;
  description?: string;
  control_area: string;
  rule_type: string;
  threshold_value?: number;
  threshold_operator?: string;
  severity: string;
  is_active: boolean;
  created_at?: string;
}

interface CCMAnomaly {
  id: number;
  rule_id: number;
  rule_code?: string;
  rule_name?: string;
  title: string;
  description?: string;
  severity: string;
  detected_at?: string;
  transaction_ref?: string;
  transaction_amount?: number;
  control_area?: string;
  is_false_positive: boolean;
  status: string;
  exceptions?: Array<{
    id: number;
    workflow_status: string;
    decision?: string;
    decision_notes?: string;
  }>;
}

const emptyRuleForm = {
  rule_code: '',
  name: '',
  description: '',
  control_area: '',
  rule_type: 'threshold',
  threshold_value: '',
  threshold_operator: 'gt',
  severity: 'medium',
};

export default function CCMPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'rules' | 'anomalies'>('rules');
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('audit:audit_management:create');
  const canEdit = hasPermission('audit:audit_management:edit');
  const canDelete = hasPermission('audit:audit_management:delete');
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<CCMRule | null>(null);
  const [ruleForm, setRuleForm] = useState(emptyRuleForm);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewingAnomaly, setReviewingAnomaly] = useState<CCMAnomaly | null>(null);
  const [reviewDecision, setReviewDecision] = useState('false_positive');
  const [reviewNotes, setReviewNotes] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAIInsights, setShowAIInsights] = useState(false);
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const { data: statsData } = useQuery({
    queryKey: ['ccm-stats'],
    queryFn: () => auditApi.ccm.getStats().then(r => r.data),
  });

  const { data: rulesData, refetch: refetchRules } = useQuery({
    queryKey: ['ccm-rules'],
    queryFn: () => auditApi.ccm.getRules().then(r => r.data),
  });

  const { data: anomaliesData, refetch: refetchAnomalies } = useQuery({
    queryKey: ['ccm-anomalies'],
    queryFn: () => auditApi.ccm.getAnomalies().then(r => r.data),
  });

  const createRuleMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.ccm.createRule(data),
    onSuccess: () => {
      refetchRules();
      queryClient.invalidateQueries({ queryKey: ['ccm-stats'] });
      closeRuleModal();
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => auditApi.ccm.updateRule(id, data),
    onSuccess: () => {
      refetchRules();
      queryClient.invalidateQueries({ queryKey: ['ccm-stats'] });
      closeRuleModal();
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id: number) => auditApi.ccm.deleteRule(id),
    onSuccess: () => {
      refetchRules();
      queryClient.invalidateQueries({ queryKey: ['ccm-stats'] });
    },
  });

  const toggleRuleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      auditApi.ccm.updateRule(id, { is_active }),
    onSuccess: () => {
      refetchRules();
      queryClient.invalidateQueries({ queryKey: ['ccm-stats'] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      auditApi.ccm.reviewAnomaly(id, data),
    onSuccess: () => {
      refetchAnomalies();
      queryClient.invalidateQueries({ queryKey: ['ccm-stats'] });
      setShowReviewModal(false);
      setReviewingAnomaly(null);
      setReviewDecision('false_positive');
      setReviewNotes('');
    },
  });

  const stats = statsData?.stats || {};
  const rules: CCMRule[] = rulesData?.rules || [];
  const anomalies: CCMAnomaly[] = anomaliesData?.anomalies || [];

  const filteredRules = rules.filter(r =>
    !searchTerm ||
    r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.rule_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.control_area.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredAnomalies = anomalies.filter(a =>
    !searchTerm ||
    a.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (a.rule_name && a.rule_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (a.transaction_ref && a.transaction_ref.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  function closeRuleModal() {
    setShowRuleModal(false);
    setEditingRule(null);
    setRuleForm(emptyRuleForm);
  }

  function openAddRule() {
    setRuleForm(emptyRuleForm);
    setEditingRule(null);
    setShowRuleModal(true);
  }

  function openEditRule(rule: CCMRule) {
    setEditingRule(rule);
    setRuleForm({
      rule_code: rule.rule_code,
      name: rule.name,
      description: rule.description || '',
      control_area: rule.control_area,
      rule_type: rule.rule_type,
      threshold_value: rule.threshold_value?.toString() || '',
      threshold_operator: rule.threshold_operator || 'gt',
      severity: rule.severity,
    });
    setShowRuleModal(true);
  }

  function handleSaveRule() {
    const payload: Record<string, unknown> = {
      rule_code: ruleForm.rule_code,
      name: ruleForm.name,
      description: ruleForm.description || undefined,
      control_area: ruleForm.control_area,
      rule_type: ruleForm.rule_type,
      threshold_value: ruleForm.threshold_value ? parseFloat(ruleForm.threshold_value) : undefined,
      threshold_operator: ruleForm.threshold_operator || undefined,
      severity: ruleForm.severity,
    };

    if (editingRule) {
      updateRuleMutation.mutate({ id: editingRule.id, data: payload });
    } else {
      createRuleMutation.mutate(payload);
    }
  }

  function openReview(anomaly: CCMAnomaly) {
    setReviewingAnomaly(anomaly);
    setReviewDecision('false_positive');
    setReviewNotes('');
    setShowReviewModal(true);
  }

  function handleReview() {
    if (!reviewingAnomaly) return;
    reviewMutation.mutate({
      id: reviewingAnomaly.id,
      data: {
        decision: reviewDecision,
        decision_notes: reviewNotes || undefined,
      },
    });
  }

  async function fetchAIInsights() {
    setAiLoading(true);
    try {
      const res = await auditApi.ai.getCCMInsights({
        anomaly_count: anomalies.length,
        rule_count: rules.length,
        high_severity_count: stats.high_severity_active || 0,
        false_positive_rate: stats.false_positive_rate || 0,
      });
      setAiInsights(res.data);
      setShowAIInsights(true);
    } catch {
      setAiInsights({ error: 'Failed to get AI insights. Please try again.' });
      setShowAIInsights(true);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Continuous Control Monitoring</h1>
          <p className="text-slate-600 mt-1">Monitor controls in real-time and detect anomalies automatically</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchAIInsights}
            disabled={aiLoading}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600/20 text-purple-400 border border-purple-500/30 rounded-lg hover:bg-purple-600/30 transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            {aiLoading ? 'Analyzing...' : 'Get AI Insights'}
          </button>
          {canCreate && (
          <button
            onClick={openAddRule}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Rule
          </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
            <Shield className="w-4 h-4" />
            Active Rules
          </div>
          <div className="text-2xl font-bold text-slate-900">{stats.active_rules ?? 0}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
            <AlertTriangle className="w-4 h-4" />
            Total Anomalies
          </div>
          <div className="text-2xl font-bold text-slate-900">{stats.total_anomalies ?? 0}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
            <Clock className="w-4 h-4" />
            Today&apos;s Anomalies
          </div>
          <div className="text-2xl font-bold text-amber-400">{stats.today_anomalies ?? 0}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
            <Activity className="w-4 h-4" />
            High Severity Active
          </div>
          <div className="text-2xl font-bold text-red-400">{stats.high_severity_active ?? 0}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
            <TrendingUp className="w-4 h-4" />
            False Positive Rate
          </div>
          <div className="text-2xl font-bold text-slate-900">{stats.false_positive_rate ?? 0}%</div>
        </div>
      </div>

      {showAIInsights && aiInsights && (
        <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-400" />
              <h3 className="text-lg font-semibold text-purple-300">AI Insights</h3>
            </div>
            <button onClick={() => setShowAIInsights(false)} className="text-slate-600 hover:text-slate-900">
              <X className="w-5 h-5" />
            </button>
          </div>
          {aiInsights.error ? (
            <p className="text-red-400">{aiInsights.error}</p>
          ) : (
            <div className="space-y-3">
              {aiInsights.insights && typeof aiInsights.insights === 'string' && (
                <p className="text-slate-700 whitespace-pre-wrap">{aiInsights.insights}</p>
              )}
              {aiInsights.recommendations && Array.isArray(aiInsights.recommendations) && (
                <div>
                  <h4 className="text-purple-300 font-medium mb-2">Recommendations</h4>
                  <ul className="space-y-1">
                    {aiInsights.recommendations.map((rec: string, i: number) => (
                      <li key={i} className="text-slate-700 flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
                        {rec}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {typeof aiInsights === 'object' && !aiInsights.insights && !aiInsights.recommendations && !aiInsights.error && (
                <pre className="text-slate-700 text-sm whitespace-pre-wrap">{JSON.stringify(aiInsights, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-4">
        <div className="flex bg-white border border-slate-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setActiveTab('rules')}
            className={`px-6 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'rules'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Rules ({rules.length})
          </button>
          <button
            onClick={() => setActiveTab('anomalies')}
            className={`px-6 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'anomalies'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Anomalies ({anomalies.length})
          </button>
        </div>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
          <input
            type="text"
            placeholder={`Search ${activeTab}...`}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {activeTab === 'rules' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-600 uppercase">Code</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-600 uppercase">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-600 uppercase">Control Area</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-600 uppercase">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-600 uppercase">Threshold</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-600 uppercase">Severity</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-600 uppercase">Active</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-600 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRules.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                      No rules found. Click &quot;Add Rule&quot; to create one.
                    </td>
                  </tr>
                ) : (
                  filteredRules.map(rule => (
                    <tr key={rule.id} className="border-b border-slate-200/30 hover:bg-slate-100/20 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm text-blue-400">{rule.rule_code}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-900 text-sm">{rule.name}</td>
                      <td className="px-4 py-3 text-slate-700 text-sm">{rule.control_area}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-slate-100 text-slate-700 text-xs rounded">
                          {RULE_TYPE_LABELS[rule.rule_type] || rule.rule_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 text-sm font-mono">
                        {rule.threshold_operator && rule.threshold_value != null
                          ? `${OPERATOR_LABELS[rule.threshold_operator] || rule.threshold_operator} ${rule.threshold_value}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs rounded border ${SEVERITY_COLORS[rule.severity] || 'bg-slate-500/20 text-slate-600'}`}>
                          {rule.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleRuleMutation.mutate({ id: rule.id, is_active: !rule.is_active })}
                          className="transition-colors"
                        >
                          {rule.is_active ? (
                            <ToggleRight className="w-6 h-6 text-emerald-400" />
                          ) : (
                            <ToggleLeft className="w-6 h-6 text-slate-500" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {canEdit && (
                          <button
                            onClick={() => openEditRule(rule)}
                            className="p-1.5 text-slate-600 hover:text-blue-400 hover:bg-slate-100 rounded transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          )}
                          {canDelete && (
                          <button
                            onClick={() => {
                              if (confirm('Delete this rule?')) deleteRuleMutation.mutate(rule.id);
                            }}
                            className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-slate-100 rounded transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'anomalies' && (
        <div className="space-y-3">
          {filteredAnomalies.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500">
              No anomalies detected.
            </div>
          ) : (
            filteredAnomalies.map(anomaly => (
              <div
                key={anomaly.id}
                className="bg-white border border-slate-200 rounded-lg p-4 hover:border-slate-300/50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-slate-900 font-medium truncate">{anomaly.title}</h3>
                      <span className={`px-2 py-0.5 text-xs rounded border shrink-0 ${SEVERITY_COLORS[anomaly.severity] || 'bg-slate-500/20 text-slate-600'}`}>
                        {anomaly.severity}
                      </span>
                      <span className={`px-2 py-0.5 text-xs rounded border shrink-0 ${STATUS_COLORS[anomaly.status] || 'bg-slate-500/20 text-slate-600'}`}>
                        {anomaly.status?.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                      {anomaly.detected_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(anomaly.detected_at).toLocaleString()}
                        </span>
                      )}
                      {anomaly.transaction_ref && (
                        <span className="flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5" />
                          {anomaly.transaction_ref}
                        </span>
                      )}
                      {anomaly.transaction_amount != null && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="w-3.5 h-3.5" />
                          {anomaly.transaction_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      )}
                      {anomaly.control_area && (
                        <span className="flex items-center gap-1">
                          <Shield className="w-3.5 h-3.5" />
                          {anomaly.control_area}
                        </span>
                      )}
                      {anomaly.rule_name && (
                        <span className="flex items-center gap-1">
                          <Activity className="w-3.5 h-3.5" />
                          {anomaly.rule_name}
                        </span>
                      )}
                    </div>
                  </div>
                  {anomaly.status === 'flagged' && (
                    <button
                      onClick={() => openReview(anomaly)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/30 transition-colors shrink-0 ml-4"
                    >
                      <Eye className="w-4 h-4" />
                      Review
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {showRuleModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">
                {editingRule ? 'Edit Rule' : 'Add Rule'}
              </h2>
              <button onClick={closeRuleModal} className="text-slate-600 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-600 mb-1">Rule Code</label>
                  <input
                    type="text"
                    value={ruleForm.rule_code}
                    onChange={e => setRuleForm({ ...ruleForm, rule_code: e.target.value })}
                    placeholder="e.g. CCM-001"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                    disabled={!!editingRule}
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 mb-1">Severity</label>
                  <select
                    value={ruleForm.severity}
                    onChange={e => setRuleForm({ ...ruleForm, severity: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Name</label>
                <input
                  type="text"
                  value={ruleForm.name}
                  onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })}
                  placeholder="Rule name"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Description</label>
                <textarea
                  value={ruleForm.description}
                  onChange={e => setRuleForm({ ...ruleForm, description: e.target.value })}
                  placeholder="Rule description"
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Control Area</label>
                <input
                  type="text"
                  value={ruleForm.control_area}
                  onChange={e => setRuleForm({ ...ruleForm, control_area: e.target.value })}
                  placeholder="e.g. Access Control, Financial Transactions"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Rule Type</label>
                <select
                  value={ruleForm.rule_type}
                  onChange={e => setRuleForm({ ...ruleForm, rule_type: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
                >
                  <option value="threshold">Threshold</option>
                  <option value="pattern">Pattern</option>
                  <option value="statistical">Statistical</option>
                  <option value="ml_anomaly">ML Anomaly</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-600 mb-1">Threshold Operator</label>
                  <select
                    value={ruleForm.threshold_operator}
                    onChange={e => setRuleForm({ ...ruleForm, threshold_operator: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
                  >
                    <option value="gt">Greater than (&gt;)</option>
                    <option value="gte">Greater or equal (≥)</option>
                    <option value="lt">Less than (&lt;)</option>
                    <option value="lte">Less or equal (≤)</option>
                    <option value="eq">Equal (=)</option>
                    <option value="neq">Not equal (≠)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-600 mb-1">Threshold Value</label>
                  <input
                    type="number"
                    value={ruleForm.threshold_value}
                    onChange={e => setRuleForm({ ...ruleForm, threshold_value: e.target.value })}
                    placeholder="e.g. 10000"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-200">
              <button
                onClick={closeRuleModal}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRule}
                disabled={!ruleForm.rule_code || !ruleForm.name || !ruleForm.control_area}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingRule ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReviewModal && reviewingAnomaly && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Review Anomaly</h2>
              <button onClick={() => setShowReviewModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <h3 className="text-slate-900 font-medium mb-2">{reviewingAnomaly.title}</h3>
                <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                  <span className={`px-2 py-0.5 text-xs rounded border ${SEVERITY_COLORS[reviewingAnomaly.severity]}`}>
                    {reviewingAnomaly.severity}
                  </span>
                  {reviewingAnomaly.transaction_ref && <span>Ref: {reviewingAnomaly.transaction_ref}</span>}
                  {reviewingAnomaly.transaction_amount != null && (
                    <span>Amount: {reviewingAnomaly.transaction_amount.toLocaleString()}</span>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-2">Decision</label>
                <div className="space-y-2">
                  {[
                    { value: 'false_positive', label: 'False Positive', icon: XCircle, desc: 'Mark as false positive and close' },
                    { value: 'accept', label: 'Accept Risk', icon: CheckCircle2, desc: 'Accept the anomaly and close' },
                    { value: 'escalate', label: 'Escalate', icon: ArrowUpRight, desc: 'Escalate for further investigation' },
                    { value: 'create_finding', label: 'Create Finding', icon: FileText, desc: 'Create an audit finding from this anomaly' },
                  ].map(opt => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        reviewDecision === opt.value
                          ? 'border-blue-500/50 bg-blue-500/10'
                          : 'border-slate-200 hover:border-slate-300/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="decision"
                        value={opt.value}
                        checked={reviewDecision === opt.value}
                        onChange={e => setReviewDecision(e.target.value)}
                        className="sr-only"
                      />
                      <opt.icon className={`w-5 h-5 ${reviewDecision === opt.value ? 'text-blue-400' : 'text-slate-500'}`} />
                      <div>
                        <div className="text-slate-900 text-sm font-medium">{opt.label}</div>
                        <div className="text-slate-600 text-xs">{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Notes</label>
                <textarea
                  value={reviewNotes}
                  onChange={e => setReviewNotes(e.target.value)}
                  placeholder="Add review notes..."
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-200">
              <button
                onClick={() => setShowReviewModal(false)}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReview}
                disabled={reviewMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {reviewMutation.isPending ? 'Submitting...' : 'Submit Decision'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
