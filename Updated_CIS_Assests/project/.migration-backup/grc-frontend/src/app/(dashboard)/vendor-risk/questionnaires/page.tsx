'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { vendorRiskApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { SearchInput, MultiSelectDropdown, RightSlidePanel } from '@/components/ui';
import {
  ClipboardList,
  Loader2,
  Plus,
  X,
  Send,
  Trash2,
  Shield,
  Lock,
  FileCheck,
  DollarSign,
  Settings,
  Sparkles,
  FileText,
  Paperclip,
  Copy,
  Eye,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';


interface Question {
  id: string;
  text: string;
  type: 'text' | 'yes_no' | 'multiple_choice' | 'rating';
  required: boolean;
  evidence_required: boolean;
  weight: number;
  options?: string[];
}

interface QuestionnaireTemplate {
  id: number;
  name: string;
  description: string | null;
  category: string;
  questions: Question[];
  created_at: string;
  updated_at: string;
}

interface VendorOption {
  id: number;
  name: string;
  primary_contact_email: string | null;
  primary_contact_name: string | null;
}

interface AssessmentOption {
  id: number;
  vendor_id: number;
  vendor_name?: string;
  assessment_type: string;
  status: string;
}

interface QuestionnaireResponseRecord {
  id: number;
  vendor_id: number;
  assessment_id: number | null;
  template_id: number | null;
  respondent_name: string | null;
  respondent_email: string | null;
  responses: Record<string, unknown>;
  status: string;
  token: string;
  expires_at: string | null;
  submitted_at: string | null;
  created_at: string | null;
}


const CATEGORIES = ['security', 'privacy', 'compliance', 'operational', 'financial', 'general'];

const getCategoryBadge = (category: string) => {
  const styles: Record<string, string> = {
    security: 'bg-red-100 text-red-700',
    privacy: 'bg-purple-100 text-purple-700',
    compliance: 'bg-blue-100 text-blue-700',
    operational: 'bg-orange-100 text-orange-700',
    financial: 'bg-green-100 text-green-700',
    general: 'bg-gray-100 text-gray-700',
  };
  return styles[category?.toLowerCase()] || 'bg-gray-100 text-gray-700';
};

const getCategoryIcon = (category: string) => {
  const icons: Record<string, typeof Shield> = {
    security: Shield,
    privacy: Lock,
    compliance: FileCheck,
    operational: Settings,
    financial: DollarSign,
    general: ClipboardList,
  };
  return icons[category?.toLowerCase()] || ClipboardList;
};

const getResponseStatusPill = (status: string) => {
  const tones: Record<string, string> = {
    pending: 'bg-amber-600 text-white border-amber-700',
    in_progress: 'bg-blue-600 text-white border-blue-700',
    submitted: 'bg-emerald-600 text-white border-emerald-700',
    expired: 'bg-gray-600 text-white border-gray-700',
  };
  return tones[status?.toLowerCase()] || 'bg-gray-600 text-white border-gray-700';
};

const formatAssessmentType = (value: string) =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());


const DEFAULT_QUESTIONS: Record<string, Question[]> = {
  security: [
    { id: 's1', text: 'Does your organization encrypt data at rest and in transit using industry-standard encryption (e.g., AES-256, TLS 1.2+)?', type: 'yes_no', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 's2', text: 'Do you enforce multi-factor authentication (MFA) for all system access?', type: 'yes_no', required: true, evidence_required: false, weight: 4, options: [] },
    { id: 's3', text: 'Describe your access control policies (RBAC, least privilege, access reviews).', type: 'text', required: true, evidence_required: true, weight: 4, options: [] },
    { id: 's4', text: 'Do you have a documented incident response plan that is tested at least annually?', type: 'yes_no', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 's5', text: 'How frequently do you perform vulnerability scanning on your systems?', type: 'multiple_choice', required: true, evidence_required: false, weight: 4, options: ['Continuous', 'Weekly', 'Monthly', 'Quarterly', 'Annually', 'Never'] },
    { id: 's6', text: 'When was your last third-party penetration test conducted? Provide the executive summary.', type: 'text', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 's7', text: 'Is your network segmented to isolate sensitive data and critical systems?', type: 'yes_no', required: true, evidence_required: false, weight: 3, options: [] },
    { id: 's8', text: 'What endpoint protection solution do you use across your fleet?', type: 'text', required: true, evidence_required: false, weight: 3, options: [] },
    { id: 's9', text: 'Do you conduct security awareness training for all employees? How frequently?', type: 'multiple_choice', required: true, evidence_required: true, weight: 3, options: ['Quarterly', 'Semi-annually', 'Annually', 'At onboarding only', 'No training program'] },
    { id: 's10', text: 'What is your average patch management SLA for critical vulnerabilities?', type: 'multiple_choice', required: true, evidence_required: false, weight: 4, options: ['Within 24 hours', 'Within 72 hours', 'Within 7 days', 'Within 30 days', 'No formal SLA'] },
  ],
  privacy: [
    { id: 'p1', text: 'Do you have a signed Data Processing Agreement (DPA) or equivalent data protection addendum?', type: 'yes_no', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 'p2', text: 'Describe your data retention and deletion policy. What are the retention periods?', type: 'text', required: true, evidence_required: true, weight: 4, options: [] },
    { id: 'p3', text: 'How do you handle data subject access requests (DSARs) and right-to-erasure requests?', type: 'text', required: true, evidence_required: false, weight: 4, options: [] },
    { id: 'p4', text: 'Do you transfer personal data across international borders? If yes, what transfer mechanisms are in place?', type: 'text', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 'p5', text: 'Do you conduct Privacy Impact Assessments (PIAs) for new processing activities?', type: 'yes_no', required: true, evidence_required: true, weight: 4, options: [] },
    { id: 'p6', text: 'What is your data breach notification timeline to affected parties and regulators?', type: 'multiple_choice', required: true, evidence_required: false, weight: 5, options: ['Within 24 hours', 'Within 48 hours', 'Within 72 hours', 'Within 7 days', 'No defined timeline'] },
    { id: 'p7', text: 'Describe your data minimization practices. How do you ensure only necessary data is collected?', type: 'text', required: true, evidence_required: false, weight: 3, options: [] },
    { id: 'p8', text: 'Do you use sub-processors? If yes, provide a list and explain oversight mechanisms.', type: 'text', required: true, evidence_required: true, weight: 4, options: [] },
  ],
  compliance: [
    { id: 'c1', text: 'Which security certifications does your organization currently hold?', type: 'multiple_choice', required: true, evidence_required: true, weight: 5, options: ['SOC 2 Type II', 'ISO 27001', 'PCI DSS', 'HIPAA', 'FedRAMP', 'CSA STAR', 'None'] },
    { id: 'c2', text: 'When was your most recent external audit completed? Share the audit report or certification.', type: 'text', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 'c3', text: 'How do you monitor and respond to changes in regulatory requirements relevant to your services?', type: 'text', required: true, evidence_required: false, weight: 3, options: [] },
    { id: 'c4', text: 'Do you provide compliance training to employees? How often?', type: 'multiple_choice', required: true, evidence_required: false, weight: 3, options: ['Quarterly', 'Semi-annually', 'Annually', 'At onboarding only', 'No training'] },
    { id: 'c5', text: 'Do you screen against sanctions lists (OFAC, EU sanctions) for your customers and partners?', type: 'yes_no', required: true, evidence_required: false, weight: 4, options: [] },
    { id: 'c6', text: 'Do you have an anti-bribery and anti-corruption policy in place?', type: 'yes_no', required: true, evidence_required: true, weight: 3, options: [] },
  ],
  operational: [
    { id: 'o1', text: 'Do you have a documented Business Continuity Plan (BCP) and Disaster Recovery (DR) plan?', type: 'yes_no', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 'o2', text: 'What are your Recovery Time Objective (RTO) and Recovery Point Objective (RPO) targets?', type: 'text', required: true, evidence_required: false, weight: 4, options: [] },
    { id: 'o3', text: 'Describe your change management process for production systems.', type: 'text', required: true, evidence_required: true, weight: 4, options: [] },
    { id: 'o4', text: 'How do you monitor SLA compliance and system uptime? What is your guaranteed uptime?', type: 'text', required: true, evidence_required: false, weight: 4, options: [] },
    { id: 'o5', text: 'Describe your incident escalation process and communication plan during outages.', type: 'text', required: true, evidence_required: true, weight: 3, options: [] },
    { id: 'o6', text: 'What measures do you take to ensure staff continuity and knowledge transfer?', type: 'text', required: true, evidence_required: false, weight: 3, options: [] },
  ],
  financial: [
    { id: 'f1', text: 'Can you provide audited financial statements or evidence of financial stability?', type: 'yes_no', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 'f2', text: 'What types of insurance coverage do you maintain (cyber liability, E&O, general liability)?', type: 'text', required: true, evidence_required: true, weight: 4, options: [] },
    { id: 'f3', text: 'Describe your billing practices and payment terms.', type: 'text', required: true, evidence_required: false, weight: 2, options: [] },
    { id: 'f4', text: 'What are the terms for contract termination, including data return and transition assistance?', type: 'text', required: true, evidence_required: false, weight: 3, options: [] },
    { id: 'f5', text: 'Do you provide regular financial performance reports to clients upon request?', type: 'yes_no', required: false, evidence_required: false, weight: 2, options: [] },
  ],
};


const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const labelClass = 'block text-sm font-medium text-gray-800 mb-1';


export default function VendorQuestionnairesPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('vendor_risk:questionnaires:create');
  const canDelete = hasPermission('vendor_risk:questionnaires:delete');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState<QuestionnaireTemplate | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sendSuccess, setSendSuccess] = useState<{ token: string } | null>(null);
  const [selectedResponse, setSelectedResponse] = useState<QuestionnaireResponseRecord | null>(null);

  const emptyQuestion = (): Question => ({
    id: crypto.randomUUID?.() || String(Date.now()),
    text: '',
    type: 'text',
    required: true,
    evidence_required: false,
    weight: 3,
    options: [],
  });

  const [templateForm, setTemplateForm] = useState({
    name: '',
    description: '',
    category: 'security',
    questions: [emptyQuestion()],
  });

  const [sendForm, setSendForm] = useState({
    vendor_id: '',
    assessment_id: '',
    respondent_email: '',
    respondent_name: '',
  });


  const { data: templates, isLoading } = useQuery({
    queryKey: ['questionnaire-templates'],
    queryFn: async () => {
      const res = await vendorRiskApi.getTemplates();
      const data = res.data;
      return (Array.isArray(data) ? data : data.items ?? []) as QuestionnaireTemplate[];
    },
    placeholderData: keepPreviousData,
  });

  const { data: vendors } = useQuery({
    queryKey: ['vendors-select'],
    queryFn: async () => {
      const res = await vendorRiskApi.getVendors();
      const data = res.data;
      return (Array.isArray(data) ? data : data.items ?? []) as VendorOption[];
    },
    placeholderData: keepPreviousData,
  });

  const { data: assessments } = useQuery({
    queryKey: ['vendor-assessments-for-questionnaires'],
    queryFn: async () => {
      const res = await vendorRiskApi.getAssessments({ limit: 1000 });
      const data = res.data;
      return (Array.isArray(data) ? data : data.items ?? []) as AssessmentOption[];
    },
    placeholderData: keepPreviousData,
  });

  const { data: questionnaireResponses } = useQuery({
    queryKey: ['questionnaire-responses'],
    queryFn: async () => {
      const res = await vendorRiskApi.getQuestionnaireResponses();
      const data = res.data;
      return (Array.isArray(data) ? data : []) as QuestionnaireResponseRecord[];
    },
    placeholderData: keepPreviousData,
  });


  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await vendorRiskApi.createTemplate(data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questionnaire-templates'] });
      setShowCreateModal(false);
      setTemplateForm({ name: '', description: '', category: 'security', questions: [emptyQuestion()] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await vendorRiskApi.deleteTemplate(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questionnaire-templates'] });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await vendorRiskApi.sendQuestionnaire(data);
      return res.data;
    },
    onSuccess: (data: any) => {
      setSendSuccess({ token: data.token });
      queryClient.invalidateQueries({ queryKey: ['questionnaire-responses'] });
    },
  });


  const addQuestion = () => {
    setTemplateForm((prev) => ({
      ...prev,
      questions: [...prev.questions, emptyQuestion()],
    }));
  };

  const removeQuestion = (idx: number) => {
    setTemplateForm((prev) => ({
      ...prev,
      questions: prev.questions.filter((_, i) => i !== idx),
    }));
  };

  const updateQuestion = (idx: number, field: string, value: unknown) => {
    setTemplateForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) => (i === idx ? { ...q, [field]: value } : q)),
    }));
  };

  const addOption = (qIdx: number) => {
    setTemplateForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) =>
        i === qIdx ? { ...q, options: [...(q.options || []), ''] } : q
      ),
    }));
  };

  const updateOption = (qIdx: number, optIdx: number, value: string) => {
    setTemplateForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) =>
        i === qIdx
          ? { ...q, options: (q.options || []).map((o, j) => (j === optIdx ? value : o)) }
          : q
      ),
    }));
  };

  const removeOption = (qIdx: number, optIdx: number) => {
    setTemplateForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) =>
        i === qIdx ? { ...q, options: (q.options || []).filter((_, j) => j !== optIdx) } : q
      ),
    }));
  };

  const loadDefaultQuestions = (category: string) => {
    const defaults = DEFAULT_QUESTIONS[category];
    if (defaults) {
      setTemplateForm((prev) => ({
        ...prev,
        questions: defaults.map((q) => ({ ...q, id: crypto.randomUUID?.() || String(Date.now() + Math.random()) })),
      }));
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name: templateForm.name,
      description: templateForm.description,
      category: templateForm.category,
      questions: templateForm.questions.filter((q) => q.text.trim()),
    });
  };

  const handleSendSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMutation.mutate({
      template_id: selectedTemplateId,
      vendor_id: Number(sendForm.vendor_id),
      assessment_id: sendForm.assessment_id ? Number(sendForm.assessment_id) : undefined,
      respondent_email: sendForm.respondent_email || undefined,
      respondent_name: sendForm.respondent_name || undefined,
    });
  };

  const filtered = useMemo(() => {
    if (!templates) return [];
    if (!searchTerm) return templates;
    const term = searchTerm.toLowerCase();
    return templates.filter(
      (t) => t.name.toLowerCase().includes(term) || t.category?.toLowerCase().includes(term)
    );
  }, [templates, searchTerm]);

  const templatesById = useMemo(() => {
    const map = new Map<number, QuestionnaireTemplate>();
    (templates || []).forEach((template) => map.set(template.id, template));
    return map;
  }, [templates]);

  const vendorsById = useMemo(() => {
    const map = new Map<number, VendorOption>();
    (vendors || []).forEach((vendor) => map.set(vendor.id, vendor));
    return map;
  }, [vendors]);

  const assessmentsById = useMemo(() => {
    const map = new Map<number, AssessmentOption>();
    (assessments || []).forEach((assessment) => map.set(assessment.id, assessment));
    return map;
  }, [assessments]);

  const sendAssessmentOptions = useMemo(() => {
    const vendorId = Number(sendForm.vendor_id);
    if (!vendorId || Number.isNaN(vendorId)) return [];
    return (assessments || []).filter((assessment) => assessment.vendor_id === vendorId);
  }, [assessments, sendForm.vendor_id]);

  const buildQuestionnaireLink = (token: string) =>
    typeof window === 'undefined'
      ? `/vendor-risk/questionnaires/${token}`
      : `${window.location.origin}/vendor-risk/questionnaires/${token}`;

  const formatAnswer = (answer: unknown) => {
    if (answer === null || answer === undefined || answer === '') {
      return 'No answer provided';
    }
    if (typeof answer === 'string' || typeof answer === 'number' || typeof answer === 'boolean') {
      return String(answer);
    }
    if (typeof answer === 'object' && answer !== null && 'answer' in (answer as Record<string, unknown>)) {
      const nested = (answer as Record<string, unknown>).answer;
      if (nested === null || nested === undefined || nested === '') return 'No answer provided';
      return typeof nested === 'object' ? JSON.stringify(nested) : String(nested);
    }
    return JSON.stringify(answer);
  };

  const selectedResponseTemplate = selectedResponse?.template_id
    ? templatesById.get(selectedResponse.template_id)
    : undefined;

  // Items for dropdowns
  const categoryItems = CATEGORIES.map((c) => ({
    value: c,
    label: c.charAt(0).toUpperCase() + c.slice(1),
  }));

  const questionTypeItems = [
    { value: 'text', label: 'Text Answer' },
    { value: 'yes_no', label: 'Yes / No' },
    { value: 'multiple_choice', label: 'Multiple Choice' },
    { value: 'rating', label: 'Rating (1-5)' },
  ];

  const weightItems = [1, 2, 3, 4, 5].map((w) => ({ value: String(w), label: String(w) }));

  const vendorItems = (vendors ?? []).map((v) => ({
    value: String(v.id),
    label: v.name,
    subLabel: v.primary_contact_email || undefined,
  }));

  const assessmentItems = sendAssessmentOptions.map((a) => ({
    value: String(a.id),
    label: `#${a.id} - ${formatAssessmentType(a.assessment_type)} (${a.status.replace(/_/g, ' ')})`,
  }));


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Questionnaire Templates</h1>
          <p className="text-sm text-gray-500 mt-1">Create and manage vendor assessment questionnaires with evidence requirements</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/vendor-risk/vendors"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Vendors
          </Link>
          <Link
            href="/vendor-risk/assessments"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Assessments
          </Link>
          {canCreate && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Create Template
            </button>
          )}
        </div>
      </div>

      {/* Filter / Search row */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="flex-1 min-w-[180px] sm:min-w-[260px] max-w-md">
              <SearchInput
                value={searchTerm}
                onChange={setSearchTerm}
                placeholder="Search templates..."
              />
            </div>
          </div>
        </div>
      </div>

      {/* Template Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-full bg-white rounded-xl border border-gray-200 p-8 text-center">
            <ClipboardList className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500 mb-2">No templates found. Create your first questionnaire template.</p>
            <p className="text-xs text-gray-400">Use pre-built question sets for Security, Privacy, Compliance and more.</p>
          </div>
        ) : (
          filtered.map((template) => {
            const Icon = getCategoryIcon(template.category);
            const evidenceCount = (template.questions || []).filter((q: any) => q.evidence_required).length;
            return (
              <div key={template.id} className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 flex flex-col hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3 flex-1">
                    <div className={`p-2 rounded-lg ${getCategoryBadge(template.category).replace('text-', 'bg-').split(' ')[0]}`}>
                      <Icon className="h-4 w-4 text-gray-700" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-slate-900 truncate">{template.name}</h3>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize mt-1 ${getCategoryBadge(template.category)}`}>
                        {template.category}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowPreviewModal(template)}
                      className="p-1.5 text-gray-400 hover:text-blue-600 rounded"
                      title="Preview questions"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    {canDelete && (
                      <button
                        onClick={() => {
                          if (confirm('Delete this template?')) deleteMutation.mutate(template.id);
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                {template.description && (
                  <p className="text-xs text-gray-500 mb-3 line-clamp-2">{template.description}</p>
                )}

                {/* Stats */}
                <div className="flex items-center gap-3 text-xs text-gray-400 mb-4">
                  <span className="flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {template.questions?.length ?? 0} questions
                  </span>
                  {evidenceCount > 0 && (
                    <span className="flex items-center gap-1 text-orange-500">
                      <Paperclip className="h-3 w-3" />
                      {evidenceCount} evidence required
                    </span>
                  )}
                </div>

                {/* Preview first 3 questions */}
                <div className="mb-4 space-y-1">
                  {(template.questions || []).slice(0, 3).map((q: any, i: number) => (
                    <p key={i} className="text-xs text-gray-500 truncate">
                      <span className="text-gray-400 font-mono mr-1">{i + 1}.</span>
                      {q.text}
                    </p>
                  ))}
                  {(template.questions?.length || 0) > 3 && (
                    <p className="text-xs text-gray-400">+{template.questions.length - 3} more questions...</p>
                  )}
                </div>

                <div className="mt-auto">
                  <button
                    onClick={() => {
                      setSelectedTemplateId(template.id);
                      setSendSuccess(null);
                      setSendForm({ vendor_id: '', assessment_id: '', respondent_email: '', respondent_name: '' });
                      setShowSendModal(true);
                    }}
                    className="w-full px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 flex items-center justify-center gap-2"
                  >
                    <Send className="h-4 w-4" />
                    Send to Vendor
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Sent Questionnaire Tracking */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-3 sm:px-4 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-slate-900">Sent Questionnaires</h2>
          <p className="text-xs text-gray-500 mt-1">
            Track sent links, response status, and review questions/answers for each vendor submission.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Template</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assessment</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Questions</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Submitted</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {(questionnaireResponses || []).length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                    No sent questionnaires yet.
                  </td>
                </tr>
              ) : (
                (questionnaireResponses || [])
                  .slice()
                  .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
                  .map((response) => {
                    const template = response.template_id ? templatesById.get(response.template_id) : undefined;
                    const vendor = vendorsById.get(response.vendor_id);
                    const assessment = response.assessment_id ? assessmentsById.get(response.assessment_id) : undefined;
                    const answeredCount = Object.keys(response.responses || {}).length;
                    const questionCount = template?.questions?.length || answeredCount;
                    const responseLink = buildQuestionnaireLink(response.token);

                    return (
                      <tr key={response.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-500 font-mono">#{response.id}</td>
                        <td className="px-4 py-3 text-sm text-gray-800">
                          {vendor ? (
                            <Link href={`/vendor-risk/vendors/${vendor.id}`} className="text-blue-600 hover:text-blue-800">
                              {vendor.name}
                            </Link>
                          ) : (
                            `Vendor #${response.vendor_id}`
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {template?.name || (response.template_id ? `Template #${response.template_id}` : 'No template')}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {assessment ? (
                            <Link href={`/vendor-risk/assessments/${assessment.id}`} className="text-blue-600 hover:text-blue-800">
                              #{assessment.id} {formatAssessmentType(assessment.assessment_type)}
                            </Link>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${getResponseStatusPill(response.status)}`}>
                            {response.status?.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {questionCount > 0 ? `${answeredCount}/${questionCount}` : `${answeredCount}`}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {response.submitted_at ? new Date(response.submitted_at).toLocaleString() : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setSelectedResponse(response)}
                              className="p-1.5 text-gray-500 hover:text-blue-700 rounded"
                              title="View questions and answers"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => navigator.clipboard.writeText(responseLink)}
                              className="p-1.5 text-gray-500 hover:text-gray-700 rounded"
                              title="Copy response link"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                            <a
                              href={responseLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 text-gray-500 hover:text-blue-700 rounded"
                              title="Open response link"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Response Detail Slide Panel */}
      <RightSlidePanel
        isOpen={!!selectedResponse}
        onClose={() => setSelectedResponse(null)}
        title={selectedResponse ? `Questionnaire Response #${selectedResponse.id}` : ''}
        subtitle={selectedResponseTemplate?.name || 'Template unavailable'}
        width="w-full max-w-3xl"
      >
        {selectedResponse && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                <p className="text-xs text-gray-500">Vendor</p>
                <p className="text-sm font-medium text-slate-900 mt-1">
                  {vendorsById.get(selectedResponse.vendor_id)?.name || `Vendor #${selectedResponse.vendor_id}`}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                <p className="text-xs text-gray-500">Respondent</p>
                <p className="text-sm font-medium text-slate-900 mt-1">
                  {selectedResponse.respondent_name || selectedResponse.respondent_email || 'Not provided'}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                <p className="text-xs text-gray-500">Status</p>
                <span className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${getResponseStatusPill(selectedResponse.status)}`}>
                  {selectedResponse.status?.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                <p className="text-xs text-gray-500">Submitted</p>
                <p className="text-sm font-medium text-slate-900 mt-1">
                  {selectedResponse.submitted_at ? new Date(selectedResponse.submitted_at).toLocaleString() : '-'}
                </p>
              </div>
            </div>

            {selectedResponseTemplate?.questions?.length ? (
              <div className="space-y-3">
                {selectedResponseTemplate.questions.map((question, index) => {
                  const answer = (selectedResponse.responses || {})[String(question.id)];
                  return (
                    <div key={`${question.id}-${index}`} className="rounded-lg border border-gray-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-slate-900 flex-1">
                          <span className="text-gray-400 font-mono mr-2">Q{index + 1}.</span>
                          {question.text}
                        </p>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">
                          {question.type.replace(/_/g, '/')}
                        </span>
                      </div>
                      <div className="mt-2 rounded bg-gray-50 border border-gray-200 p-2 text-sm text-gray-800">
                        {formatAnswer(answer)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-sm font-medium text-gray-700 mb-2">Raw Responses</p>
                {Object.keys(selectedResponse.responses || {}).length === 0 ? (
                  <p className="text-sm text-gray-400">No responses submitted yet.</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(selectedResponse.responses || {}).map(([questionId, answer]) => (
                      <div key={questionId} className="text-sm text-gray-800 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                        <p className="text-xs text-gray-500 mb-1">{questionId}</p>
                        <p>{formatAnswer(answer)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </RightSlidePanel>

      {/* Create Template Slide Panel */}
      <RightSlidePanel
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Questionnaire Template"
        width="w-full max-w-4xl"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-template-form"
              disabled={createMutation.isPending}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Create Template'
              )}
            </button>
          </div>
        }
      >
        <form id="create-template-form" onSubmit={handleCreateSubmit} className="space-y-4">
          {/* Name + Category */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className={labelClass}>Template Name *</label>
              <input
                type="text"
                required
                value={templateForm.name}
                onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                className={inputClass}
                placeholder="e.g., Annual Security Assessment"
              />
            </div>
            <div>
              <label className={labelClass}>Category</label>
              <MultiSelectDropdown
                title="Category"
                items={categoryItems}
                selectedValues={[templateForm.category]}
                onApply={(values) =>
                  setTemplateForm({ ...templateForm, category: values[0] || 'security' })
                }
                multiSelect={false}
                triggerVariant="input"
                size="md"
                placeholder="Select category"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className={labelClass}>Description</label>
            <textarea
              value={templateForm.description}
              onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
              className={inputClass}
              rows={2}
              placeholder="Brief description of this questionnaire's purpose..."
            />
          </div>

          {/* Questions Builder */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-800">
                Questions ({templateForm.questions.filter((q) => q.text.trim()).length})
              </label>
              <div className="flex items-center gap-2">
                {DEFAULT_QUESTIONS[templateForm.category] && (
                  <button
                    type="button"
                    onClick={() => loadDefaultQuestions(templateForm.category)}
                    className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1 px-2 py-1 bg-purple-50 rounded-lg"
                  >
                    <Sparkles className="h-3 w-3" />
                    Load {templateForm.category.charAt(0).toUpperCase() + templateForm.category.slice(1)} Defaults
                  </button>
                )}
                <button
                  type="button"
                  onClick={addQuestion}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 px-2 py-1 bg-blue-50 rounded-lg"
                >
                  <Plus className="h-3 w-3" /> Add Question
                </button>
              </div>
            </div>
            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {templateForm.questions.map((q, idx) => (
                <div key={q.id} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                  {/* Row 1: Question text + type */}
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-gray-400 font-mono mt-2 shrink-0 w-6">Q{idx + 1}</span>
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        placeholder="Enter your question..."
                        value={q.text}
                        onChange={(e) => updateQuestion(idx, 'text', e.target.value)}
                        className={inputClass}
                      />
                      {/* Row 2: Controls */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="min-w-[160px]">
                          <MultiSelectDropdown
                            title="Type"
                            items={questionTypeItems}
                            selectedValues={[q.type]}
                            onApply={(values) => updateQuestion(idx, 'type', values[0] || 'text')}
                            multiSelect={false}
                            triggerVariant="input"
                            size="md"
                            placeholder="Type"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-gray-500">Weight:</label>
                          <div className="w-20">
                            <MultiSelectDropdown
                              title="Weight"
                              items={weightItems}
                              selectedValues={[String(q.weight)]}
                              onApply={(values) => updateQuestion(idx, 'weight', Number(values[0] || 3))}
                              multiSelect={false}
                              triggerVariant="input"
                              size="md"
                              placeholder="Weight"
                            />
                          </div>
                        </div>
                        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={q.required}
                            onChange={(e) => updateQuestion(idx, 'required', e.target.checked)}
                            className="rounded border-gray-300 text-blue-600"
                          />
                          Required
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-orange-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={q.evidence_required}
                            onChange={(e) => updateQuestion(idx, 'evidence_required', e.target.checked)}
                            className="rounded border-orange-300 text-orange-600"
                          />
                          <Paperclip className="h-3 w-3" />
                          Evidence Required
                        </label>
                      </div>

                      {/* Options for multiple choice */}
                      {q.type === 'multiple_choice' && (
                        <div className="pl-2 space-y-1">
                          <p className="text-xs text-gray-400">Options:</p>
                          {(q.options || []).map((opt, optIdx) => (
                            <div key={optIdx} className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full border-2 border-gray-300 shrink-0" />
                              <input
                                type="text"
                                value={opt}
                                onChange={(e) => updateOption(idx, optIdx, e.target.value)}
                                placeholder={`Option ${optIdx + 1}`}
                                className="flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                              />
                              <button type="button" onClick={() => removeOption(idx, optIdx)} className="text-gray-400 hover:text-red-500">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => addOption(idx)}
                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 mt-1"
                          >
                            <Plus className="h-3 w-3" /> Add Option
                          </button>
                        </div>
                      )}
                    </div>
                    {templateForm.questions.length > 1 && (
                      <button type="button" onClick={() => removeQuestion(idx)} className="text-gray-400 hover:text-red-600 mt-2 shrink-0">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </form>
      </RightSlidePanel>

      {/* Preview Slide Panel */}
      <RightSlidePanel
        isOpen={!!showPreviewModal}
        onClose={() => setShowPreviewModal(null)}
        title={showPreviewModal?.name || ''}
        subtitle={showPreviewModal?.category ? showPreviewModal.category.charAt(0).toUpperCase() + showPreviewModal.category.slice(1) : undefined}
        width="w-full max-w-3xl"
      >
        {showPreviewModal && (
          <div className="space-y-4">
            {showPreviewModal.description && (
              <p className="text-sm text-gray-500">{showPreviewModal.description}</p>
            )}
            <div className="space-y-3">
              {(showPreviewModal.questions || []).map((q: any, idx: number) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-mono text-gray-400 mt-0.5">{idx + 1}.</span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-800">{q.text}</p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full capitalize">
                          {q.type?.replace('_', '/')}
                        </span>
                        <span className="text-xs text-gray-400">Weight: {q.weight || 3}/5</span>
                        {q.required && <span className="text-xs text-blue-600">Required</span>}
                        {q.evidence_required && (
                          <span className="text-xs text-orange-600 flex items-center gap-1">
                            <Paperclip className="h-3 w-3" /> Evidence Required
                          </span>
                        )}
                      </div>
                      {q.type === 'multiple_choice' && q.options?.length > 0 && (
                        <div className="mt-2 pl-2 space-y-1">
                          {q.options.map((opt: string, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                              <div className="w-3 h-3 rounded-full border-2 border-gray-300" />
                              {opt}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </RightSlidePanel>

      {/* Send Questionnaire Slide Panel */}
      <RightSlidePanel
        isOpen={showSendModal}
        onClose={() => {
          setShowSendModal(false);
          setSendSuccess(null);
          setSendForm({ vendor_id: '', assessment_id: '', respondent_email: '', respondent_name: '' });
        }}
        title="Send Questionnaire"
        width="w-full max-w-3xl"
        footer={
          sendSuccess ? (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowSendModal(false);
                  setSendSuccess(null);
                  setSendForm({ vendor_id: '', assessment_id: '', respondent_email: '', respondent_name: '' });
                }}
                className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
              >
                Done
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowSendModal(false);
                  setSendSuccess(null);
                  setSendForm({ vendor_id: '', assessment_id: '', respondent_email: '', respondent_name: '' });
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="send-questionnaire-form"
                disabled={sendMutation.isPending}
                className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {sendMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Send Questionnaire
                  </>
                )}
              </button>
            </div>
          )
        }
      >
        {sendSuccess ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <FileCheck className="h-8 w-8 text-green-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-green-800">Questionnaire sent successfully!</p>
              <p className="text-xs text-green-600 mt-1">Share the link below with the vendor to fill out the questionnaire.</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <label className="block text-xs text-gray-500 mb-1">Vendor Response Link</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={buildQuestionnaireLink(sendSuccess.token)}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(buildQuestionnaireLink(sendSuccess.token))}
                  className="cw-btn-primary inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm"
                >
                  <Copy className="h-4 w-4" /> Copy
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form id="send-questionnaire-form" onSubmit={handleSendSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass}>Vendor *</label>
                <MultiSelectDropdown
                  title="Vendor"
                  items={vendorItems}
                  selectedValues={sendForm.vendor_id ? [sendForm.vendor_id] : []}
                  onApply={(values) => {
                    const vendorId = values[0] || '';
                    const v = (vendors ?? []).find((x) => String(x.id) === vendorId);
                    const vendorAssessments = (assessments || []).filter(
                      (item) => String(item.vendor_id) === vendorId
                    );
                    setSendForm({
                      ...sendForm,
                      vendor_id: vendorId,
                      assessment_id: vendorAssessments[0] ? String(vendorAssessments[0].id) : '',
                      respondent_email: v?.primary_contact_email || sendForm.respondent_email,
                      respondent_name: v?.primary_contact_name || sendForm.respondent_name,
                    });
                  }}
                  multiSelect={false}
                  triggerVariant="input"
                  size="md"
                  placeholder="Select vendor..."
                  forceSearch
                />
                {/* Hidden required input to keep native form validation */}
                <input
                  type="text"
                  required
                  value={sendForm.vendor_id}
                  onChange={() => {}}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                />
              </div>
              <div>
                <label className={labelClass}>Link to Assessment (optional)</label>
                <MultiSelectDropdown
                  title="Assessment"
                  items={assessmentItems}
                  selectedValues={sendForm.assessment_id ? [sendForm.assessment_id] : []}
                  onApply={(values) =>
                    setSendForm({ ...sendForm, assessment_id: values[0] || '' })
                  }
                  multiSelect={false}
                  triggerVariant="input"
                  size="md"
                  placeholder={sendForm.vendor_id ? 'No linked assessment' : 'Select vendor first'}
                />
              </div>
              <div>
                <label className={labelClass}>Respondent Name</label>
                <input
                  type="text"
                  value={sendForm.respondent_name}
                  onChange={(e) => setSendForm({ ...sendForm, respondent_name: e.target.value })}
                  className={inputClass}
                  placeholder="Vendor contact name"
                />
              </div>
              <div>
                <label className={labelClass}>Respondent Email</label>
                <input
                  type="email"
                  value={sendForm.respondent_email}
                  onChange={(e) => setSendForm({ ...sendForm, respondent_email: e.target.value })}
                  className={inputClass}
                  placeholder="vendor-contact@example.com"
                />
              </div>
              {sendMutation.isError && (
                <div className="text-xs text-red-600 bg-red-50 p-2 rounded-lg md:col-span-2">
                  {(sendMutation.error as any)?.response?.data?.detail || 'Failed to send questionnaire'}
                </div>
              )}
            </div>
          </form>
        )}
      </RightSlidePanel>
    </div>
  );
}
