'use client';

// Third-party risk settings. Every section starts closed and says in one line
// what it is set to now; open the ones you want. Edits are held on the page
// until saved, and only the sections that changed are sent.

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  AlertCircle, BellRing, CalendarClock, ChevronsDownUp, ChevronsUpDown, Coins, FileCheck2, Gauge, Layers, ListChecks,
  Loader2, Mail, MessageSquareText, Radar, Radio, Save, Search, Settings, SlidersHorizontal, TableProperties, type LucideIcon,
} from 'lucide-react';
import { tpraApi, vendorEmailsApi, vendorRiskApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { FieldsEditor, ListsEditor, liveFields, useModuleSettings } from '@/components/settings/CustomFields';
import ExposureSection, { exposureProblems, exposureSummary, type Quant } from './_Exposure';
import { EvidenceEditor, FactorsEditor, activeEvidence, type EvidenceDraft, type Named } from './_Lists';
import QuestionsEditor, {
  questionsProblems, questionsSummary, type BuiltinSection, type CustomQuestion, type QuestionsDraft,
} from './_Questions';
import { Help, Row, Section, TargetsPicker, TIERS, TIER_LABEL, Unit, fieldCls, inputCls, type Directory } from './_ui';

interface ReminderPolicy {
  enabled: boolean; remind_before_days: number; repeat_every_days: number; escalate_after_days: number;
  escalate_to: string[]; checkin_every_days?: number; contract_before_days?: number; contract_notify?: string[];
}
interface TierRules { template_ids: number[]; evidence: string[]; approver_role: string | null; reassess_on: string }
interface MonitoringPolicy {
  adverse_media: boolean; outside_in: boolean; check_every_days: Record<string, number>; scan_every_days: Record<string, number>;
  scan_points: Record<string, number>; scan_category_cap: number; grades: Record<string, number>;
}
interface Defaults {
  weights: Record<string, number>; thresholds: Record<string, number>; cadence_days: Record<string, number>;
  reminder_policy: ReminderPolicy; scoring_policy?: { partial_credit: number }; tier_policy?: Record<string, TierRules>;
  quantification?: Quant; monitoring_policy?: Partial<MonitoringPolicy>;
}
interface Customisation extends QuestionsDraft, EvidenceDraft { factors: Named[] }
interface ConfigResp extends Defaults {
  customisation?: Customisation;
  defaults: Defaults;
  meta: {
    factor_keys: string[]; factor_labels: Record<string, string>; tier_keys: string[]; cadence_keys: string[];
    evidence_kinds?: Record<string, string>; severities?: string[];
    builtin?: { sections: BuiltinSection[]; factors: Record<string, string>; evidence: Record<string, string> };
  };
}

// What the page edits, one entry per section that saves.
interface Draft {
  weights: Record<string, number>;            // percentages; the server normalises to 100
  thresholds: Record<string, number>;
  tier_policy: Record<string, TierRules>;
  cadence_days: Record<string, number>;
  reminder_policy: ReminderPolicy;
  monitoring_policy: Pick<MonitoringPolicy, 'adverse_media' | 'outside_in' | 'check_every_days' | 'scan_every_days'>;
  scan_scoring: Pick<MonitoringPolicy, 'scan_points' | 'scan_category_cap' | 'grades'>;   // sent within monitoring_policy
  scoring_policy: { partial_credit: number };
  quantification: Quant;
  custom_questions: QuestionsDraft;          // these three are sent together as `customisation`
  custom_factors: Named[];
  custom_evidence: EvidenceDraft;
}
type DraftKey = keyof Draft;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
function toDraft(c: ConfigResp, from: Defaults): Draft {
  return {
    weights: Object.fromEntries(c.meta.factor_keys.map((k) => [k, Math.round((from.weights[k] ?? 0) * 100)])),
    thresholds: { ...from.thresholds },
    tier_policy: clone(from.tier_policy || {}),
    cadence_days: { ...from.cadence_days },
    reminder_policy: { ...clone(from.reminder_policy), escalate_to: [...(from.reminder_policy.escalate_to || [])] },
    ...(() => {
      const m = { ...(c.defaults.monitoring_policy || {}), ...(from.monitoring_policy || {}) } as MonitoringPolicy;
      return {
        monitoring_policy: { adverse_media: !!m.adverse_media, outside_in: !!m.outside_in,
          check_every_days: { ...m.check_every_days }, scan_every_days: { ...m.scan_every_days } },
        scan_scoring: { scan_points: { ...m.scan_points }, scan_category_cap: m.scan_category_cap, grades: { ...m.grades } },
      };
    })(),
    scoring_policy: { partial_credit: from.scoring_policy?.partial_credit ?? 0.5 },
    quantification: clone((from.quantification || c.quantification) as Quant),
    // The defaults have none of the organisation's own questions, factors or evidence types.
    ...(() => {
      const cu = from === c ? c.customisation : undefined;
      return {
        custom_questions: { sections: clone(cu?.sections || []), builtin_sections: clone(cu?.builtin_sections || {}),
          builtin: clone(cu?.builtin || {}), questions: clone(cu?.questions || []) as CustomQuestion[] },
        custom_factors: clone(cu?.factors || []),
        custom_evidence: { evidence: clone(cu?.evidence || []), evidence_builtin: clone(cu?.evidence_builtin || {}) },
      };
    })(),
  };
}

const days = (d: number) => {
  if (!d) return '—';
  if (d % 365 === 0) return d === 365 ? 'every year' : `every ${d / 365} years`;
  if (d % 30 === 0 && d < 365) return d === 30 ? 'every month' : `every ${d / 30} months`;
  if (d % 7 === 0 && d < 60) return d === 7 ? 'every week' : `every ${d / 7} weeks`;
  return `every ${d} days`;
};
const errText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;

interface SectionDef {
  id: string; keys: DraftKey[]; title: string; icon: LucideIcon; keywords: string; summary: string; body: () => React.ReactNode;
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
  const { data: directory } = useQuery({
    queryKey: ['tprm-config-directory'],
    queryFn: async () => (await tpraApi.configDirectory()).data as Directory,
    ...TPRM_QUERY_OPTS,
  });
  const { data: templates } = useQuery({
    queryKey: ['questionnaire-templates-for-tier-policy'],
    queryFn: async () => {
      const res = await vendorRiskApi.getTemplates({ limit: 200 });
      return ((Array.isArray(res.data) ? res.data : res.data?.items) || []) as Array<{ id: number; name: string }>;
    },
    ...TPRM_QUERY_OPTS,
  });
  const { data: emails } = useQuery({
    queryKey: ['tprm-email-templates'],
    queryFn: async () => ((await vendorEmailsApi.list()).data?.items || []) as Array<{ key: string; label: string; changed: boolean }>,
    ...TPRM_QUERY_OPTS,
  });

  const { data: recordSettings } = useModuleSettings('vendors');
  const [recordPart, setRecordPart] = useState<'fields' | 'lists'>('fields');
  const saved = useMemo(() => (data ? toDraft(data, data) : null), [data]);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => { if (saved) setDraft(clone(saved)); }, [saved]);

  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [tierTab, setTierTab] = useState<string>('critical');

  // A link to #section opens that section.
  useEffect(() => {
    if (!data) return;
    const id = window.location.hash.slice(1);
    if (!id) return;
    setOpen(new Set([id]));
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }, [data]);

  const dirty = useMemo(() => (draft && saved
    ? (Object.keys(draft) as DraftKey[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(saved[k]))
    : []), [draft, saved]);

  useEffect(() => {
    if (!dirty.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty.length]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      const custom: Record<string, unknown> = {};
      dirty.forEach((k) => {
        if (k === 'custom_questions') Object.assign(custom, draft!.custom_questions);
        else if (k === 'custom_factors') custom.factors = draft!.custom_factors;
        else if (k === 'custom_evidence') Object.assign(custom, draft!.custom_evidence);
        else if (k === 'scan_scoring') body.monitoring_policy = { ...(body.monitoring_policy as object || {}), ...draft!.scan_scoring };
        else if (k === 'monitoring_policy') body.monitoring_policy = { ...(body.monitoring_policy as object || {}), ...draft!.monitoring_policy };
        else body[k] = draft![k];
      });
      if (Object.keys(custom).length) body.customisation = custom;
      return tpraApi.saveConfig(body as Parameters<typeof tpraApi.saveConfig>[0]);
    },
    onSuccess: () => {
      ['tprm-config', 'tprm-quant-history', 'tprm-exposure'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast({ type: 'success', title: 'Settings saved', message: 'Tiering, reminders, monitoring and exposure use the new values from now on.' });
    },
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errText(e, 'Try again.') }),
  });

  if (isLoading) return <div className="flex h-48 items-center justify-center"><PageLoader size="md" label="Loading settings…" /></div>;
  if (error || !data || !draft) {
    return (
      <div className="flex h-48 flex-col items-center justify-center text-rose-600">
        <AlertCircle className="mb-2 h-7 w-7" /><p className="text-sm">Could not load the settings.</p>
        <button onClick={() => refetch()} className="mt-2 text-xs font-medium text-primary-600 hover:underline">Try again</button>
      </div>
    );
  }

  const set = <K extends DraftKey>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const defaults = toDraft(data, data.defaults);
  const labels = data.meta.factor_labels;
  const w = draft.weights;
  const weightTotal = Object.values(w).reduce((a, b) => a + (Number(b) || 0), 0);
  const t = draft.thresholds;
  const r = draft.reminder_policy;
  const tp = draft.tier_policy;
  const setTierRule = (tier: string, patch: Partial<TierRules>) => set('tier_policy', { ...tp, [tier]: { ...tp[tier], ...patch } });
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const builtin = data.meta.builtin || { sections: [], factors: {}, evidence: data.meta.evidence_kinds || {} };
  const evidenceKinds = activeEvidence(builtin.evidence, draft.custom_evidence);
  const factorList = [
    ...Object.entries(builtin.factors).map(([key, label]) => ({ key, label })),
    ...draft.custom_factors.filter((f) => !f.archived).map((f) => ({ key: f.key, label: f.label })),
  ];
  const cq = draft.custom_questions;
  const liveQuestions = cq.questions.filter((q) => !q.archived);
  const factorsUsedBy: Record<string, string[]> = {};
  liveQuestions.forEach((q) => { if (q.factor) (factorsUsedBy[q.factor] ||= []).push(q.label); });
  const evidenceUsedBy: Record<string, string[]> = {};
  liveQuestions.forEach((q) => { if (q.evidence) (evidenceUsedBy[q.evidence] ||= []).push(`Question: ${q.label}`); });
  Object.entries(cq.builtin).forEach(([key, change]) => {
    if (change.evidence) {
      const q = builtin.sections.flatMap((sec) => sec.questions).find((x) => x.key === key);
      (evidenceUsedBy[change.evidence] ||= []).push(`Question: ${change.label || q?.label || key}`);
    }
  });
  TIERS.forEach((k) => (tp[k]?.evidence || []).forEach((kind) => (evidenceUsedBy[kind] ||= []).push(`${TIER_LABEL[k]} tier`)));
  const savedQuestionKeys = new Set((saved?.custom_questions.questions || []).map((q) => q.key));
  // Taking an evidence type out also takes it off every tier, so the tier policy stays valid.
  const setEvidence = (next: EvidenceDraft) => {
    const live = activeEvidence(builtin.evidence, next);
    const pruned = Object.fromEntries(Object.entries(tp).map(([k, rules]) => [k, { ...rules, evidence: rules.evidence.filter((e) => e in live) }]));
    setDraft((d) => (d ? { ...d, custom_evidence: next, ...(JSON.stringify(pruned) !== JSON.stringify(tp) ? { tier_policy: pruned } : {}) } : d));
  };

  const problems = [
    ...(t.critical >= t.high && t.high >= t.medium ? [] : ['Tier thresholds must go Critical ≥ High ≥ Medium']),
    ...(weightTotal > 0 ? [] : ['At least one risk factor needs a weight']),
    ...(r.repeat_every_days >= 1 ? [] : ['Overdue reminders must repeat at least every day']),
    ...exposureProblems(draft.quantification).map((p) => `Exposure model: ${p}`),
    ...questionsProblems(cq).map((p) => `Onboarding questions: ${p}`),
    ...(draft.custom_factors.some((f) => !f.archived && !f.label.trim()) ? ['Every factor needs a name'] : []),
    ...(draft.custom_evidence.evidence.some((e) => !e.archived && !e.label.trim()) ? ['Every evidence type needs a name'] : []),
    ...(() => {
      const pts = draft.scan_scoring.scan_points;
      const g = draft.scan_scoring.grades;
      return [
        ...(pts.critical >= pts.high && pts.high >= pts.medium && pts.medium >= pts.low ? []
          : ['Scan scoring: a more severe finding must take off at least as many points']),
        ...(g.A > g.B && g.B > g.C && g.C > g.D ? [] : ['Scan scoring: each grade must start above the next']),
      ];
    })(),
  ];

  const sections: Array<{ group: string; items: SectionDef[] }> = [
    { group: 'How suppliers are tiered', items: [
      {
        id: 'questions', keys: ['custom_questions'], icon: MessageSquareText, title: 'Onboarding questions',
        keywords: 'onboarding intake request questions form section type yes no choice evidence factor add custom',
        summary: questionsSummary(cq, builtin.sections),
        body: () => (
          <QuestionsEditor value={cq} onChange={(next) => set('custom_questions', next)} builtin={builtin.sections}
            factors={factorList} evidence={evidenceKinds} savedKeys={savedQuestionKeys} canEdit={canEdit} />
        ),
      },
      {
        id: 'factors', keys: ['weights', 'custom_factors'], icon: SlidersHorizontal, title: 'Risk factors and their weights',
        keywords: 'inherent risk factor weight data sensitivity criticality access regulatory fourth party add custom',
        summary: [...factorList].sort((a, b) => (w[b.key] || 0) - (w[a.key] || 0)).slice(0, 3)
          .map((f) => `${f.label} ${w[f.key] || 0}%`).join(' · ') + (factorList.length > 3 ? ` · ${factorList.length - 3} more` : ''),
        body: () => (
          <>
            <Help>
              A supplier’s inherent risk (0 to 100) adds up its factors, each scored 0 to 4 from the onboarding answers, in these
              proportions. Add factors of your own and give onboarding questions points for them. Weights are scaled to add up
              to 100% when saved.
            </Help>
            <FactorsEditor builtinLabels={builtin.factors} weights={w} custom={draft.custom_factors} usedBy={factorsUsedBy}
              canEdit={canEdit} onWeights={(next) => set('weights', next)}
              onFactors={(f, next) => setDraft((d) => (d ? { ...d, custom_factors: f, weights: next } : d))} />
          </>
        ),
      },
      {
        id: 'thresholds', keys: ['thresholds'], icon: Gauge, title: 'Where each tier starts',
        keywords: 'tier threshold score critical high medium low',
        summary: `Critical from ${t.critical} · High from ${t.high} · Medium from ${t.medium} · Low below ${t.medium}`,
        body: () => (
          <>
            <Help>An inherent risk score at or above a threshold gets that tier. Below Medium is Low.</Help>
            {(['critical', 'high', 'medium'] as const).map((k) => (
              <Row key={k} label={`${TIER_LABEL[k]} from a score of`} htmlFor={`t-${k}`}>
                <input id={`t-${k}`} type="number" min={0} max={100} className={inputCls} disabled={!canEdit} value={t[k] ?? 0}
                  onChange={(e) => set('thresholds', { ...t, [k]: Number(e.target.value) })} />
                <Unit>/ 100</Unit>
              </Row>
            ))}
            {!(t.critical >= t.high && t.high >= t.medium) && (
              <p className="mt-1 flex items-center gap-1 text-xs text-rose-600"><AlertCircle className="h-3.5 w-3.5" /> Critical must be at least High, and High at least Medium.</p>
            )}
          </>
        ),
      },
      {
        id: 'evidence-types', keys: ['custom_evidence'], icon: FileCheck2, title: 'Evidence types',
        keywords: 'evidence types documents certificate report add custom hide',
        summary: `${Object.keys(evidenceKinds).length} in use`
          + (draft.custom_evidence.evidence.filter((e) => !e.archived).length ? ` · ${draft.custom_evidence.evidence.filter((e) => !e.archived).length} of your own` : '')
          + (Object.values(draft.custom_evidence.evidence_builtin).filter((e) => e.hidden).length
            ? ` · ${Object.values(draft.custom_evidence.evidence_builtin).filter((e) => e.hidden).length} built-in hidden` : ''),
        body: () => (
          <EvidenceEditor builtin={builtin.evidence} value={draft.custom_evidence} usedBy={evidenceUsedBy} canEdit={canEdit} onChange={setEvidence} />
        ),
      },
      {
        id: 'tier-asks', keys: ['tier_policy'], icon: Layers, title: 'What each tier asks for',
        keywords: 'questionnaire evidence approver role reassess signal tier policy',
        summary: TIERS.map((k) => `${TIER_LABEL[k]}: ${(tp[k]?.evidence || []).length} evidence`).join(' · '),
        body: () => {
          const rules = tp[tierTab];
          return (
            <>
              <Help>
                A supplier’s tier decides the questionnaires it answers, the evidence it must supply, who may approve it, and how
                serious a monitoring alert must be to reopen its assessment. Questionnaires left unchosen fall back to the
                built-in ones suggested for the tier.
              </Help>
              <div role="tablist" aria-label="Tier" className="mb-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                {TIERS.map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={tierTab === k} onClick={() => setTierTab(k)}
                    className={clsx('rounded-md px-3 py-1 text-sm font-medium', tierTab === k ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800')}>
                    {TIER_LABEL[k]}
                  </button>
                ))}
              </div>
              {rules && (
                <fieldset className="grid gap-4 md:grid-cols-2" disabled={!canEdit} role="tabpanel" aria-label={`${TIER_LABEL[tierTab]} tier`}>
                  <div>
                    <p className="text-xs font-medium text-slate-600">Questionnaires it answers</p>
                    <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                      {(templates || []).length === 0 && <p className="text-xs text-slate-400">No questionnaire templates yet.</p>}
                      {(templates || []).map((tpl) => (
                        <label key={tpl.id} className="flex items-center gap-2 text-xs text-slate-700">
                          <input type="checkbox" checked={rules.template_ids.includes(tpl.id)}
                            onChange={() => setTierRule(tierTab, { template_ids: toggle(rules.template_ids, tpl.id) })} />
                          {tpl.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-600">Evidence it must supply</p>
                    <div className="mt-1 space-y-1 rounded-lg border border-slate-200 p-2">
                      {Object.entries(evidenceKinds).map(([kind, label]) => (
                        <label key={kind} className="flex items-start gap-2 text-xs text-slate-700">
                          <input type="checkbox" className="mt-0.5" checked={rules.evidence.includes(kind)}
                            onChange={() => setTierRule(tierTab, { evidence: toggle(rules.evidence, kind) })} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="text-xs font-medium text-slate-600">
                    Approved only by someone with the role
                    <select value={rules.approver_role || ''} onChange={(e) => setTierRule(tierTab, { approver_role: e.target.value || null })}
                      className={clsx(fieldCls, 'mt-1 font-normal')}>
                      <option value="">Anyone who may approve suppliers</option>
                      {rules.approver_role && !(directory?.roles || []).includes(rules.approver_role) && (
                        <option value={rules.approver_role}>{rules.approver_role} (no such role now)</option>
                      )}
                      {(directory?.roles || []).map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    A monitoring alert reopens the assessment from
                    <select value={rules.reassess_on} onChange={(e) => setTierRule(tierTab, { reassess_on: e.target.value })}
                      className={clsx(fieldCls, 'mt-1 font-normal')}>
                      {(data.meta.severities || ['low', 'medium', 'high', 'critical']).map((sv) => (
                        <option key={sv} value={sv}>{sv.charAt(0).toUpperCase() + sv.slice(1)} severity and above</option>
                      ))}
                    </select>
                    <span className="mt-0.5 block font-normal text-slate-400">A reported breach always does.</span>
                  </label>
                </fieldset>
              )}
            </>
          );
        },
      },
    ] },
    { group: 'Reviews, reminders and emails', items: [
      {
        id: 'cadence', keys: ['cadence_days'], icon: CalendarClock, title: 'How often each tier is reassessed',
        keywords: 'reassessment cadence days review frequency',
        summary: TIERS.map((k) => `${TIER_LABEL[k]} ${days(draft.cadence_days[k])}`).join(' · '),
        body: () => (
          <>
            <Help>The time from one approved assessment to the next, by tier.</Help>
            {TIERS.map((k) => (
              <Row key={k} label={TIER_LABEL[k]} htmlFor={`c-${k}`} help={days(draft.cadence_days[k])}>
                <input id={`c-${k}`} type="number" min={1} className={inputCls} disabled={!canEdit} value={draft.cadence_days[k] ?? 365}
                  onChange={(e) => set('cadence_days', { ...draft.cadence_days, [k]: Number(e.target.value) })} />
                <Unit>days</Unit>
              </Row>
            ))}
          </>
        ),
      },
      {
        id: 'reminders', keys: ['reminder_policy'], icon: BellRing, title: 'Reminders and escalation',
        keywords: 'reminder escalation overdue check-in contract notify email',
        summary: r.enabled
          ? `On · ${r.remind_before_days} days before · then every ${r.repeat_every_days} days · escalated after ${r.escalate_after_days} days overdue`
          : 'Off: no reminders are sent',
        body: () => {
          const off = !canEdit || !r.enabled;
          const setR = (patch: Partial<ReminderPolicy>) => set('reminder_policy', { ...r, ...patch });
          return (
            <>
              <label className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800">
                <input type="checkbox" disabled={!canEdit} checked={r.enabled} onChange={(e) => setR({ enabled: e.target.checked })} />
                Send reminders
              </label>
              <Help>
                Covers reassessments, questionnaires waiting on a supplier, remediation, risk acceptances, contracts and
                stakeholders’ yearly check-ins: one notice when the window opens, then one per repeat period once overdue. An
                expired risk acceptance is marked expired and stops mitigating its finding.
              </Help>
              <Row label="Remind this many days before a date" htmlFor="r-before">
                <input id="r-before" type="number" min={0} className={inputCls} disabled={off} value={r.remind_before_days}
                  onChange={(e) => setR({ remind_before_days: Number(e.target.value) })} /><Unit>days</Unit>
              </Row>
              <Row label="Once overdue, remind every" htmlFor="r-repeat">
                <input id="r-repeat" type="number" min={1} className={inputCls} disabled={off} value={r.repeat_every_days}
                  onChange={(e) => setR({ repeat_every_days: Number(e.target.value) })} /><Unit>days</Unit>
              </Row>
              <Row label="Escalate when this many days overdue" htmlFor="r-escalate">
                <input id="r-escalate" type="number" min={0} className={inputCls} disabled={off} value={r.escalate_after_days}
                  onChange={(e) => setR({ escalate_after_days: Number(e.target.value) })} /><Unit>days</Unit>
              </Row>
              <div className="py-1.5">
                <p className="text-sm text-slate-700">Escalate to</p>
                <p className="mb-1.5 text-[11px] text-slate-500">The owner is always told; these roles and people are added once the escalation point passes.</p>
                <TargetsPicker value={r.escalate_to} onChange={(v) => setR({ escalate_to: v })} directory={directory} disabled={off} />
              </div>
              <div className="mt-2 border-t border-slate-100 pt-2">
                <Row label="Stakeholders check in on each supplier every" htmlFor="r-checkin" help={days(r.checkin_every_days ?? 365)}>
                  <input id="r-checkin" type="number" min={30} className={inputCls} disabled={off} value={r.checkin_every_days ?? 365}
                    onChange={(e) => setR({ checkin_every_days: Number(e.target.value) })} /><Unit>days</Unit>
                </Row>
                <Row label="Start contract reminders this many days before the last day to give notice" htmlFor="r-contract">
                  <input id="r-contract" type="number" min={0} className={inputCls} disabled={off} value={r.contract_before_days ?? 30}
                    onChange={(e) => setR({ contract_before_days: Number(e.target.value) })} /><Unit>days</Unit>
                </Row>
                <div className="py-1.5">
                  <p className="text-sm text-slate-700">Also tell about contracts</p>
                  <p className="mb-1.5 text-[11px] text-slate-500">
                    The supplier’s owner always hears when a contract needs a decision. A contract past its notice date is repeated
                    on the same rhythm until its renewal is recorded or it is closed out.
                  </p>
                  <TargetsPicker value={r.contract_notify || []} onChange={(v) => setR({ contract_notify: v })} directory={directory} disabled={off} />
                </div>
              </div>
            </>
          );
        },
      },
      {
        id: 'emails', keys: [], icon: Mail, title: 'Emails we send',
        keywords: 'email wording template invitation reminder escalation assigned',
        summary: emails
          ? `${emails.length} emails · ${emails.filter((e) => e.changed).length ? `${emails.filter((e) => e.changed).length} in your own words` : 'all in the built-in wording'}`
          : 'The invitation, reminders, escalation and assignment emails',
        body: () => (
          <>
            <Help>Change the subject and wording of each email, see it with sample values, and send yourself a test.</Help>
            <ul className="mb-3 space-y-1 text-sm text-slate-700">
              {(emails || []).map((e) => (
                <li key={e.key} className="flex items-center justify-between gap-2">
                  {e.label}
                  <span className={clsx('text-[11px]', e.changed ? 'text-primary-700' : 'text-slate-400')}>{e.changed ? 'Your wording' : 'Built-in wording'}</span>
                </li>
              ))}
            </ul>
            <Link href="/vendor-risk/settings/emails" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Mail className="h-4 w-4" /> Edit the emails
            </Link>
          </>
        ),
      },
    ] },
    { group: 'Monitoring', items: [
      {
        id: 'monitoring', keys: ['monitoring_policy'], icon: Radio, title: 'Monitoring feeds',
        keywords: 'monitoring news adverse media breach outside-in scan domains gdelt shodan',
        summary: `News search ${draft.monitoring_policy.adverse_media ? 'on' : 'off'} · Scanning from outside ${draft.monitoring_policy.outside_in ? 'on' : 'off'} · Lapsing certificates always watched`,
        body: () => {
          const m = draft.monitoring_policy;
          const cadenceRow = (field: 'check_every_days' | 'scan_every_days', tier: string, max: number) => (
            <label key={tier} className="block rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
              {TIER_LABEL[tier]}
              <span className="mt-1 flex items-center gap-1">
                <input type="number" min={1} max={max} disabled={!canEdit} value={m[field][tier] ?? ''}
                  aria-label={`${TIER_LABEL[tier]} supplier: days between ${field === 'check_every_days' ? 'checks' : 'scans'}`}
                  onChange={(e) => set('monitoring_policy', { ...m, [field]: { ...m[field], [tier]: Number(e.target.value) } })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-right text-sm tabular-nums disabled:bg-slate-50" />
                <span className="text-slate-400">days</span>
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-400">{days(m[field][tier])}</span>
            </label>
          );
          return (
            <>
              <Help>Certificates and reports on file that lapse are always watched, on the cadence below.</Help>
              <div className="mb-3 rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium text-slate-800">How often each supplier is checked</p>
                <p className="mb-2 text-[11px] text-slate-500">Lapsed certificates and, when it is on, the news search, by the supplier’s tier.</p>
                <div className="grid gap-2 sm:grid-cols-4">{TIERS.map((k) => cadenceRow('check_every_days', k, 365))}</div>
              </div>
              <div className="mb-3 rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium text-slate-800">How often each supplier is scanned from outside</p>
                <p className="mb-2 text-[11px] text-slate-500">The outside-in scan and any connected ratings service, by the supplier’s tier.</p>
                <div className="grid gap-2 sm:grid-cols-4">{TIERS.map((k) => cadenceRow('scan_every_days', k, 730))}</div>
              </div>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                <input type="checkbox" className="mt-1" disabled={!canEdit} checked={m.adverse_media}
                  onChange={(e) => set('monitoring_policy', { ...m, adverse_media: e.target.checked })} />
                <span>
                  Search the news for breaches and adverse media about each supplier
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    Uses the GDELT Project’s free news search; each supplier’s name is sent to it. An alert counts as verified only when
                    two publishers report it; until then it is shown but never emailed and never reopens an assessment.
                  </span>
                </span>
              </label>
              <label className="mt-2 flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                <input type="checkbox" className="mt-1" disabled={!canEdit} checked={m.outside_in}
                  onChange={(e) => set('monitoring_policy', { ...m, outside_in: e.target.checked })} />
                <span>
                  Scan each supplier’s websites and domains from outside
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    Looks at what any visitor sees: certificates, HTTPS and protective headers, and email spoofing protection, plus
                    exposed services and known vulnerabilities when a Shodan key is connected. Nothing is port-scanned. A supplier’s
                    first scan sets its baseline; after that a new high or critical finding raises an alert.
                  </span>
                </span>
              </label>
            </>
          );
        },
      },
    ] },
    { group: 'Security ratings', items: [
      {
        id: 'scan-scoring', keys: ['scan_scoring'], icon: Radar, title: 'How an outside-in scan is scored',
        keywords: 'security rating score grade points severity category cap outside-in scan',
        summary: `A from ${draft.scan_scoring.grades.A}, B ${draft.scan_scoring.grades.B}, C ${draft.scan_scoring.grades.C}, D ${draft.scan_scoring.grades.D} · a critical finding takes off ${draft.scan_scoring.scan_points.critical}`,
        body: () => {
          const sc = draft.scan_scoring;
          const numIn = (value: number, onChange: (n: number) => void, label: string) => (
            <input type="number" min={0} max={100} disabled={!canEdit} value={value} aria-label={label}
              onChange={(e) => onChange(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-right text-sm tabular-nums disabled:bg-slate-50" />
          );
          return (
            <>
              <Help>
                A supplier’s score starts at 100. Each weakness a scan finds takes off its severity’s points, once however many
                of the supplier’s hosts share it, and no one category can take off more than the cap. A waived finding does not
                count until its waiver ends. The grade follows from the score.
              </Help>
              <div className="mb-3 rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-sm font-medium text-slate-800">Points a finding takes off, by severity</p>
                <div className="grid gap-2 sm:grid-cols-4">
                  {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
                    <label key={sev} className="block rounded-lg bg-slate-50 p-2 text-xs capitalize text-slate-600">
                      {sev}
                      <span className="mt-1 block">{numIn(sc.scan_points[sev], (n) => set('scan_scoring', { ...sc, scan_points: { ...sc.scan_points, [sev]: n } }), `Points for a ${sev} finding`)}</span>
                    </label>
                  ))}
                </div>
                <Row label="The most one category (for example email protection) can take off" htmlFor="scan-cap">
                  <input id="scan-cap" type="number" min={1} max={100} className={inputCls} disabled={!canEdit} value={sc.scan_category_cap}
                    onChange={(e) => set('scan_scoring', { ...sc, scan_category_cap: Number(e.target.value) })} />
                  <Unit>points</Unit>
                </Row>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-sm font-medium text-slate-800">Where each grade starts</p>
                <div className="grid gap-2 sm:grid-cols-5">
                  {(['A', 'B', 'C', 'D'] as const).map((g) => (
                    <label key={g} className="block rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                      Grade {g} from
                      <span className="mt-1 block">{numIn(sc.grades[g], (n) => set('scan_scoring', { ...sc, grades: { ...sc.grades, [g]: n } }), `Score where grade ${g} starts`)}</span>
                    </label>
                  ))}
                  <p className="flex items-center rounded-lg bg-slate-50 p-2 text-xs text-slate-500">F below {sc.grades.D}</p>
                </div>
              </div>
            </>
          );
        },
      },
    ] },
    { group: 'Supplier records', items: [
      {
        id: 'record', keys: [], icon: TableProperties, title: 'Fields and dropdown lists on a supplier',
        keywords: 'custom fields supplier record form dropdown list supplier type industry questionnaire category document type',
        summary: recordSettings
          ? `${liveFields(recordSettings).length} fields of your own · lists for ${Object.values(recordSettings.lists || {}).map((l) => l.label.toLowerCase()).join(', ')}`
          : 'Your own fields on the supplier form, and the choices in its dropdowns',
        body: () => (
          <>
            <Help>
              Fields of your own appear on the Add supplier form (under Custom fields) and on each supplier’s Overview. The
              lists are the choices offered for supplier type, industry, questionnaire category and supplier document type.
              This section saves with its own button; taking a field or an option out keeps what suppliers already hold.
            </Help>
            {recordSettings ? (
              <>
                <div className="mb-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="Fields or lists">
                  {(['fields', 'lists'] as const).map((part) => (
                    <button key={part} type="button" role="tab" aria-selected={recordPart === part} onClick={() => setRecordPart(part)}
                      className={clsx('rounded-md px-3 py-1 text-sm font-medium', recordPart === part ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800')}>
                      {part === 'fields' ? 'Your fields' : 'Dropdown lists'}
                    </button>
                  ))}
                </div>
                {!canEdit ? <p className="text-xs text-slate-500">Changing these needs the vendor_risk:config:edit permission.</p>
                  : recordPart === 'fields' ? <FieldsEditor moduleKey="vendors" settings={recordSettings} />
                    : <ListsEditor moduleKey="vendors" settings={recordSettings} />}
              </>
            ) : <p className="text-xs text-slate-500">Loading…</p>}
          </>
        ),
      },
    ] },
    { group: 'Questionnaires', items: [
      {
        id: 'scoring', keys: ['scoring_policy'], icon: ListChecks, title: 'Questionnaire scoring',
        keywords: 'questionnaire scoring partial credit answer',
        summary: `A Partial answer is worth ${Math.round(draft.scoring_policy.partial_credit * 100)}% of a Yes`,
        body: () => (
          <>
            <Help>
              Yes counts in full and No counts nothing; this sets what a Partial answer is worth. It is fixed into a questionnaire
              when it is sent, so a change here never rescores answers already given.
            </Help>
            <Row label="A Partial answer is worth" htmlFor="s-partial">
              <input id="s-partial" type="number" min={0} max={100} className={inputCls} disabled={!canEdit}
                value={Math.round(draft.scoring_policy.partial_credit * 100)}
                onChange={(e) => set('scoring_policy', { partial_credit: Math.max(0, Math.min(100, Number(e.target.value))) / 100 })} />
              <span className="text-xs text-slate-400">% of a Yes</span>
            </Row>
          </>
        ),
      },
    ] },
    { group: 'Money at risk', items: [
      {
        id: 'exposure', keys: ['quantification'], icon: Coins, title: 'Exposure model',
        keywords: 'exposure model money cost currency incidents outages records range comply analysis',
        summary: exposureSummary(draft.quantification),
        body: () => <ExposureSection value={draft.quantification} onChange={(q) => set('quantification', q)} canEdit={canEdit} />,
      },
    ] },
  ];

  const q = query.trim().toLowerCase();
  const shown = sections
    .map((g) => ({ ...g, items: g.items.filter((s) => !q || `${s.title} ${s.summary} ${s.keywords}`.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length);
  const all = sections.flatMap((g) => g.items.map((s) => s.id));
  const isOpen = (id: string) => !!q || open.has(id);
  const toggleOpen = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const changedSections = sections.flatMap((g) => g.items).filter((sd) => sd.keys.some((k) => dirty.includes(k))).map((sd) => sd.title);

  return (
    <div className="max-w-4xl space-y-5 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Settings className="h-5 w-5 text-slate-500" /> Third-party risk settings</h1>
          <p className="text-sm text-slate-500">Open a section to see and change it. Nothing changes until you save.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Find a setting</span>
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a setting"
              className="w-48 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100" />
          </label>
          <button type="button" onClick={() => setOpen(new Set(all))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <ChevronsUpDown className="h-3.5 w-3.5" /> Open all
          </button>
          <button type="button" onClick={() => setOpen(new Set())}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <ChevronsDownUp className="h-3.5 w-3.5" /> Close all
          </button>
        </div>
      </div>

      {!canEdit && (
        <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">You can look but not change: editing needs the <b>vendor_risk:config:edit</b> permission.</p>
      )}

      {shown.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No setting matches “{query}”.</p>}

      {shown.map((g) => (
        <div key={g.group}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.group}</h2>
          <div className="space-y-2">
            {g.items.map((s) => (
              <Section key={s.id} id={s.id} icon={s.icon} title={s.title} summary={s.summary}
                open={isOpen(s.id)} onToggle={() => toggleOpen(s.id)} dirty={s.keys.some((k) => dirty.includes(k))}
                onDefaults={canEdit && s.keys.length
                  ? () => setDraft((d) => (d ? { ...d, ...Object.fromEntries(s.keys.map((k) => [k, clone(defaults[k])])) } : d))
                  : undefined}>
                {s.body()}
              </Section>
            ))}
          </div>
        </div>
      ))}

      <p className="text-xs text-slate-400">
        Questionnaire templates are under <Link href="/vendor-risk/questionnaires" className="text-primary-700 hover:underline">Questionnaires</Link>;
        connections to rating, discovery and gateway services under <Link href="/admin/connectors" className="text-primary-700 hover:underline">Admin → Connectors</Link>.
      </p>

      {canEdit && dirty.length > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur" role="region" aria-label="Unsaved changes">
          <div className="min-w-0 text-sm">
            <p className="font-medium text-slate-900">Unsaved changes in {changedSections.join(', ')}</p>
            {problems.length > 0 && <p className="mt-0.5 flex items-center gap-1 text-xs text-rose-600"><AlertCircle className="h-3.5 w-3.5 shrink-0" /> {problems[0]}{problems.length > 1 && ` (and ${problems.length - 1} more)`}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => saved && setDraft(clone(saved))}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Discard</button>
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending || problems.length > 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
