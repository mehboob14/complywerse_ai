'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  RotateCcw,
  Forward,
  Loader2,
  AlertCircle,
  Building2,
  User,
  Calendar,
  Clock,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';

interface Question {
  id: number;
  section: string;
  question_text: string;
  question_type: string;
}

interface Response {
  question_id: number;
  likelihood?: number;
  impact?: number;
  effectiveness?: string;
  yes_no_value?: boolean;
  text_value?: string;
}

interface ApprovalAction {
  id: number;
  tier: number;
  action: string;
  actor_name: string;
  comments?: string;
  created_at: string;
}

interface AssessmentDetail {
  id: number;
  campaign_id: number;
  campaign_name: string;
  business_unit: string;
  assessor_name: string;
  submission_date: string;
  current_tier: number;
  total_tiers: number;
  score: number;
  ai_quality_score?: number;
  questions: Question[];
  responses: Response[];
  approval_history: ApprovalAction[];
}

const EFFECTIVENESS_LABELS: Record<string, string> = {
  effective: 'Effective',
  partially_effective: 'Partially Effective',
  ineffective: 'Ineffective',
  not_applicable: 'Not Applicable',
};

function formatDate(dateString?: string) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: Record<string, unknown>) => void;
  type: 'approve' | 'reject' | 'return' | 'delegate';
  isLoading: boolean;
}

function ActionModal({ isOpen, onClose, onConfirm, type, isLoading }: ActionModalProps) {
  const [comments, setComments] = useState('');
  const [delegateUserId, setDelegateUserId] = useState('');

  const handleSubmit = () => {
    if ((type === 'reject' || type === 'return') && !comments.trim()) return;
    if (type === 'delegate' && !delegateUserId) return;

    const data: Record<string, unknown> = { comments };
    if (type === 'delegate') {
      data.delegate_to_user_id = Number(delegateUserId);
    }
    onConfirm(data);
    setComments('');
    setDelegateUserId('');
  };

  const titles: Record<string, string> = {
    approve: 'Approve Assessment',
    reject: 'Reject Assessment',
    return: 'Return for Changes',
    delegate: 'Delegate Approval',
  };

  const buttonColors: Record<string, string> = {
    approve: 'bg-green-600 hover:bg-green-700',
    reject: 'bg-red-600 hover:bg-red-700',
    return: 'bg-amber-600 hover:bg-amber-700',
    delegate: 'bg-primary-600 hover:bg-primary-700',
  };

  return (
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title={titles[type]}
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || ((type === 'reject' || type === 'return') && !comments.trim()) || (type === 'delegate' && !delegateUserId)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium text-white ${buttonColors[type]}`}
          >
            {isLoading && <Loader2 size={16} className="animate-spin" />}
            {titles[type].split(' ')[0]}
          </button>
        </div>
      }
    >
      {type === 'delegate' && (
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Delegate to User ID <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            value={delegateUserId}
            onChange={(e) => setDelegateUserId(e.target.value)}
            placeholder="Enter user ID..."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      )}

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Comments {(type === 'reject' || type === 'return') && <span className="text-red-500">*</span>}
        </label>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder={type === 'approve' ? 'Optional comments...' : 'Provide feedback...'}
          className="h-32 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>
    </RightSlidePanel>
  );
}

export default function ApprovalReviewPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const assessmentId = Number(params.id);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [modalType, setModalType] = useState<'approve' | 'reject' | 'return' | 'delegate' | null>(null);

  const { data: assessment, isLoading, error } = useQuery({
    queryKey: ['rcsa-approval-detail', assessmentId],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getAssessment(assessmentId);
        return response.data as AssessmentDetail;
      } catch {
        throw new Error('Failed to load assessment');
      }
    },
  });

  const approveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => rcsaApi.approveAssessment(assessmentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-pending-approvals'] });
      router.push('/risks/rcsa/approvals');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => rcsaApi.rejectAssessment(assessmentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-pending-approvals'] });
      router.push('/risks/rcsa/approvals');
    },
  });

  const returnMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => rcsaApi.returnAssessment(assessmentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-pending-approvals'] });
      router.push('/risks/rcsa/approvals');
    },
  });

  const delegateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => rcsaApi.delegateAssessment(assessmentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-pending-approvals'] });
      router.push('/risks/rcsa/approvals');
    },
  });

  const handleConfirmAction = (data: Record<string, unknown>) => {
    switch (modalType) {
      case 'approve': approveMutation.mutate(data); break;
      case 'reject': rejectMutation.mutate(data); break;
      case 'return': returnMutation.mutate(data); break;
      case 'delegate': delegateMutation.mutate(data); break;
    }
    setModalType(null);
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

  const getResponseDisplay = (question: Question) => {
    const response = assessment?.responses.find(r => r.question_id === question.id);
    if (!response) return <span className="text-slate-500">No response</span>;

    switch (question.question_type) {
      case 'risk_rating':
        return (
          <div className="flex items-center gap-4">
            <span className="text-slate-600">Likelihood: <span className="text-slate-900 font-medium">{response.likelihood}</span></span>
            <span className="text-slate-600">Impact: <span className="text-slate-900 font-medium">{response.impact}</span></span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              (response.likelihood || 0) * (response.impact || 0) >= 15 ? 'bg-red-500/20 text-red-400' :
              (response.likelihood || 0) * (response.impact || 0) >= 8 ? 'bg-yellow-500/20 text-yellow-400' :
              'bg-green-500/20 text-green-400'
            }`}>
              Score: {(response.likelihood || 0) * (response.impact || 0)}
            </span>
          </div>
        );
      case 'control_rating':
        return <span className="text-slate-900">{EFFECTIVENESS_LABELS[response.effectiveness || ''] || response.effectiveness}</span>;
      case 'yes_no':
        return (
          <span className={response.yes_no_value ? 'text-green-400' : 'text-red-400'}>
            {response.yes_no_value ? 'Yes' : 'No'}
          </span>
        );
      case 'text':
        return <p className="text-slate-700">{response.text_value}</p>;
      default:
        return null;
    }
  };

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
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="flex items-center gap-4">
        <Link
          href="/risks/rcsa/approvals"
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">{assessment.campaign_name}</h1>
          <div className="flex items-center gap-4 mt-1 text-sm text-slate-600">
            <span className="flex items-center gap-1.5">
              <Building2 className="h-4 w-4" />
              {assessment.business_unit}
            </span>
            <span className="flex items-center gap-1.5">
              <User className="h-4 w-4" />
              {assessment.assessor_name}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              Submitted {formatDate(assessment.submission_date)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setModalType('delegate')} className="btn-secondary flex items-center gap-2">
            <Forward className="h-4 w-4" />
            Delegate
          </button>
          <button onClick={() => setModalType('return')} className="btn-secondary flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            Return
          </button>
          <button onClick={() => setModalType('reject')} className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 flex items-center gap-2">
            <XCircle className="h-4 w-4" />
            Reject
          </button>
          <button onClick={() => setModalType('approve')} className="px-4 py-2 rounded-lg bg-green-600 text-slate-900 hover:bg-green-700 flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Approve
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-sm text-slate-600">Approval Tier</p>
          <p className="text-xl font-semibold text-slate-900">{assessment.current_tier} of {assessment.total_tiers}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-slate-600">Assessment Score</p>
          <p className={`text-xl font-semibold ${
            assessment.score >= 80 ? 'text-green-400' : 
            assessment.score >= 60 ? 'text-yellow-400' : 'text-red-400'
          }`}>{assessment.score}%</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-slate-600 flex items-center gap-1">
            <Sparkles className="h-4 w-4 text-purple-400" />
            AI Quality Score
          </p>
          <p className={`text-xl font-semibold ${
            (assessment.ai_quality_score || 0) >= 80 ? 'text-green-400' : 
            (assessment.ai_quality_score || 0) >= 60 ? 'text-yellow-400' : 'text-red-400'
          }`}>{assessment.ai_quality_score || '-'}%</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-slate-600">Questions Answered</p>
          <p className="text-xl font-semibold text-slate-900">{assessment.responses.length} / {assessment.questions.length}</p>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-lg font-medium text-slate-900 mb-4">Approval History</h3>
        <div className="space-y-3">
          {assessment.approval_history.map((action) => (
            <div key={action.id} className="flex items-center gap-4 p-3 rounded-lg bg-white/50">
              <div className={`p-2 rounded-lg ${
                action.action === 'approved' ? 'bg-green-500/20' :
                action.action === 'rejected' ? 'bg-red-500/20' :
                action.action === 'returned' ? 'bg-amber-500/20' :
                'bg-blue-500/20'
              }`}>
                {action.action === 'approved' ? <CheckCircle className="h-4 w-4 text-green-400" /> :
                 action.action === 'rejected' ? <XCircle className="h-4 w-4 text-red-400" /> :
                 action.action === 'returned' ? <RotateCcw className="h-4 w-4 text-amber-400" /> :
                 <Clock className="h-4 w-4 text-blue-400" />}
              </div>
              <div className="flex-1">
                <p className="text-slate-900 font-medium capitalize">{action.action}</p>
                <p className="text-sm text-slate-600">by {action.actor_name} • {formatDate(action.created_at)}</p>
              </div>
              {action.comments && (
                <p className="text-sm text-slate-700 italic">"{action.comments}"</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-medium text-slate-900">Assessment Responses</h3>
        {Object.entries(groupedQuestions).map(([section, questions]) => (
          <div key={section} className="card overflow-hidden">
            <button
              onClick={() => toggleSection(section)}
              className="w-full flex items-center justify-between p-4 bg-white/50 hover:bg-white"
            >
              <h4 className="text-slate-900 font-medium">{section}</h4>
              {expandedSections.has(section) ? (
                <ChevronUp className="h-5 w-5 text-slate-600" />
              ) : (
                <ChevronDown className="h-5 w-5 text-slate-600" />
              )}
            </button>

            {expandedSections.has(section) && (
              <div className="divide-y divide-slate-700">
                {questions.map((question) => (
                  <div key={question.id} className="p-4">
                    <p className="text-slate-700 mb-2">{question.question_text}</p>
                    <div className="mt-2">{getResponseDisplay(question)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <ActionModal
        isOpen={!!modalType}
        onClose={() => setModalType(null)}
        onConfirm={handleConfirmAction}
        type={modalType || 'approve'}
        isLoading={approveMutation.isPending || rejectMutation.isPending || returnMutation.isPending || delegateMutation.isPending}
      />
    </div>
  );
}
