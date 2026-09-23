'use client';

// TPRM Admin / Settings (TPRM-006) — per-tenant program configuration the tiering
// & scoring engines actually read: inherent-risk factor weights, tier thresholds,
// and reassessment cadence. Previously hard-coded / not tunable.

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Save, RotateCcw, Loader2, AlertCircle, SlidersHorizontal, Gauge, CalendarClock, BellRing, ListChecks, Layers, Radio } from 'lucide-react';
import { tpraApi, vendorRiskApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { PageLoader } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';

interface ReminderPolicy {
  enabled: boolean;
  remind_before_days: number;
  repeat_every_days: number;
  escalate_after_days: number;
  escalate_to: string[];
}

interface TierRules { template_ids: number[]; evidence: string[]; approver_role: string | null; reassess_on: string }

interface ConfigResp {
  weights: Record<string, number>;
  thresholds: Record<string, number>;
  cadence_days: Record<string, number>;
  reminder_policy: ReminderPolicy;
  scoring_policy?: { partial_credit: number };
  tier_policy?: Record<string, TierRules>;
  monitoring_policy?: { adverse_media?: boolean };
  defaults: {
    weights: Record<string, number>; thresholds: Record<string, number>; cadence_days: Record<string, number>;
    reminder_policy: ReminderPolicy; scoring_policy?: { partial_credit: number }; tier_policy?: Record<string, TierRules>;
  };
  meta: {
    factor_keys: string[]; factor_labels: Record<string, string>; tier_keys: string[]; cadence_keys: string[];
    evidence_kinds?: Record<string, string>; severities?: string[];
  };
}

const inputCls = 'w-24 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-50';
const TIER_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function VendorRiskSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:config:edit') || hasPermission('erm:risks:edit');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tprm-config'],
    queryFn: async () => (await tpraApi.getConfig()).data as ConfigResp,
    ...TPRM_QUERY_OPTS,
  });

  // Local editable form. Weights shown as percentages (normalized on save).
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [cadence, setCadence] = useState<Record<string, number>>({});
  const [reminders, setReminders] = useState<ReminderPolicy | null>(null);
  const [partialPct, setPartialPct] = useState<number | null>(null);
  const [tierPolicy, setTierPolicy] = useState<Record<string, TierRules> | null>(null);
  const [newsFeed, setNewsFeed] = useState(false);

  const { data: templates } = useQuery({
    queryKey: ['questionnaire-templates-for-tier-policy'],
    queryFn: async () => {
      const res = await vendorRiskApi.getTemplates({ limit: 200 });
      return ((Array.isArray(res.data) ? res.data : res.data?.items) || []) as Array<{ id: number; name: string }>;
    },
    ...TPRM_QUERY_OPTS,
  });
  const setTierRule = (tier: string, patch: Partial<TierRules>) =>
    setTierPolicy((prev) => (prev ? { ...prev, [tier]: { ...prev[tier], ...patch } } : prev));
  const toggle = (list: Array<string | number>, value: string | number) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const hydrate = (c: ConfigResp) => {
    setWeights(Object.fromEntries(c.meta.factor_keys.map((k) => [k, Math.round((c.weights[k] ?? 0) * 100)])));
    setThresholds({ ...c.thresholds });
    setCadence({ ...c.cadence_days });
    setReminders(c.reminder_policy ? { ...c.reminder_policy, escalate_to: [...(c.reminder_policy.escalate_to || [])] } : null);
    setPartialPct(c.scoring_policy ? Math.round(c.scoring_policy.partial_credit * 100) : null);
    setTierPolicy(c.tier_policy ? JSON.parse(JSON.stringify(c.tier_policy)) : null);
    setNewsFeed(!!c.monitoring_policy?.adverse_media);
  };
  useEffect(() => { if (data) hydrate(data); }, [data]);

  const save = useMutation({
    mutationFn: () => tpraApi.saveConfig({
      weights,           // percentages — backend normalizes to sum 1.0
      thresholds,
      cadence_days: cadence,
      ...(reminders ? { reminder_policy: reminders } : {}),
      ...(partialPct !== null ? { scoring_policy: { partial_credit: partialPct / 100 } } : {}),
      ...(tierPolicy ? { tier_policy: tierPolicy } : {}),
      monitoring_policy: { adverse_media: newsFeed },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tprm-config'] }); toast({ type: 'success', title: 'Settings saved', message: 'Tiering, scoring and the next reminder run use these values.' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errMsg(e, 'Try again.') }),
  });

  if (isLoading) return <div className="flex h-48 items-center justify-center"><PageLoader size="md" label="Loading settings…" /></div>;
  if (error || !data) {
    return (
      <div className="flex h-48 flex-col items-center justify-center text-red-500">
        <AlertCircle className="mb-2 h-7 w-7" /><p className="text-sm">Failed to load settings.</p>
        <button onClick={() => refetch()} className="mt-2 text-xs font-medium text-primary-600 hover:underline">Retry</button>
      </div>
    );
  }

  const weightSum = Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0);
  const thresholdsOk = thresholds.critical >= thresholds.high && thresholds.high >= thresholds.medium;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Settings className="h-5 w-5 text-slate-500" /> TPRM Settings</h1>
          <p className="text-sm text-gray-500">Tune the inherent-risk model, tier thresholds and reassessment cadence. New tiering &amp; scoring runs use these values.</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={() => data && hydrate({ ...data, weights: data.defaults.weights, thresholds: data.defaults.thresholds, cadence_days: data.defaults.cadence_days, reminder_policy: data.defaults.reminder_policy, scoring_policy: data.defaults.scoring_policy, tier_policy: data.defaults.tier_policy })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
              <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
            </button>
            <button onClick={() => save.mutate()} disabled={save.isPending || !thresholdsOk}
              title={!thresholdsOk ? 'Thresholds must be Critical ≥ High ≥ Medium' : 'Save settings'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </button>
          </div>
        )}
      </div>

      {!canEdit && (
        <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-700">You have read-only access — editing requires the <b>vendor_risk:config:edit</b> permission.</p>
      )}

      {/* Inherent-risk factor weights */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-1 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-slate-900">Inherent-risk factor weights</h3>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${Math.round(weightSum) === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>Total {Math.round(weightSum)}%</span>
        </div>
        <p className="mb-3 text-[11px] text-gray-500">How much each factor drives the inherent-risk score. Weights are normalized to 100% on save.</p>
        <div className="space-y-2">
          {data.meta.factor_keys.map((k) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-700">{data.meta.factor_labels[k] || k}</span>
              <div className="flex items-center gap-1.5">
                <input type="number" min={0} max={100} className={inputCls} disabled={!canEdit}
                  value={weights[k] ?? 0}
                  onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} />
                <span className="text-xs text-gray-400">%</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Tier thresholds */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-1 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-slate-900">Tier thresholds</h3>
          {!thresholdsOk && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600"><AlertCircle className="h-3 w-3" /> must be Critical ≥ High ≥ Medium</span>}
        </div>
        <p className="mb-3 text-[11px] text-gray-500">A 0–100 score at or above each threshold gets that tier (below Medium = Low). Drives assessment depth &amp; cadence.</p>
        <div className="space-y-2">
          {data.meta.tier_keys.map((k) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-700">{TIER_LABEL[k] || k}</span>
              <input type="number" min={0} max={100} className={inputCls} disabled={!canEdit}
                value={thresholds[k] ?? 0}
                onChange={(e) => setThresholds({ ...thresholds, [k]: Number(e.target.value) })} />
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 text-gray-400">
            <span className="text-sm">Low</span><span className="text-xs">below Medium</span>
          </div>
        </div>
      </section>

      {/* Reassessment cadence */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-1 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-slate-900">Reassessment cadence</h3>
        </div>
        <p className="mb-3 text-[11px] text-gray-500">How often each tier is re-assessed, in days.</p>
        <div className="space-y-2">
          {data.meta.cadence_keys.map((k) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-700">{TIER_LABEL[k] || k}</span>
              <div className="flex items-center gap-1.5">
                <input type="number" min={1} className={inputCls} disabled={!canEdit}
                  value={cadence[k] ?? 365}
                  onChange={(e) => setCadence({ ...cadence, [k]: Number(e.target.value) })} />
                <span className="text-xs text-gray-400">days</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Reminders & escalation */}
      {reminders && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-1 flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary-600" />
            <h3 className="text-sm font-semibold text-slate-900">Reminders &amp; escalation</h3>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" disabled={!canEdit} checked={reminders.enabled}
                onChange={(e) => setReminders({ ...reminders, enabled: e.target.checked })} />
              Send reminders
            </label>
          </div>
          <p className="mb-3 text-[11px] text-gray-500">
            Covers reassessments, questionnaires waiting on a vendor, remediation, risk acceptances and contracts.
            One notice when the window opens, then one per repeat period once overdue. An expired risk acceptance
            is marked expired and stops mitigating its finding.
          </p>
          <div className="space-y-2">
            {([
              ['remind_before_days', 'Remind this many days before a date'],
              ['repeat_every_days', 'Once overdue, remind every'],
              ['escalate_after_days', 'Escalate when this many days overdue'],
            ] as const).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-700">{label}</span>
                <div className="flex items-center gap-1.5">
                  <input type="number" min={key === 'repeat_every_days' ? 1 : 0} className={inputCls}
                    disabled={!canEdit || !reminders.enabled}
                    value={reminders[key]}
                    onChange={(e) => setReminders({ ...reminders, [key]: Number(e.target.value) })} />
                  <span className="text-xs text-gray-400">days</span>
                </div>
              </div>
            ))}
            <div>
              <label htmlFor="tprm-escalate-to" className="text-sm text-slate-700">Escalate to</label>
              <input id="tprm-escalate-to"
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50"
                disabled={!canEdit || !reminders.enabled}
                placeholder="role:Head of Third-Party Risk, user:12"
                value={reminders.escalate_to.join(', ')}
                onChange={(e) => setReminders({ ...reminders, escalate_to: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
              <p className="mt-0.5 text-[11px] text-gray-400">
                Each entry is <b>role:</b> followed by a role name, or <b>user:</b> followed by a user id.
                The owner is always told; these people are added once the escalation point passes.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* What each tier asks for */}
      {tierPolicy && data.meta.evidence_kinds && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-1 flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary-600" />
            <h3 className="text-sm font-semibold text-slate-900">What each tier asks for</h3>
          </div>
          <p className="mb-3 text-[11px] text-gray-500">
            A vendor&apos;s tier decides the questionnaires it answers, the evidence it must supply, who may approve it, and how
            serious a monitoring signal must be to reopen its assessment. Questionnaires left unchosen fall back to the
            built-in ones suggested for the tier.
          </p>
          <div className="space-y-3">
            {(['critical', 'high', 'medium', 'low'] as const).map((tier) => {
              const rules = tierPolicy[tier];
              if (!rules) return null;
              return (
                <fieldset key={tier} className="rounded-lg border border-gray-200 p-3" disabled={!canEdit}>
                  <legend className="px-1 text-xs font-semibold text-slate-800">{TIER_LABEL[tier]}</legend>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-medium text-gray-600">Questionnaires</p>
                      <div className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
                        {(templates || []).map((t) => (
                          <label key={t.id} className="flex items-center gap-1.5 text-xs text-slate-700">
                            <input type="checkbox" checked={rules.template_ids.includes(t.id)}
                              onChange={() => setTierRule(tier, { template_ids: toggle(rules.template_ids, t.id) as number[] })} />
                            {t.name}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium text-gray-600">Evidence</p>
                      <div className="mt-1 space-y-0.5">
                        {Object.entries(data.meta.evidence_kinds!).map(([kind, label]) => (
                          <label key={kind} className="flex items-start gap-1.5 text-xs text-slate-700">
                            <input type="checkbox" className="mt-0.5" checked={rules.evidence.includes(kind)}
                              onChange={() => setTierRule(tier, { evidence: toggle(rules.evidence, kind) as string[] })} />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>
                    <label className="text-[11px] font-medium text-gray-600">
                      Approved only by someone with the role
                      <input value={rules.approver_role || ''} placeholder="Anyone who may approve vendors"
                        onChange={(e) => setTierRule(tier, { approver_role: e.target.value || null })}
                        className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-normal disabled:bg-gray-50" />
                    </label>
                    <label className="text-[11px] font-medium text-gray-600">
                      A monitoring signal reopens the assessment from
                      <select value={rules.reassess_on} onChange={(e) => setTierRule(tier, { reassess_on: e.target.value })}
                        className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-normal capitalize disabled:bg-gray-50">
                        {(data.meta.severities || ['low', 'medium', 'high', 'critical']).map((sv) => (
                          <option key={sv} value={sv}>{sv} severity up (a breach always does)</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </fieldset>
              );
            })}
          </div>
        </section>
      )}

      {/* Outside-in monitoring feeds */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-1 flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-slate-900">Monitoring feeds</h3>
        </div>
        <p className="mb-3 text-[11px] text-gray-500">
          Certificates and reports on file that lapse are always watched. Each vendor is checked on its tier&apos;s
          cadence: critical daily, high weekly, medium monthly, low quarterly.
        </p>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" disabled={!canEdit} checked={newsFeed} onChange={(e) => setNewsFeed(e.target.checked)} />
          <span>
            Search the news for breaches and adverse media about each vendor
            <span className="block text-[11px] text-gray-500">
              Uses the GDELT Project&apos;s free news search; each vendor&apos;s name is sent to it. An alert counts as verified
              only when two publishers report it; until then it is shown but never emailed and never reopens an assessment.
            </span>
          </span>
        </label>
      </section>

      {/* Questionnaire scoring */}
      {partialPct !== null && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-1 flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary-600" />
            <h3 className="text-sm font-semibold text-slate-900">Questionnaire scoring</h3>
          </div>
          <p className="mb-3 text-[11px] text-gray-500">
            Yes counts in full and No counts nothing. This sets what a Partial answer is worth. It is fixed into a
            questionnaire when it is sent, so changing it here never rescores answers already given.
          </p>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="tprm-partial-credit" className="text-sm text-slate-700">A Partial answer is worth</label>
            <div className="flex items-center gap-1.5">
              <input id="tprm-partial-credit" type="number" min={0} max={100} className={inputCls} disabled={!canEdit}
                value={partialPct}
                onChange={(e) => setPartialPct(Math.max(0, Math.min(100, Number(e.target.value))))} />
              <span className="text-xs text-gray-400">% of a Yes</span>
            </div>
          </div>
        </section>
      )}

      <p className="text-[11px] text-gray-400">Integrations &amp; template defaults are managed elsewhere; questionnaire templates live under the Questionnaires tab.</p>
    </div>
  );
}
