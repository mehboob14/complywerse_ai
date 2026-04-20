'use client';

import { Fragment, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { controlLibraryApi } from '@/lib/api';
import {
  GitCompare,
  Loader2,
  Download,
  ChevronDown,
  Shield,
  Sparkles,
  ArrowRight,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  X,
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
      setCompareTriggered(true);
      setPage(0);
      setAiResults({});
      setExpandedRows(new Set());
    }
  };

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

  const totalPages = crosswalkData ? Math.ceil(crosswalkData.total / pageSize) : 0;
  const sourceFramework = frameworkOptions.find(f => f.id === sourceFrameworkId);
  const destFramework = frameworkOptions.find(f => f.id === destFrameworkId);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-black sm:text-2xl">Framework Comparison</h1>
          <p className="text-sm text-gray-600">Crosswalk mapping between regulatory frameworks</p>
        </div>
        {crosswalkData?.crosswalk && crosswalkData.crosswalk.length > 0 && (
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        )}
      </div>

      <div className="card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-4">
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Source Framework</label>
            <div className="relative">
              <select
                value={sourceFrameworkId || ''}
                onChange={(e) => {
                  setSourceFrameworkId(e.target.value ? Number(e.target.value) : null);
                  setCompareTriggered(false);
                }}
                className="w-full appearance-none rounded-lg border border-gray-300 bg-white px-4 py-2.5 pr-10 text-black hover:border-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="">Select source framework...</option>
                {frameworksLoading ? (
                  <option disabled>Loading...</option>
                ) : (
                  frameworkOptions.map(fw => (
                    <option key={fw.id} value={fw.id} disabled={fw.id === destFrameworkId}>
                      {fw.name} {fw.version ? `(${fw.version})` : ''} — {fw.control_count} controls
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
            </div>
          </div>

          <div className="flex items-center justify-center lg:pb-1">
            <ArrowRight className="h-5 w-5 text-gray-500" />
          </div>

          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Destination Framework</label>
            <div className="relative">
              <select
                value={destFrameworkId || ''}
                onChange={(e) => {
                  setDestFrameworkId(e.target.value ? Number(e.target.value) : null);
                  setCompareTriggered(false);
                }}
                className="w-full appearance-none rounded-lg border border-gray-300 bg-white px-4 py-2.5 pr-10 text-black hover:border-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="">Select destination framework...</option>
                {frameworksLoading ? (
                  <option disabled>Loading...</option>
                ) : (
                  frameworkOptions.map(fw => (
                    <option key={fw.id} value={fw.id} disabled={fw.id === sourceFrameworkId}>
                      {fw.name} {fw.version ? `(${fw.version})` : ''} — {fw.control_count} controls
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
            </div>
          </div>

          <button
            onClick={handleCompare}
            disabled={!sourceFrameworkId || !destFrameworkId || sourceFrameworkId === destFrameworkId}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-6 py-2.5 font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GitCompare className="h-4 w-4" />
            Compare
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3">
              <Shield className="h-6 w-6 text-blue-600" />
            </div>
          </div>
          <p className="stat-value">{frameworkOptions.length || 0}</p>
          <p className="stat-label">Available Frameworks</p>
        </div>
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 p-3">
              <GitCompare className="h-6 w-6 text-blue-400" />
            </div>
          </div>
          <p className="stat-value">{crosswalkData?.total || 0}</p>
          <p className="stat-label">Source Controls</p>
        </div>
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 p-3">
              <Sparkles className="h-6 w-6 text-green-400" />
            </div>
          </div>
          <p className="stat-value">
            {crosswalkData?.crosswalk
              ? crosswalkData.crosswalk.filter(r => r.match_count > 0).length
              : 0}
          </p>
          <p className="stat-label">Mapped Controls</p>
        </div>
      </div>

      {compareTriggered && sourceFrameworkId && destFrameworkId && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <GitCompare className="h-5 w-5 text-blue-600" />
                Crosswalk: {sourceFramework?.short_code || 'Source'} → {destFramework?.short_code || 'Destination'}
              </h2>
              <p className="card-description">
                Showing {crosswalkData ? `${crosswalkData.skip + 1}–${Math.min(crosswalkData.skip + crosswalkData.limit, crosswalkData.total)} of ${crosswalkData.total}` : '...'} source requirements
              </p>
            </div>
          </div>

          {crosswalkLoading || crosswalkFetching ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : !crosswalkData?.crosswalk?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="mb-4 h-12 w-12 text-gray-400" />
              <h3 className="text-lg font-medium text-black">No crosswalk data available</h3>
              <p className="mt-1 text-gray-600">No controls found for the selected frameworks</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px]">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-600 w-24">Source Ref</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-600 w-64">Source Requirement</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-600 w-32">Source Domain</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-600 w-24">Dest Ref(s)</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-600 w-64">Dest Requirement</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-600 w-32">Dest Domain</th>
                      <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-600 w-48">Evidence</th>
                      <th className="px-3 py-3 text-center text-xs font-medium uppercase text-gray-600 w-20">AI Map</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {crosswalkData.crosswalk.map((row) => {
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
                            className="cursor-pointer align-top transition-colors hover:bg-gray-50"
                            onClick={() => toggleRow(row.source_control.id)}
                          >
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm font-medium text-blue-600">{row.source_control.reference}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <p className="truncate whitespace-nowrap text-sm font-medium text-black" title={row.source_control.title}>
                                {truncateInlineText(row.source_control.title, 78)}
                              </p>
                            </td>
                            <td className="px-3 py-3">
                              <span className="block truncate whitespace-nowrap text-xs text-gray-700" title={row.source_control.domain || row.source_control.category || '—'}>
                                {truncateInlineText(row.source_control.domain || row.source_control.category || '—', 26)}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <div className="space-y-1">
                                <p className="truncate whitespace-nowrap font-mono text-sm text-blue-700" title={destinationRefs}>
                                  {truncateInlineText(destinationRefs, 40)}
                                </p>
                                <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                  row.match_type === 'category' ? 'bg-green-100 text-green-700' :
                                  row.match_type === 'domain' ? 'bg-blue-100 text-blue-700' :
                                  row.match_type === 'keyword' ? 'bg-amber-100 text-amber-700' :
                                  'bg-gray-100 text-gray-700'
                                }`}>
                                  {row.match_type === 'category' ? 'Category Match' :
                                   row.match_type === 'domain' ? 'Domain Match' :
                                   row.match_type === 'keyword' ? 'Keyword Match' : 'Heuristic'}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <p className="truncate whitespace-nowrap text-sm text-gray-700" title={destinationTitles}>
                                {truncateInlineText(destinationTitles, 80)}
                              </p>
                            </td>
                            <td className="px-3 py-3">
                              <p className="truncate whitespace-nowrap text-xs text-gray-700" title={destinationDomains}>
                                {truncateInlineText(destinationDomains, 28)}
                              </p>
                            </td>
                            <td className="px-3 py-3">
                              <p className="truncate whitespace-nowrap text-xs text-gray-700" title={evidenceSummary}>
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
                                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Source Details</p>
                                    <p className="text-sm font-medium text-black">{row.source_control.title}</p>
                                    {row.source_control.description && (
                                      <p className="mt-1 text-xs text-gray-600">{row.source_control.description}</p>
                                    )}
                                  </div>
                                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Mapped Requirements</p>
                                    {hasDest ? row.destination_controls.map((dc) => (
                                      <div key={dc.id} className="mb-2 last:mb-0">
                                        <p className="text-sm font-medium text-black">{dc.reference} — {dc.title}</p>
                                        {dc.description && <p className="mt-0.5 text-xs text-gray-600">{dc.description}</p>}
                                      </div>
                                    )) : <p className="text-xs text-gray-500">No mapping found.</p>}
                                  </div>
                                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Evidence Recommendations</p>
                                    {row.evidence_recommendations.length > 0 ? row.evidence_recommendations.map((ev, idx) => (
                                      <p key={idx} className="mb-1 text-xs text-gray-700">• {formatEvidence(ev)}</p>
                                    )) : <p className="text-xs text-gray-500">No recommendations available.</p>}
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
                <div className="mt-4 flex items-center justify-between border-t border-gray-200 px-4 pt-4">
                  <p className="text-sm text-gray-600">
                    Page {page + 1} of {totalPages}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </button>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
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
        <div className="card">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <GitCompare className="mb-4 h-16 w-16 text-gray-400" />
            <h3 className="text-xl font-medium text-black">Framework Crosswalk Comparison</h3>
            <p className="mt-2 max-w-lg text-gray-600">
              Select a source and destination framework above, then click Compare to generate a crosswalk
              mapping showing how requirements align between the two frameworks with evidence recommendations.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
