'use client';

import Link from 'next/link';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { controlLibraryApi } from '@/lib/api';
import { MultiSelectDropdown, SearchInput, PageLoader } from '@/components/ui';
import {
  GitCompare,
  Loader2,
  Download,
  Shield,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  X,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

interface FrameworkInfo {
  id: number;
  name: string;
  short_code: string;
  version?: string;
  control_count: number;
  domain_count: number;
}

interface ControlDetail {
  id: number;
  reference: string;
  title: string;
  description?: string;
  section?: string;
  domain?: string;
  category?: string;
  full_text?: string;
}

interface CrosswalkRow {
  source_control: ControlDetail;
  destination_controls: ControlDetail[];
  match_count: number;
  match_type: string;
  evidence_recommendations: any[];
}

interface CrosswalkData {
  source_framework: { id: number; name: string; version?: string };
  destination_framework: { id: number; name: string; version?: string };
  total: number;
  skip: number;
  limit: number;
  crosswalk: CrosswalkRow[];
}

interface AIMapping {
  destination_reference: string;
  destination_title?: string;
  destination_description?: string;
  destination_section?: string;
  confidence: number;
  rationale: string;
  evidence_recommendations: string[];
}

interface AIMapResult {
  source_control: { reference: string; title: string; description?: string };
  ai_mappings: AIMapping[];
}

interface AiCompareRun {
  id: number;
  source_framework_id: number;
  dest_framework_id: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress_total: number;
  progress_done: number;
  progress_percent: number;
  error_message?: string;
  model_used?: string;
  task_id?: string;
  started_at?: string;
  completed_at?: string;
}

interface AiCompareDestination {
  dest_control_id: number;
  dest_reference: string;
  dest_title: string;
  dest_description?: string;
  dest_domain?: string;
  confidence: number;
  rationale: string;
  evidence_recommendations: string[];
  rank: number;
}

interface AiCompareItem {
  source_control_id: number;
  source_reference: string;
  source_title: string;
  source_description?: string;
  source_domain?: string;
  destinations: AiCompareDestination[];
}

interface PreviousRunSummary {
  id: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress_percent: number;
  model_used?: string;
  completed_at?: string;
  created_at?: string;
  source_framework: { id: number; name: string; short_code?: string | null; version?: string | null };
  destination_framework: { id: number; name: string; short_code?: string | null; version?: string | null };
  mapping_count: number;
}

function dedupeComparisonFrameworks(frameworks: FrameworkInfo[]) {
  const map = new Map<string, FrameworkInfo>();

  frameworks.forEach((framework) => {
    const key = `${(framework.short_code || '').trim().toLowerCase()}::${(framework.name || '').trim().toLowerCase()}`;
    const existing = map.get(key);
    if (!existing || framework.control_count > existing.control_count) {
      map.set(key, framework);
    }
  });

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function truncateInlineText(value?: string, max = 80) {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export default function FrameworkComparisonPage() {
  const [sourceFrameworkId, setSourceFrameworkId] = useState<number | null>(null);
  const [destFrameworkId, setDestFrameworkId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(50);
  const [compareTriggered, setCompareTriggered] = useState(false);
  const [aiResults, setAiResults] = useState<Record<number, AIMapResult>>({});
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // AI cross-framework compare (Celery-backed, cached per pair)
  const [mode, setMode] = useState<'keyword' | 'ai'>('keyword');
  const [aiRun, setAiRun] = useState<AiCompareRun | null>(null);
  const [aiItems, setAiItems] = useState<AiCompareItem[]>([]);
  const [aiError, setAiError] = useState<string>('');
  const [aiBusy, setAiBusy] = useState(false);
  const aiPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Post-compare client-side filtering & sorting. The same controls drive
  // both the keyword crosswalk and the AI compare table; only one mode is
  // visible at a time so a single pair of states is enough.
  type SortField = 'reference' | 'title' | 'domain' | 'matches';
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('reference');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const { data: frameworksData, isLoading: frameworksLoading } = useQuery({
    queryKey: ['comparison-frameworks'],
    queryFn: async () => {
      const response = await controlLibraryApi.comparison.getFrameworks();
      return response.data as { frameworks: FrameworkInfo[] };
    },
  });

  const frameworkOptions = useMemo(
    () => dedupeComparisonFrameworks(frameworksData?.frameworks || []),
    [frameworksData]
  );

  const { data: previousRunsData, refetch: refetchPreviousRuns } = useQuery({
    queryKey: ['ai-compare-runs'],
    queryFn: async () => {
      const response = await controlLibraryApi.comparison.aiCompareList();
      return response.data as { runs: PreviousRunSummary[] };
    },
  });
  const previousRuns = previousRunsData?.runs || [];

  const openCachedRun = async (run: PreviousRunSummary) => {
    setSourceFrameworkId(run.source_framework.id);
    setDestFrameworkId(run.destination_framework.id);
    setMode('ai');
    setCompareTriggered(true);
    setAiError('');
    setAiItems([]);
    setExpandedRows(new Set());
    stopAiPolling();
    // Hydrate the run summary so the header reflects the chosen pair while we load mappings
    setAiRun({
      id: run.id,
      source_framework_id: run.source_framework.id,
      dest_framework_id: run.destination_framework.id,
      status: run.status,
      progress_total: 0,
      progress_done: 0,
      progress_percent: run.progress_percent || (run.status === 'completed' ? 100 : 0),
      model_used: run.model_used,
      completed_at: run.completed_at,
    });
    if (run.status === 'completed') {
      await fetchAiMappings(run.id);
    } else if (run.status === 'queued' || run.status === 'running') {
      startAiPolling(run.id);
    }
  };

  const { data: crosswalkData, isLoading: crosswalkLoading, isFetching: crosswalkFetching } = useQuery({
    queryKey: ['crosswalk', sourceFrameworkId, destFrameworkId, page, pageSize],
    queryFn: async () => {
      if (!sourceFrameworkId || !destFrameworkId) return null;
      const response = await controlLibraryApi.comparison.getCrosswalk(
        sourceFrameworkId, destFrameworkId, page * pageSize, pageSize
      );
      return response.data as CrosswalkData;
    },
    enabled: compareTriggered && !!sourceFrameworkId && !!destFrameworkId,
  });

  const aiMapMutation = useMutation({
    mutationFn: async (sourceControlId: number) => {
      if (!sourceFrameworkId || !destFrameworkId) throw new Error('Select frameworks first');
      const response = await controlLibraryApi.comparison.aiMapControl(
        sourceFrameworkId, destFrameworkId, sourceControlId
      );
      return { controlId: sourceControlId, data: response.data as AIMapResult };
    },
    onSuccess: ({ controlId, data }) => {
      setAiResults(prev => ({ ...prev, [controlId]: data }));
    },
  });

  const handleCompare = () => {
    if (sourceFrameworkId && destFrameworkId) {
      setMode('keyword');
      setCompareTriggered(true);
      setPage(0);
      setAiResults({});
      setExpandedRows(new Set());
    }
  };

  const stopAiPolling = () => {
    if (aiPollRef.current) {
      clearInterval(aiPollRef.current);
      aiPollRef.current = null;
    }
  };

  const fetchAiMappings = async (runId: number) => {
    try {
      const r = await controlLibraryApi.comparison.aiCompareMappings(runId);
      const items = (r.data as { items?: AiCompareItem[] })?.items || [];
      setAiItems(items);
    } catch (e: any) {
      setAiError(e?.response?.data?.detail || 'Failed to load AI mappings');
    }
  };

  const startAiPolling = (runId: number) => {
    stopAiPolling();
    aiPollRef.current = setInterval(async () => {
      try {
        const r = await controlLibraryApi.comparison.aiCompareStatus(runId);
        const next = r.data as AiCompareRun;
        setAiRun(next);
        if (next.status === 'completed') {
          stopAiPolling();
          await fetchAiMappings(runId);
          refetchPreviousRuns();
        } else if (next.status === 'failed') {
          stopAiPolling();
          setAiError(next.error_message || 'AI comparison failed');
        }
      } catch {
        // soft-fail; keep polling
      }
    }, 3000);
  };

  const handleAiCompare = async (refresh = false) => {
    if (!sourceFrameworkId || !destFrameworkId) return;
    setMode('ai');
    setCompareTriggered(true);
    setAiError('');
    setAiItems([]);
    setExpandedRows(new Set());
    setAiBusy(true);
    try {
      const r = await controlLibraryApi.comparison.aiCompareRun(
        sourceFrameworkId,
        destFrameworkId,
        refresh
      );
      const run = r.data as AiCompareRun;
      setAiRun(run);
      if (run.status === 'completed') {
        await fetchAiMappings(run.id);
        refetchPreviousRuns();
      } else if (run.status === 'queued' || run.status === 'running') {
        startAiPolling(run.id);
      } else if (run.status === 'failed') {
        setAiError(run.error_message || 'AI comparison failed');
      }
    } catch (e: any) {
      setAiError(e?.response?.data?.detail || 'Failed to start AI comparison');
    } finally {
      setAiBusy(false);
    }
  };

  // Stop polling on unmount or when frameworks change.
  useEffect(() => stopAiPolling, []);
  useEffect(() => {
    // Reset AI state when the framework selection changes.
    stopAiPolling();
    setAiRun(null);
    setAiItems([]);
    setAiError('');
  }, [sourceFrameworkId, destFrameworkId]);

  const toggleRow = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExportCSV = () => {
    if (!crosswalkData?.crosswalk) return;

    const sourceName = crosswalkData.source_framework.name;
    const destName = crosswalkData.destination_framework.name;

    const headers = [
      'Source Ref', 'Source Title', 'Source Description', 'Source Domain',
      'Dest Ref(s)', 'Dest Title(s)', 'Dest Domain(s)', 'Match Count', 'Evidence Recommendations'
    ];

    const rows = crosswalkData.crosswalk.map(row => {
      const destRefs = row.destination_controls.map(d => d.reference).join('; ');
      const destTitles = row.destination_controls.map(d => d.title).join('; ');
      const destDomains = row.destination_controls.map(d => d.domain || '').join('; ');
      const evidence = row.evidence_recommendations.map(e =>
        typeof e === 'string' ? e : (e?.title || e?.description || JSON.stringify(e))
      ).join('; ');

      return [
        row.source_control.reference,
        row.source_control.title,
        row.source_control.description || '',
        row.source_control.domain || '',
        destRefs || 'No mapping',
        destTitles,
        destDomains,
        row.match_count.toString(),
        evidence,
      ];
    });

    const csvContent = [headers, ...rows]
      .map(r => r.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crosswalk_${sourceName}_to_${destName}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const formatEvidence = (ev: any): string => {
    if (typeof ev === 'string') return ev;
    if (ev?.title) return ev.title;
    if (ev?.description) return ev.description;
    if (ev?.name) return ev.name;
    return JSON.stringify(ev);
  };

  // Natural reference compare: A-1, A-2, A-10 sort correctly (not A-1, A-10, A-2).
  const compareReferences = (a: string, b: string): number =>
    String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });

  const compareStrings = (a: string, b: string): number =>
    String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });

  const matchesQuery = (q: string, ...fields: Array<string | undefined | null>): boolean => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return fields.some((f) => (f || '').toLowerCase().includes(needle));
  };

  const filteredKeywordRows = useMemo(() => {
    const rows = crosswalkData?.crosswalk || [];
    const filtered = rows.filter((row) => {
      const destRefs = row.destination_controls.map((d) => d.reference).join(' ');
      const destTitles = row.destination_controls.map((d) => d.title).join(' ');
      const destDomains = row.destination_controls.map((d) => d.domain || '').join(' ');
      return matchesQuery(
        searchQuery,
        row.source_control.reference,
        row.source_control.title,
        row.source_control.description,
        row.source_control.domain,
        row.source_control.category,
        destRefs,
        destTitles,
        destDomains,
      );
    });
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'reference':
          cmp = compareReferences(a.source_control.reference, b.source_control.reference);
          break;
        case 'title':
          cmp = compareStrings(a.source_control.title, b.source_control.title);
          break;
        case 'domain':
          cmp = compareStrings(
            a.source_control.domain || a.source_control.category || '',
            b.source_control.domain || b.source_control.category || '',
          );
          break;
        case 'matches':
          cmp = (a.match_count || 0) - (b.match_count || 0);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [crosswalkData, searchQuery, sortField, sortDir]);

  const filteredAiRows = useMemo(() => {
    const filtered = aiItems.filter((row) => {
      const destRefs = row.destinations.map((d) => d.dest_reference).join(' ');
      const destTitles = row.destinations.map((d) => d.dest_title || '').join(' ');
      return matchesQuery(
        searchQuery,
        row.source_reference,
        row.source_title,
        row.source_description,
        row.source_domain,
        destRefs,
        destTitles,
      );
    });
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'reference':
          cmp = compareReferences(a.source_reference, b.source_reference);
          break;
        case 'title':
          cmp = compareStrings(a.source_title, b.source_title);
          break;
        case 'domain':
          cmp = compareStrings(a.source_domain || '', b.source_domain || '');
          break;
        case 'matches':
          cmp = (a.destinations?.length || 0) - (b.destinations?.length || 0);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [aiItems, searchQuery, sortField, sortDir]);

  const totalPages = crosswalkData ? Math.ceil(crosswalkData.total / pageSize) : 0;
  const sourceFramework = frameworkOptions.find(f => f.id === sourceFrameworkId);
  const destFramework = frameworkOptions.find(f => f.id === destFrameworkId);

  const frameworkItems = frameworkOptions.map((fw) => ({
    value: String(fw.id),
    label: `${fw.name}${fw.version ? ` (${fw.version})` : ''}`,
    subLabel: `${fw.control_count} controls`,
  }));

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/control-library" className="text-slate-400 hover:text-slate-900 flex-shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">Framework Comparison</h1>
            <p className="mt-1 text-sm text-slate-600">Crosswalk mapping between regulatory frameworks</p>
          </div>
        </div>
        {crosswalkData?.crosswalk && crosswalkData.crosswalk.length > 0 && (
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1 min-w-0">
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Source Framework</label>
            <MultiSelectDropdown
              title="Source"
              items={frameworkItems.filter((it) => Number(it.value) !== destFrameworkId)}
              selectedValues={sourceFrameworkId ? [String(sourceFrameworkId)] : []}
              onApply={(v) => {
                setSourceFrameworkId(v[0] ? Number(v[0]) : null);
                setCompareTriggered(false);
              }}
              multiSelect={false}
              autoApply
              forceSearch
              triggerVariant="input"
              placeholder={frameworksLoading ? 'Loading...' : 'Select source framework'}
              searchPlaceholder="Search frameworks"
              size="md"
              triggerClassName="w-full"
            />
          </div>

          <div className="hidden lg:flex items-center justify-center pb-1">
            <ArrowRight className="h-5 w-5 text-slate-400" />
          </div>

          <div className="flex-1 min-w-0">
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Destination Framework</label>
            <MultiSelectDropdown
              title="Destination"
              items={frameworkItems.filter((it) => Number(it.value) !== sourceFrameworkId)}
              selectedValues={destFrameworkId ? [String(destFrameworkId)] : []}
              onApply={(v) => {
                setDestFrameworkId(v[0] ? Number(v[0]) : null);
                setCompareTriggered(false);
              }}
              multiSelect={false}
              autoApply
              forceSearch
              triggerVariant="input"
              placeholder={frameworksLoading ? 'Loading...' : 'Select destination framework'}
              searchPlaceholder="Search frameworks"
              size="md"
              triggerClassName="w-full"
            />
          </div>

          <button
            onClick={handleCompare}
            disabled={!sourceFrameworkId || !destFrameworkId || sourceFrameworkId === destFrameworkId}
            className="flex flex-shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 sm:px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Fast keyword/category-based crosswalk"
          >
            <GitCompare className="h-4 w-4" />
            Quick Compare
          </button>
          <button
            onClick={() => handleAiCompare(false)}
            disabled={!sourceFrameworkId || !destFrameworkId || sourceFrameworkId === destFrameworkId || aiBusy}
            className="flex flex-shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 sm:px-6 py-2.5 text-sm font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            title="AI-driven comparison; cached per pair so it's instant on re-run"
          >
            {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            AI Compare
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1.5">
            <Shield className="h-4 w-4 text-primary-600 flex-shrink-0" strokeWidth={1.75} />
            <p className="text-xs font-medium text-slate-500 truncate">Available Frameworks</p>
          </div>
          <p className="text-lg sm:text-xl font-semibold text-slate-900">{frameworkOptions.length || 0}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1.5">
            <GitCompare className="h-4 w-4 text-primary-600 flex-shrink-0" strokeWidth={1.75} />
            <p className="text-xs font-medium text-slate-500 truncate">Source Controls</p>
          </div>
          <p className="text-lg sm:text-xl font-semibold text-slate-900">{crosswalkData?.total || 0}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            <p className="text-xs font-medium text-slate-500 truncate">Mapped Controls</p>
          </div>
          <p className="text-lg sm:text-xl font-semibold text-slate-900">
            {crosswalkData?.crosswalk
              ? crosswalkData.crosswalk.filter((r) => r.match_count > 0).length
              : 0}
          </p>
        </div>
      </div>

      {compareTriggered && sourceFrameworkId && destFrameworkId && mode === 'ai' && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary-600" />
                AI Crosswalk: {sourceFramework?.short_code || 'Source'} → {destFramework?.short_code || 'Destination'}
              </h2>
              <p className="card-description">
                {aiRun?.status === 'completed'
                  ? `${aiItems.length} source controls mapped via ${aiRun.model_used || 'AI'}.`
                  : aiRun?.status === 'running' || aiRun?.status === 'queued'
                    ? `Running in background. ${aiRun.progress_done}/${aiRun.progress_total} controls processed.`
                    : 'AI is comparing controls one-to-one across the two frameworks.'}
              </p>
            </div>
            {aiRun?.status === 'completed' && (
              <button
                onClick={() => handleAiCompare(true)}
                disabled={aiBusy}
                className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                title="Re-run the AI comparison from scratch"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Refresh
              </button>
            )}
          </div>

          {aiError && (
            <div className="mx-4 mt-2 mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {aiError}
            </div>
          )}

          {(aiRun?.status === 'queued' || aiRun?.status === 'running') && (
            <div className="px-4 py-6">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium text-slate-700">
                  <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                  {aiRun.status === 'queued' ? 'Queued — waiting for a worker' : 'AI is running'}
                </span>
                <span className="text-xs text-slate-500">
                  {aiRun.progress_done}/{aiRun.progress_total || '?'} ({aiRun.progress_percent || 0}%)
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-primary-600 transition-all"
                  style={{ width: `${Math.min(100, Math.max(2, aiRun.progress_percent || 0))}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                You can leave this page; the job runs in the background. Re-clicking the same pair later
                returns the result instantly.
              </p>
            </div>
          )}

          {aiRun?.status === 'completed' && aiItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="mb-4 h-12 w-12 text-slate-400" />
              <h3 className="text-lg font-medium text-slate-900">No high-confidence matches</h3>
              <p className="mt-1 text-slate-500">
                AI did not find overlap above the 0.5 confidence threshold. Try the Quick Compare for a wider lookup.
              </p>
            </div>
          )}

          {aiRun?.status === 'completed' && aiItems.length > 0 && (
            <>
              <CompareTableToolbar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                sortField={sortField}
                onSortFieldChange={setSortField}
                sortDir={sortDir}
                onSortDirToggle={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                resultCount={filteredAiRows.length}
                totalCount={aiItems.length}
                matchesLabel="Matches"
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px]">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-slate-500 w-24">Source Ref</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-slate-500 w-64">Source Requirement</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-slate-500 w-32">Source Domain</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-slate-500 w-72">AI Mapped Destinations</th>
                      <th className="px-3 py-3 text-center text-xs font-medium uppercase text-slate-500 w-20">Top Conf.</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-slate-500 w-72">Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredAiRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-400">
                          No matches for "{searchQuery}"
                        </td>
                      </tr>
                    ) : filteredAiRows.map((row) => {
                    const isExpanded = expandedRows.has(row.source_control_id);
                    const top = row.destinations[0];
                    const destRefs = row.destinations.map((d) => d.dest_reference).join(' • ') || 'No high-confidence match';
                    const evidence = Array.from(
                      new Set(row.destinations.flatMap((d) => d.evidence_recommendations || []))
                    ).join(' • ') || '—';
                    return (
                      <Fragment key={row.source_control_id}>
                        <tr
                          className="cursor-pointer align-top hover:bg-slate-50"
                          onClick={() => toggleRow(row.source_control_id)}
                        >
                          <td className="px-3 py-3">
                            <span className="font-mono text-sm font-medium text-primary-700">{row.source_reference}</span>
                          </td>
                          <td className="px-3 py-3">
                            <p className="truncate whitespace-nowrap text-sm font-medium text-slate-900" title={row.source_title}>
                              {truncateInlineText(row.source_title, 78)}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <span className="block truncate text-xs text-slate-700" title={row.source_domain || '—'}>
                              {truncateInlineText(row.source_domain || '—', 26)}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <p className="truncate font-mono text-sm text-purple-700" title={destRefs}>
                              {truncateInlineText(destRefs, 60)}
                            </p>
                            <span className="mt-0.5 inline-block rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                              AI Match · {row.destinations.length} match{row.destinations.length === 1 ? '' : 'es'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            {top ? (
                              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                {Math.round(top.confidence * 100)}%
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <p className="truncate text-xs text-slate-700" title={evidence}>
                              {truncateInlineText(evidence, 80)}
                            </p>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50">
                            <td colSpan={6} className="px-4 py-4">
                              <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
                                <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-purple-700">
                                  <Sparkles className="h-4 w-4" /> AI Mapping Details
                                </p>
                                {row.destinations.length === 0 ? (
                                  <p className="text-xs text-purple-700">No mappings above the 0.5 confidence threshold.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {row.destinations.map((d) => (
                                      <div key={d.dest_control_id} className="rounded-md bg-white/70 p-2">
                                        <p className="text-sm font-medium text-purple-800">
                                          {d.dest_reference}
                                          {d.dest_title ? ` — ${d.dest_title}` : ''}
                                        </p>
                                        <p className="text-xs text-purple-700">
                                          Confidence: {Math.round(d.confidence * 100)}%
                                          {d.dest_domain ? ` · ${d.dest_domain}` : ''}
                                        </p>
                                        {d.rationale && (
                                          <p className="mt-1 text-xs text-purple-700/80">{d.rationale}</p>
                                        )}
                                        {d.evidence_recommendations && d.evidence_recommendations.length > 0 && (
                                          <div className="mt-1">
                                            {d.evidence_recommendations.map((e, i) => (
                                              <p key={i} className="text-xs text-purple-700/75">• {e}</p>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
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
            </>
          )}
        </div>
      )}

      {compareTriggered && sourceFrameworkId && destFrameworkId && mode === 'keyword' && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <GitCompare className="h-5 w-5 text-primary-600" strokeWidth={1.75} />
                Crosswalk: {sourceFramework?.short_code || 'Source'} → {destFramework?.short_code || 'Destination'}
              </h2>
              <p className="card-description">
                Showing {crosswalkData ? `${crosswalkData.skip + 1}–${Math.min(crosswalkData.skip + crosswalkData.limit, crosswalkData.total)} of ${crosswalkData.total}` : '...'} source requirements
              </p>
            </div>
          </div>

          {crosswalkLoading || crosswalkFetching ? (
            <div className="flex h-48 items-center justify-center">
              <PageLoader size="md" />
            </div>
          ) : !crosswalkData?.crosswalk?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="mb-4 h-12 w-12 text-slate-400" />
              <h3 className="text-lg font-medium text-slate-900">No crosswalk data available</h3>
              <p className="mt-1 text-slate-500">No controls found for the selected frameworks</p>
            </div>
          ) : (
            <>
              <CompareTableToolbar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                sortField={sortField}
                onSortFieldChange={setSortField}
                sortDir={sortDir}
                onSortDirToggle={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                resultCount={filteredKeywordRows.length}
                totalCount={crosswalkData.crosswalk.length}
                matchesLabel="Mapped destinations"
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px]">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-slate-500 w-24">Source Ref</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-slate-500 w-64">Source Requirement</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-slate-500 w-32">Source Domain</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-slate-500 w-24">Dest Ref(s)</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-slate-500 w-64">Dest Requirement</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-slate-500 w-32">Dest Domain</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-slate-500 w-48">Evidence</th>
                      <th className="px-3 py-3 text-center text-xs font-medium uppercase text-slate-500 w-20">AI Map</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredKeywordRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-10 text-center text-sm text-slate-400">
                          No matches for "{searchQuery}"
                        </td>
                      </tr>
                    ) : filteredKeywordRows.map((row) => {
                      const isExpanded = expandedRows.has(row.source_control.id);
                      const aiResult = aiResults[row.source_control.id];
                      const hasDest = row.destination_controls.length > 0;
                      const destinationRefs = hasDest ? row.destination_controls.map((dc) => dc.reference).join(' • ') : 'No mapping found';
                      const destinationTitles = hasDest ? row.destination_controls.map((dc) => dc.title).join(' • ') : '—';
                      const destinationDomains = hasDest
                        ? row.destination_controls.map((dc) => dc.domain).filter(Boolean).join(' • ')
                        : '—';
                      const evidenceSummary = row.evidence_recommendations.length > 0
                        ? row.evidence_recommendations.map((ev) => formatEvidence(ev)).join(' • ')
                        : '—';

                      return (
                        <Fragment key={row.source_control.id}>
                          <tr
                            key={row.source_control.id}
                            className="cursor-pointer align-top transition-colors hover:bg-slate-50"
                            onClick={() => toggleRow(row.source_control.id)}
                          >
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm font-medium text-primary-700">{row.source_control.reference}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <p className="truncate whitespace-nowrap text-sm font-medium text-slate-900" title={row.source_control.title}>
                                {truncateInlineText(row.source_control.title, 78)}
                              </p>
                            </td>
                            <td className="px-3 py-3">
                              <span className="block truncate whitespace-nowrap text-xs text-slate-700" title={row.source_control.domain || row.source_control.category || '—'}>
                                {truncateInlineText(row.source_control.domain || row.source_control.category || '—', 26)}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <div className="space-y-1">
                                <p className="truncate whitespace-nowrap font-mono text-sm text-primary-700" title={destinationRefs}>
                                  {truncateInlineText(destinationRefs, 40)}
                                </p>
                                <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                  row.match_type === 'category' ? 'bg-green-100 text-green-700' :
                                  row.match_type === 'domain' ? 'bg-blue-100 text-blue-700' :
                                  row.match_type === 'keyword' ? 'bg-amber-100 text-amber-700' :
                                  'bg-slate-100 text-slate-700'
                                }`}>
                                  {row.match_type === 'category' ? 'Category Match' :
                                   row.match_type === 'domain' ? 'Domain Match' :
                                   row.match_type === 'keyword' ? 'Keyword Match' : 'Heuristic'}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <p className="truncate whitespace-nowrap text-sm text-slate-700" title={destinationTitles}>
                                {truncateInlineText(destinationTitles, 80)}
                              </p>
                            </td>
                            <td className="px-3 py-3">
                              <p className="truncate whitespace-nowrap text-xs text-slate-700" title={destinationDomains}>
                                {truncateInlineText(destinationDomains, 28)}
                              </p>
                            </td>
                            <td className="px-3 py-3">
                              <p className="truncate whitespace-nowrap text-xs text-slate-700" title={evidenceSummary}>
                                {truncateInlineText(evidenceSummary, 72)}
                              </p>
                            </td>
                            <td className="px-3 py-3 text-left">
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  aiMapMutation.mutate(row.source_control.id);
                                }}
                                disabled={aiMapMutation.isPending && aiMapMutation.variables === row.source_control.id}
                                className="inline-flex items-center gap-1 rounded border border-purple-200 bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                                title="Use AI to find best matches"
                              >
                                {aiMapMutation.isPending && aiMapMutation.variables === row.source_control.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Sparkles className="h-3 w-3" />
                                )}
                                AI
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`expanded-${row.source_control.id}`} className="bg-slate-50">
                              <td colSpan={8} className="px-4 py-4">
                                <div className="grid gap-4 lg:grid-cols-3">
                                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Source Details</p>
                                    <p className="text-sm font-medium text-slate-900">{row.source_control.title}</p>
                                    {row.source_control.description && (
                                      <p className="mt-1 text-xs text-slate-500">{row.source_control.description}</p>
                                    )}
                                  </div>
                                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Mapped Requirements</p>
                                    {hasDest ? row.destination_controls.map((dc) => (
                                      <div key={dc.id} className="mb-2 last:mb-0">
                                        <p className="text-sm font-medium text-slate-900">{dc.reference} — {dc.title}</p>
                                        {dc.description && <p className="mt-0.5 text-xs text-slate-500">{dc.description}</p>}
                                      </div>
                                    )) : <p className="text-xs text-slate-400">No mapping found.</p>}
                                  </div>
                                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Evidence Recommendations</p>
                                    {row.evidence_recommendations.length > 0 ? row.evidence_recommendations.map((ev, idx) => (
                                      <p key={idx} className="mb-1 text-xs text-slate-700">• {formatEvidence(ev)}</p>
                                    )) : <p className="text-xs text-slate-400">No recommendations available.</p>}
                                  </div>
                                </div>

                                {aiResult && (
                                  <div className="mt-4 rounded-lg border border-purple-200 bg-purple-50 p-3">
                                    <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-purple-700">
                                      <Sparkles className="h-4 w-4" /> AI Mapping Details
                                    </p>
                                    <div className="space-y-2">
                                      {aiResult.ai_mappings.map((mapping, idx) => (
                                        <div key={idx} className="rounded-md bg-white/70 p-2">
                                          <p className="text-sm font-medium text-purple-800">
                                            {mapping.destination_reference}
                                            {mapping.destination_title ? ` — ${mapping.destination_title}` : ''}
                                          </p>
                                          <p className="text-xs text-purple-700">Confidence: {Math.round(mapping.confidence * 100)}%</p>
                                          {mapping.rationale && <p className="mt-1 text-xs text-purple-700/80">{mapping.rationale}</p>}
                                          {mapping.evidence_recommendations.length > 0 && (
                                            <div className="mt-1">
                                              {mapping.evidence_recommendations.map((recommendation, recommendationIndex) => (
                                                <p key={recommendationIndex} className="text-xs text-purple-700/75">• {recommendation}</p>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between border-t border-slate-200 px-4 pt-4">
                  <p className="text-sm text-slate-500">
                    Page {page + 1} of {totalPages}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </button>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!compareTriggered && (
        <>
          {previousRuns.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary-600" />
                    Previously mapped pairs
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Click any row to open the cached AI mapping without re-running.
                  </p>
                </div>
                <span className="text-xs text-slate-500">{previousRuns.length} run{previousRuns.length === 1 ? '' : 's'}</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {previousRuns.map((run) => {
                  const completed = run.status === 'completed';
                  const sourceLabel = run.source_framework.short_code || run.source_framework.name;
                  const destLabel = run.destination_framework.short_code || run.destination_framework.name;
                  const dateStr = run.completed_at || run.created_at;
                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        onClick={() => openCachedRun(run)}
                        className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left text-sm hover:bg-slate-50 rounded"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-slate-800 truncate">{sourceLabel}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                          <span className="font-medium text-slate-800 truncate">{destLabel}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            completed ? 'bg-emerald-100 text-emerald-700'
                            : run.status === 'failed' ? 'bg-rose-100 text-rose-700'
                            : 'bg-amber-100 text-amber-700'
                          }`}>
                            {completed ? `${run.mapping_count} match${run.mapping_count === 1 ? '' : 'es'}` : run.status}
                          </span>
                          {dateStr && (
                            <span className="text-[11px] text-slate-400 whitespace-nowrap">
                              {new Date(dateStr).toLocaleDateString()}
                            </span>
                          )}
                          <ChevronRight className="h-4 w-4 text-slate-400" />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="card">
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <GitCompare className="mb-4 h-16 w-16 text-slate-400" />
              <h3 className="text-xl font-medium text-slate-900">Framework Crosswalk Comparison</h3>
              <p className="mt-2 max-w-lg text-slate-500">
                Select a source and destination framework above, then click Compare to generate a crosswalk
                mapping showing how requirements align between the two frameworks with evidence recommendations.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface CompareTableToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  sortField: 'reference' | 'title' | 'domain' | 'matches';
  onSortFieldChange: (value: 'reference' | 'title' | 'domain' | 'matches') => void;
  sortDir: 'asc' | 'desc';
  onSortDirToggle: () => void;
  resultCount: number;
  totalCount: number;
  matchesLabel: string;
}

function CompareTableToolbar({
  searchQuery,
  onSearchChange,
  sortField,
  onSortFieldChange,
  sortDir,
  onSortDirToggle,
  resultCount,
  totalCount,
  matchesLabel,
}: CompareTableToolbarProps) {
  return (
    <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 items-center gap-2">
        <div className="flex-1 max-w-md">
          <SearchInput
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search by clause, title, domain..."
            variant="square"
            size="sm"
          />
        </div>
        <span className="hidden sm:block text-xs text-slate-500 whitespace-nowrap">
          {searchQuery ? `${resultCount} of ${totalCount}` : `${totalCount} rows`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-500">Sort by</label>
        <select
          value={sortField}
          onChange={(e) => onSortFieldChange(e.target.value as CompareTableToolbarProps['sortField'])}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          <option value="reference">Reference</option>
          <option value="title">Title</option>
          <option value="domain">Domain</option>
          <option value="matches">{matchesLabel}</option>
        </select>
        <button
          type="button"
          onClick={onSortDirToggle}
          className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
          aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
        >
          {sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {sortDir === 'asc' ? 'Asc' : 'Desc'}
        </button>
      </div>
    </div>
  );
}
