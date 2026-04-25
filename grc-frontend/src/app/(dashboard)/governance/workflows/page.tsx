'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { WorkflowDashboard, PendingApprovalItem } from '@/types';
import { RightSlidePanel } from '@/components/ui';
import {
  FileCheck,
  Loader2,
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileText,
  Plus,
  Settings,
  ChevronUp,
  ChevronDown,
  Edit2,
  Trash2,
  ArrowLeft,
  Wand2,
  Users,
  Layers,
} from 'lucide-react';

type MainTabType = 'approvals' | 'templates';
type ApprovalTabType = 'pending' | 'approved' | 'rejected' | 'all';

interface WorkflowTemplate {
  id: number;
  tenant_id: number;
  name: string;
  description?: string;
  doc_types?: string[];
  is_default: boolean;
  is_active: boolean;
  allow_skip: boolean;
  require_all_approvers: boolean;
  auto_publish_on_complete: boolean;
  created_at: string;
  updated_at: string;
  steps?: WorkflowStep[];
}

interface WorkflowStep {
  id: number;
  template_id: number;
  name: string;
  description?: string;
  sequence: number;
  step_type: string;
  approval_mode: string;
  is_required: boolean;
  timeout_days?: number;
  approvers?: StepApprover[];
}

interface StepApprover {
  id: number;
  step_id: number;
  approver_type: string;
  user_id?: number;
  role_id?: number;
  is_required: boolean;
  sequence: number;
}

const DOC_TYPE_STYLES: Record<string, { label: string; color: string; bgColor: string }> = {
  policy: { label: 'Policy', color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  procedure: { label: 'Procedure', color: 'text-green-400', bgColor: 'bg-green-500/20' },
  standard: { label: 'Standard', color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
  guideline: { label: 'Guideline', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  template: { label: 'Template', color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
  other: { label: 'Other', color: 'text-gray-600', bgColor: 'bg-slate-500/20' },
};

const STEP_TYPES = [
  { value: 'review', label: 'Review' },
  { value: 'approval', label: 'Approval' },
  { value: 'notification', label: 'Notification' },
];

const APPROVAL_MODES = [
  { value: 'any', label: 'Any Approver' },
  { value: 'all', label: 'All Approvers' },
  { value: 'sequential', label: 'Sequential' },
];

const DOC_TYPES_OPTIONS = [
  { value: 'policy', label: 'Policy' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'standard', label: 'Standard' },
  { value: 'guideline', label: 'Guideline' },
  { value: 'template', label: 'Template' },
  { value: 'other', label: 'Other' },
];

const getDocTypeStyle = (docType: string) => {
  return DOC_TYPE_STYLES[docType] || DOC_TYPE_STYLES.other;
};

const formatDate = (dateString?: string) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const formatDateTime = (dateString?: string) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface ApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (comments: string) => void;
  title: string;
  actionType: 'approve' | 'reject';
  isLoading: boolean;
}

function ApprovalModal({ isOpen, onClose, onConfirm, title, actionType, isLoading }: ApprovalModalProps) {
  const [comments, setComments] = useState('');

  const handleSubmit = () => {
    if (actionType === 'reject' && !comments.trim()) {
      return;
    }
    onConfirm(comments);
  };

  return (
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title={actionType === 'approve' ? 'Approve Document' : 'Reject Document'}
      width="w-full max-w-md"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="cw-btn-secondary rounded-lg px-4 py-2 font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || (actionType === 'reject' && !comments.trim())}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium disabled:opacity-50 ${
              actionType === 'approve'
                ? 'cw-btn-success'
                : 'cw-btn-danger'
            }`}
          >
            {isLoading && <Loader2 size={16} className="animate-spin" />}
            {actionType === 'approve' ? 'Approve' : 'Reject'}
          </button>
        </div>
      }
    >
      <p className="cw-text-default mb-4 text-sm">
        {actionType === 'approve'
          ? `You are about to approve "${title}".`
          : `You are about to reject "${title}". Please provide a reason.`}
      </p>

      <div className="mb-4">
        <label className="cw-label mb-1 block text-sm font-medium">
          Comments {actionType === 'reject' && <span className="cw-required">*</span>}
        </label>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder={actionType === 'approve' ? 'Optional comments...' : 'Reason for rejection...'}
          className="cw-field h-24 w-full rounded-lg px-3 py-2"
        />
        {actionType === 'reject' && !comments.trim() && (
          <p className="cw-required mt-1 text-xs">Comments are required when rejecting</p>
        )}
      </div>
    </RightSlidePanel>
  );
}

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: TemplateFormData) => void;
  template?: WorkflowTemplate | null;
  isLoading: boolean;
}

interface TemplateFormData {
  name: string;
  description: string;
  doc_types: string[];
  allow_skip: boolean;
  require_all_approvers: boolean;
  auto_publish_on_complete: boolean;
}

function TemplateModal({ isOpen, onClose, onSubmit, template, isLoading }: TemplateModalProps) {
  const [formData, setFormData] = useState<TemplateFormData>({
    name: template?.name || '',
    description: template?.description || '',
    doc_types: template?.doc_types || [],
    allow_skip: template?.allow_skip || false,
    require_all_approvers: template?.require_all_approvers || false,
    auto_publish_on_complete: template?.auto_publish_on_complete || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const toggleDocType = (docType: string) => {
    setFormData(prev => ({
      ...prev,
      doc_types: prev.doc_types.includes(docType)
        ? prev.doc_types.filter(t => t !== docType)
        : [...prev.doc_types, docType]
    }));
  };

  return (
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title={template ? 'Edit Template' : 'New Workflow Template'}
      width="w-full max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="cw-label mb-1 block text-sm font-medium">
              Name <span className="cw-required">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              required
              className="cw-field w-full rounded-lg px-3 py-2"
              placeholder="e.g., Policy Approval Workflow"
            />
          </div>

          <div>
            <label className="cw-label mb-1 block text-sm font-medium">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="cw-field h-20 w-full rounded-lg px-3 py-2"
              placeholder="Describe the workflow template..."
            />
          </div>

          <div>
            <label className="cw-label mb-2 block text-sm font-medium">Document Types</label>
            <div className="flex flex-wrap gap-2">
              {DOC_TYPES_OPTIONS.map(option => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    formData.doc_types.includes(option.value)
                      ? 'border-[var(--color-base)] bg-[var(--color-base-soft)] cw-text-default'
                      : 'border-[var(--color-border)] bg-[var(--color-subtle)] cw-text-default'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={formData.doc_types.includes(option.value)}
                    onChange={() => toggleDocType(option.value)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div className="cw-card space-y-3 rounded-lg p-4">
            <h4 className="cw-label text-sm font-medium">Settings</h4>
            
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.allow_skip}
                onChange={(e) => setFormData(prev => ({ ...prev, allow_skip: e.target.checked }))}
                className="h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-subtle)] text-[var(--color-base)] focus:ring-[var(--color-base)]"
              />
              <span className="cw-label text-sm">Allow steps to be skipped</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.require_all_approvers}
                onChange={(e) => setFormData(prev => ({ ...prev, require_all_approvers: e.target.checked }))}
                className="h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-subtle)] text-[var(--color-base)] focus:ring-[var(--color-base)]"
              />
              <span className="cw-label text-sm">Require all approvers</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.auto_publish_on_complete}
                onChange={(e) => setFormData(prev => ({ ...prev, auto_publish_on_complete: e.target.checked }))}
                className="h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-subtle)] text-[var(--color-base)] focus:ring-[var(--color-base)]"
              />
              <span className="cw-label text-sm">Auto-publish on workflow completion</span>
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="cw-btn-secondary rounded-lg px-4 py-2 font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !formData.name.trim()}
              className="cw-btn-primary flex items-center gap-2 rounded-lg px-4 py-2 font-medium disabled:opacity-50"
            >
              {isLoading && <Loader2 size={16} className="animate-spin" />}
              {template ? 'Save Changes' : 'Create Template'}
            </button>
          </div>
      </form>
    </RightSlidePanel>
  );
}

interface StepModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: StepFormData) => void;
  step?: WorkflowStep | null;
  nextSequence: number;
  isLoading: boolean;
}

interface StepFormData {
  name: string;
  description: string;
  step_type: string;
  approval_mode: string;
  is_required: boolean;
  timeout_days: number | null;
  sequence: number;
}

function StepModal({ isOpen, onClose, onSubmit, step, nextSequence, isLoading }: StepModalProps) {
  const [formData, setFormData] = useState<StepFormData>({
    name: step?.name || '',
    description: step?.description || '',
    step_type: step?.step_type || 'approval',
    approval_mode: step?.approval_mode || 'any',
    is_required: step?.is_required ?? true,
    timeout_days: step?.timeout_days ?? null,
    sequence: step?.sequence ?? nextSequence,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title={step ? 'Edit Step' : 'Add Workflow Step'}
      width="w-full max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="cw-label mb-1 block text-sm font-medium">
              Step Name <span className="cw-required">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              required
              className="cw-field w-full rounded-lg px-3 py-2"
              placeholder="e.g., Manager Review"
            />
          </div>

          <div>
            <label className="cw-label mb-1 block text-sm font-medium">Step Type</label>
            <select
              value={formData.step_type}
              onChange={(e) => setFormData(prev => ({ ...prev, step_type: e.target.value }))}
              className="cw-field w-full rounded-lg px-3 py-2"
            >
              {STEP_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="cw-label mb-1 block text-sm font-medium">Approval Mode</label>
            <select
              value={formData.approval_mode}
              onChange={(e) => setFormData(prev => ({ ...prev, approval_mode: e.target.value }))}
              className="cw-field w-full rounded-lg px-3 py-2"
            >
              {APPROVAL_MODES.map(mode => (
                <option key={mode.value} value={mode.value}>{mode.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="cw-label mb-1 block text-sm font-medium">Timeout (days)</label>
            <input
              type="number"
              value={formData.timeout_days ?? ''}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                timeout_days: e.target.value ? parseInt(e.target.value) : null 
              }))}
              min="1"
              className="cw-field w-full rounded-lg px-3 py-2"
              placeholder="Optional timeout in days"
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.is_required}
              onChange={(e) => setFormData(prev => ({ ...prev, is_required: e.target.checked }))}
              className="h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-subtle)] text-[var(--color-base)] focus:ring-[var(--color-base)]"
            />
            <span className="cw-label text-sm">This step is required</span>
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="cw-btn-secondary rounded-lg px-4 py-2 font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !formData.name.trim()}
              className="cw-btn-primary flex items-center gap-2 rounded-lg px-4 py-2 font-medium disabled:opacity-50"
            >
              {isLoading && <Loader2 size={16} className="animate-spin" />}
              {step ? 'Save Changes' : 'Add Step'}
            </button>
          </div>
      </form>
    </RightSlidePanel>
  );
}

export default function GovernanceWorkflowsPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:workflows:create');
  const canEdit = hasPermission('governance:workflows:edit');
  const canDelete = hasPermission('governance:workflows:delete');
  const [mainTab, setMainTab] = useState<MainTabType>('approvals');
  const [activeTab, setActiveTab] = useState<ApprovalTabType>('pending');
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    stepId: number | null;
    title: string;
    actionType: 'approve' | 'reject';
  }>({ isOpen: false, stepId: null, title: '', actionType: 'approve' });
  
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WorkflowTemplate | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);
  const [stepModalOpen, setStepModalOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<WorkflowStep | null>(null);

  const queryClient = useQueryClient();

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['workflow-dashboard'],
    queryFn: async () => {
      const response = await governanceApi.getWorkflowDashboard();
      return response.data as WorkflowDashboard;
    },
  });

  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: ['pending-approvals'],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await governanceApi.getPendingApprovals();
      return response.data as { items: PendingApprovalItem[]; total: number };
    },
  });

  const { data: overdueData } = useQuery({
    queryKey: ['overdue-approvals'],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await governanceApi.getOverdueApprovals();
      return response.data as { items: PendingApprovalItem[]; total: number };
    },
  });

  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['workflow-templates'],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await governanceApi.getWorkflowTemplates();
      return response.data as WorkflowTemplate[];
    },
  });

  const { data: templateDetail, isLoading: templateDetailLoading } = useQuery({
    queryKey: ['workflow-template', selectedTemplate?.id],
    queryFn: async () => {
      if (!selectedTemplate?.id) return null;
      const response = await governanceApi.getWorkflowTemplate(selectedTemplate.id);
      return response.data as WorkflowTemplate;
    },
    enabled: !!selectedTemplate?.id,
  });

  const approveMutation = useMutation({
    mutationFn: ({ stepId, comments }: { stepId: number; comments: string }) =>
      governanceApi.approveStep(stepId, comments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['overdue-approvals'] });
      setModalState({ isOpen: false, stepId: null, title: '', actionType: 'approve' });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ stepId, comments }: { stepId: number; comments: string }) =>
      governanceApi.rejectStep(stepId, comments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['overdue-approvals'] });
      setModalState({ isOpen: false, stepId: null, title: '', actionType: 'reject' });
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: (data: TemplateFormData) =>
      governanceApi.createWorkflowTemplate({
        tenant_id: 1,
        name: data.name,
        description: data.description,
        doc_types: data.doc_types,
        allow_skip: data.allow_skip,
        require_all_approvers: data.require_all_approvers,
        auto_publish_on_complete: data.auto_publish_on_complete,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-templates'] });
      setTemplateModalOpen(false);
      setEditingTemplate(null);
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: TemplateFormData }) =>
      governanceApi.updateWorkflowTemplate(id, {
        name: data.name,
        description: data.description,
        doc_types: data.doc_types,
        allow_skip: data.allow_skip,
        require_all_approvers: data.require_all_approvers,
        auto_publish_on_complete: data.auto_publish_on_complete,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-templates'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-template', editingTemplate?.id] });
      setTemplateModalOpen(false);
      setEditingTemplate(null);
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: number) => governanceApi.deleteWorkflowTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-templates'] });
      setSelectedTemplate(null);
    },
  });

  const createStepMutation = useMutation({
    mutationFn: ({ templateId, data }: { templateId: number; data: StepFormData }) =>
      governanceApi.createWorkflowStep(templateId, {
        name: data.name,
        description: data.description,
        sequence: data.sequence,
        step_type: data.step_type,
        approval_mode: data.approval_mode,
        is_required: data.is_required,
        timeout_days: data.timeout_days ?? undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-template', selectedTemplate?.id] });
      setStepModalOpen(false);
      setEditingStep(null);
    },
  });

  const updateStepMutation = useMutation({
    mutationFn: ({ templateId, stepId, data }: { templateId: number; stepId: number; data: StepFormData }) =>
      governanceApi.updateWorkflowStep(templateId, stepId, {
        name: data.name,
        description: data.description,
        step_type: data.step_type,
        approval_mode: data.approval_mode,
        is_required: data.is_required,
        timeout_days: data.timeout_days ?? undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-template', selectedTemplate?.id] });
      setStepModalOpen(false);
      setEditingStep(null);
    },
  });

  const deleteStepMutation = useMutation({
    mutationFn: ({ templateId, stepId }: { templateId: number; stepId: number }) =>
      governanceApi.deleteWorkflowStep(templateId, stepId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-template', selectedTemplate?.id] });
    },
  });

  const reorderStepsMutation = useMutation({
    mutationFn: ({ templateId, steps }: { templateId: number; steps: { step_id: number; sequence: number }[] }) =>
      governanceApi.reorderWorkflowSteps(templateId, steps),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-template', selectedTemplate?.id] });
    },
  });

  const seedDefaultsMutation = useMutation({
    mutationFn: () => governanceApi.seedDefaultTemplates(1),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-templates'] });
    },
  });

  const pendingApprovals = useMemo(() => {
    return pendingData?.items || [];
  }, [pendingData]);

  const overdueApprovals = useMemo(() => {
    return overdueData?.items || [];
  }, [overdueData]);

  const filteredApprovals = useMemo(() => {
    if (activeTab === 'pending') {
      return pendingApprovals.filter((item) => !item.is_overdue);
    }
    if (activeTab === 'approved' || activeTab === 'rejected') {
      return [];
    }
    return pendingApprovals;
  }, [activeTab, pendingApprovals]);

  const handleApprove = (stepId: number, title: string) => {
    setModalState({ isOpen: true, stepId, title, actionType: 'approve' });
  };

  const handleReject = (stepId: number, title: string) => {
    setModalState({ isOpen: true, stepId, title, actionType: 'reject' });
  };

  const handleConfirmAction = (comments: string) => {
    if (!modalState.stepId) return;

    if (modalState.actionType === 'approve') {
      approveMutation.mutate({ stepId: modalState.stepId, comments });
    } else {
      rejectMutation.mutate({ stepId: modalState.stepId, comments });
    }
  };

  const handleTemplateSubmit = (data: TemplateFormData) => {
    if (editingTemplate) {
      updateTemplateMutation.mutate({ id: editingTemplate.id, data });
    } else {
      createTemplateMutation.mutate(data);
    }
  };

  const handleStepSubmit = (data: StepFormData) => {
    if (!selectedTemplate) return;
    if (editingStep) {
      updateStepMutation.mutate({ templateId: selectedTemplate.id, stepId: editingStep.id, data });
    } else {
      createStepMutation.mutate({ templateId: selectedTemplate.id, data });
    }
  };

  const handleMoveStep = (step: WorkflowStep, direction: 'up' | 'down') => {
    if (!templateDetail?.steps || !selectedTemplate) return;
    
    const steps = [...templateDetail.steps].sort((a, b) => a.sequence - b.sequence);
    const currentIndex = steps.findIndex(s => s.id === step.id);
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    
    if (newIndex < 0 || newIndex >= steps.length) return;
    
    const reordered = steps.map((s, idx) => {
      if (idx === currentIndex) return { step_id: s.id, sequence: newIndex + 1 };
      if (idx === newIndex) return { step_id: s.id, sequence: currentIndex + 1 };
      return { step_id: s.id, sequence: idx + 1 };
    });
    
    reorderStepsMutation.mutate({ templateId: selectedTemplate.id, steps: reordered });
  };

  const isLoading = dashboardLoading || pendingLoading;

  if (isLoading && mainTab === 'approvals') {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="cw-text-default text-lg sm:text-xl font-semibold">Approval Workflows</h1>
          <p className="cw-text-muted text-xs">
            Manage document approvals, workflow templates, and review pending requests
          </p>
        </div>
      </div>

      <div className="border-b border-gray-300">
        <nav className="flex gap-1 overflow-x-auto">
          <button
            onClick={() => { setMainTab('approvals'); setSelectedTemplate(null); }}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              mainTab === 'approvals'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-600 hover:text-black'
            }`}
          >
            <FileCheck size={16} />
            Approvals
          </button>
          <button
            onClick={() => setMainTab('templates')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              mainTab === 'templates'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-600 hover:text-black'
            }`}
          >
            <Settings size={16} />
            Workflow Templates
          </button>
        </nav>
      </div>

      {mainTab === 'approvals' && (
        <>
          <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-center gap-2.5">
                <div className="rounded bg-yellow-50 p-1.5">
                  <Clock className="h-4 w-4 text-yellow-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Pending Approvals</p>
                  <p className="text-xl font-bold text-black">{dashboard?.pending_my_approval || 0}</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-center gap-2.5">
                <div className="rounded bg-green-50 p-1.5">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Approved Today</p>
                  <p className="text-xl font-bold text-black">{dashboard?.approved_today || 0}</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-center gap-2.5">
                <div className="rounded bg-red-50 p-1.5">
                  <XCircle className="h-4 w-4 text-red-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Rejected Today</p>
                  <p className="text-xl font-bold text-black">{dashboard?.rejected_today || 0}</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-center gap-2.5">
                <div className="rounded bg-orange-50 p-1.5">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Overdue</p>
                  <p className="text-xl font-bold text-black">{dashboard?.overdue || 0}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-300 bg-white">
            <div className="border-b border-gray-300">
              <nav className="flex gap-1 px-2 overflow-x-auto">
                {(['pending', 'approved', 'rejected', 'all'] as ApprovalTabType[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === tab
                        ? 'border-blue-600 text-blue-700'
                        : 'border-transparent text-gray-600 hover:text-black'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {tab === 'pending' && pendingApprovals.length > 0 && (
                      <span className="ml-1 rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-600">
                        {pendingApprovals.length}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            </div>

            <div className="p-4">
              {activeTab === 'approved' || activeTab === 'rejected' ? (
                <div className="flex h-48 flex-col items-center justify-center text-gray-600">
                  <FileCheck className="mb-2 h-12 w-12 opacity-50" />
                  <p className="text-lg font-medium">No {activeTab} items to display</p>
                  <p className="text-sm">Historical {activeTab} approvals will appear here</p>
                </div>
              ) : (
                <>
                  {activeTab === 'pending' && overdueApprovals.length > 0 && (
                    <div className="mb-4">
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-red-400">
                        <AlertTriangle size={16} />
                        Overdue Approvals ({overdueApprovals.length})
                      </h3>
                      <div className="space-y-3">
                        {overdueApprovals.map((item) => (
                          <ApprovalCard
                            key={`overdue-${item.step_id}`}
                            item={item}
                            onApprove={handleApprove}
                            onReject={handleReject}
                            isOverdue
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {(activeTab === 'pending' ? filteredApprovals : pendingApprovals).length > 0 ? (
                    <div className="space-y-3">
                      {activeTab === 'pending' && overdueApprovals.length > 0 && filteredApprovals.length > 0 && (
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-600">
                          <Clock size={16} />
                          Pending Approvals ({filteredApprovals.length})
                        </h3>
                      )}
                      {(activeTab === 'pending' ? filteredApprovals : pendingApprovals).map((item) => (
                        <ApprovalCard
                          key={item.step_id}
                          item={item}
                          onApprove={handleApprove}
                          onReject={handleReject}
                        />
                      ))}
                    </div>
                  ) : (
                    activeTab !== 'pending' || (filteredApprovals.length === 0 && overdueApprovals.length === 0) ? (
                      <div className="flex h-48 flex-col items-center justify-center text-gray-600">
                        <FileCheck className="mb-2 h-12 w-12 opacity-50" />
                        <p className="text-lg font-medium">No pending approvals</p>
                        <p className="text-sm">All caught up! No documents awaiting your approval.</p>
                      </div>
                    ) : null
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {mainTab === 'templates' && !selectedTemplate && (
        <div className="rounded-xl border border-gray-300 bg-white">
          <div className="flex items-center justify-between border-b border-gray-300 p-4">
            <h2 className="text-lg font-semibold text-black">Workflow Templates</h2>
            <div className="flex gap-2">
              <button
                onClick={() => seedDefaultsMutation.mutate()}
                disabled={seedDefaultsMutation.isPending}
                className="flex items-center gap-2 rounded-lg border border-purple-500/50 px-4 py-2 text-sm font-medium text-purple-400 hover:bg-purple-500/10 disabled:opacity-50"
              >
                {seedDefaultsMutation.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Wand2 size={16} />
                )}
                Seed Defaults
              </button>
              {canCreate && (
              <button
                onClick={() => { setEditingTemplate(null); setTemplateModalOpen(true); }}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-black hover:bg-primary-700"
              >
                <Plus size={16} />
                New Template
              </button>
              )}
            </div>
          </div>

          <div className="p-4">
            {templatesLoading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : templates && templates.length > 0 ? (
              <div className="space-y-3">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="flex items-center justify-between rounded-lg border border-gray-300 bg-white/50 p-4 hover:bg-gray-100/50 transition-colors"
                  >
                    <div className="flex-1 cursor-pointer" onClick={() => setSelectedTemplate(template)}>
                      <div className="flex items-center gap-3">
                        <Layers className="h-5 w-5 text-primary-400" />
                        <div>
                          <h3 className="font-medium text-black">{template.name}</h3>
                          {template.description && (
                            <p className="text-sm text-gray-600">{template.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {template.doc_types?.map((docType) => {
                          const style = getDocTypeStyle(docType);
                          return (
                            <span
                              key={docType}
                              className={`rounded px-2 py-0.5 text-xs ${style.bgColor} ${style.color}`}
                            >
                              {style.label}
                            </span>
                          );
                        })}
                        {template.is_default && (
                          <span className="rounded bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                            Default
                          </span>
                        )}
                        {!template.is_active && (
                          <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                            Inactive
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingTemplate(template); setTemplateModalOpen(true); }}
                        className="rounded p-2 text-gray-600 hover:bg-gray-100 hover:text-black transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          if (confirm('Are you sure you want to delete this template?')) {
                            deleteTemplateMutation.mutate(template.id);
                          }
                        }}
                        className="rounded p-2 text-gray-600 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center text-gray-600">
                <Layers className="mb-2 h-12 w-12 opacity-50" />
                <p className="text-lg font-medium">No workflow templates</p>
                <p className="text-sm">Create a template or seed defaults to get started</p>
              </div>
            )}
          </div>
        </div>
      )}

      {mainTab === 'templates' && selectedTemplate && (
        <div className="rounded-xl border border-gray-300 bg-white">
          <div className="flex items-center justify-between border-b border-gray-300 p-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedTemplate(null)}
                className="rounded p-2 text-gray-600 hover:bg-gray-100 hover:text-black transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
              <div>
                <h2 className="text-lg font-semibold text-black">{selectedTemplate.name}</h2>
                {selectedTemplate.description && (
                  <p className="text-sm text-gray-600">{selectedTemplate.description}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => { setEditingStep(null); setStepModalOpen(true); }}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-black hover:bg-primary-700"
            >
              <Plus size={16} />
              Add Step
            </button>
          </div>

          <div className="p-4">
            <div className="mb-4 flex flex-wrap gap-2">
              {selectedTemplate.doc_types?.map((docType) => {
                const style = getDocTypeStyle(docType);
                return (
                  <span
                    key={docType}
                    className={`rounded px-2 py-1 text-xs ${style.bgColor} ${style.color}`}
                  >
                    {style.label}
                  </span>
                );
              })}
            </div>

            <div className="mb-4 flex flex-wrap gap-4 text-sm text-gray-600">
              {selectedTemplate.allow_skip && (
                <span className="flex items-center gap-1">
                  <CheckCircle size={14} className="text-green-400" /> Allow Skip
                </span>
              )}
              {selectedTemplate.require_all_approvers && (
                <span className="flex items-center gap-1">
                  <Users size={14} className="text-blue-400" /> Require All Approvers
                </span>
              )}
              {selectedTemplate.auto_publish_on_complete && (
                <span className="flex items-center gap-1">
                  <CheckCircle size={14} className="text-purple-400" /> Auto-publish
                </span>
              )}
            </div>

            <h3 className="mb-3 text-sm font-medium text-gray-800">Workflow Steps</h3>

            {templateDetailLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
              </div>
            ) : templateDetail?.steps && templateDetail.steps.length > 0 ? (
              <div className="space-y-2">
                {[...templateDetail.steps]
                  .sort((a, b) => a.sequence - b.sequence)
                  .map((step, idx, arr) => (
                    <div
                      key={step.id}
                      className="flex items-center gap-3 rounded-lg border border-gray-300 bg-white/50 p-3"
                    >
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => handleMoveStep(step, 'up')}
                          disabled={idx === 0 || reorderStepsMutation.isPending}
                          className="rounded p-1 text-gray-600 hover:bg-gray-100 hover:text-black disabled:opacity-30 transition-colors"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => handleMoveStep(step, 'down')}
                          disabled={idx === arr.length - 1 || reorderStepsMutation.isPending}
                          className="rounded p-1 text-gray-600 hover:bg-gray-100 hover:text-black disabled:opacity-30 transition-colors"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                      
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-500/20 text-sm font-medium text-primary-400">
                        {step.sequence}
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-black">{step.name}</span>
                          <span className={`rounded px-2 py-0.5 text-xs ${
                            step.step_type === 'approval' ? 'bg-green-500/20 text-green-400' :
                            step.step_type === 'review' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {STEP_TYPES.find(t => t.value === step.step_type)?.label || step.step_type}
                          </span>
                          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-800">
                            {APPROVAL_MODES.find(m => m.value === step.approval_mode)?.label || step.approval_mode}
                          </span>
                          {step.timeout_days && (
                            <span className="text-xs text-gray-600">
                              {step.timeout_days} day timeout
                            </span>
                          )}
                        </div>
                        {step.approvers && step.approvers.length > 0 && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-gray-600">
                            <Users size={12} />
                            {step.approvers.length} approver{step.approvers.length !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { setEditingStep(step); setStepModalOpen(true); }}
                          className="rounded p-2 text-gray-600 hover:bg-gray-100 hover:text-black transition-colors"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this step?')) {
                              deleteStepMutation.mutate({ templateId: selectedTemplate.id, stepId: step.id });
                            }
                          }}
                          className="rounded p-2 text-gray-600 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-600">
                <p className="text-sm">No steps configured</p>
                <p className="text-xs">Click &ldquo;Add Step&rdquo; to create workflow steps</p>
              </div>
            )}
          </div>
        </div>
      )}

      <ApprovalModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState({ isOpen: false, stepId: null, title: '', actionType: 'approve' })}
        onConfirm={handleConfirmAction}
        title={modalState.title}
        actionType={modalState.actionType}
        isLoading={approveMutation.isPending || rejectMutation.isPending}
      />

      <TemplateModal
        isOpen={templateModalOpen}
        onClose={() => { setTemplateModalOpen(false); setEditingTemplate(null); }}
        onSubmit={handleTemplateSubmit}
        template={editingTemplate}
        isLoading={createTemplateMutation.isPending || updateTemplateMutation.isPending}
      />

      <StepModal
        isOpen={stepModalOpen}
        onClose={() => { setStepModalOpen(false); setEditingStep(null); }}
        onSubmit={handleStepSubmit}
        step={editingStep}
        nextSequence={(templateDetail?.steps?.length || 0) + 1}
        isLoading={createStepMutation.isPending || updateStepMutation.isPending}
      />
    </div>
  );
}

interface ApprovalCardProps {
  item: PendingApprovalItem;
  onApprove: (stepId: number, title: string) => void;
  onReject: (stepId: number, title: string) => void;
  isOverdue?: boolean;
}

function ApprovalCard({ item, onApprove, onReject, isOverdue }: ApprovalCardProps) {
  const docTypeStyle = getDocTypeStyle(item.doc_type);

  return (
    <div
      className={`rounded-lg border p-4 ${
        isOverdue
          ? 'border-red-500/50 bg-red-500/5'
          : 'border-gray-300 bg-white/50'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-gray-600" />
            <h4 className="font-medium text-black">{item.document_title}</h4>
            {item.document_code && (
              <span className="text-sm text-gray-600">({item.document_code})</span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-gray-600 sm:grid-cols-3">
            <span>
              <span className="font-medium text-black">Policy:</span> {item.document_title}
            </span>
            <span>
              <span className="font-medium text-black">Uploaded by:</span> {item.owner_name || 'Unknown'}
            </span>
            <span>
              <span className="font-medium text-black">Time:</span> {formatDateTime(item.requested_at)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <span className={`rounded px-2 py-0.5 ${docTypeStyle.bgColor} ${docTypeStyle.color}`}>
              {docTypeStyle.label}
            </span>
            <span className={isOverdue || item.is_overdue ? 'text-red-400' : 'text-gray-600'}>
              Due: {formatDate(item.due_date)}
              {(isOverdue || item.is_overdue) && item.days_overdue && (
                <span className="ml-1 font-medium">
                  ({item.days_overdue} day{item.days_overdue > 1 ? 's' : ''} overdue)
                </span>
              )}
            </span>
            <span className="text-gray-600">Step: {item.step_name}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => onReject(item.step_id, item.document_title)}
            className="rounded-lg border border-red-500/50 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10"
          >
            Reject
          </button>
          <button
            onClick={() => onApprove(item.step_id, item.document_title)}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-black hover:bg-green-700"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
