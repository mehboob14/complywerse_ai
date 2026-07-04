'use client';

/**
 * Controls Overview — the analytics / framework-structure companion to the
 * `/controls` split-workbench. Holds the control-health snapshot strip and the
 * native Tree / Document (Figure-2) framework views plus their view switcher.
 * The flat workbench list lives at `/controls`; this route is the "read the
 * framework structure" surface.
 *
 * Every query, filter, and view here was moved verbatim from the original
 * monolithic controls page — no API calls, query keys, or data shapes changed.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { controlsApi } from '@/lib/api';
import { SearchInput, MultiSelectDropdown } from '@/components/ui';
import {
  FileStack,
  ArrowLeft,
  FileText,
  Layers,
  ClipboardList,
  Table2,
} from 'lucide-react';
import {
  ControlHealthSnapshot,
  NativeFrameworkTree,
  Figure2View,
  PriorityLevelBadge,
  type FrameworkControlsResponse,
  type FrameworkSummaryResponse,
  type StatusSummary,
} from '../_shared/components';

export default function ControlsOverviewPage() {
  const searchParams = useSearchParams();
  const initialFrameworkId = searchParams.get('framework');

  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [frameworkFilter, setFrameworkFilter] = useState<number | null>(
    initialFrameworkId ? Number(initialFrameworkId) : null
  );
  const [page, setPage] = useState(0);
  // Table (default global view) vs Tree (NDMO-style Domain→Control→Spec native
  // view). The tree auto-engages the first time a phased framework is opened,
  // unless the user has explicitly toggled.
  const [viewMode, setViewMode] = useState<'table' | 'tree' | 'doc'>('table');
  const [viewTouched, setViewTouched] = useState(false);
  const pageSize = 50;

  useEffect(() => {
    if (initialFrameworkId) {
      setFrameworkFilter(Number(initialFrameworkId));
    }
  }, [initialFrameworkId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchTerm(searchInput.trim());
      setPage(0);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data: summaryData } = useQuery({
    queryKey: ['framework-controls-summary'],
    queryFn: async () => {
      const response = await controlsApi.getFrameworkControlsSummary();
      return response.data as FrameworkSummaryResponse;
    },
  });

  // Control-health snapshot — endpoint-derived, unpaginated. Guarded to {} so a
  // 404/absent endpoint degrades gracefully (list-only metrics; no impl tile).
  const { data: statusSummary } = useQuery({
    queryKey: ['framework-controls-status-summary', frameworkFilter],
    queryFn: async (): Promise<Partial<StatusSummary>> => {
      try {
        const res = await controlsApi.getFrameworkControlsStatusSummary(frameworkFilter ?? undefined);
        return (res.data ?? {}) as StatusSummary;
      } catch {
        return {};
      }
    },
  });

  const { data } = useQuery({
    queryKey: ['framework-controls', frameworkFilter, '', searchTerm, 'control_id', 'asc', page],
    queryFn: async () => {
      const params: {
        skip: number;
        limit: number;
        framework_id?: number;
        search?: string;
        sort_by?: string;
        sort_order?: 'asc' | 'desc';
      } = {
        skip: page * pageSize,
        limit: pageSize,
        sort_by: 'control_id',
        sort_order: 'asc',
      };
      if (frameworkFilter) params.framework_id = frameworkFilter;
      if (searchTerm) params.search = searchTerm;

      const response = await controlsApi.getFrameworkControls(params);
      return response.data as FrameworkControlsResponse;
    },
    placeholderData: (previousData) => previousData,
  });

  // A framework is "phased" when its controls carry NDMO-style P1/P2/P3 tiers.
  const isPhased = !!data?.controls?.some((c) => c.priority_level);

  // Auto-engage the native Document (Figure-2) view the first time a phased
  // framework is opened.
  useEffect(() => {
    if (!viewTouched && frameworkFilter && isPhased) {
      setViewMode('doc');
    }
  }, [viewTouched, frameworkFilter, isPhased]);

  const selectedFramework = summaryData?.frameworks.find((f) => f.id === frameworkFilter);
  const fallbackFrameworkName = !selectedFramework && frameworkFilter && data?.controls?.length
    ? data.controls[0]?.framework_name
    : null;
  const effectiveFrameworkName = selectedFramework?.name || fallbackFrameworkName;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          {frameworkFilter && (selectedFramework || effectiveFrameworkName) ? (
            <>
              <div className="mb-1 flex items-center gap-2">
                <Link
                  href="/frameworks"
                  className="flex items-center gap-1 text-sm text-slate-600 transition-colors hover:text-slate-900"
                >
                  <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
                  Back to Frameworks
                </Link>
              </div>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
                <FileStack className="h-6 w-6 text-slate-900" strokeWidth={1.75} />
                {effectiveFrameworkName}
              </h1>
              <p className="text-slate-600">
                {selectedFramework
                  ? `${selectedFramework.control_count} controls extracted from this framework`
                  : 'Controls for this framework'}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-900">Controls Overview</h1>
              <p className="text-slate-600">Health snapshot and native framework structure for your extracted controls</p>
            </>
          )}
        </div>
        <Link
          href="/controls"
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          <Table2 className="h-4 w-4" strokeWidth={1.75} />
          Open Workbench
        </Link>
      </div>

      <ControlHealthSnapshot
        summary={statusSummary}
        totalFrameworks={frameworkFilter ? 1 : (summaryData?.total_frameworks ?? 0)}
        fallbackTotal={frameworkFilter ? (data?.total ?? 0) : (summaryData?.total_controls ?? 0)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[180px] flex-1 sm:min-w-[280px]">
          <SearchInput
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Search controls by ID, title, or description..."
            size="md"
          />
        </div>
        <MultiSelectDropdown
          title="Framework"
          items={(() => {
            const list = summaryData?.frameworks?.map((fw) => ({
              value: String(fw.id),
              label: `${fw.name} (${fw.control_count})`,
            })) || [];
            if (frameworkFilter && !summaryData?.frameworks?.find((f) => f.id === frameworkFilter) && effectiveFrameworkName) {
              list.unshift({ value: String(frameworkFilter), label: effectiveFrameworkName });
            }
            return list;
          })()}
          selectedValues={frameworkFilter ? [String(frameworkFilter)] : []}
          onApply={(v) => {
            setFrameworkFilter(v[0] ? Number(v[0]) : null);
            setPage(0);
          }}
          multiSelect={false}
          autoApply
          forceSearch
          placeholder="All Frameworks"
          searchPlaceholder="Search frameworks"
          size="md"
        />
        {frameworkFilter && isPhased && (
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => { setViewTouched(true); setViewMode('doc'); }}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                viewMode === 'doc' ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <FileText className="h-4 w-4" strokeWidth={1.75} /> Document
            </button>
            <button
              type="button"
              onClick={() => { setViewTouched(true); setViewMode('tree'); }}
              className={`flex items-center gap-1.5 border-l border-slate-200 px-3 py-2 text-sm font-medium transition-colors ${
                viewMode === 'tree' ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Layers className="h-4 w-4" strokeWidth={1.75} /> Tree
            </button>
            <button
              type="button"
              onClick={() => { setViewTouched(true); setViewMode('table'); }}
              className={`flex items-center gap-1.5 border-l border-slate-200 px-3 py-2 text-sm font-medium transition-colors ${
                viewMode === 'table' ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ClipboardList className="h-4 w-4" strokeWidth={1.75} /> Table
            </button>
          </div>
        )}
      </div>

      {viewMode === 'doc' && frameworkFilter ? (
        <Figure2View frameworkId={frameworkFilter} />
      ) : viewMode === 'tree' && frameworkFilter ? (
        <NativeFrameworkTree frameworkId={frameworkFilter} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full">
            <thead className="bg-white">
              <tr className="text-left text-sm font-medium text-slate-600">
                <th className="px-4 py-3">Control ID</th>
                <th className="px-4 py-3">Title</th>
                <th className="hidden px-4 py-3 md:table-cell">Framework</th>
                <th className="hidden px-4 py-3 lg:table-cell">Domain</th>
                <th className="px-4 py-3">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.controls ?? []).map((control) => (
                <tr key={control.id} className="bg-white/50 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm text-slate-900">
                      {control.original_reference || control.control_id}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="line-clamp-1 text-sm text-slate-900">{control.title}</p>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <span className="whitespace-nowrap rounded-full bg-primary-50 px-2 py-1 text-xs text-primary-700">
                      {control.framework_name}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    <span className="text-sm text-slate-600">{control.domain || '-'}</span>
                  </td>
                  <td className="px-4 py-3">
                    {control.priority_level ? (
                      <PriorityLevelBadge level={control.priority_level} />
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-600">
                        {control.priority}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {(!data?.controls || data.controls.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-500">
                    No controls to show. Select a framework or adjust your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
