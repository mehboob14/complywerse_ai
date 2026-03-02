'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
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
  TrendingUp,
  Shield,
  Clock,
  Target,
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
  assignee_name?: string;  // Changed from assigned_user_name to match backend
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
  const { hasPermission } = usePermissions();
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
    <div className="min-h-screen bg-[var(--color-bg)]">
      {/* Header Section */}
      <div className="border-b border-[var(--color-border)]">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold cw-text tracking-tight">Vulnerability Register</h1>
              <p className="cw-text-muted mt-2">Track, manage, and remediate security vulnerabilities across your organization</p>
            </div>
            <div className="flex items-center gap-3">
              {hasPermission('vulnerabilities:vulnerability_register:edit') && selectedVulnIds.size > 0 && (
                <button
                  onClick={() => setShowBulkAssignModal(true)}
                  className="cw-btn-secondary inline-flex items-center gap-2"
                >
                  <Building2 size={16} />
                  Assign ({selectedVulnIds.size})
                </button>
              )}
              {hasPermission('vulnerabilities:vulnerability_register:create') && (
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="cw-btn-primary inline-flex items-center gap-2"
                >
                  <Plus size={18} />
                  Add Vulnerability
                </button>
              )}
            </div>
          </div>

          {/* Statistics Cards */}
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {/* Total Vulnerabilities */}
            <div className="group cw-card rounded-lg p-5 hover:shadow-md transition-all">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm cw-text-muted font-medium">Total Vulnerabilities</p>
                  <p className="text-3xl font-bold cw-text mt-2">{dashboard?.total || 0}</p>
                </div>
                <div className="p-2.5 bg-blue-50 rounded-lg">
                  <Bug className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </div>

            {/* Critical */}
            <div className="group cw-card rounded-lg p-5 hover:shadow-md transition-all hover:border-red-200">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm cw-text-muted font-medium">Critical</p>
                  <p className="text-3xl font-bold text-red-600 mt-2">{dashboard?.by_severity?.critical || 0}</p>
                </div>
                <div className="p-2.5 bg-red-50 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-red-600" />
                </div>
              </div>
            </div>

            {/* High */}
            <div className="group cw-card rounded-lg p-5 hover:shadow-md transition-all hover:border-orange-200">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm cw-text-muted font-medium">High</p>
                  <p className="text-3xl font-bold text-orange-600 mt-2">{dashboard?.by_severity?.high || 0}</p>
                </div>
                <div className="p-2.5 bg-orange-50 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-orange-600" />
                </div>
              </div>
            </div>

            {/* Medium */}
            <div className="group cw-card rounded-lg p-5 hover:shadow-md transition-all hover:border-yellow-200">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm cw-text-muted font-medium">Medium</p>
                  <p className="text-3xl font-bold text-yellow-600 mt-2">{dashboard?.by_severity?.medium || 0}</p>
                </div>
                <div className="p-2.5 bg-yellow-50 rounded-lg">
                  <Shield className="h-5 w-5 text-yellow-600" />
                </div>
              </div>
            </div>

            {/* SLA Compliance */}
            <div className="group cw-card rounded-lg p-5 hover:shadow-md transition-all hover:border-green-200">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm cw-text-muted font-medium">SLA Compliance</p>
                  <p className="text-3xl font-bold text-green-600 mt-2">{dashboard?.sla_compliance_percent || 0}%</p>
                </div>
                <div className="p-2.5 bg-green-50 rounded-lg">
                  <CheckSquare className="h-5 w-5 text-green-600" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div className="p-8 space-y-6">
        {/* Filters Section */}
        <div className="cw-card rounded-lg p-6">
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 cw-text-muted" />
              <input
                type="text"
                placeholder="Search vulnerabilities by title, CVE ID, CWE ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full cw-field pl-12 pr-4 py-3"
              />
            </div>

            {/* Filter Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium cw-text-muted mb-2">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full cw-field px-4 py-2"
                >
                  <option value="all">All Status</option>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="remediated">Remediated</option>
                  <option value="verified">Verified</option>
                  <option value="closed">Closed</option>
                  <option value="accepted">Risk Accepted</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium cw-text-muted mb-2">Severity</label>
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  className="w-full cw-field px-4 py-2"
                >
                  <option value="all">All Severity</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                  <option value="info">Info</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Data Table */}
        {isLoading ? (
          <div className="cw-card rounded-lg p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto" />
            <p className="cw-text-muted mt-4">Loading vulnerabilities...</p>
          </div>
        ) : error ? (
          <div className="cw-card border-red-200 rounded-lg p-6 text-center">
            <AlertCircle className="h-8 w-8 text-red-600 mx-auto" />
            <p className="text-red-600 mt-4">Failed to load vulnerabilities</p>
          </div>
        ) : filteredVulnerabilities.length === 0 ? (
          <div className="cw-card rounded-lg p-12 text-center">
            <Bug className="h-12 w-12 text-gray-300 mx-auto" />
            <p className="cw-text-muted mt-4">No vulnerabilities found</p>
            {(searchTerm || statusFilter !== 'all' || severityFilter !== 'all') && (
              <p className="cw-text-muted text-sm mt-2">Try adjusting your search or filters</p>
            )}
          </div>
        ) : (
          <div className="cw-card rounded-lg overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--color-subtle)] border-b border-[var(--color-border)]">
                  <tr>
                    <th className="px-6 py-4 text-left">
                      <input
                        type="checkbox"
                        checked={filteredVulnerabilities.length > 0 && selectedVulnIds.size === filteredVulnerabilities.length}
                        onChange={handleSelectAll}
                        className="rounded border-[var(--color-border)] text-[var(--color-base)] focus:ring-[var(--color-base)] cursor-pointer"
                      />
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">ID</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">Title</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">Severity</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">CVE/CWE</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">Due Date</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">Assigned To</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {filteredVulnerabilities.map((vuln) => {
                    const severityStyle = getSeverityStyle(vuln.severity);
                    const statusStyle = getStatusStyle(vuln.status);
                    return (
                      <tr 
                        key={vuln.id} 
                        className={`transition-all ${
                          selectedVulnIds.has(vuln.id) 
                            ? 'bg-blue-50 hover:bg-blue-100' 
                            : 'hover:bg-[var(--color-hover)]'
                        }`}
                      >
                        <td className="px-6 py-4">
                          <input
                            type="checkbox"
                            checked={selectedVulnIds.has(vuln.id)}
                            onChange={() => handleSelectVuln(vuln.id)}
                            className="rounded border-[var(--color-border)] text-[var(--color-base)] focus:ring-[var(--color-base)] cursor-pointer"
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono cw-text-muted">VULN-{vuln.id}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Link 
                              href={`/vulnerabilities/${vuln.id}`} 
                              className="cw-text font-medium hover:text-[var(--color-base)] transition-colors"
                            >
                              {vuln.title}
                            </Link>
                          </div>
                          {vuln.affected_component && (
                            <p className="text-xs cw-text-muted mt-1">Component: {vuln.affected_component}</p>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold gap-1 border ${severityStyle.bg} ${severityStyle.text} border-current/20`}>
                            {severityStyle.label}
                            {vuln.cvss_score && <span className="text-opacity-75">({vuln.cvss_score})</span>}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border ${statusStyle.bg} ${statusStyle.text} border-current/20`}>
                            {statusStyle.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm cw-text-muted">
                          {(vuln.cve_id || vuln.cwe_id) ? (
                            <div className="space-y-1">
                              {vuln.cve_id && <div className="font-mono">{vuln.cve_id}</div>}
                              {vuln.cwe_id && <div className="font-mono cw-text-muted">{vuln.cwe_id}</div>}
                            </div>
                          ) : (
                            <span className="cw-text-muted">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {vuln.due_date ? (
                            <div className="flex items-center gap-2 cw-text-muted">
                              <Clock size={14} className="cw-text-muted" />
                              <span>{new Date(vuln.due_date).toLocaleDateString()}</span>
                            </div>
                          ) : (
                            <span className="cw-text-muted">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {vuln.assignee_name ? (
                            <div className="flex items-center gap-2 cw-text-muted">
                              <User size={14} className="cw-text-muted" />
                              <span>{vuln.assignee_name}</span>
                            </div>
                          ) : (
                            <span className="cw-text-muted italic">Unassigned</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <Link 
                            href={`/vulnerabilities/${vuln.id}`}
                            className="text-[var(--color-base)] hover:text-[var(--color-base-hover)] transition-colors inline-flex items-center gap-1"
                          >
                            <ExternalLink size={14} />
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add Vulnerability Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-2xl mx-4 cw-card rounded-lg shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
              <h2 className="text-xl font-bold cw-text">Add New Vulnerability</h2>
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="cw-text-muted hover:cw-text transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit(new FormData(e.currentTarget));
              }}
              className="p-6 space-y-5"
            >
              {/* Title */}
              <div>
                <label className="block text-sm font-semibold cw-text mb-2">Title <span className="text-red-600">*</span></label>
                <input 
                  type="text" 
                  name="title" 
                  required 
                  placeholder="e.g., SQL Injection in Admin Panel"
                  className="w-full cw-field px-4 py-2" 
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-semibold cw-text mb-2">Description</label>
                <textarea 
                  name="description" 
                  rows={3} 
                  placeholder="Detailed description of the vulnerability..."
                  className="w-full cw-field px-4 py-2" 
                />
              </div>

              {/* Severity & CVSS Score */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold cw-text mb-2">Severity <span className="text-red-600">*</span></label>
                  <select 
                    name="severity" 
                    required 
                    className="w-full cw-field px-4 py-2"
                  >
                    <option value="">Select severity</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="info">Info</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold cw-text mb-2">CVSS Score</label>
                  <input 
                    type="number" 
                    name="cvss_score" 
                    step="0.1" 
                    min="0" 
                    max="10" 
                    placeholder="0-10"
                    className="w-full cw-field px-4 py-2" 
                  />
                </div>
              </div>

              {/* CVE & CWE IDs */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold cw-text mb-2">CVE ID</label>
                  <input 
                    type="text" 
                    name="cve_id" 
                    placeholder="CVE-2024-XXXXX"
                    className="w-full cw-field px-4 py-2" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold cw-text mb-2">CWE ID</label>
                  <input 
                    type="text" 
                    name="cwe_id" 
                    placeholder="CWE-XXXX"
                    className="w-full cw-field px-4 py-2" 
                  />
                </div>
              </div>

              {/* Affected Component & Host */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold cw-text mb-2">Affected Component</label>
                  <input 
                    type="text" 
                    name="affected_component" 
                    placeholder="e.g., API Gateway"
                    className="w-full cw-field px-4 py-2" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold cw-text mb-2">Affected Host</label>
                  <input 
                    type="text" 
                    name="affected_host" 
                    placeholder="e.g., 192.168.1.10"
                    className="w-full cw-field px-4 py-2" 
                  />
                </div>
              </div>

              {/* Due Date */}
              <div>
                <label className="block text-sm font-semibold cw-text mb-2">Due Date</label>
                <input 
                  type="date" 
                  name="due_date"
                  className="w-full cw-field px-4 py-2" 
                />
              </div>

              {/* Forms Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)} 
                  className="cw-btn-secondary"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={createMutation.isPending} 
                  className="cw-btn-primary disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {createMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Assign Modal */}
      {showBulkAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 cw-card rounded-lg shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
              <h2 className="text-xl font-bold cw-text">Bulk Assign to Department</h2>
              <button 
                onClick={() => setShowBulkAssignModal(false)} 
                className="cw-text-muted hover:cw-text transition-colors"
              >
                <X size={24} />
              </button>
            </div>

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
              className="p-6 space-y-5"
            >
              {/* Summary */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm cw-text-muted">
                  <span className="font-semibold cw-text">{selectedVulnIds.size}</span> vulnerabilities will be assigned to the selected department
                </p>
              </div>

              {/* Department Selection */}
              <div>
                <label className="block text-sm font-semibold cw-text mb-2">Department <span className="text-red-600">*</span></label>
                <select 
                  name="department_id" 
                  required 
                  className="w-full cw-field px-4 py-2"
                >
                  <option value="">Select a department</option>
                  {departments?.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name} {dept.code && `(${dept.code})`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-sm font-semibold cw-text mb-2">Priority</label>
                <select 
                  name="priority" 
                  className="w-full cw-field px-4 py-2"
                  defaultValue="medium"
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-semibold cw-text mb-2">Notes</label>
                <textarea 
                  name="notes" 
                  rows={2} 
                  placeholder="Optional notes for this assignment..."
                  className="w-full cw-field px-4 py-2" 
                />
              </div>

              {/* Modal Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
                <button 
                  type="button" 
                  onClick={() => setShowBulkAssignModal(false)} 
                  className="cw-btn-secondary"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={bulkAssignMutation.isPending} 
                  className="cw-btn-primary disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {bulkAssignMutation.isPending && <Loader2 size={16} className="animate-spin" />}
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
