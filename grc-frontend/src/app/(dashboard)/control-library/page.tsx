'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import apiClient, { frameworksApi } from '@/lib/api';
import { useToast } from '@/components/ui';
import ControlSurfaceTabs from '@/components/dashboard/ControlSurfaceTabs';
import {
  Library,
  Loader2,
  AlertCircle,
  Search,
  Plus,
  Brain,
  Sparkles,
  Layers,
  GitMerge,
  Shield,
  ShieldCheck,
  Eye,
  Edit2,
  Trash2,
  FileText,
  X,
  ChevronDown,
  RefreshCw,
  CheckCircle,
  Clock,
  XCircle,
  BarChart3,
  Play,
  Grid3X3,
  TrendingUp,
  Info,
  Filter,
  Check,
  Building2,
  FlaskConical,
} from 'lucide-react';
import Link from 'next/link';
import { ProgressRing, SearchInput, MultiSelectDropdown, PageLoader } from '@/components/ui';

interface ControlGroup {
  id: number;
  tenant_id: number;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  domain: string | null;
  keywords: string[];
  ai_summary: string | null;
  evidence_types: string[];
  normalized_control_count: number;
  framework_control_count: number;
  parsed_control_count: number;
  standalone_control_count: number;
  total_control_count: number;
  created_at: string | null;
  updated_at: string | null;
  created_by: number | null;
}

interface GroupsResponse {
  items: ControlGroup[];
  total: number;
  skip: number;
  limit: number;
}

interface Analysis {
  id: number;
  tenant_id: number;
  analysis_type: string;
  status: string;
  frameworks_analyzed: number[];
  total_controls_analyzed: number;
  mappings_created: number;
  groups_created: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  created_by: number;
}

interface AutoGroupResult {
  message: string;
  groups_created: number;
  groups: ControlGroup[];
  unified_controls?: number;
  standalone?: number;
  controls_covered?: number;
}

// Short framework labels (mirror of the domain-detail page) — used by the
// "Build your view" framework filter so chips read cleanly.
const SF: [string, string][] = [
  ['ARAMCO', 'ARAMCO'], ['COBIT', 'COBIT'], ['Health Information', 'DOH ADHIE'], ['ADHIE', 'DOH ADHIE'],
  ['Abu Dhabi', 'ADHICS'], ['DOH', 'DOH ADHIE'], ['HIPAA', 'HIPAA'], ['HITRUST', 'HITRUST'], ['22301', 'ISO 22301'],
  ['42001', 'ISO 42001'], ['27001', 'ISO 27001'], ['MAS', 'MAS TRM'], ['Artificial Intelligence', 'NIST AI RMF'],
  ['800-53', 'NIST 800-53'], ['Cybersecurity Framework', 'NIST CSF'], ['PCI', 'PCI DSS'], ['Qatar', 'Qatar CB'],
  ['SABIC', 'SABIC'], ['SAMA', 'SAMA'], ['SBP Cloud', 'SBP Cloud'], ['ETGRMF', 'SBP ETGRMF'],
  ['Internet Banking', 'SBP IB'], ['SOX', 'SOX'], ['SWIFT', 'SWIFT'], ['Sri Lanka', 'Sri Lanka'],
  ['Personal Data Transfer', 'KSA Transfer'], ['CIS', 'CIS'], ['General Data', 'GDPR'],
  ['National Data', 'KSA NDMO'], ['Digital Operational', 'DORA'], ['NIS2', 'NIS2'], ['SOC', 'SOC 2'],
];
const sf = (f: string) => { for (const [k, v] of SF) if ((f || '').includes(k)) return v; return (f || '').split(' ')[0]; };

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle }> = {
  completed: { bg: 'bg-green-500/20', text: 'text-green-400', icon: CheckCircle },
  processing: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: RefreshCw },
  failed: { bg: 'bg-red-500/20', text: 'text-red-400', icon: XCircle },
  pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: Clock },
};

export default function ControlLibraryPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('controls:control_library:create');
  const canEdit = hasPermission('controls:control_library:edit');
  const canDelete = hasPermission('controls:control_library:delete');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [showEmptyGroups, setShowEmptyGroups] = useState(true);
  const [page, setPage] = useState(0);
  // Load all groups so the Domain → Unified → Framework grouping shows each
  // domain complete (otherwise domains split across paginated pages).
  const [pageSize] = useState(200);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  // "Build your view" — live, client-side framework filter over the whole
  // library (no backend re-run). pickedFw = [] means the full library.
  // Persisted in the URL (?fw=…) so a page refresh keeps the selection and the
  // filtered view is shareable. Read synchronously on the client at first render.
  const [showBuild, setShowBuild] = useState(false);
  const [pickedFw, setPickedFw] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    const fw = new URLSearchParams(window.location.search).get('fw');
    return fw ? fw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  });
  // Keep the URL in sync with the selection so refresh/share preserves it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (pickedFw.length) url.searchParams.set('fw', pickedFw.join(','));
    else url.searchParams.delete('fw');
    window.history.replaceState(null, '', url.toString());
  }, [pickedFw]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAutoGroupModal, setShowAutoGroupModal] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ControlGroup | null>(null);

  const [newGroup, setNewGroup] = useState({
    code: '',
    name: '',
    description: '',
    category: '',
    domain: '',
  });

  const [selectedFrameworks, setSelectedFrameworks] = useState<number[]>([]);
  // Which normalization session (run) the library view is scoped to. null =
  // the owner's master baseline (default). Custom framework-selected sessions
  // are isolated runs the user can switch to.
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const { data: sessionsData } = useQuery({
    queryKey: ['normalization-sessions'],
    queryFn: async () =>
      (await apiClient.get('/control-library/groups/sessions')).data.sessions as Array<{
        id: number; label: string; scope: string; is_baseline: boolean;
        unified_controls: number; framework_ids: number[] | null;
      }>,
  });

  // Delete a custom scoped SESSION (never the baseline — backend guards it too).
  const deleteSession = useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/control-library/groups/sessions/${id}`),
    onSuccess: () => {
      setSelectedRunId(null);   // fall back to the master baseline view
      setPage(0);
      queryClient.invalidateQueries({ queryKey: ['normalization-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['control-groups'] });
    },
  });

  // ── Create / rebuild the MASTER BASELINE (first-time normalization) ──
  // Builds a CANDIDATE run (not live); the admin reviews it then Promotes it.
  const [baselineBuild, setBaselineBuild] = useState<{ message: string; percent: number; status: string; jobId?: string } | null>(null);
  const baselinePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const createBaseline = useMutation({
    mutationFn: async (confirm: string) =>
      (await apiClient.post('/control-library/groups/baseline/build-dispatch', { confirm })).data,
    onSuccess: (data: any) => {
      const jobId = data?.job_id;
      if (!jobId) return;
      setBaselineBuild({ message: 'Starting baseline build…', percent: 1, status: 'running', jobId });
      if (baselinePollRef.current) clearInterval(baselinePollRef.current);
      baselinePollRef.current = setInterval(async () => {
        try {
          const st = (await apiClient.get(`/control-library/groups/baseline/build-status/${jobId}`)).data || {};
          setBaselineBuild({ message: st.message || st.phase || 'Working…', percent: Math.max(1, Math.min(100, st.progress_percent ?? 1)), status: st.status, jobId });
          if (st.status === 'completed' || st.status === 'failed' || st.status === 'cancelled') {
            if (baselinePollRef.current) clearInterval(baselinePollRef.current);
            baselinePollRef.current = null;
            if (st.status === 'completed' && typeof st.run_id === 'number') {
              setSelectedRunId(st.run_id);   // switch to the candidate so the admin can review it
              setPage(0);
              queryClient.invalidateQueries({ queryKey: ['normalization-sessions'] });
              queryClient.invalidateQueries({ queryKey: ['control-groups'] });
            }
            setTimeout(() => setBaselineBuild(null), 6000);
          }
        } catch { /* transient */ }
      }, 2500);
    },
    onError: (err: any) => setBaselineBuild({
      message: err?.response?.data?.detail?.message
        || err?.response?.data?.message
        || 'Failed to start baseline build.',
      percent: 100, status: 'failed',
    }),
  });
  // Stop a running/queued master-baseline build (sets a cancel flag the worker
  // checks between phases; the live baseline is never touched).
  const cancelBaseline = useMutation({
    mutationFn: async (jobId: string) =>
      (await apiClient.post(`/control-library/groups/baseline/build-cancel/${jobId}`)).data,
    onSuccess: (data: any) => {
      setBaselineBuild((prev) => prev ? { ...prev, status: data?.status || 'cancelling', message: data?.status === 'cancelled' ? 'Build cancelled.' : 'Cancelling — stopping after the current phase…' } : prev);
      if (data?.status === 'cancelled') {
        if (baselinePollRef.current) clearInterval(baselinePollRef.current);
        baselinePollRef.current = null;
        setTimeout(() => setBaselineBuild(null), 4000);
      }
    },
  });
  // Promote the selected candidate run to be the live master baseline.
  const promoteBaseline = useMutation({
    mutationFn: async (id: number) => (await apiClient.post(`/control-library/groups/baseline/promote/${id}`)).data,
    onSuccess: () => {
      setSelectedRunId(null);   // baseline view
      setPage(0);
      queryClient.invalidateQueries({ queryKey: ['normalization-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['control-groups'] });
    },
  });

  const { data: groupsData, isLoading: groupsLoading, error: groupsError, refetch: refetchGroups } = useQuery({
    queryKey: ['control-groups', searchTerm, categoryFilter, domainFilter, page, pageSize, selectedRunId],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        skip: page * pageSize,
        limit: pageSize,
      };
      if (searchTerm) params.search = searchTerm;
      if (categoryFilter) params.category = categoryFilter;
      if (domainFilter) params.domain = domainFilter;
      if (selectedRunId) params.run_id = selectedRunId;
      const response = await apiClient.get('/control-library/groups', { params });
      return response.data as GroupsResponse;
    },
  });

  const { data: categories } = useQuery({
    queryKey: ['control-group-categories'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/groups/categories');
      return response.data.categories as string[];
    },
  });

  const { data: domains } = useQuery({
    queryKey: ['control-group-domains'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/groups/domains');
      return response.data.domains as string[];
    },
  });

  const { data: availableFrameworks } = useQuery({
    queryKey: ['available-frameworks-count'],
    queryFn: async () => {
      const response = await frameworksApi.getAvailable();
      return response.data || [];
    },
  });

  const { data: latestAnalysis } = useQuery({
    queryKey: ['latest-ai-analysis'],
    queryFn: async () => {
      try {
        const response = await apiClient.get('/control-library/ai-mapping/similarities', { params: { limit: 1 } });
        return response.data;
      } catch {
        return null;
      }
    },
  });

  const { data: gapDashboard } = useQuery({
    queryKey: ['gap-analysis-dashboard'],
    queryFn: async () => {
      try {
        const response = await apiClient.get('/control-library/gap-analysis/dashboard');
        return response.data;
      } catch {
        return null;
      }
    },
  });

  // ── "Build your view" coverage index ────────────────────────────────────
  // Lazily pulls the per-domain framework breakdown (one /rich per domain) the
  // first time the filter is opened, then everything below is client-side.
  const buildEnabled = showBuild || pickedFw.length > 0;
  const { data: coverage, isFetching: coverageLoading } = useQuery({
    queryKey: ['cl-build-coverage', selectedRunId],
    enabled: buildEnabled && !!groupsData?.items?.length,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const items = groupsData!.items;
      const results = await Promise.all(items.map((g) =>
        apiClient.get(`/control-library/groups/${g.id}/rich`).then((r) => ({ id: g.id, d: r.data })).catch(() => null)
      ));
      const byDomain: Record<number, { sets: string[][]; standalone: string[] }> = {};
      const fwTotals: Record<string, number> = {};
      for (const res of results) {
        if (!res) continue;
        const sets: string[][] = (res.d.sets || []).map((s: any) =>
          Array.from(new Set((s.members || []).map((m: any) => sf(m.framework)))) as string[]);
        const standalone: string[] = (res.d.standalone_controls || []).map((s: any) => sf(s.members?.[0]?.framework || ''));
        byDomain[res.id] = { sets, standalone };
        // Per-framework unified-entry count (a set counts once per member framework).
        sets.forEach((fws) => fws.forEach((f) => { fwTotals[f] = (fwTotals[f] || 0) + 1; }));
        standalone.forEach((f) => { fwTotals[f] = (fwTotals[f] || 0) + 1; });
      }
      const frameworks = Object.keys(fwTotals).sort();
      return { byDomain, frameworks, fwTotals };
    },
  });

  const filterActive = pickedFw.length > 0;
  // Per-domain counts recomputed for the picked frameworks (sets that include
  // at least one picked framework + standalone controls of a picked framework).
  const filteredStatFor = (groupId: number) => {
    const cov = coverage?.byDomain?.[groupId];
    if (!cov) return null;
    const sets = cov.sets.filter((fws) => fws.some((f) => pickedFw.includes(f))).length;
    const standalone = cov.standalone.filter((f) => pickedFw.includes(f)).length;
    return { sets, standalone, total: sets + standalone };
  };

  const createGroupMutation = useMutation({
    mutationFn: (data: typeof newGroup) => apiClient.post('/control-library/groups', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-groups'] });
      queryClient.invalidateQueries({ queryKey: ['control-group-categories'] });
      queryClient.invalidateQueries({ queryKey: ['control-group-domains'] });
      setShowCreateModal(false);
      setNewGroup({ code: '', name: '', description: '', category: '', domain: '' });
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ControlGroup> }) =>
      apiClient.put(`/control-library/groups/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-groups'] });
      setEditingGroup(null);
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/control-library/groups/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-groups'] });
    },
  });

  const generateSummaryMutation = useMutation({
    mutationFn: (id: number) => apiClient.post(`/control-library/groups/${id}/generate-summary`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-groups'] });
    },
  });

  const [autoGroupResult, setAutoGroupResult] = useState<AutoGroupResult | null>(null);
  const [autoGroupLoading, setAutoGroupLoading] = useState(false);
  const [autoGroupError, setAutoGroupError] = useState<string | null>(null);
  const [autoGroupProgress, setAutoGroupProgress] = useState<string | null>(null);
  const [autoGroupPercent, setAutoGroupPercent] = useState<number>(0);
  const [autoGroupPhase, setAutoGroupPhase] = useState<string | null>(null);
  const autoGroupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stop polling when leaving the page so we don't leak intervals.
  useEffect(() => {
    return () => {
      if (autoGroupPollRef.current) {
        clearInterval(autoGroupPollRef.current);
        autoGroupPollRef.current = null;
      }
    };
  }, []);

  const autoGroupMutation = useMutation({
    mutationFn: async (frameworkIds: number[]) => {
      setAutoGroupLoading(true);
      setAutoGroupError(null);
      setAutoGroupResult(null);
      setAutoGroupProgress('Starting…');
      setAutoGroupPercent(1);
      setAutoGroupPhase('queued');
      const dispatch = await apiClient.post('/control-library/groups/auto-group/dispatch', {
        framework_ids: frameworkIds.length > 0 ? frameworkIds : null,
      });
      const jobId = dispatch.data?.job_id;
      if (!jobId) throw new Error('Dispatch did not return a job id');
      return jobId as string;
    },
    onSuccess: (jobId: string) => {
      // Surface the job in the persistent background banner immediately.
      queryClient.invalidateQueries({ queryKey: ['auto-group-active'] });
      // Poll status every 1.5s. The dialog auto-closes 1.2s after the job
      // finishes so the user sees the success/error state briefly.
      if (autoGroupPollRef.current) clearInterval(autoGroupPollRef.current);
      autoGroupPollRef.current = setInterval(async () => {
        try {
          const res = await apiClient.get(`/control-library/groups/auto-group/status/${jobId}`);
          const data = res.data || {};
          const status = data.status as string | undefined;
          if (typeof data.progress_percent === 'number') {
            setAutoGroupPercent(Math.max(1, Math.min(100, data.progress_percent)));
          }
          if (data.phase) setAutoGroupPhase(String(data.phase));
          setAutoGroupProgress(data.message || status || 'Working…');

          if (status === 'completed' || status === 'failed' || status === 'skipped') {
            if (autoGroupPollRef.current) clearInterval(autoGroupPollRef.current);
            autoGroupPollRef.current = null;
            setAutoGroupLoading(false);
            setAutoGroupPercent(100);
            if (status === 'completed') {
              const summary = data.summary || {};
              setAutoGroupResult({
                message: data.message || 'Auto-grouping completed',
                groups_created: summary.unified_controls ?? summary.created_count ?? 0,
                groups_merged: summary.merged_count || 0,
                groups: [],
                unified_controls: summary.unified_controls ?? 0,
                standalone: summary.standalone ?? 0,
                controls_covered: summary.controls_covered
                  ?? ((summary.unified_controls ?? 0) + (summary.standalone ?? 0)),
              } as AutoGroupResult);
              // A scoped session returns its own run id — switch the view to it
              // (the master baseline stays intact and selectable).
              if (typeof data.run_id === 'number') setSelectedRunId(data.run_id);
              queryClient.invalidateQueries({ queryKey: ['normalization-sessions'] });
              queryClient.invalidateQueries({ queryKey: ['control-groups'] });
            } else {
              setAutoGroupError(data.error || data.message || 'Auto-grouping failed');
            }
            // Auto-close dialog after a brief delay so user sees the toast.
            setTimeout(() => {
              setShowAutoGroupModal(false);
              setAutoGroupResult(null);
              setAutoGroupError(null);
              setAutoGroupProgress(null);
              setAutoGroupPercent(0);
              setAutoGroupPhase(null);
            }, 1500);
          }
        } catch {
          /* transient — try again on next tick */
        }
      }, 1500);
    },
    onError: (error: any) => {
      setAutoGroupLoading(false);
      setAutoGroupProgress(null);
      setAutoGroupPercent(0);
      const errorMessage = error?.response?.data?.detail?.message
        || error?.response?.data?.detail
        || error?.response?.data?.message
        || error?.message
        || 'An error occurred while auto-grouping controls';
      setAutoGroupError(errorMessage);
    },
  });

  const [analysisResult, setAnalysisResult] = useState<Analysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const startAnalysisMutation = useMutation({
    mutationFn: async (frameworkIds: number[]) => {
      setAnalysisLoading(true);
      setAnalysisError(null);
      const response = await apiClient.post('/control-library/ai-mapping/analyze', {
        framework_ids: frameworkIds.length > 0 ? frameworkIds : null,
      });
      return response.data as Analysis;
    },
    onSuccess: (data) => {
      setAnalysisResult(data);
      setAnalysisLoading(false);
      queryClient.invalidateQueries({ queryKey: ['latest-ai-analysis'] });
    },
    onError: (error: any) => {
      setAnalysisLoading(false);
      const errorMessage = error?.response?.data?.detail?.message 
        || error?.response?.data?.detail 
        || error?.response?.data?.message 
        || error?.message 
        || 'An error occurred while analyzing controls';
      setAnalysisError(errorMessage);
    },
  });

  const populateFromFrameworksMutation = useMutation({
    mutationFn: () => apiClient.post('/control-library/groups/populate-all-groups'),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['control-groups'] });
      const added = res.data?.total_added;
      if (typeof added === 'number') {
        toast({
          type: added > 0 ? 'success' : 'info',
          title: added > 0 ? 'Frameworks populated' : 'No new matches',
          message: added > 0
            ? `Added ${added} framework control(s) to your existing groups.`
            : 'Existing groups already cover every framework control. Try AI Auto-Grouping to surface new themes.',
        });
      }
    },
    onError: (err: any) => {
      // The backend returns a structured 400 when there are no groups to
      // populate (operator clicked Populate before running AI Auto-Grouping).
      // Surface a clear toast pointing at the right next step.
      const detail = err?.response?.data?.detail;
      const message = typeof detail === 'object'
        ? (detail.message || 'Unable to populate from frameworks.')
        : (detail || err?.message || 'Unable to populate from frameworks.');
      toast({
        type: 'error',
        title: 'Nothing to populate',
        message,
      });
    },
  });

  const handleDeleteGroup = (group: ControlGroup) => {
    if (confirm(`Are you sure you want to delete "${group.name}"?`)) {
      deleteGroupMutation.mutate(group.id);
    }
  };

  const totalGroups = groupsData?.total || 0;
  // True total across ALL groups (from the API), not just the current page.
  const totalControls = (groupsData as { total_mapped_controls?: number } | undefined)?.total_mapped_controls
    ?? groupsData?.items?.reduce((sum, g) => sum + g.total_control_count, 0) ?? 0;

  const filteredGroups = (() => {
    const base = (showEmptyGroups
      ? groupsData?.items
      : groupsData?.items?.filter(g => g.total_control_count > 0)) || [];
    // Apply the "Build your view" framework filter: recompute each domain's
    // sets/standalone for the picked frameworks and drop domains with none.
    if (!filterActive || !coverage) return base;
    return base
      .map((g) => {
        const f = filteredStatFor(g.id);
        if (!f) return null;
        return { ...g, normalized_control_count: f.total, standalone_control_count: f.standalone, total_control_count: f.total } as ControlGroup;
      })
      .filter((g): g is ControlGroup => !!g && g.total_control_count > 0);
  })();

  // Library totals shown in the header — scoped to the filter when active.
  const filteredControls = filterActive && coverage
    ? filteredGroups.reduce((a, g) => a + g.total_control_count, 0) : 0;
  const filteredDomains = filterActive && coverage ? filteredGroups.length : 0;
  const scoped = filterActive && !!coverage;
  const dispDomains = scoped ? filteredDomains : totalGroups;
  const dispControls = scoped ? filteredControls : totalControls;
  const dispSetsScoped = scoped
    ? filteredGroups.reduce((a, g) => a + Math.max(0, (g.normalized_control_count ?? 0) - (g.standalone_control_count ?? 0)), 0) : 0;
  const dispStandaloneScoped = scoped
    ? filteredGroups.reduce((a, g) => a + (g.standalone_control_count ?? 0), 0) : 0;

  const totalPages = Math.ceil((groupsData?.total || 0) / pageSize);

  const getGroupCompletionPercent = (group: ControlGroup) => {
    if (group.total_control_count === 0) return 0;
    const hasDescription = group.description ? 20 : 0;
    const hasCategory = group.category ? 20 : 0;
    const hasDomain = group.domain ? 20 : 0;
    const hasKeywords = (group.keywords?.length || 0) > 0 ? 20 : 0;
    const hasControls = group.total_control_count > 0 ? 20 : 0;
    return hasDescription + hasCategory + hasDomain + hasKeywords + hasControls;
  };

  const averageCompletion = useMemo(() => {
    if (!groupsData?.items?.length) return 0;
    const sum = groupsData.items.reduce((acc, g) => acc + getGroupCompletionPercent(g), 0);
    return Math.round(sum / groupsData.items.length);
  }, [groupsData]);

  // Library-wide normalization split (meaningful headline metrics).
  const libStats = useMemo(() => {
    const items = groupsData?.items || [];
    const standalone = items.reduce((a, g) => a + (g.standalone_control_count ?? 0), 0);
    const sets = items.reduce((a, g) => a + Math.max(0, (g.normalized_control_count ?? 0) - (g.standalone_control_count ?? 0)), 0);
    return { sets, standalone };
  }, [groupsData]);
  // Headline set/standalone counts, scoped to the framework filter when active.
  const dispSets = scoped ? dispSetsScoped : libStats.sets;
  const dispStandalone = scoped ? dispStandaloneScoped : libStats.standalone;

  // Reconciliation for the framework filter: the picked frameworks' raw controls
  // (sum of per-framework counts) collapse into fewer *unified* entries whenever
  // frameworks share a requirement (deduped into one set). Surfacing this stops
  // "162 + 35 + 153 = 350 but only 312 mapped" from looking like missing controls.
  // Unscoped raw total comes from the backend (all original framework controls
  // behind the library) so the default page can reconcile raw → unified too.
  const rawAll = (groupsData as { total_raw_controls?: number } | undefined)?.total_raw_controls ?? 0;
  const dispRawTotal = scoped ? pickedFw.reduce((a, f) => a + (coverage?.fwTotals?.[f] ?? 0), 0) : rawAll;
  const dispShared = Math.max(0, dispRawTotal - dispControls);
  // How many distinct requirements are repeated across 2+ of the picked frameworks
  // (these are the ones whose duplicate copies get merged away).
  const sharedReqs = scoped && coverage
    ? Object.values(coverage.byDomain).reduce((n, d) =>
        n + d.sets.filter((fws) => fws.filter((f) => pickedFw.includes(f)).length >= 2).length, 0)
    : 0;

  // Carry the active framework filter into a domain so drilling in stays scoped.
  const domainHref = (gid: number) => (filterActive && pickedFw.length)
    ? `/control-library/${gid}?fw=${encodeURIComponent(pickedFw.join(','))}`
    : `/control-library/${gid}`;

  // Category/Domain filter options derived from the REAL groups (the /categories
  // and /domains endpoints still return stale legacy values from old runs).
  const realCategoryOpts = useMemo(
    () => Array.from(new Set((groupsData?.items || []).map((g) => g.category).filter(Boolean) as string[])).sort(),
    [groupsData]);
  const realDomainOpts = useMemo(
    () => Array.from(new Set((groupsData?.items || []).map((g) => g.domain).filter(Boolean) as string[])).sort(),
    [groupsData]);

  // ── Persistent auto-group job tracking — survives dialog close / page reload.
  // Polls the tenant's latest job; shows a banner with progress + a Stop button
  // for as long as a job is in flight, even if the user closed the dialog.
  const { data: activeJob } = useQuery<any>({
    queryKey: ['auto-group-active'],
    queryFn: async () => (await apiClient.get('/control-library/groups/auto-group/active')).data,
    refetchInterval: (q) => (((q.state.data as any)?.active) ? 2500 : false),
  });
  const stopAutoGroup = useMutation({
    mutationFn: async (jobId: string) =>
      (await apiClient.post(`/control-library/groups/auto-group/cancel/${jobId}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auto-group-active'] }),
  });
  // When an in-flight job finishes (active true -> false), refresh the groups.
  const prevActiveRef = useRef(false);
  useEffect(() => {
    const isActive = !!activeJob?.active;
    if (prevActiveRef.current && !isActive) {
      queryClient.invalidateQueries({ queryKey: ['control-groups'] });
    }
    prevActiveRef.current = isActive;
  }, [activeJob?.active, queryClient]);

  return (
    <div className="space-y-5">
      <ControlSurfaceTabs active="library" />
      {/* Master-baseline build progress (first-time / rebuild normalization). */}
      {baselineBuild && (
        <div className={`rounded-xl border px-4 py-3 shadow-sm ${baselineBuild.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-primary-200 bg-gradient-to-r from-primary-50 to-white'}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">
              {baselineBuild.status === 'completed' ? 'Baseline candidate ready — review it, then “Promote to baseline”.'
                : baselineBuild.status === 'failed' ? 'Baseline build failed.'
                : baselineBuild.status === 'cancelled' ? 'Baseline build cancelled.'
                : baselineBuild.status === 'cancelling' ? 'Cancelling baseline build…'
                : 'Building master-baseline candidate…'}
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-sm font-bold tabular-nums text-primary-700">{baselineBuild.percent}%</span>
              {(baselineBuild.status === 'running' || baselineBuild.status === 'cancelling') && baselineBuild.jobId && (
                <button
                  onClick={() => cancelBaseline.mutate(baselineBuild.jobId!)}
                  disabled={cancelBaseline.isPending || baselineBuild.status === 'cancelling'}
                  title="Stop the baseline build"
                  className="flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" /> Stop
                </button>
              )}
            </div>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">{baselineBuild.message}</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-primary-100">
            <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-700 transition-all" style={{ width: `${baselineBuild.percent}%` }} />
          </div>
        </div>
      )}
      {/* Persistent auto-group progress banner — visible even after closing the
          dialog or reloading, with a Stop button. */}
      {activeJob?.active && activeJob?.job_id && (
        <div className="rounded-xl border border-primary-200 bg-gradient-to-r from-primary-50 to-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100">
                <Loader2 className="h-4 w-4 animate-spin text-primary-700" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  Building Unified View {activeJob.status === 'cancelling' ? '— stopping…' : '(filtering frameworks)'}
                </p>
                <p className="truncate text-xs text-slate-500">{activeJob.message || activeJob.phase || 'Working…'}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-sm font-bold tabular-nums text-primary-700">
                {Math.max(1, Math.min(100, activeJob.progress_percent ?? 1))}%
              </span>
              <button
                onClick={() => stopAutoGroup.mutate(activeJob.job_id)}
                disabled={stopAutoGroup.isPending || activeJob.status === 'cancelling'}
                className="flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" /> Stop
              </button>
            </div>
          </div>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-primary-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-700 transition-all"
              style={{ width: `${Math.max(1, Math.min(100, activeJob.progress_percent ?? 1))}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">
            Safe to leave this page — the job keeps running. You can Stop it anytime, or start a new view from “Build Unified View”.
          </p>
        </div>
      )}
      <div className="relative rounded-2xl bg-gradient-to-br from-primary-600 via-primary-700 to-primary-800 px-5 py-4 shadow-lg sm:px-6 sm:py-5">
        {/* clip ONLY the decorative blur circles, so the Build-view dropdown can overflow the banner */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute -right-20 -top-24 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-20 right-40 h-44 w-44 rounded-full bg-white/5 blur-2xl" />
        </div>
        <div className="relative flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 shadow-sm ring-1 ring-white/25 backdrop-blur">
            <Library className="h-6 w-6 text-white" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-white sm:text-2xl">Unified Control Library</h1>
            <p className="max-w-md text-sm text-primary-100">Unified, de-duplicated controls across all 30 frameworks — filter to any subset</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:max-w-2xl lg:justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/15 px-3 py-2 text-sm font-medium text-white backdrop-blur">
            {filterActive
              ? <><Filter className="h-4 w-4" /> {coverageLoading ? '…' : dispShared > 0
                  ? <>Filtered · {dispRawTotal} controls → {filteredControls} unified · {dispShared} duplicates merged</>
                  : <>Filtered · {filteredControls} of {totalControls} unified controls</>}</>
              : <><CheckCircle className="h-4 w-4" /> Active library · {groupsLoading ? '—' : totalControls} unified controls</>}
          </span>
          <div className="relative">
            <button
              onClick={() => setShowBuild((v) => !v)}
              title="Pick frameworks to scope the whole library"
              className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium backdrop-blur ${filterActive || showBuild ? 'border-white bg-white text-primary-700' : 'border-white/25 bg-white/15 text-white hover:bg-white/25'}`}
            >
              <Filter size={16} />
              {filterActive ? `${pickedFw.length} framework${pickedFw.length === 1 ? '' : 's'}` : 'Build your view'}
              <ChevronDown size={15} className={showBuild ? 'rotate-180 transition' : 'transition'} />
            </button>
            {showBuild && (
              <>
                <button className="fixed inset-0 z-30 cursor-default" aria-hidden onClick={() => setShowBuild(false)} />
                <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Filter className="h-3.5 w-3.5 text-primary-600" />Build your view</span>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <button onClick={() => setPickedFw(coverage?.frameworks || [])} disabled={!coverage} className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40">All</button>
                      <button onClick={() => setPickedFw([])} className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100">Clear</button>
                    </div>
                  </div>
                  {coverageLoading && !coverage ? (
                    <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading framework coverage…</div>
                  ) : (
                    <div className="max-h-72 overflow-auto p-1.5">
                      {(coverage?.frameworks || []).map((f) => {
                        const on = pickedFw.includes(f);
                        const count = coverage?.fwTotals?.[f] ?? 0;
                        return (
                          <button key={f} onClick={() => setPickedFw((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f])} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50">
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'}`}>{on && <Check className="h-3 w-3" />}</span>
                            <span className="flex-1 truncate text-[12.5px] text-slate-700">{f}</span>
                            <span className="rounded-full bg-slate-100 px-1.5 text-[10.5px] tabular-nums text-slate-500">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">{filterActive ? <span className="font-medium text-primary-700">{pickedFw.length} selected · {coverageLoading ? '…' : filteredControls} controls · {filteredDomains} domains</span> : 'All frameworks shown'}</div>
                </div>
              </>
            )}
          </div>
          {/* Delete the selected scoped session (the master baseline has no run id
              selected, so this only ever appears for disposable sessions). */}
          {selectedRunId && (
            <button
              onClick={() => {
                const s = sessionsData?.find((x) => x.id === selectedRunId);
                if (window.confirm(`Delete session "${s?.label ?? 'this session'}"? This removes the scoped view only — the master baseline is untouched.`)) {
                  deleteSession.mutate(selectedRunId);
                }
              }}
              disabled={deleteSession.isPending}
              title="Delete this scoped session"
              className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={16} />
              {deleteSession.isPending ? 'Deleting…' : 'Delete session'}
            </button>
          )}
          {/* Promote a full candidate run (built via 'Create Master Baseline') to be
              the live baseline. Only for full-scope, non-baseline runs. */}
          {selectedRunId && sessionsData?.find((x) => x.id === selectedRunId)?.scope === 'full'
            && !sessionsData?.find((x) => x.id === selectedRunId)?.is_baseline && (
            <button
              onClick={() => {
                if (window.confirm('Promote this candidate to be the live Master Baseline? The current baseline becomes a switchable session (not deleted).')) {
                  promoteBaseline.mutate(selectedRunId);
                }
              }}
              disabled={promoteBaseline.isPending}
              title="Make this run the live master baseline"
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle size={16} />
              {promoteBaseline.isPending ? 'Promoting…' : 'Promote to baseline'}
            </button>
          )}
          <Link
            href="/control-library/review"
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <ShieldCheck size={18} />
            Review Master List
          </Link>
          <Link
            href="/controls?promote=1"
            title="Move verified normalized controls into the working Control Catalog"
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-violet-700"
          >
            <CheckCircle size={18} />
            Promote to Catalog
          </Link>
          {/* Stale pipeline actions (Build Unified View, Create/Rebuild Master Baseline,
              Create Group, Populate from Frameworks) removed — the library is seeded and
              locked, so it is browsed and reviewed, not built in the UI. */}
          {/* <button
            onClick={() => {
              setAnalysisResult(null);
              setShowAnalysisModal(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 font-medium text-black hover:bg-gray-200"
          >
            <Brain size={18} />
            Run AI Analysis
          </button> */}
        </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-white/15 pt-3 text-xs font-semibold text-white">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-white/20">
            <Library className="h-3.5 w-3.5" />{groupsLoading ? '—' : dispDomains} domains
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-white/20">
            <GitMerge className="h-3.5 w-3.5" />{groupsLoading ? '—' : dispControls} unified controls
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-white/20">
            <Shield className="h-3.5 w-3.5" />{groupsLoading ? '—' : (filterActive ? pickedFw.length : (availableFrameworks?.length || 0))} frameworks
          </span>
          <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-primary-50 ring-1 ring-white/15 sm:inline-flex">
            <Sparkles className="h-3.5 w-3.5" />AI-normalized · filter any subset, no re-run
          </span>
        </div>
      </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {/* Control Domains */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary-500 to-primary-700" />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-none text-slate-900 tabular-nums">{groupsLoading ? '—' : dispDomains}</p>
              <p className="mt-1.5 text-xs font-semibold text-slate-600">Control Domains</p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm transition-transform group-hover:scale-105">
              <Library className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Grouped by topic area</p>
        </div>
        {/* Mapped Controls */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-500 to-blue-600" />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-none text-slate-900 tabular-nums">{groupsLoading ? '—' : dispControls}</p>
              <p className="mt-1.5 text-xs font-semibold text-slate-600">Unified Controls</p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-sm transition-transform group-hover:scale-105">
              <GitMerge className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            {dispRawTotal > 0 && dispShared > 0
              ? <>from <span className="font-semibold text-slate-500">{dispRawTotal.toLocaleString()}</span> framework controls · <span className="font-semibold text-emerald-600">{dispShared.toLocaleString()} duplicates merged</span></>
              : 'Distinct across all frameworks'}
          </p>
        </div>
        {/* Frameworks */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-600" />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-none text-slate-900 tabular-nums">{groupsLoading ? '—' : (filterActive ? pickedFw.length : (availableFrameworks?.length || 0))}</p>
              <p className="mt-1.5 text-xs font-semibold text-slate-600">Frameworks Covered</p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm transition-transform group-hover:scale-105">
              <Layers className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Compliance standards</p>
        </div>
        {/* Normalized sets */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary-500 to-primary-700" />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-none text-slate-900 tabular-nums">{groupsLoading ? '—' : dispSets}</p>
              <p className="mt-1.5 text-xs font-semibold text-slate-600">Shared</p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm transition-transform group-hover:scale-105">
              <GitMerge className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">of the {groupsLoading ? '—' : dispControls.toLocaleString()} unified · required by 2+ frameworks</p>
        </div>
        {/* Standalone */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-slate-400 to-slate-600" />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-none text-slate-900 tabular-nums">{groupsLoading ? '—' : dispStandalone}</p>
              <p className="mt-1.5 text-xs font-semibold text-slate-600">Unique</p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-400 to-slate-600 text-white shadow-sm transition-transform group-hover:scale-105">
              <Shield className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">of the {groupsLoading ? '—' : dispControls.toLocaleString()} unified · required by one framework</p>
        </div>
      </div>

      {/* Plain-English reconciliation — shown whenever dedup happened (default
          library view AND filtered views). Turns "426 + 1906 + 2332 = 4664?!"
          and "350 vs 312" confusion into a visible sum. */}
      {dispShared > 0 && dispRawTotal > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Info className="h-4 w-4" />
            </span>
            <h4 className="text-[13px] font-bold text-slate-800">Why {dispControls.toLocaleString()}, not {dispRawTotal.toLocaleString()}?</h4>
          </div>
          <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-slate-600">
            {scoped ? `Your ${pickedFw.length} frameworks` : `Your ${availableFrameworks?.length || 0} frameworks`} list{' '}
            <b className="text-slate-800">{dispRawTotal.toLocaleString()}</b> controls in total — but{' '}
            <b className="text-slate-800">{(scoped ? sharedReqs : dispSets).toLocaleString()}</b> of those requirements are repeated across them (the same requirement
            listed separately by several frameworks). Counting each one once removes{' '}
            <b className="text-slate-800">{dispShared.toLocaleString()}</b> duplicate copies. Nothing is deleted — every framework&apos;s controls still
            exist individually. <b className="text-slate-800">Shared</b> and <b className="text-slate-800">Unique</b> below are a breakdown of the{' '}
            <b className="text-slate-800">{dispControls.toLocaleString()}</b>, not additional controls.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700">
              <span className="tabular-nums">{dispRawTotal}</span> framework controls
            </span>
            <span className="font-bold text-slate-400">−</span>
            <span className="rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 font-semibold text-rose-600">
              <span className="tabular-nums">{dispShared}</span> duplicates
            </span>
            <span className="font-bold text-slate-400">=</span>
            <span className="rounded-lg border border-emerald-600 bg-emerald-600 px-2.5 py-1.5 font-bold text-white">
              <span className="tabular-nums">{dispControls}</span> unified controls
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-slate-500">which breaks down as</span>
            <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700">
              <span className="tabular-nums">{dispStandalone}</span> unique
            </span>
            <span className="font-bold text-slate-400">+</span>
            <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700">
              <span className="tabular-nums">{dispSets}</span> shared
            </span>
            <span className="font-bold text-slate-400">=</span>
            <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700">
              <span className="tabular-nums">{dispControls}</span>
            </span>
          </div>
        </div>
      )}


      <div className="card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[180px] sm:max-w-xs">
              <SearchInput
                value={searchTerm}
                onChange={(v) => { setSearchTerm(v); setPage(0); }}
                placeholder="Search by name or code..."
                size="md"
              />
            </div>
            {realCategoryOpts.length > 1 && (
              <MultiSelectDropdown
                title="Category"
                items={realCategoryOpts.map((cat) => ({ value: cat, label: cat }))}
                selectedValues={categoryFilter ? [categoryFilter] : []}
                onApply={(v) => { setCategoryFilter(v[0] || ''); setPage(0); }}
                multiSelect={false}
                autoApply
                placeholder="All Categories"
                size="md"
              />
            )}
            <MultiSelectDropdown
              title="Domain"
              items={realDomainOpts.map((dom) => ({ value: dom, label: dom }))}
              selectedValues={domainFilter ? [domainFilter] : []}
              onApply={(v) => { setDomainFilter(v[0] || ''); setPage(0); }}
              multiSelect={false}
              autoApply
              placeholder="All Domains"
              size="md"
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={showEmptyGroups}
                onChange={(e) => setShowEmptyGroups(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-primary-600 focus:ring-primary-500"
              />
              Show empty groups
            </label>
            <div className="flex rounded-lg border border-gray-200">
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'cards' 
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-gray-600 hover:text-black'
                }`}
              >
                <Grid3X3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'table' 
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-gray-600 hover:text-black'
                }`}
              >
                <FileText className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {groupsLoading ? (
        <div className="flex h-64 items-center justify-center">
          <PageLoader size="md" />
        </div>
      ) : groupsError ? (
        <div className="flex h-64 flex-col items-center justify-center text-red-400">
          <AlertCircle className="mb-2 h-8 w-8" />
          <p>Failed to load control groups</p>
          <button onClick={() => refetchGroups()} className="mt-2 text-sm text-primary-700 hover:underline">
            Try again
          </button>
        </div>
      ) : !filteredGroups || filteredGroups.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <Library className="mb-4 h-12 w-12 text-gray-400" />
          <h3 className="text-lg font-medium text-black">No control groups found</h3>
          <p className="mt-1 text-gray-600">Create your first control group or use AI auto-grouping</p>
          <div className="mt-4 flex gap-3">
            {canCreate && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
              >
                <Plus size={16} />
                Create Group
              </button>
            )}
            <button
              onClick={() => setShowAutoGroupModal(true)}
              className="flex items-center gap-2 rounded-lg border border-primary-500 px-4 py-2 font-medium text-primary-700 hover:bg-primary-500/10"
            >
              <Sparkles size={16} />
              Auto-Group
            </button>
          </div>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredGroups?.map((group) => {
            const completion = getGroupCompletionPercent(group);
            return (
              <div
                key={group.id}
                className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-lg"
              >
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary-400 via-primary-600 to-primary-700 opacity-70 transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm">
                        <Shield className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-900 line-clamp-2">{group.name}</h3>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-lg bg-slate-50 px-2.5 py-1 text-center ring-1 ring-slate-200">
                      <span className="block text-base font-bold leading-none text-slate-800 tabular-nums">{group.normalized_control_count ?? 0}</span>
                      <span className="block text-[9px] uppercase tracking-wide text-slate-400">controls</span>
                    </span>
                  </div>

                  {group.description && group.description !== group.name && (
                    <p className="text-sm text-slate-500 line-clamp-2 mb-3">{group.description}</p>
                  )}

                  <div className="border-t border-slate-100 pt-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 font-semibold text-primary-700 ring-1 ring-primary-100">
                        <Layers className="h-3.5 w-3.5" />
                        {Math.max(0, (group.normalized_control_count ?? 0) - (group.standalone_control_count ?? 0))} <span className="font-medium text-primary-500">shared</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 font-semibold text-slate-600 ring-1 ring-slate-200">
                        <Shield className="h-3.5 w-3.5" />
                        {group.standalone_control_count ?? 0} <span className="font-medium text-slate-400">unique</span>
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center justify-end gap-1 border-t border-slate-50 pt-2 opacity-60 transition-opacity group-hover:opacity-100">
                      <Link
                        href={domainHref(group.id)}
                        title="View Details"
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                      >
                        <Eye size={15} />
                      </Link>
                      {canEdit && (
                        <button
                          title="Edit"
                          onClick={() => setEditingGroup(group)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Edit2 size={15} />
                        </button>
                      )}
                      <button
                        title="Generate AI Summary"
                        onClick={() => generateSummaryMutation.mutate(group.id)}
                        disabled={generateSummaryMutation.isPending}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-40"
                      >
                        <Sparkles size={15} />
                      </button>
                      {canDelete && (
                        <button
                          title="Delete"
                          onClick={() => handleDeleteGroup(group)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Code</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Domain</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Controls</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Completion</th>
                <th className="w-32 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {filteredGroups?.map((group) => {
                const completion = getGroupCompletionPercent(group);
                return (
                  <tr key={group.id} className="hover:bg-gray-100">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-medium text-primary-700">{group.code}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="max-w-xs">
                        <p className="truncate text-sm font-medium text-black">{group.name}</p>
                        {group.description && (
                          <p className="truncate text-xs text-gray-600">{group.description}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {group.category ? (
                        <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 ring-1 ring-primary-100">
                          {group.category}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {group.domain ? (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                          {group.domain}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-gray-600" />
                        <span className="text-sm font-medium text-black">{group.total_control_count}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={`h-full transition-all ${
                              completion >= 70 ? 'bg-green-500' : completion >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${completion}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-600">{completion}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={domainHref(group.id)}
                          title="View Details"
                          className="rounded p-1.5 text-gray-600 hover:bg-gray-100 hover:text-black"
                        >
                          <Eye size={14} />
                        </Link>
                        {canEdit && (
                          <button
                            title="Edit"
                            onClick={() => setEditingGroup(group)}
                            className="rounded p-1.5 text-gray-600 hover:bg-gray-100 hover:text-black"
                          >
                            <Edit2 size={14} />
                          </button>
                        )}
                        <button
                          title="Generate AI Summary"
                          onClick={() => generateSummaryMutation.mutate(group.id)}
                          disabled={generateSummaryMutation.isPending}
                          className="rounded p-1.5 text-gray-600 hover:bg-gray-100 hover:text-primary-700"
                        >
                          <Sparkles size={14} />
                        </button>
                        {canDelete && (
                          <button
                            title="Delete"
                            onClick={() => handleDeleteGroup(group)}
                            className="rounded p-1.5 text-gray-600 hover:bg-red-50 hover:text-red-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-200 pt-4">
          <div className="text-sm text-gray-600">
            Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, groupsData?.total || 0)} of {groupsData?.total || 0} results
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-black hover:bg-gray-100 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="px-3 text-sm text-gray-600">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-black hover:bg-gray-100 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-black">Create Control Group</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-600 hover:text-black">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createGroupMutation.mutate(newGroup);
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Code *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., CCG-001"
                  value={newGroup.code}
                  onChange={(e) => setNewGroup({ ...newGroup, code: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black placeholder-gray-500 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Access Control Management"
                  value={newGroup.name}
                  onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black placeholder-gray-500 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  placeholder="Describe the purpose of this control group..."
                  value={newGroup.description}
                  onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black placeholder-gray-500 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Category</label>
                  <input
                    type="text"
                    placeholder="e.g., Access Control"
                    value={newGroup.category}
                    onChange={(e) => setNewGroup({ ...newGroup, category: e.target.value })}
                    list="categories-list"
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black placeholder-gray-500 focus:border-primary-500 focus:outline-none"
                  />
                  <datalist id="categories-list">
                    {categories?.map(cat => <option key={cat} value={cat} />)}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Domain</label>
                  <input
                    type="text"
                    placeholder="e.g., Security"
                    value={newGroup.domain}
                    onChange={(e) => setNewGroup({ ...newGroup, domain: e.target.value })}
                    list="domains-list"
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black placeholder-gray-500 focus:border-primary-500 focus:outline-none"
                  />
                  <datalist id="domains-list">
                    {domains?.map(dom => <option key={dom} value={dom} />)}
                  </datalist>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createGroupMutation.isPending}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {createGroupMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-black">Edit Control Group</h2>
              <button onClick={() => setEditingGroup(null)} className="text-gray-600 hover:text-black">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                updateGroupMutation.mutate({
                  id: editingGroup.id,
                  data: {
                    code: editingGroup.code,
                    name: editingGroup.name,
                    description: editingGroup.description,
                    category: editingGroup.category,
                    domain: editingGroup.domain,
                  },
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Code *</label>
                <input
                  type="text"
                  required
                  value={editingGroup.code}
                  onChange={(e) => setEditingGroup({ ...editingGroup, code: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
                <input
                  type="text"
                  required
                  value={editingGroup.name}
                  onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={editingGroup.description || ''}
                  onChange={(e) => setEditingGroup({ ...editingGroup, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Category</label>
                  <input
                    type="text"
                    value={editingGroup.category || ''}
                    onChange={(e) => setEditingGroup({ ...editingGroup, category: e.target.value })}
                    list="edit-categories-list"
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                  />
                  <datalist id="edit-categories-list">
                    {categories?.map(cat => <option key={cat} value={cat} />)}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Domain</label>
                  <input
                    type="text"
                    value={editingGroup.domain || ''}
                    onChange={(e) => setEditingGroup({ ...editingGroup, domain: e.target.value })}
                    list="edit-domains-list"
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                  />
                  <datalist id="edit-domains-list">
                    {domains?.map(dom => <option key={dom} value={dom} />)}
                  </datalist>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingGroup(null)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateGroupMutation.isPending}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {updateGroupMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAutoGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-primary-700 flex-shrink-0" />
                <h2 className="text-lg font-semibold text-black">Build Unified View</h2>
              </div>
              <button onClick={() => setShowAutoGroupModal(false)} className="text-gray-600 hover:text-black">
                <X size={20} />
              </button>
            </div>

            {autoGroupError ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4">
                  <div className="flex items-center gap-2 text-red-400">
                    <XCircle size={20} />
                    <span className="font-medium">Auto-grouping failed</span>
                  </div>
                  <p className="mt-2 text-gray-700">{autoGroupError}</p>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => {
                      setShowAutoGroupModal(false);
                      setAutoGroupError(null);
                    }}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-100"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      setAutoGroupError(null);
                      autoGroupMutation.mutate(selectedFrameworks);
                    }}
                    className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
                  >
                    <RefreshCw size={16} />
                    Retry
                  </button>
                </div>
              </div>
            ) : !autoGroupResult && !autoGroupLoading ? (
              <div className="space-y-4">
                <p className="text-gray-600">
                  Pick the frameworks you care about and we’ll filter the already-normalized
                  baseline to a unified, de-duplicated view of just those frameworks — instant, no AI re-run.
                </p>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Select Frameworks (optional)</label>
                  <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-gray-300 bg-gray-100 p-3">
                    {availableFrameworks?.map((fw: any) => (
                      <label key={fw.id} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={selectedFrameworks.includes(fw.id)}
                          onChange={(e) => {
                            const id = fw.id;
                            if (e.target.checked) {
                              setSelectedFrameworks([...selectedFrameworks, id]);
                            } else {
                              setSelectedFrameworks(selectedFrameworks.filter(f => f !== id));
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-primary-600 focus:ring-primary-500"
                        />
                        {fw.name}
                      </label>
                    ))}
                    {(!availableFrameworks || availableFrameworks.length === 0) && (
                      <p className="text-sm text-gray-500">No frameworks uploaded. Please upload frameworks first.</p>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">Leave empty to analyze all frameworks</p>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => setShowAutoGroupModal(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => autoGroupMutation.mutate(selectedFrameworks)}
                    className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
                  >
                    <Play size={16} />
                    Build View
                  </button>
                </div>
              </div>
            ) : autoGroupLoading ? (
              <div className="flex flex-col items-center justify-center py-8 px-6">
                <Loader2 className="mb-4 h-10 w-10 animate-spin text-primary-700" />
                <p className="text-black font-medium">Analyzing controls with AI…</p>
                <p className="mt-1 text-sm text-gray-600 text-center">
                  {autoGroupProgress || 'Running in the background'}
                </p>
                <div className="w-full max-w-md mt-4">
                  <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary-500 to-primary-700 transition-all duration-500 ease-out"
                      style={{ width: `${autoGroupPercent}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs text-gray-500">
                    <span>{autoGroupPhase ? autoGroupPhase.replace(/_/g, ' ') : 'queued'}</span>
                    <span>{Math.round(autoGroupPercent)}%</span>
                  </div>
                </div>
                <p className="mt-4 text-xs text-gray-400 text-center">
                  Safe to close — the job keeps running. The dialog will close automatically when it's done.
                </p>
              </div>
            ) : autoGroupResult ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2 text-emerald-700">
                    <CheckCircle size={20} />
                    <span className="font-semibold">Auto-grouping complete!</span>
                  </div>
                  <p className="mt-2 text-slate-600">{autoGroupResult.message}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h4 className="mb-2 font-semibold text-slate-900">Results</h4>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Unified Controls</p>
                      <p className="text-2xl font-semibold text-black">{autoGroupResult.unified_controls ?? autoGroupResult.groups_created}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Unique</p>
                      <p className="text-2xl font-semibold text-black">{autoGroupResult.standalone ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Total Controls</p>
                      <p className="text-2xl font-semibold text-black">
                        {autoGroupResult.controls_covered
                          ?? ((autoGroupResult.unified_controls ?? 0) + (autoGroupResult.standalone ?? 0))}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setShowAutoGroupModal(false);
                      setAutoGroupResult(null);
                    }}
                    className="rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {showAnalysisModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Brain className="h-5 w-5 text-purple-500 flex-shrink-0" />
                <h2 className="text-lg font-semibold text-black">AI Similarity Analysis</h2>
              </div>
              <button onClick={() => setShowAnalysisModal(false)} className="text-gray-600 hover:text-black">
                <X size={20} />
              </button>
            </div>

            {analysisError ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4">
                  <div className="flex items-center gap-2 text-red-400">
                    <XCircle size={20} />
                    <span className="font-medium">Analysis failed</span>
                  </div>
                  <p className="mt-2 text-gray-700">{analysisError}</p>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => {
                      setShowAnalysisModal(false);
                      setAnalysisError(null);
                    }}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-100"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      setAnalysisError(null);
                      startAnalysisMutation.mutate(selectedFrameworks);
                    }}
                    className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-black hover:bg-purple-700"
                  >
                    <RefreshCw size={16} />
                    Retry
                  </button>
                </div>
              </div>
            ) : !analysisResult && !analysisLoading ? (
              <div className="space-y-4">
                <p className="text-gray-600">
                  Run AI analysis to identify similar and related controls across your frameworks.
                  This will create similarity mappings that help with control harmonization.
                </p>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Select Frameworks (optional)</label>
                  <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-gray-300 bg-gray-100 p-3">
                    {availableFrameworks?.map((fw: any) => (
                      <label key={fw.id} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={selectedFrameworks.includes(fw.id)}
                          onChange={(e) => {
                            const id = fw.id;
                            if (e.target.checked) {
                              setSelectedFrameworks([...selectedFrameworks, id]);
                            } else {
                              setSelectedFrameworks(selectedFrameworks.filter(f => f !== id));
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-primary-600 focus:ring-primary-500"
                        />
                        {fw.name}
                      </label>
                    ))}
                    {(!availableFrameworks || availableFrameworks.length === 0) && (
                      <p className="text-sm text-gray-500">No frameworks uploaded. Please upload frameworks first.</p>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">Leave empty to analyze all frameworks</p>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => setShowAnalysisModal(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => startAnalysisMutation.mutate(selectedFrameworks)}
                    className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-black hover:bg-purple-700"
                  >
                    <Brain size={16} />
                    Start Analysis
                  </button>
                </div>
              </div>
            ) : analysisLoading ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Loader2 className="mb-4 h-12 w-12 animate-spin text-purple-400" />
                <p className="text-black">Running AI similarity analysis...</p>
                <p className="mt-1 text-sm text-gray-600">This may take a moment</p>
              </div>
            ) : analysisResult ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-4">
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle size={20} />
                    <span className="font-medium">Analysis complete!</span>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-300 bg-gray-100 p-4">
                  <h4 className="mb-2 font-medium text-black">Results</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Controls Analyzed</p>
                      <p className="text-2xl font-semibold text-black">{analysisResult.total_controls_analyzed}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Mappings Created</p>
                      <p className="text-2xl font-semibold text-black">{analysisResult.mappings_created}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Groups Created</p>
                      <p className="text-2xl font-semibold text-black">{analysisResult.groups_created}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Status</p>
                      <p className="text-lg font-semibold text-green-400 capitalize">{analysisResult.status}</p>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setShowAnalysisModal(false);
                      setAnalysisResult(null);
                    }}
                    className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-black hover:bg-purple-700"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
