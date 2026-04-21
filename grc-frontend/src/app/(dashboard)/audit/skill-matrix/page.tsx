'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditApi, assetsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Users,
  Search,
  Plus,
  Award,
  Star,
  AlertTriangle,
  BarChart3,
  X,
  Edit2,
  Trash2,
  UserCheck,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Loader2,
  ShieldCheck,
  Layers,
} from 'lucide-react';

const PROFICIENCY_COLORS: Record<string, string> = {
  beginner: 'bg-slate-500',
  intermediate: 'bg-blue-500',
  advanced: 'bg-emerald-500',
  expert: 'bg-purple-500',
  master: 'bg-amber-500',
};

const PROFICIENCY_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  expert: 'Expert',
  master: 'Master',
};

const SKILL_CATEGORIES = [
  'general',
  'technical',
  'financial',
  'compliance',
  'operational',
  'it_security',
  'data_analytics',
  'risk_management',
  'framework',
];

function ProficiencyBar({ level }: { level: string }) {
  const num = { beginner: 1, intermediate: 2, advanced: 3, expert: 4, master: 5 }[level?.toLowerCase()] || 2;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`h-2.5 w-5 rounded-sm ${i <= num ? (PROFICIENCY_COLORS[level?.toLowerCase()] || 'bg-blue-500') : 'bg-slate-100'}`}
          />
        ))}
      </div>
      <span className="text-xs text-slate-600">{PROFICIENCY_LABELS[level?.toLowerCase()] || level}</span>
    </div>
  );
}

export default function SkillMatrixPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('audit:audit_management:create');
  const canEdit = hasPermission('audit:audit_management:edit');
  const canDelete = hasPermission('audit:audit_management:delete');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showFindModal, setShowFindModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState<any>(null);
  const [expandedProfile, setExpandedProfile] = useState<number | null>(null);

  const [findSkills, setFindSkills] = useState('');
  const [findFramework, setFindFramework] = useState('');
  const [showAiSkillsModal, setShowAiSkillsModal] = useState(false);
  const [aiAuditType, setAiAuditType] = useState('');
  const [aiEngagementId, setAiEngagementId] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSkillResults, setAiSkillResults] = useState<any>(null);
  const [aiError, setAiError] = useState('');

  const [newSkill, setNewSkill] = useState({
    user_id: 0,
    skill_name: '',
    skill_category: 'general',
    proficiency_level: 'intermediate',
    certification: '',
    certification_expiry: '',
    years_experience: 0,
    notes: '',
  });

  const { data: profilesData, isLoading } = useQuery({
    queryKey: ['skill-matrix-profiles', searchQuery, categoryFilter],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (searchQuery) params.skill = searchQuery;
      if (categoryFilter) params.category = categoryFilter;
      return auditApi.skillMatrix.getAll(params).then((r) => r.data);
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['skill-matrix-stats'],
    queryFn: () => auditApi.skillMatrix.getStats().then((r) => r.data),
  });

  const { data: tenantUsers } = useQuery({
    queryKey: ['audit-skill-matrix-tenant-users'],
    queryFn: () => assetsApi.getTenantUsers().then((r) => r.data || []),
  });

  const { data: matchResults, refetch: refetchMatch } = useQuery({
    queryKey: ['skill-matrix-match', findSkills, findFramework],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (findSkills) params.skills = findSkills;
      if (findFramework) params.framework = findFramework;
      return auditApi.skillMatrix.match(params).then((r) => r.data);
    },
    enabled: showFindModal && (!!findSkills || !!findFramework),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.skillMatrix.createSkill(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skill-matrix-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['skill-matrix-stats'] });
      setShowCreateModal(false);
      setNewSkill({
        user_id: 0,
        skill_name: '',
        skill_category: 'general',
        proficiency_level: 'intermediate',
        certification: '',
        certification_expiry: '',
        years_experience: 0,
        notes: '',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      auditApi.skillMatrix.updateSkill(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skill-matrix-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['skill-matrix-stats'] });
      setEditingSkill(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => auditApi.skillMatrix.deleteSkill(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skill-matrix-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['skill-matrix-stats'] });
    },
  });

  const { data: engagementsList } = useQuery({
    queryKey: ['audit-engagements-for-skills'],
    queryFn: () => auditApi.engagements.getAll().then((r) => r.data?.engagements || r.data || []),
    enabled: showAiSkillsModal,
  });

  const handleAiSuggestSkills = async () => {
    if (!aiAuditType && !aiEngagementId) return;
    setAiGenerating(true);
    setAiError('');
    try {
      const payload: Record<string, unknown> = {};
      if (aiAuditType) payload.audit_type = aiAuditType;
      if (aiEngagementId) payload.engagement_id = parseInt(aiEngagementId);
      const res = await auditApi.ai.suggestEngagementSkills(payload);
      setAiSkillResults(res.data?.skill_recommendations || res.data);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'AI skill suggestion failed. Please try again.';
      setAiError(msg);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAddSuggestedSkill = (skill: any) => {
    setNewSkill({
      user_id: 0,
      skill_name: skill.skill_name,
      skill_category: skill.category || 'general',
      proficiency_level: skill.proficiency_required || 'intermediate',
      certification: skill.suggested_certification || '',
      certification_expiry: '',
      years_experience: 0,
      notes: skill.rationale || '',
    });
    setShowAiSkillsModal(false);
    setShowCreateModal(true);
  };

  const profiles = profilesData?.profiles || [];

  const AUDIT_TYPES = [
    { key: 'financial', label: 'Financial Audit' },
    { key: 'it_security', label: 'IT / Cybersecurity Audit' },
    { key: 'operational', label: 'Operational Audit' },
    { key: 'banking', label: 'Banking / Financial Services Audit' },
    { key: 'compliance', label: 'Compliance Audit' },
    { key: 'forensic', label: 'Forensic / Investigation Audit' },
    { key: 'esg', label: 'Environmental / ESG Audit' },
    { key: 'internal_audit', label: 'Internal Audit (General / IIA)' },
  ];

  const LEVEL_COLORS: Record<string, string> = {
    L1: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
    L2: 'border-blue-500/50 bg-blue-500/10 text-blue-400',
    L3: 'border-purple-500/50 bg-purple-500/10 text-purple-400',
  };

  const PRIORITY_BADGES: Record<string, string> = {
    required: 'bg-rose-500/20 text-rose-400',
    recommended: 'bg-amber-500/20 text-amber-400',
    nice_to_have: 'bg-slate-500/20 text-slate-600',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Auditor Skill Matrix</h1>
          <p className="text-slate-600 mt-1">Manage auditor skills, certifications, and competencies</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowAiSkillsModal(true); setAiSkillResults(null); setAiAuditType(''); setAiEngagementId(''); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-slate-900 transition-all text-sm font-medium"
          >
            <Sparkles className="h-4 w-4" />
            AI Suggest Skills
          </button>
          <button
            onClick={() => setShowFindModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300 transition-all text-sm"
          >
            <UserCheck className="h-4 w-4" />
            Find Auditor
          </button>
          {canCreate && <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all text-sm"
          >
            <Plus className="h-4 w-4" />
            Add Skill
          </button>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Users className="h-5 w-5 text-blue-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900">{stats?.total_auditors ?? 0}</p>
          <p className="text-sm text-slate-600">Total Auditors</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Star className="h-5 w-5 text-emerald-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900">{stats?.total_skills ?? 0}</p>
          <p className="text-sm text-slate-600">Total Skills</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-purple-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900">{stats?.avg_proficiency ?? 0}</p>
          <p className="text-sm text-slate-600">Avg Proficiency (1-5)</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900">{stats?.expiring_certifications ?? 0}</p>
          <p className="text-sm text-slate-600">Expiring Certs (90d)</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">All Categories</option>
          {SKILL_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-white rounded-xl animate-pulse border border-slate-200" />
          ))}
        </div>
      ) : profiles.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-slate-200 bg-white">
          <Users className="h-12 w-12 text-slate-600 mx-auto mb-3" />
          <p className="text-lg font-medium text-slate-600">No auditor profiles found</p>
          <p className="text-sm text-slate-500 mt-1">Add skills to auditors to build the skill matrix</p>
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map((profile: any) => (
            <div key={profile.user_id} className="rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
              <button
                onClick={() => setExpandedProfile(expandedProfile === profile.user_id ? null : profile.user_id)}
                className="w-full flex items-center justify-between p-5 hover:bg-white/80 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-lg">
                    {(profile.display_name || 'U')[0].toUpperCase()}
                  </div>
                  <div className="text-left">
                    <h3 className="text-base font-semibold text-slate-900">{profile.display_name}</h3>
                    <p className="text-sm text-slate-600">{profile.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-sm font-medium text-slate-900">{profile.skills?.length || 0} skills</p>
                    <p className="text-xs text-slate-600">{profile.engagement_count} engagements</p>
                  </div>
                  <div className="flex gap-1">
                    {profile.certifications?.filter((c: any) => !c.is_expired).slice(0, 3).map((cert: any, i: number) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        <Award className="h-3 w-3" />
                        {cert.name?.substring(0, 10)}
                      </span>
                    ))}
                    {(profile.certifications?.filter((c: any) => c.is_expired)?.length || 0) > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-rose-500/20 text-rose-400 border border-rose-500/30">
                        <AlertTriangle className="h-3 w-3" />
                        {profile.certifications.filter((c: any) => c.is_expired).length} expired
                      </span>
                    )}
                  </div>
                  {expandedProfile === profile.user_id ? (
                    <ChevronUp className="h-5 w-5 text-slate-600" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-slate-600" />
                  )}
                </div>
              </button>

              {expandedProfile === profile.user_id && (
                <div className="border-t border-slate-200 p-5">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 mb-3">Skills & Proficiency</h4>
                      <div className="space-y-2.5">
                        {profile.skills?.map((skill: any) => (
                          <div key={skill.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white/50 border border-slate-200/30 group">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium text-slate-900">{skill.skill_name}</span>
                                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                  {(skill.skill_category || 'general').replace(/_/g, ' ')}
                                </span>
                              </div>
                              <ProficiencyBar level={skill.proficiency_level} />
                              {skill.years_experience > 0 && (
                                <span className="text-xs text-slate-500 mt-0.5 block">{skill.years_experience} yrs experience</span>
                              )}
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {canEdit && <button
                                onClick={() => setEditingSkill(skill)}
                                className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>}
                              {canDelete && <button
                                onClick={() => {
                                  if (confirm('Delete this skill?')) {
                                    deleteMutation.mutate(skill.id);
                                  }
                                }}
                                className="p-1.5 rounded hover:bg-rose-500/20 text-slate-600 hover:text-rose-400 transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 mb-3">Certifications</h4>
                      {profile.certifications?.length > 0 ? (
                        <div className="space-y-2">
                          {profile.certifications.map((cert: any, i: number) => (
                            <div key={i} className={`flex items-center justify-between p-3 rounded-lg border ${cert.is_expired ? 'bg-rose-500/5 border-rose-500/20' : 'bg-white/50 border-slate-200/30'}`}>
                              <div className="flex items-center gap-2">
                                <Award className={`h-4 w-4 ${cert.is_expired ? 'text-rose-400' : 'text-amber-400'}`} />
                                <div>
                                  <p className="text-sm font-medium text-slate-900">{cert.name}</p>
                                  <p className="text-xs text-slate-600">For: {cert.skill}</p>
                                </div>
                              </div>
                              {cert.expiry_date && (
                                <span className={`text-xs ${cert.is_expired ? 'text-rose-400' : 'text-slate-600'}`}>
                                  {cert.is_expired ? 'Expired' : 'Expires'}: {new Date(cert.expiry_date).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500 py-4 text-center">No certifications recorded</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-slate-900">Add Auditor Skill</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Auditor</label>
                <select
                  value={newSkill.user_id || ''}
                  onChange={(e) => setNewSkill({ ...newSkill, user_id: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select Auditor</option>
                  {(Array.isArray(tenantUsers) ? tenantUsers : []).map((tenantUser: any) => {
                    const userId = tenantUser.user?.id || tenantUser.id || tenantUser.user_id;
                    const userName = tenantUser.user?.display_name || tenantUser.user?.username || tenantUser.display_name || tenantUser.username || tenantUser.user?.email || tenantUser.email || 'User';
                    if (!userId) return null;
                    return (
                      <option key={userId} value={userId}>
                        {userName}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Skill Name</label>
                <input
                  type="text"
                  value={newSkill.skill_name}
                  onChange={(e) => setNewSkill({ ...newSkill, skill_name: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="e.g., SOX Compliance, IT Audit, Data Analytics"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={newSkill.skill_category}
                    onChange={(e) => setNewSkill({ ...newSkill, skill_category: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                  >
                    {SKILL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Proficiency</label>
                  <select
                    value={newSkill.proficiency_level}
                    onChange={(e) => setNewSkill({ ...newSkill, proficiency_level: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="beginner">Beginner (1)</option>
                    <option value="intermediate">Intermediate (2)</option>
                    <option value="advanced">Advanced (3)</option>
                    <option value="expert">Expert (4)</option>
                    <option value="master">Master (5)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Certification (optional)</label>
                  <input
                    type="text"
                    value={newSkill.certification}
                    onChange={(e) => setNewSkill({ ...newSkill, certification: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="e.g., CIA, CISA, CRISC"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cert Expiry</label>
                  <input
                    type="date"
                    value={newSkill.certification_expiry}
                    onChange={(e) => setNewSkill({ ...newSkill, certification_expiry: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Years Experience</label>
                <input
                  type="number"
                  step="0.5"
                  value={newSkill.years_experience}
                  onChange={(e) => setNewSkill({ ...newSkill, years_experience: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  value={newSkill.notes}
                  onChange={(e) => setNewSkill({ ...newSkill, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:text-slate-900 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const payload: Record<string, unknown> = { ...newSkill };
                  if (!payload.certification) delete payload.certification;
                  if (!payload.certification_expiry) delete payload.certification_expiry;
                  if (!payload.notes) delete payload.notes;
                  createMutation.mutate(payload);
                }}
                disabled={!newSkill.user_id || !newSkill.skill_name || createMutation.isPending}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50"
              >
                {createMutation.isPending ? 'Adding...' : 'Add Skill'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-slate-900">Edit Skill</h2>
              <button onClick={() => setEditingSkill(null)} className="text-slate-600 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Skill Name</label>
                <input
                  type="text"
                  value={editingSkill.skill_name}
                  onChange={(e) => setEditingSkill({ ...editingSkill, skill_name: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={editingSkill.skill_category}
                    onChange={(e) => setEditingSkill({ ...editingSkill, skill_category: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                  >
                    {SKILL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Proficiency</label>
                  <select
                    value={editingSkill.proficiency_level}
                    onChange={(e) => setEditingSkill({ ...editingSkill, proficiency_level: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="beginner">Beginner (1)</option>
                    <option value="intermediate">Intermediate (2)</option>
                    <option value="advanced">Advanced (3)</option>
                    <option value="expert">Expert (4)</option>
                    <option value="master">Master (5)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Certification</label>
                  <input
                    type="text"
                    value={editingSkill.certification || ''}
                    onChange={(e) => setEditingSkill({ ...editingSkill, certification: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cert Expiry</label>
                  <input
                    type="date"
                    value={editingSkill.certification_expiry?.split('T')[0] || ''}
                    onChange={(e) => setEditingSkill({ ...editingSkill, certification_expiry: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Years Experience</label>
                <input
                  type="number"
                  step="0.5"
                  value={editingSkill.years_experience || 0}
                  onChange={(e) => setEditingSkill({ ...editingSkill, years_experience: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setEditingSkill(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:text-slate-900 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  updateMutation.mutate({
                    id: editingSkill.id,
                    data: {
                      skill_name: editingSkill.skill_name,
                      skill_category: editingSkill.skill_category,
                      proficiency_level: editingSkill.proficiency_level,
                      certification: editingSkill.certification || null,
                      certification_expiry: editingSkill.certification_expiry || null,
                      years_experience: editingSkill.years_experience,
                    },
                  });
                }}
                disabled={updateMutation.isPending}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAiSkillsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">AI Skill Recommendations</h2>
                  <p className="text-xs text-slate-600">Get L1/L2/L3 skill profiles for any audit type</p>
                </div>
              </div>
              <button onClick={() => setShowAiSkillsModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Audit Type</label>
                <select
                  value={aiAuditType}
                  onChange={(e) => setAiAuditType(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-purple-500"
                >
                  <option value="">Select audit type...</option>
                  {AUDIT_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Or From Engagement</label>
                <select
                  value={aiEngagementId}
                  onChange={(e) => setAiEngagementId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-purple-500"
                >
                  <option value="">Select engagement...</option>
                  {Array.isArray(engagementsList) &&
                    engagementsList.map((eng: any) => (
                      <option key={eng.id} value={eng.id}>{eng.title} ({eng.status})</option>
                    ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleAiSuggestSkills}
              disabled={(!aiAuditType && !aiEngagementId) || aiGenerating}
              className="w-full mb-6 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-slate-900 text-sm font-medium disabled:opacity-50 transition-all"
            >
              {aiGenerating ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing Required Skills...</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Generate Skill Recommendations</>
              )}
            </button>

            {aiError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
                <p className="text-sm text-rose-400">{aiError}</p>
              </div>
            )}

            {aiSkillResults && (
              <div className="space-y-6">
                <div className="p-4 rounded-xl bg-gradient-to-r from-purple-500/5 to-blue-500/5 border border-purple-500/20">
                  <h3 className="text-sm font-semibold text-slate-900 mb-1">
                    {aiSkillResults.audit_type_label || aiSkillResults.audit_type}
                  </h3>
                  {aiSkillResults.team_composition_suggestion && (
                    <p className="text-xs text-slate-600">{aiSkillResults.team_composition_suggestion}</p>
                  )}
                </div>

                {['L1', 'L2', 'L3'].map((level) => {
                  const levelSkills = (aiSkillResults.recommended_skills || []).filter((s: any) => s.level === level);
                  if (levelSkills.length === 0) return null;
                  const levelLabel = level === 'L1' ? 'Foundation' : level === 'L2' ? 'Domain-Specific' : 'Specialist / Expert';
                  return (
                    <div key={level}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${LEVEL_COLORS[level]}`}>
                          {level}
                        </span>
                        <span className="text-sm font-medium text-slate-700">{levelLabel}</span>
                        <span className="text-xs text-slate-500">({levelSkills.length} skills)</span>
                      </div>
                      <div className="space-y-2">
                        {levelSkills.map((skill: any, idx: number) => (
                          <div key={idx} className="flex items-start justify-between p-3 rounded-lg bg-white/80 border border-slate-200/30">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium text-slate-900">{skill.skill_name}</span>
                                {skill.priority && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_BADGES[skill.priority] || PRIORITY_BADGES.recommended}`}>
                                    {skill.priority?.replace(/_/g, ' ')}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-600 line-clamp-2">{skill.rationale}</p>
                              <div className="flex items-center gap-3 mt-1.5">
                                <span className="text-[10px] text-slate-500">
                                  Proficiency: <span className="text-slate-700">{skill.proficiency_required}</span>
                                </span>
                                {skill.suggested_certification && (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
                                    <Award className="h-3 w-3" /> {skill.suggested_certification}
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => handleAddSuggestedSkill(skill)}
                              className="ml-3 flex-shrink-0 px-2.5 py-1 rounded-md bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 text-xs font-medium transition-colors"
                            >
                              + Add
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {aiSkillResults.cross_domain_skills?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Layers className="h-4 w-4 text-cyan-400" />
                      <span className="text-sm font-medium text-slate-700">Cross-Domain Skills</span>
                      <span className="text-xs text-slate-500">({aiSkillResults.cross_domain_skills.length})</span>
                    </div>
                    <div className="space-y-2">
                      {aiSkillResults.cross_domain_skills.map((skill: any, idx: number) => (
                        <div key={idx} className="flex items-start justify-between p-3 rounded-lg bg-white/80 border border-cyan-500/20">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-slate-900">{skill.skill_name}</span>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${LEVEL_COLORS[skill.level] || LEVEL_COLORS.L2}`}>
                                {skill.level}
                              </span>
                              <span className="text-[10px] text-cyan-400/70">from {skill.source_domain?.replace(/_/g, ' ')}</span>
                            </div>
                            <p className="text-xs text-slate-600">{skill.rationale}</p>
                          </div>
                          <button
                            onClick={() => handleAddSuggestedSkill({ ...skill, category: 'general' })}
                            className="ml-3 flex-shrink-0 px-2.5 py-1 rounded-md bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30 text-xs font-medium transition-colors"
                          >
                            + Add
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {aiSkillResults.skill_gap_warning && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                      <span className="text-sm font-medium text-amber-300">Skill Gap Warning</span>
                    </div>
                    <p className="text-xs text-slate-600">{aiSkillResults.skill_gap_warning}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showFindModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-slate-900">Find Auditor by Skills</h2>
              <button onClick={() => setShowFindModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Skills (comma-separated)</label>
                <input
                  type="text"
                  value={findSkills}
                  onChange={(e) => setFindSkills(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="e.g., SOX, IT Audit, CISA"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Framework</label>
                <input
                  type="text"
                  value={findFramework}
                  onChange={(e) => setFindFramework(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="e.g., ISO 27001, PCI DSS"
                />
              </div>
            </div>

            {matchResults?.matches?.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">{matchResults.total} matching auditors found</p>
                {matchResults.matches.map((match: any) => (
                  <div key={match.user_id} className="p-4 rounded-lg bg-white border border-slate-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold">
                          {(match.display_name || 'U')[0].toUpperCase()}
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">{match.display_name}</h3>
                          <p className="text-xs text-slate-600">{match.email}</p>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-emerald-400">Score: {match.match_score}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {match.matched_skills?.map((s: any, i: number) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-slate-100 text-slate-700">
                          {s.skill_name}
                          <span className="text-slate-500">·</span>
                          <span className={`${PROFICIENCY_COLORS[s.proficiency_level?.toLowerCase()] || 'bg-blue-500'} h-2 w-2 rounded-full inline-block`} />
                          {s.proficiency_level}
                          {s.certification && (
                            <>
                              <span className="text-slate-500">·</span>
                              <Award className="h-3 w-3 text-amber-400" />
                            </>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (findSkills || findFramework) ? (
              <div className="text-center py-8">
                <UserCheck className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No matching auditors found</p>
              </div>
            ) : (
              <div className="text-center py-8">
                <Search className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Enter skills or framework to search</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
