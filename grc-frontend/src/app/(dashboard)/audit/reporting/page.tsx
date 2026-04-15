'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import {
  Plus,
  X,
  BarChart3,
  FileText,
  Briefcase,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Clock,
  Target,
  DollarSign,
  Activity,
  Calendar,
  Sparkles,
  Package,
  Pencil,
  Save,
  ChevronRight,
  ArrowLeft,
  Download,
  Loader2,
  User,
  Shield,
} from 'lucide-react';

const TABS = [
  { key: 'kpis', label: 'KPIs & Trends', icon: BarChart3 },
  { key: 'reports', label: 'Reports', icon: FileText },
  { key: 'board-packs', label: 'Board Packs', icon: Package },
];

const REPORT_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  review: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  issued: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

const OPINION_COLORS: Record<string, string> = {
  satisfactory: 'bg-emerald-500/20 text-emerald-400',
  needs_improvement: 'bg-amber-500/20 text-amber-400',
  unsatisfactory: 'bg-red-500/20 text-red-400',
  advisory: 'bg-blue-500/20 text-blue-400',
};

const REPORT_TYPES = ['full_report', 'summary_report', 'management_letter', 'flash_report'];
const OPINIONS = ['satisfactory', 'needs_improvement', 'unsatisfactory', 'advisory'];

export default function AuditReportingPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('kpis');
  const [showCreateReportModal, setShowCreateReportModal] = useState(false);
  const [showCreateBoardPackModal, setShowCreateBoardPackModal] = useState(false);
  const [newReport, setNewReport] = useState({
    engagement_id: '',
    title: '',
    report_type: 'full_report',
    executive_summary: '',
    opinion: 'satisfactory',
    scope_summary: '',
  });
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [showReportDetail, setShowReportDetail] = useState(false);
  const [isEditingReport, setIsEditingReport] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [exportingDOCX, setExportingDOCX] = useState(false);
  const [editReportForm, setEditReportForm] = useState({
    title: '',
    report_type: 'full_report',
    status: 'draft',
    opinion: 'satisfactory',
    opinion_narrative: '',
    executive_summary: '',
    scope_summary: '',
  });
  const [newBoardPack, setNewBoardPack] = useState({
    title: '',
    period: '',
    engagement_ids: [] as number[],
  });
  const [themeLoading, setThemeLoading] = useState(false);
  const [themeResult, setThemeResult] = useState<any>(null);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [themeEngIds, setThemeEngIds] = useState<number[]>([]);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [opinionLoading, setOpinionLoading] = useState(false);
  const [bpThemeLoading, setBpThemeLoading] = useState(false);
  const [bpThemeResult, setBpThemeResult] = useState<any>(null);

  const { data: kpis } = useQuery({ queryKey: ['audit-kpis'], queryFn: () => auditApi.reporting.getKPIs().then(r => r.data) });
  const { data: trends } = useQuery({ queryKey: ['trend-analysis'], queryFn: () => auditApi.reporting.getTrendAnalysis().then(r => r.data) });
  const { data: reports } = useQuery({ queryKey: ['audit-reports'], queryFn: () => auditApi.reporting.getReports().then(r => r.data?.reports || r.data || []) });
  const { data: boardPacks } = useQuery({ queryKey: ['board-packs'], queryFn: () => auditApi.reporting.getBoardPacks().then(r => r.data?.board_packs || r.data || []) });
  const { data: engagements } = useQuery({ queryKey: ['engagements-list'], queryFn: () => auditApi.engagements.getAll().then(r => r.data?.engagements || r.data || []) });

  const { data: fullReport, isLoading: fullReportLoading } = useQuery({
    queryKey: ['audit-report-full', selectedReportId],
    queryFn: () => auditApi.reporting.getFullReport(selectedReportId!).then(r => r.data),
    enabled: !!selectedReportId && showReportDetail,
  });

  const createReportMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.reporting.createReport(data).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-reports'] });
      setShowCreateReportModal(false);
      setNewReport({ engagement_id: '', title: '', report_type: 'full_report', executive_summary: '', opinion: 'satisfactory', scope_summary: '' });
    },
  });

  const createBoardPackMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.reporting.createBoardPack(data).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board-packs'] });
      setShowCreateBoardPackModal(false);
      setNewBoardPack({ title: '', period: '', engagement_ids: [] });
    },
  });

  const updateReportMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => auditApi.reporting.updateReport(id, data).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-reports'] });
      queryClient.invalidateQueries({ queryKey: ['audit-report-full', selectedReportId] });
      setIsEditingReport(false);
    },
  });

  const openReportDetail = (report: any) => {
    setSelectedReportId(report.id);
    setShowReportDetail(true);
    setIsEditingReport(false);
  };

  const closeReportDetail = () => {
    setShowReportDetail(false);
    setSelectedReportId(null);
    setIsEditingReport(false);
  };

  const startEditReport = () => {
    if (!fullReport) return;
    setEditReportForm({
      title: fullReport.title || '',
      report_type: fullReport.report_type || 'full_report',
      status: fullReport.status || 'draft',
      opinion: fullReport.opinion || 'satisfactory',
      opinion_narrative: fullReport.opinion_narrative || '',
      executive_summary: fullReport.executive_summary || '',
      scope_summary: fullReport.scope_summary || '',
    });
    setIsEditingReport(true);
  };

  const handleDownload = async (format: 'pdf' | 'docx') => {
    if (!selectedReportId) return;
    const setter = format === 'pdf' ? setExportingPDF : setExportingDOCX;
    setter(true);
    try {
      const res = format === 'pdf'
        ? await auditApi.reporting.exportPDF(selectedReportId)
        : await auditApi.reporting.exportDOCX(selectedReportId);
      const blob = new Blob([res.data], {
        type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fullReport?.title || 'report'}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error(`Export ${format} failed:`, err);
    } finally {
      setter(false);
    }
  };

  const handleSaveReport = () => {
    if (!selectedReportId) return;
    updateReportMutation.mutate({
      id: selectedReportId,
      data: {
        title: editReportForm.title,
        report_type: editReportForm.report_type,
        status: editReportForm.status,
        opinion: editReportForm.opinion,
        opinion_narrative: editReportForm.opinion_narrative || undefined,
        executive_summary: editReportForm.executive_summary || undefined,
        scope_summary: editReportForm.scope_summary || undefined,
      },
    });
  };

  const handleCreateReport = () => {
    const data: Record<string, unknown> = {
      title: newReport.title,
      report_type: newReport.report_type,
      executive_summary: newReport.executive_summary,
      opinion: newReport.opinion,
      scope_summary: newReport.scope_summary,
    };
    if (newReport.engagement_id) data.engagement_id = parseInt(newReport.engagement_id);
    createReportMutation.mutate(data);
  };

  const handleCreateBoardPack = () => {
    createBoardPackMutation.mutate({
      title: newBoardPack.title,
      period: newBoardPack.period,
      engagement_ids: newBoardPack.engagement_ids,
    });
  };

  const toggleEngagementId = (id: number) => {
    setNewBoardPack(prev => ({
      ...prev,
      engagement_ids: prev.engagement_ids.includes(id)
        ? prev.engagement_ids.filter(eid => eid !== id)
        : [...prev.engagement_ids, id],
    }));
  };

  const toggleThemeEngId = (id: number) => {
    setThemeEngIds(prev => prev.includes(id) ? prev.filter(eid => eid !== id) : [...prev, id]);
  };

  const handleBpGenerateThemes = async () => {
    if (newBoardPack.engagement_ids.length === 0) return;
    setBpThemeLoading(true);
    setBpThemeResult(null);
    try {
      const res = await auditApi.ai.aggregateThemes({ engagement_ids: newBoardPack.engagement_ids });
      setBpThemeResult(res.data?.theme_analysis || res.data);
    } catch (err) {
      console.error('Board pack theme generation failed:', err);
      alert('Failed to generate themes. Please try again.');
    } finally {
      setBpThemeLoading(false);
    }
  };

  const handleSuggestOpinion = async () => {
    const engId = parseInt(newReport.engagement_id);
    if (!engId) return;
    setOpinionLoading(true);
    try {
      const res = await auditApi.ai.suggestOpinion({ engagement_id: engId });
      const d = res.data?.opinion;
      if (d) {
        setNewReport(prev => ({
          ...prev,
          opinion: d.recommended_opinion || prev.opinion,
          executive_summary: d.opinion_narrative || d.narrative || prev.executive_summary,
        }));
      }
    } catch (err) {
      console.error('AI opinion suggestion failed:', err);
      alert('Failed to suggest opinion. Please try again.');
    } finally {
      setOpinionLoading(false);
    }
  };

  const handleAggregateThemes = async () => {
    if (themeEngIds.length === 0) return;
    setThemeLoading(true);
    setThemeResult(null);
    try {
      const res = await auditApi.ai.aggregateThemes({ engagement_ids: themeEngIds });
      setThemeResult(res.data?.theme_analysis || res.data);
      setShowThemePicker(false);
      setShowThemeModal(true);
    } catch (err) { console.error('Theme aggregation failed:', err); alert('Failed to aggregate themes. Please try again.'); }
    finally { setThemeLoading(false); }
  };

  const kpiCards = kpis ? [
    { label: 'Findings Closure Rate', value: `${kpis.findings_closure_rate ?? 0}%`, icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Overdue Findings', value: kpis.overdue_findings ?? 0, icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' },
    { label: 'Total Findings', value: kpis.total_findings ?? 0, icon: Target, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Active Engagements', value: kpis.active_engagements ?? 0, icon: Activity, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    { label: 'Plan Completion', value: `${kpis.plan_completion_pct ?? 0}%`, icon: TrendingUp, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
    { label: 'Budget Hours', value: kpis.budget_hours ?? 0, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    { label: 'Actual Hours', value: kpis.actual_hours ?? 0, icon: Clock, color: 'text-orange-400', bg: 'bg-orange-500/10' },
    { label: 'Cost Efficiency', value: `${kpis.cost_efficiency_pct ?? 0}%`, icon: DollarSign, color: 'text-green-400', bg: 'bg-green-500/10' },
  ] : [];

  const getMaxValue = (data: Record<string, number> | undefined) => {
    if (!data) return 1;
    const values = Object.values(data);
    return Math.max(...values, 1);
  };

  const SEVERITY_COLORS: Record<string, string> = {
    critical: '#ef4444',
    high: '#f97316',
    medium: '#eab308',
    low: '#22c55e',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Reporting</h1>
          <p className="text-slate-600 mt-1">KPIs, reports, and board packs</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setThemeEngIds([]); setShowThemePicker(true); }}
            className="flex items-center gap-2 px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded-lg text-sm transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            Theme Analysis
          </button>
          <button
            onClick={() => setShowCreateReportModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Report
          </button>
        </div>
      </div>

      <div className="flex gap-1 bg-white p-1 rounded-lg border border-slate-200 w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'kpis' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {kpiCards.map((card, i) => {
              const Icon = card.icon;
              return (
                <div key={i} className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-slate-600">{card.label}</span>
                    <div className={`p-2 rounded-lg ${card.bg}`}>
                      <Icon className={`w-4 h-4 ${card.color}`} />
                    </div>
                  </div>
                  <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                </div>
              );
            })}
          </div>

          {trends && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {trends.findings_by_month && (
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <h3 className="text-slate-900 font-semibold mb-4 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-400" />
                    Findings by Month
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(trends.findings_by_month as Record<string, number>).map(([month, count]) => {
                      const max = getMaxValue(trends.findings_by_month as Record<string, number>);
                      const pct = (count / max) * 100;
                      return (
                        <div key={month} className="flex items-center gap-3">
                          <span className="text-xs text-slate-600 w-16 shrink-0">{month}</span>
                          <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full flex items-center justify-end pr-2"
                              style={{ width: `${Math.max(pct, 8)}%` }}
                            >
                              <span className="text-[10px] text-slate-900 font-medium">{count}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {trends.severity_trends && (
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <h3 className="text-slate-900 font-semibold mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    Severity Trends
                  </h3>
                  <div className="space-y-3">
                    {Object.entries(trends.severity_trends as Record<string, number>).map(([severity, count]) => {
                      const max = getMaxValue(trends.severity_trends as Record<string, number>);
                      const pct = (count / max) * 100;
                      const barColor = SEVERITY_COLORS[severity] || '#6366f1';
                      return (
                        <div key={severity}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-600 capitalize">{severity}</span>
                            <span className="text-xs text-slate-700 font-medium">{count}</span>
                          </div>
                          <div className="bg-slate-100 rounded-full h-4 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${Math.max(pct, 5)}%`, backgroundColor: barColor }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {trends.root_cause_distribution && (
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <h3 className="text-slate-900 font-semibold mb-4 flex items-center gap-2">
                    <Target className="w-4 h-4 text-purple-400" />
                    Root Cause Distribution
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(trends.root_cause_distribution as Record<string, number>).map(([cause, count]) => {
                      const max = getMaxValue(trends.root_cause_distribution as Record<string, number>);
                      const pct = (count / max) * 100;
                      return (
                        <div key={cause} className="flex items-center gap-3">
                          <span className="text-xs text-slate-600 w-24 shrink-0 truncate" title={cause}>{cause}</span>
                          <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                            <div
                              className="h-full bg-purple-500 rounded-full flex items-center justify-end pr-2"
                              style={{ width: `${Math.max(pct, 8)}%` }}
                            >
                              <span className="text-[10px] text-slate-900 font-medium">{count}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="space-y-4">
          {(!reports || (Array.isArray(reports) && reports.length === 0)) ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
              <FileText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-600">No audit reports yet</p>
              <button
                onClick={() => setShowCreateReportModal(true)}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
              >
                Create First Report
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              {(Array.isArray(reports) ? reports : []).map((report: any) => (
                <div
                  key={report.id}
                  onClick={() => openReportDetail(report)}
                  className="bg-white border border-slate-200 rounded-xl p-5 cursor-pointer hover:border-blue-500/50 hover:bg-white/80 transition-all group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-slate-900 font-semibold">{report.title}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${REPORT_STATUS_COLORS[report.status] || 'bg-slate-200/20 text-slate-600'}`}>
                          {report.status}
                        </span>
                        {report.opinion && (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${OPINION_COLORS[report.opinion] || 'bg-slate-200/20 text-slate-600'}`}>
                            {report.opinion?.replace('_', ' ')}
                          </span>
                        )}
                        {report.ai_generated && (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400">AI</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-600">
                        {report.report_type && (
                          <span className="flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5" />
                            {report.report_type.replace(/_/g, ' ')}
                          </span>
                        )}
                        {report.engagement_title && (
                          <span className="flex items-center gap-1">
                            <Briefcase className="w-3.5 h-3.5" />
                            {report.engagement_title}
                          </span>
                        )}
                        {report.issued_date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {new Date(report.issued_date).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {report.executive_summary && (
                        <p className="text-slate-600 text-sm mt-2 line-clamp-2">{report.executive_summary}</p>
                      )}
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-blue-400 transition-colors mt-1 flex-shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'board-packs' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowCreateBoardPackModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Board Pack
            </button>
          </div>
          {(!boardPacks || (Array.isArray(boardPacks) && boardPacks.length === 0)) ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
              <Package className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-600">No board packs yet</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {(Array.isArray(boardPacks) ? boardPacks : []).map((pack: any) => (
                <div key={pack.id} className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-slate-900 font-semibold">{pack.title}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                          pack.status === 'published' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                          pack.status === 'review' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                          'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                        }`}>
                          {pack.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-600">
                        {pack.period && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {pack.period}
                          </span>
                        )}
                        {pack.key_findings_count !== undefined && (
                          <span className="flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {pack.key_findings_count} key findings
                          </span>
                        )}
                      </div>
                      {pack.kpi_data && (
                        <div className="mt-3 flex gap-3 flex-wrap">
                          {Object.entries(pack.kpi_data as Record<string, any>).slice(0, 4).map(([key, val]) => (
                            <span key={key} className="bg-slate-100 px-2 py-1 rounded text-xs text-slate-700">
                              <span className="text-slate-500">{key.replace(/_/g, ' ')}:</span> {String(val)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 rounded-lg text-xs transition-colors border border-indigo-500/30">
                        <Sparkles className="w-3.5 h-3.5" />
                        AI Narrative
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showCreateReportModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Create Audit Report</h2>
              <button onClick={() => setShowCreateReportModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">Engagement</label>
                <select
                  value={newReport.engagement_id}
                  onChange={e => setNewReport(p => ({ ...p, engagement_id: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select engagement...</option>
                  {(Array.isArray(engagements) ? engagements : []).map((eng: any) => (
                    <option key={eng.id} value={eng.id}>{eng.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Title</label>
                <input
                  value={newReport.title}
                  onChange={e => setNewReport(p => ({ ...p, title: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Report title"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Report Type</label>
                <select
                  value={newReport.report_type}
                  onChange={e => setNewReport(p => ({ ...p, report_type: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {REPORT_TYPES.map(t => (
                    <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Opinion</label>
                <select
                  value={newReport.opinion}
                  onChange={e => setNewReport(p => ({ ...p, opinion: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {OPINIONS.map(o => (
                    <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleSuggestOpinion}
                disabled={opinionLoading || !newReport.engagement_id}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {opinionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Suggest Opinion & Summary with AI
              </button>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Executive Summary</label>
                <textarea
                  value={newReport.executive_summary}
                  onChange={e => setNewReport(p => ({ ...p, executive_summary: e.target.value }))}
                  rows={3}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Executive summary..."
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Scope Summary</label>
                <textarea
                  value={newReport.scope_summary}
                  onChange={e => setNewReport(p => ({ ...p, scope_summary: e.target.value }))}
                  rows={2}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Scope summary..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-slate-200">
              <button
                onClick={() => setShowCreateReportModal(false)}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateReport}
                disabled={!newReport.title || createReportMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
              >
                {createReportMutation.isPending ? 'Creating...' : 'Create Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReportDetail && selectedReportId && (
        <div className="fixed inset-0 bg-white/95 z-50 overflow-y-auto">
          <div className="max-w-4xl mx-auto py-6 px-4">
            <div className="flex items-center justify-between mb-6">
              <button
                onClick={closeReportDetail}
                className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                Back to Reports
              </button>
              <div className="flex items-center gap-2">
                {!isEditingReport && (
                  <>
                    <button
                      onClick={() => handleDownload('pdf')}
                      disabled={exportingPDF || fullReportLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm transition-colors border border-red-500/30"
                    >
                      {exportingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      PDF
                    </button>
                    <button
                      onClick={() => handleDownload('docx')}
                      disabled={exportingDOCX || fullReportLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg text-sm transition-colors border border-blue-500/30"
                    >
                      {exportingDOCX ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      Word
                    </button>
                    <button
                      onClick={startEditReport}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg text-sm transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                      Edit
                    </button>
                  </>
                )}
              </div>
            </div>

            {fullReportLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
              </div>
            ) : !fullReport ? (
              <div className="text-center py-20 text-slate-600">Report not found</div>
            ) : isEditingReport ? (
              <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Edit Report</h2>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                  <input type="text" value={editReportForm.title} onChange={e => setEditReportForm(p => ({ ...p, title: e.target.value }))} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Report Type</label>
                    <select value={editReportForm.report_type} onChange={e => setEditReportForm(p => ({ ...p, report_type: e.target.value }))} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                      {REPORT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                    <select value={editReportForm.status} onChange={e => setEditReportForm(p => ({ ...p, status: e.target.value }))} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                      <option value="draft">Draft</option>
                      <option value="review">Review</option>
                      <option value="issued">Issued</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Opinion</label>
                    <select value={editReportForm.opinion} onChange={e => setEditReportForm(p => ({ ...p, opinion: e.target.value }))} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                      {OPINIONS.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Executive Summary</label>
                  <textarea value={editReportForm.executive_summary} onChange={e => setEditReportForm(p => ({ ...p, executive_summary: e.target.value }))} rows={4} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none" placeholder="Executive summary..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Opinion Narrative</label>
                  <textarea value={editReportForm.opinion_narrative} onChange={e => setEditReportForm(p => ({ ...p, opinion_narrative: e.target.value }))} rows={3} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none" placeholder="Opinion narrative..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Scope Summary</label>
                  <textarea value={editReportForm.scope_summary} onChange={e => setEditReportForm(p => ({ ...p, scope_summary: e.target.value }))} rows={3} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none" placeholder="Scope summary..." />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setIsEditingReport(false)} className="px-4 py-2 text-slate-600 hover:text-slate-900 text-sm transition-colors">Cancel</button>
                  <button onClick={handleSaveReport} disabled={!editReportForm.title || updateReportMutation.isPending} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors">
                    <Save className="w-4 h-4" />
                    {updateReportMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
                  <h1 className="text-2xl font-bold text-slate-900 mb-3">{fullReport.title}</h1>
                  <p className="text-slate-600 text-sm mb-4">{(fullReport.report_type || '').replace(/_/g, ' ').toUpperCase()}</p>
                  {fullReport.engagement?.entity_name && (
                    <p className="text-slate-700 text-sm mb-4">{fullReport.engagement.entity_name}</p>
                  )}
                  <div className="flex items-center justify-center gap-3 flex-wrap mb-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${REPORT_STATUS_COLORS[fullReport.status] || 'bg-slate-200/20 text-slate-600'}`}>
                      {fullReport.status}
                    </span>
                    {fullReport.opinion && (
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${OPINION_COLORS[fullReport.opinion] || 'bg-slate-200/20 text-slate-600'}`}>
                        {fullReport.opinion.replace(/_/g, ' ')}
                      </span>
                    )}
                    {fullReport.ai_generated && (
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400">AI Generated</span>
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-6 text-xs text-slate-500">
                    {fullReport.issued_date && <span>Issued: {new Date(fullReport.issued_date).toLocaleDateString()}</span>}
                    {fullReport.issued_by && <span>By: {fullReport.issued_by}</span>}
                    {fullReport.engagement?.lead_auditor && <span>Lead Auditor: {fullReport.engagement.lead_auditor}</span>}
                    <span>Generated: {new Date().toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-6">
                  <h2 className="text-lg font-bold text-blue-400 mb-1 flex items-center gap-2">
                    <span className="text-blue-500">1.</span> Executive Summary
                  </h2>
                  <div className="h-px bg-blue-500/30 mb-4 w-32" />
                  <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">
                    {fullReport.executive_summary || 'No executive summary provided.'}
                  </p>
                </div>

                {fullReport.engagement && (
                  <div className="bg-white rounded-xl border border-slate-200 p-6">
                    <h2 className="text-lg font-bold text-blue-400 mb-1 flex items-center gap-2">
                      <span className="text-blue-500">2.</span> Engagement Overview
                    </h2>
                    <div className="h-px bg-blue-500/30 mb-4 w-32" />
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      {[
                        ['Engagement', fullReport.engagement.title],
                        ['Type', (fullReport.engagement.engagement_type || '').replace(/_/g, ' ')],
                        ['Entity', fullReport.engagement.entity_name || 'N/A'],
                        ['Lead Auditor', fullReport.engagement.lead_auditor || 'N/A'],
                        ['Period', fullReport.engagement.planned_start ? `${fullReport.engagement.planned_start.slice(0, 10)} to ${(fullReport.engagement.planned_end || '').slice(0, 10)}` : 'N/A'],
                        ['Status', (fullReport.engagement.status || '').replace(/_/g, ' ')],
                      ].map(([label, value]) => (
                        <div key={label as string} className="flex gap-2">
                          <span className="text-slate-500 text-sm font-medium min-w-[100px]">{label}:</span>
                          <span className="text-slate-700 text-sm">{value}</span>
                        </div>
                      ))}
                    </div>
                    {fullReport.engagement.objectives && (
                      <div className="mt-3">
                        <h3 className="text-sm font-semibold text-slate-700 mb-1">Objectives</h3>
                        <p className="text-sm text-slate-600 whitespace-pre-wrap">{fullReport.engagement.objectives}</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-white rounded-xl border border-slate-200 p-6">
                  <h2 className="text-lg font-bold text-blue-400 mb-1 flex items-center gap-2">
                    <span className="text-blue-500">3.</span> Scope & Methodology
                  </h2>
                  <div className="h-px bg-blue-500/30 mb-4 w-32" />
                  <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">
                    {fullReport.scope_summary || fullReport.engagement?.scope || 'No scope information provided.'}
                  </p>
                  {fullReport.engagement?.methodology && (
                    <div className="mt-4">
                      <h3 className="text-sm font-semibold text-slate-700 mb-1">Methodology</h3>
                      <p className="text-sm text-slate-600 whitespace-pre-wrap">{fullReport.engagement.methodology}</p>
                    </div>
                  )}
                </div>

                {(fullReport.opinion || fullReport.opinion_narrative) && (
                  <div className="bg-white rounded-xl border border-slate-200 p-6">
                    <h2 className="text-lg font-bold text-blue-400 mb-1 flex items-center gap-2">
                      <Shield className="w-5 h-5" />
                      <span className="text-blue-500">4.</span> Auditor&apos;s Opinion
                    </h2>
                    <div className="h-px bg-blue-500/30 mb-4 w-32" />
                    {fullReport.opinion && (
                      <div className="mb-3">
                        <span className={`px-4 py-1.5 rounded-full text-sm font-semibold ${OPINION_COLORS[fullReport.opinion] || 'bg-slate-200/20 text-slate-600'}`}>
                          {fullReport.opinion.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      </div>
                    )}
                    {fullReport.opinion_narrative && (
                      <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap mt-3">{fullReport.opinion_narrative}</p>
                    )}
                  </div>
                )}

                <div className="bg-white rounded-xl border border-slate-200 p-6">
                  <h2 className="text-lg font-bold text-blue-400 mb-1 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    <span className="text-blue-500">{fullReport.opinion || fullReport.opinion_narrative ? '5' : '4'}.</span> Detailed Findings
                  </h2>
                  <div className="h-px bg-blue-500/30 mb-4 w-32" />
                  {(!fullReport.findings || fullReport.findings.length === 0) ? (
                    <p className="text-slate-600 text-sm">No findings were identified during this engagement.</p>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-slate-600 text-sm">Total findings: {fullReport.findings.length}</p>
                      {fullReport.findings.map((finding: any, idx: number) => {
                        const sevColors: Record<string, string> = {
                          critical: 'bg-red-500/20 text-red-400 border-red-500/30',
                          high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
                          medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
                          low: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
                        };
                        return (
                          <div key={finding.id} className="bg-white/50 rounded-lg border border-slate-200/30 p-5">
                            <div className="flex items-start justify-between mb-3">
                              <h3 className="text-slate-900 font-semibold text-sm">
                                {finding.finding_number || `F-${idx + 1}`}: {finding.title}
                              </h3>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${sevColors[finding.severity] || 'bg-slate-200/20 text-slate-600'}`}>
                                  {finding.severity}
                                </span>
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-300/30">
                                  {finding.status}
                                </span>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                              {[['Condition', finding.condition], ['Criteria', finding.criteria], ['Cause', finding.cause], ['Effect', finding.effect]].map(([label, text]) =>
                                text ? (
                                  <div key={label as string}>
                                    <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">{label}</h4>
                                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{text}</p>
                                  </div>
                                ) : null
                              )}
                            </div>
                            {finding.owner && (
                              <div className="mt-3 flex items-center gap-1 text-xs text-slate-500">
                                <User className="w-3 h-3" /> Owner: {finding.owner}
                              </div>
                            )}
                            {finding.management_responses?.length > 0 && (
                              <div className="mt-4 border-t border-slate-200/30 pt-3">
                                <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Management Responses</h4>
                                {finding.management_responses.map((mr: any) => (
                                  <div key={mr.id} className="bg-white rounded-lg p-3 mb-2">
                                    <span className="text-xs text-emerald-400 font-medium">{(mr.response_type || '').replace(/_/g, ' ')}</span>
                                    {mr.response_text && <p className="text-sm text-slate-700 mt-1">{mr.response_text}</p>}
                                    {mr.action_plan && <p className="text-sm text-slate-600 mt-1 italic">Action Plan: {mr.action_plan}</p>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-6">
                  <h2 className="text-lg font-bold text-blue-400 mb-1 flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    <span className="text-blue-500">{fullReport.opinion || fullReport.opinion_narrative ? '6' : '5'}.</span> Recommendations & Action Plans
                  </h2>
                  <div className="h-px bg-blue-500/30 mb-4 w-32" />
                  {(() => {
                    const allRecs = (fullReport.findings || []).flatMap((f: any) =>
                      (f.recommendations || []).map((r: any) => ({ ...r, finding_title: f.title }))
                    );
                    if (allRecs.length === 0) return <p className="text-slate-600 text-sm">No recommendations recorded.</p>;
                    const priColors: Record<string, string> = {
                      critical: 'bg-red-500/20 text-red-400 border-red-500/30',
                      high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
                      medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
                      low: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
                    };
                    return (
                      <div className="space-y-4">
                        {allRecs.map((rec: any) => (
                          <div key={rec.id} className="bg-white/50 rounded-lg border border-slate-200/30 p-4">
                            <div className="flex items-start justify-between mb-2">
                              <h3 className="text-slate-900 font-semibold text-sm">{rec.title}</h3>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${priColors[rec.priority] || 'bg-slate-200/20 text-slate-600'}`}>
                                  {rec.priority}
                                </span>
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-300/30">
                                  {rec.status}
                                </span>
                              </div>
                            </div>
                            <p className="text-xs text-slate-500 italic mb-2">Finding: {rec.finding_title}</p>
                            {rec.description && <p className="text-sm text-slate-700 mb-2">{rec.description}</p>}
                            <div className="flex gap-4 text-xs text-slate-500">
                              {rec.owner && <span>Owner: {rec.owner}</span>}
                              {rec.due_date && <span>Due: {rec.due_date.slice(0, 10)}</span>}
                            </div>
                            {rec.action_plans?.length > 0 && (
                              <div className="mt-3 border-t border-slate-200/30 pt-2">
                                <h4 className="text-xs font-semibold text-slate-500 mb-1">Action Plan Milestones</h4>
                                {rec.action_plans.map((ap: any) => (
                                  <div key={ap.id} className="flex items-center gap-2 text-sm py-1">
                                    <span className={ap.status === 'completed' ? 'text-emerald-400' : 'text-slate-500'}>
                                      {ap.status === 'completed' ? '✓' : '○'}
                                    </span>
                                    <span className="text-slate-700">{ap.milestone}</span>
                                    <span className="text-xs text-slate-500">({ap.status})</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                <div className="text-center text-xs text-slate-600 py-4">
                  ComplyVerse GRC Platform &middot; Confidential
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showCreateBoardPackModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Create Board Pack</h2>
              <button onClick={() => setShowCreateBoardPackModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">Title</label>
                <input
                  value={newBoardPack.title}
                  onChange={e => setNewBoardPack(p => ({ ...p, title: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Board pack title"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Period</label>
                <input
                  value={newBoardPack.period}
                  onChange={e => setNewBoardPack(p => ({ ...p, period: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Q1 2026"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-2">Engagements</label>
                <div className="space-y-2 max-h-48 overflow-y-auto bg-white rounded-lg p-3 border border-slate-200">
                  {(Array.isArray(engagements) ? engagements : []).map((eng: any) => (
                    <label key={eng.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-100/30 rounded p-1">
                      <input
                        type="checkbox"
                        checked={newBoardPack.engagement_ids.includes(eng.id)}
                        onChange={() => toggleEngagementId(eng.id)}
                        className="rounded border-slate-300 bg-slate-100 text-blue-500 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-700">{eng.title}</span>
                    </label>
                  ))}
                  {(!engagements || (Array.isArray(engagements) && engagements.length === 0)) && (
                    <p className="text-xs text-slate-500">No engagements available</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleBpGenerateThemes}
                disabled={bpThemeLoading || newBoardPack.engagement_ids.length === 0}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {bpThemeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate Themes with AI
              </button>
              {bpThemeResult && (
                <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 space-y-2">
                  <h4 className="text-xs font-semibold text-violet-700 flex items-center gap-1"><Sparkles className="h-3 w-3" /> Generated Themes</h4>
                  {bpThemeResult.executive_narrative && (
                    <p className="text-xs text-slate-700">{bpThemeResult.executive_narrative}</p>
                  )}
                  {bpThemeResult.themes && bpThemeResult.themes.length > 0 && (
                    <ul className="text-xs text-slate-600 space-y-1">
                      {bpThemeResult.themes.map((t: any, i: number) => (
                        <li key={i} className="flex items-center gap-1">
                          <span className={`inline-block w-2 h-2 rounded-full ${
                            t.overall_risk_level === 'critical' ? 'bg-red-500' :
                            t.overall_risk_level === 'high' ? 'bg-orange-500' :
                            t.overall_risk_level === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'
                          }`} />
                          <span className="font-medium">{t.theme_name}</span>
                          <span className="text-slate-400">({t.overall_risk_level})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-slate-200">
              <button
                onClick={() => { setShowCreateBoardPackModal(false); setBpThemeResult(null); }}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBoardPack}
                disabled={!newBoardPack.title || createBoardPackMutation.isPending}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
              >
                {createBoardPackMutation.isPending ? 'Creating...' : 'Create Board Pack'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showThemePicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-500" /> Theme Analysis</h3>
              <button onClick={() => setShowThemePicker(false)} className="text-slate-500 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-slate-600 mb-3">Select engagements to analyze for cross-cutting themes:</p>
            <div className="max-h-64 overflow-y-auto space-y-1 mb-4">
              {(Array.isArray(engagements) ? engagements : []).map((eng: any) => (
                <label key={eng.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 rounded p-2">
                  <input
                    type="checkbox"
                    checked={themeEngIds.includes(eng.id)}
                    onChange={() => toggleThemeEngId(eng.id)}
                    className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span className="text-sm text-slate-700">{eng.title}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowThemePicker(false)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancel</button>
              <button
                onClick={handleAggregateThemes}
                disabled={themeEngIds.length === 0 || themeLoading}
                className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                {themeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Analyze Themes
              </button>
            </div>
          </div>
        </div>
      )}

      {showThemeModal && themeResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-500" /> Cross-Engagement Theme Analysis</h3>
              <button onClick={() => setShowThemeModal(false)} className="text-slate-500 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              {themeResult.executive_narrative && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-slate-700 mb-2">Executive Summary</h4>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{themeResult.executive_narrative}</p>
                </div>
              )}
              {themeResult.themes && themeResult.themes.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 mb-2">Identified Themes</h4>
                  <div className="space-y-3">
                    {themeResult.themes.map((t: any, i: number) => (
                      <div key={i} className={`border rounded-lg p-4 ${
                        t.overall_risk_level === 'critical' ? 'bg-red-50 border-red-200' :
                        t.overall_risk_level === 'high' ? 'bg-orange-50 border-orange-200' :
                        t.overall_risk_level === 'medium' ? 'bg-amber-50 border-amber-200' :
                        'bg-emerald-50 border-emerald-200'
                      }`}>
                        <div className="flex items-center justify-between mb-1">
                          <h5 className="text-sm font-semibold text-slate-800">{t.theme_name}</h5>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              t.overall_risk_level === 'critical' ? 'bg-red-200 text-red-800' :
                              t.overall_risk_level === 'high' ? 'bg-orange-200 text-orange-800' :
                              t.overall_risk_level === 'medium' ? 'bg-amber-200 text-amber-800' :
                              'bg-emerald-200 text-emerald-800'
                            }`}>{t.overall_risk_level}</span>
                            {t.trend && <span className={`text-xs ${t.trend === 'escalating' ? 'text-red-600' : t.trend === 'improving' ? 'text-emerald-600' : 'text-slate-500'}`}>{t.trend}</span>}
                            {t.finding_count && <span className="text-xs text-slate-500">{t.finding_count} findings</span>}
                          </div>
                        </div>
                        <p className="text-sm text-slate-700">{t.narrative}</p>
                        {t.recommended_board_action && <p className="text-xs text-slate-600 mt-2 italic">Board action: {t.recommended_board_action}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {themeResult.positive_themes && themeResult.positive_themes.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-emerald-700 mb-2">Positive Themes</h4>
                  <ul className="text-sm text-emerald-800 list-disc pl-5 space-y-1">
                    {themeResult.positive_themes.map((t: string, i: number) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              )}
              {themeResult.areas_requiring_attention && themeResult.areas_requiring_attention.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-red-700 mb-2">Areas Requiring Attention</h4>
                  <ul className="text-sm text-red-800 list-disc pl-5 space-y-1">
                    {themeResult.areas_requiring_attention.map((a: string, i: number) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t border-slate-200">
              <button onClick={() => setShowThemeModal(false)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}