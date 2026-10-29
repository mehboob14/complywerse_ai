'use client';

// Alert rules: what a verified monitoring alert sets off besides the two built-in
// rules, in the order they run. Add, edit, switch on or off, and reorder.

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowDown, ArrowLeft, ArrowUp, Loader2, Pencil, Plus, Siren } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { errText } from '../../_lib/intake/types';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import {
  alertRulesApi, alertRulesKey, type AlertAction, type AlertRule, type AlertRuleInput, type AlertRules, type BuiltinRule,
  type Severity,
} from '../../_lib/alertRulesApi';
import { TIERS, TIER_LABEL, TargetsPicker, fieldCls, targetLabel, type Directory } from '../_ui';

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

function Chips({ options, value, onChange, label }: {
  options: Array<[string, string]>; value: string[]; onChange: (next: string[]) => void; label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map(([key, text]) => {
        const on = value.includes(key);
        return (
          <button key={key} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== key) : [...value, key])}
            className={clsx('rounded-full border px-2.5 py-0.5 text-xs', on ? 'border-primary-400 bg-primary-50 text-primary-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
            {text}
          </button>
        );
      })}
    </div>
  );
}

function RuleForm({ rule, data, directory, onDone }: {
  rule: AlertRule | null; data: AlertRules; directory?: Directory; onDone: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [d, setD] = useState<Draft>(toDraft(rule ?? undefined));
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () => (rule ? alertRulesApi.update(rule.id, toInput(d)) : alertRulesApi.create(toInput(d))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: alertRulesKey });
      toast({ type: 'success', title: rule ? 'Rule saved' : 'Rule added' });
      onDone();
    },
    onError: (e) => toast({ type: 'error', title: 'Not saved', message: errText(e, 'Try again.') }),
  });
  return (
    <form className="space-y-3 rounded-xl border border-primary-100 bg-primary-50/40 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <label className="block text-xs font-medium text-slate-600">
        Name
        <input className={clsx(fieldCls, 'mt-1')} value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} required
          placeholder="e.g. Breaches on critical suppliers" />
      </label>
      <div>
        <p className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
          Does <InfoTip label="About what the rule does" text={ACTION_HELP[d.action]} />
        </p>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What the rule does">
          {(Object.keys(data.actions) as AlertAction[]).map((a) => (
            <button key={a} type="button" role="radio" aria-checked={d.action === a} onClick={() => set({ action: a })}
              className={clsx('rounded-lg border px-3 py-2 text-left text-sm', d.action === a ? 'border-primary-500 bg-white text-primary-800 shadow-sm' : 'border-slate-200 bg-white/60 text-slate-600 hover:bg-white')}>
              {data.actions[a]}
            </button>
          ))}
        </div>
      </div>
      <label className="block text-xs font-medium text-slate-600">
        From
        <select className={clsx(fieldCls, 'mt-1 sm:w-48')} value={d.min_severity} onChange={(e) => set({ min_severity: e.target.value as Severity })}>
          {data.severities.map((s) => <option key={s} value={s}>{sev(s)} and up</option>)}
        </select>
      </label>
      <div>
        <p className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
          Tiers <InfoTip label="About tiers" text="None chosen: every tier. A supplier split into engagements matches on any open engagement’s tier." />
        </p>
        <Chips label="Tiers" options={TIERS.map((t): [string, string] => [t, TIER_LABEL[t]])} value={d.tiers}
          onChange={(tiers) => set({ tiers })} />
      </div>
      <div>
        <p className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
          Alerts <InfoTip label="About alerts" text="None chosen: every kind of alert." />
        </p>
        <Chips label="Kinds of alert" options={Object.entries(data.kinds)} value={d.signal_kinds} onChange={(signal_kinds) => set({ signal_kinds })} />
      </div>
      {PEOPLE.includes(d.action) && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">{d.action === 'notify' ? 'Also tell' : 'For'}</p>
          <TargetsPicker value={d.targets} onChange={(targets) => set({ targets })} directory={directory}
            placeholder={d.action === 'notify' ? 'Add a role or a person…' : 'The owner, or choose…'} />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
        <button type="submit" disabled={save.isPending || !d.name.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {rule ? 'Save' : 'Add rule'}
        </button>
      </div>
    </form>
  );
}

export default function AlertRulesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:config:edit') || hasPermission('erm:risks:edit');
  const [editing, setEditing] = useState<AlertRule | 'new' | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: alertRulesKey,
    queryFn: async () => (await alertRulesApi.list()).data,
    ...TPRM_QUERY_OPTS,
  });
  const { data: directory } = useQuery({
    queryKey: ['tprm-config-directory'],
    queryFn: async () => (await tpraApi.configDirectory()).data as Directory,
    ...TPRM_QUERY_OPTS,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: alertRulesKey });
  const fail = (e: unknown) => toast({ type: 'error', title: 'Not saved', message: errText(e, 'Try again.') });
  const toggle = useMutation({
    mutationFn: (r: AlertRule) => alertRulesApi.update(r.id, { enabled: !r.enabled }), onSuccess: refresh, onError: fail,
  });
  const reorder = useMutation({ mutationFn: (ids: number[]) => alertRulesApi.reorder(ids), onSuccess: refresh, onError: fail });
  const rules = data?.items || [];
  const move = (index: number, by: number) => {
    const ids = rules.map((r) => r.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <div className="max-w-4xl space-y-5">
      <Link href="/vendor-risk/settings" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"><ArrowLeft className="h-3.5 w-3.5" /> Settings</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Siren className="h-5 w-5 text-slate-500" aria-hidden /> Alert rules
          <InfoTip label="About alert rules" text="A verified alert always runs the two built-in rules. Your rules run after them, top to bottom, and every one that matches acts." />
        </h1>
        {canEdit && editing === null && (
          <button type="button" onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700">
            <Plus className="h-4 w-4" /> Add rule
          </button>
        )}
      </div>
      {isLoading && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {isError && <p className="text-sm text-rose-700">Could not load the rules.</p>}
      {data && (
        <>
          {editing !== null && (
            <RuleForm key={editing === 'new' ? 'new' : editing.id} rule={editing === 'new' ? null : editing} data={data}
              directory={directory} onDone={() => setEditing(null)} />
          )}
          <section aria-label="Built in">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Built in</h2>
            <ul className="space-y-2">
              {data.builtin.map((b) => (
                <li key={b.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{b.name}</p>
                    <p className="text-xs text-slate-500">{builtinSummary(b, directory)}</p>
                  </div>
                  <Link href={b.settings} className="text-xs font-medium text-primary-700 hover:underline">Change</Link>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Your rules">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Your rules ({rules.length})</h2>
            {rules.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">None yet.</p>
            ) : (
              <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {rules.map((r, i) => (
                  <li key={r.id} className={clsx('flex flex-wrap items-center gap-3 px-4 py-3', !r.enabled && 'opacity-60')}>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">
                        {r.name} <span className="font-normal text-slate-500">· {data.actions[r.action]}</span>
                      </p>
                      <p className="text-xs text-slate-500">{summary(r, data, directory)}</p>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input type="checkbox" checked={r.enabled} disabled={!canEdit || toggle.isPending} onChange={() => toggle.mutate(r)} /> On
                    </label>
                    {canEdit && (
                      <span className="flex items-center gap-0.5">
                        <button type="button" aria-label={`Move ${r.name} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button type="button" aria-label={`Move ${r.name} down`} disabled={i === rules.length - 1 || reorder.isPending} onClick={() => move(i, 1)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                        <button type="button" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}
