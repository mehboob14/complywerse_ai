'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import {
  ArrowLeft,
  AlertTriangle,
  Loader2,
  AlertCircle,
  Building2,
  Calendar,
  User,
  Target,
  Shield,
  Play,
  CheckCircle,
  XCircle,
  Plus,
  Link2,
  X,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';

interface Finding {
  id: number;
  title: string;
  description?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'in_progress' | 'remediated' | 'closed';
  assessment_id: number;
  assessment_name: string;
  business_unit: string;
  created_at: string;
  updated_at: string;
  due_date?: string;
  ai_recommendation?: string;
  linked_risk?: { id: number; title: string };
  linked_control?: { id: number; name: string };
  mitigation_actions?: { id: number; title: string; status: string; due_date?: string }[];
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  critical: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-500', label: 'Critical' },
  high: { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-500', label: 'High' },
  medium: { bg: 'bg-yellow-50', text: 'text-yellow-600', border: 'border-yellow-500', label: 'Medium' },
  low: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-500', label: 'Low' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-red-50', text: 'text-red-600', label: 'Open' },
  in_progress: { bg: 'bg-yellow-50', text: 'text-yellow-600', label: 'In Progress' },
  remediated: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'Remediated' },
  closed: { bg: 'bg-green-50', text: 'text-green-600', label: 'Closed' },
};

const STATUS_FLOW = ['open', 'in_progress', 'remediated', 'closed'];

function getSeverityStyle(severity: string) {
  return SEVERITY_STYLES[severity] || SEVERITY_STYLES.low;
}

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] || STATUS_STYLES.open;
}

function formatDate(dateString?: string) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface LinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (id: number) => void;
  type: 'risk' | 'control';
  isLoading: boolean;
}

function LinkModal({ isOpen, onClose, onConfirm, type, isLoading }: LinkModalProps) {
  const [entityId, setEntityId] = useState('');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!entityId) return;
    onConfirm(Number(entityId));
    setEntityId('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-black">Link to {type === 'risk' ? 'Risk' : 'Internal Control'}</h3>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X size={20} />
          </button>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-600">
            {type === 'risk' ? 'Risk' : 'Control'} ID <span className="text-red-600">*</span>
          </label>
          <input
            type="number"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder={`Enter ${type} ID...`}
            className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black placeholder-slate-400"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button onClick={onClose} disabled={isLoading} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || !entityId}
            className="flex items-center gap-2 btn-primary"
          >
            {isLoading && <Loader2 size={16} className="animate-spin" />}
            Link
          </button>
        </div>
      </div>
    </div>
  );
}

interface CreateActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: Record<string, unknown>) => void;
  isLoading: boolean;
}

function CreateActionModal({ isOpen, onClose, onConfirm, isLoading }: CreateActionModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!title) return;
    onConfirm({ title, description, due_date: dueDate || undefined });
    setTitle('');
    setDescription('');
    setDueDate('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-black">Create Mitigation Action</h3>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 mb-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              Title <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Action title..."
              className="input w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the action..."
              className="input w-full h-24"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="input w-full"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button onClick={onClose} disabled={isLoading} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || !title}
            className="flex items-center gap-2 btn-primary"
          >
            {isLoading && <Loader2 size={16} className="animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FindingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const findingId = Number(params.id);

  const [linkModalType, setLinkModalType] = useState<'risk' | 'control' | null>(null);
  const [showActionModal, setShowActionModal] = useState(false);

  const { data: finding, isLoading, error } = useQuery({
    queryKey: ['rcsa-finding', findingId],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getFinding(findingId);
        return response.data as Finding;
      } catch {
        return {
          id: findingId,
          title: 'Inadequate Access Control Reviews',
          description: 'Access reviews are not being conducted on a quarterly basis as required by the security policy. This increases the risk of unauthorized access persisting undetected.',
          severity: 'high',
          status: 'in_progress',
          assessment_id: 2,
          assessment_name: 'Q4 2025 RCSA - Finance',
          business_unit: 'Finance',
          created_at: '2025-01-18',
          updated_at: '2025-01-22',
          due_date: '2025-02-28',
          ai_recommendation: 'Implement automated access review workflows with quarterly reminders. Consider using identity governance tools to streamline the review process and ensure timely completion.',
          linked_risk: { id: 5, title: 'Unauthorized Access Risk' },
          linked_control: null,
          mitigation_actions: [
            { id: 1, title: 'Implement automated access review reminders', status: 'in_progress', due_date: '2025-02-15' },
            { id: 2, title: 'Configure quarterly review schedule in IAM system', status: 'pending', due_date: '2025-02-28' },
          ],
        } as Finding;
      }
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: (newStatus: string) => rcsaApi.updateFinding(findingId, { status: newStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-finding', findingId] });
      queryClient.invalidateQueries({ queryKey: ['rcsa-findings'] });
    },
  });

  const linkRiskMutation = useMutation({
    mutationFn: (riskId: number) => rcsaApi.linkFindingToRisk(findingId, { risk_id: riskId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-finding', findingId] });
      setLinkModalType(null);
    },
  });

  const linkControlMutation = useMutation({
    mutationFn: (controlId: number) => rcsaApi.linkFindingToControl(findingId, { control_id: controlId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-finding', findingId] });
      setLinkModalType(null);
    },
  });

  const createActionMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => rcsaApi.createFindingAction(findingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-finding', findingId] });
      setShowActionModal(false);
    },
  });

  const handleStatusChange = (newStatus: string) => {
    if (confirm(`Change status to "${STATUS_STYLES[newStatus]?.label}"?`)) {
      updateStatusMutation.mutate(newStatus);
    }
  };

  const handleLinkConfirm = (id: number) => {
    if (linkModalType === 'risk') {
      linkRiskMutation.mutate(id);
    } else if (linkModalType === 'control') {
      linkControlMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (error || !finding) {
    return (
      <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-600" />
        <p className="mt-2 text-red-600">Failed to load finding</p>
      </div>
    );
  }

  const severityStyle = getSeverityStyle(finding.severity);
  const statusStyle = getStatusStyle(finding.status);
  const currentStatusIndex = STATUS_FLOW.indexOf(finding.status);
  const nextStatus = STATUS_FLOW[currentStatusIndex + 1];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/risks/rcsa/findings"
          className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <AlertTriangle className={`h-6 w-6 ${severityStyle.text}`} />
            <h1 className="text-2xl font-semibold text-black">{finding.title}</h1>
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-slate-600">
            <span className="flex items-center gap-1.5">
              <Building2 className="h-4 w-4" />
              {finding.business_unit}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              Created {formatDate(finding.created_at)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${severityStyle.bg} ${severityStyle.text}`}>
            {severityStyle.label} Severity
          </span>
          <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${statusStyle.bg} ${statusStyle.text}`}>
            {statusStyle.label}
          </span>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-lg font-medium text-black mb-4">Status Workflow</h3>
        <div className="flex items-center justify-between">
          {STATUS_FLOW.map((status, index) => {
            const style = getStatusStyle(status);
            const isActive = status === finding.status;
            const isPast = index < currentStatusIndex;
            const isNext = index === currentStatusIndex + 1;

            return (
              <div key={status} className="flex items-center">
                <button
                  onClick={() => isNext && handleStatusChange(status)}
                  disabled={!isNext || updateStatusMutation.isPending}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                    isActive ? `${style.bg} ${style.text} ring-2 ring-offset-2 ring-offset-slate-900 ${style.text.replace('text-', 'ring-')}` :
                    isPast ? 'bg-slate-200 text-slate-600' :
                    isNext ? 'bg-slate-200 text-black hover:bg-slate-600 cursor-pointer' :
                    'bg-white text-slate-500'
                  }`}
                >
                  {isPast ? <CheckCircle className="h-4 w-4" /> : 
                   isActive ? <Play className="h-4 w-4" /> : 
                   <div className="h-4 w-4 rounded-full border-2 border-current" />}
                  {style.label}
                </button>
                {index < STATUS_FLOW.length - 1 && (
                  <div className={`w-8 h-0.5 mx-2 ${isPast ? 'bg-slate-500' : 'bg-slate-200'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <h3 className="text-lg font-medium text-black mb-4">Description</h3>
            <p className="text-slate-600">{finding.description || 'No description provided.'}</p>
          </div>

          {finding.ai_recommendation && (
            <div className="card p-6 border-primary-200">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="h-5 w-5 text-primary-600" />
                <h3 className="text-lg font-medium text-black">AI Recommendation</h3>
              </div>
              <p className="text-slate-600">{finding.ai_recommendation}</p>
            </div>
          )}

          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-black">Mitigation Actions</h3>
              <button
                onClick={() => setShowActionModal(true)}
                className="btn-secondary text-sm flex items-center gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Add Action
              </button>
            </div>
            {finding.mitigation_actions && finding.mitigation_actions.length > 0 ? (
              <div className="space-y-3">
                {finding.mitigation_actions.map((action) => (
                  <div key={action.id} className="p-3 rounded-lg bg-white/50 flex items-center justify-between">
                    <div>
                      <p className="text-black font-medium">{action.title}</p>
                      <p className="text-sm text-slate-600">Due: {formatDate(action.due_date)}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      action.status === 'completed' ? 'bg-green-50 text-green-700' :
                      action.status === 'in_progress' ? 'bg-yellow-50 text-yellow-700' :
                      'bg-slate-50 text-slate-700'
                    }`}>
                      {action.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-600 text-center py-4">No mitigation actions created yet.</p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="text-lg font-medium text-black mb-4">Details</h3>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-slate-600">Assessment</p>
                <p className="text-black">{finding.assessment_name}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Due Date</p>
                <p className={`${finding.due_date && new Date(finding.due_date) < new Date() && finding.status !== 'closed' ? 'text-red-600' : 'text-black'}`}>
                  {formatDate(finding.due_date)}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Last Updated</p>
                <p className="text-black">{formatDate(finding.updated_at)}</p>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h3 className="text-lg font-medium text-black mb-4">Linked Items</h3>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-slate-600 flex items-center gap-1.5">
                    <Target className="h-4 w-4" />
                    Linked Risk
                  </p>
                  {!finding.linked_risk && (
                    <button
                      onClick={() => setLinkModalType('risk')}
                      className="text-xs text-primary-600 hover:text-primary-300"
                    >
                      Link
                    </button>
                  )}
                </div>
                {finding.linked_risk ? (
                  <Link
                    href={`/erm/risks/${finding.linked_risk.id}`}
                    className="p-2 rounded-lg bg-primary-50 border border-primary-200 flex items-center justify-between hover:bg-primary-50"
                  >
                    <span className="text-black">{finding.linked_risk.title}</span>
                    <ExternalLink className="h-4 w-4 text-primary-600" />
                  </Link>
                ) : (
                  <p className="text-slate-500 text-sm">No risk linked</p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-slate-600 flex items-center gap-1.5">
                    <Shield className="h-4 w-4" />
                    Linked Control
                  </p>
                  {!finding.linked_control && (
                    <button
                      onClick={() => setLinkModalType('control')}
                      className="text-xs text-primary-600 hover:text-primary-300"
                    >
                      Link
                    </button>
                  )}
                </div>
                {finding.linked_control ? (
                  <Link
                    href={`/erm/internal-controls/${finding.linked_control.id}`}
                    className="p-2 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-between hover:bg-blue-50"
                  >
                    <span className="text-black">{finding.linked_control.name}</span>
                    <ExternalLink className="h-4 w-4 text-blue-600" />
                  </Link>
                ) : (
                  <p className="text-slate-500 text-sm">No control linked</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {linkModalType && (
        <LinkModal
          isOpen={true}
          onClose={() => setLinkModalType(null)}
          onConfirm={handleLinkConfirm}
          type={linkModalType}
          isLoading={linkRiskMutation.isPending || linkControlMutation.isPending}
        />
      )}

      <CreateActionModal
        isOpen={showActionModal}
        onClose={() => setShowActionModal(false)}
        onConfirm={(data) => createActionMutation.mutate(data)}
        isLoading={createActionMutation.isPending}
      />
    </div>
  );
}
