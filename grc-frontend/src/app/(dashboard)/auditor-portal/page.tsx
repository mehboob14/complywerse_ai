'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { certificationsApi } from '@/lib/api';
import { CertificationJourney } from '@/types';
import { SearchInput, PageLoader } from '@/components/ui';
import {
  Loader2,
  Shield,
  ChevronRight,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';

export default function AuditorPortalIndexPage() {
  const [search, setSearch] = useState('');

  const { data: certifications, isLoading, error } = useQuery({
    queryKey: ['certifications'],
    queryFn: async () => {
      const response = await certificationsApi.getAll();
      return response.data as CertificationJourney[];
    },
  });

  // The list endpoint returns the flat journey name; only the per-journey
  // detail endpoint populates a nested `framework` object. Resolve through
  // every plausible source so we never fall through to a generic
  // "Untitled framework" placeholder for an active journey.
  const resolveName = (j: CertificationJourney): string =>
    j.framework?.name || j.framework_name || j.name || 'Untitled framework';

  const frameworks = useMemo(() => {
    const list = (certifications || []) as CertificationJourney[];
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((j) => {
      const name = resolveName(j).toLowerCase();
      const code = (j.framework?.short_code || '').toLowerCase();
      return name.includes(term) || code.includes(term);
    });
  }, [certifications, search]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">Auditor Portal</h1>
          <p className="mt-1 text-sm text-slate-600">Pick a framework certification journey to review evidence, controls, and compliance progress.</p>
        </div>
        <div className="w-full sm:w-72 flex-shrink-0">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search frameworks..."
            size="md"
          />
        </div>
      </div>

      {isLoading ? (
        <PageLoader className="h-64" />
      ) : error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Failed to load frameworks. Please try again.
        </div>
      ) : frameworks.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <Shield className="mx-auto h-10 w-10 text-slate-400" />
          <p className="mt-3 text-sm font-semibold text-slate-900">No frameworks available</p>
          <p className="mt-1 text-xs text-slate-500">
            {search ? 'Try a different search term.' : 'Start a certification journey from the Frameworks page to access the auditor portal.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {frameworks.map((journey) => {
            const name = resolveName(journey);
            const code = journey.framework?.short_code || '';
            const status = journey.status || 'in_progress';
            return (
              <Link
                key={journey.id}
                href={`/auditor-portal/${journey.id}`}
                className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {code ? `${code} • ` : ''}
                      {status.replace(/_/g, ' ')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 text-xs font-medium text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  Open
                  <ChevronRight className="h-3 w-3" />
                </div>
                <ExternalLink className="h-4 w-4 text-slate-400 group-hover:text-blue-600 transition-colors flex-shrink-0 group-hover:hidden" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
