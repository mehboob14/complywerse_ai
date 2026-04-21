'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  FileText,
  Plus,
  Search,
  X,
  Copy,
  Trash2,
  Edit3,
  ChevronDown,
  ChevronUp,
  Tag,
  Clock,
  Hash,
  Filter,
  ArrowLeft,
  Sparkles,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';

const CONTROL_AREAS = [
  'Access Control', 'Change Management', 'Data Protection', 'Financial Controls',
  'IT General Controls', 'Network Security', 'Business Continuity', 'Compliance',
  'Segregation of Duties', 'Vendor Management', 'Incident Management', 'Other',
];

const TEST_TYPES = [
  { value: 'control_test', label: 'Control Test' },
  { value: 'substantive_test', label: 'Substantive Test' },
  { value: 'walkthrough', label: 'Walkthrough' },
  { value: 'inquiry', label: 'Inquiry' },
  { value: 'observation', label: 'Observation' },
  { value: 'inspection', label: 'Inspection' },
];

const SAMPLING_METHODS = [
  { value: 'statistical', label: 'Statistical' },
  { value: 'judgmental', label: 'Judgmental' },
  { value: 'haphazard', label: 'Haphazard' },
  { value: 'block', label: 'Block' },
];

interface TestScript {
  id: number;
  title: string;
  objective: string | null;
  procedure_steps: Array<{ step: string; description?: string }>;
  control_area: string | null;
  entity_type: string | null;
  framework_id: number | null;
  test_type: string;
  sampling_methodology: string | null;
  expected_evidence: string | null;
  tags: string[];
  usage_count: number;
  last_used_date: string | null;
  created_by: string | null;
  created_at: string | null;
}

export default function TestScriptsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('audit:audit_management:create');
  const canEdit = hasPermission('audit:audit_management:edit');
  const canDelete = hasPermission('audit:audit_management:delete');
  const [search, setSearch] = useState('');
  const [filterArea, setFilterArea] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingScript, setEditingScript] = useState<TestScript | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCloneModal, setShowCloneModal] = useState<number | null>(null);
  const [cloneEngagementId, setCloneEngagementId] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiEngagementId, setAiEngagementId] = useState('');
  const [aiError, setAiError] = useState('');

  const [form, setForm] = useState({
    title: '',
    objective: '',
    procedure_steps: [{ step: '', description: '' }],
    control_area: '',
    entity_type: '',
    test_type: 'control_test',
    sampling_methodology: '',
    expected_evidence: '',
    tags: '' as string,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['test-scripts', search, filterArea, filterType],
    queryFn: () =>
      auditApi.testScripts
        .getAll({
          search: search || undefined,
          control_area: filterArea || undefined,
          test_type: filterType || undefined,
        })
        .then((r) => r.data),
  });

  const { data: engagements } = useQuery({
    queryKey: ['audit-engagements-list'],
    queryFn: () => auditApi.engagements.getAll().then((r) => r.data?.engagements || r.data || []),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.testScripts.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-scripts'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      auditApi.testScripts.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-scripts'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => auditApi.testScripts.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['test-scripts'] }),
  });

  const cloneMutation = useMutation({
    mutationFn: ({ id, engagement_id }: { id: number; engagement_id: number }) =>
      auditApi.testScripts.cloneToEngagement(id, { engagement_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-scripts'] });
      setShowCloneModal(null);
      setCloneEngagementId('');
    },
  });

  const resetForm = () => {
    setShowModal(false);
    setEditingScript(null);
    setAiEngagementId('');
    setForm({
      title: '',
      objective: '',
      procedure_steps: [{ step: '', description: '' }],
      control_area: '',
      entity_type: '',
      test_type: 'control_test',
      sampling_methodology: '',
      expected_evidence: '',
      tags: '',
    });
  };

  const handleAiGenerate = async () => {
    if (!aiEngagementId) return;
    setAiGenerating(true);
    setAiError('');
    try {
      const res = await auditApi.testScripts.generateFromEngagement({
        engagement_id: parseInt(aiEngagementId),
        create_scripts: false,
        max_scripts: 1,
      });
      const script = Array.isArray(res.data?.scripts) ? res.data.scripts[0] : null;
      if (script) {
        const steps = (script.procedure_steps || []).map((s: any) => {
          if (typeof s === 'string') {
            return { step: s, description: '' };
          }
          return {
            step: s.step || s.description || '',
            description: s.description || s.expected_result || '',
          };
        });
        setForm({
          title: script.title || '',
          objective: script.objective || '',
          procedure_steps: steps.length > 0 ? steps : [{ step: '', description: '' }],
          control_area: script.control_area || '',
          entity_type: script.entity_type || '',
          test_type: script.test_type || 'control_test',
          sampling_methodology: script.sampling_methodology || '',
          expected_evidence: script.expected_evidence || '',
          tags: Array.isArray(script.tags) ? script.tags.join(', ') : '',
        });
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'AI generation failed. Please try again.';
      setAiError(msg);
    } finally {
      setAiGenerating(false);
    }
  };

  const openEdit = (script: TestScript) => {
    setEditingScript(script);
    setForm({
      title: script.title,
      objective: script.objective || '',
      procedure_steps:
        script.procedure_steps?.length > 0
          ? script.procedure_steps.map((step) => ({
              step: step.step || '',
              description: step.description || '',
            }))
          : [{ step: '', description: '' }],
      control_area: script.control_area || '',
      entity_type: script.entity_type || '',
      test_type: script.test_type || 'control_test',
      sampling_methodology: script.sampling_methodology || '',
      expected_evidence: script.expected_evidence || '',
      tags: (script.tags || []).join(', '),
    });
    setShowModal(true);
  };

  const handleSubmit = () => {
    const payload: Record<string, unknown> = {
      title: form.title,
      objective: form.objective || null,
      procedure_steps: form.procedure_steps.filter((s) => s.step.trim()),
      control_area: form.control_area || null,
      entity_type: form.entity_type || null,
      test_type: form.test_type,
      sampling_methodology: form.sampling_methodology || null,
      expected_evidence: form.expected_evidence || null,
      tags: form.tags
        ? form.tags
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean)
        : [],
    };

    if (editingScript) {
      updateMutation.mutate({ id: editingScript.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const addStep = () => {
    setForm({ ...form, procedure_steps: [...form.procedure_steps, { step: '', description: '' }] });
  };

  const removeStep = (idx: number) => {
    setForm({
      ...form,
      procedure_steps: form.procedure_steps.filter((_, i) => i !== idx),
    });
  };

  const updateStep = (idx: number, field: string, value: string) => {
    const steps = [...form.procedure_steps];
    steps[idx] = { ...steps[idx], [field]: value };
    setForm({ ...form, procedure_steps: steps });
  };

  const scripts: TestScript[] = data?.test_scripts || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/audit"
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Test Script Library</h1>
            <p className="text-slate-600 mt-1">
              Reusable audit test procedures and scripts
            </p>
          </div>
        </div>
        {canCreate && <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all text-sm"
        >
          <Plus className="h-4 w-4" />
          New Test Script
        </button>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search test scripts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 placeholder:text-slate-600 text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-500" />
          <select
            value={filterArea}
            onChange={(e) => setFilterArea(e.target.value)}
            className="px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Control Areas</option>
            {CONTROL_AREAS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Test Types</option>
            {TEST_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white rounded-xl animate-pulse border border-slate-200" />
          ))}
        </div>
      ) : scripts.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-slate-200 bg-white">
          <FileText className="h-12 w-12 text-slate-600 mx-auto mb-3" />
          <p className="text-lg font-medium text-slate-600">No test scripts found</p>
          <p className="text-sm text-slate-500 mt-1">Create your first test script to build your library</p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
          >
            <Plus className="h-4 w-4" />
            New Test Script
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {scripts.map((script) => (
            <div
              key={script.id}
              className="rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden"
            >
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/80 transition-colors"
                onClick={() => setExpandedId(expandedId === script.id ? null : script.id)}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="h-10 w-10 rounded-lg bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                    <FileText className="h-5 w-5 text-indigo-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{script.title}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {script.control_area && (
                        <span className="text-xs text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full">
                          {script.control_area}
                        </span>
                      )}
                      <span className="text-xs text-slate-500 capitalize">
                        {(script.test_type || '').replace(/_/g, ' ')}
                      </span>
                      {script.usage_count > 0 && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Hash className="h-3 w-3" />
                          Used {script.usage_count}x
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {script.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="hidden sm:inline text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-300/30"
                    >
                      {tag}
                    </span>
                  ))}
                  {canEdit && <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(script);
                    }}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCloneModal(script.id);
                    }}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                    title="Clone to Engagement"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  {canDelete && <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Delete this test script?')) deleteMutation.mutate(script.id);
                    }}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>}
                  {expandedId === script.id ? (
                    <ChevronUp className="h-4 w-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-500" />
                  )}
                </div>
              </div>

              {expandedId === script.id && (
                <div className="border-t border-slate-200 p-4 bg-white/30 space-y-4">
                  {script.objective && (
                    <div>
                      <p className="text-xs font-medium text-slate-600 mb-1">Objective</p>
                      <p className="text-sm text-slate-700">{script.objective}</p>
                    </div>
                  )}

                  {script.procedure_steps?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-600 mb-2">Test Steps</p>
                      <ol className="space-y-2">
                        {script.procedure_steps.map((step: any, idx: number) => (
                          <li key={idx} className="flex gap-3">
                            <span className="flex-shrink-0 h-6 w-6 rounded-full bg-indigo-500/20 text-indigo-400 text-xs flex items-center justify-center font-medium">
                              {idx + 1}
                            </span>
                            <div>
                              <p className="text-sm text-slate-900">{step.step || step}</p>
                              {step.description && (
                                <p className="text-xs text-slate-500 mt-0.5">{step.description}</p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {script.sampling_methodology && (
                      <div className="rounded-lg bg-white/80 p-3 border border-slate-200/30">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Sampling</p>
                        <p className="text-sm text-slate-700 capitalize mt-0.5">
                          {script.sampling_methodology}
                        </p>
                      </div>
                    )}
                    {script.entity_type && (
                      <div className="rounded-lg bg-white/80 p-3 border border-slate-200/30">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Entity Type</p>
                        <p className="text-sm text-slate-700 capitalize mt-0.5">{script.entity_type}</p>
                      </div>
                    )}
                    {script.last_used_date && (
                      <div className="rounded-lg bg-white/80 p-3 border border-slate-200/30">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Last Used</p>
                        <p className="text-sm text-slate-700 mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(script.last_used_date).toLocaleDateString()}
                        </p>
                      </div>
                    )}
                    {script.created_by && (
                      <div className="rounded-lg bg-white/80 p-3 border border-slate-200/30">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Created By</p>
                        <p className="text-sm text-slate-700 mt-0.5">{script.created_by}</p>
                      </div>
                    )}
                  </div>

                  {script.expected_evidence && (
                    <div>
                      <p className="text-xs font-medium text-slate-600 mb-1">Expected Evidence</p>
                      <p className="text-sm text-slate-700">{script.expected_evidence}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">
                {editingScript ? 'Edit Test Script' : 'Create Test Script'}
              </h2>
              <button onClick={resetForm} className="p-1 text-slate-600 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {!editingScript && (
                <div className="p-4 rounded-xl bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="h-4 w-4 text-purple-400" />
                    <span className="text-sm font-medium text-purple-300">AI Generate from Engagement</span>
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={aiEngagementId}
                      onChange={(e) => setAiEngagementId(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm focus:outline-none focus:border-purple-500"
                    >
                      <option value="">Select an engagement...</option>
                      {Array.isArray(engagements) &&
                        engagements.map((eng: any) => (
                          <option key={eng.id} value={eng.id}>
                            {eng.title} ({eng.status})
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={handleAiGenerate}
                      disabled={!aiEngagementId || aiGenerating}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-slate-900 text-sm font-medium disabled:opacity-50 transition-all whitespace-nowrap"
                    >
                      {aiGenerating ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
                      ) : (
                        <><Sparkles className="h-4 w-4" /> Generate</>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    AI uses engagement details and recent findings to auto-populate test script fields
                  </p>
                  {aiError && (
                    <div className="mt-2 p-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
                      <p className="text-xs text-rose-400">{aiError}</p>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="e.g., Access Review Test Procedure"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Objective</label>
                <textarea
                  value={form.objective}
                  onChange={(e) => setForm({ ...form, objective: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="What this test aims to verify..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Control Area</label>
                  <select
                    value={form.control_area}
                    onChange={(e) => setForm({ ...form, control_area: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Select...</option>
                    {CONTROL_AREAS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Test Type</label>
                  <select
                    value={form.test_type}
                    onChange={(e) => setForm({ ...form, test_type: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                  >
                    {TEST_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Sampling Methodology
                  </label>
                  <select
                    value={form.sampling_methodology}
                    onChange={(e) => setForm({ ...form, sampling_methodology: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Select...</option>
                    {SAMPLING_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Entity Type</label>
                  <input
                    type="text"
                    value={form.entity_type}
                    onChange={(e) => setForm({ ...form, entity_type: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-indigo-500"
                    placeholder="e.g., IT, Financial, Operational"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Test Steps</label>
                  <button
                    type="button"
                    onClick={addStep}
                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add Step
                  </button>
                </div>
                <div className="space-y-2">
                  {form.procedure_steps.map((step, idx) => (
                    <div key={idx} className="flex gap-2">
                      <span className="flex-shrink-0 mt-2 h-6 w-6 rounded-full bg-indigo-500/20 text-indigo-400 text-xs flex items-center justify-center font-medium">
                        {idx + 1}
                      </span>
                      <div className="flex-1 space-y-1">
                        <input
                          type="text"
                          value={step.step}
                          onChange={(e) => updateStep(idx, 'step', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-indigo-500"
                          placeholder="Test step description..."
                        />
                        <input
                          type="text"
                          value={step.description || ''}
                          onChange={(e) => updateStep(idx, 'description', e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-200/30 text-slate-600 text-xs focus:outline-none focus:border-indigo-500"
                          placeholder="Additional details (optional)"
                        />
                      </div>
                      {form.procedure_steps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeStep(idx)}
                          className="mt-2 p-1 text-slate-500 hover:text-rose-400"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Expected Evidence
                </label>
                <textarea
                  value={form.expected_evidence}
                  onChange={(e) => setForm({ ...form, expected_evidence: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="What evidence should be collected..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  <Tag className="h-3 w-3 inline mr-1" />
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="e.g., SOX, quarterly, automated"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-200">
              <button
                onClick={resetForm}
                className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:text-slate-900 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!form.title.trim() || createMutation.isPending || updateMutation.isPending}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm disabled:opacity-50"
              >
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
                  : editingScript
                  ? 'Update'
                  : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCloneModal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Clone to Engagement</h2>
              <button
                onClick={() => {
                  setShowCloneModal(null);
                  setCloneEngagementId('');
                }}
                className="p-1 text-slate-600 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-600">
                Select an engagement to clone this test script as a workpaper.
              </p>
              <select
                value={cloneEngagementId}
                onChange={(e) => setCloneEngagementId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm focus:outline-none focus:border-indigo-500"
              >
                <option value="">Select engagement...</option>
                {Array.isArray(engagements) &&
                  engagements.map((eng: any) => (
                    <option key={eng.id} value={eng.id}>
                      {eng.title} ({eng.status})
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-200">
              <button
                onClick={() => {
                  setShowCloneModal(null);
                  setCloneEngagementId('');
                }}
                className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:text-slate-900 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (showCloneModal && cloneEngagementId) {
                    cloneMutation.mutate({
                      id: showCloneModal,
                      engagement_id: parseInt(cloneEngagementId),
                    });
                  }
                }}
                disabled={!cloneEngagementId || cloneMutation.isPending}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm disabled:opacity-50"
              >
                {cloneMutation.isPending ? 'Cloning...' : 'Clone'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
