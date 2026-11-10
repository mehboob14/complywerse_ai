'use client';

// Settings > Tiering: how a supplier is tiered at onboarding. Four parts that open in place: the onboarding questions (the editor is _Questions.tsx, the questionnaire group's until it moves to
// Questionnaires > Tiering), the risk factors and their weights, the evidence types, and what each tier asks for (its questionnaires and its evidence). Where each tier STARTS and who approves it are
// the Policy page's; a line says so. Nothing is saved until the section's Save is used.
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AccordionRow, Checkbox, Notice, SegmentedControl } from '@/components/ui/ds';
import { vendorRiskApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import { Help, TIERS, TIER_LABEL } from '../_ui';
import QuestionsEditor, { questionsSummary } from '../_Questions';
import { EvidenceEditor, FactorsEditor } from '../_Lists';
import { activeEvidence, type TierRules } from '../settingsModel';
import { DefaultsButton, NEEDS_RIGHT, UnsavedPill, type SettingsCtx } from './shared';
import { useId, useState } from 'react';

const BOX = 'overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface px-[12px]';
const FIELDSET = 'min-w-0 rounded-ds-control border border-ds-border p-[12px]';

export const TIERING_PARTS = ['questions', 'factors', 'evidence-types', 'tier-asks'] as const;
export type TieringPart = (typeof TIERING_PARTS)[number];

export default function TieringSection({ ctx, open, onOpen }: { ctx: SettingsCtx; open: ReadonlySet<string>; onOpen: (part: string, on: boolean) => void }) {
  const { data, draft, saved, canEdit, directory, set, setMany, dirty } = ctx;
  const uid = useId();
  const [tierTab, setTierTab] = useState<string>('critical');
  const templates = useQuery({
    queryKey: ['questionnaire-templates-for-tier-policy'],
    queryFn: async () => {
      const res = await vendorRiskApi.getTemplates({ limit: 500 });
      const list = (Array.isArray(res.data) ? res.data : res.data?.items) as Array<{ id: number; name: string }> | undefined;
      return { items: list ?? [], total: Array.isArray(res.data) ? (list ?? []).length : Number(res.data?.total ?? (list ?? []).length) };
    },
    ...TPRM_QUERY_OPTS,
  });

  const builtin = data.meta.builtin || { sections: [], factors: {}, evidence: data.meta.evidence_kinds || {} };
  const evidenceKinds = activeEvidence(builtin.evidence, draft.custom_evidence);
  const w = draft.weights;
  const tp = draft.tier_policy;
  const cq = draft.custom_questions;
  const factorList = [
    ...Object.entries(builtin.factors).map(([key, label]) => ({ key, label })),
    ...draft.custom_factors.filter((f) => !f.archived).map((f) => ({ key: f.key, label: f.label })),
  ];
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
  const savedQuestionKeys = new Set(saved.custom_questions.questions.map((q) => q.key));
  // Taking an evidence type out also takes it off every tier, so the tier policy stays valid.
  const setEvidence = (next: typeof draft.custom_evidence) => {
    const live = activeEvidence(builtin.evidence, next);
    const pruned = Object.fromEntries(Object.entries(tp).map(([k, rules]) => [k, { ...rules, evidence: rules.evidence.filter((e) => e in live) }])) as Record<string, TierRules>;
    setMany({ custom_evidence: next, ...(JSON.stringify(pruned) !== JSON.stringify(tp) ? { tier_policy: pruned } : {}) });
  };
  const setTierRule = (tier: string, patch: Partial<TierRules>) => set('tier_policy', { ...tp, [tier]: { ...tp[tier], ...patch } });
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const changed = (...keys: Array<keyof typeof draft>) => keys.some((k) => dirty.includes(k));
  const ownEvidence = draft.custom_evidence.evidence.filter((e) => !e.archived).length;
  const hiddenEvidence = Object.values(draft.custom_evidence.evidence_builtin).filter((e) => e.hidden).length;
  const topFactors = [...factorList].sort((a, b) => (w[b.key] || 0) - (w[a.key] || 0)).slice(0, 3).map((f) => `${f.label} ${w[f.key] || 0}%`).join(' · ') + (factorList.length > 3 ? ` · ${factorList.length - 3} more` : '');
  const rules = tp[tierTab];

  const row = (id: TieringPart, title: string, summary: string, keys: Array<keyof typeof draft>, body: React.ReactNode) => (
    <div id={id} className="scroll-mt-[64px]">
      <AccordionRow title={title} meta={summary} open={open.has(id)} onOpenChange={(on) => onOpen(id, on)} region={false} trailing={changed(...keys) ? <UnsavedPill /> : undefined}>
        {body}
        {canEdit && <div className="mt-[12px] flex justify-end"><DefaultsButton ctx={ctx} keys={keys} /></div>}
      </AccordionRow>
    </div>
  );

  return (
    <div className="flex flex-col gap-[12px]">
      <p className="text-ds-body text-ds-fg-muted">
        Where each tier starts, how often it is reviewed and who approves it are set on the <Link href="/vendor-risk/policy#bands" className="font-[500] text-ds-primary-text underline">Policy</Link> page.
      </p>
      <div className={BOX}>
        {row('questions', 'Onboarding questions', questionsSummary(cq, builtin.sections), ['custom_questions'], (
          <QuestionsEditor value={cq} onChange={(next) => set('custom_questions', next)} builtin={builtin.sections} factors={factorList} evidence={evidenceKinds}
            savedKeys={savedQuestionKeys} canEdit={canEdit} roles={directory?.roles || []} />
        ))}
        {row('factors', 'Risk factors and their weights', topFactors, ['weights', 'custom_factors'], (
          <>
            <Help>
              A supplier’s inherent risk (0 to 100) adds up its factors, each scored 0 to 4 from the onboarding answers, in these proportions. Add factors of your own and give onboarding questions points
              for them. Weights are scaled to add up to 100% when saved.
            </Help>
            <FactorsEditor builtinLabels={builtin.factors} weights={w} custom={draft.custom_factors} usedBy={factorsUsedBy} canEdit={canEdit}
              onWeights={(next) => set('weights', next)} onFactors={(f, next) => setMany({ custom_factors: f, weights: next })} />
          </>
        ))}
        {row('evidence-types', 'Evidence types', `${Object.keys(evidenceKinds).length} in use${ownEvidence ? ` · ${ownEvidence} of your own` : ''}${hiddenEvidence ? ` · ${hiddenEvidence} built-in hidden` : ''}`, ['custom_evidence'], (
          <EvidenceEditor builtin={builtin.evidence} value={draft.custom_evidence} usedBy={evidenceUsedBy} canEdit={canEdit} onChange={setEvidence} />
        ))}
        {row('tier-asks', 'What each tier asks for', TIERS.map((k) => `${TIER_LABEL[k]}: ${(tp[k]?.evidence || []).length} evidence`).join(' · '), ['tier_policy'], (
          <>
            <Help>
              A supplier’s tier decides the questionnaires it answers and the evidence it must supply. Questionnaires left unchosen fall back to the built-in ones suggested for the tier. Who approves, and when
              an alert reopens an assessment, are on the <Link href="/vendor-risk/policy#approvals" className="font-[500] text-ds-primary-text underline">Policy</Link> page.
            </Help>
            <div className="mb-[12px]">
              <SegmentedControl label="Tier" name={`${uid}-tier`} options={TIERS.map((k) => ({ value: k, label: TIER_LABEL[k] }))} value={tierTab} onChange={setTierTab} />
            </div>
            {rules && (
              <div className="grid gap-[12px] md:grid-cols-2">
                <fieldset disabled={!canEdit} className={FIELDSET}>
                  <legend className="px-[4px] text-ds-body font-[600] text-ds-fg">Questionnaires it answers</legend>
                  {templates.isLoading && <p className="text-ds-label text-ds-fg-muted">Loading the questionnaires…</p>}
                  {templates.isError && (
                    <Notice tone="warning" title="Couldn't load the questionnaires" action={<button type="button" onClick={() => { void templates.refetch(); }} className="min-h-ds-control text-ds-body font-[500] text-ds-primary-text underline">Retry</button>}>
                      The choice below cannot be changed until they load.
                    </Notice>
                  )}
                  {templates.data && templates.data.items.length === 0 && <p className="text-ds-label text-ds-fg-muted">No questionnaire templates yet.</p>}
                  {templates.data && templates.data.total > templates.data.items.length && (
                    <p className="mb-[4px] text-ds-label text-ds-warning">Showing {templates.data.items.length} of {templates.data.total} questionnaires.</p>
                  )}
                  <div className="flex max-h-[240px] flex-col overflow-y-auto">
                    {(templates.data?.items ?? []).map((tpl) => (
                      <Checkbox key={tpl.id} label={tpl.name} checked={rules.template_ids.includes(tpl.id)} onChange={() => setTierRule(tierTab, { template_ids: toggle(rules.template_ids, tpl.id) })} />
                    ))}
                  </div>
                </fieldset>
                <fieldset disabled={!canEdit} className={FIELDSET}>
                  <legend className="px-[4px] text-ds-body font-[600] text-ds-fg">Evidence it must supply</legend>
                  <div className="flex flex-col">
                    {Object.entries(evidenceKinds).map(([kind, label]) => (
                      <Checkbox key={kind} label={label} checked={rules.evidence.includes(kind)} onChange={() => setTierRule(tierTab, { evidence: toggle(rules.evidence, kind) })} />
                    ))}
                  </div>
                </fieldset>
              </div>
            )}
          </>
        ))}
      </div>
      {!canEdit && <p className="text-ds-label text-ds-fg-muted">{NEEDS_RIGHT}</p>}
    </div>
  );
}
