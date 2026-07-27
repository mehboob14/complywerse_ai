'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, LifeBuoy, FileText, Plus, Trash2, X, ChevronRight, Layers,
  ShieldCheck, Link2, AlertTriangle, CalendarClock, Eye, ExternalLink, Server,
} from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { AnimatedModal, RightSlidePanel, PageLoader } from '@/components/ui';
import {
  PlanStatusBadge, DrillStatusBadge, SeverityBadge, StrategyStatusBadge,
  PLAN_STATUS_LABEL, FREQUENCY_OPTIONS, FREQUENCY_LABEL, CRITICALITY_OPTIONS, CRITICALITY_LABEL,
  DRILL_TYPE_LABEL, DRILL_TYPE_OPTIONS, STRATEGY_TYPE_LABEL, STRATEGY_TYPE_OPTIONS,
  DEP_TYPE_LABEL, DEP_TYPE_OPTIONS, EXTERNAL_BCP_OPTIONS, EXTERNAL_BCP_LABEL,
  fmtHours, fmtDate, BcmSelect, BcmEntitySelect, BcmAssetMultiSelect, useBcmToast,
} from '../../_bcm-ui';

const input = 'w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none';
const lbl = 'mb-0.5 block text-xs font-medium text-slate-600';
const TRANSITIONS: string[] = ['draft', 'under_review', 'approved', 'retired'];

export default function BcmPlanDetailPage() {
  const params = useParams<{ id: string }>();
  const planId = Number(params?.id);
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('bcm:plans:edit');
  const canDrill = hasPermission('bcm:drills:create');

  const { data: plan, isLoading, error } = useQuery({
    queryKey: ['bcm-plan', planId],
    queryFn: async () => (await bcmApi.plans.get(planId)).data as any,
    enabled: planId > 0,
  });

  const { ok } = useBcmToast();
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const transitionMut = useMutation({
    mutationFn: (status: string) => bcmApi.plans.transition(planId, status),
    onMutate: () => setTransitionError(null),
    onSuccess: (_res, status) => { qc.invalidateQueries({ queryKey: ['bcm-plan', planId] }); qc.invalidateQueries({ queryKey: ['bcm-plans'] }); ok(`Plan moved to ${PLAN_STATUS_LABEL[status] || status}`); },
    onError: (e: any) => setTransitionError(e?.response?.data?.detail || 'Transition failed.'),
  });

  const [addBia, setAddBia] = useState(false);
  const [openBiaId, setOpenBiaId] = useState<number | null>(null);
  const [scheduleDrill, setScheduleDrill] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  if (isLoading) return <PageLoader className="h-64" />;
  if (error || !plan) {
    return (
      <div className="px-3 sm:px-6">
        <Link href="/bcm/plans" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Back to Plans</Link>
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-600">Failed to load plan.</div>
      </div>
    );
  }

  const openBia = (plan.bia_records || []).find((b: any) => b.id === openBiaId) || null;

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <Link href="/bcm/plans" className="mt-0.5 rounded-md p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-800" title="Back to Plans">
              <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
            </Link>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><LifeBuoy className="h-5 w-5" strokeWidth={1.75} /></span>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Continuity Plan{plan.business_unit ? ` · ${plan.business_unit}` : ''}</div>
              <h1 className="text-lg font-semibold text-slate-900">{plan.title}</h1>
              {plan.description && <p className="mt-0.5 max-w-2xl text-xs text-slate-500">{plan.description}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <PlanStatusBadge status={plan.status} />
            {canEdit && (
              <button onClick={() => setShowEdit(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Edit</button>
            )}
          </div>
        </div>

        {/* Status transitions */}
        {canEdit && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
            <span className="mr-1 text-[11px] font-medium text-slate-400">Move to:</span>
            {TRANSITIONS.filter((s) => s !== plan.status).map((s) => (
              <button key={s} disabled={transitionMut.isPending} onClick={() => transitionMut.mutate(s)}
                className="rounded-md border border-slate-200 px-2.5 py-1 text-[12px] text-slate-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50">
                {PLAN_STATUS_LABEL[s]}
              </button>
            ))}
            {transitionError && <span className="text-[11px] text-rose-600">{transitionError}</span>}
          </div>
        )}
      </div>

      {/* Meta band */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Meta label="RTO" value={fmtHours(plan.rto_hours)} />
        <Meta label="RPO" value={fmtHours(plan.rpo_hours)} />
        <Meta label="Cadence" value={FREQUENCY_LABEL[plan.testing_frequency] || plan.testing_frequency} />
        <Meta label="Owner" value={plan.owner_name || '—'} />
        <Meta label="Review Due" value={fmtDate(plan.next_review_due)} />
        <Meta label="Document" value={plan.document_title || '—'} icon={plan.document_ref_id ? <FileText className="h-3.5 w-3.5 text-slate-400" /> : undefined} />
      </div>

      {/* BIA section */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Layers className="h-4 w-4 text-primary-500" /> Business Impact Analysis <span className="text-slate-400">({plan.bia_records?.length || 0})</span></h2>
          {hasPermission('bcm:bia:create') && (
            <button onClick={() => setAddBia(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"><Plus size={14} /> Add process</button>
          )}
        </div>
        {(!plan.bia_records || plan.bia_records.length === 0) ? (
          <p className="px-4 py-6 text-center text-xs text-slate-400">No BIA processes yet. Add the critical processes this plan protects.</p>
        ) : (
          <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {plan.bia_records.map((b: any) => (
              <button key={b.id} onClick={() => setOpenBiaId(b.id)}
                className="group rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-primary-300 hover:bg-slate-50">
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-800">{b.process_name}</span>
                  <SeverityBadge severity={b.criticality_rating} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  <span>RTO {fmtHours(b.rto_hours)}</span><span>RPO {fmtHours(b.rpo_hours)}</span><span>MTPD {fmtHours(b.mtpd_hours)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>{b.linked_assets?.length || 0} assets · {b.dependency_count} deps · {b.strategy_count} strateg{b.strategy_count === 1 ? 'y' : 'ies'}</span>
                  <span className="inline-flex items-center gap-0.5 text-primary-600 opacity-0 group-hover:opacity-100">Open <ChevronRight className="h-3 w-3" /></span>
                </div>
                {!b.is_complete && <div className="mt-1 text-[10px] font-medium text-amber-600">⚠ Needs a recovery strategy</div>}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Drills for this plan */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><CalendarClock className="h-4 w-4 text-primary-500" /> Drills <span className="text-slate-400">({plan.drills?.length || 0})</span></h2>
          {canDrill && (
            <button onClick={() => setScheduleDrill(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"><Plus size={14} /> Schedule drill</button>
          )}
        </div>
        {(!plan.drills || plan.drills.length === 0) ? (
          <p className="px-4 py-6 text-center text-xs text-slate-400">No drills scheduled for this plan yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {plan.drills.map((d: any) => (
              <li key={d.id}>
                <Link href={`/bcm/drills/${d.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{d.title}</div>
                    <div className="text-[11px] text-slate-400">{DRILL_TYPE_LABEL[d.drill_type] || d.drill_type} · {fmtDate(d.scheduled_date)}{d.finding_count ? ` · ${d.finding_count} finding${d.finding_count === 1 ? '' : 's'}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-2"><DrillStatusBadge status={d.effective_status} /><Eye className="h-4 w-4 text-slate-300" /></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {openBia && <BiaPanel bia={openBia} planId={planId} onClose={() => setOpenBiaId(null)} />}
      {addBia && <AddBiaModal planId={planId} onClose={() => setAddBia(false)} />}
      {scheduleDrill && <ScheduleDrillModal planId={planId} planTitle={plan.title} onClose={() => setScheduleDrill(false)} />}
      {showEdit && <EditPlanModal plan={plan} onClose={() => setShowEdit(false)} />}
    </div>
  );
}

function Meta({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 flex items-center gap-1 truncate text-sm font-medium text-slate-800">{icon}{value}</div>
    </div>
  );
}

// ── BIA detail slide-over: dependencies + recovery strategies + risk link ────
function BiaPanel({ bia, planId, onClose }: { bia: any; planId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const { ok, fail } = useBcmToast();
  const canEdit = hasPermission('bcm:bia:edit');
  const refresh = () => qc.invalidateQueries({ queryKey: ['bcm-plan', planId] });

  const [depForm, setDepForm] = useState<any>({ dependency_type: 'system', name: '', criticality: 'medium', external_bcp_status: '' });
  const [showDep, setShowDep] = useState(false);
  const [stratForm, setStratForm] = useState<any>({ strategy_type: 'alternate_site', description: '' });
  const [showStrat, setShowStrat] = useState(false);

  const addDep = useMutation({
    mutationFn: () => bcmApi.bia.addDependency(bia.id, {
      dependency_type: depForm.dependency_type, name: depForm.name, criticality: depForm.criticality,
      external_bcp_status: depForm.dependency_type === 'vendor' ? (depForm.external_bcp_status || 'requested') : (depForm.external_bcp_status || null),
    }),
    onSuccess: () => { setShowDep(false); setDepForm({ dependency_type: 'system', name: '', criticality: 'medium', external_bcp_status: '' }); refresh(); ok('Dependency added'); },
    onError: (e) => fail(e, 'Could not add dependency'),
  });
  const delDep = useMutation({ mutationFn: (id: number) => bcmApi.dependencies.remove(id), onSuccess: () => { refresh(); ok('Dependency removed'); }, onError: (e) => fail(e, 'Could not remove dependency') });
  const addStrat = useMutation({
    mutationFn: () => bcmApi.bia.addStrategy(bia.id, { strategy_type: stratForm.strategy_type, description: stratForm.description || null }),
    onSuccess: () => { setShowStrat(false); setStratForm({ strategy_type: 'alternate_site', description: '' }); refresh(); ok('Recovery strategy added'); },
    onError: (e) => fail(e, 'Could not add strategy'),
  });
  const setStratStatus = useMutation({ mutationFn: ({ id, status }: { id: number; status: string }) => bcmApi.strategies.update(id, { status }), onSuccess: (_r, v) => { refresh(); ok(`Strategy ${v.status}`); }, onError: (e) => fail(e, 'Could not update strategy') });
  const delStrat = useMutation({ mutationFn: (id: number) => bcmApi.strategies.remove(id), onSuccess: () => { refresh(); ok('Strategy removed'); }, onError: (e) => fail(e, 'Could not remove strategy') });
  const linkRisk = useMutation({ mutationFn: (risk_id?: number) => bcmApi.bia.linkRisk(bia.id, { risk_id }), onSuccess: () => { refresh(); ok('Risk linked'); }, onError: (e) => fail(e, 'Could not link risk') });
  const updateAssets = useMutation({ mutationFn: (ids: number[]) => bcmApi.bia.update(bia.id, { linked_asset_ids: ids }), onSuccess: () => { refresh(); ok('Linked assets updated'); }, onError: (e) => fail(e, 'Could not update assets') });

  return (
    <RightSlidePanel isOpen onClose={onClose} title={bia.process_name} subtitle={`${CRITICALITY_LABEL[bia.criticality_rating]} · RTO ${fmtHours(bia.rto_hours)} · RPO ${fmtHours(bia.rpo_hours)} · MTPD ${fmtHours(bia.mtpd_hours)}`} width="w-full max-w-lg">
      <div className="space-y-5">
        {/* Risk linkage */}
        <div className="rounded-lg border border-slate-200 p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Risk Register</h4>
          {bia.linked_risk_id ? (
            <div className="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5">
              <span className="truncate text-xs text-slate-700"><span className="font-medium">{bia.linked_risk_title || `Risk #${bia.linked_risk_id}`}</span></span>
              <Link href="/erm/risks" className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-primary-600 hover:underline">Open <ExternalLink className="h-3 w-3" /></Link>
            </div>
          ) : canEdit ? (
            <div className="mt-2 space-y-1.5">
              {(bia.criticality_rating === 'critical' || bia.criticality_rating === 'high') && (
                <p className="text-[11px] text-amber-600">Critical/High process — link it to the register.</p>
              )}
              <BcmEntitySelect kind="risks" value={null} onChange={(id) => id && linkRisk.mutate(id)} placeholder="Link an existing risk…" />
              <button onClick={() => linkRisk.mutate(undefined)} className="inline-flex items-center gap-1 text-[11px] text-primary-600 hover:underline"><Plus size={12} /> Create a new risk from this process</button>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-slate-400">No risk linked.</p>
          )}
        </div>

        {/* Linked IT assets */}
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Server className="h-3.5 w-3.5 text-primary-500" /> Linked assets ({bia.linked_assets?.length || 0})</h4>
          {canEdit ? (
            <BcmAssetMultiSelect value={bia.linked_asset_ids || []} onChange={(ids) => updateAssets.mutate(ids)} autoApply={false} />
          ) : (bia.linked_assets?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {bia.linked_assets.map((a: any) => <span key={a.id} className="rounded border border-slate-100 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">{a.name}</span>)}
            </div>
          ) : <p className="text-[11px] text-slate-400">No assets linked.</p>)}
        </div>

        {/* Dependencies */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Link2 className="h-3.5 w-3.5 text-primary-500" /> Dependencies ({bia.dependencies?.length || 0})</h4>
            {canEdit && <button onClick={() => setShowDep((v) => !v)} className="inline-flex items-center gap-1 text-[11px] text-primary-600 hover:underline"><Plus size={12} /> Add</button>}
          </div>
          {showDep && (
            <div className="mb-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <div className="grid grid-cols-2 gap-2">
                <BcmSelect value={depForm.dependency_type} onChange={(v) => setDepForm({ ...depForm, dependency_type: v })} options={DEP_TYPE_OPTIONS} ariaLabel="Dependency type" />
                <BcmSelect value={depForm.criticality} onChange={(v) => setDepForm({ ...depForm, criticality: v })} options={CRITICALITY_OPTIONS} ariaLabel="Criticality" />
              </div>
              <input className={input} placeholder="Named system / vendor / role / site" value={depForm.name} onChange={(e) => setDepForm({ ...depForm, name: e.target.value })} />
              {depForm.dependency_type === 'vendor' && (
                <BcmSelect value={depForm.external_bcp_status} onChange={(v) => setDepForm({ ...depForm, external_bcp_status: v })} options={EXTERNAL_BCP_OPTIONS} placeholder="Vendor BCP status…" ariaLabel="Vendor BCP status" />
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowDep(false)} className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600">Cancel</button>
                <button disabled={!depForm.name.trim() || addDep.isPending} onClick={() => addDep.mutate()} className="rounded bg-primary-600 px-2.5 py-1 text-[11px] font-medium text-[#0a0a0a] disabled:opacity-40">Add</button>
              </div>
              {addDep.isError && <p className="text-[11px] text-rose-600">{(addDep.error as any)?.response?.data?.detail || 'Failed.'}</p>}
            </div>
          )}
          <ul className="space-y-1">
            {(bia.dependencies || []).map((d: any) => (
              <li key={d.id} className="flex items-center justify-between rounded-md border border-slate-100 px-2.5 py-1.5 text-xs">
                <div className="min-w-0">
                  <span className="font-medium text-slate-700">{d.name}</span>
                  <span className="ml-1.5 text-slate-400">{DEP_TYPE_LABEL[d.dependency_type]}{d.external_bcp_status ? ` · ${EXTERNAL_BCP_LABEL[d.external_bcp_status]}` : ''}</span>
                </div>
                {canEdit && <button onClick={() => delDep.mutate(d.id)} className="text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button>}
              </li>
            ))}
            {(!bia.dependencies || bia.dependencies.length === 0) && <li className="text-[11px] text-slate-400">No dependencies recorded.</li>}
          </ul>
        </div>

        {/* Recovery strategies */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Recovery strategies ({bia.recovery_strategies?.length || 0})</h4>
            {canEdit && <button onClick={() => setShowStrat((v) => !v)} className="inline-flex items-center gap-1 text-[11px] text-primary-600 hover:underline"><Plus size={12} /> Add</button>}
          </div>
          {showStrat && (
            <div className="mb-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <BcmSelect value={stratForm.strategy_type} onChange={(v) => setStratForm({ ...stratForm, strategy_type: v })} options={STRATEGY_TYPE_OPTIONS} ariaLabel="Strategy type" />
              <textarea rows={2} className={input} placeholder="How this process is recovered…" value={stratForm.description} onChange={(e) => setStratForm({ ...stratForm, description: e.target.value })} />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowStrat(false)} className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600">Cancel</button>
                <button disabled={addStrat.isPending} onClick={() => addStrat.mutate()} className="rounded bg-primary-600 px-2.5 py-1 text-[11px] font-medium text-[#0a0a0a] disabled:opacity-40">Add</button>
              </div>
            </div>
          )}
          <ul className="space-y-1.5">
            {(bia.recovery_strategies || []).map((s: any) => (
              <li key={s.id} className="rounded-md border border-slate-100 px-2.5 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-700">{STRATEGY_TYPE_LABEL[s.strategy_type]}</span>
                  <div className="flex items-center gap-1.5">
                    <StrategyStatusBadge status={s.status} />
                    {canEdit && <button onClick={() => delStrat.mutate(s.id)} className="text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button>}
                  </div>
                </div>
                {s.description && <p className="mt-1 text-[11px] text-slate-500">{s.description}</p>}
                {canEdit && s.status === 'proposed' && (
                  <div className="mt-1.5 flex gap-1.5">
                    <button onClick={() => setStratStatus.mutate({ id: s.id, status: 'approved' })} className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Approve</button>
                    <button onClick={() => setStratStatus.mutate({ id: s.id, status: 'rejected' })} className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">Reject</button>
                  </div>
                )}
              </li>
            ))}
            {(!bia.recovery_strategies || bia.recovery_strategies.length === 0) && <li className="text-[11px] text-slate-400">No recovery strategies — add at least one to complete this BIA.</li>}
          </ul>
        </div>
      </div>
    </RightSlidePanel>
  );
}

function AddBiaModal({ planId, onClose }: { planId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { ok } = useBcmToast();
  const [f, setF] = useState<any>({ process_name: '', criticality_rating: 'medium', rto_hours: '', rpo_hours: '', mtpd_hours: '', description: '', linked_asset_ids: [] });
  const mut = useMutation({
    mutationFn: () => bcmApi.bia.create(planId, {
      process_name: f.process_name, criticality_rating: f.criticality_rating, description: f.description || null,
      rto_hours: f.rto_hours === '' ? null : Number(f.rto_hours),
      rpo_hours: f.rpo_hours === '' ? null : Number(f.rpo_hours),
      mtpd_hours: f.mtpd_hours === '' ? null : Number(f.mtpd_hours),
      linked_asset_ids: f.linked_asset_ids,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bcm-plan', planId] }); ok('BIA process added'); onClose(); },
  });
  return (
    <AnimatedModal isOpen onClose={onClose} title="Add BIA process" size="md"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Cancel</button>
        <button disabled={!f.process_name.trim() || mut.isPending} onClick={() => mut.mutate()} className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-[#0a0a0a] disabled:opacity-40">Add</button>
      </div>}>
      <div className="space-y-3 p-5">
        <div><label className={lbl}>Process name *</label><input className={input} value={f.process_name} onChange={(e) => setF({ ...f, process_name: e.target.value })} placeholder="e.g. Payment authorisation" /></div>
        <div><label className={lbl}>Criticality</label><BcmSelect value={f.criticality_rating} onChange={(v) => setF({ ...f, criticality_rating: v })} options={CRITICALITY_OPTIONS} ariaLabel="Criticality" /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className={lbl}>RTO (h)</label><input type="number" min={0} className={input} value={f.rto_hours} onChange={(e) => setF({ ...f, rto_hours: e.target.value })} /></div>
          <div><label className={lbl}>RPO (h)</label><input type="number" min={0} className={input} value={f.rpo_hours} onChange={(e) => setF({ ...f, rpo_hours: e.target.value })} /></div>
          <div><label className={lbl}>MTPD (h)</label><input type="number" min={0} className={input} value={f.mtpd_hours} onChange={(e) => setF({ ...f, mtpd_hours: e.target.value })} /></div>
        </div>
        <p className="text-[11px] text-slate-400">RTO must be shorter than MTPD.</p>
        <div>
          <label className={lbl}>Linked assets</label>
          <BcmAssetMultiSelect value={f.linked_asset_ids} onChange={(ids) => setF({ ...f, linked_asset_ids: ids })} />
          <p className="mt-1 text-[11px] text-slate-400">IT inventory assets this process depends on.</p>
        </div>
        {mut.isError && <p className="text-xs text-rose-600">{(mut.error as any)?.response?.data?.detail || 'Failed to add process.'}</p>}
      </div>
    </AnimatedModal>
  );
}

function ScheduleDrillModal({ planId, planTitle, onClose }: { planId: number; planTitle: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { ok, fail } = useBcmToast();
  const [f, setF] = useState<any>({ title: '', drill_type: 'tabletop', scheduled_date: '', scenario: '' });
  const mut = useMutation({
    mutationFn: () => bcmApi.drills.create({
      plan_id: planId, title: f.title, drill_type: f.drill_type,
      scheduled_date: f.scheduled_date || null, scenario: f.scenario || null, source_type: 'scheduled_test',
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bcm-plan', planId] }); ok('Drill scheduled'); onClose(); },
    onError: (e) => fail(e, 'Could not schedule drill'),
  });
  return (
    <AnimatedModal isOpen onClose={onClose} title="Schedule drill" subtitle={planTitle} size="md"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Cancel</button>
        <button disabled={!f.title.trim() || mut.isPending} onClick={() => mut.mutate()} className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-[#0a0a0a] disabled:opacity-40">Schedule</button>
      </div>}>
      <div className="space-y-3 p-5">
        <div><label className={lbl}>Title *</label><input className={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Q3 failover tabletop" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Type</label><BcmSelect value={f.drill_type} onChange={(v) => setF({ ...f, drill_type: v })} options={DRILL_TYPE_OPTIONS} ariaLabel="Drill type" /></div>
          <div><label className={lbl}>Scheduled date</label><input type="date" className={input} value={f.scheduled_date} onChange={(e) => setF({ ...f, scheduled_date: e.target.value })} /></div>
        </div>
        <div><label className={lbl}>Scenario</label><textarea rows={2} className={input} value={f.scenario} onChange={(e) => setF({ ...f, scenario: e.target.value })} /></div>
      </div>
    </AnimatedModal>
  );
}

function EditPlanModal({ plan, onClose }: { plan: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { ok } = useBcmToast();
  const [f, setF] = useState<any>({
    title: plan.title, business_unit: plan.business_unit || '', description: plan.description || '',
    rto_hours: plan.rto_hours ?? '', rpo_hours: plan.rpo_hours ?? '', testing_frequency: plan.testing_frequency,
    next_review_due: plan.next_review_due ? plan.next_review_due.slice(0, 10) : '',
    document_ref_id: plan.document_ref_id, document_title: plan.document_title || '',
    owner_id: plan.owner_id, owner_name: plan.owner_name || '',
  });
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const mut = useMutation({
    mutationFn: () => bcmApi.plans.update(plan.id, {
      title: f.title, business_unit: f.business_unit || null, description: f.description || null,
      rto_hours: f.rto_hours === '' ? null : Number(f.rto_hours), rpo_hours: f.rpo_hours === '' ? null : Number(f.rpo_hours),
      testing_frequency: f.testing_frequency, next_review_due: f.next_review_due || null,
      document_ref_id: f.document_ref_id, owner_id: f.owner_id,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bcm-plan', plan.id] }); qc.invalidateQueries({ queryKey: ['bcm-plans'] }); ok('Plan updated'); onClose(); },
  });
  return (
    <AnimatedModal isOpen onClose={onClose} title="Edit plan" size="lg"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Cancel</button>
        <button disabled={!f.title.trim() || mut.isPending} onClick={() => mut.mutate()} className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-[#0a0a0a] disabled:opacity-40">Save</button>
      </div>}>
      <div className="space-y-3 p-5">
        <div><label className={lbl}>Title *</label><input className={input} value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Business unit</label><input className={input} value={f.business_unit} onChange={(e) => set('business_unit', e.target.value)} /></div>
          <div><label className={lbl}>Cadence</label><BcmSelect value={f.testing_frequency} onChange={(v) => set('testing_frequency', v)} options={FREQUENCY_OPTIONS} ariaLabel="Testing cadence" /></div>
        </div>
        <div><label className={lbl}>Description</label><textarea rows={2} className={input} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className={lbl}>RTO (h)</label><input type="number" min={0} className={input} value={f.rto_hours} onChange={(e) => set('rto_hours', e.target.value)} /></div>
          <div><label className={lbl}>RPO (h)</label><input type="number" min={0} className={input} value={f.rpo_hours} onChange={(e) => set('rpo_hours', e.target.value)} /></div>
          <div><label className={lbl}>Review due</label><input type="date" className={input} value={f.next_review_due} onChange={(e) => set('next_review_due', e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Owner</label>
            <BcmEntitySelect kind="users" value={f.owner_id} onChange={(id) => set('owner_id', id)} placeholder="Assign owner…"
              extraOptions={f.owner_id ? [{ value: f.owner_id, label: f.owner_name || `User #${f.owner_id}` }] : undefined} />
          </div>
          <div>
            <label className={lbl}>Document</label>
            <BcmEntitySelect kind="documents" value={f.document_ref_id} onChange={(id) => set('document_ref_id', id)} placeholder="Link document…"
              extraOptions={f.document_ref_id ? [{ value: f.document_ref_id, label: f.document_title || `Doc #${f.document_ref_id}` }] : undefined} />
          </div>
        </div>
        {mut.isError && <p className="text-xs text-rose-600">{(mut.error as any)?.response?.data?.detail || 'Failed to save.'}</p>}
      </div>
    </AnimatedModal>
  );
}
