'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  AlertTriangle,
  Eye,
  Plus,
  Loader2,
  AlertCircle,
  Building2,
  Calendar,
  Shield,
  Target,
} from 'lucide-react';
import Link from 'next/link';
import { SearchInput } from '@/components/ui/SearchInput';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { PageLoader } from '@/components/ui';

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
  due_date?: string;
  linked_risk_id?: number;
  linked_control_id?: number;
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Critical' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'High' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Medium' },
  low: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Low' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Open' },
  in_progress: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'In Progress' },
  remediated: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Remediated' },
  closed: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Closed' },
};

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

  const handleSubmit = () => {
    if (!entityId) return;
    onConfirm(Number(entityId));
    setEntityId('');
  };

  return (
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title={`Link to ${type === 'risk' ? 'Risk' : 'Control'}`}
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
            disabled={isLoading || !entityId}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
          >
            {isLoading && <Loader2 size={16} className="animate-spin" />}
            Link
          </button>
        </div>
      }
    >
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          {type === 'risk' ? 'Risk' : 'Internal Control'} ID <span className="text-red-500">*</span>
        </label>
        <input
          type="number"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          placeholder={`Enter ${type} ID...`}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>
    </RightSlidePanel>
  );
}

interface CreateActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: Record<string, unknown>) => void;
  findingTitle: string;
  isLoading: boolean;
}

function CreateActionModal({ isOpen, onClose, onConfirm, findingTitle, isLoading }: CreateActionModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');

  const handleSubmit = () => {
    if (!title) return;
    onConfirm({ title, description, due_date: dueDate || undefined });
    setTitle('');
    setDescription('');
    setDueDate('');
  };

  return (
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="Create Mitigation Action"
      subtitle={`For finding: ${findingTitle}`}
      footer={
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
            Create Action
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Action Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter action title..."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the action..."
            className="h-32 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Due Date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>
    </RightSlidePanel>
  );
}

export default function RCSAFindingsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [modalType, setModalType] = useState<'risk' | 'control' | 'action' | null>(null);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('risks:rcsa:create');

  const { data: findings, isLoading, error } = useQuery({
    queryKey: ['rcsa-findings', severityFilter, statusFilter],
    queryFn: async () => {
      try {
        const params: Record<string, unknown> = {};
        if (severityFilter) params.severity = severityFilter;
        if (statusFilter) params.status = statusFilter;
        const response = await rcsaApi.getFindings(params);
        return response.data as Finding[];
      } catch {
        return [] as Finding[];
      }
    },
  });

  const linkRiskMutation = useMutation({
    mutationFn: ({ findingId, riskId }: { findingId: number; riskId: number }) => 
      rcsaApi.linkFindingToRisk(findingId, { risk_id: riskId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-findings'] });
      setModalType(null);
      setSelectedFinding(null);
    },
  });

  const linkControlMutation = useMutation({
    mutationFn: ({ findingId, controlId }: { findingId: number; controlId: number }) => 
      rcsaApi.linkFindingToControl(findingId, { control_id: controlId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-findings'] });
      setModalType(null);
      setSelectedFinding(null);
    },
  });

  const createActionMutation = useMutation({
    mutationFn: ({ findingId, data }: { findingId: number; data: Record<string, unknown> }) => 
      rcsaApi.createFindingAction(findingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-findings'] });
      setModalType(null);
      setSelectedFinding(null);
    },
  });

  const filteredFindings = useMemo(() => {
    if (!findings) return [];
    return findings.filter(finding => {
      const matchesSearch = !searchTerm || 
        finding.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        finding.business_unit.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });
  }, [findings, searchTerm]);

  const handleLinkConfirm = (id: number) => {
    if (!selectedFinding) return;
    if (modalType === 'risk') {
      linkRiskMutation.mutate({ findingId: selectedFinding.id, riskId: id });
    } else if (modalType === 'control') {
      linkControlMutation.mutate({ findingId: selectedFinding.id, controlId: id });
    }
  };

  const handleCreateAction = (data: Record<string, unknown>) => {
    if (!selectedFinding) return;
    createActionMutation.mutate({ findingId: selectedFinding.id, data });
  };

  if (isLoading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
        <p className="mt-2 text-red-400">Failed to load findings</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900">RCSA Findings</h1>
            <p className="text-slate-600 mt-1 text-sm">Track and manage findings from risk assessments</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-md">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search findings..."
          />
        </div>
        <MultiSelectDropdown
          title="Severity"
          items={[
            { value: 'critical', label: 'Critical' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
          ]}
          selectedValues={severityFilter ? [severityFilter] : []}
          onApply={(vals) => setSeverityFilter(vals[0] || '')}
          multiSelect={false}
        />
        <MultiSelectDropdown
          title="Status"
          items={[
            { value: 'open', label: 'Open' },
            { value: 'in_progress', label: 'In Progress' },
            { value: 'remediated', label: 'Remediated' },
            { value: 'closed', label: 'Closed' },
          ]}
          selectedValues={statusFilter ? [statusFilter] : []}
          onApply={(vals) => setStatusFilter(vals[0] || '')}
          multiSelect={false}
        />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-white/50">
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Title</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Severity</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Status</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Business Unit</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Created</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Due Date</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredFindings.map((finding) => {
              const severityStyle = getSeverityStyle(finding.severity);
              const statusStyle = getStatusStyle(finding.status);
              const isOverdue = finding.due_date && new Date(finding.due_date) < new Date() && finding.status !== 'closed';
              
              return (
                <tr key={finding.id} className="border-b border-slate-200/50 hover:bg-white/50">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className={`h-4 w-4 ${severityStyle.text}`} />
                      <span className="text-slate-900 font-medium">{finding.title}</span>
                    </div>
                    {(finding.linked_risk_id || finding.linked_control_id) && (
                      <div className="flex items-center gap-2 mt-1">
                        {finding.linked_risk_id && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 flex items-center gap-1">
                            <Target className="h-3 w-3" />
                            Risk #{finding.linked_risk_id}
                          </span>
                        )}
                        {finding.linked_control_id && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 flex items-center gap-1">
                            <Shield className="h-3 w-3" />
                            Control #{finding.linked_control_id}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${severityStyle.bg} ${severityStyle.text}`}>
                      {severityStyle.label}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                      {statusStyle.label}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2 text-slate-700">
                      <Building2 className="h-4 w-4 text-slate-500" />
                      {finding.business_unit}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-700">
                    {formatDate(finding.created_at)}
                  </td>
                  <td className="py-3 px-4">
                    <div className={`flex items-center gap-2 ${isOverdue ? 'text-red-400' : 'text-slate-700'}`}>
                      <Calendar className="h-4 w-4" />
                      {formatDate(finding.due_date)}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/risks/rcsa/findings/${finding.id}`}
                        className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                        title="View Details"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={() => { setSelectedFinding(finding); setModalType('risk'); }}
                        className="p-1.5 rounded-lg text-slate-600 hover:text-purple-400 hover:bg-purple-500/20"
                        title="Link to Risk"
                      >
                        <Target className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { setSelectedFinding(finding); setModalType('control'); }}
                        className="p-1.5 rounded-lg text-slate-600 hover:text-blue-400 hover:bg-blue-500/20"
                        title="Link to Control"
                      >
                        <Shield className="h-4 w-4" />
                      </button>
                      {canCreate && <button
                        onClick={() => { setSelectedFinding(finding); setModalType('action'); }}
                        className="p-1.5 rounded-lg text-slate-600 hover:text-green-400 hover:bg-green-500/20"
                        title="Create Action"
                      >
                        <Plus className="h-4 w-4" />
                      </button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredFindings.length === 0 && (
          <div className="p-12 text-center">
            <AlertTriangle className="h-12 w-12 text-slate-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">No Findings Found</h3>
            <p className="text-slate-600">
              {searchTerm || severityFilter || statusFilter
                ? 'No findings match your filters'
                : 'No findings have been identified yet'}
            </p>
          </div>
        )}
      </div>

      {modalType && modalType !== 'action' && (
        <LinkModal
          isOpen={true}
          onClose={() => { setModalType(null); setSelectedFinding(null); }}
          onConfirm={handleLinkConfirm}
          type={modalType}
          isLoading={linkRiskMutation.isPending || linkControlMutation.isPending}
        />
      )}

      {modalType === 'action' && selectedFinding && (
        <CreateActionModal
          isOpen={true}
          onClose={() => { setModalType(null); setSelectedFinding(null); }}
          onConfirm={handleCreateAction}
          findingTitle={selectedFinding.title}
          isLoading={createActionMutation.isPending}
        />
      )}
    </div>
  );
}
