'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import {
  AlertTriangle,
  Search,
  Eye,
  Link2,
  Plus,
  Loader2,
  AlertCircle,
  Building2,
  Calendar,
  X,
  Shield,
  Target,
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

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!entityId) return;
    onConfirm(Number(entityId));
    setEntityId('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Link to {type === 'risk' ? 'Risk' : 'Control'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-300">
            {type === 'risk' ? 'Risk' : 'Internal Control'} ID <span className="text-red-400">*</span>
          </label>
          <input
            type="number"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder={`Enter ${type} ID...`}
            className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-slate-600 px-4 py-2 font-medium text-slate-300 hover:bg-slate-700"
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
      </div>
    </div>
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
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Create Mitigation Action</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-slate-400 mb-4">For finding: {findingTitle}</p>

        <div className="space-y-4 mb-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Action Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter action title..."
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the action..."
              className="h-24 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
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
            Create Action
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RCSAFindingsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [modalType, setModalType] = useState<'risk' | 'control' | 'action' | null>(null);
  const queryClient = useQueryClient();

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
        return [
          { id: 1, title: 'Inadequate Access Control Reviews', description: 'Access reviews not conducted quarterly', severity: 'high', status: 'open', assessment_id: 2, assessment_name: 'Q4 2025 RCSA - Finance', business_unit: 'Finance', created_at: '2025-01-18', due_date: '2025-02-28' },
          { id: 2, title: 'Missing Incident Response Documentation', description: 'IR procedures not documented', severity: 'critical', status: 'in_progress', assessment_id: 2, assessment_name: 'Q4 2025 RCSA - Finance', business_unit: 'Finance', created_at: '2025-01-18', due_date: '2025-02-15', linked_risk_id: 5 },
          { id: 3, title: 'Weak Password Policy Enforcement', description: 'Password complexity not enforced', severity: 'medium', status: 'remediated', assessment_id: 4, assessment_name: 'Annual IT Risk - IT Ops', business_unit: 'IT Operations', created_at: '2025-01-10', due_date: '2025-01-31', linked_control_id: 12 },
          { id: 4, title: 'Outdated Firewall Rules', description: 'Firewall rules not reviewed in 12 months', severity: 'high', status: 'open', assessment_id: 5, assessment_name: 'Annual IT Risk - Cybersecurity', business_unit: 'Cybersecurity', created_at: '2025-01-20', due_date: '2025-03-15' },
          { id: 5, title: 'Incomplete Business Continuity Plan', description: 'BCP missing critical scenarios', severity: 'medium', status: 'closed', assessment_id: 4, assessment_name: 'Annual IT Risk - IT Ops', business_unit: 'IT Operations', created_at: '2025-01-05', linked_risk_id: 3, linked_control_id: 8 },
        ] as Finding[];
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
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
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
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">RCSA Findings</h1>
            <p className="text-slate-400 mt-1">Track and manage findings from risk assessments</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search findings..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-10 w-full"
          />
        </div>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="input"
        >
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input"
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="remediated">Remediated</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/50">
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Title</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Severity</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Status</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Business Unit</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Created</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Due Date</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredFindings.map((finding) => {
              const severityStyle = getSeverityStyle(finding.severity);
              const statusStyle = getStatusStyle(finding.status);
              const isOverdue = finding.due_date && new Date(finding.due_date) < new Date() && finding.status !== 'closed';
              
              return (
                <tr key={finding.id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className={`h-4 w-4 ${severityStyle.text}`} />
                      <span className="text-white font-medium">{finding.title}</span>
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
                    <div className="flex items-center gap-2 text-slate-300">
                      <Building2 className="h-4 w-4 text-slate-500" />
                      {finding.business_unit}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-300">
                    {formatDate(finding.created_at)}
                  </td>
                  <td className="py-3 px-4">
                    <div className={`flex items-center gap-2 ${isOverdue ? 'text-red-400' : 'text-slate-300'}`}>
                      <Calendar className="h-4 w-4" />
                      {formatDate(finding.due_date)}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/risks/rcsa/findings/${finding.id}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
                        title="View Details"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={() => { setSelectedFinding(finding); setModalType('risk'); }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-purple-400 hover:bg-purple-500/20"
                        title="Link to Risk"
                      >
                        <Target className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { setSelectedFinding(finding); setModalType('control'); }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-500/20"
                        title="Link to Control"
                      >
                        <Shield className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { setSelectedFinding(finding); setModalType('action'); }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-green-400 hover:bg-green-500/20"
                        title="Create Action"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
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
            <h3 className="text-lg font-medium text-white mb-2">No Findings Found</h3>
            <p className="text-slate-400">
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
