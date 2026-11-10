'use client';

// Setup > Policy: what each tier is worth in review work, in one form with one Save. Where each tier starts and how often it is reviewed, how long a finding has before it is overdue, the stages each
// tier skips, the roster roles that must review it, who approves it and from which alert severity its assessment reopens; then the alert rules, which save on their own. Work under way keeps the
// policy it started under. Save is ONE request (the policy and the reopen thresholds together). A link to #alert-rules (the old Alert rules address leads here), #bands, #remediation, #skips, #reviewers
// or #approvals scrolls to that section. Leaving with edits asks first. D48 kept: Policy and Settings stay two pages.
import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, ReadOnlyNote, SaveBar, SectionCard, Select, SkeletonRows, StatusPill, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { routeFor } from '@/lib/navRegistry';
import { statusPill } from '@/lib/status';
import { vendorTier } from '@/lib/statuses/vendor';
import { VendorTabs } from '../_lib/VendorNav';
import { STAGE_SEQUENCE } from '../_lib/lifecycleShared';
import { useLeaveGuard } from '../_lib/useLeaveGuard';
import { configKey, directoryKey, policyApi, policyKey } from '../_lib/policyApi';
import {
  REOPEN_OPTIONS, TIERS, approverOptions, atDefaults, bandsBad, cadenceBad, isDirty, problems, reopenFrom, savePatch, standing, toDraft,
  toggled, windowBad, withDefaults, type Draft, type Part, type Tier,
} from '../_lib/policyModel';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import AlertRulesSection from './_AlertRules';

const INFO = 'What each tier is worth in review work: where it starts, how often it is reviewed, how long a finding has to be fixed, the stages it skips, who reviews and approves it, and what reopens its assessment. Work under way keeps the policy it started under.';
const HEAD = 'hidden text-ds-label font-[600] text-ds-fg-muted sm:block';
const tierLabel = (t: Tier): string => vendorTier.label(t);
const TierPill = ({ tier }: { tier: Tier }) => <StatusPill size="sm" {...statusPill(vendorTier, tier)} />;

/** A field's name on a phone, where the column heads are gone; on a wider screen it is the column head's job. */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0"><span className="mb-[2px] block text-ds-label text-ds-fg-muted sm:sr-only">{label}</span>{children}</label>;
}

function NumberField({ label, value, onChange, invalid, disabled, unit }: { label: string; value: number; onChange: (n: number) => void; invalid: boolean; disabled: boolean; unit?: string }) {
  return (
    <TextInput type="number" inputMode="numeric" aria-label={label} invalid={invalid} disabled={disabled} unit={unit} value={Number.isFinite(value) ? value : ''}
      onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))} />
  );
}

/** A choice that is on or off (a stage a tier skips, a role that must review): a pressed button, not a colour. */
function Toggle({ on, disabled, onClick, children }: { on: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick}
      className={clsx('inline-flex min-h-ds-control-sm items-center rounded-full border px-[12px] text-ds-label focus-visible:outline-none focus-visible:shadow-ds-ring disabled:cursor-not-allowed disabled:opacity-60',
        on ? 'border-ds-primary bg-ds-primary-soft font-[600] text-ds-primary-text' : 'border-ds-border-control bg-ds-surface text-ds-fg-body hover:bg-ds-surface-hover')}>
      {children}
    </button>
  );
}

export default function PolicyPage() {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const label = routeFor('/vendor-risk/policy')?.label ?? 'Policy';

  const policyQuery = useQuery({ queryKey: policyKey, queryFn: async () => (await policyApi.get()).data, ...TPRM_QUERY_OPTS });
  // the reopen threshold is not on the policy: it stays in the tier policy of the program config (the same fetch Settings makes); it is SAVED with the policy now
  const configQuery = useQuery({ queryKey: configKey, queryFn: async () => (await policyApi.config()).data, ...TPRM_QUERY_OPTS });
  const directoryQuery = useQuery({ queryKey: directoryKey, queryFn: async () => (await policyApi.directory()).data, ...TPRM_QUERY_OPTS });
  const directory = directoryQuery.data;
  const policy = policyQuery.data;

  const saved = useMemo(() => (policy && configQuery.data ? toDraft(policy, reopenFrom(configQuery.data)) : null), [policy, configQuery.data]);
  // What is on the form: the saved policy until something is changed, then the person's own copy of it.
  const [edited, setEdited] = useState<Draft | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const draft = edited ?? saved;
  const edit = (change: (next: Draft) => void) => {
    setServerError(null);
    setSavedAt(null);
    setEdited((cur) => {
      const base = cur ?? saved;
      if (!base) return cur;
      const next = toDraft(base, base.reopen);
      change(next);
      return next;
    });
  };

  // a link to #section scrolls there once the page is drawn
  const ready = saved !== null;
  useEffect(() => {
    const id = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
    if (!ready || !id) return undefined;
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    return () => clearTimeout(timer);
  }, [ready]);
  useEffect(() => {
    if (!savedAt) return undefined;
    const t = window.setTimeout(() => setSavedAt(null), 4000);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  const dirty = !!(draft && saved && isDirty(draft, saved));
  const issues = draft ? problems(draft) : [];
  useLeaveGuard(dirty, () => confirm({ title: 'Leave without saving?', message: 'The policy you changed has not been saved.', confirmLabel: 'Leave', cancelLabel: 'Stay', tone: 'danger' }));

  const save = useReportedMutation({
    mutationFn: async () => {
      const body = draft && saved ? savePatch(draft, saved) : null;
      if (body) await policyApi.save(body);            // one request: the policy and the reopen thresholds are saved whole or not at all
    },
    success: 'Policy saved',
    failure: 'The policy could not be saved.',
    toast: 'success',                                  // a refusal is said on the save bar, in the server's words
    // wait for the reads to come back, so the form is not "unsaved" for a moment after it was saved
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: policyKey }), qc.invalidateQueries({ queryKey: configKey })]);
      setEdited(null);
      setServerError(null);
      setSavedAt(Date.now());
    },
    onError: (e) => setServerError(errorMessage(e, 'The policy could not be saved. Try again.')),
  });

  const head = (
    <>
      <PageHeader
        variant="page" title={label} info={INFO}
        meta={policy && !policy.can_edit ? <ReadOnlyNote>View only <InfoTip text="Only people who may configure Vendor Risk can change the policy." label="Why the policy is view only" /></ReadOnlyNote> : policy ? standing(policy.customised) : undefined}
      />
      <VendorTabs />
    </>
  );
  if (policyQuery.isLoading || configQuery.isLoading) return <div className="flex flex-col gap-[16px]">{head}<SkeletonRows rows={6} columns={3} label="Loading the policy" /></div>;
  if (policyQuery.isError || configQuery.isError || !policy || !draft || !saved) {
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <ErrorState title="Couldn't load the policy" message={errorMessage(policyQuery.error ?? configQuery.error)}
          onRetry={canRetry(policyQuery.error ?? configQuery.error) ? () => { void policyQuery.refetch(); void configQuery.refetch(); } : undefined} />
      </div>
    );
  }

  const canEdit = policy.can_edit;
  const stages = policy.meta.stages.filter((s) => s.skippable);
  const stageOrder = stages.map((s) => s.key);
  const roles = policy.meta.roles;
  const roleOrder = roles.map((r) => r.key);
  const short = (key: string, text: string) => STAGE_SEQUENCE.find((s) => s.key === key)?.short ?? text;
  // "Use defaults" on a section: nothing to offer when it already is the defaults, or the form cannot be changed
  const defaultsFor = (part: Part) => (canEdit && !atDefaults(draft, policy.defaults, part)
    ? <Button size="sm" variant="ghost" onClick={() => { setServerError(null); setEdited(withDefaults(draft, policy.defaults, part)); }}>Use defaults</Button>
    : undefined);
  const firstIssue = dirty && issues.length > 0 ? `${issues[0]}${issues.length > 1 ? ` (and ${issues.length - 1} more)` : ''}` : null;

  return (
    <div className="flex min-w-0 flex-col gap-[16px] pb-[16px]">
      {head}

      <SectionCard id="bands" title="Bands and cadence" info="The score a tier starts at, and how often a vendor at that tier is reviewed. Low is anything below Medium." actions={defaultsFor('bands')}>
        <div className="grid max-w-xl grid-cols-2 gap-x-[12px] gap-y-[12px] sm:grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-x-[16px]">
          <span className="hidden sm:block" />
          <span className={HEAD}>Score from</span>
          <span className={HEAD}>Reviewed every</span>
          {TIERS.map((t) => (
            <Fragment key={t}>
              <span className="col-span-2 sm:col-span-1"><TierPill tier={t} /></span>
              {t === 'low' ? (
                <span className="text-ds-body text-ds-fg-muted">Below medium</span>
              ) : (
                <Cell label={`${tierLabel(t)} score from`}>
                  <NumberField label={`${tierLabel(t)} score from`} value={draft.thresholds[t]} disabled={!canEdit} invalid={bandsBad(draft.thresholds)} onChange={(n) => edit((x) => { x.thresholds[t] = n; })} />
                </Cell>
              )}
              <Cell label={`${tierLabel(t)} reviewed every`}>
                <NumberField label={`${tierLabel(t)} reviewed every (days)`} unit="days" value={draft.cadence_days[t]} disabled={!canEdit} invalid={cadenceBad(draft.cadence_days[t])} onChange={(n) => edit((x) => { x.cadence_days[t] = n; })} />
              </Cell>
            </Fragment>
          ))}
        </div>
      </SectionCard>

      <SectionCard id="remediation" title="Remediation windows" info="How long a finding of each severity has before it is overdue." actions={defaultsFor('remediation')}>
        <div className="grid max-w-xl grid-cols-2 gap-[16px] sm:grid-cols-4">
          {TIERS.map((t) => (
            <label key={t} className="block min-w-0 text-ds-body font-[500] text-ds-fg">
              <span className="mb-[4px] block">{tierLabel(t)}</span>
              <NumberField label={`${tierLabel(t)} findings: days to fix`} unit="days" value={draft.remediation_days[t]} disabled={!canEdit} invalid={windowBad(draft.remediation_days[t])} onChange={(n) => edit((x) => { x.remediation_days[t] = n; })} />
            </label>
          ))}
        </div>
      </SectionCard>

      <SectionCard id="skips" title="Stages each tier skips" info="Intake, tiering, approval, monitoring and reassessment run for every vendor and are not listed." actions={defaultsFor('skips')}>
        <div className="flex flex-col gap-[12px]">
          {TIERS.map((t) => (
            <div key={t} className="flex flex-wrap items-center gap-[8px]">
              <span className="w-[88px] shrink-0"><TierPill tier={t} /></span>
              {stages.map((s) => (
                <Toggle key={s.key} on={draft.skip_matrix[t].includes(s.key)} disabled={!canEdit} onClick={() => edit((x) => { x.skip_matrix[t] = toggled(x.skip_matrix[t], s.key, stageOrder); })}>
                  {short(s.key, s.label)}
                </Toggle>
              ))}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard id="reviewers" title="Reviewers each tier needs" info="Roles, filled from the roster. Diligence waits until they are."
        actions={<>{defaultsFor('reviewers')}<Button size="sm" href="/vendor-risk/roster">Open roster</Button></>}>
        <div className="flex flex-col gap-[12px]">
          {TIERS.map((t) => (
            <div key={t} className="flex flex-wrap items-center gap-[8px]">
              <span className="w-[88px] shrink-0"><TierPill tier={t} /></span>
              {roles.map((r) => (
                <Toggle key={r.key} on={draft.required_reviewers[t].includes(r.key)} disabled={!canEdit} onClick={() => edit((x) => { x.required_reviewers[t] = toggled(x.required_reviewers[t], r.key, roleOrder); })}>
                  {r.label}
                </Toggle>
              ))}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard id="approvals" title="Approver and reopen" info="Who may approve a vendor of each tier, and from which severity a monitoring alert reopens its assessment. A reported breach always does." actions={defaultsFor('approvals')}>
        <div className="grid grid-cols-1 gap-x-[16px] gap-y-[12px] sm:grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
          <span className="hidden sm:block" />
          <span className={HEAD}>Approver role</span>
          <span className={HEAD}>Reopen from</span>
          {TIERS.map((t) => (
            <Fragment key={t}>
              <TierPill tier={t} />
              <Cell label={`${tierLabel(t)} approver role`}>
                <Select aria-label={`${tierLabel(t)} approver role`} disabled={!canEdit} value={draft.approver_roles[t] ?? ''}
                  onChange={(e) => edit((x) => { x.approver_roles[t] = e.target.value || null; })}>
                  {approverOptions(directory?.roles ?? [], draft.approver_roles[t]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Cell>
              <Cell label={`${tierLabel(t)} reopen from`}>
                <Select aria-label={`${tierLabel(t)} reopen from`} disabled={!canEdit} value={draft.reopen[t]}
                  onChange={(e) => edit((x) => { x.reopen[t] = e.target.value as Tier; })}>
                  {REOPEN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Cell>
            </Fragment>
          ))}
        </div>
        {directoryQuery.isError && <p className="mt-[8px] text-ds-label text-ds-warning">The roles to choose from could not be loaded, so an approver role cannot be changed now. <button type="button" className="min-h-ds-control font-[500] text-ds-primary-text underline" onClick={() => { void directoryQuery.refetch(); }}>Retry</button></p>}
      </SectionCard>

      <div id="alert-rules" className="scroll-mt-[64px]">
        <AlertRulesSection directory={directory} />
      </div>

      <p className="text-ds-label text-ds-fg-muted">
        Work under way keeps the policy it started under. How suppliers are tiered, reminded and monitored is on the <Link href="/vendor-risk/settings" className="font-[500] text-ds-primary-text underline">Settings</Link> page.
      </p>

      <SaveBar
        label="Save the policy" saveLabel="Save policy" canEdit={canEdit} dirty={dirty} invalid={issues.length > 0} saving={save.isPending} justSaved={savedAt !== null && !dirty}
        error={serverError ?? firstIssue} onSave={() => save.mutate()} onDiscard={() => { setEdited(null); setServerError(null); }}
      />
      {confirmDialog}
    </div>
  );
}
