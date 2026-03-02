'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import {
  Plus,
  X,
  ClipboardCheck,
  Shield,
  BarChart3,
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Star,
  User,
  Calendar,
  Target,
  Layers,
  Play,
} from 'lucide-react';

const TABS = [
  { key: 'reviews', label: 'Reviews', icon: ClipboardCheck },
  { key: 'conformance', label: 'IIA Conformance', icon: Shield },
  { key: 'maturity', label: 'Maturity', icon: BarChart3 },
  { key: 'templates', label: 'Templates', icon: FileText },
];

const MATURITY_LEVELS = [
  { level: 1, name: 'Initial', color: 'red', bgClass: 'bg-red-500', textClass: 'text-red-400', borderClass: 'border-red-500' },
  { level: 2, name: 'Developing', color: 'orange', bgClass: 'bg-orange-500', textClass: 'text-orange-400', borderClass: 'border-orange-500' },
  { level: 3, name: 'Defined', color: 'amber', bgClass: 'bg-amber-500', textClass: 'text-amber-400', borderClass: 'border-amber-500' },
  { level: 4, name: 'Managed', color: 'blue', bgClass: 'bg-blue-500', textClass: 'text-blue-400', borderClass: 'border-blue-500' },
  { level: 5, name: 'Optimizing', color: 'emerald', bgClass: 'bg-emerald-500', textClass: 'text-emerald-400', borderClass: 'border-emerald-500' },
];

const CONFORMANCE_COLORS: Record<string, { bg: string; text: string; icon: typeof CheckCircle2 }> = {
  conforms: { bg: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', text: 'Conforms', icon: CheckCircle2 },
  partial: { bg: 'bg-amber-500/20 text-amber-400 border-amber-500/30', text: 'Partial', icon: AlertTriangle },
  non_conform: { bg: 'bg-red-500/20 text-red-400 border-red-500/30', text: 'Non-Conform', icon: XCircle },
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-500/20 text-slate-600 border-slate-500/30',
  in_progress: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

const TEMPLATE_TYPES = ['general', 'sox', 'coso', 'iia', 'iso27001'];

export default function QAIPPage() {
  const [activeTab, setActiveTab] = useState('reviews');
  const [showCreateReview, setShowCreateReview] = useState(false);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [applyEngagementId, setApplyEngagementId] = useState('');
  const [applyingTemplateId, setApplyingTemplateId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const [newReview, setNewReview] = useState({
    review_type: 'internal',
    engagement_id: '',
    reviewer: '',
    scope: '',
    objectives: '',
  });

  const [newTemplate, setNewTemplate] = useState({
    name: '',
    description: '',
    template_type: 'general',
    framework_type: '',
    procedures: '[]',
    checklist: '[]',
  });

  const { data: reviews } = useQuery({ queryKey: ['qaip-reviews'], queryFn: () => auditApi.qaip.getReviews().then(r => r.data?.reviews || r.data || []) });
  const { data: conformance } = useQuery({ queryKey: ['iia-conformance'], queryFn: () => auditApi.qaip.getConformance().then(r => r.data) });
  const { data: maturity } = useQuery({ queryKey: ['maturity'], queryFn: () => auditApi.qaip.getMaturity().then(r => r.data) });
  const { data: standards } = useQuery({ queryKey: ['iia-standards'], queryFn: () => auditApi.qaip.getIIAStandards().then(r => r.data) });
  const { data: templates } = useQuery({ queryKey: ['audit-templates'], queryFn: () => auditApi.qaip.getTemplates().then(r => r.data?.templates || r.data || []) });

  const createReviewMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.qaip.createReview(data).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qaip-reviews'] });
      setShowCreateReview(false);
      setNewReview({ review_type: 'internal', engagement_id: '', reviewer: '', scope: '', objectives: '' });
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.qaip.createTemplate(data).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-templates'] });
      setShowCreateTemplate(false);
      setNewTemplate({ name: '', description: '', template_type: 'general', framework_type: '', procedures: '[]', checklist: '[]' });
    },
  });

  const applyTemplateMutation = useMutation({
    mutationFn: ({ templateId, engagementId }: { templateId: number; engagementId: number }) =>
      auditApi.qaip.applyTemplate(templateId, engagementId).then(r => r.data),
    onSuccess: () => {
      setApplyingTemplateId(null);
      setApplyEngagementId('');
    },
  });

  const handleCreateReview = () => {
    const data: Record<string, unknown> = {
      review_type: newReview.review_type,
      reviewer: newReview.reviewer,
      scope: newReview.scope,
      objectives: newReview.objectives,
    };
    if (newReview.engagement_id) data.engagement_id = parseInt(newReview.engagement_id);
    createReviewMutation.mutate(data);
  };

  const handleCreateTemplate = () => {
    let procedures = [];
    let checklist = [];
    try { procedures = JSON.parse(newTemplate.procedures); } catch { procedures = []; }
    try { checklist = JSON.parse(newTemplate.checklist); } catch { checklist = []; }
    createTemplateMutation.mutate({
      name: newTemplate.name,
      description: newTemplate.description,
      template_type: newTemplate.template_type,
      framework_type: newTemplate.framework_type,
      procedures,
      checklist,
    });
  };

  const currentMaturityLevel = maturity?.level || maturity?.maturity_level || 'Initial';
  const currentMaturityScore = maturity?.score || maturity?.maturity_score || 0;

  const conformanceScore = conformance?.overall_score ?? conformance?.conformance_score ?? null;

  const attributeStandards = Array.isArray(standards) ? standards.filter((s: any) => s.category === 'attribute') : [];
  const performanceStandards = Array.isArray(standards) ? standards.filter((s: any) => s.category === 'performance') : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quality Assurance & Improvement Program</h1>
          <p className="text-slate-600 mt-1">Monitor audit quality, IIA conformance, and maturity assessments</p>
        </div>
        {activeTab === 'reviews' && (
          <button
            onClick={() => setShowCreateReview(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Review
          </button>
        )}
        {activeTab === 'templates' && (
          <button
            onClick={() => setShowCreateTemplate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Template
          </button>
        )}
      </div>

      <div className="flex gap-1 bg-white rounded-lg p-1 border border-slate-200">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center ${
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

      {activeTab === 'reviews' && (
        <div className="space-y-4">
          {Array.isArray(reviews) && reviews.length > 0 ? (
            <div className="grid gap-4">
              {reviews.map((review: any) => (
                <div key={review.id} className="bg-white rounded-lg border border-slate-200 p-5">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-3">
                        <span className="text-slate-900 font-semibold text-lg capitalize">
                          {review.review_type?.replace(/_/g, ' ') || 'Review'}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[review.status] || STATUS_COLORS.draft}`}>
                          {review.status?.replace(/_/g, ' ') || 'Draft'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                        {review.engagement_title && (
                          <span className="flex items-center gap-1.5">
                            <Target className="w-3.5 h-3.5" />
                            {review.engagement_title}
                          </span>
                        )}
                        {review.reviewer && (
                          <span className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5" />
                            {review.reviewer}
                          </span>
                        )}
                        {review.completed_at && (
                          <span className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" />
                            {new Date(review.completed_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {review.maturity_score !== null && review.maturity_score !== undefined && (
                        <div className="text-center">
                          <div className="text-xs text-slate-600 mb-1">Maturity</div>
                          <div className="text-lg font-bold text-blue-400">{review.maturity_score}</div>
                        </div>
                      )}
                      {review.overall_rating && (
                        <div className="text-center">
                          <div className="text-xs text-slate-600 mb-1">Rating</div>
                          <div className="flex items-center gap-1">
                            <Star className="w-4 h-4 text-amber-400" />
                            <span className="text-lg font-bold text-amber-400">{review.overall_rating}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
              <ClipboardCheck className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-600">No QAIP reviews found. Create your first review to get started.</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'conformance' && (
        <div className="space-y-6">
          {conformanceScore !== null && (
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-slate-900 font-semibold text-lg">Overall Conformance Score</h3>
                  <p className="text-slate-600 text-sm mt-1">Based on IIA International Standards</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-4xl font-bold text-emerald-400">{typeof conformanceScore === 'number' ? `${Math.round(conformanceScore)}%` : conformanceScore}</div>
                </div>
              </div>
              <div className="mt-4 w-full bg-slate-100 rounded-full h-3">
                <div
                  className="bg-emerald-500 rounded-full h-3 transition-all"
                  style={{ width: `${typeof conformanceScore === 'number' ? Math.min(conformanceScore, 100) : 0}%` }}
                />
              </div>
            </div>
          )}

          {attributeStandards.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h3 className="text-slate-900 font-semibold mb-4 flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-400" />
                Attribute Standards
              </h3>
              <div className="space-y-3">
                {attributeStandards.map((std: any) => {
                  const conf = CONFORMANCE_COLORS[std.conformance_status] || CONFORMANCE_COLORS.non_conform;
                  const Icon = conf.icon;
                  return (
                    <div key={std.id || std.standard_code} className="flex items-center justify-between p-3 bg-white rounded-lg">
                      <div className="flex-1">
                        <div className="text-slate-900 text-sm font-medium">{std.standard_code} - {std.title || std.name}</div>
                        {std.description && <div className="text-slate-600 text-xs mt-1">{std.description}</div>}
                      </div>
                      <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${conf.bg}`}>
                        <Icon className="w-3.5 h-3.5" />
                        {conf.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {performanceStandards.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h3 className="text-slate-900 font-semibold mb-4 flex items-center gap-2">
                <Target className="w-5 h-5 text-emerald-400" />
                Performance Standards
              </h3>
              <div className="space-y-3">
                {performanceStandards.map((std: any) => {
                  const conf = CONFORMANCE_COLORS[std.conformance_status] || CONFORMANCE_COLORS.non_conform;
                  const Icon = conf.icon;
                  return (
                    <div key={std.id || std.standard_code} className="flex items-center justify-between p-3 bg-white rounded-lg">
                      <div className="flex-1">
                        <div className="text-slate-900 text-sm font-medium">{std.standard_code} - {std.title || std.name}</div>
                        {std.description && <div className="text-slate-600 text-xs mt-1">{std.description}</div>}
                      </div>
                      <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${conf.bg}`}>
                        <Icon className="w-3.5 h-3.5" />
                        {conf.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!Array.isArray(standards) || standards.length === 0 ? (
            <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
              <Shield className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-600">No IIA standards data available.</p>
            </div>
          ) : null}
        </div>
      )}

      {activeTab === 'maturity' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h3 className="text-slate-900 font-semibold text-lg mb-2">Maturity Assessment</h3>
            <div className="flex items-center gap-6 mb-4">
              <div>
                <div className="text-sm text-slate-600">Current Level</div>
                <div className="text-2xl font-bold text-slate-900 capitalize">{currentMaturityLevel}</div>
              </div>
              <div>
                <div className="text-sm text-slate-600">Maturity Score</div>
                <div className="text-2xl font-bold text-blue-400">{currentMaturityScore}</div>
              </div>
            </div>
            {maturity?.description && (
              <p className="text-slate-600 text-sm">{maturity.description}</p>
            )}
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h3 className="text-slate-900 font-semibold text-lg mb-6">Maturity Model</h3>
            <div className="flex items-end gap-3 justify-center" style={{ minHeight: '260px' }}>
              {MATURITY_LEVELS.map((ml) => {
                const isCurrentName = currentMaturityLevel?.toLowerCase() === ml.name.toLowerCase();
                const isCurrentScore = typeof currentMaturityScore === 'number' && Math.round(currentMaturityScore) === ml.level;
                const isCurrent = isCurrentName || isCurrentScore;
                const barHeight = 60 + ml.level * 40;
                return (
                  <div key={ml.level} className="flex flex-col items-center gap-2 flex-1 max-w-[140px]">
                    <div
                      className={`w-full rounded-t-lg transition-all relative ${
                        isCurrent ? ml.bgClass + ' shadow-lg' : 'bg-slate-100'
                      }`}
                      style={{
                        height: `${barHeight}px`,
                        opacity: isCurrent ? 1 : 0.4,
                        border: isCurrent ? `2px solid` : '2px solid transparent',
                        borderColor: isCurrent ? undefined : 'transparent',
                      }}
                    >
                      {isCurrent && (
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2">
                          <div className={`px-2 py-1 rounded text-xs font-bold text-slate-900 ${ml.bgClass}`}>
                            Current
                          </div>
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className={`text-2xl font-bold ${isCurrent ? 'text-slate-900' : 'text-slate-500'}`}>
                          {ml.level}
                        </span>
                      </div>
                    </div>
                    <span className={`text-xs font-medium text-center ${isCurrent ? ml.textClass : 'text-slate-500'}`}>
                      {ml.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {maturity?.areas && Array.isArray(maturity.areas) && maturity.areas.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h3 className="text-slate-900 font-semibold text-lg mb-4">Assessment Areas</h3>
              <div className="space-y-3">
                {maturity.areas.map((area: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-white rounded-lg">
                    <span className="text-slate-900 text-sm">{area.name || area.area}</span>
                    <span className="text-blue-400 font-semibold">{area.score || area.rating}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="space-y-4">
          {Array.isArray(templates) && templates.length > 0 ? (
            <div className="grid gap-4">
              {templates.map((tpl: any) => (
                <div key={tpl.id} className="bg-white rounded-lg border border-slate-200 p-5">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-3">
                        <span className="text-slate-900 font-semibold text-lg">{tpl.name}</span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium border bg-blue-500/20 text-blue-400 border-blue-500/30 uppercase">
                          {tpl.template_type}
                        </span>
                        {tpl.framework_type && (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium border bg-purple-500/20 text-purple-400 border-purple-500/30">
                            {tpl.framework_type}
                          </span>
                        )}
                      </div>
                      {tpl.description && (
                        <p className="text-slate-600 text-sm">{tpl.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-sm text-slate-600">
                        <span className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5" />
                          {Array.isArray(tpl.procedures) ? tpl.procedures.length : 0} procedures
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {applyingTemplateId === tpl.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            placeholder="Engagement ID"
                            value={applyEngagementId}
                            onChange={(e) => setApplyEngagementId(e.target.value)}
                            className="w-36 px-3 py-1.5 bg-white border border-slate-200 rounded text-slate-900 text-sm"
                          />
                          <button
                            onClick={() => {
                              if (applyEngagementId) {
                                applyTemplateMutation.mutate({
                                  templateId: tpl.id,
                                  engagementId: parseInt(applyEngagementId),
                                });
                              }
                            }}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm"
                          >
                            Apply
                          </button>
                          <button
                            onClick={() => { setApplyingTemplateId(null); setApplyEngagementId(''); }}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setApplyingTemplateId(tpl.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded text-sm transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Apply Template
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
              <FileText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-600">No audit templates found. Create your first template to get started.</p>
            </div>
          )}
        </div>
      )}

      {showCreateReview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-lg mx-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-900">New QAIP Review</h2>
              <button onClick={() => setShowCreateReview(false)} className="text-slate-600 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">Review Type</label>
                <select
                  value={newReview.review_type}
                  onChange={(e) => setNewReview({ ...newReview, review_type: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                >
                  <option value="internal">Internal</option>
                  <option value="external">External</option>
                  <option value="self_assessment">Self Assessment</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Engagement ID (optional)</label>
                <input
                  type="number"
                  value={newReview.engagement_id}
                  onChange={(e) => setNewReview({ ...newReview, engagement_id: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                  placeholder="Enter engagement ID"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Reviewer</label>
                <input
                  type="text"
                  value={newReview.reviewer}
                  onChange={(e) => setNewReview({ ...newReview, reviewer: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                  placeholder="Reviewer name"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Scope</label>
                <textarea
                  value={newReview.scope}
                  onChange={(e) => setNewReview({ ...newReview, scope: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 h-20 resize-none"
                  placeholder="Review scope"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Objectives</label>
                <textarea
                  value={newReview.objectives}
                  onChange={(e) => setNewReview({ ...newReview, objectives: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 h-20 resize-none"
                  placeholder="Review objectives"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateReview(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateReview}
                disabled={createReviewMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
              >
                {createReviewMutation.isPending ? 'Creating...' : 'Create Review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateTemplate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-900">New Audit Template</h2>
              <button onClick={() => setShowCreateTemplate(false)} className="text-slate-600 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">Name</label>
                <input
                  type="text"
                  value={newTemplate.name}
                  onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                  placeholder="Template name"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Description</label>
                <textarea
                  value={newTemplate.description}
                  onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 h-20 resize-none"
                  placeholder="Template description"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Template Type</label>
                <select
                  value={newTemplate.template_type}
                  onChange={(e) => setNewTemplate({ ...newTemplate, template_type: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                >
                  {TEMPLATE_TYPES.map(t => (
                    <option key={t} value={t}>{t.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Framework Type</label>
                <input
                  type="text"
                  value={newTemplate.framework_type}
                  onChange={(e) => setNewTemplate({ ...newTemplate, framework_type: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                  placeholder="e.g., COSO, IIA, SOX"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Procedures (JSON)</label>
                <textarea
                  value={newTemplate.procedures}
                  onChange={(e) => setNewTemplate({ ...newTemplate, procedures: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 font-mono text-sm h-24 resize-none"
                  placeholder='[{"name": "...", "description": "..."}]'
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Checklist (JSON)</label>
                <textarea
                  value={newTemplate.checklist}
                  onChange={(e) => setNewTemplate({ ...newTemplate, checklist: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 font-mono text-sm h-24 resize-none"
                  placeholder='[{"item": "...", "required": true}]'
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateTemplate(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTemplate}
                disabled={!newTemplate.name || createTemplateMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
              >
                {createTemplateMutation.isPending ? 'Creating...' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}