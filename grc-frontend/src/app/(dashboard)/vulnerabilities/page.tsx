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
  ExternalLink,
  Building2,
  CheckSquare,
  Clock,
  Users,
  MoreVertical,
  Edit2,
  Trash2,
  UserPlus,
  ChevronRight,
  Route,
  Save,
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
  description?: string;
  parent_department_id?: number;
  department_head_user_id?: number;
  member_count?: number;
  vulnerability_count?: number;
  created_at: string;
}

interface DepartmentMember {
  id: number;
  user_id: number;
  user_name?: string;
  user_email?: string;
  role: string;
  email_notifications_enabled?: boolean;
  escalation_order?: number;
  added_at: string;
}

interface DepartmentVulnerability {
  id: number;
  vulnerability_id: number;
  vuln_id: string;
  title: string;
  severity: string;
  status: string;
  priority: string;
}

interface EscalationPath {
  id: number;
  name: string;
  description?: string;
  escalation_order: number;
  target_user_id?: number;
  target_role?: string;
  time_threshold_hours?: number;
}

interface SLAConfig {
  id: number;
  severity: string;
  remediation_days: number;
  notification_days?: number;
  escalation_days?: number;
  created_at?: string;
  updated_at?: string;
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

const SLA_SEVERITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-red-50', text: 'text-red-600' },
  high: { bg: 'bg-orange-50', text: 'text-orange-600' },
  medium: { bg: 'bg-yellow-50', text: 'text-yellow-600' },
  low: { bg: 'bg-blue-50', text: 'text-blue-600' },
  info: { bg: 'bg-slate-50', text: 'text-slate-600' },
};

const DEFAULT_SLA: Record<string, number> = {
  critical: 7,
  high: 30,
  medium: 90,
  low: 180,
  info: 365,
};

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
  const [activeTab, setActiveTab] = useState('vulnerabilities' as 'vulnerabilities' | 'departments' | 'sla');

  // Vulnerabilities tab state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [bulkUploadState, setBulkUploadState] = useState<'idle'|'uploading'|'done'|'error'>('idle');
  const [bulkUploadMsg, setBulkUploadMsg] = useState<string|null>(null);
  const bulkFileRef = useRef<HTMLInputElement>(null);
  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false);
  const [selectedVulnIds, setSelectedVulnIds] = useState<Set<number>>(new Set());

  // Departments tab state
  const [deptSearchQuery, setDeptSearchQuery] = useState('');
  const [showCreateDeptModal, setShowCreateDeptModal] = useState(false);
  const [showEditDeptModal, setShowEditDeptModal] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showEscalationModal, setShowEscalationModal] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);

  // SLA tab state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<{ remediation_days: number; notification_days?: number; escalation_days?: number }>({ remediation_days: 0 });

  const queryClient = useQueryClient();

  const tabs = [
    { id: 'vulnerabilities', label: 'Vulnerabilities', icon: Bug },
    { id: 'departments', label: 'Departments', icon: Building2 },
    { id: 'sla', label: 'SLA Config', icon: Clock },
  ];

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

  // Departments tab queries
  const { data: allDepartments, isLoading: deptsLoading } = useQuery({
    queryKey: ['all-departments-tab'],
    queryFn: async () => {
      const response = await vulnManagementApi.departments.getAll();
      return response.data as Department[];
    },
    enabled: activeTab === 'departments',
  });

  const { data: departmentMembers } = useQuery({
    queryKey: ['department-members', selectedDepartment?.id],
    queryFn: async () => {
      if (!selectedDepartment) return [];
      const response = await vulnManagementApi.departments.getMembers(selectedDepartment.id);
      return response.data as DepartmentMember[];
    },
    enabled: !!selectedDepartment && showMemberModal,
  });

  const { data: departmentVulnerabilities } = useQuery({
    queryKey: ['department-vulnerabilities', selectedDepartment?.id],
    queryFn: async () => {
      if (!selectedDepartment) return [];
      const response = await vulnManagementApi.departments.getDepartmentVulnerabilities(selectedDepartment.id);
      return response.data as DepartmentVulnerability[];
    },
    enabled: !!selectedDepartment,
  });

  const { data: escalationPaths } = useQuery({
    queryKey: ['escalation-paths', selectedDepartment?.id],
    queryFn: async () => {
      if (!selectedDepartment) return [];
      const response = await vulnManagementApi.departments.getEscalationPaths(selectedDepartment.id);
      return response.data as EscalationPath[];
    },
    enabled: !!selectedDepartment && showEscalationModal,
  });

  // SLA tab queries
  const { data: slaConfigs, isLoading: slaLoading, error: slaError } = useQuery({
    queryKey: ['vuln-sla'],
    queryFn: async () => {
      const response = await vulnManagementApi.sla.get();
      return response.data as SLAConfig[];
    },
    enabled: activeTab === 'sla',
  });

  // Departments mutations
  const createDepartmentMutation = useMutation({
    mutationFn: (data: { name: string; code?: string; description?: string }) =>
      vulnManagementApi.departments.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-departments-tab'] });
      setShowCreateDeptModal(false);
    },
  });

  const updateDepartmentMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name: string; code?: string; description?: string } }) =>
      vulnManagementApi.departments.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-departments-tab'] });
      setShowEditDeptModal(false);
      setSelectedDepartment(null);
    },
  });

  const deleteDepartmentMutation = useMutation({
    mutationFn: (id: number) => vulnManagementApi.departments.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-departments-tab'] });
      setActiveMenuId(null);
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ deptId, data }: { deptId: number; data: { user_id: number; role?: string; email_notifications_enabled?: boolean; escalation_order?: number } }) =>
      vulnManagementApi.departments.addMember(deptId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['department-members', selectedDepartment?.id] });
      queryClient.invalidateQueries({ queryKey: ['all-departments-tab'] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ deptId, memberId }: { deptId: number; memberId: number }) =>
      vulnManagementApi.departments.removeMember(deptId, memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['department-members', selectedDepartment?.id] });
      queryClient.invalidateQueries({ queryKey: ['all-departments-tab'] });
    },
  });

  const createEscalationPathMutation = useMutation({
    mutationFn: ({ deptId, data }: { deptId: number; data: Record<string, unknown> }) =>
      vulnManagementApi.departments.createEscalationPath(deptId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalation-paths', selectedDepartment?.id] });
    },
  });

  // SLA mutations
  const updateSlaMutation = useMutation({
    mutationFn: ({ severity, data }: { severity: string; data: Record<string, unknown> }) =>
      vulnManagementApi.sla.update(severity, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-sla'] });
      setEditingId(null);
    },
  });

  const createSlaMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => vulnManagementApi.sla.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-sla'] });
    },
  });

  const getSLAForSeverity = (severity: string) => slaConfigs?.find((s) => s.severity === severity);

  const handleSlaEdit = (config: SLAConfig) => {
    setEditingId(config.id);
    setEditValues({ remediation_days: config.remediation_days, notification_days: config.notification_days, escalation_days: config.escalation_days });
  };
  const handleSlaSave = () => {
    if (!editingId) return;
    const config = slaConfigs?.find((s) => s.id === editingId);
    if (!config) return;
    updateSlaMutation.mutate({ severity: config.severity, data: editValues });
  };
  const handleSlaCancel = () => { setEditingId(null); setEditValues({ remediation_days: 0 }); };
  const handleCreateDefaultSla = (severity: string) => {
    createSlaMutation.mutate({ severity, remediation_days: DEFAULT_SLA[severity] });
  };

  const filteredDepartments = allDepartments?.filter(dept =>
    dept.name.toLowerCase().includes(deptSearchQuery.toLowerCase()) ||
    dept.code?.toLowerCase().includes(deptSearchQuery.toLowerCase()) ||
    dept.description?.toLowerCase().includes(deptSearchQuery.toLowerCase())
  );

  const deptSeverityStyles: Record<string, string> = {
    critical: 'bg-red-50 text-red-700',
    high: 'bg-orange-50 text-orange-700',
    medium: 'bg-yellow-50 text-yellow-700',
    low: 'bg-blue-50 text-blue-700',
    info: 'bg-slate-50 text-slate-700',
  };

  const deptPriorityStyles: Record<string, string> = {
    high: 'bg-red-50 text-red-700',
    medium: 'bg-yellow-50 text-yellow-700',
    low: 'bg-green-50 text-green-700',
  };

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
      {/* Header + KPI Charts */}
      <div className="border-b border-[var(--color-border)] px-6 py-3">
        {/* Tabs */}
        <div className="mb-3 flex items-center gap-0 border-b border-gray-200 -mx-6 px-6">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as 'vulnerabilities' | 'departments' | 'sla')}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'vulnerabilities' && (
        <>
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
        </>
        )}
      </div>

      {/* Tab Content */}
      {activeTab === 'vulnerabilities' && (
      <>
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
                  // Validate file type
                  const validTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'];
                  const validExts = ['.xlsx', '.xls', '.csv'];
                  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
                  if (!validTypes.includes(file.type) && !validExts.includes(ext)) {
                    setBulkUploadState('error');
                    setBulkUploadMsg(`"${file.name}" is not a supported format. Please upload an Excel (.xlsx, .xls) or CSV (.csv) file. Download the template to get the correct format.`);
                    if (bulkFileRef.current) bulkFileRef.current.value = '';
                    setTimeout(() => { setBulkUploadState('idle'); setBulkUploadMsg(null); }, 7000);
                    return;
                  }
                  setBulkUploadState('uploading');
                  setBulkUploadMsg(null);
                  try {
                    const res = await vulnManagementApi.vulnerabilities.bulkUpload(file);
                    const d = res.data;
                    queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
                    queryClient.invalidateQueries({ queryKey: ['vuln-dashboard'] });
                    setBulkUploadState('done');
                    setBulkUploadMsg(`Successfully imported ${d.created} vulnerabilit${d.created === 1 ? 'y' : 'ies'}${d.skipped ? ` · ${d.skipped} skipped (duplicates)` : ''}${d.errors?.length ? ` · ${d.errors.length} row error${d.errors.length > 1 ? 's' : ''}: ${d.errors.slice(0,2).join('; ')}` : ''}.`);
                  } catch (err: unknown) {
                    setBulkUploadState('error');
                    const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                    if (msg?.includes('column') || msg?.includes('header') || msg?.includes('format')) {
                      setBulkUploadMsg(`File structure mismatch: ${msg}. Please use the provided template.`);
                    } else if (msg?.includes('empty')) {
                      setBulkUploadMsg('The uploaded file appears to be empty. Please add data rows and try again.');
                    } else {
                      setBulkUploadMsg(msg || 'Upload failed. Ensure the file matches the template format (Excel or CSV) and try again.');
                    }
                  } finally {
                    if (bulkFileRef.current) bulkFileRef.current.value = '';
                    setTimeout(() => { setBulkUploadState('idle'); setBulkUploadMsg(null); }, 7000);
                  }
                }}
              />
              <button
                onClick={() => {
                  // Generate and download CSV template
                  const headers = ['title','description','severity','status','cvss_score','cve_id','affected_asset','affected_asset_type','remediation','due_date','assigned_to_email'];
                  const example = ['Example SQL Injection','SQL injection vulnerability in login form','high','open','8.5','CVE-2024-1234','web-server-01','server','Apply input validation and parameterized queries','2026-06-30','security@company.com'];
                  const csv = [headers.join(','), example.join(',')].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'vulnerability_upload_template.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
                title="Download CSV template for bulk upload"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Template
              </button>
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
      <div className={`fixed inset-y-0 right-0 z-50 flex w-[680px] flex-col bg-white shadow-2xl border-l border-slate-200 transform transition-transform duration-300 ${isModalOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0">
          <h2 className="text-sm font-semibold text-slate-900">Add New Vulnerability</h2>
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
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {/* Row 1: Title + Description */}
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Title <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  name="title"
                  required
                  placeholder="e.g., SQL Injection in Admin Panel"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Description</label>
                <input
                  type="text"
                  name="description"
                  placeholder="Brief description of the vulnerability..."
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Row 2: Severity + CVSS Score */}
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Severity <span className="text-red-500">*</span></label>
                <select
                  name="severity"
                  required
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
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
                <label className="block text-xs font-medium text-slate-600 mb-0.5">CVSS Score</label>
                <input
                  type="number"
                  name="cvss_score"
                  step="0.1"
                  min="0"
                  max="10"
                  placeholder="0-10"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Row 3: CVE + CWE IDs */}
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">CVE ID</label>
                <input
                  type="text"
                  name="cve_id"
                  placeholder="CVE-2024-XXXXX"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">CWE ID</label>
                <input
                  type="text"
                  name="cwe_id"
                  placeholder="CWE-XXXX"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Row 4: Affected Component + Host */}
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Affected Component</label>
                <input
                  type="text"
                  name="affected_component"
                  placeholder="e.g., API Gateway"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Affected Host</label>
                <input
                  type="text"
                  name="affected_host"
                  placeholder="e.g., 192.168.1.10"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Row 5: Due Date (half row) */}
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Due Date</label>
                <input
                  type="date"
                  name="due_date"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

            <div className="flex-shrink-0 flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button 
                type="button" 
                onClick={() => setIsModalOpen(false)} 
                className="cw-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-opacity"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={createMutation.isPending} 
                className="cw-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-opacity"
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
                  className="cw-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-opacity"
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
      </>
      )}

      {/* Departments Tab */}
      {activeTab === 'departments' && (
        <div className="space-y-3 px-6 py-3 bg-[var(--color-subtle)]">
          <div className="flex items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 cw-text-muted" />
              <input
                type="text"
                value={deptSearchQuery}
                onChange={(e) => setDeptSearchQuery(e.target.value)}
                placeholder="Search departments..."
                className="cw-field w-full py-2 pl-10 pr-4 text-sm"
              />
            </div>
            {hasPermission('vulnerabilities:vulnerability_register:create') && (
              <button onClick={() => setShowCreateDeptModal(true)} className="cw-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-opacity">
                <Plus size={16} />
                Create Department
              </button>
            )}
          </div>

          {deptsLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {(!filteredDepartments || filteredDepartments.length === 0) ? (
                <div className="col-span-full cw-card p-8 text-center">
                  <Building2 className="h-10 w-10 mx-auto cw-text-muted mb-3" />
                  <h3 className="text-base font-medium cw-text mb-1">No departments found</h3>
                  <p className="text-sm cw-text-muted mb-3">Create your first department to start assigning vulnerabilities</p>
                  <button onClick={() => setShowCreateDeptModal(true)} className="cw-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-opacity ">
                    <Plus size={16} />
                    Create Department
                  </button>
                </div>
              ) : (
                filteredDepartments.map((dept) => (
                  <div key={dept.id} className="cw-card p-4 hover:shadow-md transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50">
                          <Building2 className="h-4 w-4 text-primary-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold cw-text">{dept.name}</h3>
                            {dept.code && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-subtle)] cw-text-muted font-mono">{dept.code}</span>
                            )}
                          </div>
                          {dept.description && <p className="text-sm cw-text-muted line-clamp-1">{dept.description}</p>}
                        </div>
                      </div>
                      <div className="relative">
                        <button onClick={() => setActiveMenuId(activeMenuId === dept.id ? null : dept.id)} className="p-1 cw-text-muted hover:cw-text rounded">
                          <MoreVertical size={16} />
                        </button>
                        {activeMenuId === dept.id && (
                          <div className="absolute right-0 mt-1 w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl z-10">
                            {hasPermission('vulnerabilities:vulnerability_register:edit') && (
                              <button onClick={() => { setSelectedDepartment(dept); setShowEditDeptModal(true); setActiveMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm cw-text-muted hover:bg-[var(--color-hover)]">
                                <Edit2 size={14} /> Edit
                              </button>
                            )}
                            <button onClick={() => { setSelectedDepartment(dept); setShowMemberModal(true); setActiveMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm cw-text-muted hover:bg-[var(--color-hover)]">
                              <UserPlus size={14} /> Members
                            </button>
                            <button onClick={() => { setSelectedDepartment(dept); setShowEscalationModal(true); setActiveMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm cw-text-muted hover:bg-[var(--color-hover)]">
                              <Route size={14} /> Escalation Paths
                            </button>
                            {hasPermission('vulnerabilities:vulnerability_register:delete') && (
                              <button onClick={() => { if (confirm('Delete this department?')) { deleteDepartmentMutation.mutate(dept.id); } }} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-[var(--color-hover)]">
                                <Trash2 size={14} /> Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm mb-4">
                      <div className="flex items-center gap-1.5 cw-text-muted"><Users size={14} /><span>{dept.member_count || 0} members</span></div>
                      <div className="flex items-center gap-1.5 cw-text-muted"><Bug size={14} /><span>{dept.vulnerability_count || 0} vulnerabilities</span></div>
                    </div>

                    <button
                      onClick={() => setSelectedDepartment(selectedDepartment?.id === dept.id ? null : dept)}
                      className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                    >
                      {selectedDepartment?.id === dept.id ? 'Hide Assigned Vulnerabilities' : 'View Assigned Vulnerabilities'}
                      <ChevronRight size={14} className={selectedDepartment?.id === dept.id ? 'rotate-90' : ''} />
                    </button>

                    {selectedDepartment?.id === dept.id && departmentVulnerabilities && (
                      <div className="mt-4 space-y-2 border-t border-[var(--color-border)] pt-4">
                        {departmentVulnerabilities.length === 0 ? (
                          <p className="text-sm cw-text-muted">No vulnerabilities assigned</p>
                        ) : (
                          departmentVulnerabilities.slice(0, 5).map((vuln) => (
                            <Link key={vuln.id} href={`/vulnerabilities/${vuln.vulnerability_id}`} className="flex items-center justify-between p-2 rounded-lg bg-[var(--color-subtle)] hover:bg-[var(--color-hover)] transition-colors">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs ${deptSeverityStyles[vuln.severity] || deptSeverityStyles.info}`}>{vuln.severity}</span>
                                <span className="text-sm cw-text truncate max-w-[150px]">{vuln.title}</span>
                              </div>
                              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs ${deptPriorityStyles[vuln.priority] || 'bg-slate-50 text-slate-700'}`}>{vuln.priority}</span>
                            </Link>
                          ))
                        )}
                        {departmentVulnerabilities.length > 5 && (
                          <p className="text-xs cw-text-muted text-center">+{departmentVulnerabilities.length - 5} more</p>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Create Department Modal */}
          {showCreateDeptModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold cw-text">Create Department</h2>
                  <button onClick={() => setShowCreateDeptModal(false)} className="cw-text-muted hover:cw-text"><X size={20} /></button>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); createDepartmentMutation.mutate({ name: fd.get('name') as string, code: fd.get('code') as string || undefined, description: fd.get('description') as string || undefined }); }} className="space-y-4">
                  <div><label className="block text-sm font-medium text-slate-600 mb-1">Department Name *</label><input type="text" name="name" required className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" placeholder="e.g., Security Operations" /></div>
                  <div><label className="block text-sm font-medium text-slate-600 mb-1">Department Code</label><input type="text" name="code" className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" placeholder="e.g., SEC-OPS" /></div>
                  <div><label className="block text-sm font-medium text-slate-600 mb-1">Description</label><textarea name="description" rows={3} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" placeholder="Department responsibilities..." /></div>
                  <div className="flex justify-end gap-3">
                    <button type="button" onClick={() => setShowCreateDeptModal(false)} className="cw-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-opacity">Cancel</button>
                    <button type="submit" disabled={createDepartmentMutation.isPending} className="cw-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-opacity">{createDepartmentMutation.isPending ? 'Creating...' : 'Create Department'}</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Edit Department Modal */}
          {showEditDeptModal && selectedDepartment && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold cw-text">Edit Department</h2>
                  <button onClick={() => { setShowEditDeptModal(false); setSelectedDepartment(null); }} className="cw-text-muted hover:cw-text"><X size={20} /></button>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); updateDepartmentMutation.mutate({ id: selectedDepartment.id, data: { name: fd.get('name') as string, code: fd.get('code') as string || undefined, description: fd.get('description') as string || undefined } }); }} className="space-y-4">
                  <div><label className="block text-sm font-medium text-slate-600 mb-1">Department Name *</label><input type="text" name="name" required defaultValue={selectedDepartment.name} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" /></div>
                  <div><label className="block text-sm font-medium text-slate-600 mb-1">Department Code</label><input type="text" name="code" defaultValue={selectedDepartment.code || ''} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" /></div>
                  <div><label className="block text-sm font-medium text-slate-600 mb-1">Description</label><textarea name="description" rows={3} defaultValue={selectedDepartment.description || ''} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" /></div>
                  <div className="flex justify-end gap-3">
                    <button type="button" onClick={() => { setShowEditDeptModal(false); setSelectedDepartment(null); }} className="cw-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-opacity">Cancel</button>
                    <button type="submit" disabled={updateDepartmentMutation.isPending} className="cw-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-opacity">{updateDepartmentMutation.isPending ? 'Saving...' : 'Save Changes'}</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Members Modal */}
          {showMemberModal && selectedDepartment && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold cw-text">Members — {selectedDepartment.name}</h2>
                  <button onClick={() => { setShowMemberModal(false); setSelectedDepartment(null); }} className="cw-text-muted hover:cw-text"><X size={20} /></button>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); const userId = parseInt(fd.get('user_id') as string); if (userId) { addMemberMutation.mutate({ deptId: selectedDepartment.id, data: { user_id: userId, role: fd.get('role') as string || 'member', email_notifications_enabled: fd.get('email_notifications') === 'on', escalation_order: parseInt(fd.get('escalation_order') as string) || undefined } }); (e.target as HTMLFormElement).reset(); } }} className="flex gap-2 mb-4 flex-wrap">
                  <input type="number" name="user_id" placeholder="User ID" className="cw-field flex-1 min-w-[100px]" required />
                  <select name="role" className="cw-field w-28"><option value="member">Member</option><option value="lead">Lead</option><option value="head">Head</option></select>
                  <input type="number" name="escalation_order" placeholder="Order" className="cw-field w-20" />
                  <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="email_notifications" defaultChecked className="rounded" />Email</label>
                  <button type="submit" disabled={addMemberMutation.isPending} className="cw-btn-primary"><UserPlus size={16} /></button>
                </form>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {(!departmentMembers || departmentMembers.length === 0) ? (
                    <p className="text-sm cw-text-muted text-center py-4">No members</p>
                  ) : departmentMembers.map((member) => (
                    <div key={member.id} className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-subtle)]">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-50 text-primary-700 text-sm font-medium">{(member.user_name || 'U')[0].toUpperCase()}</div>
                        <div><p className="text-sm font-medium cw-text">{member.user_name || `User #${member.user_id}`}</p><p className="text-xs cw-text-muted">{member.user_email || ''}</p></div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${member.role === 'head' ? 'bg-primary-50 text-primary-700' : member.role === 'lead' ? 'bg-blue-50 text-blue-700' : 'bg-slate-50 text-slate-700'}`}>{member.role}</span>
                        <button onClick={() => removeMemberMutation.mutate({ deptId: selectedDepartment.id, memberId: member.id })} className="cw-text-muted hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-4"><button onClick={() => { setShowMemberModal(false); setSelectedDepartment(null); }} className="cw-btn-secondary">Close</button></div>
              </div>
            </div>
          )}

          {/* Escalation Paths Modal */}
          {showEscalationModal && selectedDepartment && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold cw-text">Escalation Paths — {selectedDepartment.name}</h2>
                  <button onClick={() => { setShowEscalationModal(false); setSelectedDepartment(null); }} className="cw-text-muted hover:cw-text"><X size={20} /></button>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); createEscalationPathMutation.mutate({ deptId: selectedDepartment.id, data: { name: fd.get('name') as string, description: fd.get('description') as string || undefined, escalation_order: parseInt(fd.get('escalation_order') as string) || 1, target_role: fd.get('target_role') as string || undefined, time_threshold_hours: parseInt(fd.get('time_threshold_hours') as string) || undefined } }); (e.target as HTMLFormElement).reset(); }} className="space-y-3 mb-4 p-3 rounded-lg bg-[var(--color-subtle)]">
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" name="name" placeholder="Path name *" className="cw-field" required />
                    <select name="target_role" className="cw-field"><option value="">Target role</option><option value="head">Head</option><option value="lead">Lead</option><option value="member">Member</option></select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input type="number" name="escalation_order" placeholder="Order (1, 2, 3...)" className="cw-field" />
                    <input type="number" name="time_threshold_hours" placeholder="Hours threshold" className="cw-field" />
                  </div>
                  <input type="text" name="description" placeholder="Description (optional)" className="cw-field w-full" />
                  <button type="submit" disabled={createEscalationPathMutation.isPending} className="cw-btn-primary w-full">{createEscalationPathMutation.isPending ? 'Adding...' : 'Add Escalation Path'}</button>
                </form>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {(!escalationPaths || escalationPaths.length === 0) ? (
                    <p className="text-sm cw-text-muted text-center py-4">No escalation paths configured</p>
                  ) : escalationPaths.map((path) => (
                    <div key={path.id} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-subtle)]">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-700 text-sm font-medium">{path.escalation_order}</div>
                      <div><p className="text-sm font-medium cw-text">{path.name}</p><p className="text-xs cw-text-muted">{path.target_role && `To: ${path.target_role}`}{path.time_threshold_hours && ` | After ${path.time_threshold_hours}h`}</p></div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-4"><button onClick={() => { setShowEscalationModal(false); setSelectedDepartment(null); }} className="cw-btn-secondary">Close</button></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SLA Tab */}
      {activeTab === 'sla' && (
        <div className="space-y-3 px-6 py-3 bg-[var(--color-subtle)]">
          {slaLoading ? (
            <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div>
          ) : slaError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center"><AlertCircle className="mx-auto h-8 w-8 text-red-600" /><p className="mt-2 text-red-600">Failed to load SLA configuration</p></div>
          ) : (
            <>
              <div className="cw-card overflow-hidden">
                <table className="w-full">
                  <thead className="bg-[var(--color-subtle)]">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">Severity</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">Remediation Days</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">Notification Days</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">Escalation Days</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {SEVERITY_ORDER.map((severity) => {
                      const config = getSLAForSeverity(severity);
                      const style = SLA_SEVERITY_STYLES[severity];
                      const isEditing = editingId === config?.id;
                      return (
                        <tr key={severity} className="hover:bg-[var(--color-hover)] transition-colors">
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text} capitalize`}>{severity}</span>
                          </td>
                          <td className="px-3 py-2">
                            {config ? (isEditing ? <input type="number" value={editValues.remediation_days} onChange={(e) => setEditValues({ ...editValues, remediation_days: parseInt(e.target.value) || 0 })} className="cw-field w-24" min="1" /> : <span className="cw-text font-medium">{config.remediation_days} days</span>) : <span className="cw-text-muted">Not configured</span>}
                          </td>
                          <td className="px-3 py-2">
                            {config ? (isEditing ? <input type="number" value={editValues.notification_days || ''} onChange={(e) => setEditValues({ ...editValues, notification_days: parseInt(e.target.value) || undefined })} className="cw-field w-24" min="1" placeholder="Days before" /> : <span className="cw-text-muted">{config.notification_days ? `${config.notification_days} days before` : '-'}</span>) : <span className="cw-text-muted">-</span>}
                          </td>
                          <td className="px-3 py-2">
                            {config ? (isEditing ? <input type="number" value={editValues.escalation_days || ''} onChange={(e) => setEditValues({ ...editValues, escalation_days: parseInt(e.target.value) || undefined })} className="cw-field w-24" min="1" placeholder="Days after" /> : <span className="cw-text-muted">{config.escalation_days ? `${config.escalation_days} days after` : '-'}</span>) : <span className="cw-text-muted">-</span>}
                          </td>
                          <td className="px-3 py-2">
                            {config ? (
                              isEditing ? (
                                <div className="flex items-center gap-2">
                                  <button onClick={handleSlaSave} disabled={updateSlaMutation.isPending} className="p-1.5 rounded-lg text-green-600 hover:bg-[var(--color-hover)] transition-colors" title="Save"><Save size={16} /></button>
                                  <button onClick={handleSlaCancel} className="p-1.5 rounded-lg cw-text-muted hover:bg-[var(--color-hover)] transition-colors" title="Cancel"><X size={16} /></button>
                                </div>
                              ) : (
                                <button onClick={() => handleSlaEdit(config)} className="p-1.5 rounded-lg cw-text-muted hover:text-[var(--color-primary)] hover:bg-[var(--color-hover)] transition-colors" title="Edit"><Edit2 size={16} /></button>
                              )
                            ) : (
                              <button onClick={() => handleCreateDefaultSla(severity)} disabled={createSlaMutation.isPending} className="text-sm text-primary-600 hover:text-primary-300">Set Default</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="cw-card p-6">
                <h2 className="text-lg font-semibold cw-text mb-4 flex items-center gap-2"><Clock className="h-5 w-5 text-primary-600" />SLA Guidelines</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="p-4 rounded-lg bg-[var(--color-subtle)]"><h3 className="font-medium cw-text mb-2">Remediation Days</h3><p className="text-sm cw-text-muted">Maximum time allowed to remediate vulnerabilities of this severity before they are considered overdue.</p></div>
                  <div className="p-4 rounded-lg bg-[var(--color-subtle)]"><h3 className="font-medium cw-text mb-2">Notification Days</h3><p className="text-sm cw-text-muted">Number of days before the due date to send reminder notifications to assignees.</p></div>
                  <div className="p-4 rounded-lg bg-[var(--color-subtle)]"><h3 className="font-medium cw-text mb-2">Escalation Days</h3><p className="text-sm cw-text-muted">Number of days after the due date to escalate overdue vulnerabilities to management.</p></div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
