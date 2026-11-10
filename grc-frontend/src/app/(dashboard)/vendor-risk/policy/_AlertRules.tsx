'use client';

// Alert rules, on the Policy page: what a verified monitoring alert sets off besides the two built-in rules, in the order they run. Add, edit, switch on or off, and reorder; each change saves on its
// own (the page's Save is not involved). The rule form is a Sheet (focus kept inside, Escape asks before it throws typing away); a failed save says so there, with the server's words.
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react';
import { Button, Checkbox, ErrorState, FormField, IconButton, MultiSelect, SectionCard, Select, SkeletonRows, TextInput, EmptyState, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { Sheet } from '@/components/ui/ds';
import { usePermissions } from '@/hooks/usePermissions';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import {
  alertRulesApi, alertRulesKey, type AlertAction, type AlertRule, type AlertRuleInput, type AlertRules, type BuiltinRule, type Severity,
} from '../_lib/alertRulesApi';
import { TIERS, TIER_LABEL, TargetsPicker, targetLabel, type Directory } from '../settings/_ui';

const ACTION_HELP: Record<AlertAction, string> = {
  notify: 'The supplier’s owner and the people named hear at once, in the app and by email.',
  create_task: 'A to-do on the supplier’s action plan, due today, for the people named, or the owner.',
  bring_forward_reassessment: 'The next reassessment falls due today. No new assessment opens.',
  open_reassessment: 'A reassessment opens, or the one already open is joined.',
};
const PEOPLE: AlertAction[] = ['notify', 'create_task'];
const sev = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Draft {
  name: string; action: AlertAction; min_severity: Severity; tiers: string[]; signal_kinds: string[]; targets: string[];
}

const toDraft = (r?: AlertRule): Draft => ({
  name: r?.name ?? '', action: r?.action ?? 'notify', min_severity: r?.min_severity ?? 'high',
  tiers: r?.tiers ?? [], signal_kinds: r?.signal_kinds ?? [],
  targets: [...(r?.notify_user_ids ?? []).map((id) => `user:${id}`), ...(r?.notify_roles ?? []).map((n) => `role:${n}`)],
});

const toInput = (d: Draft): AlertRuleInput => {
  const people = PEOPLE.includes(d.action) ? d.targets : [];
  return {
    name: d.name.trim(), action: d.action, min_severity: d.min_severity, tiers: d.tiers, signal_kinds: d.signal_kinds,
    notify_user_ids: people.filter((t) => t.startsWith('user:')).map((t) => Number(t.slice(5))),
    notify_roles: people.filter((t) => t.startsWith('role:')).map((t) => t.slice(5)),
  };
};

function who(targets: string[], directory?: Directory, owner = false): string {
  const names = targets.map((t) => targetLabel(t, directory));
  return [...(owner ? ['the owner'] : []), ...names].join(', ') || 'the owner';
}

function summary(r: AlertRule, data: AlertRules, directory?: Directory): string {
  const parts = [
    `${sev(r.min_severity)} and up`,
    r.tiers.length ? TIERS.filter((t) => r.tiers.includes(t)).map((t) => TIER_LABEL[t]).join(', ') : 'Every tier',
    r.signal_kinds.length ? r.signal_kinds.map((k) => data.kinds[k] || k).join(', ') : 'Every alert',
  ];
  if (PEOPLE.includes(r.action)) parts.push(`for ${who(toDraft(r).targets, directory, r.action === 'notify')}`);
  return parts.join(' · ');
}

function builtinSummary(b: BuiltinRule, directory?: Directory): string {
  if (b.key === 'email') return b.enabled ? `${sev(b.min_severity || 'high')} and up · for ${who(b.targets || [], directory, true)}` : 'Off: reminders are off';
  return [...TIERS.map((t) => `${TIER_LABEL[t]} from ${b.reassess_on?.[t] || 'high'}`), 'a breach always'].join(' · ');
}

function RuleSheet({ rule, data, directory, onClose }: { rule: AlertRule | null; data: AlertRules; directory?: Directory; onClose: () => void }) {
  const initial = toDraft(rule ?? undefined);
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => { setError(null); setD((x) => ({ ...x, ...patch })); };
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const save = useReportedMutation({
    mutationFn: () => (rule ? alertRulesApi.update(rule.id, toInput(d)) : alertRulesApi.create(toInput(d))),
    success: rule ? 'Rule saved' : 'Rule added',
    failure: 'The rule could not be saved.',
    invalidate: [alertRulesKey],
    toast: 'success',
    onSuccess: () => onClose(),
    onError: (e) => setError(errorMessage(e, 'The rule could not be saved. Try again.')),
  });
  return (
    <Sheet
      open onClose={onClose} width="md" dirty={dirty} title={rule ? 'Edit rule' : 'Add a rule'} subtitle="Acts on a verified monitoring alert, after the built-in rules."
      footer={(
        <div className="flex items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!d.name.trim() || !dirty} onClick={() => save.mutate()}>{rule ? 'Save rule' : 'Add rule'}</Button>
        </div>
      )}
    >
      <form className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); if (d.name.trim() && dirty) save.mutate(); }}>
        {error && <p role="alert" className="rounded-ds-control border border-ds-danger-border bg-ds-danger-soft px-[12px] py-[8px] text-ds-body text-ds-danger">{error}</p>}
        <FormField label="Name" required>
          <TextInput value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} placeholder="e.g. Breaches on critical suppliers" />
        </FormField>
        <FormField label="What it does" hint={ACTION_HELP[d.action]}>
          <Select value={d.action} onChange={(e) => set({ action: e.target.value as AlertAction })}>
            {(Object.keys(data.actions) as AlertAction[]).map((a) => <option key={a} value={a}>{data.actions[a]}</option>)}
          </Select>
        </FormField>
        <FormField label="From severity">
          <Select value={d.min_severity} onChange={(e) => set({ min_severity: e.target.value as Severity })}>
            {data.severities.map((s) => <option key={s} value={s}>{sev(s)} and up</option>)}
          </Select>
        </FormField>
        <FormField label="Tiers" info="None chosen: every tier. A supplier split into engagements matches on any open engagement’s tier.">
          <MultiSelect label="Tiers" options={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))} value={d.tiers} onChange={(tiers) => set({ tiers })} placeholder="Every tier" />
        </FormField>
        <FormField label="Alerts" info="None chosen: every kind of alert.">
          <MultiSelect label="Kinds of alert" options={Object.entries(data.kinds).map(([value, label]) => ({ value, label }))} value={d.signal_kinds} onChange={(signal_kinds) => set({ signal_kinds })} placeholder="Every alert" />
        </FormField>
        {PEOPLE.includes(d.action) && (
          <div>
            <p className="mb-[4px] text-ds-body font-[500] text-ds-fg">{d.action === 'notify' ? 'Also tell' : 'For'}</p>
            <TargetsPicker value={d.targets} onChange={(targets) => set({ targets })} directory={directory} placeholder={d.action === 'notify' ? 'Add a role or a person…' : 'The owner, or choose…'} />
          </div>
        )}
      </form>
    </Sheet>
  );
}

export default function AlertRulesSection({ directory }: { directory?: Directory }) {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:config:edit') || hasPermission('erm:risks:edit');       // the server accepts either (rbac.require_write falls back to the risk-edit right)
  const [editing, setEditing] = useState<AlertRule | 'new' | null>(null);
  const list = useQuery({ queryKey: alertRulesKey, queryFn: async () => (await alertRulesApi.list()).data, ...TPRM_QUERY_OPTS });
  const data = list.data;
  const rules = data?.items || [];
  const toggle = useReportedMutation({
    mutationFn: (r: AlertRule) => alertRulesApi.update(r.id, { enabled: !r.enabled }),
    failure: 'The rule could not be changed.',
    invalidate: [alertRulesKey],
    toast: 'errors',
  });
  const reorder = useReportedMutation({
    mutationFn: (ids: number[]) => alertRulesApi.reorder(ids),
    failure: 'The order of the rules could not be changed.',
    invalidate: [alertRulesKey],
    toast: 'errors',
  });
  const move = (index: number, by: number) => {
    const ids = rules.map((r) => r.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <SectionCard
      id="alert-rules-section"
      title="Alert rules"
      info="A verified alert always runs the two built-in rules. Your rules run after them, top to bottom, and every one that matches acts. Each change saves on its own."
      actions={canEdit && data ? <Button leftIcon={<Plus aria-hidden />} onClick={() => setEditing('new')}>Add rule</Button> : undefined}
    >
      {list.isLoading && <SkeletonRows rows={3} columns={2} label="Loading the alert rules" />}
      {list.isError && <ErrorState title="Couldn't load the alert rules" message={errorMessage(list.error)} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} />}
      {data && (
        <div className="flex flex-col gap-[16px]">
          <section aria-label="Built in">
            <h3 className="m-0 mb-[8px] !text-ds-label !font-[600] !text-ds-fg-muted">Built in</h3>
            <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
              {data.builtin.map((b) => (
                <li key={b.key} className="flex flex-wrap items-center gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[12px]">
                  <div className="min-w-0 flex-1 basis-[14rem]">
                    <p className="text-ds-body font-[600] text-ds-fg">{b.name}</p>
                    <p className="text-ds-label text-ds-fg-muted">{builtinSummary(b, directory)}</p>
                  </div>
                  {/* the reopen thresholds are on this page; the reminders' emails are Settings' */}
                  <Link href={b.key === 'reopen' ? '#approvals' : b.settings} className="inline-flex min-h-ds-control items-center text-ds-body font-[500] text-ds-primary-text underline">Change</Link>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Your rules">
            <h3 className="m-0 mb-[8px] !text-ds-label !font-[600] !text-ds-fg-muted">Your rules ({rules.length})</h3>
            {rules.length === 0 ? (
              <div className="rounded-ds-card border border-dashed border-ds-border-strong">
                <EmptyState kind="firstUse" bare title="No rules of your own yet" description="The two built-in rules run for every verified alert. Add one to tell more people or open a reassessment sooner." />
              </div>
            ) : (
              <ol className="m-0 flex list-none flex-col divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface p-0">
                {rules.map((r, i) => (
                  <li key={r.id} className={clsx('flex flex-wrap items-center gap-[12px] px-[16px] py-[12px]', !r.enabled && 'bg-ds-surface-subtle')}>
                    <span className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full bg-ds-border text-ds-label font-[600] text-ds-fg-body" aria-hidden>{i + 1}</span>
                    <div className="min-w-0 flex-1 basis-[14rem]">
                      <p className="break-words text-ds-body font-[600] text-ds-fg">{r.name} <span className="font-normal text-ds-fg-muted">· {data.actions[r.action]}</span>{!r.enabled && <span className="ml-[6px] text-ds-label font-normal text-ds-fg-muted">(off)</span>}</p>
                      <p className="text-ds-label text-ds-fg-muted">{summary(r, data, directory)}</p>
                    </div>
                    <Checkbox label="On" aria-label={`${r.name} is on`} checked={r.enabled} disabled={!canEdit || toggle.isPending} onChange={() => toggle.mutate(r)} />
                    {canEdit && (
                      <span className="flex items-center gap-[2px]">
                        <IconButton label={`Move ${r.name} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}><ArrowUp aria-hidden /></IconButton>
                        <IconButton label={`Move ${r.name} down`} disabled={i === rules.length - 1 || reorder.isPending} onClick={() => move(i, 1)}><ArrowDown aria-hidden /></IconButton>
                        <IconButton label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil aria-hidden /></IconButton>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
      {editing !== null && data && <RuleSheet key={editing === 'new' ? 'new' : editing.id} rule={editing === 'new' ? null : editing} data={data} directory={directory} onClose={() => setEditing(null)} />}
    </SectionCard>
  );
}
