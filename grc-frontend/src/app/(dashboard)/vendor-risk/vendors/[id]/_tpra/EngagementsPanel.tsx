'use client';

// Engagements tab of a supplier: each use of it by one part of the business, with
// its own tier, questionnaires, score, approval and review date. General is the
// supplier itself. Also the engagement's facts in its lifecycle's intake stage, and
// the (i) beside the page header's tier.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowRight, Loader2, Pencil, Plus, XCircle } from 'lucide-react';
import { InfoTip, RightSlidePanel } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { errText, usePeople } from '../../../_lib/actions/shared';
import {
  engagementsApi, engagementsKey, useEngagements, type Engagement, type EngagementInput, type EngagementList,
} from '../../../_lib/engagementsApi';
import { gradeColor, titleCase } from '../../../_lib/tprmShared';
import { STAGE_META, fmtDate, tierBadge } from './constants';

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const labelCls = 'mb-1 block text-xs font-medium text-gray-700';
const CRITICALITY = ['low', 'medium', 'high', 'critical'];

function useCanEdit() {
  const { hasPermission } = usePermissions();
  return hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
}

function stageLabel(e: Engagement): string {
  if (!e.active_assessment_id) return 'Not started';
  return STAGE_META[e.lifecycle_stage || '']?.label || titleCase(e.lifecycle_stage) || '—';
}

export default function EngagementsPanel({ vendorId, onOpenLifecycle }: {
  vendorId: number;
  onOpenLifecycle?: (engagementId: number | null) => void;
}) {
  const canEdit = useCanEdit();
  const { data, isLoading, isError } = useEngagements(vendorId);
  const [editing, setEditing] = useState<Engagement | 'new' | null>(null);
  const [ending, setEnding] = useState<Engagement | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold text-slate-900">Engagements</h2>
          <InfoTip text="Each use of this supplier by one part of the business, tiered and assessed on its own. The supplier shows the worst open one. General is the supplier itself." />
        </div>
        {canEdit && (
          <button type="button" onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
            <Plus className="h-3.5 w-3.5" /> Add engagement
          </button>
        )}
      </div>

      {isLoading && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {isError && <p className="text-sm text-rose-700">Could not load the engagements.</p>}
      {data && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[880px] text-left">
            <thead>
              <tr className="border-b border-slate-100">
                {['Engagement', 'Owner', 'Business unit', 'Type', 'Tier', 'Residual', 'Stage', 'Next review', 'Status', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((e) => (
                <Row key={e.id ?? 'general'} e={e} list={data} canEdit={canEdit}
                  onOpen={onOpenLifecycle ? () => onOpenLifecycle(e.is_general ? null : e.id) : undefined}
                  onEdit={() => setEditing(e)} onEnd={() => setEnding(e)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && data && (
        <EngagementForm vendorId={vendorId} engagement={editing === 'new' ? null : editing} list={data}
          onClose={() => setEditing(null)} />
      )}
      {ending && <EndForm vendorId={vendorId} engagement={ending} onClose={() => setEnding(null)} />}
    </div>
  );
}

function Row({ e, list, canEdit, onOpen, onEdit, onEnd }: {
  e: Engagement; list: EngagementList; canEdit: boolean; onOpen?: () => void; onEdit: () => void; onEnd: () => void;
}) {
  const ended = e.status === 'ended';
  const type = list.types.find((t) => t.value === e.engagement_type)?.label || e.engagement_type;
  const cell = 'px-3 py-2.5 text-[13px] text-slate-700';
  return (
    <tr className={clsx(ended && 'opacity-60')}>
      <td className={cell}>
        <span className="font-medium text-slate-900">{e.name}</span>
        {e.description && <span className="block max-w-[220px] truncate text-[11px] text-slate-500">{e.description}</span>}
      </td>
      <td className={cell}>{e.owner_name || '—'}</td>
      <td className={cell}>{e.business_unit || '—'}</td>
      <td className={cell}>{type || '—'}</td>
      <td className={cell}>
        {e.tier ? (
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${tierBadge(e.tier)}`}>{e.tier}</span>
        ) : '—'}
      </td>
      <td className={cell}>
        {e.residual_risk_score != null ? e.residual_risk_score.toFixed(1) : '—'}
        {e.rating_grade && <span className={`ml-1.5 font-semibold ${gradeColor(e.rating_grade)}`}>{e.rating_grade}</span>}
      </td>
      <td className={cell}>{stageLabel(e)}</td>
      <td className={cell}>{fmtDate(e.next_reassessment_date)}</td>
      <td className={cell}>
        {ended ? (
          <span className="inline-flex items-center gap-0.5">
            Ended <InfoTip text={`${fmtDate(e.archived_at)}: ${e.ended_reason || ''}`} label="Why it ended" align="end" />
          </span>
        ) : 'Active'}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <div className="inline-flex items-center gap-1">
          {!ended && onOpen && (
            <button type="button" onClick={onOpen}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Open lifecycle <ArrowRight className="h-3 w-3" />
            </button>
          )}
          {canEdit && !ended && !e.is_general && (
            <>
              <button type="button" onClick={onEdit} aria-label={`Edit ${e.name}`}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={onEnd} aria-label={`End ${e.name}`}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-rose-50 hover:text-rose-700">
                <XCircle className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function useSaved(vendorId: number, onClose: () => void, title: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: engagementsKey(vendorId) });
      qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
      qc.invalidateQueries({ queryKey: ['vendor', vendorId] });
      toast({ type: 'success', title });
      onClose();
    },
    onError: (e: unknown) => toast({ type: 'error', title: 'Could not save', message: errText(e, 'Try again.') }),
  };
}

/** Add or edit an engagement (General is the supplier itself: edited on its record). */
export function EngagementForm({ vendorId, engagement, list, onClose }: {
  vendorId: number; engagement: Engagement | null; list: EngagementList; onClose: () => void;
}) {
  const people = usePeople();
  const [form, setForm] = useState(() => ({
    name: engagement?.name ?? '',
    owner_id: engagement?.owner_id ? String(engagement.owner_id) : '',
    business_unit_id: engagement?.business_unit_id ? String(engagement.business_unit_id) : '',
    engagement_type: engagement?.engagement_type ?? '',
    data_access_level: engagement?.data_access_level ?? '',
    data_types: (engagement?.data_types_accessed || []).join(', '),
    criticality: engagement?.criticality ?? '',
    start_date: engagement?.start_date ?? '',
    end_date: engagement?.end_date ?? '',
    next_review: engagement?.next_reassessment_date?.slice(0, 10) ?? '',
    cadence: engagement?.reassessment_cadence_days ? String(engagement.reassessment_cadence_days) : '',
    description: engagement?.description ?? '',
  }));
  const set = (key: keyof typeof form) => (ev: { target: { value: string } }) => setForm({ ...form, [key]: ev.target.value });
  const save = useMutation({
    mutationFn: () => {
      const data: EngagementInput = {
        name: form.name.trim(), description: form.description.trim() || null,
        owner_id: form.owner_id ? Number(form.owner_id) : null,
        business_unit_id: form.business_unit_id ? Number(form.business_unit_id) : null,
        engagement_type: form.engagement_type || null, data_access_level: form.data_access_level || null,
        data_types_accessed: form.data_types.split(',').map((s) => s.trim()).filter(Boolean),
        criticality: form.criticality || null, start_date: form.start_date || null, end_date: form.end_date || null,
        next_reassessment_date: form.next_review || null,
        reassessment_cadence_days: form.cadence ? Number(form.cadence) : null,
      };
      return engagement?.id ? engagementsApi.update(engagement.id, data) : engagementsApi.create(vendorId, data);
    },
    ...useSaved(vendorId, onClose, engagement ? 'Engagement saved' : 'Engagement added'),
  });

  return (
    <RightSlidePanel isOpen onClose={onClose} title={engagement ? `Edit ${engagement.name}` : 'Add engagement'} width="w-full max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending || !form.name.trim()}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      }>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>Name</label>
          <input className={inputCls} value={form.name} onChange={set('name')} placeholder="e.g. Payroll for HR" required />
        </div>
        <div>
          <label className={labelCls}>Business owner</label>
          <select className={inputCls} value={form.owner_id} onChange={set('owner_id')}>
            <option value="">None</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Business unit</label>
          <select className={inputCls} value={form.business_unit_id} onChange={set('business_unit_id')}>
            <option value="">None</option>
            {list.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>What we buy</label>
          <select className={inputCls} value={form.engagement_type} onChange={set('engagement_type')}>
            <option value="">Not set</option>
            {list.types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Data access</label>
          <select className={inputCls} value={form.data_access_level} onChange={set('data_access_level')}>
            <option value="">Not set</option>
            {list.access_levels.map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Data types</label>
          <input className={inputCls} value={form.data_types} onChange={set('data_types')} placeholder="PII, financial" />
        </div>
        <div>
          <label className={labelCls}>
            <span className="inline-flex items-center gap-0.5">
              Criticality <InfoTip text="How much the business depends on this use: one of the factors its tier is computed from." />
            </span>
          </label>
          <select className={inputCls} value={form.criticality} onChange={set('criticality')}>
            <option value="">Not set</option>
            {CRITICALITY.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Start</label>
          <input type="date" className={inputCls} value={form.start_date} onChange={set('start_date')} />
        </div>
        <div>
          <label className={labelCls}>End</label>
          <input type="date" className={inputCls} value={form.end_date} onChange={set('end_date')} />
        </div>
        <div>
          <label className={labelCls}>Next review</label>
          <input type="date" className={inputCls} value={form.next_review} onChange={set('next_review')} />
        </div>
        <div>
          <label className={labelCls}>Review every (days)</label>
          <input type="number" min={1} className={inputCls} value={form.cadence} onChange={set('cadence')} placeholder="Tier default" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Description</label>
          <textarea rows={3} className={inputCls} value={form.description} onChange={set('description')} />
        </div>
      </div>
    </RightSlidePanel>
  );
}

function EndForm({ vendorId, engagement, onClose }: { vendorId: number; engagement: Engagement; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const end = useMutation({
    mutationFn: () => engagementsApi.end(engagement.id as number, reason.trim()),
    ...useSaved(vendorId, onClose, 'Engagement ended'),
  });
  return (
    <RightSlidePanel isOpen onClose={onClose} title={`End ${engagement.name}`} width="w-full max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="button" onClick={() => end.mutate()} disabled={end.isPending || reason.trim().length < 3}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
            {end.isPending ? 'Ending…' : 'End engagement'}
          </button>
        </div>
      }>
      <div className="space-y-3">
        <p className="rounded-lg bg-amber-50 p-2 text-[12px] text-amber-800">
          Nothing is deleted. Its open assessment is archived and the supplier is rated without it.
        </p>
        <div>
          <label className={labelCls}>Reason</label>
          <textarea rows={4} className={inputCls} value={reason} onChange={(ev) => setReason(ev.target.value)} required />
        </div>
      </div>
    </RightSlidePanel>
  );
}

/** An engagement's own facts, in its lifecycle's intake stage. */
export function EngagementFacts({ vendorId, engagement }: { vendorId: number; engagement: Engagement }) {
  const canEdit = useCanEdit();
  const { data } = useEngagements(vendorId);
  const [editing, setEditing] = useState(false);
  const type = data?.types.find((t) => t.value === engagement.engagement_type)?.label || engagement.engagement_type;
  const facts: Array<[string, string | null | undefined]> = [
    ['Business owner', engagement.owner_name], ['Data access', titleCase(engagement.data_access_level)],
    ['What we buy', type], ['Criticality', titleCase(engagement.criticality)],
  ];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-800">{engagement.name}</p>
        {canEdit && engagement.status !== 'ended' && (
          <button type="button" onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-slate-500">{label}</dt>
            <dd className="text-[13px] font-medium text-slate-800">{value || '—'}</dd>
          </div>
        ))}
      </dl>
      {editing && data && <EngagementForm vendorId={vendorId} engagement={engagement} list={data} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** Beside the page header's tier: the supplier's tier is the worst of its engagements. */
export function WorstOfNote({ vendorId }: { vendorId: number }) {
  const { data } = useEngagements(vendorId);
  const n = data?.supplier.engagements ?? 0;
  return n > 1 ? <InfoTip text={`Worst of ${n} engagements`} label="How the tier is set" /> : null;
}
