'use client';

import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { vulnManagementApi } from '@/lib/api';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useTabParam } from '@/lib/useTabParam';
import { SearchInput, MultiSelectDropdown, PageLoader } from '@/components/ui';
import NcaVulnRegisterTab from '@/components/vulnerabilities/NcaVulnRegisterTab';
import NcaVulnQuickAddModal from '@/components/vulnerabilities/NcaVulnQuickAddModal';
// The Overview tab reuses the standalone /vulnerabilities/dashboard page
// component verbatim — its queries only fire when this tab is the active
// one (conditional mount below), so picking the Vulnerabilities tab incurs
// zero extra network calls.
import VulnerabilityDashboardPage from './dashboard/page';
import { VulnsWorkspace } from './_workspace/VulnsWorkspace';
import type { Vulnerability } from './_workspace/lib';
import {
  Upload,
  Bug,
  BarChart3,
  Loader2,
  Plus,
  X,
  AlertCircle,
  Eye,
  Building2,
  CheckSquare,
  Clock,
  Users,
  MoreVertical,
  Edit2,
  Trash2,
  UserPlus,
  ChevronRight,
  ChevronDown,
  Route,
  Save,
  Sparkles,
  CheckCircle,
} from 'lucide-react';
import Link from 'next/link';
// The register-header severity/status/SLA charts were moved out (they duplicate
// the Overview tab), so recharts is no longer imported here. The Overview tab's
// VulnerabilityDashboardPage keeps its own charts.

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

// `Vulnerability` is imported from ./_workspace/lib (single source of truth,
// shared with the workspace views).

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
  const [activeTab, setActiveTab] = useTabParam<'overview' | 'vulnerabilities' | 'departments' | 'sla'>('vulnerabilities', ['overview', 'vulnerabilities', 'departments', 'sla']);
  const [registerType, setRegisterType] = useState<'standard' | 'nca'>('standard');

  // (queryClient is declared further down; the backfill effect references it
  // through a lazily-resolved import to avoid an out-of-order declaration.)

  // Vulnerabilities tab state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  // By default the register hides closed/mitigated rows so it stays focused
  // on what still needs work. The checkbox toggles them back in. An explicit
  // status pick from the existing dropdown overrides this on the backend.
  const [showClosed, setShowClosed] = useState(false);
  const [sortBy, setSortBy] = useState<'created_at' | 'severity' | 'due_date' | 'title'>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNcaAddOpen, setIsNcaAddOpen] = useState(false);

  // CVE auto-fill — watches the title input on the Add modal, debounces 600ms,
  // and asks the backend whether the title contains a CVE-ID or matches a
  // known nickname (Log4Shell etc.). When a match comes back, we surface a
  // small "Apply" banner that one-click pre-fills cvss/cve/cwe/severity.
  const addFormRef = useRef<HTMLFormElement>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [cveLookup, setCveLookup] = useState<{
    matched: boolean;
    match_source?: string;
    cve_id?: string;
    cvss_score?: number;
    cvss_vector?: string;
    severity?: string;
    cwe_id?: string;
    description?: string;
    nvd_url?: string;
  } | null>(null);
  const [cveLookupLoading, setCveLookupLoading] = useState(false);
  const [cveLookupApplied, setCveLookupApplied] = useState(false);

  useEffect(() => {
    if (!isModalOpen) return;
    const trimmed = titleDraft.trim();
    if (trimmed.length < 4) {
      setCveLookup(null);
      setCveLookupLoading(false);
      return;
    }
    setCveLookupLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await vulnManagementApi.vulnerabilities.lookupByTitle({ title: trimmed });
        const data = res.data as { matched: boolean } & Record<string, unknown>;
        setCveLookup(data.matched ? (data as typeof cveLookup) : null);
      } catch {
        setCveLookup(null);
      } finally {
        setCveLookupLoading(false);
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleDraft, isModalOpen]);

  // Reset auto-fill state whenever the modal opens / closes so we don't show
  // a stale banner the next time the user clicks "Add Vulnerability".
  useEffect(() => {
    if (!isModalOpen) {
      setTitleDraft('');
      setCveLookup(null);
      setCveLookupApplied(false);
    }
  }, [isModalOpen]);

  const applyCveAutoFill = () => {
    if (!cveLookup || !addFormRef.current) return;
    const form = addFormRef.current;
    const setField = (name: string, value: string | number | undefined | null) => {
      if (value === undefined || value === null || value === '') return;
      const el = form.elements.namedItem(name) as
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
        | null;
      if (!el) return;
      // Only overwrite when the field is empty — operator-typed values win.
      if ((el.value || '').trim().length === 0) {
        el.value = String(value);
      }
    };
    setField('cve_id', cveLookup.cve_id);
    setField('cvss_score', cveLookup.cvss_score);
    setField('cwe_id', cveLookup.cwe_id);
    setField('severity', cveLookup.severity);
    setField('description', cveLookup.description);
    setCveLookupApplied(true);
  };
  const [ncaExpandedRows, setNcaExpandedRows] = useState<Set<number>>(new Set());
  const [bulkUploadState, setBulkUploadState] = useState<'idle'|'uploading'|'done'|'error'>('idle');
  const [bulkUploadMsg, setBulkUploadMsg] = useState<string|null>(null);
  const bulkFileRef = useRef<HTMLInputElement>(null);
  // Template chooser shown before the file picker opens. 'standard' uses the
  // generic vuln-management bulk endpoint; 'nca' parses the NCA template
  // client-side and posts each row to /vulnerabilities/nca.
  const [bulkTemplateChoice, setBulkTemplateChoice] = useState<'standard' | 'nca'>('standard');
  const [showBulkChooser, setShowBulkChooser] = useState(false);
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
  const router = useRouter();

  // When user toggles into the NCA template view, backfill bridges for any
  // legacy NCA entries that pre-date the bridge column. Without this, those
  // entries stay invisible in the general view because they have no backing
  // Vulnerability tagged with template_type='NCA Template'.
  useEffect(() => {
    if (registerType !== 'nca') return;
    let cancelled = false;
    apiClient.post('/vulnerabilities/nca/backfill-bridges')
      .then((res) => {
        if (cancelled) return;
        const newly = res.data?.newly_bridged ?? 0;
        if (newly > 0) {
          queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
          queryClient.invalidateQueries({ queryKey: ['vuln-dashboard'] });
        }
      })
      .catch(() => { /* silent — best-effort */ });
    return () => { cancelled = true; };
  }, [registerType, queryClient]);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'vulnerabilities', label: 'Vulnerabilities', icon: Bug },
    { id: 'departments', label: 'Departments', icon: Building2 },
    { id: 'sla', label: 'SLA Config', icon: Clock },
  ];

  const { data: vulnerabilities, isLoading, error } = useQuery({
    queryKey: ['vulnerabilities', statusFilter, severityFilter, showClosed, registerType],
    queryFn: async () => {
      const params: Record<string, unknown> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (severityFilter !== 'all') params.severity = severityFilter;
      // Only forward the closed-toggle when no explicit status filter is set;
      // the backend already gives precedence to status_filter, but skipping
      // the redundant param keeps the URL clean.
      if (statusFilter === 'all') {
        params.include_closed = showClosed;
      }
      // Scope the list to the chosen register type. NCA Template surfaces only
      // bridged NCA vulns; standard surfaces everything that isn't tagged.
      if (registerType === 'nca') {
        params.template_type = 'NCA Template';
      } else {
        params.template_type = '_general';
      }
      const response = await vulnManagementApi.vulnerabilities.getAll(
        params as { status?: string; severity?: string; include_closed?: boolean; template_type?: string }
      );
      return response.data as Vulnerability[];
    },
    placeholderData: keepPreviousData,
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
    const filtered = vulnerabilities.filter((vuln) => {
      const matchesSearch =
        !searchTerm ||
        vuln.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        vuln.cve_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        vuln.cwe_id?.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });

    const SEVERITY_RANK: Record<string, number> = {
      critical: 5, high: 4, medium: 3, low: 2, info: 1,
    };

    const compareValues = (a: Vulnerability, b: Vulnerability): number => {
      switch (sortBy) {
        case 'severity':
          return (SEVERITY_RANK[a.severity?.toLowerCase()] ?? 0) - (SEVERITY_RANK[b.severity?.toLowerCase()] ?? 0);
        case 'due_date': {
          const aTime = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
          const bTime = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
          return aTime - bTime;
        }
        case 'title':
          return (a.title || '').localeCompare(b.title || '');
        case 'created_at':
        default: {
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return aTime - bTime;
        }
      }
    };

    const sorted = [...filtered].sort(compareValues);
    return sortOrder === 'desc' ? sorted.reverse() : sorted;
  }, [vulnerabilities, searchTerm, sortBy, sortOrder]);

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

  // Bulk-upload file handler — preserved verbatim from the old inline toolbar
  // input. Handles both the standard server-side bulk endpoint and the
  // client-side NCA-workbook parse path.
  const handleBulkFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    // ─── NCA Template path — parse client-side, POST each row to /vulnerabilities/nca ───
    if (bulkTemplateChoice === 'nca') {
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });

        // Pick the data sheet (skip Cover Page / Legend)
        let ws: XLSX.WorkSheet | null = null;
        const preferred = wb.SheetNames.find(n => {
          const s = n.toLowerCase();
          return s.includes('register') && !s.includes('legend');
        });
        if (preferred) ws = wb.Sheets[preferred];
        if (!ws) {
          for (const name of wb.SheetNames) {
            const cand = wb.Sheets[name];
            const probe: any[][] = XLSX.utils.sheet_to_json(cand, { header: 1, defval: '' }) as any;
            for (let r = 0; r < Math.min(probe.length, 20); r++) {
              const rowStr = (probe[r] || []).map(c => String(c || '').toLowerCase()).join(' ');
              if (rowStr.includes('vulnerability id') || rowStr.includes('cve number')) { ws = cand; break; }
            }
            if (ws) break;
          }
        }
        if (!ws) throw new Error('Could not find a Vulnerability Register sheet in this workbook');

        // Find the header row inside the chosen sheet
        const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any;
        let headerRowIdx = 0;
        for (let r = 0; r < Math.min(allRows.length, 25); r++) {
          const rowStr = (allRows[r] || []).map(c => String(c || '').toLowerCase()).join(' ');
          if (rowStr.includes('vulnerability id') || rowStr.includes('cve number') || (rowStr.includes('title') && rowStr.includes('owner'))) {
            headerRowIdx = r;
            break;
          }
        }
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '', range: headerRowIdx, raw: false });

        let created = 0;
        const errors: string[] = [];

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const keys = Object.keys(r);
          const ci = (name: string) => {
            const norm = name.toLowerCase().replace(/\s+/g, ' ').trim();
            const key = keys.find(k => k.toLowerCase().replace(/\s+/g, ' ').trim().startsWith(norm));
            return key ? r[key] : undefined;
          };
          const toStr = (v: any) => (v === null || v === undefined || v === '') ? null : String(v).trim() || null;
          const toInt = (v: any) => { const n = parseInt(v); return isNaN(n) ? null : n; };
          const toScore = (v: any) => {
            if (v === null || v === undefined || v === '') return null;
            const matches = String(v).match(/(\d+(?:\.\d+)?)/g);
            if (!matches || matches.length === 0) return null;
            const n = parseFloat(matches[matches.length - 1]);
            return isNaN(n) ? null : n;
          };
          const toDate = (v: any) => {
            if (!v) return null;
            if (v instanceof Date) return v.toISOString().split('T')[0];
            const d = new Date(v);
            return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
          };

          const payload = {
            title:                  toStr(ci('title') ?? ci('vulnerability title')),
            description:            toStr(ci('vulnerability description') ?? ci('description')),
            vendor_link:            toStr(ci('vendor link')),
            cve_number:             toStr(ci('cve number') ?? ci('cve')),
            cve_score:              toScore(ci('cve score') ?? ci('cvss')),
            affected_technology:    toStr(ci('affected technology')),
            affected_assets:        toStr(ci('affected assets')),
            threat_analysis:        toStr(ci('threat analysis')),
            threat_severity:        toInt(ci('threat severity')),
            risk_likelihood:        toInt(ci('risk likelihood')),
            risk_severity:          toInt(ci('risk severity')),
            owner:                  toStr(ci('owner')),
            status:                 toStr(ci('status')) || 'OPEN',
            first_observation_date: toDate(ci('first observation date')),
            due_date:               toDate(ci('due date')),
            resolution_date:        toDate(ci('resolution date')),
            comments:               toStr(ci('comments')),
          };

          const meaningful = [payload.title, payload.description, payload.cve_number, payload.affected_technology, payload.threat_analysis, payload.cve_score, payload.threat_severity, payload.risk_likelihood, payload.risk_severity, payload.owner];
          if (!meaningful.some(v => v !== null && v !== '' && v !== undefined)) continue;

          try {
            await apiClient.post('/vulnerabilities/nca', payload);
            created++;
          } catch {
            errors.push(`Row ${headerRowIdx + i + 2}`);
          }
        }

        queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
        queryClient.invalidateQueries({ queryKey: ['vuln-dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['nca-vuln-entries'] });
        setBulkUploadState('done');
        setBulkUploadMsg(`NCA template: imported ${created} vulnerabilit${created === 1 ? 'y' : 'ies'}${errors.length ? ` · ${errors.length} row error${errors.length > 1 ? 's' : ''}` : ''}.`);
      } catch (err: any) {
        setBulkUploadState('error');
        setBulkUploadMsg(err?.message || 'NCA template upload failed. Please check the file format.');
      } finally {
        if (bulkFileRef.current) bulkFileRef.current.value = '';
        setTimeout(() => { setBulkUploadState('idle'); setBulkUploadMsg(null); }, 7000);
      }
      return;
    }

    // ─── Standard path — server-side bulk upload ────────────────────────
    try {
      const res = await vulnManagementApi.vulnerabilities.bulkUpload(file);
      const d = res.data;
      queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
      queryClient.invalidateQueries({ queryKey: ['vuln-dashboard'] });
      setBulkUploadState('done');
      setBulkUploadMsg(`Successfully imported ${d.created} vulnerabilit${d.created === 1 ? 'y' : 'ies'}${d.skipped ? ` · ${d.skipped} blank/incomplete row${d.skipped === 1 ? '' : 's'} skipped` : ''}${d.errors?.length ? ` · ${d.errors.length} row error${d.errors.length > 1 ? 's' : ''}: ${d.errors.slice(0,2).join('; ')}` : ''}.`);
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
  };

  // CSV template download (preserved from the old toolbar button).
  const downloadTemplate = () => {
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
  };

  // NCA register table (Standard ⇄ NCA switch). Rendered by the workspace when
  // registerType === 'nca'. Preserves the existing expand-row NCA table verbatim.
  const renderNcaRegister = () => {
    if (filteredVulnerabilities.length === 0) {
      return (
        <div className="cw-card rounded-lg p-12 text-center">
          <Bug className="h-12 w-12 text-gray-300 mx-auto" />
          <p className="cw-text-muted mt-4">No vulnerabilities found</p>
          {(searchTerm || statusFilter !== 'all' || severityFilter !== 'all') && (
            <p className="cw-text-muted text-sm mt-2">Try adjusting your search or filters</p>
          )}
        </div>
      );
    }
    return (
      <div className="cw-card rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-subtle)] border-b border-[var(--color-border)]">
              <tr>
                <th className="px-2 py-2 w-8"></th>
                <th className="px-3 py-2 text-left font-semibold cw-text-muted uppercase tracking-wider whitespace-nowrap">Vuln ID</th>
                <th className="px-3 py-2 text-left font-semibold cw-text-muted uppercase tracking-wider">Title</th>
                <th className="px-3 py-2 text-left font-semibold cw-text-muted uppercase tracking-wider whitespace-nowrap">CVE</th>
                <th className="px-3 py-2 text-left font-semibold cw-text-muted uppercase tracking-wider whitespace-nowrap">Risk Level</th>
                <th className="px-3 py-2 text-left font-semibold cw-text-muted uppercase tracking-wider whitespace-nowrap">Status</th>
                <th className="px-3 py-2 text-left font-semibold cw-text-muted uppercase tracking-wider">Owner</th>
                <th className="px-3 py-2 text-left font-semibold cw-text-muted uppercase tracking-wider whitespace-nowrap">Due Date</th>
                <th className="px-3 py-2 text-left font-semibold cw-text-muted uppercase tracking-wider whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filteredVulnerabilities.map((vuln) => {
                const tf = ((vuln as any).template_fields ?? {}) as Record<string, any>;
                const severityStyle = getSeverityStyle(vuln.severity);
                const statusStyle = getStatusStyle(vuln.status);
                const ncaStatus = tf.status || vuln.status;
                const expanded = ncaExpandedRows.has(vuln.id);
                const toggleRow = () => setNcaExpandedRows((prev) => {
                  const next = new Set(prev);
                  if (next.has(vuln.id)) next.delete(vuln.id); else next.add(vuln.id);
                  return next;
                });
                const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString() : '—');
                const detailFields: Array<[string, any]> = [
                  ['Vulnerability Description', vuln.description],
                  ['Vendor Link', tf.vendor_link],
                  ['CVE Number', vuln.cve_id],
                  ['CVE Score', vuln.cvss_score],
                  ['Affected Technology', vuln.affected_component],
                  ['Affected Assets', (vuln.linked_assets && vuln.linked_assets.length > 0 ? vuln.linked_assets.join(', ') : (vuln.affected_host || tf.affected_assets_text))],
                  ['Threat Analysis', tf.threat_analysis],
                  ['Threat Severity', tf.threat_severity],
                  ['Risk Likelihood', tf.risk_likelihood],
                  ['Risk Severity', tf.risk_severity],
                  ['Risk Level', tf.risk_level],
                  ['Owner', vuln.assignee_name],
                  ['Status', ncaStatus],
                  ['First Observation Date', fmtDate(tf.first_observation_date)],
                  ['Due Date', fmtDate(vuln.due_date || tf.due_date)],
                  ['Resolution Date', fmtDate(tf.resolution_date)],
                  ['Comments', tf.comments],
                ];
                return (
                  <Fragment key={vuln.id}>
                    <tr className="bg-white hover:bg-[var(--color-hover)] transition-colors">
                      <td className="px-2 py-2 align-middle">
                        <button onClick={toggleRow} className="text-gray-400 hover:text-gray-700 inline-flex items-center justify-center w-6 h-6 rounded hover:bg-gray-100" aria-label={expanded ? 'Collapse' : 'Expand'}>
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono cw-text-muted whitespace-nowrap">{tf.vuln_identifier || `VULN-${vuln.id}`}</td>
                      <td className="px-3 py-2 max-w-[300px]">
                        <Link href={`/vulnerabilities/${vuln.id}`} className="text-sm cw-text font-medium hover:text-[var(--color-base)] transition-colors line-clamp-1">
                          {vuln.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2 cw-text-muted whitespace-nowrap font-mono">{vuln.cve_id || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${severityStyle.bg} ${severityStyle.text}`}>
                          {tf.risk_level || severityStyle.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${statusStyle.bg} ${statusStyle.text}`}>{ncaStatus}</span>
                      </td>
                      <td className="px-3 py-2 cw-text-muted whitespace-nowrap">{vuln.assignee_name ?? <span className="italic">—</span>}</td>
                      <td className="px-3 py-2 cw-text-muted whitespace-nowrap">{fmtDate(vuln.due_date || tf.due_date)}</td>
                      <td className="px-3 py-2">
                        <Link href={`/vulnerabilities/${vuln.id}`} className="inline-flex items-center justify-center rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[var(--color-base)] transition-colors" title="View Details" aria-label="View Details">
                          <Eye size={16} />
                        </Link>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-primary-50/30">
                        <td></td>
                        <td colSpan={8} className="px-4 py-3">
                          <div className="rounded-lg border border-primary-100 bg-white p-3">
                            <p className="text-xs font-semibold text-primary-700 uppercase tracking-wider mb-2">NCA Template Fields</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                              {detailFields.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== '—').map(([label, value]) => (
                                <div key={label}>
                                  <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{label}</p>
                                  {label === 'Vendor Link' && typeof value === 'string' ? (
                                    <a href={value} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:underline break-all">{value}</a>
                                  ) : (
                                    <p className="text-xs text-gray-800 whitespace-pre-wrap break-words">{String(value)}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // The former register-header chart-derivation memos (severity donut, status
  // bar, SLA gauge, assignee/mitigation/dept breakdowns) were removed with the
  // charts themselves — they duplicated the Overview tab. The `['vuln-dashboard']`
  // query above is preserved and its data now feeds the workspace KPI strip
  // (Total / Open / Overdue / Critical / SLA-compliance) via <VulnsWorkspace />.

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <PageLoader size="md" />
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
      <div className="border-b border-[var(--color-border)] px-3 sm:px-6 py-3">
        {/* Tabs + Register-Type selector — same row, selector right-aligned
            so the operator sees the active register at a glance and can
            switch contexts without scrolling past the toolbar below. */}
        <div className="mb-3 flex items-end justify-between gap-3 border-b border-gray-200 -mx-3 sm:-mx-6 px-3 sm:px-6 overflow-x-auto">
          <div className="flex items-center gap-0 min-w-max">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id as 'overview' | 'vulnerabilities' | 'departments' | 'sla')}
                className={`relative inline-flex items-center gap-1.5 rounded-t-md px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors -mb-px ${
                  activeTab === id
                    ? 'text-primary-700 bg-primary-50/50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-slate-50'
                }`}
              >
                <Icon size={14} />
                {label}
                {activeTab === id && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-600" />
                )}
              </button>
            ))}
          </div>
          {/* Register-type selector now lives in the workspace toolbar below. */}
        </div>

        {/* Overview tab — reuses the standalone Dashboard page component
            verbatim. Conditional mount means its useQuery hooks (with their
            60s refetchInterval) only run while this tab is active. */}
        {activeTab === 'overview' && (
          <div className="mt-3">
            <VulnerabilityDashboardPage />
          </div>
        )}


        {/* The Vulnerabilities register now lives in VulnsWorkspace (rendered in
            the Tab Content section below). The three severity/status/SLA charts
            that used to sit here were moved out — they duplicate the Overview
            tab. Their dashboard data is still fetched and reused by the KPI strip. */}
      </div>

      {/* Tab Content */}
      {activeTab === 'vulnerabilities' && (
      <>
      <div className="px-3 sm:px-6 py-3 bg-[var(--color-subtle)]">
        {/* Hidden bulk-upload file input — driven by the workspace toolbar's
            "Bulk Upload" button via the template chooser (bulkFileRef.click()). */}
        <input
          ref={bulkFileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleBulkFileChange}
        />

        {/* The Vulnerabilities workspace — KPI strip + toolbar (search /
            Status / Severity / Show-closed / register-type / view-switch /
            Template / Bulk-Upload / Add) + Register⇄Workbench. */}
        <VulnsWorkspace
          vulns={vulnerabilities ?? []}
          filteredVulns={filteredVulnerabilities}
          dashboard={dashboard}
          loading={isLoading}
          registerType={registerType}
          setRegisterType={setRegisterType}
          renderNcaRegister={renderNcaRegister}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          severityFilter={severityFilter}
          setSeverityFilter={setSeverityFilter}
          showClosed={showClosed}
          setShowClosed={setShowClosed}
          canCreate={hasPermission('vulnerabilities:vulnerability_register:create')}
          canEdit={hasPermission('vulnerabilities:vulnerability_register:edit')}
          canDelete={hasPermission('vulnerabilities:vulnerability_register:delete')}
          onView={(v) => router.push(`/vulnerabilities/${v.id}`)}
          onOpenFull={(id) => router.push(`/vulnerabilities/${id}`)}
          onBulkAssign={(ids) => { setSelectedVulnIds(new Set(ids)); setShowBulkAssignModal(true); }}
          onTemplate={downloadTemplate}
          onBulkUpload={() => {
            // Default the chooser to whichever register is currently active.
            setBulkTemplateChoice(registerType === 'nca' ? 'nca' : 'standard');
            setShowBulkChooser(true);
          }}
          onAdd={() => {
            // NCA register → NCA-specific add modal; Standard → Add slide-over.
            if (registerType === 'nca') setIsNcaAddOpen(true);
            else setIsModalOpen(true);
          }}
          bulkUploadState={bulkUploadState}
          bulkUploadMsg={bulkUploadMsg}
        />

        {/* legacy inline toolbar + table removed — superseded by VulnsWorkspace */}
      </div>

      {/* Add Vulnerability Slide-over — dimmed backdrop so the page behind stays visible but recedes */}
      {isModalOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 transition-opacity" onClick={() => setIsModalOpen(false)} aria-hidden />
      )}
      <div className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[760px] flex-col bg-white shadow-xl border-l border-slate-200 transform transition-transform duration-300 ${isModalOpen ? 'translate-x-0' : 'translate-x-full'}`}>
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
          ref={addFormRef}
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(new FormData(e.currentTarget));
          }}
          className="flex flex-col flex-1 min-h-0"
        >
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {/* CVE auto-fill banner — surfaced when the title contains a
                CVE-ID or matches a known nickname. One-click pre-fills the
                CVE / CVSS / CWE / severity / description fields below. */}
            {cveLookup?.matched && cveLookup.cve_id && !cveLookupApplied && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-2.5 text-xs flex items-start gap-2.5">
                <Sparkles className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-blue-900">
                    <strong>{cveLookup.cve_id}</strong>
                    {cveLookup.match_source === 'nickname' && ' matched by known nickname.'}
                    {cveLookup.match_source === 'cve_in_title' && ' detected in title.'}
                    {cveLookup.match_source === 'explicit' && ' provided.'}
                    {typeof cveLookup.cvss_score === 'number' && (
                      <> CVSS <strong>{cveLookup.cvss_score.toFixed(1)}</strong>
                      {cveLookup.severity ? <> ({cveLookup.severity})</> : null}
                      {cveLookup.cwe_id ? <>, {cveLookup.cwe_id}</> : null}.</>
                    )}
                  </p>
                  {cveLookup.description && (
                    <p className="text-blue-800/80 mt-1 line-clamp-2" title={cveLookup.description}>
                      {cveLookup.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={applyCveAutoFill}
                  className="flex-shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                  title="Pre-fill CVE / CVSS / CWE / severity / description from NVD. Operator-typed values are preserved."
                >
                  Auto-fill
                </button>
                <button
                  type="button"
                  onClick={() => setCveLookup(null)}
                  className="flex-shrink-0 rounded-md border border-blue-200 bg-white px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                  title="Dismiss"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {cveLookupApplied && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5" />
                Pre-filled from {cveLookup?.cve_id}. Review and adjust before saving.
              </div>
            )}
            {cveLookupLoading && !cveLookup?.matched && titleDraft.trim().length >= 4 && (
              <div className="text-[11px] text-slate-500 italic flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" />
                Looking up CVE…
              </div>
            )}

            {/* Row 1: Title + Description */}
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Title <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  name="title"
                  required
                  placeholder="e.g., SQL Injection in Admin Panel"
                  onChange={(e) => setTitleDraft(e.target.value)}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
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
        <div className="space-y-3 px-3 sm:px-6 py-3 bg-[var(--color-subtle)]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 max-w-md">
              <SearchInput
                value={deptSearchQuery}
                onChange={setDeptSearchQuery}
                placeholder="Search departments..."
                size="md"
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
              <PageLoader size="md" />
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
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
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
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
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
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
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
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
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
        <div className="space-y-3 px-3 sm:px-6 py-3 bg-[var(--color-subtle)]">
          {slaLoading ? (
            <div className="flex h-64 items-center justify-center"><PageLoader size="md" /></div>
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

      {/* Bulk-upload template chooser */}
      <NcaVulnQuickAddModal
        isOpen={isNcaAddOpen}
        onClose={() => setIsNcaAddOpen(false)}
        onCreated={(_entryId, bridgedId) => {
          setIsNcaAddOpen(false);
          queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
          queryClient.invalidateQueries({ queryKey: ['vuln-dashboard'] });
          queryClient.invalidateQueries({ queryKey: ['nca-vuln-entries'] });
          // If a bridged Vulnerability was created, jump straight into its
          // detail page so the user can immediately work mitigations / assets / etc.
          if (bridgedId) {
            router.push(`/vulnerabilities/${bridgedId}`);
          }
        }}
      />

      {showBulkChooser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">Choose template</h2>
              <button onClick={() => setShowBulkChooser(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-gray-600 mb-4">
              Pick the template format of the file you're about to upload. The parser will adapt to that template's column layout.
            </p>
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer ${bulkTemplateChoice === 'standard' ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input
                  type="radio"
                  name="bulk-template"
                  checked={bulkTemplateChoice === 'standard'}
                  onChange={() => setBulkTemplateChoice('standard')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">Standard Vulnerability Register</p>
                  <p className="text-xs text-gray-500 mt-0.5">CSV or Excel with columns: title, description, severity, status, cvss_score, cve_id, etc.</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer ${bulkTemplateChoice === 'nca' ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input
                  type="radio"
                  name="bulk-template"
                  checked={bulkTemplateChoice === 'nca'}
                  onChange={() => setBulkTemplateChoice('nca')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">NCA Vulnerability Template</p>
                  <p className="text-xs text-gray-500 mt-0.5">NCA Saudi cybersecurity template (Vulnerability ID, CVE Score, Threat Severity, etc.)</p>
                </div>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowBulkChooser(false)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowBulkChooser(false);
                  setTimeout(() => bulkFileRef.current?.click(), 0);
                }}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 inline-flex items-center gap-1.5"
              >
                <Upload size={14} /> Choose file
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
