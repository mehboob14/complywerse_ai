'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import { WorkflowDashboard, PendingApprovalItem } from '@/types';
import {
  FileCheck,
  Loader2,
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  X,
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

const DOC_TYPE_STYLES: Record<string, { label: string; style: { color: string; backgroundColor: string } }> = {
  policy: { label: 'Policy', style: { color: 'var(--color-base)', backgroundColor: 'rgba(28, 43, 58, 0.08)' } },
  procedure: { label: 'Procedure', style: { color: 'var(--color-success)', backgroundColor: 'rgba(45, 106, 79, 0.1)' } },
  standard: { label: 'Standard', style: { color: 'var(--color-base)', backgroundColor: 'rgba(28, 43, 58, 0.06)' } },
  guideline: { label: 'Guideline', style: { color: 'var(--color-warning)', backgroundColor: 'rgba(146, 87, 14, 0.1)' } },
  template: { label: 'Template', style: { color: 'var(--color-base)', backgroundColor: 'rgba(28, 43, 58, 0.08)' } },
  other: { label: 'Other', style: { color: 'var(--color-muted)', backgroundColor: 'var(--color-subtle)' } },
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

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (actionType === 'reject' && !comments.trim()) {
      return;
    }
    onConfirm(comments);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl p-6" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            {actionType === 'approve' ? 'Approve Document' : 'Reject Document'}
          </h3>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <p className="mb-4 text-sm" style={{ color: 'var(--color-text)' }}>
          {actionType === 'approve'
            ? `You are about to approve "${title}".`
            : `You are about to reject "${title}". Please provide a reason.`}
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Comments {actionType === 'reject' && <span style={{ color: 'var(--color-danger)' }}>*</span>}
          </label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder={actionType === 'approve' ? 'Optional comments...' : 'Reason for rejection...'}
            className="h-24 w-full rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
            style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
          {actionType === 'reject' && !comments.trim() && (
            <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>Comments are required when rejecting</p>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg px-4 py-2 font-medium disabled:opacity-50"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || (actionType === 'reject' && !comments.trim())}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium text-white disabled:opacity-50 ${
              actionType === 'approve'
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {isLoading && <Loader2 size={16} className="animate-spin" />}
            {actionType === 'approve' ? 'Approve' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
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

  if (!isOpen) return null;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl p-6 max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            {template ? 'Edit Template' : 'New Workflow Template'}
          </h3>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Name <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              required
              className="w-full rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
              style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="e.g., Policy Approval Workflow"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="h-20 w-full rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
              style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="Describe the workflow template..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>Document Types</label>
            <div className="flex flex-wrap gap-2">
              {DOC_TYPES_OPTIONS.map(option => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                    formData.doc_types.includes(option.value)
                      ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                      : ''
                  }`}
                  style={!formData.doc_types.includes(option.value) ? { backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' } : { border: '1px solid var(--color-border)' }}
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

          <div className="space-y-3 rounded-lg p-4" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
            <h4 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Settings</h4>
            
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.allow_skip}
                onChange={(e) => setFormData(prev => ({ ...prev, allow_skip: e.target.checked }))}
                className="h-4 w-4 rounded text-primary-500 focus:ring-primary-500"
              />
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>Allow steps to be skipped</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.require_all_approvers}
                onChange={(e) => setFormData(prev => ({ ...prev, require_all_approvers: e.target.checked }))}
                className="h-4 w-4 rounded text-primary-500 focus:ring-primary-500"
              />
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>Require all approvers</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.auto_publish_on_complete}
                onChange={(e) => setFormData(prev => ({ ...prev, auto_publish_on_complete: e.target.checked }))}
                className="h-4 w-4 rounded text-primary-500 focus:ring-primary-500"
              />
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>Auto-publish on workflow completion</span>
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="rounded-lg px-4 py-2 font-medium disabled:opacity-50"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !formData.name.trim()}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isLoading && <Loader2 size={16} className="animate-spin" />}
              {template ? 'Save Changes' : 'Create Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
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

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl p-6" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            {step ? 'Edit Step' : 'Add Workflow Step'}
          </h3>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Step Name <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              required
              className="w-full rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
              style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="e.g., Manager Review"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>Step Type</label>
            <select
              value={formData.step_type}
              onChange={(e) => setFormData(prev => ({ ...prev, step_type: e.target.value }))}
              className="w-full rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
              style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              {STEP_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>Approval Mode</label>
            <select
              value={formData.approval_mode}
              onChange={(e) => setFormData(prev => ({ ...prev, approval_mode: e.target.value }))}
              className="w-full rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
              style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              {APPROVAL_MODES.map(mode => (
                <option key={mode.value} value={mode.value}>{mode.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>Timeout (days)</label>
            <input
              type="number"
              value={formData.timeout_days ?? ''}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                timeout_days: e.target.value ? parseInt(e.target.value) : null 
              }))}
              min="1"
              className="w-full rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
              style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="Optional timeout in days"
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.is_required}
              onChange={(e) => setFormData(prev => ({ ...prev, is_required: e.target.checked }))}
              className="h-4 w-4 rounded text-primary-500 focus:ring-primary-500"
            />
            <span className="text-sm" style={{ color: 'var(--color-text)' }}>This step is required</span>
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="rounded-lg px-4 py-2 font-medium disabled:opacity-50"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !formData.name.trim()}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isLoading && <Loader2 size={16} className="animate-spin" />}
              {step ? 'Save Changes' : 'Add Step'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function GovernanceWorkflowsPage() {
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
    queryFn: async () => {
      const response = await governanceApi.getPendingApprovals();
      return response.data as { items: PendingApprovalItem[]; total: number };
    },
  });

  const { data: overdueData } = useQuery({
    queryKey: ['overdue-approvals'],
    queryFn: async () => {
      const response = await governanceApi.getOverdueApprovals();
      return response.data as { items: PendingApprovalItem[]; total: number };
    },
  });

  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['workflow-templates'],
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
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Approval Workflows</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
            Manage document approvals, workflow templates, and review pending requests
          </p>
        </div>
      </div>

      <div className="flex gap-2 pb-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <button
          onClick={() => { setMainTab('approvals'); setSelectedTemplate(null); }}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            mainTab === 'approvals'
              ? 'bg-primary-600 text-white'
              : ''
          }`}
          style={mainTab !== 'approvals' ? { color: 'var(--color-muted)' } : undefined}
        >
          <FileCheck size={18} />
          Approvals
        </button>
        <button
          onClick={() => setMainTab('templates')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            mainTab === 'templates'
              ? 'bg-primary-600 text-white'
              : ''
          }`}
          style={mainTab !== 'templates' ? { color: 'var(--color-muted)' } : undefined}
        >
          <Settings size={18} />
          Workflow Templates
        </button>
      </div>

      {mainTab === 'approvals' && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-3">
                <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(146, 87, 14, 0.1)' }}>
                  <Clock className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
                </div>
                <div>
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Pending Approvals</p>
                  <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{dashboard?.pending_my_approval || 0}</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-3">
                <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(45, 106, 79, 0.1)' }}>
                  <CheckCircle className="h-5 w-5" style={{ color: 'var(--color-success)' }} />
                </div>
                <div>
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Approved Today</p>
                  <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{dashboard?.approved_today || 0}</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-3">
                <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(155, 28, 28, 0.1)' }}>
                  <XCircle className="h-5 w-5" style={{ color: 'var(--color-danger)' }} />
                </div>
                <div>
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Rejected Today</p>
                  <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{dashboard?.rejected_today || 0}</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-3">
                <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(146, 87, 14, 0.1)' }}>
                  <AlertTriangle className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
                </div>
                <div>
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Overdue</p>
                  <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{dashboard?.overdue || 0}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div style={{ borderBottom: '1px solid var(--color-border)' }}>
              <nav className="flex gap-1 p-2">
                {(['pending', 'approved', 'rejected', 'all'] as ApprovalTabType[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      activeTab === tab
                        ? 'bg-primary-600 text-white'
                        : ''
                    }`}
                    style={activeTab !== tab ? { color: 'var(--color-muted)' } : undefined}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {tab === 'pending' && pendingApprovals.length > 0 && (
                      <span className="ml-2 rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)' }}>
                        {pendingApprovals.length}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            </div>

            <div className="p-4">
              {activeTab === 'approved' || activeTab === 'rejected' ? (
                <div className="flex h-48 flex-col items-center justify-center" style={{ color: 'var(--color-muted)' }}>
                  <FileCheck className="mb-2 h-12 w-12 opacity-50" />
                  <p className="text-lg font-medium">No {activeTab} items to display</p>
                  <p className="text-sm">Historical {activeTab} approvals will appear here</p>
                </div>
              ) : (
                <>
                  {activeTab === 'pending' && overdueApprovals.length > 0 && (
                    <div className="mb-4">
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-danger)' }}>
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
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-muted)' }}>
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
                      <div className="flex h-48 flex-col items-center justify-center" style={{ color: 'var(--color-muted)' }}>
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
        <div className="rounded-xl" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Workflow Templates</h2>
            <div className="flex gap-2">
              <button
                onClick={() => seedDefaultsMutation.mutate()}
                disabled={seedDefaultsMutation.isPending}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-base)' }}
              >
                {seedDefaultsMutation.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Wand2 size={16} />
                )}
                Seed Defaults
              </button>
              <button
                onClick={() => { setEditingTemplate(null); setTemplateModalOpen(true); }}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                <Plus size={16} />
                New Template
              </button>
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
                    className="flex items-center justify-between rounded-lg p-4 transition-colors"
                    style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}
                  >
                    <div className="flex-1 cursor-pointer" onClick={() => setSelectedTemplate(template)}>
                      <div className="flex items-center gap-3">
                        <Layers className="h-5 w-5 text-primary-400" />
                        <div>
                          <h3 className="font-medium" style={{ color: 'var(--color-text)' }}>{template.name}</h3>
                          {template.description && (
                            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{template.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {template.doc_types?.map((docType) => {
                          const style = getDocTypeStyle(docType);
                          return (
                            <span
                              key={docType}
                              className="rounded px-2 py-0.5 text-xs"
                            style={style.style}
                            >
                              {style.label}
                            </span>
                          );
                        })}
                        {template.is_default && (
                          <span className="rounded px-2 py-0.5 text-xs" style={{ backgroundColor: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)' }}>
                            Default
                          </span>
                        )}
                        {!template.is_active && (
                          <span className="rounded px-2 py-0.5 text-xs" style={{ backgroundColor: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)' }}>
                            Inactive
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingTemplate(template); setTemplateModalOpen(true); }}
                        className="rounded p-2 transition-colors"
                        style={{ color: 'var(--color-muted)' }}
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
                        className="rounded p-2 transition-colors"
                        style={{ color: 'var(--color-muted)' }}
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center" style={{ color: 'var(--color-muted)' }}>
                <Layers className="mb-2 h-12 w-12 opacity-50" />
                <p className="text-lg font-medium">No workflow templates</p>
                <p className="text-sm">Create a template or seed defaults to get started</p>
              </div>
            )}
          </div>
        </div>
      )}

      {mainTab === 'templates' && selectedTemplate && (
        <div className="rounded-xl" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedTemplate(null)}
                className="rounded p-2 transition-colors"
                style={{ color: 'var(--color-muted)' }}
              >
                <ArrowLeft size={20} />
              </button>
              <div>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{selectedTemplate.name}</h2>
                {selectedTemplate.description && (
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{selectedTemplate.description}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => { setEditingStep(null); setStepModalOpen(true); }}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
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
                    className="rounded px-2 py-1 text-xs"
                    style={style.style}
                  >
                    {style.label}
                  </span>
                );
              })}
            </div>

            <div className="mb-4 flex flex-wrap gap-4 text-sm" style={{ color: 'var(--color-muted)' }}>
              {selectedTemplate.allow_skip && (
                <span className="flex items-center gap-1">
                  <CheckCircle size={14} style={{ color: 'var(--color-success)' }} /> Allow Skip
                </span>
              )}
              {selectedTemplate.require_all_approvers && (
                <span className="flex items-center gap-1">
                  <Users size={14} style={{ color: 'var(--color-base)' }} /> Require All Approvers
                </span>
              )}
              {selectedTemplate.auto_publish_on_complete && (
                <span className="flex items-center gap-1">
                  <CheckCircle size={14} style={{ color: 'var(--color-base)' }} /> Auto-publish
                </span>
              )}
            </div>

            <h3 className="mb-3 text-sm font-medium" style={{ color: 'var(--color-text)' }}>Workflow Steps</h3>

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
                      className="flex items-center gap-3 rounded-lg p-3"
                      style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}
                    >
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => handleMoveStep(step, 'up')}
                          disabled={idx === 0 || reorderStepsMutation.isPending}
                          className="rounded p-1 disabled:opacity-30 transition-colors"
                          style={{ color: 'var(--color-muted)' }}
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => handleMoveStep(step, 'down')}
                          disabled={idx === arr.length - 1 || reorderStepsMutation.isPending}
                          className="rounded p-1 disabled:opacity-30 transition-colors"
                          style={{ color: 'var(--color-muted)' }}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                      
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-500/20 text-sm font-medium text-primary-400">
                        {step.sequence}
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium" style={{ color: 'var(--color-text)' }}>{step.name}</span>
                          <span className="rounded px-2 py-0.5 text-xs" style={
                            step.step_type === 'approval' ? { backgroundColor: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)' } :
                            step.step_type === 'review' ? { backgroundColor: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' } :
                            { backgroundColor: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)' }
                          }>
                            {STEP_TYPES.find(t => t.value === step.step_type)?.label || step.step_type}
                          </span>
                          <span className="rounded px-2 py-0.5 text-xs" style={{ backgroundColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                            {APPROVAL_MODES.find(m => m.value === step.approval_mode)?.label || step.approval_mode}
                          </span>
                          {step.timeout_days && (
                            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                              {step.timeout_days} day timeout
                            </span>
                          )}
                        </div>
                        {step.approvers && step.approvers.length > 0 && (
                          <div className="mt-1 flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                            <Users size={12} />
                            {step.approvers.length} approver{step.approvers.length !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { setEditingStep(step); setStepModalOpen(true); }}
                          className="rounded p-2 transition-colors"
                          style={{ color: 'var(--color-muted)' }}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this step?')) {
                              deleteStepMutation.mutate({ templateId: selectedTemplate.id, stepId: step.id });
                            }
                          }}
                          className="rounded p-2 transition-colors"
                          style={{ color: 'var(--color-muted)' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="flex h-32 flex-col items-center justify-center rounded-lg" style={{ border: '1px dashed var(--color-border)', color: 'var(--color-muted)' }}>
                <p className="text-sm">No steps configured</p>
                <p className="text-xs">Click "Add Step" to create workflow steps</p>
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
      className="rounded-lg p-4"
      style={{
        backgroundColor: isOverdue ? 'rgba(155, 28, 28, 0.03)' : 'var(--color-subtle)',
        border: isOverdue ? '1px solid rgba(155, 28, 28, 0.3)' : '1px solid var(--color-border)',
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4" style={{ color: 'var(--color-muted)' }} />
            <h4 className="font-medium" style={{ color: 'var(--color-text)' }}>{item.document_title}</h4>
            {item.document_code && (
              <span className="text-sm" style={{ color: 'var(--color-muted)' }}>({item.document_code})</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded px-2 py-0.5" style={docTypeStyle.style}>
              {docTypeStyle.label}
            </span>
            <span style={{ color: 'var(--color-muted)' }}>
              Requested: {formatDateTime(item.requested_at)}
            </span>
            <span style={{ color: isOverdue || item.is_overdue ? 'var(--color-danger)' : 'var(--color-muted)' }}>
              Due: {formatDate(item.due_date)}
              {(isOverdue || item.is_overdue) && item.days_overdue && (
                <span className="ml-1 font-medium">
                  ({item.days_overdue} day{item.days_overdue > 1 ? 's' : ''} overdue)
                </span>
              )}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3 text-sm" style={{ color: 'var(--color-muted)' }}>
            <span>Requester: {item.owner_name || 'Unknown'}</span>
            <span>•</span>
            <span>Step: {item.step_name}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => onReject(item.step_id, item.document_title)}
            className="rounded-lg px-4 py-2 text-sm font-medium"
            style={{ border: '1px solid rgba(155, 28, 28, 0.3)', color: 'var(--color-danger)' }}
          >
            Reject
          </button>
          <button
            onClick={() => onApprove(item.step_id, item.document_title)}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
