'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, CalendarClock, Siren, Trash2, Plus, AlertTriangle, ClipboardCheck,
  ExternalLink, Link2,
} from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { PageLoader, AnimatedModal } from '@/components/ui';
import {
  DrillStatusBadge, SeverityBadge, IssueStatusBadge,
  DRILL_STATUS_LABEL, DRILL_TYPE_LABEL, DRILL_TYPE_OPTIONS, SOURCE_TYPE_LABEL, SEVERITY_OPTIONS,
  fmtDate, fmtDateTime, fmtHours, BcmSelect, BcmEntitySelect, useBcmToast,
} from '../../_bcm-ui';

const RTO_MET_OPTIONS = [
  { value: '', label: 'Not assessed' },
  { value: 'yes', label: 'Yes — met' },
  { value: 'no', label: 'No — missed' },
];

const input = 'w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none';
const lbl = 'mb-0.5 block text-xs font-medium text-slate-600';
const DRILL_FLOW = ['scheduled', 'in_progress', 'completed', 'under_review', 'closed', 'cancelled'];
const triBool = (v: boolean | null | undefined) => (v === true ? 'yes' : v === false ? 'no' : '');

export default function BcmDrillDetailPage() {
  const params = useParams<{ id: string }>();
  const drillId = Number(params?.id);
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('bcm:drills:edit');
  const canFinding = hasPermission('bcm:findings:create');
  const { ok } = useBcmToast();

  const { data: drill, isLoading, error } = useQuery({
    queryKey: ['bcm-drill', drillId],
    queryFn: async () => (await bcmApi.drills.get(drillId)).data as any,
    enabled: drillId > 0,
  });

  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const transitionMut = useMutation({
    mutationFn: (status: string) => bcmApi.drills.transition(drillId, status),
    onMutate: () => setTransitionError(null),
    onSuccess: (_res, status) => { qc.invalidateQueries({ queryKey: ['bcm-drill', drillId] }); ok(`Drill moved to ${DRILL_STATUS_LABEL[status] || status}`); },
    onError: (e: any) => setTransitionError(e?.response?.data?.detail || 'Transition failed.'),
  });

  if (isLoading) return <PageLoader className="h-64" />;
  if (error || !drill) {
    return (
      <div className="px-3 sm:px-6">
        <Link href="/bcm/drills" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Back to Drills</Link>
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-600">Failed to load drill.</div>
      </div>
    );
  }

  const isIncident = drill.source_type === 'incident_triggered';

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <Link href="/bcm/drills" className="mt-0.5 rounded-md p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-800" title="Back to Drills"><ArrowLeft className="h-4 w-4" strokeWidth={1.75} /></Link>
            <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${isIncident ? 'bg-rose-50 text-rose-600' : 'bg-primary-50 text-primary-600'}`}>
              {isIncident ? <Siren className="h-5 w-5" strokeWidth={1.75} /> : <CalendarClock className="h-5 w-5" strokeWidth={1.75} />}
            </span>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                {SOURCE_TYPE_LABEL[drill.source_type]} · {DRILL_TYPE_LABEL[drill.drill_type]}
                {drill.plan_title && <> · <Link href={`/bcm/plans/${drill.plan_id}`} className="text-primary-600 hover:underline">{drill.plan_title}</Link></>}
              </div>
              <h1 className="text-lg font-semibold text-slate-900">{drill.title}</h1>
              {drill.scenario && <p className="mt-0.5 max-w-2xl text-xs text-slate-500">{drill.scenario}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <DrillStatusBadge status={drill.effective_status} />
            {canEdit && <button onClick={() => setShowEdit(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Edit</button>}
          </div>
        </div>

        {canEdit && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
            <span className="mr-1 text-[11px] font-medium text-slate-400">Move to:</span>
            {DRILL_FLOW.filter((s) => s !== drill.status).map((s) => (
              <button key={s} disabled={transitionMut.isPending} onClick={() => transitionMut.mutate(s)}
                className="rounded-md border border-slate-200 px-2.5 py-1 text-[12px] text-slate-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50">{DRILL_STATUS_LABEL[s]}</button>
            ))}
            {transitionError && <span className="text-[11px] text-rose-600">{transitionError}</span>}
          </div>
        )}
      </div>

      {/* Meta band */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Meta label="Scheduled" value={fmtDate(drill.scheduled_date)} />
        <Meta label="Started" value={fmtDateTime(drill.actual_start)} />
        <Meta label="Ended" value={fmtDateTime(drill.actual_end)} />
        <Meta label="Owner" value={drill.owner_name || '—'} />
        {isIncident
          ? <Meta label="Incident" value={drill.linked_incident_title || `#${drill.linked_incident_id}`} />
          : <Meta label="Findings" value={String(drill.finding_count)} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ResultCard drill={drill} canEdit={canEdit} />
        <FindingsCard drill={drill} canFinding={canFinding} />
      </div>

      {showEdit && <EditDrillModal drill={drill} onClose={() => setShowEdit(false)} />}
    </div>
  );
}

function EditDrillModal({ drill, onClose }: { drill: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { ok } = useBcmToast();
  const isIncident = drill.source_type === 'incident_triggered';
  const [f, setF] = useState<any>({
    title: drill.title, drill_type: drill.drill_type, scenario: drill.scenario || '',
    scheduled_date: drill.scheduled_date ? drill.scheduled_date.slice(0, 10) : '',
    owner_id: drill.owner_id, owner_name: drill.owner_name || '',
    linked_incident_id: drill.linked_incident_id, incident_title: drill.linked_incident_title || '',
  });
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const mut = useMutation({
    mutationFn: () => bcmApi.drills.update(drill.id, {
      title: f.title, drill_type: f.drill_type, scenario: f.scenario || null,
      scheduled_date: f.scheduled_date || null, owner_id: f.owner_id,
      linked_incident_id: isIncident ? f.linked_incident_id : null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bcm-drill', drill.id] }); ok('Drill updated'); onClose(); },
  });
  return (
    <AnimatedModal isOpen onClose={onClose} title="Edit drill" subtitle={SOURCE_TYPE_LABEL[drill.source_type]} size="md"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Cancel</button>
        <button disabled={!f.title.trim() || mut.isPending} onClick={() => mut.mutate()} className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-[#0a0a0a] disabled:opacity-40">Save</button>
      </div>}>
      <div className="space-y-3 p-5">
        <div><label className={lbl}>Title *</label><input className={input} value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Type</label><BcmSelect value={f.drill_type} onChange={(v) => set('drill_type', v)} options={DRILL_TYPE_OPTIONS} ariaLabel="Drill type" /></div>
          <div><label className={lbl}>Scheduled date</label><input type="date" className={input} value={f.scheduled_date} onChange={(e) => set('scheduled_date', e.target.value)} /></div>
        </div>
        <div><label className={lbl}>Owner</label>
          <BcmEntitySelect kind="users" value={f.owner_id} onChange={(id) => set('owner_id', id)} placeholder="Assign owner…"
            extraOptions={f.owner_id ? [{ value: f.owner_id, label: f.owner_name || `User #${f.owner_id}` }] : undefined} />
        </div>
        {isIncident && (
          <div><label className={lbl}>Linked incident</label>
            <BcmEntitySelect kind="incidents" value={f.linked_incident_id} onChange={(id) => set('linked_incident_id', id)} placeholder="Select an incident…"
              extraOptions={f.linked_incident_id ? [{ value: f.linked_incident_id, label: f.incident_title || `Incident #${f.linked_incident_id}` }] : undefined} />
          </div>
        )}
        <div><label className={lbl}>Scenario</label><textarea rows={2} className={input} value={f.scenario} onChange={(e) => set('scenario', e.target.value)} /></div>
      </div>
    </AnimatedModal>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium text-slate-800">{value}</div>
    </div>
  );
}

function ResultCard({ drill, canEdit }: { drill: any; canEdit: boolean }) {
  const qc = useQueryClient();
  const { ok, fail } = useBcmToast();
  const r = drill.result;
  const [f, setF] = useState<any>({
    rto_met: triBool(r?.rto_met), rpo_met: triBool(r?.rpo_met),
    actual_rto_hours: r?.actual_rto_hours ?? '', actual_rpo_hours: r?.actual_rpo_hours ?? '',
    summary: r?.summary ?? '',
  });
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const mut = useMutation({
    mutationFn: () => bcmApi.drills.saveResult(drill.id, {
      rto_met: f.rto_met === '' ? null : f.rto_met === 'yes',
      rpo_met: f.rpo_met === '' ? null : f.rpo_met === 'yes',
      actual_rto_hours: f.actual_rto_hours === '' ? null : Number(f.actual_rto_hours),
      actual_rpo_hours: f.actual_rpo_hours === '' ? null : Number(f.actual_rpo_hours),
      summary: f.summary || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bcm-drill', drill.id] }); ok('Result saved'); },
    onError: (e) => fail(e, 'Could not save result'),
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <ClipboardCheck className="h-4 w-4 text-primary-500" /><h3 className="text-sm font-semibold text-slate-800">Drill result</h3>
        {!r && <span className="ml-auto text-[11px] text-amber-600">Required before closing</span>}
      </div>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>RTO met?</label>
            <BcmSelect value={f.rto_met} onChange={(v) => set('rto_met', v)} options={RTO_MET_OPTIONS} disabled={!canEdit} ariaLabel="RTO met" />
          </div>
          <div><label className={lbl}>RPO met?</label>
            <BcmSelect value={f.rpo_met} onChange={(v) => set('rpo_met', v)} options={RTO_MET_OPTIONS} disabled={!canEdit} ariaLabel="RPO met" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Actual recovery (h)</label><input type="number" min={0} className={input} disabled={!canEdit} value={f.actual_rto_hours} onChange={(e) => set('actual_rto_hours', e.target.value)} /></div>
          <div><label className={lbl}>Actual data loss (h)</label><input type="number" min={0} className={input} disabled={!canEdit} value={f.actual_rpo_hours} onChange={(e) => set('actual_rpo_hours', e.target.value)} /></div>
        </div>
        <div><label className={lbl}>Narrative summary</label><textarea rows={3} className={input} disabled={!canEdit} value={f.summary} onChange={(e) => set('summary', e.target.value)} placeholder="What happened, what worked, what didn't…" /></div>
        {canEdit && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">{r ? `Recorded by ${r.recorded_by_name || '—'} · ${fmtDateTime(r.recorded_at)}` : 'Not recorded yet'}</span>
            <button disabled={mut.isPending} onClick={() => mut.mutate()} className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-40">{mut.isPending ? 'Saving…' : (r ? 'Update result' : 'Save result')}</button>
          </div>
        )}
        {mut.isSuccess && <p className="text-[11px] text-emerald-600">Saved.</p>}
      </div>
    </div>
  );
}

function FindingsCard({ drill, canFinding }: { drill: any; canFinding: boolean }) {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const { ok, fail } = useBcmToast();
  const canEditFinding = hasPermission('bcm:findings:edit');
  const canDeleteFinding = hasPermission('bcm:findings:delete');
  const refresh = () => qc.invalidateQueries({ queryKey: ['bcm-drill', drill.id] });

  const [show, setShow] = useState(false);
  const [f, setF] = useState<any>({ title: '', description: '', severity: 'medium' });
  const addMut = useMutation({
    mutationFn: () => bcmApi.findings.create(drill.id, { title: f.title, description: f.description || null, severity: f.severity }),
    onSuccess: (res) => {
      setShow(false); setF({ title: '', description: '', severity: 'medium' }); refresh();
      const code = (res as any)?.data?.issue_code;
      ok('Finding raised', code ? `Auto-opened issue ${code} for remediation.` : undefined);
    },
    onError: (e) => fail(e, 'Could not raise finding'),
  });
  const delMut = useMutation({ mutationFn: (id: number) => bcmApi.findings.remove(id), onSuccess: () => { refresh(); ok('Finding deleted'); }, onError: (e) => fail(e, 'Could not delete finding') });
  const issueMut = useMutation({ mutationFn: (id: number) => bcmApi.findings.createIssue(id), onSuccess: (res) => { refresh(); ok('Issue created', (res as any)?.data?.issue_code ? `Linked to ${(res as any).data.issue_code}.` : undefined); }, onError: (e) => fail(e, 'Could not create issue') });
  const riskMut = useMutation({ mutationFn: ({ id, risk_id }: { id: number; risk_id?: number }) => bcmApi.findings.linkRisk(id, { risk_id }), onSuccess: () => { refresh(); ok('Risk linked'); }, onError: (e) => fail(e, 'Could not link risk') });

  const findings: any[] = drill.findings || [];

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><AlertTriangle className="h-4 w-4 text-amber-500" /> Findings <span className="text-slate-400">({findings.length})</span></h3>
        {canFinding && <button onClick={() => setShow((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"><Plus size={14} /> Add</button>}
      </div>

      {show && (
        <div className="space-y-2 border-b border-slate-100 bg-slate-50 p-3">
          <input className={input} placeholder="Finding title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <textarea rows={2} className={input} placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <div className="flex items-center justify-between gap-2">
            <div className="w-[160px]"><BcmSelect value={f.severity} onChange={(v) => setF({ ...f, severity: v })} options={SEVERITY_OPTIONS} ariaLabel="Severity" /></div>
            <div className="flex gap-2">
              <button onClick={() => setShow(false)} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600">Cancel</button>
              <button disabled={!f.title.trim() || addMut.isPending} onClick={() => addMut.mutate()} className="rounded bg-primary-600 px-3 py-1 text-xs font-medium text-[#0a0a0a] disabled:opacity-40">Raise finding</button>
            </div>
          </div>
          <p className="text-[11px] text-slate-400">High/Critical findings automatically open an Issue/CAPA for remediation.</p>
        </div>
      )}

      {findings.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-slate-400">No findings raised for this drill.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {findings.map((fd) => (
            <li key={fd.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{fd.title}</span>
                    <SeverityBadge severity={fd.severity} />
                  </div>
                  {fd.description && <p className="mt-0.5 text-xs text-slate-500">{fd.description}</p>}
                </div>
                {canDeleteFinding && <button onClick={() => delMut.mutate(fd.id)} className="text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>}
              </div>
              <div className="mt-2 space-y-1.5 text-[11px]">
                {/* Remediation via the Issue/CAPA module (status read live from the issue) */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-16 shrink-0 text-slate-400">Remediation</span>
                  <IssueStatusBadge status={fd.issue_status} />
                  {fd.issue_code && (
                    <Link href="/issues" className="inline-flex items-center gap-0.5 text-primary-600 hover:underline" title="Open in Issues / CAPA">
                      {fd.issue_code} <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                  {canEditFinding && !fd.linked_issue_id && (
                    <button onClick={() => issueMut.mutate(fd.id)} disabled={issueMut.isPending} className="rounded border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50">Create issue / CAPA</button>
                  )}
                </div>
                {/* Risk Register linkage */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-16 shrink-0 text-slate-400">Risk</span>
                  {fd.linked_risk_id ? (
                    <Link href={`/erm/risks/${fd.linked_risk_id}`} className="inline-flex items-center gap-1 text-primary-600 hover:underline"><Link2 className="h-3 w-3" /> {fd.linked_risk_title || `Risk #${fd.linked_risk_id}`}</Link>
                  ) : canEditFinding ? (
                    <span className="inline-flex items-center gap-1.5">
                      <div className="w-[200px]"><BcmEntitySelect kind="risks" value={null} onChange={(id) => id && riskMut.mutate({ id: fd.id, risk_id: id })} placeholder="Link a risk…" /></div>
                      <button onClick={() => riskMut.mutate({ id: fd.id })} disabled={riskMut.isPending} className="rounded border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50">New risk</button>
                    </span>
                  ) : <span className="text-slate-400">—</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
