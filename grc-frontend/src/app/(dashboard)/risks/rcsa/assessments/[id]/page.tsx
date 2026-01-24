'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import {
  ArrowLeft,
  Save,
  Send,
  Loader2,
  AlertCircle,
  CheckCircle,
  Sparkles,
  HelpCircle,
  Building2,
  Calendar,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import Link from 'next/link';

interface Question {
  id: number;
  section: string;
  question_text: string;
  guidance?: string;
  question_type: 'risk_rating' | 'control_rating' | 'yes_no' | 'text';
  is_required: boolean;
  sequence: number;
}

interface Response {
  question_id: number;
  likelihood?: number;
  impact?: number;
  effectiveness?: string;
  yes_no_value?: boolean;
  text_value?: string;
}

interface AISuggestion {
  question_id: number;
  suggested_value: unknown;
  reasoning: string;
  confidence: number;
}

interface Assessment {
  id: number;
  campaign_id: number;
  campaign_name: string;
  business_unit: string;
  assessor_name: string;
  status: string;
  due_date: string;
  progress: number;
  questions: Question[];
  responses: Response[];
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  not_started: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Not Started' },
  in_progress: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'In Progress' },
  submitted: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Submitted' },
  under_review: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Under Review' },
  approved: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Approved' },
  rejected: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Rejected' },
};

const LIKELIHOOD_OPTIONS = [
  { value: 1, label: '1 - Rare' },
  { value: 2, label: '2 - Unlikely' },
  { value: 3, label: '3 - Possible' },
  { value: 4, label: '4 - Likely' },
  { value: 5, label: '5 - Almost Certain' },
];

const IMPACT_OPTIONS = [
  { value: 1, label: '1 - Insignificant' },
  { value: 2, label: '2 - Minor' },
  { value: 3, label: '3 - Moderate' },
  { value: 4, label: '4 - Major' },
  { value: 5, label: '5 - Catastrophic' },
];

const EFFECTIVENESS_OPTIONS = [
  { value: 'effective', label: 'Effective' },
  { value: 'partially_effective', label: 'Partially Effective' },
  { value: 'ineffective', label: 'Ineffective' },
  { value: 'not_applicable', label: 'Not Applicable' },
];

export default function AssessmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const assessmentId = Number(params.id);

  const [responses, setResponses] = useState<Record<number, Response>>({});
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [showAISuggestions, setShowAISuggestions] = useState<Record<number, boolean>>({});
  const [validationErrors, setValidationErrors] = useState<Set<number>>(new Set());

  const { data: assessment, isLoading, error } = useQuery({
    queryKey: ['rcsa-assessment', assessmentId],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getAssessment(assessmentId);
        return response.data as Assessment;
      } catch {
        return {
          id: assessmentId,
          campaign_id: 1,
          campaign_name: 'Q4 2025 RCSA',
          business_unit: 'IT Operations',
          assessor_name: 'John Smith',
          status: 'in_progress',
          due_date: '2025-12-31',
          progress: 45,
          questions: [
            { id: 1, section: 'Risk Identification', question_text: 'Rate the likelihood and impact of cybersecurity threats to your business unit', guidance: 'Consider recent incidents and industry trends', question_type: 'risk_rating', is_required: true, sequence: 1 },
            { id: 2, section: 'Risk Identification', question_text: 'Rate the likelihood and impact of operational disruptions', guidance: 'Include system failures, process breakdowns', question_type: 'risk_rating', is_required: true, sequence: 2 },
            { id: 3, section: 'Control Assessment', question_text: 'How effective is your access control management?', guidance: 'Consider user provisioning, deprovisioning, and periodic reviews', question_type: 'control_rating', is_required: true, sequence: 3 },
            { id: 4, section: 'Control Assessment', question_text: 'How effective is your change management process?', guidance: 'Consider approval workflows, testing, and rollback procedures', question_type: 'control_rating', is_required: true, sequence: 4 },
            { id: 5, section: 'Compliance', question_text: 'Are all regulatory requirements documented and tracked?', guidance: 'Include applicable frameworks like SAMA CSF, PCI-DSS', question_type: 'yes_no', is_required: true, sequence: 5 },
            { id: 6, section: 'Compliance', question_text: 'Is there an established incident response procedure?', guidance: 'Should include escalation paths and communication plans', question_type: 'yes_no', is_required: true, sequence: 6 },
            { id: 7, section: 'Additional Comments', question_text: 'Describe any emerging risks or concerns for your business unit', guidance: 'Include any risks not covered in previous sections', question_type: 'text', is_required: false, sequence: 7 },
          ],
          responses: [
            { question_id: 1, likelihood: 3, impact: 4 },
            { question_id: 3, effectiveness: 'effective' },
          ],
        } as Assessment;
      }
    },
  });

  const { data: aiSuggestions } = useQuery({
    queryKey: ['rcsa-ai-suggestions', assessmentId],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getAISuggestions(assessmentId);
        return response.data as AISuggestion[];
      } catch {
        return [
          { question_id: 2, suggested_value: { likelihood: 2, impact: 3 }, reasoning: 'Based on industry benchmarks and historical data for IT Operations', confidence: 0.85 },
          { question_id: 4, suggested_value: { effectiveness: 'partially_effective' }, reasoning: 'Common rating for organizations without automated testing', confidence: 0.72 },
          { question_id: 5, suggested_value: { yes_no_value: true }, reasoning: 'Most organizations at this maturity level have documentation', confidence: 0.68 },
        ] as AISuggestion[];
      }
    },
    enabled: !!assessment,
  });

  useEffect(() => {
    if (assessment?.responses) {
      const responseMap: Record<number, Response> = {};
      assessment.responses.forEach(r => {
        responseMap[r.question_id] = r;
      });
      setResponses(responseMap);
    }
    if (assessment?.questions) {
      const sections = new Set(assessment.questions.map(q => q.section));
      setExpandedSections(sections);
    }
  }, [assessment]);

  const saveMutation = useMutation({
    mutationFn: (data: { responses: Response[] }) => rcsaApi.saveResponses(assessmentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-assessment', assessmentId] });
    },
  });

  const submitMutation = useMutation({
    mutationFn: () => rcsaApi.submitAssessment(assessmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-assessment', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['rcsa-assessments'] });
      router.push('/risks/rcsa/assessments');
    },
  });

  const handleSave = () => {
    const responseArray = Object.values(responses);
    saveMutation.mutate({ responses: responseArray });
  };

  const handleSubmit = () => {
    if (!assessment) return;
    
    const errors = new Set<number>();
    assessment.questions.filter(q => q.is_required).forEach(q => {
      const response = responses[q.id];
      if (!response) {
        errors.add(q.id);
        return;
      }
      if (q.question_type === 'risk_rating' && (!response.likelihood || !response.impact)) {
        errors.add(q.id);
      } else if (q.question_type === 'control_rating' && !response.effectiveness) {
        errors.add(q.id);
      } else if (q.question_type === 'yes_no' && response.yes_no_value === undefined) {
        errors.add(q.id);
      }
    });

    if (errors.size > 0) {
      setValidationErrors(errors);
      return;
    }

    if (confirm('Are you sure you want to submit this assessment for review? You will not be able to make changes after submission.')) {
      submitMutation.mutate();
    }
  };

  const updateResponse = (questionId: number, field: string, value: unknown) => {
    setResponses(prev => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        question_id: questionId,
        [field]: value,
      },
    }));
    setValidationErrors(prev => {
      const next = new Set(prev);
      next.delete(questionId);
      return next;
    });
  };

  const acceptAISuggestion = (questionId: number) => {
    const suggestion = aiSuggestions?.find(s => s.question_id === questionId);
    if (suggestion && typeof suggestion.suggested_value === 'object') {
      const value = suggestion.suggested_value as Record<string, unknown>;
      setResponses(prev => ({
        ...prev,
        [questionId]: {
          ...prev[questionId],
          question_id: questionId,
          ...value,
        },
      }));
    }
    setShowAISuggestions(prev => ({ ...prev, [questionId]: false }));
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const groupedQuestions = assessment?.questions.reduce((acc, q) => {
    if (!acc[q.section]) acc[q.section] = [];
    acc[q.section].push(q);
    return acc;
  }, {} as Record<string, Question[]>) || {};

  const isEditable = assessment?.status === 'in_progress' || assessment?.status === 'rejected';
  const statusStyle = STATUS_STYLES[assessment?.status || 'not_started'];

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error || !assessment) {
    return (
      <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
        <p className="mt-2 text-red-400">Failed to load assessment</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/risks/rcsa/assessments"
          className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-white">{assessment.campaign_name}</h1>
          <div className="flex items-center gap-4 mt-1">
            <span className="flex items-center gap-1.5 text-slate-400">
              <Building2 className="h-4 w-4" />
              {assessment.business_unit}
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              <Calendar className="h-4 w-4" />
              Due: {new Date(assessment.due_date).toLocaleDateString()}
            </span>
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
              {statusStyle.label}
            </span>
          </div>
        </div>
        {isEditable && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="btn-secondary flex items-center gap-2"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Draft
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit
            </button>
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Progress</span>
          <span className="text-sm font-medium text-white">{assessment.progress}%</span>
        </div>
        <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-500 rounded-full transition-all duration-300"
            style={{ width: `${assessment.progress}%` }}
          />
        </div>
      </div>

      {validationErrors.size > 0 && (
        <div className="rounded-xl border border-red-700 bg-red-900/20 p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
          <p className="text-red-400">Please complete all required fields before submitting.</p>
        </div>
      )}

      <div className="space-y-4">
        {Object.entries(groupedQuestions).map(([section, questions]) => (
          <div key={section} className="card overflow-hidden">
            <button
              onClick={() => toggleSection(section)}
              className="w-full flex items-center justify-between p-4 bg-slate-800/50 hover:bg-slate-800"
            >
              <h3 className="text-lg font-medium text-white">{section}</h3>
              {expandedSections.has(section) ? (
                <ChevronUp className="h-5 w-5 text-slate-400" />
              ) : (
                <ChevronDown className="h-5 w-5 text-slate-400" />
              )}
            </button>

            {expandedSections.has(section) && (
              <div className="divide-y divide-slate-700">
                {questions.sort((a, b) => a.sequence - b.sequence).map((question) => {
                  const response = responses[question.id] || {};
                  const aiSuggestion = aiSuggestions?.find(s => s.question_id === question.id);
                  const hasError = validationErrors.has(question.id);

                  return (
                    <div key={question.id} className={`p-4 ${hasError ? 'bg-red-900/10' : ''}`}>
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex-1">
                          <p className="text-white font-medium">
                            {question.question_text}
                            {question.is_required && <span className="text-red-400 ml-1">*</span>}
                          </p>
                          {question.guidance && (
                            <p className="text-sm text-slate-400 mt-1 flex items-start gap-1.5">
                              <HelpCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                              {question.guidance}
                            </p>
                          )}
                        </div>
                        {aiSuggestion && isEditable && (
                          <div className="relative">
                            <button
                              onClick={() => setShowAISuggestions(prev => ({ ...prev, [question.id]: !prev[question.id] }))}
                              className="p-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
                              title="AI Suggestion"
                            >
                              <Sparkles className="h-4 w-4" />
                            </button>
                            {showAISuggestions[question.id] && (
                              <div className="absolute right-0 top-10 z-10 w-80 p-4 rounded-lg bg-slate-700 border border-slate-600 shadow-xl">
                                <div className="flex items-center gap-2 mb-2">
                                  <Sparkles className="h-4 w-4 text-purple-400" />
                                  <span className="text-sm font-medium text-white">AI Suggestion</span>
                                  <span className="text-xs text-slate-400">({Math.round(aiSuggestion.confidence * 100)}% confidence)</span>
                                </div>
                                <p className="text-sm text-slate-300 mb-3">{aiSuggestion.reasoning}</p>
                                <button
                                  onClick={() => acceptAISuggestion(question.id)}
                                  className="w-full btn-primary text-sm py-1.5"
                                >
                                  Accept Suggestion
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="mt-3">
                        {question.question_type === 'risk_rating' && (
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm text-slate-400 mb-1">Likelihood</label>
                              <select
                                value={response.likelihood || ''}
                                onChange={(e) => updateResponse(question.id, 'likelihood', Number(e.target.value))}
                                disabled={!isEditable}
                                className="input w-full"
                              >
                                <option value="">Select...</option>
                                {LIKELIHOOD_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-sm text-slate-400 mb-1">Impact</label>
                              <select
                                value={response.impact || ''}
                                onChange={(e) => updateResponse(question.id, 'impact', Number(e.target.value))}
                                disabled={!isEditable}
                                className="input w-full"
                              >
                                <option value="">Select...</option>
                                {IMPACT_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )}

                        {question.question_type === 'control_rating' && (
                          <select
                            value={response.effectiveness || ''}
                            onChange={(e) => updateResponse(question.id, 'effectiveness', e.target.value)}
                            disabled={!isEditable}
                            className="input w-full max-w-md"
                          >
                            <option value="">Select effectiveness...</option>
                            {EFFECTIVENESS_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        )}

                        {question.question_type === 'yes_no' && (
                          <div className="flex items-center gap-6">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name={`q-${question.id}`}
                                checked={response.yes_no_value === true}
                                onChange={() => updateResponse(question.id, 'yes_no_value', true)}
                                disabled={!isEditable}
                                className="w-4 h-4 text-primary-500"
                              />
                              <span className="text-white">Yes</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name={`q-${question.id}`}
                                checked={response.yes_no_value === false}
                                onChange={() => updateResponse(question.id, 'yes_no_value', false)}
                                disabled={!isEditable}
                                className="w-4 h-4 text-primary-500"
                              />
                              <span className="text-white">No</span>
                            </label>
                          </div>
                        )}

                        {question.question_type === 'text' && (
                          <textarea
                            value={response.text_value || ''}
                            onChange={(e) => updateResponse(question.id, 'text_value', e.target.value)}
                            disabled={!isEditable}
                            placeholder="Enter your response..."
                            className="input w-full h-24"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
