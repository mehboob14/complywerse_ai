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
  XCircle,
  Sparkles,
  HelpCircle,
  Building2,
  Calendar,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Upload,
  FileText,
  Trash2,
  Lightbulb,
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
  question_order?: number;
  ai_suggestion_enabled?: boolean;
  risk_category?: string;
  control_objective?: string;
}

interface Response {
  question_id: number;
  likelihood?: number;
  impact?: number;
  effectiveness?: string;
  yes_no_value?: boolean;
  text_value?: string;
  evidence_files?: EvidenceFile[];
  evidence?: EvidenceFile[];
}

interface EvidenceFile {
  id: number;
  filename: string;
  file_size: number;
  uploaded_at: string;
}

interface EvidenceRecommendation {
  evidence_type: string;
  description: string;
  example_files: string[];
}

interface AISuggestion {
  question_id: number;
  suggested_value: unknown;
  suggestion: string;
  reasoning: string;
  confidence: number;
  evidence_recommendations?: EvidenceRecommendation[];
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
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'list' | 'step'>('list');
  const [uploadingQuestion, setUploadingQuestion] = useState<number | null>(null);
  const [evidenceFiles, setEvidenceFiles] = useState<Record<number, EvidenceFile[]>>({});
  const [reviewComments, setReviewComments] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);

  const { data: assessment, isLoading, error } = useQuery({
    queryKey: ['rcsa-assessment', assessmentId],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getAssessment(assessmentId);
        return response.data as Assessment;
      } catch {
        throw new Error('Failed to load assessment');
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
        return [] as AISuggestion[];
      }
    },
    enabled: !!assessment,
  });

  useEffect(() => {
    if (assessment?.responses) {
      const responseMap: Record<number, Response> = {};
      const evidenceMap: Record<number, EvidenceFile[]> = {};
      assessment.responses.forEach(r => {
        responseMap[r.question_id] = r;
        if (r.evidence && r.evidence.length > 0) {
          evidenceMap[r.question_id] = r.evidence;
        }
      });
      setResponses(responseMap);
      setEvidenceFiles(evidenceMap);
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

  const approveMutation = useMutation({
    mutationFn: (comments: string) => rcsaApi.approveAssessment(assessmentId, { comments }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-assessment', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['rcsa-assessments'] });
      queryClient.invalidateQueries({ queryKey: ['rcsa-pending-reviews'] });
      router.push('/risks/rcsa');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (comments: string) => rcsaApi.rejectAssessment(assessmentId, { comments, reason: comments }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-assessment', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['rcsa-assessments'] });
      queryClient.invalidateQueries({ queryKey: ['rcsa-pending-reviews'] });
      router.push('/risks/rcsa');
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

  const sortedQuestions = assessment?.questions
    ? [...assessment.questions].sort((a, b) => (a.question_order || a.sequence || 0) - (b.question_order || b.sequence || 0))
    : [];

  const groupedQuestions = sortedQuestions.reduce((acc, q) => {
    if (!acc[q.section]) acc[q.section] = [];
    acc[q.section].push(q);
    return acc;
  }, {} as Record<string, Question[]>);

  const currentQuestion = sortedQuestions[currentQuestionIndex];
  const totalQuestions = sortedQuestions.length;
  const answeredCount = Object.keys(responses).filter(qId => {
    const q = sortedQuestions.find(sq => sq.id === Number(qId));
    if (!q) return false;
    const r = responses[Number(qId)];
    if (q.question_type === 'risk_rating') return r.likelihood && r.impact;
    if (q.question_type === 'control_rating') return !!r.effectiveness;
    if (q.question_type === 'yes_no') return r.yes_no_value !== undefined;
    if (q.question_type === 'text') return !!r.text_value;
    return false;
  }).length;

  const goToNextQuestion = () => {
    if (currentQuestionIndex < totalQuestions - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      handleSave();
    }
  };

  const goToPrevQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  const handleFileUpload = async (questionId: number, files: FileList) => {
    if (!files.length) return;
    setUploadingQuestion(questionId);
    
    try {
      const formData = new FormData();
      formData.append('file', files[0]);
      formData.append('assessment_id', assessmentId.toString());
      formData.append('question_id', questionId.toString());
      
      const response = await fetch('/api/erm/rcsa/evidence/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      
      if (response.ok) {
        const data = await response.json();
        setEvidenceFiles(prev => ({
          ...prev,
          [questionId]: [...(prev[questionId] || []), data],
        }));
      }
    } catch (err) {
      console.error('Error uploading file:', err);
    } finally {
      setUploadingQuestion(null);
    }
  };

  const handleRemoveEvidence = async (questionId: number, fileId: number) => {
    try {
      await fetch(`/api/erm/rcsa/evidence/${fileId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setEvidenceFiles(prev => ({
        ...prev,
        [questionId]: (prev[questionId] || []).filter(f => f.id !== fileId),
      }));
    } catch (err) {
      console.error('Error removing evidence:', err);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isEditable = assessment?.status === 'in_progress' || assessment?.status === 'rejected' || assessment?.status === 'not_started';
  const isReviewMode = assessment?.status === 'submitted' || assessment?.status === 'under_review';
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
        {isReviewMode && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => approveMutation.mutate(reviewComments || 'Approved')}
              disabled={approveMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
            >
              {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Approve
            </button>
            <button
              onClick={() => setShowRejectModal(true)}
              disabled={rejectMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white transition-colors"
            >
              {rejectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Reject
            </button>
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md mx-4 border border-slate-700">
            <h3 className="text-lg font-medium text-white mb-4">Reject Assessment</h3>
            <p className="text-slate-400 text-sm mb-4">Please provide a reason for rejecting this assessment. This will be shared with the assessor.</p>
            <textarea
              value={reviewComments}
              onChange={(e) => setReviewComments(e.target.value)}
              placeholder="Enter rejection reason..."
              className="w-full h-32 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (reviewComments.trim()) {
                    rejectMutation.mutate(reviewComments);
                    setShowRejectModal(false);
                  }
                }}
                disabled={!reviewComments.trim() || rejectMutation.isPending}
                className="px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {rejectMutation.isPending ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400">Progress</span>
            <span className="text-sm font-medium text-white">{answeredCount} of {totalQuestions} questions answered ({Math.round((answeredCount / Math.max(totalQuestions, 1)) * 100)}%)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-xs rounded-lg ${viewMode === 'list' ? 'bg-primary-500 text-white' : 'bg-slate-700 text-slate-400'}`}
            >
              List View
            </button>
            <button
              onClick={() => setViewMode('step')}
              className={`px-3 py-1.5 text-xs rounded-lg ${viewMode === 'step' ? 'bg-primary-500 text-white' : 'bg-slate-700 text-slate-400'}`}
            >
              Step View
            </button>
          </div>
        </div>
        <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-500 rounded-full transition-all duration-300"
            style={{ width: `${(answeredCount / Math.max(totalQuestions, 1)) * 100}%` }}
          />
        </div>
        {viewMode === 'step' && totalQuestions > 0 && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-slate-400">Question {currentQuestionIndex + 1} of {totalQuestions}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={goToPrevQuestion}
                disabled={currentQuestionIndex === 0}
                className="p-1.5 rounded-lg bg-slate-700 text-slate-400 hover:text-white disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={goToNextQuestion}
                disabled={currentQuestionIndex === totalQuestions - 1}
                className="p-1.5 rounded-lg bg-slate-700 text-slate-400 hover:text-white disabled:opacity-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {validationErrors.size > 0 && (
        <div className="rounded-xl border border-red-700 bg-red-900/20 p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
          <p className="text-red-400">Please complete all required fields before submitting.</p>
        </div>
      )}

      {/* Step View Mode */}
      {viewMode === 'step' && currentQuestion && (
        <div className="card p-6">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium px-2 py-1 bg-slate-700 rounded text-slate-300">
                  {currentQuestion.section}
                </span>
                <span className="text-xs text-slate-500">Question {currentQuestionIndex + 1}</span>
              </div>
              <p className="text-xl text-white font-medium">
                {currentQuestion.question_text}
                {currentQuestion.is_required && <span className="text-red-400 ml-1">*</span>}
              </p>
              {currentQuestion.guidance && (
                <p className="text-sm text-slate-400 mt-3 flex items-start gap-1.5 bg-slate-700/30 p-3 rounded-lg">
                  <HelpCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  {currentQuestion.guidance}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-6">
            {currentQuestion.question_type === 'control_rating' && (
              <div className="space-y-4">
                <p className="text-sm text-slate-400">Select Control Effectiveness:</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {EFFECTIVENESS_OPTIONS.map(opt => {
                    const isSelected = (responses[currentQuestion.id] || {}).effectiveness === opt.value;
                    const colorClass = opt.value === 'effective' 
                      ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400' 
                      : opt.value === 'partially_effective'
                      ? 'border-amber-500 bg-amber-500/20 text-amber-400'
                      : opt.value === 'ineffective'
                      ? 'border-rose-500 bg-rose-500/20 text-rose-400'
                      : 'border-slate-500 bg-slate-500/20 text-slate-400';
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => isEditable && updateResponse(currentQuestion.id, 'effectiveness', opt.value)}
                        disabled={!isEditable}
                        className={`p-4 rounded-xl border-2 font-medium transition-all text-center ${
                          isSelected 
                            ? colorClass
                            : 'border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500 hover:bg-slate-700'
                        }`}
                      >
                        <span className="flex flex-col items-center gap-2">
                          {isSelected && <CheckCircle className="h-5 w-5" />}
                          {opt.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {currentQuestion.question_type === 'risk_rating' && (
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm text-slate-400 mb-2">Likelihood</label>
                  <div className="space-y-2">
                    {LIKELIHOOD_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => isEditable && updateResponse(currentQuestion.id, 'likelihood', opt.value)}
                        className={`w-full p-3 rounded-lg text-left border-2 transition-all ${
                          (responses[currentQuestion.id] || {}).likelihood === opt.value
                            ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                            : 'border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-2">Impact</label>
                  <div className="space-y-2">
                    {IMPACT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => isEditable && updateResponse(currentQuestion.id, 'impact', opt.value)}
                        className={`w-full p-3 rounded-lg text-left border-2 transition-all ${
                          (responses[currentQuestion.id] || {}).impact === opt.value
                            ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                            : 'border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {currentQuestion.question_type === 'yes_no' && (
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => isEditable && updateResponse(currentQuestion.id, 'yes_no_value', true)}
                  className={`flex-1 p-4 rounded-xl border-2 font-medium transition-all ${
                    (responses[currentQuestion.id] || {}).yes_no_value === true
                      ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                      : 'border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {(responses[currentQuestion.id] || {}).yes_no_value === true && <CheckCircle className="h-5 w-5 mx-auto mb-2" />}
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => isEditable && updateResponse(currentQuestion.id, 'yes_no_value', false)}
                  className={`flex-1 p-4 rounded-xl border-2 font-medium transition-all ${
                    (responses[currentQuestion.id] || {}).yes_no_value === false
                      ? 'border-rose-500 bg-rose-500/20 text-rose-400'
                      : 'border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {(responses[currentQuestion.id] || {}).yes_no_value === false && <CheckCircle className="h-5 w-5 mx-auto mb-2" />}
                  No
                </button>
              </div>
            )}

            {currentQuestion.question_type === 'text' && (
              <textarea
                value={(responses[currentQuestion.id] || {}).text_value || ''}
                onChange={(e) => updateResponse(currentQuestion.id, 'text_value', e.target.value)}
                disabled={!isEditable}
                placeholder="Enter your response..."
                className="input w-full h-32"
              />
            )}

            {/* Evidence Upload in Step View */}
            <div className="mt-6 pt-6 border-t border-slate-700">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-slate-400 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Supporting Evidence
                </p>
                {isEditable && (
                  <label className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => e.target.files && handleFileUpload(currentQuestion.id, e.target.files)}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                    />
                  </label>
                )}
              </div>
              
              {uploadingQuestion === currentQuestion.id && (
                <div className="flex items-center gap-2 text-sm text-primary-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </div>
              )}
              
              {(evidenceFiles[currentQuestion.id] || []).length > 0 ? (
                <div className="space-y-2">
                  {evidenceFiles[currentQuestion.id].map(file => (
                    <div key={file.id} className="flex items-center justify-between p-2 bg-slate-700/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary-400" />
                        <span className="text-sm text-white">{file.filename}</span>
                        <span className="text-xs text-slate-500">{formatFileSize(file.file_size)}</span>
                      </div>
                      {isEditable && (
                        <button
                          onClick={() => handleRemoveEvidence(currentQuestion.id, file.id)}
                          className="p-1 text-slate-400 hover:text-rose-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 italic">No evidence attached</p>
              )}
            </div>
          </div>

          {/* Step Navigation */}
          <div className="mt-8 pt-6 border-t border-slate-700 flex items-center justify-between">
            <button
              onClick={goToPrevQuestion}
              disabled={currentQuestionIndex === 0}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <div className="flex items-center gap-2">
              {currentQuestionIndex === totalQuestions - 1 ? (
                <button
                  onClick={handleSubmit}
                  disabled={submitMutation.isPending}
                  className="btn-primary flex items-center gap-2"
                >
                  {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Submit Assessment
                </button>
              ) : (
                <button
                  onClick={goToNextQuestion}
                  className="btn-primary flex items-center gap-2"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* List View Mode */}
      {viewMode === 'list' && (
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
                {questions.sort((a, b) => (a.question_order || a.sequence) - (b.question_order || b.sequence)).map((question) => {
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
                              <div className="absolute right-0 top-10 z-10 w-96 p-4 rounded-lg bg-slate-700 border border-slate-600 shadow-xl max-h-80 overflow-y-auto">
                                <div className="flex items-center gap-2 mb-2">
                                  <Sparkles className="h-4 w-4 text-purple-400" />
                                  <span className="text-sm font-medium text-white">AI Suggestion</span>
                                  <span className="text-xs text-slate-400">({Math.round(aiSuggestion.confidence * 100)}% confidence)</span>
                                </div>
                                {aiSuggestion.suggestion && (
                                  <p className="text-sm text-slate-300 mb-2">{aiSuggestion.suggestion}</p>
                                )}
                                {aiSuggestion.evidence_recommendations && aiSuggestion.evidence_recommendations.length > 0 && (
                                  <div className="mb-3">
                                    <p className="text-xs font-medium text-purple-300 mb-2">Recommended Evidence to Upload:</p>
                                    <div className="space-y-2">
                                      {aiSuggestion.evidence_recommendations.map((rec, idx) => (
                                        <div key={idx} className="bg-slate-800 rounded p-2">
                                          <p className="text-sm font-medium text-white">{rec.evidence_type}</p>
                                          <p className="text-xs text-slate-400">{rec.description}</p>
                                          {rec.example_files.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-1">
                                              {rec.example_files.map((f, i) => (
                                                <span key={i} className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">{f}</span>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {!aiSuggestion.suggestion && !aiSuggestion.evidence_recommendations?.length && (
                                  <p className="text-sm text-slate-300 mb-3">{aiSuggestion.reasoning}</p>
                                )}
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
                          <div className="space-y-3">
                            <p className="text-sm text-slate-400">Select Control Effectiveness:</p>
                            <div className="flex flex-wrap gap-2">
                              {EFFECTIVENESS_OPTIONS.map(opt => {
                                const isSelected = response.effectiveness === opt.value;
                                const colorClass = opt.value === 'effective' 
                                  ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400' 
                                  : opt.value === 'partially_effective'
                                  ? 'border-amber-500 bg-amber-500/20 text-amber-400'
                                  : opt.value === 'ineffective'
                                  ? 'border-rose-500 bg-rose-500/20 text-rose-400'
                                  : 'border-slate-500 bg-slate-500/20 text-slate-400';
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => isEditable && updateResponse(question.id, 'effectiveness', opt.value)}
                                    disabled={!isEditable}
                                    className={`px-4 py-2.5 rounded-lg border-2 font-medium transition-all ${
                                      isSelected 
                                        ? colorClass
                                        : 'border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500 hover:bg-slate-700'
                                    } ${!isEditable ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                  >
                                    <span className="flex items-center gap-2">
                                      {isSelected && <CheckCircle className="h-4 w-4" />}
                                      {opt.label}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                            {response.effectiveness && (
                              <p className="text-sm text-emerald-400 flex items-center gap-1.5">
                                <CheckCircle className="h-4 w-4" />
                                Selection saved
                              </p>
                            )}
                          </div>
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

                      {/* Evidence Upload Section */}
                      <div className="mt-4 pt-4 border-t border-slate-700">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm text-slate-400 flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            Supporting Evidence
                          </p>
                          {isEditable && (
                            <label className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 cursor-pointer">
                              <Upload className="h-3.5 w-3.5" />
                              Upload
                              <input
                                type="file"
                                className="hidden"
                                onChange={(e) => e.target.files && handleFileUpload(question.id, e.target.files)}
                                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                              />
                            </label>
                          )}
                        </div>
                        
                        {uploadingQuestion === question.id && (
                          <div className="flex items-center gap-2 text-sm text-primary-400">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Uploading...
                          </div>
                        )}
                        
                        {(evidenceFiles[question.id] || []).length > 0 ? (
                          <div className="space-y-2">
                            {evidenceFiles[question.id].map(file => (
                              <div key={file.id} className="flex items-center justify-between p-2 bg-slate-700/50 rounded-lg">
                                <div className="flex items-center gap-2">
                                  <FileText className="h-4 w-4 text-primary-400" />
                                  <span className="text-sm text-white">{file.filename}</span>
                                  <span className="text-xs text-slate-500">{formatFileSize(file.file_size)}</span>
                                </div>
                                {isEditable && (
                                  <button
                                    onClick={() => handleRemoveEvidence(question.id, file.id)}
                                    className="p-1 text-slate-400 hover:text-rose-400"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">No evidence uploaded yet. Upload files to support your response.</p>
                        )}
                      </div>

                      {/* AI Suggestion Toggle */}
                      {question.ai_suggestion_enabled && isEditable && (
                        <div className="mt-4 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                          <div className="flex items-center gap-2 text-purple-400">
                            <Lightbulb className="h-4 w-4" />
                            <span className="text-sm font-medium">AI Assistance Available</span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">Click the AI button to get suggestions based on your organization&apos;s data.</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
