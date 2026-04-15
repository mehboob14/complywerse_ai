'use client';

import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Upload,
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
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';

const SEVERITY_CHART_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#3b82f6',
  info:     '#94a3b8',
};

const STATUS_CHART_COLORS: Record<string, string> = {
  open:           '#ef4444',
  in_progress:    '#f97316',
  remediated:     '#3b82f6',
  verified:       '#10b981',
  closed:         '#6b7280',
  accepted:       '#8b5cf6',
  false_positive: '#94a3b8',
};

const VulnPieTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md text-xs">
        <p className="font-medium text-gray-800 capitalize">{payload[0].name}</p>
        <p className="text-gray-500">{payload[0].value} vulns</p>
      </div>
    );
  }
  return null;
};

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
  linked_assets?: string[];
  due_date?: string;
  assigned_to?: number;
  assignee_name?: string;  // Changed from assigned_user_name to match backend
  report_id?: number;
  report_name?: string;
  created_at: string;
}

interface DashboardData {
  total_vulnerabilities: number;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  sla_compliance: Record<string, { total: number; resolved: number; on_time: number; compliance_rate: number }>;
  overdue_count?: number;
  mttr_days?: number;
  aging_buckets?: Record<string, number>;
  top_affected_assets?: Array<{ asset_id: number; asset_name: string; vulnerability_count: number }>;
  by_assignee?: Record<string, number>;
  mitigation_coverage?: { with_mitigations: number; without_mitigations: number };
  by_department?: Record<string, number>;
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
  const [bulkUploadState, setBulkUploadState] = useState<'idle'|'uploading'|'done'|'error'>('idle');
  const [bulkUploadMsg, setBulkUploadMsg] = useState<string|null>(null);
  const bulkFileRef = useRef<HTMLInputElement>(null);
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

  const severityChartData = useMemo(() => {
    const bySev = dashboard?.by_severity || {};
    return Object.entries(bySev)
      .filter(([, v]) => (v as number) > 0)
      .map(([key, value]) => ({
        name: key.charAt(0).toUpperCase() + key.slice(1),
        value: value as number,
        fill: SEVERITY_CHART_COLORS[key] || '#94a3b8',
      }));
  }, [dashboard?.by_severity]);

  const statusChartData = useMemo(() => {
    const bySt = dashboard?.by_status || {};
    return Object.entries(bySt)
      .filter(([, v]) => (v as number) > 0)
      .map(([key, value]) => ({
        name: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        value: value as number,
        fill: STATUS_CHART_COLORS[key] || '#94a3b8',
      }));
  }, [dashboard?.by_status]);

  const slaPercent = useMemo(() => {
    const compliance = dashboard?.sla_compliance || {};
    const entries = Object.values(compliance);
    if (!entries.length) return 0;
    const totalVulnsInSla = entries.reduce((s, e) => s + e.total, 0);
    const onTime = entries.reduce((s, e) => s + e.on_time, 0);
    return totalVulnsInSla > 0 ? Math.round((onTime / totalVulnsInSla) * 100) : 0;
  }, [dashboard?.sla_compliance]);
  const totalVulns = dashboard?.total_vulnerabilities || 0;

  const assigneeChartData = useMemo(() => {
    const byAssignee = dashboard?.by_assignee || {};
    return Object.entries(byAssignee)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 8)
      .map(([name, count]) => ({ name, count: count as number }));
  }, [dashboard?.by_assignee]);

  const mitigationChartData = useMemo(() => {
    const cov = dashboard?.mitigation_coverage;
    if (!cov) return [];
    return [
      { name: 'With Mitigations', value: cov.with_mitigations, fill: '#10b981' },
      { name: 'Without Mitigations', value: cov.without_mitigations, fill: '#f97316' },
    ].filter(d => d.value > 0);
  }, [dashboard?.mitigation_coverage]);

  const deptChartData = useMemo(() => {
    const byDept = dashboard?.by_department || {};
    return Object.entries(byDept)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 8)
      .map(([name, count]) => ({ name, count: count as number }));
  }, [dashboard?.by_department]);

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
    <div className="-m-4 lg:-m-5">
      {/* KPI Charts */}
      <div className="border-b border-[var(--color-border)] px-6 py-3">
        {/* Visual overview strip — three chart panels */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">

          {/* 1 — Severity donut */}
          <div className="cw-card rounded-xl p-4">
            <p className="text-xs font-semibold cw-text-muted uppercase tracking-wide mb-3">By Severity</p>
            {severityChartData.length === 0 ? (
              <div className="flex h-[120px] items-center justify-center text-xs cw-text-muted">No data</div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="relative h-[110px] w-[110px] flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={severityChartData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" paddingAngle={2}>
                        {severityChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip content={<VulnPieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-lg font-bold cw-text">{totalVulns}</span>
                    <span className="text-[10px] cw-text-muted">total</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 min-w-0">
                  {severityChartData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-2 text-xs">
                      <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.fill }} />
                      <span className="cw-text-muted truncate">{entry.name}</span>
                      <span className="font-semibold cw-text ml-auto">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 2 — Status bar chart */}
          <div className="cw-card rounded-xl p-4">
            <p className="text-xs font-semibold cw-text-muted uppercase tracking-wide mb-3">Remediation Status</p>
            {statusChartData.length === 0 ? (
              <div className="flex h-[110px] items-center justify-center text-xs cw-text-muted">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={110}>
                <BarChart data={statusChartData} layout="vertical" margin={{ left: 0, right: 8, top: 2, bottom: 2 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }} />
                  <Tooltip content={<VulnPieTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {statusChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* 3 — SLA gauge + MTTR */}
          <div className="cw-card rounded-xl p-4 flex flex-col justify-between">
            <p className="text-xs font-semibold cw-text-muted uppercase tracking-wide mb-3">SLA Compliance</p>
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-full">
                <div className="mb-1 flex items-center justify-between text-xs cw-text-muted">
                  <span>0%</span>
                  <span className="text-base font-bold" style={{ color: slaPercent >= 80 ? '#10b981' : slaPercent >= 50 ? '#f59e0b' : '#ef4444' }}>
                    {slaPercent}%
                  </span>
                  <span>100%</span>
                </div>
                <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${slaPercent}%`,
                      background: slaPercent >= 80 ? '#10b981' : slaPercent >= 50 ? '#f59e0b' : '#ef4444',
                    }}
                  />
                </div>
                <p className="mt-1 text-center text-[10px] cw-text-muted">On-time remediation rate</p>
              </div>
              {dashboard?.mttr_days != null && (
                <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 w-full justify-center">
                  <Clock className="h-3.5 w-3.5" />
                  <span>MTTR: <strong>{dashboard.mttr_days} days</strong></span>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Second row — Assignee / Mitigation Coverage / Department */}
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">

          {/* Assignee breakdown */}
          <div className="cw-card rounded-xl p-4">
            <p className="text-xs font-semibold cw-text-muted uppercase tracking-wide mb-3">By Assignee</p>
            {assigneeChartData.length === 0 ? (
              <div className="flex h-[120px] items-center justify-center text-xs cw-text-muted">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(80, assigneeChartData.length * 22)}>
                <BarChart data={assigneeChartData} layout="vertical" margin={{ left: 4, right: 24, top: 2, bottom: 2 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }} />
                  <Tooltip formatter={(v) => [v, 'Vulnerabilities']} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                  <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Mitigation coverage donut */}
          <div className="cw-card rounded-xl p-4">
            <p className="text-xs font-semibold cw-text-muted uppercase tracking-wide mb-3">Mitigation Coverage</p>
            {mitigationChartData.length === 0 ? (
              <div className="flex h-[120px] items-center justify-center text-xs cw-text-muted">No data</div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="relative h-[110px] w-[110px] flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={mitigationChartData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" paddingAngle={2}>
                        {mitigationChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip content={<VulnPieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-lg font-bold cw-text">
                      {mitigationChartData.reduce((s, d) => s + d.value, 0)}
                    </span>
                    <span className="text-[10px] cw-text-muted">total</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 min-w-0">
                  {mitigationChartData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-2 text-xs">
                      <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.fill }} />
                      <span className="cw-text-muted truncate">{entry.name}</span>
                      <span className="font-semibold cw-text ml-auto">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Department breakdown */}
          <div className="cw-card rounded-xl p-4">
            <p className="text-xs font-semibold cw-text-muted uppercase tracking-wide mb-3">By Department</p>
            {deptChartData.length === 0 ? (
              <div className="flex h-[120px] items-center justify-center text-xs cw-text-muted">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(80, deptChartData.length * 22)}>
                <BarChart data={deptChartData} layout="vertical" margin={{ left: 4, right: 24, top: 2, bottom: 2 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }} />
                  <Tooltip formatter={(v) => [v, 'Vulnerabilities']} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

        </div>
      </div>

      {/* Content Section */}
      <div className="px-6 py-3 space-y-2  bg-[var(--color-subtle)]">
        {/* Toolbar: search + filters + add button on one row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 cw-text-muted" />
            <input
              type="text"
              placeholder="Search by title, CVE ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full cw-field !bg-white rounded-md pl-8 pr-3 py-1.5 text-sm"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="cw-field !bg-white rounded-md px-2 py-1.5 text-sm w-36"
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
            className="cw-field !bg-white rounded-md px-2 py-1.5 text-sm w-36"
          >
            <option value="all">All Severity</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="info">Info</option>
          </select>
          {hasPermission('vulnerabilities:vulnerability_register:create') && (
            <>
              <input
                ref={bulkFileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBulkUploadState('uploading');
                  setBulkUploadMsg(null);
                  try {
                    const res = await vulnManagementApi.vulnerabilities.bulkUpload(file);
                    const d = res.data;
                    queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
                    queryClient.invalidateQueries({ queryKey: ['vuln-dashboard'] });
                    setBulkUploadState('done');
                    setBulkUploadMsg(`Imported ${d.created} vulnerabilities${d.skipped ? `, ${d.skipped} skipped` : ''}${d.errors?.length ? `. Errors: ${d.errors.slice(0,2).join('; ')}` : ''}`);
                  } catch {
                    setBulkUploadState('error');
                    setBulkUploadMsg('Upload failed. Check file format.');
                  } finally {
                    if (bulkFileRef.current) bulkFileRef.current.value = '';
                    setTimeout(() => { setBulkUploadState('idle'); setBulkUploadMsg(null); }, 5000);
                  }
                }}
              />
              <button
                onClick={() => bulkFileRef.current?.click()}
                disabled={bulkUploadState === 'uploading'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                {bulkUploadState === 'uploading' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Bulk Upload
              </button>
              <button onClick={() => setIsModalOpen(true)} className="cw-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-opacity">
                <Plus size={14} />
                Add Vulnerability
              </button>
            </>
          )}
        </div>

        {/* Bulk upload result toast */}
        {bulkUploadMsg && (
          <div className={`rounded-lg px-4 py-2.5 text-sm font-medium flex items-center gap-2 ${bulkUploadState === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
            {bulkUploadState === 'error' ? <AlertCircle size={15} /> : <CheckSquare size={15} />}
            {bulkUploadMsg}
          </div>
        )}

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
                    <th className="px-3 py-2 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">ID</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">Title</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">Severity</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">CVE</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">Due Date</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">Assigned To</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold cw-text-muted uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {filteredVulnerabilities.map((vuln) => {
                    const severityStyle = getSeverityStyle(vuln.severity);
                    const statusStyle = getStatusStyle(vuln.status);
                    return (
                      <tr
                        key={vuln.id}
                        className="bg-white hover:bg-[var(--color-hover)] transition-colors"
                      >
                        <td className="px-3 py-2 whitespace-nowrap text-xs font-mono cw-text-muted">VULN-{vuln.id}</td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/vulnerabilities/${vuln.id}`}
                            className="text-sm cw-text font-medium hover:text-[var(--color-base)] transition-colors"
                          >
                            {vuln.title}
                          </Link>
                          {vuln.affected_component && (
                            <p className="text-xs cw-text-muted">{vuln.affected_component}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${severityStyle.bg} ${severityStyle.text}`}>
                            {severityStyle.label}
                            {vuln.cvss_score && <span className="ml-1 opacity-75">({vuln.cvss_score})</span>}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                            {statusStyle.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs font-mono cw-text-muted">
                          {vuln.cve_id ?? <span className="not-italic">—</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs cw-text-muted">
                          {vuln.due_date ? new Date(vuln.due_date).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs cw-text-muted">
                          {vuln.assignee_name ?? <span className="italic">—</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">
                          <Link
                            href={`/vulnerabilities/${vuln.id}`}
                            className="text-[var(--color-base)] hover:text-[var(--color-base-hover)] transition-colors inline-flex items-center gap-1"
                          >
                            <ExternalLink size={12} />
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

      {/* Add Vulnerability Slide-over */}
      {isModalOpen && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setIsModalOpen(false)} />
      )}
      <div className={`fixed inset-y-0 right-0 z-50 flex w-[540px] flex-col bg-white shadow-2xl transform transition-transform duration-300 ${isModalOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0">
          <h2 className="text-lg font-semibold text-slate-900">Add New Vulnerability</h2>
          <button
            onClick={() => setIsModalOpen(false)}
            className="text-slate-500 hover:text-slate-900 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(new FormData(e.currentTarget));
          }}
          className="flex flex-col flex-1 min-h-0"
        >
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
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
            </div>

            <div className="flex-shrink-0 flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
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
