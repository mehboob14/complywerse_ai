'use client';

// The Engagements panel of a vendor's Overview: each use of it by one part of the business, with its own tier, questionnaires, score,
// approval and review date. General is the vendor itself. Also the dialogs that add, edit and end one, the engagement's facts in its
// lifecycle's intake stage, and the (i) beside the page header's tier.

import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowRight, Loader2, Pencil, Plus, XCircle } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { BTN, BTN_PRIMARY, Dialog, EmptyState, ErrorState, Panel, Skeleton, StatusPill, TierBadge, fmt } from '../../../_ui';
import { errText, usePeople } from '../../../_lib/actions/shared';
import {
  engagementsApi, engagementsKey, useEngagements, type Engagement, type EngagementInput, type EngagementList,
} from '../../../_lib/engagementsApi';
import { titleCase } from '../../../_lib/tprmShared';
import { isTiered } from '../../../_lib/vendorRecordModel';
import { AREA, FIELD, HINT, LABEL } from '../../_components/formStyles';
import { STAGE_META, fmtDate } from './constants';

const CRITICALITY = ['low', 'medium', 'high', 'critical'];
const DANGER_FILL = 'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#b42318] px-3 text-sm font-medium text-[#fff] hover:bg-[#912018] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
const ICON_BTN = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

function useCanEdit() {
  const { hasPermission } = usePermissions();
  return hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
}

function stageLabel(e: Engagement): string {
  if (!e.active_assessment_id) return 'Not started';
  return STAGE_META[e.lifecycle_stage || '']?.label || titleCase(e.lifecycle_stage) || '—';
}

export default function EngagementsPanel({ vendorId, onOpenLifecycle, onTier }: {
  vendorId: number;
  onOpenLifecycle?: (engagementId: number | null) => void;
  /** "Tier engagement" / "Re-tier": opens the Lifecycle's tiering popup for this engagement (null is General). Without it the buttons are not drawn. */
  onTier?: (engagementId: number | null) => void;
}) {
  const canEdit = useCanEdit();
  const { hasPermission } = usePermissions();
  const canTier = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');
  const { data, isLoading, isError, refetch } = useEngagements(vendorId);
  const [editing, setEditing] = useState<Engagement | 'new' | null>(null);
  const [ending, setEnding] = useState<Engagement | null>(null);

  return (
    <>
      <Panel
        title="Engagements"
        count={data?.items.filter((e) => e.status !== 'ended').length}
        info="Each use of this vendor by one part of the business, tiered and assessed on its own. The vendor shows the worst open one. General is the vendor itself."
        action={canEdit && data ? (
          <button type="button" onClick={() => setEditing('new')} className={BTN}><Plus aria-hidden className="h-4 w-4" /> Add engagement</button>
        ) : undefined}
      >
        {isLoading ? (
          <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
        ) : isError || !data ? (
          <ErrorState title="Couldn't load the engagements" onRetry={() => refetch()} />
        ) : data.items.length === 0 ? (
          <EmptyState bare title="No engagements yet" hint="Each one is tiered and assessed on its own." />
        ) : (
          <ul className="divide-y divide-[#e1e6eb]">
            {data.items.map((e) => (
              <Row key={e.id ?? 'general'} e={e} list={data} canEdit={canEdit} canTier={canTier}
                onOpen={onOpenLifecycle ? () => onOpenLifecycle(e.is_general ? null : e.id) : undefined}
                onTier={onTier ? () => onTier(e.is_general ? null : e.id) : undefined}
                onEdit={() => setEditing(e)} onEnd={() => setEnding(e)} />
            ))}
          </ul>
        )}
      </Panel>

      {editing && data && (
        <EngagementForm vendorId={vendorId} engagement={editing === 'new' ? null : editing} list={data} onClose={() => setEditing(null)} />
      )}
      {ending && <EndForm vendorId={vendorId} engagement={ending} onClose={() => setEnding(null)} />}
    </>
  );
}

function Row({ e, list, canEdit, canTier, onOpen, onTier, onEdit, onEnd }: {
  e: Engagement; list: EngagementList; canEdit: boolean; canTier: boolean; onOpen?: () => void; onTier?: () => void; onEdit: () => void; onEnd: () => void;
}) {
  const ended = e.status === 'ended';
  const tiered = isTiered(e);
  const type = list.types.find((t) => t.value === e.engagement_type)?.label || e.engagement_type;
  const facts = [e.business_unit, e.owner_name || 'No owner named', type, e.start_date ? `from ${fmt.date(e.start_date)}` : null].filter(Boolean).join(' · ');
  const standing = [
    e.residual_risk_score != null ? `Residual ${e.residual_risk_score.toFixed(1)}` : null,
    e.rating_grade ? `Grade ${e.rating_grade}` : null,
    !ended && e.next_reassessment_date ? `Next review ${fmt.date(e.next_reassessment_date)}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <li className={clsx('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0', ended && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-5 text-[#1f2933]">{e.name}</p>
        {e.description && <p className="line-clamp-1 text-[13px] leading-5 text-[#586472]">{e.description}</p>}
        <p className="text-[12px] leading-4 text-[#64707e]">{facts}</p>
        {standing && <p className="mt-0.5 text-[12px] leading-4 text-[#64707e]">{standing}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <TierBadge tier={tiered ? e.tier : null} variant="dot" />
        {ended ? (
          <span className="inline-flex items-center gap-0.5">
            <StatusPill tone="neutral">Ended</StatusPill>
            <InfoTip text={`${fmtDate(e.archived_at)}: ${e.ended_reason || ''}`} label="Why it ended" align="end" />
          </span>
        ) : (
          <StatusPill tone={e.active_assessment_id ? 'progress' : 'pending'}>{stageLabel(e)}</StatusPill>
        )}
        {!ended && canTier && onTier && (
          <button type="button" onClick={onTier} className={tiered ? BTN : BTN_PRIMARY}>{tiered ? 'Re-tier' : 'Tier engagement'}</button>
        )}
        {!ended && onOpen && (
          <button type="button" onClick={onOpen} aria-label={`Open the lifecycle of ${e.name}`} title="Open lifecycle" className={ICON_BTN}>
            <ArrowRight aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
        {canEdit && !ended && !e.is_general && (
          <>
            <button type="button" onClick={onEdit} aria-label={`Edit ${e.name}`} title="Edit" className={ICON_BTN}>
              <Pencil aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={onEnd} aria-label={`End ${e.name}`} title="End" className={ICON_BTN}>
              <XCircle aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>
    </li>
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

/** Add or edit an engagement (General is the vendor itself: edited on its record). */
export function EngagementForm({ vendorId, engagement, list, onClose }: {
  vendorId: number; engagement: Engagement | null; list: EngagementList; onClose: () => void;
}) {
  const people = usePeople();
  const form = useId();
  const [f, setF] = useState(() => ({
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
  const set = (key: keyof typeof f) => (ev: { target: { value: string } }) => setF({ ...f, [key]: ev.target.value });
  const save = useMutation({
    mutationFn: () => {
      const data: EngagementInput = {
        name: f.name.trim(), description: f.description.trim() || null,
        owner_id: f.owner_id ? Number(f.owner_id) : null,
        business_unit_id: f.business_unit_id ? Number(f.business_unit_id) : null,
        engagement_type: f.engagement_type || null, data_access_level: f.data_access_level || null,
        data_types_accessed: f.data_types.split(',').map((s) => s.trim()).filter(Boolean),
        criticality: f.criticality || null, start_date: f.start_date || null, end_date: f.end_date || null,
        next_reassessment_date: f.next_review || null,
        reassessment_cadence_days: f.cadence ? Number(f.cadence) : null,
      };
      return engagement?.id ? engagementsApi.update(engagement.id, data) : engagementsApi.create(vendorId, data);
    },
    ...useSaved(vendorId, onClose, engagement ? 'Engagement saved' : 'Engagement added'),
  });
  const ready = !!f.name.trim();

  return (
    <Dialog
      open
      onClose={onClose}
      size={600}
      title={engagement ? `Edit ${engagement.name}` : 'Add engagement'}
      description="Each engagement is tiered and assessed on its own."
      footer={(
        <>
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="submit" form={form} disabled={save.isPending || !ready} className={BTN_PRIMARY}>
            {save.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {engagement ? 'Save' : 'Add engagement'}
          </button>
        </>
      )}
    >
      <form id={form} onSubmit={(e) => { e.preventDefault(); if (ready && !save.isPending) save.mutate(); }} className="space-y-3.5">
        <div>
          <label htmlFor={`${form}-name`} className={LABEL}>Name</label>
          <input id={`${form}-name`} data-autofocus required maxLength={255} className={FIELD} value={f.name} onChange={set('name')} placeholder="Payroll for HR" />
        </div>
        <div>
          <label htmlFor={`${form}-desc`} className={LABEL}>What this engagement covers <span className={HINT}>(optional)</span></label>
          <textarea id={`${form}-desc`} rows={2} className={AREA} value={f.description} onChange={set('description')} />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${form}-owner`} className={LABEL}>Business owner</label>
            <select id={`${form}-owner`} className={FIELD} value={f.owner_id} onChange={set('owner_id')}>
              <option value="">None</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${form}-unit`} className={LABEL}>Business unit</label>
            <select id={`${form}-unit`} className={FIELD} value={f.business_unit_id} onChange={set('business_unit_id')}>
              <option value="">None</option>
              {list.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${form}-type`} className={LABEL}>What we buy</label>
            <select id={`${form}-type`} className={FIELD} value={f.engagement_type} onChange={set('engagement_type')}>
              <option value="">Not set</option>
              {list.types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${form}-access`} className={LABEL}>Data access</label>
            <select id={`${form}-access`} className={FIELD} value={f.data_access_level} onChange={set('data_access_level')}>
              <option value="">Not set</option>
              {list.access_levels.map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${form}-data`} className={LABEL}>Data types</label>
            <input id={`${form}-data`} className={FIELD} value={f.data_types} onChange={set('data_types')} placeholder="PII, financial" />
          </div>
          <div>
            <label htmlFor={`${form}-crit`} className={LABEL}>
              Criticality <InfoTip text="How much the business depends on this use: one of the factors its tier is computed from." label="About criticality" className="ml-0.5" />
            </label>
            <select id={`${form}-crit`} className={FIELD} value={f.criticality} onChange={set('criticality')}>
              <option value="">Not set</option>
              {CRITICALITY.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${form}-start`} className={LABEL}>Start</label>
            <input id={`${form}-start`} type="date" className={FIELD} value={f.start_date} onChange={set('start_date')} />
          </div>
          <div>
            <label htmlFor={`${form}-end`} className={LABEL}>End</label>
            <input id={`${form}-end`} type="date" className={FIELD} value={f.end_date} onChange={set('end_date')} />
          </div>
          <div>
            <label htmlFor={`${form}-next`} className={LABEL}>Next review</label>
            <input id={`${form}-next`} type="date" className={FIELD} value={f.next_review} onChange={set('next_review')} />
          </div>
          <div>
            <label htmlFor={`${form}-cadence`} className={LABEL}>Review every (days)</label>
            <input id={`${form}-cadence`} type="number" min={1} className={FIELD} value={f.cadence} onChange={set('cadence')} placeholder="Tier default" />
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function EndForm({ vendorId, engagement, onClose }: { vendorId: number; engagement: Engagement; onClose: () => void }) {
  const form = useId();
  const [reason, setReason] = useState('');
  const end = useMutation({
    mutationFn: () => engagementsApi.end(engagement.id as number, reason.trim()),
    ...useSaved(vendorId, onClose, 'Engagement ended'),
  });
  const ready = reason.trim().length >= 3;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`End ${engagement.name}`}
      description="Nothing is deleted. Its open assessment is archived and the vendor is rated without it."
      footer={(
        <>
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="submit" form={form} disabled={end.isPending || !ready} className={DANGER_FILL}>
            {end.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            End engagement
          </button>
        </>
      )}
    >
      <form id={form} onSubmit={(e) => { e.preventDefault(); if (ready && !end.isPending) end.mutate(); }}>
        <label htmlFor={`${form}-why`} className={LABEL}>Why</label>
        <textarea id={`${form}-why`} data-autofocus required rows={3} className={AREA} value={reason} onChange={(ev) => setReason(ev.target.value)} />
      </form>
    </Dialog>
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

/** Beside the page header's tier: the vendor's tier is the worst of its engagements. */
export function WorstOfNote({ vendorId }: { vendorId: number }) {
  const { data } = useEngagements(vendorId);
  const n = data?.supplier.engagements ?? 0;
  return n > 1 ? <InfoTip text={`Worst of ${n} engagements`} label="How the tier is set" /> : null;
}
