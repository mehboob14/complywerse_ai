'use client';

// Vendor Assessments — rebuilt as the TPRA lifecycle workspace. One row per
// vendor showing its active assessment's stage / tier / residual / open findings,
// driven by the single /vendor-risk/tpra/board endpoint. Row → the vendor's
// Lifecycle tab. "New Assessment" picks a vendor and onboards it into the 11-stage flow.

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, AlertCircle, Plus, ArrowRight, Layers, ShieldCheck, AlertOctagon, CalendarClock, PlayCircle,
} from 'lucide-react';
import { tpraApi, vendorRiskApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { SearchInput, MultiSelectDropdown, RightSlidePanel, PageLoader } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import {
  StageProgress, STAGE_SEQUENCE, tierBadge, stageLabel, stageNumberLabel, type BoardRow,
} from '../_lib/lifecycleShared';

interface VendorOption { id: number; name: string }

const TIERS = ['critical', 'high', 'medium', 'low'];

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
}

export default function VendorAssessmentsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('vendor_risk:assessments:create') || hasPermission('erm:risks:edit');

  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  // Default ON: Assessments reads as the in-flight / overdue work queue, so
  // vendors awaiting onboarding are hidden until the analyst opts to see them.
  const [hideNotStarted, setHideNotStarted] = useState(true);
  const [showStart, setShowStart] = useState(false);
  const [startVendorId, setStartVendorId] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['tpra-board'],
    queryFn: async () => (await tpraApi.getBoard()).data as { items: BoardRow[]; total: number },
    placeholderData: keepPreviousData,
  });

  const { data: vendors } = useQuery({
    queryKey: ['vendors-select'],
    queryFn: async () => {
      const res = await vendorRiskApi.getVendors();
      const d = res.data;
      return (Array.isArray(d) ? d : d.items ?? []) as VendorOption[];
    },
    placeholderData: keepPreviousData,
  });

  const startMut = useMutation({
    mutationFn: (vendorId: number) => tpraApi.initLifecycle(vendorId),
    onSuccess: (_res, vendorId) => {
      qc.invalidateQueries({ queryKey: ['tpra-board'] });
      setShowStart(false);
      setStartVendorId('');
      toast({ type: 'success', title: 'Assessment created' });
      router.push(`/vendor-risk/vendors/${vendorId}`);
    },
    onError: (e) => toast({ type: 'error', title: 'Could not start', message: errMsg(e, 'Try again.') }),
  });

  const rows = data?.items || [];

  const stats = useMemo(() => {
    const inLifecycle = rows.filter((r) => r.has_assessment).length;
    const notStarted = rows.filter((r) => !r.has_assessment).length;
    const openFindings = rows.reduce((acc, r) => acc + (r.open_findings || 0), 0);
    const highResidual = rows.filter((r) => r.residual_rating === 'high' || r.residual_rating === 'critical').length;
    return { inLifecycle, notStarted, openFindings, highResidual };
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const matchSearch = !search || r.vendor_name.toLowerCase().includes(search.toLowerCase());
      const matchTier = tierFilter === 'all' || (r.tier || '').toLowerCase() === tierFilter;
      const matchStage = stageFilter === 'all' || r.current_stage === stageFilter;
      const matchStarted = !hideNotStarted || r.has_assessment;
      return matchSearch && matchTier && matchStage && matchStarted;
    });
  }, [rows, search, tierFilter, stageFilter, hideNotStarted]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><PageLoader size="md" label="Loading vendor lifecycle…" /></div>;
  }
  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-500">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p className="text-sm">Failed to load the lifecycle board.</p>
        <button onClick={() => qc.invalidateQueries({ queryKey: ['tpra-board'] })} className="mt-2 text-xs font-medium text-primary-600 hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Vendor Assessments</h1>
          <p className="text-sm text-gray-500 mt-1">Third-party risk lifecycle across your vendors — stage, tier and residual at a glance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/vendor-risk/vendors" className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Vendors</Link>
          <Link href="/vendor-risk/questionnaires" className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Questionnaires</Link>
          {canCreate && (
            <button onClick={() => setShowStart(true)} className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium">
              <Plus className="h-4 w-4" /> New Assessment
            </button>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Layers} label="In lifecycle" value={stats.inLifecycle} tone="text-blue-600" />
        <StatCard icon={PlayCircle} label="Awaiting onboarding" value={stats.notStarted} tone="text-gray-600" />
        <StatCard icon={AlertOctagon} label="Open findings" value={stats.openFindings} tone="text-orange-600" />
        <StatCard icon={ShieldCheck} label="High / Critical residual" value={stats.highResidual} tone="text-red-600" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="flex-1 min-w-[180px] sm:min-w-[260px] max-w-md">
            <SearchInput value={search} onChange={setSearch} placeholder="Search vendors…" variant="square" />
          </div>
          <MultiSelectDropdown
            title="Tier" multiSelect={false}
            selectedValues={tierFilter === 'all' ? [] : [tierFilter]}
            onApply={(v) => setTierFilter(v[0] ?? 'all')}
            items={[{ value: 'all', label: 'All Tiers' }, ...TIERS.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))]}
            placeholder="All Tiers"
          />
          <MultiSelectDropdown
            title="Stage" multiSelect={false} forceSearch
            selectedValues={stageFilter === 'all' ? [] : [stageFilter]}
            onApply={(v) => setStageFilter(v[0] ?? 'all')}
            items={[{ value: 'all', label: 'All Stages' }, ...STAGE_SEQUENCE.map((s, i) => ({ value: s.key, label: `${String(i + 1).padStart(2, '0')} · ${s.label}` }))]}
            placeholder="All Stages"
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={hideNotStarted} onChange={(e) => setHideNotStarted(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300" />
            In lifecycle only
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tier</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lifecycle</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Residual</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Findings</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Next review</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-500">
                    <Layers className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium text-gray-600">{rows.length === 0 ? 'No vendors yet' : 'No vendors match these filters'}</p>
                    <p className="text-xs mt-1">
                      {rows.length === 0
                        ? <>Add a vendor in <Link href="/vendor-risk/vendors" className="text-primary-600 hover:underline">Vendors</Link>, then start its lifecycle.</>
                        : 'Adjust the tier / stage filters above.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.vendor_id} className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => router.push(`/vendor-risk/vendors/${r.vendor_id}`)}>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-slate-900">{r.vendor_name}</span>
                      {r.has_assessment && r.version_no ? <span className="ml-1.5 text-[11px] text-gray-400">v{r.version_no}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${tierBadge(r.tier)}`}>{r.tier || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {r.has_assessment ? (
                        <div className="flex flex-col gap-1">
                          <StageProgress currentKey={r.current_stage} size="sm" />
                          <span className="text-[11px] text-gray-500">{stageNumberLabel(r.current_stage)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">Not started</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.residual_rating ? (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${tierBadge(r.residual_rating)}`}>{r.residual_rating}</span>
                      ) : <span className="text-sm text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {r.open_findings > 0 ? (
                        <span className="inline-flex items-center gap-1 text-sm">
                          <span className="font-medium text-slate-800">{r.open_findings}</span>
                          {r.open_critical > 0 && (
                            <span className="inline-flex items-center gap-0.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                              <AlertOctagon className="h-3 w-3" />{r.open_critical} crit
                            </span>
                          )}
                        </span>
                      ) : <span className="text-sm text-gray-400">0</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5 text-gray-400" />{fmtDate(r.next_review)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {r.has_assessment ? (
                          <button onClick={(e) => { e.stopPropagation(); router.push(`/vendor-risk/vendors/${r.vendor_id}`); }}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50" title="Open lifecycle">
                            Open <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        ) : canCreate ? (
                          <button onClick={(e) => { e.stopPropagation(); startMut.mutate(r.vendor_id); }} disabled={startMut.isPending}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50" title="Create this vendor's assessment">
                            {startMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />} Assess
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Start lifecycle panel */}
      <RightSlidePanel isOpen={showStart} onClose={() => setShowStart(false)} title="New Assessment" width="w-full max-w-lg"
        subtitle="Pick a vendor to create its third-party risk assessment (the 11-stage TPRA lifecycle)"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowStart(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button onClick={() => startVendorId && startMut.mutate(Number(startVendorId))} disabled={!startVendorId || startMut.isPending}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
              {startMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Create Assessment
            </button>
          </div>
        }>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-800">Vendor</label>
            <MultiSelectDropdown
              title="Vendor" multiSelect={false} triggerVariant="input" size="md" forceSearch
              placeholder="Select a vendor…"
              selectedValues={startVendorId ? [startVendorId] : []}
              onApply={(v) => setStartVendorId(v[0] ?? '')}
              items={(vendors ?? []).map((v) => ({ value: String(v.id), label: v.name }))}
            />
            {(vendors ?? []).length === 0 && (
              <p className="mt-1 text-xs text-amber-600">No vendors yet. Add one in <Link href="/vendor-risk/vendors" className="underline">Vendors</Link> first.</p>
            )}
          </div>
          <p className="rounded-lg bg-blue-50 p-2 text-[11px] text-blue-700">
            Intake begins immediately. The Inherent Risk Tiering gate (stage 02) then sets assessment depth and reassessment cadence.
          </p>
        </div>
      </RightSlidePanel>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }: { icon: typeof Layers; label: string; value: number; tone: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 uppercase font-medium">{label}</p>
        <Icon className={`h-4 w-4 ${tone}`} />
      </div>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
    </div>
  );
}
