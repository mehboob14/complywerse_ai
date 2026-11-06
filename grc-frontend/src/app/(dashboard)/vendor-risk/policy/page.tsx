'use client';

// Policy: what each tier is worth in review work, in one form with one Save. Where each tier starts and how often it is reviewed,
// how long a finding has before it is overdue, the stages each tier skips, the roster roles that must review it, who approves it
// and from which alert severity its assessment reopens; then the alert rules, which save on their own. Work under way keeps the
// policy it started under. A link to #alert-rules (the old Alert rules address leads here) scrolls to that section.

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useToast } from '@/components/ui/ToastProvider';
import { BTN, BTN_PRIMARY, BTN_TEXT, ErrorState, Panel, Skeleton, TONE, TierBadge, ToggleChip, tierLabel } from '../_ui';
import { STAGE_SEQUENCE } from '../_lib/lifecycleShared';
import { errText } from '../_lib/intake/types';
import { configKey, directoryKey, policyApi, policyKey } from '../_lib/policyApi';
import {
  REOPEN_OPTIONS, TIERS, approverOptions, atDefaults, bandsBad, cadenceBad, isDirty, policyPatch, problems, reopenFrom, reopenPatch, standing, toDraft,
  toggled, windowBad, withDefaults, type Draft, type Part, type Tier,
} from '../_lib/policyModel';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import AlertRulesSection from './_AlertRules';

const HEAD = 'text-right text-[11px] font-semibold uppercase tracking-wide text-[#586472]';
const SELECT = 'h-9 w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 text-sm text-[#1f2933] focus:border-[#0f766e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/30 disabled:bg-[#f3f6f8] disabled:text-[#64707e]';

function NumberField({ label, value, onChange, invalid, disabled }: {
  label: string; value: number; onChange: (n: number) => void; invalid: boolean; disabled: boolean;
}) {
  return (
    <input
      type="number" inputMode="numeric" aria-label={label} aria-invalid={invalid || undefined} disabled={disabled}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
      className={clsx(
        'h-9 w-full rounded-lg border bg-[#fff] px-3 text-right text-sm tabular-nums text-[#1f2933] focus:outline-none focus-visible:ring-2 disabled:bg-[#f3f6f8] disabled:text-[#64707e]',
        invalid ? 'border-[#e11d48] focus-visible:ring-[#e11d48]/30' : 'border-[#c3ccd5] focus:border-[#0f766e] focus-visible:ring-[#0f766e]/30',
      )}
    />
  );
}

export default function PolicyPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const policyQuery = useQuery({ queryKey: policyKey, queryFn: async () => (await policyApi.get()).data, ...TPRM_QUERY_OPTS });
  // the reopen threshold is not on the policy: it stays in the tier policy of the program config (the same fetch Settings makes)
  const configQuery = useQuery({ queryKey: configKey, queryFn: async () => (await policyApi.config()).data, ...TPRM_QUERY_OPTS });
  const { data: directory } = useQuery({ queryKey: directoryKey, queryFn: async () => (await policyApi.directory()).data, ...TPRM_QUERY_OPTS });
  const policy = policyQuery.data;

  const saved = useMemo(() => (policy && configQuery.data ? toDraft(policy, reopenFrom(configQuery.data)) : null), [policy, configQuery.data]);
  // What is on the form: the saved policy until something is changed, then the person's own copy of it.
  const [edited, setEdited] = useState<Draft | null>(null);
  const draft = edited ?? saved;
  const edit = (change: (next: Draft) => void) => setEdited((cur) => {
    const base = cur ?? saved;
    if (!base) return cur;
    const next = toDraft(base, base.reopen);
    change(next);
    return next;
  });

  // a link to #section (the old Alert rules address) scrolls there once the page is drawn
  const ready = saved !== null;
  useEffect(() => {
    const id = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
    if (!ready || !id) return undefined;
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    return () => clearTimeout(timer);
  }, [ready]);

  const dirty = !!(draft && saved && isDirty(draft, saved));
  const issues = draft ? problems(draft) : [];
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    // ponytail: two requests, the policy and then the reopen threshold (it lives on the program config); if the second fails the
    // first stays saved and the form stays unsaved, so another Save sends both again. One endpoint would make it atomic.
    mutationFn: async () => {
      const body = draft && saved ? policyPatch(draft, saved) : null;
      const reopen = draft && saved ? reopenPatch(draft, saved) : null;
      if (body) await policyApi.save(body);
      if (reopen) await policyApi.saveReopen(reopen);
    },
    // wait for the reads to come back, so the form is not "unsaved" for a moment after it was saved
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: policyKey }), qc.invalidateQueries({ queryKey: configKey })]);
      setEdited(null);
      toast({ type: 'success', title: 'Policy saved' });
    },
    onError: (e) => toast({ type: 'error', title: 'Not saved', message: errText(e, 'Try again.') }),
  });

  if (policyQuery.isLoading || configQuery.isLoading) {
    return <div className="space-y-4" aria-busy="true" aria-label="Loading the policy">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>;
  }
  if (policyQuery.isError || configQuery.isError || !policy || !draft) {
    return (
      <ErrorState title="Couldn't load the policy" message={errText(policyQuery.error ?? configQuery.error, 'Try again in a moment.')}
        onRetry={() => { void policyQuery.refetch(); void configQuery.refetch(); }} />
    );
  }

  const canEdit = policy.can_edit;
  const stages = policy.meta.stages.filter((s) => s.skippable);
  const stageOrder = stages.map((s) => s.key);
  const roles = policy.meta.roles;
  const roleOrder = roles.map((r) => r.key);
  const short = (key: string, label: string) => STAGE_SEQUENCE.find((s) => s.key === key)?.short ?? label;
  // "Use defaults" on a section: nothing to offer when it already is the defaults, or the form cannot be changed (the old Settings had it)
  const defaultsFor = (part: Part) => (canEdit && !atDefaults(draft, policy.defaults, part)
    ? <button type="button" className={BTN_TEXT} onClick={() => setEdited(withDefaults(draft, policy.defaults, part))}>Use defaults</button>
    : undefined);

  return (
    <div className="max-w-4xl space-y-4">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d5dbe1] bg-[#fff] px-4 py-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[13px] leading-5 text-[#586472]">
            {standing(policy.customised)}
            {dirty && <span className="rounded-full px-2 py-px text-[11px] font-semibold" style={{ background: TONE.warning.tint, color: TONE.warning.text }}>Unsaved</span>}
          </p>
          {dirty && issues.length > 0 && (
            <p className="text-[12px] leading-4" style={{ color: TONE.danger.text }}>{issues[0]}{issues.length > 1 ? ` (and ${issues.length - 1} more)` : ''}</p>
          )}
          {!canEdit && <p className="text-[13px] leading-5" style={{ color: TONE.warning.text }}>View only. Changing the policy needs the vendor_risk:config:edit permission.</p>}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            {dirty && <button type="button" className={BTN} disabled={save.isPending} onClick={() => setEdited(null)}>Discard</button>}
            <button type="button" className={BTN_PRIMARY} disabled={!dirty || issues.length > 0 || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save policy'}
            </button>
          </div>
        )}
      </div>

      <div id="bands" className="scroll-mt-24">
        <Panel title="Bands and cadence" info="The score a tier starts at, and how often a vendor at that tier is reviewed. Low is anything below Medium."
          action={defaultsFor('bands')}>
          <div className="grid max-w-xl grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
            <span />
            <span className={HEAD}>Score from</span>
            <span className={HEAD}>Reviewed every (days)</span>
            {TIERS.map((t) => (
              <Fragment key={t}>
                <TierBadge tier={t} />
                {t === 'low' ? (
                  <span className="text-right text-[13px] leading-5 text-[#64707e]">Below medium</span>
                ) : (
                  <NumberField label={`${tierLabel(t)} score from`} value={draft.thresholds[t]} disabled={!canEdit} invalid={bandsBad(draft.thresholds)}
                    onChange={(n) => edit((x) => { x.thresholds[t] = n; })} />
                )}
                <NumberField label={`${tierLabel(t)} reviewed every (days)`} value={draft.cadence_days[t]} disabled={!canEdit} invalid={cadenceBad(draft.cadence_days[t])}
                  onChange={(n) => edit((x) => { x.cadence_days[t] = n; })} />
              </Fragment>
            ))}
          </div>
        </Panel>
      </div>

      <div id="remediation" className="scroll-mt-24">
        <Panel title="Remediation windows" info="How long a finding of each severity has before it is overdue." action={defaultsFor('remediation')}>
          <div className="grid max-w-xl grid-cols-2 gap-4 sm:grid-cols-4">
            {TIERS.map((t) => (
              <label key={t} className="block text-[13px] font-medium leading-5 text-[#26323d]">
                <span className="mb-1 block">{tierLabel(t)} (days)</span>
                <NumberField label={`${tierLabel(t)} findings: days to fix`} value={draft.remediation_days[t]} disabled={!canEdit} invalid={windowBad(draft.remediation_days[t])}
                  onChange={(n) => edit((x) => { x.remediation_days[t] = n; })} />
              </label>
            ))}
          </div>
        </Panel>
      </div>

      <div id="skips" className="scroll-mt-24">
        <Panel title="Stages each tier skips" info="Intake, tiering, approval, monitoring and reassessment run for every vendor and are not listed."
          action={defaultsFor('skips')}>
          <div className="space-y-3">
            {TIERS.map((t) => (
              <div key={t} className="flex flex-wrap items-center gap-2">
                <span className="w-20 shrink-0"><TierBadge tier={t} /></span>
                {stages.map((s) => (
                  <ToggleChip key={s.key} on={draft.skip_matrix[t].includes(s.key)} disabled={!canEdit}
                    onClick={() => edit((x) => { x.skip_matrix[t] = toggled(x.skip_matrix[t], s.key, stageOrder); })}>
                    {short(s.key, s.label)}
                  </ToggleChip>
                ))}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div id="reviewers" className="scroll-mt-24">
        <Panel title="Reviewers each tier needs" info="Roles, filled from the roster. Diligence waits until they are."
          action={<>{defaultsFor('reviewers')}<Link href="/vendor-risk/roster" className={BTN_TEXT}>Open roster</Link></>}>
          <div className="space-y-3">
            {TIERS.map((t) => (
              <div key={t} className="flex flex-wrap items-center gap-2">
                <span className="w-20 shrink-0"><TierBadge tier={t} /></span>
                {roles.map((r) => (
                  <ToggleChip key={r.key} on={draft.required_reviewers[t].includes(r.key)} disabled={!canEdit}
                    onClick={() => edit((x) => { x.required_reviewers[t] = toggled(x.required_reviewers[t], r.key, roleOrder); })}>
                    {r.label}
                  </ToggleChip>
                ))}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div id="approvals" className="scroll-mt-24">
        <Panel title="Approver and reopen" info="Who may approve a vendor of each tier, and from which severity a monitoring alert reopens its assessment. A reported breach always does."
          action={defaultsFor('approvals')}>
          <div className="grid gap-3 sm:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-x-4">
            <span className="hidden sm:block" />
            <span className="hidden text-[11px] font-semibold uppercase tracking-wide text-[#586472] sm:block">Approver role</span>
            <span className="hidden text-[11px] font-semibold uppercase tracking-wide text-[#586472] sm:block">Reopen from</span>
            {TIERS.map((t: Tier) => (
              <Fragment key={t}>
                <TierBadge tier={t} />
                <select aria-label={`${tierLabel(t)} approver role`} className={SELECT} disabled={!canEdit} value={draft.approver_roles[t] ?? ''}
                  onChange={(e) => edit((x) => { x.approver_roles[t] = e.target.value || null; })}>
                  {approverOptions(directory?.roles ?? [], draft.approver_roles[t]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select aria-label={`${tierLabel(t)} reopen from`} className={SELECT} disabled={!canEdit} value={draft.reopen[t]}
                  onChange={(e) => edit((x) => { x.reopen[t] = e.target.value as Tier; })}>
                  {REOPEN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Fragment>
            ))}
          </div>
        </Panel>
      </div>

      <div id="alert-rules" className="scroll-mt-24">
        <AlertRulesSection directory={directory} />
      </div>

      <p className="text-[12px] leading-4 text-[#64707e]">Work under way keeps the policy it started under.</p>
    </div>
  );
}
