'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';
import {
  Bug,
  Loader2,
  Search,
  Plus,
  X,
  AlertCircle,
  Calendar,
  User,
  ExternalLink,
  Building2,
  CheckSquare,
} from 'lucide-react';
import Link from 'next/link';

interface Department {
  id: number;
  name: string;
  code?: string;
}

interface Vulnerability {
  id: number;
  title: string;
  description?: string;
  severity: string;
  status: string;
  cve_id?: string;
  cwe_id?: string;
  cvss_score?: number;
  affected_component?: string;
  affected_host?: string;
  due_date?: string;
  assigned_to?: number;
  assigned_user_name?: string;
  report_id?: number;
  report_name?: string;
  created_at: string;
}

interface DashboardData {
  total: number;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  sla_compliance_percent: number;
  mttr_days?: number;
  aging_buckets?: {
    '0-7': number;
    '8-30': number;
    '31-90': number;
    '90+': number;
  };
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-50', text: 'text-red-600', label: 'Critical' },
  high: { bg: 'bg-orange-50', text: 'text-orange-600', label: 'High' },
  medium: { bg: 'bg-yellow-50', text: 'text-yellow-600', label: 'Medium' },
  low: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'Low' },
  info: { bg: 'bg-slate-50', text: 'text-slate-600', label: 'Info' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-red-50', text: 'text-red-600', label: 'Open' },
  in_progress: { bg: 'bg-yellow-50', text: 'text-yellow-600', label: 'In Progress' },
  remediated: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'Remediated' },
  verified: { bg: 'bg-green-50', text: 'text-green-600', label: 'Verified' },
  closed: { bg: 'bg-slate-50', text: 'text-slate-600', label: 'Closed' },
  accepted: { bg: 'bg-primary-50', text: 'text-primary-600', label: 'Risk Accepted' },
  false_positive: { bg: 'bg-slate-50', text: 'text-slate-600', label: 'False Positive' },
};

function getSeverityStyle(severity: string) {
  return SEVERITY_STYLES[severity?.toLowerCase()] || SEVERITY_STYLES.info;
}

function getStatusStyle(status: string) {
  return STATUS_STYLES[status?.toLowerCase()] || STATUS_STYLES.open;
}

export default function VulnerabilitiesPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false);
  const [selectedVulnIds, setSelectedVulnIds] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();

  const { data: vulnerabilities, isLoading, error } = useQuery({
    queryKey: ['vulnerabilities', statusFilter, severityFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (severityFilter !== 'all') params.severity = severityFilter;
      const response = await vulnManagementApi.vulnerabilities.getAll(params as { status?: string; severity?: string });
      return response.data as Vulnerability[];
    },
  });

  const { data: dashboard } = useQuery({
    queryKey: ['vuln-dashboard'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.get();
      return response.data as DashboardData;
    },
  });

  const { data: departments } = useQuery({
    queryKey: ['all-departments'],
    queryFn: async () => {
      const response = await vulnManagementApi.departments.getAll();
      return response.data as Department[];
    },
    enabled: showBulkAssignModal,
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => vulnManagementApi.vulnerabilities.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
      queryClient.invalidateQueries({ queryKey: ['vuln-dashboard'] });
      setIsModalOpen(false);
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: (data: { vulnerability_ids: number[]; department_id: number; priority?: string; notes?: string }) => 
      vulnManagementApi.departments.bulkAssign(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
      setShowBulkAssignModal(false);
      setSelectedVulnIds(new Set());
    },
  });

  const handleSelectVuln = (id: number) => {
    const newSelected = new Set(selectedVulnIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedVulnIds(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedVulnIds.size === filteredVulnerabilities.length) {
      setSelectedVulnIds(new Set());
    } else {
      setSelectedVulnIds(new Set(filteredVulnerabilities.map(v => v.id)));
    }
  };

  const filteredVulnerabilities = useMemo(() => {
    if (!vulnerabilities) return [];
    return vulnerabilities.filter((vuln) => {
      const matchesSearch =
        !searchTerm ||
        vuln.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        vuln.cve_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        vuln.cwe_id?.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });
  }, [vulnerabilities, searchTerm]);

  const handleSubmit = (formData: FormData) => {
    const data: Record<string, unknown> = {
      title: formData.get('title'),
      description: formData.get('description') || undefined,
      severity: formData.get('severity'),
      cve_id: formData.get('cve_id') || undefined,
      cwe_id: formData.get('cwe_id') || undefined,
      cvss_score: formData.get('cvss_score') ? parseFloat(formData.get('cvss_score') as string) : undefined,
      affected_component: formData.get('affected_component') || undefined,
      affected_host: formData.get('affected_host') || undefined,
      due_date: formData.get('due_date') || undefined,
    };
    createMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-600" />
        <p className="mt-2 text-red-600">Failed to load vulnerabilities</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <Bug className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-sm text-slate-600">Total</p>
              <p className="text-2xl font-bold text-black">{dashboard?.total || 0}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <AlertCircle className="h-5 w-5 text-red-600" />
            <div>
              <p className="text-sm text-slate-600">Critical</p>
              <p className="text-2xl font-bold text-red-600">{dashboard?.by_severity?.critical || 0}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <AlertCircle className="h-5 w-5 text-orange-600" />
            <div>
              <p className="text-sm text-slate-600">High</p>
              <p className="text-2xl font-bold text-orange-600">{dashboard?.by_severity?.high || 0}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <AlertCircle className="h-5 w-5 text-yellow-600" />
            <div>
              <p className="text-sm text-slate-600">Medium</p>
              <p className="text-2xl font-bold text-yellow-600">{dashboard?.by_severity?.medium || 0}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <Bug className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-sm text-slate-600">SLA Compliance</p>
              <p className="text-2xl font-bold text-green-600">{dashboard?.sla_compliance_percent || 0}%</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-black">Vulnerability Register</h1>
          <p className="mt-1 text-slate-600">Track and manage security vulnerabilities</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedVulnIds.size > 0 && (
            <button
              onClick={() => setShowBulkAssignModal(true)}
              className="btn-secondary flex items-center gap-2"
            >
              <Building2 size={16} />
              Assign to Department ({selectedVulnIds.size})
            </button>
          )}
          <button
            onClick={() => setIsModalOpen(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={18} />
            Add Vulnerability
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
          <input
            type="text"
            placeholder="Search by title, CVE, CWE..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-field w-full pl-10"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-field min-w-36"
        >
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="remediated">Remediated</option>
          <option value="verified">Verified</option>
          <option value="closed">Closed</option>
          <option value="accepted">Risk Accepted</option>
        </select>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="input-field min-w-36"
        >
          <option value="all">All Severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50/50">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={filteredVulnerabilities.length > 0 && selectedVulnIds.size === filteredVulnerabilities.length}
                  onChange={handleSelectAll}
                  className="rounded border-slate-300 bg-slate-200 text-primary-500 focus:ring-primary-500"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">ID</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Title</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Severity</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">CVE/CWE</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Due Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Assigned To</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {filteredVulnerabilities.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-600">
                  No vulnerabilities found
                </td>
              </tr>
            ) : (
              filteredVulnerabilities.map((vuln) => {
                const severityStyle = getSeverityStyle(vuln.severity);
                const statusStyle = getStatusStyle(vuln.status);
                return (
                  <tr key={vuln.id} className={`hover:bg-slate-50 transition-colors ${selectedVulnIds.has(vuln.id) ? 'bg-primary-50' : ''}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedVulnIds.has(vuln.id)}
                        onChange={() => handleSelectVuln(vuln.id)}
                        className="rounded border-slate-300 bg-slate-200 text-primary-500 focus:ring-primary-500"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-slate-600">VULN-{vuln.id}</td>
                    <td className="px-4 py-3">
                      <Link href={`/vulnerabilities/${vuln.id}`} className="text-black hover:text-primary-600 font-medium">
                        {vuln.title}
                      </Link>
                      {vuln.affected_component && (
                        <p className="text-xs text-slate-600 mt-0.5">{vuln.affected_component}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${severityStyle.bg} ${severityStyle.text}`}>
                        {severityStyle.label}
                        {vuln.cvss_score && <span className="ml-1">({vuln.cvss_score})</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                        {statusStyle.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">
                        {vuln.cve_id && <span className="text-slate-600">{vuln.cve_id}</span>}
                        {vuln.cve_id && vuln.cwe_id && <span className="text-slate-500"> / </span>}
                        {vuln.cwe_id && <span className="text-slate-600">{vuln.cwe_id}</span>}
                        {!vuln.cve_id && !vuln.cwe_id && <span className="text-slate-500">-</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {vuln.due_date ? (
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <Calendar size={14} className="text-slate-600" />
                          {new Date(vuln.due_date).toLocaleDateString()}
                        </div>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {vuln.assigned_user_name ? (
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <User size={14} className="text-slate-600" />
                          {vuln.assigned_user_name}
                        </div>
                      ) : (
                        <span className="text-slate-500">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/vulnerabilities/${vuln.id}`} className="text-slate-600 hover:text-primary-600">
                        <ExternalLink size={16} />
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">Add Vulnerability</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit(new FormData(e.currentTarget));
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Title *</label>
                <input type="text" name="title" required className="input-field w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Description</label>
                <textarea name="description" rows={3} className="input-field w-full" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Severity *</label>
                  <select name="severity" required className="input-field w-full">
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="info">Info</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">CVSS Score</label>
                  <input type="number" name="cvss_score" step="0.1" min="0" max="10" className="input-field w-full" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">CVE ID</label>
                  <input type="text" name="cve_id" placeholder="CVE-2024-XXXX" className="input-field w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">CWE ID</label>
                  <input type="text" name="cwe_id" placeholder="CWE-XXX" className="input-field w-full" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Affected Component</label>
                  <input type="text" name="affected_component" className="input-field w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Affected Host</label>
                  <input type="text" name="affected_host" className="input-field w-full" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Due Date</label>
                <input type="date" name="due_date" className="input-field w-full" />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBulkAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">Bulk Assign to Department</h2>
              <button onClick={() => setShowBulkAssignModal(false)} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              Assign {selectedVulnIds.size} selected vulnerabilities to a department
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                bulkAssignMutation.mutate({
                  vulnerability_ids: Array.from(selectedVulnIds),
                  department_id: parseInt(formData.get('department_id') as string),
                  priority: formData.get('priority') as string || 'medium',
                  notes: formData.get('notes') as string || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Department *</label>
                <select name="department_id" required className="input-field w-full">
                  <option value="">Select a department</option>
                  {departments?.map((dept) => (
                    <option key={dept.id} value={dept.id}>{dept.name} {dept.code && `(${dept.code})`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Priority</label>
                <select name="priority" className="input-field w-full" defaultValue="medium">
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Notes</label>
                <textarea name="notes" rows={2} className="input-field w-full" placeholder="Optional notes for the assignment..." />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowBulkAssignModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={bulkAssignMutation.isPending} className="btn-primary flex items-center gap-2">
                  <CheckSquare size={16} />
                  {bulkAssignMutation.isPending ? 'Assigning...' : 'Assign All'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
