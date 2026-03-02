'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import {
  Plus,
  X,
  Search,
  Upload,
  Download,
  Layers,
  AlertTriangle,
  Clock,
  CheckCircle2,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Calendar,
  User,
  Tag,
  FileText,
  Shield,
  Pencil,
  Sparkles,
  Loader2,
  Paperclip,
} from 'lucide-react';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  observation: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-500/20 text-red-400 border-red-500/30',
  in_progress: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  management_agreed: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  remediated: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  closed: 'bg-slate-500/20 text-slate-600 border-slate-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  management_agreed: 'Management Agreed',
  remediated: 'Remediated',
  closed: 'Closed',
};

const CCCE_BORDERS: Record<string, string> = {
  Condition: 'border-red-500',
  Criteria: 'border-blue-500',
  Cause: 'border-amber-500',
  Effect: 'border-purple-500',
};

export default function AuditFindingsPage() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingFinding, setEditingFinding] = useState<any>(null);
  const [editFindingForm, setEditFindingForm] = useState({
    engagement_id: '',
    title: '',
    condition: '',
    criteria: '',
    cause: '',
    effect: '',
    root_cause_category: 'process',
    severity: 'medium',
    theme: '',
    due_date: '',
    status: 'open',
  });
  const [newFinding, setNewFinding] = useState({
    engagement_id: '',
    title: '',
    condition: '',
    criteria: '',
    cause: '',
    effect: '',
    root_cause_category: 'process',
    severity: 'medium',
    theme: '',
    due_date: '',
  });
  const [newFindingAttachment, setNewFindingAttachment] = useState<File | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ message: string; created: number; skipped: number; errors: string[] } | null>(null);
  const [groupByEngagement, setGroupByEngagement] = useState(false);
  const [aiDrafting, setAiDrafting] = useState(false);
  const [checkingSimilarity, setCheckingSimilarity] = useState(false);
  const [similarFindings, setSimilarFindings] = useState<any[]>([]);

  const { data: findings, refetch, isLoading } = useQuery({
    queryKey: ['audit-findings', filters],
    queryFn: () => auditApi.findings.getAll(filters).then(r => r.data?.findings || r.data || []),
  });

  const { data: overdue } = useQuery({
    queryKey: ['overdue-findings'],
    queryFn: () => auditApi.findings.getOverdue().then(r => r.data?.findings || r.data || []),
  });

  const { data: themes } = useQuery({
    queryKey: ['finding-themes'],
    queryFn: () => auditApi.findings.getThemes().then(r => r.data?.themes || r.data || []),
  });

  const { data: engagements } = useQuery({
    queryKey: ['engagements-list'],
    queryFn: () => auditApi.engagements.getAll().then(r => r.data?.engagements || r.data || []),
  });

  const { data: groupedFindings, isLoading: groupedLoading, refetch: refetchGrouped } = useQuery({
    queryKey: ['audit-findings-grouped', filters],
    queryFn: () => auditApi.findings.getGroupedByEngagement(filters).then(r => r.data),
    enabled: groupByEngagement,
  });

  const createMutation = useMutation({
    mutationFn: ({ data, attachment }: { data: Record<string, unknown>; attachment?: File | null }) => {
      if (attachment) {
        const formData = new FormData();
        Object.entries(data).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            formData.append(key, String(value));
          }
        });
        formData.append('attachment', attachment);
        return auditApi.findings.createWithAttachment(formData).then(r => r.data);
      }
      return auditApi.findings.create(data).then(r => r.data);
    },
    onSuccess: () => {
      refetch();
      setShowCreateModal(false);
      setNewFinding({ engagement_id: '', title: '', condition: '', criteria: '', cause: '', effect: '', root_cause_category: 'process', severity: 'medium', theme: '', due_date: '' });
      setNewFindingAttachment(null);
      setSimilarFindings([]);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => auditApi.findings.update(id, data).then(r => r.data),
    onSuccess: () => {
      refetch();
      setShowEditModal(false);
    },
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => auditApi.findings.importFile(file).then(r => r.data),
    onSuccess: (data) => {
      setImportResult({
        message: data?.message || 'Import completed',
        created: data?.created || 0,
        skipped: data?.skipped || 0,
        errors: data?.errors || [],
      });
      setImportFile(null);
      refetch();
      refetchGrouped();
    },
    onError: (err: any) => {
      setImportResult({
        message: err?.response?.data?.detail || 'Import failed',
        created: 0,
        skipped: 0,
        errors: [err?.response?.data?.detail || 'Unknown error'],
      });
    },
  });

  const openEditFinding = (finding: any) => {
    setEditingFinding(finding);
    setEditFindingForm({
      engagement_id: finding.engagement_id ? String(finding.engagement_id) : '',
      title: finding.title || '',
      condition: finding.condition || '',
      criteria: finding.criteria || '',
      cause: finding.cause || '',
      effect: finding.effect || '',
      root_cause_category: finding.root_cause_category || 'process',
      severity: finding.severity || 'medium',
      theme: finding.theme || '',
      due_date: finding.due_date ? finding.due_date.split('T')[0] : '',
      status: finding.status || 'open',
    });
    setShowEditModal(true);
  };

  const handleEditSave = () => {
    if (!editingFinding) return;
    const payload: Record<string, unknown> = {
      title: editFindingForm.title,
      condition: editFindingForm.condition,
      criteria: editFindingForm.criteria,
      cause: editFindingForm.cause,
      effect: editFindingForm.effect,
      root_cause_category: editFindingForm.root_cause_category,
      severity: editFindingForm.severity,
      status: editFindingForm.status,
    };
    if (editFindingForm.engagement_id) payload.engagement_id = parseInt(editFindingForm.engagement_id);
    if (editFindingForm.theme) payload.theme = editFindingForm.theme;
    if (editFindingForm.due_date) payload.due_date = editFindingForm.due_date;
    updateMutation.mutate({ id: editingFinding.id, data: payload });
  };

  const handleCreate = () => {
    const data: Record<string, unknown> = {
      title: newFinding.title,
      condition: newFinding.condition,
      criteria: newFinding.criteria,
      cause: newFinding.cause,
      effect: newFinding.effect,
      root_cause_category: newFinding.root_cause_category,
      severity: newFinding.severity,
    };
    if (newFinding.engagement_id) data.engagement_id = parseInt(newFinding.engagement_id);
    if (newFinding.theme) data.theme = newFinding.theme;
    if (newFinding.due_date) data.due_date = newFinding.due_date;
    createMutation.mutate({ data, attachment: newFindingAttachment });
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await auditApi.findings.downloadTemplate();
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit_findings_template_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download findings template', err);
    }
  };

  const handleAiDraft = async () => {
    if (!newFinding.engagement_id || !newFinding.title) return;
    setAiDrafting(true);
    try {
      const res = await auditApi.ai.draftFinding({
        engagement_id: parseInt(newFinding.engagement_id),
        anomaly_description: newFinding.title,
      });
      const d = res.data?.draft_finding || res.data;
      setNewFinding(prev => ({
        ...prev,
        condition: d.condition || prev.condition,
        criteria: d.criteria || prev.criteria,
        cause: d.cause || prev.cause,
        effect: d.effect || prev.effect,
        severity: d.severity || prev.severity,
        root_cause_category: d.root_cause_category || prev.root_cause_category,
      }));
    } catch (err) { console.error('AI draft failed:', err); }
    finally { setAiDrafting(false); }
  };

  const handleCheckSimilarity = async () => {
    if (!newFinding.title) return;
    setCheckingSimilarity(true);
    setSimilarFindings([]);
    try {
      const res = await auditApi.ai.findingSimilarity({
        title: newFinding.title,
        condition: newFinding.condition || '',
      });
      setSimilarFindings(res.data?.similar_findings || []);
    } catch (err) { console.error('Similarity check failed:', err); }
    finally { setCheckingSimilarity(false); }
  };

  const items = Array.isArray(findings) ? findings : [];
  const overdueItems = Array.isArray(overdue) ? overdue : [];
  const themeList = Array.isArray(themes) ? themes : [];
  const engagementList = Array.isArray(engagements) ? engagements : [];

  const filteredItems = searchTerm
    ? items.filter((f: any) =>
        f.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.finding_number?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : items;

  const groups = Array.isArray(groupedFindings?.groups) ? groupedFindings.groups : [];
  const filteredGroups = groups
    .map((group: any) => ({
      ...group,
      findings: Array.isArray(group.findings)
        ? group.findings.filter((f: any) =>
            !searchTerm ||
            f.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            f.finding_number?.toLowerCase().includes(searchTerm.toLowerCase())
          )
        : [],
    }))
    .filter((g: any) => g.findings.length > 0);

  const totalFindings = items.length;
  const openFindings = items.filter((f: any) => f.status === 'open' || f.status === 'in_progress').length;
  const overdueCount = overdueItems.length;
  const closedFindings = items.filter((f: any) => f.status === 'closed' || f.status === 'remediated').length;
  const closureRate = totalFindings > 0 ? Math.round((closedFindings / totalFindings) * 100) : 0;

  const updateFilter = (key: string, value: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value) {
        next[key] = value;
      } else {
        delete next[key];
      }
      return next;
    });
  };

  const isOverdue = (dueDate: string) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Findings</h1>
          <p className="text-slate-600 mt-1">Track and manage audit findings across engagements</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-sm transition-colors"
          >
            <Download className="w-4 h-4" />
            Download Template
          </button>
          <label className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-sm transition-colors cursor-pointer">
            <Upload className="w-4 h-4" />
            {importFile ? importFile.name : 'Upload Findings File'}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            />
          </label>
          <button
            onClick={() => importFile && importMutation.mutate(importFile)}
            disabled={!importFile || importMutation.isPending}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Import
          </button>
          <button
            onClick={() => setGroupByEngagement((v) => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border ${groupByEngagement ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
          >
            <Layers className="w-4 h-4" />
            {groupByEngagement ? 'Grouped View' : 'Group by Engagement'}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Finding
          </button>
        </div>
      </div>

      {importResult && (
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-sm text-slate-700">
            {importResult.message} · Created: {importResult.created} · Skipped: {importResult.skipped}
          </p>
          {importResult.errors.length > 0 && (
            <div className="mt-2 max-h-24 overflow-y-auto">
              {importResult.errors.map((err, idx) => (
                <p key={idx} className="text-xs text-red-400">{err}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 rounded-lg">
              <FileText className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Total Findings</p>
              <p className="text-2xl font-bold text-slate-900">{totalFindings}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Open</p>
              <p className="text-2xl font-bold text-slate-900">{openFindings}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-500/10 rounded-lg">
              <Clock className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Overdue</p>
              <p className="text-2xl font-bold text-slate-900">{overdueCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Closure Rate</p>
              <p className="text-2xl font-bold text-slate-900">{closureRate}%</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search findings..."
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>
          <select
            value={filters.severity || ''}
            onChange={(e) => updateFilter('severity', e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="observation">Observation</option>
          </select>
          <select
            value={filters.status || ''}
            onChange={(e) => updateFilter('status', e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="management_agreed">Management Agreed</option>
            <option value="remediated">Remediated</option>
            <option value="closed">Closed</option>
          </select>
          <select
            value={filters.theme || ''}
            onChange={(e) => updateFilter('theme', e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">All Themes</option>
            {themeList.map((t: any) => (
              <option key={typeof t === 'string' ? t : t.theme} value={typeof t === 'string' ? t : t.theme}>
                {typeof t === 'string' ? t : t.theme}
              </option>
            ))}
          </select>
          {Object.keys(filters).length > 0 && (
            <button
              onClick={() => setFilters({})}
              className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {groupByEngagement ? (
        groupedLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="text-center py-20">
            <AlertTriangle className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-600">No grouped findings found</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredGroups.map((group: any) => (
              <div key={group.engagement_id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">{group.engagement_title}</h3>
                  <span className="text-xs text-slate-600">{group.total_findings} finding(s)</span>
                </div>
                <div className="divide-y divide-slate-200">
                  {group.findings.map((finding: any) => {
                    const overdueFlag = finding.due_date && isOverdue(finding.due_date) && finding.status !== 'closed' && finding.status !== 'remediated';
                    return (
                      <div key={finding.id} className="px-5 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{finding.title}</p>
                          <p className="text-xs text-slate-500">{finding.finding_number || `#${finding.id}`}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          <span className={`px-2 py-0.5 rounded-full text-xs border ${SEVERITY_COLORS[finding.severity] || 'bg-slate-500/20 text-slate-600 border-slate-500/30'}`}>
                            {finding.severity}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[finding.status] || 'bg-slate-500/20 text-slate-600 border-slate-500/30'}`}>
                            {STATUS_LABELS[finding.status] || finding.status}
                          </span>
                          {overdueFlag && <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400 border border-red-500/30">Overdue</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      ) : isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-20">
          <AlertTriangle className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-600">No findings found</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
          >
            Create First Finding
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((finding: any) => {
            const isExpanded = expandedId === finding.id;
            const dueDateOverdue = finding.due_date && isOverdue(finding.due_date) && finding.status !== 'closed' && finding.status !== 'remediated';

            return (
              <div
                key={finding.id}
                className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:border-slate-300/50 transition-colors"
              >
                <div
                  className="p-5 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : finding.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                        {finding.finding_number && (
                          <span className="text-xs font-mono text-slate-500">{finding.finding_number}</span>
                        )}
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${SEVERITY_COLORS[finding.severity] || 'bg-slate-500/20 text-slate-600 border-slate-500/30'}`}>
                          {finding.severity ? finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1) : 'N/A'}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[finding.status] || 'bg-slate-500/20 text-slate-600 border-slate-500/30'}`}>
                          {STATUS_LABELS[finding.status] || finding.status}
                        </span>
                        {dueDateOverdue && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                            Overdue
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-semibold text-slate-900 truncate">{finding.title}</h3>
                      <div className="flex items-center gap-4 mt-2 flex-wrap">
                        {finding.engagement_title && (
                          <span className="flex items-center gap-1.5 text-sm text-slate-600">
                            <FileText className="w-3.5 h-3.5" />
                            {finding.engagement_title}
                          </span>
                        )}
                        {(finding.owner_name || finding.owner) && (
                          <span className="flex items-center gap-1.5 text-sm text-slate-600">
                            <User className="w-3.5 h-3.5" />
                            {finding.owner_name || finding.owner}
                          </span>
                        )}
                        {finding.due_date && (
                          <span className={`flex items-center gap-1.5 text-sm ${dueDateOverdue ? 'text-red-400' : 'text-slate-600'}`}>
                            <Calendar className="w-3.5 h-3.5" />
                            {new Date(finding.due_date).toLocaleDateString()}
                          </span>
                        )}
                        {finding.theme && (
                          <span className="flex items-center gap-1.5 text-sm text-slate-600">
                            <Tag className="w-3.5 h-3.5" />
                            {finding.theme}
                          </span>
                        )}
                      </div>
                      {finding.framework_mappings && finding.framework_mappings.length > 0 && (
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <Shield className="w-3.5 h-3.5 text-slate-500" />
                          {finding.framework_mappings.map((fw: any, idx: number) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700 border border-slate-300/50"
                            >
                              {typeof fw === 'string' ? fw : fw.framework_name || fw.control_ref || fw.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="ml-4 flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditFinding(finding); }}
                        className="p-1 text-slate-600 hover:text-blue-400 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <span className="text-slate-600">
                        {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </span>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-200 p-5 space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {[
                        { label: 'Condition', value: finding.condition },
                        { label: 'Criteria', value: finding.criteria },
                        { label: 'Cause', value: finding.cause },
                        { label: 'Effect', value: finding.effect },
                      ].map((item) => (
                        item.value && (
                          <div
                            key={item.label}
                            className={`border-l-4 ${CCCE_BORDERS[item.label]} bg-white/50 rounded-r-lg p-4`}
                          >
                            <h4 className="text-sm font-semibold text-slate-700 mb-1.5">{item.label}</h4>
                            <p className="text-sm text-slate-600 leading-relaxed">{item.value}</p>
                          </div>
                        )
                      ))}
                    </div>

                    {finding.root_cause_category && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500">Root Cause:</span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-300/50 capitalize">
                          {finding.root_cause_category}
                        </span>
                      </div>
                    )}

                    {finding.management_responses && finding.management_responses.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-slate-700 mb-3">Management Responses</h4>
                        <div className="space-y-3">
                          {finding.management_responses.map((resp: any, idx: number) => (
                            <div key={idx} className="bg-white/50 rounded-lg p-4 border border-slate-200/30">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-slate-700">
                                  {resp.responder_name || resp.responder || `Response ${idx + 1}`}
                                </span>
                                {resp.agreed !== undefined && (
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${resp.agreed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                    {resp.agreed ? 'Agreed' : 'Disagreed'}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-slate-600">{resp.response || resp.comments || resp.text}</p>
                              {resp.action_plan && (
                                <p className="text-sm text-slate-600 mt-2">
                                  <span className="text-slate-500">Action Plan:</span> {resp.action_plan}
                                </p>
                              )}
                              {resp.target_date && (
                                <p className="text-xs text-slate-500 mt-1">
                                  Target: {new Date(resp.target_date).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {finding.recommendations && finding.recommendations.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-slate-700 mb-3">Recommendations</h4>
                        <div className="space-y-2">
                          {finding.recommendations.map((rec: any, idx: number) => (
                            <div key={idx} className="bg-white/50 rounded-lg p-4 border border-slate-200/30">
                              <p className="text-sm text-slate-600">
                                {typeof rec === 'string' ? rec : rec.description || rec.text || rec.recommendation}
                              </p>
                              {rec.priority && (
                                <span className="inline-block mt-2 px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700 capitalize">
                                  {rec.priority}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {finding.follow_ups && finding.follow_ups.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-slate-700 mb-3">Follow-ups</h4>
                        <div className="space-y-2">
                          {finding.follow_ups.map((fu: any, idx: number) => (
                            <div key={idx} className="bg-white/50 rounded-lg p-4 border border-slate-200/30">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-slate-500">
                                  {fu.follow_up_date ? new Date(fu.follow_up_date).toLocaleDateString() : `Follow-up ${idx + 1}`}
                                </span>
                                {fu.status && (
                                  <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700 capitalize">
                                    {fu.status}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-slate-600">{fu.notes || fu.description || fu.comments}</p>
                            </div>
                          ))}
                        </div>
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Create Finding</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Engagement</label>
                <select
                  value={newFinding.engagement_id}
                  onChange={(e) => setNewFinding({ ...newFinding, engagement_id: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="">Select Engagement</option>
                  {engagementList.map((eng: any) => (
                    <option key={eng.id} value={eng.id}>
                      {eng.engagement_number ? `${eng.engagement_number} - ` : ''}{eng.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={newFinding.title}
                  onChange={(e) => setNewFinding({ ...newFinding, title: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Finding title"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAiDraft}
                  disabled={aiDrafting || !newFinding.engagement_id || !newFinding.title}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:from-purple-800 disabled:to-blue-800 disabled:opacity-50 text-slate-900 rounded-lg text-sm font-medium transition-all"
                >
                  {aiDrafting ? <><Loader2 className="h-4 w-4 animate-spin" />AI Drafting...</> : <><Sparkles className="h-4 w-4" />AI Draft Finding</>}
                </button>
                <button
                  type="button"
                  onClick={handleCheckSimilarity}
                  disabled={checkingSimilarity || !newFinding.title}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 disabled:opacity-50 text-slate-900 rounded-lg text-sm font-medium transition-all"
                >
                  {checkingSimilarity ? <><Loader2 className="h-4 w-4 animate-spin" />Checking...</> : <><Search className="h-4 w-4" />Check Similar</>}
                </button>
              </div>
              {similarFindings.length > 0 && (
                <div className="bg-white/80 border border-indigo-500/30 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-indigo-300 mb-3">Similar Past Findings ({similarFindings.length})</h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {similarFindings.map((sf: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between bg-white rounded p-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-slate-500">{sf.finding_number}</span>
                            <span className="text-sm text-slate-900 truncate">{sf.title}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-slate-500">{sf.engagement_title}</span>
                            {sf.is_recurring && <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">Recurring</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-2">
                          <span className={"px-2 py-0.5 rounded text-xs " + (sf.severity === 'critical' || sf.severity === 'high' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400')}>{sf.severity}</span>
                          <span className={"px-2 py-0.5 rounded text-xs font-bold " + (sf.similarity_pct >= 70 ? 'bg-red-500/20 text-red-400' : sf.similarity_pct >= 50 ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400')}>{sf.similarity_pct}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Condition</label>
                <textarea
                  value={newFinding.condition}
                  onChange={(e) => setNewFinding({ ...newFinding, condition: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="What was found (current state)..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Criteria</label>
                <textarea
                  value={newFinding.criteria}
                  onChange={(e) => setNewFinding({ ...newFinding, criteria: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="What should be (expected state)..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cause</label>
                <textarea
                  value={newFinding.cause}
                  onChange={(e) => setNewFinding({ ...newFinding, cause: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Why the condition exists..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Effect</label>
                <textarea
                  value={newFinding.effect}
                  onChange={(e) => setNewFinding({ ...newFinding, effect: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Impact or risk of the condition..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Root Cause Category</label>
                  <select
                    value={newFinding.root_cause_category}
                    onChange={(e) => setNewFinding({ ...newFinding, root_cause_category: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  >
                    <option value="people">People</option>
                    <option value="process">Process</option>
                    <option value="technology">Technology</option>
                    <option value="governance">Governance</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Severity *</label>
                  <select
                    value={newFinding.severity}
                    onChange={(e) => setNewFinding({ ...newFinding, severity: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="observation">Observation</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Theme</label>
                  <input
                    type="text"
                    value={newFinding.theme}
                    onChange={(e) => setNewFinding({ ...newFinding, theme: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="e.g. Access Control"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newFinding.due_date}
                    onChange={(e) => setNewFinding({ ...newFinding, due_date: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Attachment</label>
                <label className="w-full flex items-center justify-between px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 cursor-pointer hover:bg-slate-50 transition-colors">
                  <span className="flex items-center gap-2 text-sm text-slate-700">
                    <Paperclip className="w-4 h-4" />
                    {newFindingAttachment ? newFindingAttachment.name : 'Choose file (PDF, image, DOC, XLS, etc.)'}
                  </span>
                  <span className="text-xs text-slate-500">Any file</span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => setNewFindingAttachment(e.target.files?.[0] || null)}
                  />
                </label>
                {newFindingAttachment && (
                  <button
                    type="button"
                    onClick={() => setNewFindingAttachment(null)}
                    className="mt-2 text-xs text-slate-600 hover:text-slate-900"
                  >
                    Remove attachment
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-200">
              <button
                onClick={() => { setShowCreateModal(false); setNewFindingAttachment(null); }}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newFinding.title || createMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                {createMutation.isPending ? 'Creating...' : 'Create Finding'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && editingFinding && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Edit Finding</h2>
              <button onClick={() => setShowEditModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={editFindingForm.status}
                  onChange={(e) => setEditFindingForm({ ...editFindingForm, status: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="management_agreed">Management Agreed</option>
                  <option value="remediated">Remediated</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Engagement</label>
                <select
                  value={editFindingForm.engagement_id}
                  onChange={(e) => setEditFindingForm({ ...editFindingForm, engagement_id: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="">Select Engagement</option>
                  {engagementList.map((eng: any) => (
                    <option key={eng.id} value={eng.id}>
                      {eng.engagement_number ? `${eng.engagement_number} - ` : ''}{eng.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={editFindingForm.title}
                  onChange={(e) => setEditFindingForm({ ...editFindingForm, title: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Finding title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Condition</label>
                <textarea
                  value={editFindingForm.condition}
                  onChange={(e) => setEditFindingForm({ ...editFindingForm, condition: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="What was found (current state)..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Criteria</label>
                <textarea
                  value={editFindingForm.criteria}
                  onChange={(e) => setEditFindingForm({ ...editFindingForm, criteria: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="What should be (expected state)..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cause</label>
                <textarea
                  value={editFindingForm.cause}
                  onChange={(e) => setEditFindingForm({ ...editFindingForm, cause: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Why the condition exists..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Effect</label>
                <textarea
                  value={editFindingForm.effect}
                  onChange={(e) => setEditFindingForm({ ...editFindingForm, effect: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Impact or risk of the condition..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Root Cause Category</label>
                  <select
                    value={editFindingForm.root_cause_category}
                    onChange={(e) => setEditFindingForm({ ...editFindingForm, root_cause_category: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  >
                    <option value="people">People</option>
                    <option value="process">Process</option>
                    <option value="technology">Technology</option>
                    <option value="governance">Governance</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Severity *</label>
                  <select
                    value={editFindingForm.severity}
                    onChange={(e) => setEditFindingForm({ ...editFindingForm, severity: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="observation">Observation</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Theme</label>
                  <input
                    type="text"
                    value={editFindingForm.theme}
                    onChange={(e) => setEditFindingForm({ ...editFindingForm, theme: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="e.g. Access Control"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={editFindingForm.due_date}
                    onChange={(e) => setEditFindingForm({ ...editFindingForm, due_date: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-200">
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={!editFindingForm.title || updateMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}